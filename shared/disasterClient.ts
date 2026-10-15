// SURVIVAL HỖN LOẠN - phía client (chạy trong rAF của cảnh 3D, không đi qua React).
//  - Nhân vật của MÌNH: dự đoán ngay khi bấm phím bằng đúng PSim mà server dùng; server gửi trạng thái xác nhận
//    kèm số thứ tự input đã nhận (q) → chỉ so sánh khi mọi input tới tick đó đã được server nhận; lệch thì tua lại
//    và phát lại input đã lưu, phần chênh được làm mượt dần ở hình ảnh.
//  - Người khác: nội suy giữa các snapshot (trễ ~100 ms).
//  - Thảm họa: dựng World từ seed, tính theo giờ server → không có gói tin riêng cho thảm họa.
import {
  F_DEAD,
  F_DTICK,
  F_GR,
  F_INW,
  F_WET,
  F_X,
  F_Y,
  F_Z,
  INTRO,
  NF,
  PSim,
  RING,
  STEP_MS,
  World,
} from './disaster.js';

export interface DzConfig {
  arenas: string[][];
  seeds: number[];
  rounds: number;
}

/** cờ trong snapshot: bit0-2 nguyên nhân chết (0 = sống) · bit3 thắng vòng · bit4 đang ở trên không · bit5 đang ngâm nước */
export const FL_WON = 8;
export const FL_AIR = 16;
export const FL_WET = 32;

export interface DzResult {
  r: number;
  /** hạng trong arena theo ghế */
  rk: number[];
  /** điểm vòng + tổng theo ghế */
  pt: number[];
  tot: number[];
  /** tick (cục bộ) chết, -1 = sống sót */
  dt: number[];
  nb: number;
}

const RB = 8;

export class DisasterClient {
  readonly n: number;
  readonly seat: number;
  readonly cfg: DzConfig;
  readonly startAt: number;
  w!: World;
  round = 0;
  base = 0;
  readonly sim = new PSim();
  inter = false;
  result: DzResult | null = null;
  /** số lần đã sửa dự đoán (để đo) */
  corrections = 0;
  flags: Int32Array;

  private q = 0;
  private ev = new Int32Array(64);
  private dx = 0;
  private dy = 0;
  private pending: { r: number; base: number } | null = null;
  private rT: Float64Array;
  private rX: Float32Array;
  private rY: Float32Array;
  private rZ: Float32Array;
  private rF: Int32Array;
  private rH: Uint8Array;
  private offX = 0;
  private offY = 0;
  private lastFrame = 0;
  private sp = new Float64Array(2);
  private mTmp = new Float64Array(NF);

  constructor(startAt: number, cfg: DzConfig, arena: number, seat: number) {
    this.cfg = cfg;
    this.startAt = startAt;
    this.n = cfg.arenas[arena].length;
    this.seat = seat;
    this.flags = new Int32Array(this.n);
    this.rT = new Float64Array(this.n * RB).fill(-1);
    this.rX = new Float32Array(this.n * RB);
    this.rY = new Float32Array(this.n * RB);
    this.rZ = new Float32Array(this.n * RB);
    this.rF = new Int32Array(this.n * RB);
    this.rH = new Uint8Array(this.n);
    this.startRound(0, 0);
  }

  /** tick (số thực) theo giờ server */
  tickF(now: number) {
    return (now - this.startAt) / STEP_MS;
  }

  spawnOf(seat: number, out: Float64Array) {
    this.w.spawn(seat, this.n, out);
  }

  private startRound(r: number, base: number) {
    this.round = r;
    this.base = base;
    this.w = new World(this.cfg.seeds[Math.min(r, this.cfg.seeds.length - 1)], r, base);
    this.inter = false;
    this.result = null;
    this.pending = null;
    this.flags.fill(0);
    this.rT.fill(-1);
    this.rH.fill(0);
    this.offX = 0;
    this.offY = 0;
    this.dx = 0;
    this.dy = 0;
    this.w.spawn(this.seat, this.n, this.sp);
    this.sim.reset(base, this.sp[0], this.sp[1], this.w.groundZ(0, this.sp[0], this.sp[1]));
  }

