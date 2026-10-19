// Phiên trận đánh phía client: chạy `Battle` dùng chung theo thời gian thực (20Hz × SPEED_MULT[x1/x2/x3]),
// ghi lại đầu vào {tick: battle.tick lúc bấm, ult/auto} đúng như simulate() của shared sẽ phát lại ở server.
//
// BẤT BIẾN (quyết định tính đúng của server): trình diễn chỉ quyết định KHI NÀO gọi step(); engine không bao giờ
// bị đổi kết quả. Mỗi lần step() cho ra sự kiện, ta chia thành các "nhóm" (một hành động = một nhóm), xếp hàng,
// rồi KHÔNG gọi step() tiếp cho tới khi nhóm cuối đã được diễn xong + khoảng giữ (presentation gap). Đầu vào ult/auto
// luôn ghi `battle.tick` hiện tại (tick đã chạy xong) và áp ở step kế tiếp — y hệt vòng lặp simulate().
import { signal } from '@preact/signals';
import { Battle, ENERGY_MAX, type BattleEvent, type BattleInput, type BattleSetup } from '@shared/heroes/battle';
import { BATTLE_HZ, BATTLE_MAX_TICKS } from '@shared/heroes/config';
import { skillOf } from '@shared/heroes/skills';
import type { BattleScene } from '../render/battle-scene';
import type { BattleOverlay } from './overlay';
import { IDLE_BOOST, PACE, SPEED_MULT } from './pacing';

export interface HudUnit {
  uid: number;
  key: string;
  name: string;
  energy: number;
  ready: boolean;
  alive: boolean;
  hpPct: number;
}
export interface HudState {
  units: HudUnit[];
  wave: number;
  waves: number;
  ticksLeft: number;
  auto: boolean;
  speed: 1 | 2 | 3;
  paused: boolean;
}

/** một hành động để trình diễn (act + các dmg/heal/fx/die đi kèm), hoặc wave / end */
interface Group {
  evs: BattleEvent[];
  ult: boolean;
  boss: boolean;
  lastBlow: boolean;
}

export class BattleSession {
  readonly battle: Battle;
  readonly inputs: BattleInput[] = [];
  /** Auto lúc bắt đầu — gửi lên server như `auto` của BattleReq (các lần bật/tắt sau nằm trong inputs) */
  readonly initialAuto: boolean;
  readonly hud = signal<HudState>({ units: [], wave: 1, waves: 1, ticksLeft: BATTLE_MAX_TICKS, auto: false, speed: 1, paused: false });
  speed: 1 | 2 | 3;
  paused = false;
  ended = false;
  private accum = 0;
  private endWait = 0;
  private endFired = false;
  private hudAcc = 0;
  /* hàng đợi trình diễn */
  private queue: Group[] = [];
  private qHead = 0;
  private pre: Group | null = null;
  private preT = 0;
  private holdT = 0;
  /** uid đã bấm ult nhưng chưa tới step kế (chống ghi trùng input khi sim đang giữ) */
  private pendingUlt = new Set<number>();

  constructor(
    readonly setup: BattleSetup,
    private scene: BattleScene,
    private overlay: BattleOverlay,
    auto: boolean,
    speed: 1 | 2 | 3,
    private onEnd: (win: boolean) => void,
  ) {
    this.battle = new Battle(setup);
    this.battle.setAuto(auto);
    this.initialAuto = auto;
    this.speed = speed;
    overlay.battle = this.battle;
    scene.timeScale = SPEED_MULT[speed];
    for (const u of this.battle.units) {
      scene.addUnit(u);
      overlay.addBar(u.uid, u.init.side, false);
    }
    this.publish();
  }

  /** gọi mỗi khung hình: dt thực (giây), sdt = dt đã nhân tốc độ/slow-mo/hit-stop (0 khi tạm dừng hay khựng) */
  advance(dt: number, sdt: number) {
    if (this.paused) return;
    if (this.ended) {
      this.endWait += dt;
      // chờ hoạt hình gục/thắng + banner chạy xong rồi mới nộp
      if (!this.endFired && this.endWait >= PACE.endHoldReal && !this.scene.busy) {
        this.endFired = true;
        this.onEnd(this.battle.win);
      } else if (!this.endFired && this.endWait >= PACE.endHoldMaxReal) {
        this.endFired = true;
        this.onEnd(this.battle.win);
      }
      return;
    }

    // 1) đồng hồ trình diễn
    if (this.preT > 0) this.preT -= sdt;
    else if (this.holdT > 0) this.holdT -= sdt;
    this.pump();

    // 2) chỉ khi không còn gì để diễn mới cho engine tiến (tua nhanh nhẹ trong lúc chờ thanh hành động)
    if (this.idle() && !this.battle.done) {
      this.accum += sdt * BATTLE_HZ * IDLE_BOOST;
      let steps = 0;
      while (this.accum >= 1 && !this.battle.done && steps < 12) {
        this.accum -= 1;
        steps++;
        if (this.stepOnce()) {
          // có sự kiện: dừng engine, trình diễn xong mới step tiếp
          this.accum = 0;
          this.pump();
          break;
        }
      }
      if (this.accum > 12) this.accum = 0;
    }

    // 3) engine đã xong và trình diễn đã diễn hết -> vào pha chờ nộp
    if (this.battle.done && this.idle()) {
      this.ended = true;
      this.endWait = 0;
      this.publish();
    }

    this.hudAcc += dt;
    if (this.hudAcc >= 0.1) {
      this.hudAcc = 0;
      this.publish();
    }
  }

