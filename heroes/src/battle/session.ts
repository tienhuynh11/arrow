// Phiên trận đánh phía client: chạy `Battle` dùng chung theo thời gian thực (20Hz nhân tốc độ x1/x2/x3),
// ghi lại đầu vào {tick: battle.tick lúc bấm, ult/auto} đúng như simulate() của shared sẽ phát lại ở server.
import { signal } from '@preact/signals';
import { Battle, ENERGY_MAX, type BattleInput, type BattleSetup } from '@shared/heroes/battle';
import { BATTLE_HZ, BATTLE_MAX_TICKS } from '@shared/heroes/config';
import type { BattleScene } from '../render/battle-scene';
import type { BattleOverlay } from './overlay';

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
    scene.timeScale = speed;
    for (const u of this.battle.units) {
      scene.addUnit(u);
      overlay.addBar(u.uid, u.init.side, false);
    }
    this.publish();
  }

  /** gọi mỗi khung hình với dt thực (giây) */
  advance(dt: number) {
    if (this.paused) return;
    if (this.ended) {
      this.endWait += dt;
      // chờ hoạt hình gục/thắng chạy xong rồi mới nộp
      if (!this.endFired && this.endWait >= 1.6 && !this.scene.busy) {
        this.endFired = true;
        this.onEnd(this.battle.win);
      } else if (!this.endFired && this.endWait >= 3) {
        this.endFired = true;
        this.onEnd(this.battle.win);
      }
      return;
    }
    this.accum += dt * this.speed * BATTLE_HZ;
    let steps = 0;
    while (this.accum >= 1 && !this.battle.done && steps < 12) {
      this.accum -= 1;
      steps++;
      this.stepOnce();
    }
    if (this.accum > 12) this.accum = 0;
    this.hudAcc += dt;
    if (this.hudAcc >= 0.1) {
      this.hudAcc = 0;
      this.publish();
    }
  }

  private stepOnce() {
    const evs = this.battle.step();
    for (const ev of evs) {
      if (ev.k === 'wave') {
        for (const uid of ev.units) {
          const u = this.battle.unit(uid);
          if (u) this.overlay.addBar(uid, 1, !!u.init.boss);
        }
      }
      this.scene.handle(ev, this.battle);
      if (ev.k === 'end') this.ended = true;
    }
    if (this.battle.done) {
      this.ended = true;
      this.publish();
    }
  }

  /* ---- điều khiển của người chơi (có ghi lại) ---- */
  ult(uid: number) {
    if (this.paused || this.ended || !this.battle.canUlt(uid)) return;
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
    this.scene.timeScale = this.paused ? 0 : s;
    this.publish();
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.scene.timeScale = p ? 0 : this.speed;
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