  onMessage(p: any, now: number) {
    if (p.y === 's') this.onSnap(p);
    else if (p.y === 'e') {
      if (p.r < this.round) return;
      this.result = p as DzResult;
      this.inter = true;
      this.sim.frozen = true;
      if (p.nb >= 0) this.pending = { r: p.r + 1, base: p.nb };
    }
    void now;
  }

  private onSnap(p: any) {
    if (p.r > this.round || (p.r === this.round && p.b !== this.base)) this.startRound(p.r, p.b);
    else if (p.r < this.round) return;
    const o = p.o as number[][];
    for (let i = 0; i < o.length; i++) {
      const e = o[i];
      const s = e[0];
      if (s < 0 || s >= this.n) continue;
      this.flags[s] = e[4];
      if (s === this.seat) continue;
      const h = this.rH[s];
      const k = s * RB + h;
      this.rT[k] = p.T;
      this.rX[k] = e[1] / 16;
      this.rY[k] = e[2] / 16;
      this.rZ[k] = e[3] / 16;
      this.rF[k] = e[4];
      this.rH[s] = (h + 1) % RB;
    }
    if ((this.flags[this.seat] & FL_WON) !== 0) this.sim.frozen = true;
    this.reconcile(p);
  }

  private reconcile(p: any) {
    const T: number = p.T;
    const sim = this.sim;
    if (T > sim.tick || T <= sim.tick - RING + 6 || T < this.base) return;
    // còn input nào của mình (tick <= T) mà server chưa nhận thì chưa so được
    if (this.q > p.q && this.ev[(p.q + 1) & 63] <= T) return;
    const m = p.m as number[];
    const bad =
      Math.abs(sim.at(T, F_X) - m[F_X]) > 0.02 ||
      Math.abs(sim.at(T, F_Y) - m[F_Y]) > 0.02 ||
      Math.abs(sim.at(T, F_Z) - m[F_Z]) > 0.03 ||
      sim.at(T, F_DEAD) !== m[F_DEAD] ||
      Math.abs(sim.at(T, F_WET) - m[F_WET]) > 1.5;
    if (!bad) return;
    const goal = sim.tick;
    const ox = sim.s[F_X];
    const oy = sim.s[F_Y];
    for (let i = 0; i < NF; i++) this.mTmp[i] = m[i] ?? 0;
    sim.restore(T, this.mTmp);
    sim.advance(this.w, goal);
    this.corrections++;
    this.offX += ox - sim.s[F_X];
    this.offY += oy - sim.s[F_Y];
    if (this.offX * this.offX + this.offY * this.offY > 9) {
      this.offX = 0;
      this.offY = 0;
    }
  }

  /** gọi mỗi khung hình */
  frame(now: number) {
    const tf = this.tickF(now);
    const tk = Math.floor(tf);
    if (this.pending && tk >= this.pending.base) this.startRound(this.pending.r, this.pending.base);
    if (!this.inter && tk >= this.base) this.sim.advance(this.w, tk);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = now;
    const k = Math.exp(-dt * 11);
    this.offX *= k;
    this.offY *= k;
  }

  /** vị trí vẽ của mình (nội suy giữa 2 tick + phần sửa dự đoán): out = [x, y, z] */
  renderMe(now: number, out: Float64Array) {
    const sim = this.sim;
    const a = Math.min(1, Math.max(0, this.tickF(now) - sim.tick));
    const t0 = sim.tick - 1 >= this.base - 1 ? sim.tick - 1 : sim.tick;
    const live = sim.s[F_DEAD] === 0 && !sim.frozen;
    const px = live ? sim.at(t0, F_X) : sim.s[F_X];
    const py = live ? sim.at(t0, F_Y) : sim.s[F_Y];
    const pz = live ? sim.at(t0, F_Z) : sim.s[F_Z];
    out[0] = px + (sim.s[F_X] - px) * a + this.offX;
    out[1] = py + (sim.s[F_Y] - py) * a + this.offY;
    out[2] = pz + (sim.s[F_Z] - pz) * a;
  }