  private idle(): boolean {
    return this.qHead >= this.queue.length && !this.pre && this.preT <= 0 && this.holdT <= 0;
  }

  /** lấy nhóm kế tiếp ra diễn khi đã hết khoảng giữ */
  private pump() {
    let guard = 8;
    while (this.preT <= 0 && this.holdT <= 0 && guard-- > 0) {
      if (this.pre) {
        const g = this.pre;
        this.pre = null;
        this.play(g);
        continue;
      }
      if (this.qHead >= this.queue.length) {
        this.queue.length = 0;
        this.qHead = 0;
        break;
      }
      const g = this.queue[this.qHead++];
      if (g.ult) {
        const act = g.evs[0];
        const pre = act.k === 'act' ? this.scene.cineStart(act, g.boss) : 0;
        if (pre > 0) {
          this.pre = g;
          this.preT = pre;
          break;
        }
      }
      this.play(g);
    }
  }

  private play(g: Group) {
    this.scene.groupHold = 0;
    for (const ev of g.evs) {
      if (ev.k === 'wave') {
        for (const uid of ev.units) {
          const u = this.battle.unit(uid);
          if (u) this.overlay.addBar(uid, 1, !!u.init.boss);
        }
      }
      this.scene.handle(ev, this.battle);
    }
    if (g.lastBlow) this.scene.finalBlow();
    // kết thúc: không giữ sim nữa, chờ endHoldReal giây thật rồi nộp (xem advance)
    this.holdT = g.evs[0].k === 'end' ? 0 : this.scene.groupHold;
  }

  /** tiến engine 1 tick; true nếu có sự kiện (đã xếp hàng) */
  private stepOnce(): boolean {
    const evs = this.battle.step();
    this.pendingUlt.clear();
    if (!evs.length) return false;
    let g: Group | null = null;
    for (const ev of evs) {
      if (!g || ev.k === 'act' || ev.k === 'wave' || ev.k === 'end') {
        if (ev.k === 'end') {
          // nhóm ngay trước 'end' có ai gục thì đó là nhát cuối (slow-mo)
          const prev = g ?? (this.qHead < this.queue.length ? this.queue[this.queue.length - 1] : null);
          if (prev && prev.evs.some((e) => e.k === 'die')) prev.lastBlow = true;
        }
        g ={ evs: [], ult: false, boss: false, lastBlow: false };
        if (ev.k === 'act') {
          g.ult = skillOf(ev.s).kind === 'ult';
          const au = this.battle.unit(ev.u);
          // chỉ quái (mk_*) dùng bản cinematic nhẹ; tướng đối thủ ở đấu trường vẫn có chân dung đầy đủ
          g.boss = !!au && au.init.side === 1 && au.init.key.startsWith('mk_');
        }
        this.queue.push(g);
      }
      g.evs.push(ev);
    }
    return true;
  }

  /* ---- điều khiển của người chơi (có ghi lại) ---- */
  ult(uid: number) {
    if (this.paused || this.ended || !this.battle.canUlt(uid) || this.pendingUlt.has(uid)) return;
    this.pendingUlt.add(uid);
    // tick = battle.tick hiện tại: engine áp ở step kế, đúng như simulate() phát lại
    this.inputs.push({ tick: this.battle.tick, ult: uid });
    this.battle.ult(uid);
    this.publish();
  }
  setAuto(on: boolean) {
    if (this.battle.auto === on) return;
    this.inputs.push({ tick: this.battle.tick, auto: on });
    this.battle.setAuto(on);
    this.publish();
  }
  setSpeed(s: 1 | 2 | 3) {
    this.speed = s;
    this.scene.timeScale = this.paused ? 0 : SPEED_MULT[s];
    this.publish();
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.scene.timeScale = p ? 0 : SPEED_MULT[this.speed];
    this.publish();
  }
  /** bỏ qua: bật Auto rồi chạy nốt trận tức thì (vẫn ghi input nên server chạy lại ra đúng kết quả) */
  skip() {
    if (this.ended) return;
    this.setAuto(true);
    let guard = BATTLE_MAX_TICKS + 10;
    while (!this.battle.done && guard-- > 0) this.battle.step();
    this.ended = true;
    this.endFired = true;
    this.queue.length = 0;
    this.qHead = 0;
    this.pre = null;
    this.preT = this.holdT = 0;
    this.scene.resetFx();
    this.overlay.clearCine();
    this.publish();
    this.onEnd(this.battle.win);
  }

  private publish() {
    const b = this.battle;
    const units: HudUnit[] = b.units
      .filter((u) => u.init.side === 0)
      .map((u) => ({
        uid: u.uid, key: u.init.key, name: u.init.name,
        energy: Math.min(100, Math.floor((u.energy * 100) / ENERGY_MAX)),
        ready: b.canUlt(u.uid), alive: u.alive,
        hpPct: Math.max(0, Math.floor((u.hp * 100) / Math.max(1, u.maxHp))),
      }));
    this.hud.value = {
      units, wave: Math.max(1, b.wave + 1), waves: this.setup.waves.length,
      ticksLeft: Math.max(0, BATTLE_MAX_TICKS - b.tick), auto: b.auto, speed: this.speed, paused: this.paused,
    };
  }
}
