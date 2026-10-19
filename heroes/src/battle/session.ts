// Phiên trận đánh phía client: chạy `Battle` dùng chung theo thời gian thực (20Hz × SPEED_MULT[x1/x2/x3]),
// ghi lại đầu vào {tick: battle.tick lúc bấm, ult/auto} đúng như simulate() của shared sẽ phát lại ở server.
//
// BẤT BIẾN (quyết định tính đúng của server): trình diễn chỉ quyết định KHI NÀO gọi step(); engine không bao giờ
// bị đổi kết quả. Phiên gọi step() đều đặn 20Hz × SPEED_MULT, KHÔNG bao giờ giữ engine chờ hoạt ảnh; sự kiện của mỗi step
// được phát NGAY và song song (mỗi đơn vị tự hoạt hoá). Đầu vào ult/auto ghi `battle.tick` hiện tại (tick đã chạy xong)
// và áp ở step kế tiếp — y hệt vòng lặp simulate().
import { signal } from '@preact/signals';
import { statOf } from '@shared/heroes/combat';
import { Battle, ENERGY_MAX, GAUGE_MAX, type BattleInput, type BattleSetup, type Unit } from '@shared/heroes/battle';
import { BATTLE_HZ, BATTLE_MAX_TICKS } from '@shared/heroes/config';
import type { BattleScene } from '../render/battle-scene';
import type { BattleOverlay } from './overlay';
import { MOTION, PACE, SPEED_MULT } from './pacing';

export interface HudUnit {
  uid: number;
  key: string;
  name: string;
  energy: number;
  ready: boolean;
  alive: boolean;
  hpPct: number;
  /** giây (thời gian trận) tới lượt hành động kế tiếp của tướng này; -1 = đang choáng/đã gục; -2 = đang tiến (chưa có địch trong tầm) */
  cd: number;
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
  /** nhịp mở màn: giây thật còn lại trước khi engine chạy; opened = đã dựng đợt đầu (tick 1) để hiện hai đạo quân */
  private ready: number = MOTION.readyReal;
  private opened = false;
  /** uid đã bấm ult nhưng chưa tới step kế (chống ghi trùng input trong cùng một tick) */
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

  /** màn mở đầu (biển ải + đếm 3-2-1) kéo dài nhịp "ready" thêm tới `sec` giây thật; chỉ hình ảnh, engine chưa chạy nên không đổi kết quả */
  holdIntro(sec: number) {
    if (this.opened && this.ready <= 0) return;
    this.ready = Math.max(this.ready, sec);
  }
  /** chạm bỏ qua mở đầu: còn lại ~0 giây ready */
  skipIntro() {
    if (this.ready > 0.05) this.ready = 0.05;
  }

  /** gọi mỗi khung hình: dt thực (giây). Nhịp engine = dt × 20Hz × SPEED_MULT, không phụ thuộc hoạt ảnh/hit-stop/slow-mo */
  advance(dt: number, _sdt?: number) {
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

    // mở màn: dựng đợt đầu bằng đúng step() đầu tiên (tick 1, hai bên còn cách xa), rồi đứng yên ~0.8 s thật
    if (this.ready > 0) {
      if (!this.opened) {
        this.opened = true;
        this.stepOnce();
        this.publish();
      }
      this.ready -= dt;
      return;
    }

    this.accum += dt * BATTLE_HZ * SPEED_MULT[this.speed];
    let steps = 0;
    while (this.accum >= 1 && !this.battle.done && steps < 8) {
      this.accum -= 1;
      steps++;
      this.stepOnce();
    }
    if (this.accum > 8) this.accum = 0; // tab bị treo lâu: bỏ phần dồn, không đuổi

    if (this.battle.done) {
      this.ended = true;
      this.endWait = 0;
      this.publish();
      return;
    }

    this.hudAcc += dt;
    if (this.hudAcc >= 0.1) {
      this.hudAcc = 0;
      this.publish();
    }
  }

  /** tiến engine 1 tick và phát NGAY mọi sự kiện (đồng thời) */
  private stepOnce() {
    const evs = this.battle.step();
    this.pendingUlt.clear();
    if (!evs.length) return;
    let die = false;
    let end = false;
    for (const ev of evs) {
      if (ev.k === 'wave') {
        for (const uid of ev.units) {
          const u = this.battle.unit(uid);
          if (u) this.overlay.addBar(uid, 1, !!u.init.boss);
        }
      } else if (ev.k === 'die') die = true;
      else if (ev.k === 'end') end = true;
      this.scene.handle(ev, this.battle);
    }
    // trận kết thúc ngay sau một cú hạ gục: nhát cuối (slow-mo, engine đã xong nên không ảnh hưởng gì)
    if (end && die) this.scene.finalBlow();
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
    this.scene.resetFx();
    this.overlay.clearCine();
    this.publish();
    this.onEnd(this.battle.win);
  }

  /** giây tới lượt hành động kế: (GAUGE_MAX - gauge) / spd hiệu dụng / 20Hz — giống cách engine đổ thanh hành động */
  private cdOf(u: Unit): number {
    const b = this.battle;
    if (!u.alive || b.stunned(u)) return -1;
    let pct = 100;
    for (const e of u.effs) if (e.type === 'spdUp' && e.until > b.tick) pct += e.value;
    // ngoài tầm (đang tiến): thanh hành động không đầy
    let near = false;
    for (const f of b.units) {
      if (f.alive && f.init.side !== u.init.side && Math.abs(f.x - u.x) <= u.range) {
        near = true;
        break;
      }
    }
    if (!near) return -2;
    const spd = Math.max(1, Math.floor((Math.floor((u.init.stats.spd * pct) / 100) * statOf(u.init.stats, 'aspd')) / 100));
    return Math.max(0, (GAUGE_MAX - u.gauge) / spd / BATTLE_HZ);
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
        cd: this.cdOf(u),
      }));
    this.hud.value = {
      units, wave: Math.max(1, b.wave + 1), waves: this.setup.waves.length,
      ticksLeft: Math.max(0, BATTLE_MAX_TICKS - b.tick), auto: b.auto, speed: this.speed, paused: this.paused,
    };
  }
}
