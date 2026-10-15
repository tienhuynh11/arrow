// Bot câu cá dùng chung cho test đơn vị (đồng hồ giả) và bot WebSocket thật.
// Bot dự đoán ván kéo bằng ĐÚNG hàm của shared/fishing.ts như client thật.
import {
  SPECIES,
  STEP_MS,
  STEAL_CD_MS,
  ST_IDLE,
  fishY,
  mulberry32,
  newReel,
  resetReel,
  stepBar,
  stepReel,
  type ReelState,
} from '../../shared/fishing.js';

export type Strategy = 'fisher' | 'thief' | 'hybrid';

export interface BotOpts {
  seat: number;
  strat: Strategy;
  /** 0..1: phản xạ + độ chính xác kéo cá */
  skill: number;
  seed: number;
  send(input: any): void;
}

type Mode = 'idle' | 'wait' | 'bite' | 'reel';

export class FishBot {
  mode: Mode = 'idle';
  readyAt = 0;
  private hookAt = 0;
  private cls = 0;
  private seed = 0;
  private t0 = 0;
  private tick = 0;
  private hold = false;
  private reel: ReelState = newReel();
  private rng: () => number;
  /** snapshot gần nhất của hồ: mỗi hàng [st, prog, pts, imm, cd, heldSp, heldLeft] */
  rows: number[][] = [];
  private stealReadyAt = 0;
  private stealThinkAt = 0;
  private waitSince = 0;
  pts = 0;

  constructor(private o: BotOpts) {
    this.rng = mulberry32(o.seed);
  }

  onEvent(p: any, now: number) {
    const mine = p.i === this.o.seat;
    switch (p.type) {
      case 'sn':
        this.rows = p.r;
        this.pts = p.r[this.o.seat]?.[2] ?? this.pts;
        break;
      case 'st':
        if (mine) {
          if (p.s === ST_IDLE) {
            this.mode = 'idle';
            this.readyAt = now + 800;
          } else if (p.s === 5) {
            this.mode = 'idle';
            this.readyAt = now + 2500;
          }
        }
        break;
      case 'bite':
        this.mode = 'bite';
        this.cls = p.cls;
        this.seed = p.seed;
        this.hookAt = now + this.reactionMs();
        break;
      case 'esc':
        if (mine) {
          this.mode = 'idle';
          this.readyAt = now + 800;
        }
        break;
      case 'land':
        if (mine) {
          this.mode = 'idle';
          this.readyAt = now + 800;
        }
        break;
      case 'stl':
        if (p.by === this.o.seat || p.from === this.o.seat) {
          this.mode = 'idle';
          this.readyAt = now + 800;
        }
        break;
    }
  }

  private reactionMs() {
    const s = this.o.skill;
    return 250 + (1 - s) * 450 + this.rng() * 200;
  }

  step(now: number) {
    const { strat } = this.o;
    if (this.mode === 'reel') {
      this.stepReel(now);
      return;
    }
    if (this.mode === 'bite') {
      if (now >= this.hookAt) {
        this.o.send({ type: 'fhook', at: now });
        this.mode = 'reel';
        this.t0 = now;
        this.tick = 0;
        this.hold = false;
        resetReel(this.reel);
      }
      return;
    }
    if (strat !== 'fisher' && now >= this.stealReadyAt && now >= this.stealThinkAt) {
      if (this.wantSteal()) {
        this.o.send({ type: 'fsteal' });
        this.stealReadyAt = now + STEAL_CD_MS + 100;
        this.stealThinkAt = now + 200;
        return;
      }
    }
    if (strat === 'thief') return;
    if (this.mode === 'idle' && now >= this.readyAt) {
      this.o.send({ type: 'fcast' });
      this.mode = 'wait';
      this.waitSince = now;
    } else if (this.mode === 'wait' && now - this.waitSince > 9000) this.mode = 'idle';
  }

  private wantSteal(): boolean {
    for (let i = 0; i < this.rows.length; i++) {
      if (i === this.o.seat) continue;
      const r = this.rows[i];
      if (r[3] > 0) continue; // miễn nhiễm
      const heldVal = r[5] >= 0 ? SPECIES[r[5]].value : 0;
      if (heldVal > 0 && (this.o.strat === 'thief' || heldVal >= 16)) return true;
      if (this.o.strat === 'thief' && r[0] === 4 && r[1] >= 45) return true;
    }
    return false;
  }

  private stepReel(now: number) {
    const cur = Math.floor((now - this.t0) / STEP_MS);
    while (this.tick < cur) {
      const t = this.tick;
      const want = this.decide(t);
      if (want !== this.hold) {
        this.hold = want;
        this.o.send({ type: 'fhold', h: want ? 1 : 0, k: t });
      }
      const res = stepReel(this.reel, this.hold, this.cls, this.seed, t);
      this.tick++;
      if (res !== 0) {
        this.mode = 'idle';
        this.readyAt = now + 5000; // chờ sự kiện server
        return;
      }
    }
  }

  /** MPC đơn giản: thử giữ / nhả, chọn cái đưa thanh gần vị trí cá hơn sau 3 bước */
  decide(t: number): boolean {
    const sk = this.o.skill;
    const delay = Math.round((1 - sk) * 6) + 2;
    const noise = (1 - sk) * 0.2;
    const aim = fishY(this.seed, this.cls, Math.max(0, t - delay) + 4) + (this.rng() - 0.5) * noise * 2;
    const tmp = { y: 0, v: 0 };
    const sim = (hold: boolean) => {
      tmp.y = this.reel.y;
      tmp.v = this.reel.v;
      for (let i = 0; i < 3; i++) stepBar(tmp, hold, this.cls);
      return Math.abs(tmp.y - aim);
    };
    return sim(true) < sim(false);
  }
}