  /** vị trí vẽ của người khác (nội suy, trễ 6 tick); trả cờ */
  renderOther(seat: number, now: number, out: Float64Array): number {
    const tr = this.tickF(now) - 6;
    let ai = -1;
    let bi = -1;
    for (let i = 0; i < RB; i++) {
      const k = seat * RB + i;
      const t = this.rT[k];
      if (t < 0) continue;
      if (t <= tr) {
        if (ai < 0 || t > this.rT[ai]) ai = k;
      } else if (bi < 0 || t < this.rT[bi]) bi = k;
    }
    if (ai < 0 && bi < 0) {
      this.w.spawn(seat, this.n, this.sp);
      out[0] = this.sp[0];
      out[1] = this.sp[1];
      out[2] = this.w.groundZ(0, this.sp[0], this.sp[1]);
      return this.flags[seat];
    }
    if (ai < 0) ai = bi;
    if (bi < 0) bi = ai;
    const ta = this.rT[ai];
    const tb = this.rT[bi];
    const u = tb > ta ? Math.min(1, Math.max(0, (tr - ta) / (tb - ta))) : 0;
    out[0] = this.rX[ai] + (this.rX[bi] - this.rX[ai]) * u;
    out[1] = this.rY[ai] + (this.rY[bi] - this.rY[ai]) * u;
    out[2] = this.rZ[ai] + (this.rZ[bi] - this.rZ[ai]) * u;
    return this.flags[seat];
  }

  get alive(): boolean {
    return this.sim.s[F_DEAD] === 0;
  }
  get deathCause(): number {
    return this.sim.s[F_DEAD];
  }
  get deathTick(): number {
    return this.sim.s[F_DTICK];
  }
  get airborne(): boolean {
    return this.sim.s[F_GR] === 0;
  }
  get inWater(): boolean {
    return this.sim.s[F_INW] > 0;
  }
  /** 0..1: đã ngâm nước bao lâu (để vẽ thanh ngạt) */
  get wet(): number {
    return Math.min(1, this.sim.s[F_WET] / 140);
  }
  get won(): boolean {
    return (this.flags[this.seat] & FL_WON) !== 0;
  }

  aliveCount(): number {
    let c = 0;
    for (let i = 0; i < this.n; i++) if ((this.flags[i] & 7) === 0 && i !== this.seat) c++;
    return c + (this.alive ? 1 : 0);
  }

  /** tick cục bộ (so với đầu vòng) */
  localTick(now: number) {
    return this.tickF(now) - this.base;
  }

  private canInput() {
    return !this.inter && this.alive && !this.sim.frozen;
  }

  private send(now: number, j: number) {
    const tk = Math.floor(this.tickF(now));
    if (tk >= this.base) this.sim.advance(this.w, tk);
    const k = this.sim.tick + 1;
    this.sim.input(this.w, k, this.dx, this.dy, j);
    this.q++;
    this.ev[this.q & 63] = k;
    return { type: 'dz' as const, t: k, q: this.q, dx: this.dx, dy: this.dy, j };
  }

  /** hướng đang giữ đổi → trả gói input để gửi (hoặc null) */
  setDir(dx: number, dy: number, now: number) {
    if (dx === this.dx && dy === this.dy) return null;
    this.dx = dx;
    this.dy = dy;
    if (!this.canInput()) return null;
    return this.send(now, 0);
  }

  jump(now: number) {
    if (!this.canInput() || this.sim.s[F_GR] === 0) return null;
    return this.send(now, 1);
  }
}

export { INTRO };
