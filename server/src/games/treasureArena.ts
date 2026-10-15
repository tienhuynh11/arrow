import {
  ACT_R,
  COUNT_TICKS,
  FIRST_WAVE_PER_P,
  IMMUNE_TICKS,
  LC_MAX,
  LOCK_TICKS,
  MAXC,
  MAXI,
  MAXP,
  MISS_CD,
  MOVE_REWIND_MAX,
  PICK_R,
  PLAY_TICKS,
  PR,
  RING,
  SHOVE_DIST,
  STEAL_CD,
  BASE_R,
  TreasureWorld,
  WAVE_EVERY,
  WAVE_PER_P,
  arenaDims,
  stealSplit,
} from '../../../shared/treasure.js';

/**
 * Một ĐẤU TRƯỜNG cướp kho báu: 2-6 người. Toàn bộ trạng thái nằm trong typed array cố định;
 * vòng bước (stepTick) không cấp phát đối tượng (chỉ cấp phát khi có SỰ KIỆN: nhặt / nộp / cướp).
 *
 * Mạng (như tanks): input mang tick của client; server TUA LẠI riêng người đó từ tick ấy (vòng đệm RING) nên quỹ đạo
 * trùng khớp với bản dự đoán ở client. Phát cướp/đẩy được bù trễ: vị trí người cướp tại tick bấm, vị trí nạn nhân
 * lùi `viewDelay` tick (chính là độ trễ nội suy mà người cướp đang nhìn thấy), tối đa LC_MAX tick (250ms).
 */
export interface TreasureOpts {
  lagComp: boolean;
  /** lùi bao nhiêu tick khi đối chiếu vị trí nạn nhân (khi client chưa báo d) */
  viewDelay: number;
}
export const T_DEFAULT: TreasureOpts = { lagComp: true, viewDelay: 6 };

export const PH_COUNT = 0;
export const PH_PLAY = 1;
export const PH_OVER = 2;
export const PH_DONE = 3;

export class TreasureArena {
  readonly w = new TreasureWorld();
  readonly n: number;
  readonly W: number;
  readonly H: number;

  phase = PH_DONE;
  t0 = 0;
  fs = 0;
  endT = 0;
  nextWave = 0;
  nextId = 1;
  /** tổng kho báu đã xuất hiện trong đấu trường (để chia điểm công bằng) */
  supply = 0;

  heldX = new Int8Array(MAXP);
  heldY = new Int8Array(MAXP);
  lastT = new Int32Array(MAXP);
  /** tick nhận gói input gần nhất (mất tín hiệu quá 2.5s thì nhả phím, tránh nhân vật chạy mãi) */
  lastIn = new Int32Array(MAXP);
  actCnt = new Int32Array(MAXP);
  ackQ = new Int32Array(MAXP);
  nextAct = new Int32Array(MAXP);
  immune = new Int32Array(MAXP);
  pickLock = new Int32Array(MAXP);
  viewD = new Int8Array(MAXP).fill(-1);
  shTick = new Int32Array(MAXP).fill(-1);
  shDx = new Float64Array(MAXP);
  shDy = new Float64Array(MAXP);

  dep = new Int32Array(MAXP);
  steals = new Int32Array(MAXP);
  robbed = new Int32Array(MAXP);

  iAct = new Uint8Array(MAXI);
  ix = new Float64Array(MAXI);
  iy = new Float64Array(MAXI);
  iid = new Int32Array(MAXI);
  iCount = 0;
  private tmpIds: number[] = [];

  constructor(
    readonly idx: number,
    readonly ids: string[],
    private send: (payload: any) => void,
    readonly opts: TreasureOpts = T_DEFAULT,
  ) {
    this.n = ids.length;
    [this.W, this.H] = arenaDims(this.n);
  }

  start() {
    const w = this.w;
    w.setup(this.n, this.W, this.H);
    this.t0 = w.tick;
    this.fs = w.tick + COUNT_TICKS;
    this.endT = this.fs + PLAY_TICKS;
    this.nextWave = this.fs;
    this.lastIn.fill(this.t0);
    this.phase = PH_COUNT;
    this.iAct.fill(0);
    this.iCount = 0;
    this.send(this.syncMsg());
  }

  finish() {
    this.phase = PH_DONE;
  }

  syncMsg() {
    const it: number[] = [];
    for (let s = 0; s < MAXI; s++) if (this.iAct[s]) it.push(this.iid[s], Math.round(this.ix[s]), Math.round(this.iy[s]));
    return {
      type: 'W',
      a: this.idx,
      k: this.w.tick,
      t0: this.t0,
      fs: this.fs,
      endT: this.endT,
      ph: this.phase,
      it,
      sc: Array.from(this.dep.subarray(0, this.n)),
      st: Array.from(this.steals.subarray(0, this.n)),
    };
  }

  advance(T: number) {
    while (this.w.tick < T) this.stepTick();
  }

  stepTick() {
    const w = this.w;
    const k = ++w.tick;
    if (this.phase === PH_COUNT && k >= this.fs) this.phase = PH_PLAY;
    const playing = this.phase === PH_PLAY;
    if (playing) {
      for (let i = 0; i < this.n; i++) {
        if ((this.heldX[i] !== 0 || this.heldY[i] !== 0) && k - this.lastIn[i] > 150) {
          this.heldX[i] = 0;
          this.heldY[i] = 0;
        }
        w.step(i, this.heldX[i], this.heldY[i]);
      }
    }
    for (let i = 0; i < this.n; i++) w.record(i);
    if (!playing) return;

    if (k >= this.nextWave) this.spawnWave(k);
    if (this.iCount > 0) this.pickups(k);
    this.deliveries(k);
    if (k >= this.endT) this.over(k);
  }

  /* ---------------- kho báu ---------------- */
  private addItem(x: number, y: number): number {
    for (let s = 0; s < MAXI; s++) {
      if (this.iAct[s]) continue;
      this.iAct[s] = 1;
      this.ix[s] = x;
      this.iy[s] = y;
      this.iid[s] = this.nextId++;
      this.iCount++;
      this.supply++;
      return s;
    }
    return -1;
  }

  private spawnWave(k: number) {
    const first = this.nextWave === this.fs;
    this.nextWave = k + WAVE_EVERY;
    // 8 giây cuối không hồi sinh nữa (không kịp mang về)
    if (k > this.endT - 480) return;
    const cnt = this.n * (first ? FIRST_WAVE_PER_P : WAVE_PER_P);
    const cx = this.W / 2;
    const cy = this.H / 2;
    const R = Math.min(this.W, this.H) * 0.15;
    const out: number[] = [];
    for (let c = 0; c < cnt; c++) {
      let x = cx;
      let y = cy;
      for (let tr = 0; tr < 6; tr++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R;
        x = cx + Math.cos(a) * r;
        y = cy + Math.sin(a) * r;
        let ok = true;
        for (let q = 0; q < out.length; q += 3) {
          const dx = out[q + 1] - x;
          const dy = out[q + 2] - y;
          if (dx * dx + dy * dy < 14 * 14) {
            ok = false;
            break;
          }
        }
        if (ok) break;
      }
      const s = this.addItem(x, y);
      if (s >= 0) out.push(this.iid[s], Math.round(this.ix[s]), Math.round(this.iy[s]));
    }
    if (out.length) this.send({ type: 'c', a: this.idx, k, it: out, first: first ? 1 : 0 });
  }

  private pickups(k: number) {
    const w = this.w;
    const rr = PICK_R * PICK_R;
    for (let i = 0; i < this.n; i++) {
      if (w.load[i] >= MAXC || k < this.pickLock[i]) continue;
      const px = w.x[i];
      const py = w.y[i];
      let got: number[] | null = null;
      for (let s = 0; s < MAXI && w.load[i] < MAXC; s++) {
        if (!this.iAct[s]) continue;
        const dx = this.ix[s] - px;
        const dy = this.iy[s] - py;
        if (dx * dx + dy * dy >= rr) continue;
        this.iAct[s] = 0;
        this.iCount--;
        w.load[i]++;
        (got ??= this.tmpIds).push(this.iid[s]);
      }
      if (got) {
        this.send({ type: 'p', a: this.idx, k, v: i, ld: w.load[i], ids: got.slice() });
        got.length = 0;
      }
    }
  }

  private deliveries(k: number) {
    const w = this.w;
    const rr = BASE_R * BASE_R;
    for (let i = 0; i < this.n; i++) {
      if (w.load[i] <= 0) continue;
      const dx = w.x[i] - w.bx[i];
      const dy = w.y[i] - w.by[i];
      if (dx * dx + dy * dy > rr) continue;
      const nn = w.load[i];
      w.load[i] = 0;
      this.dep[i] += nn;
      this.send({ type: 'd', a: this.idx, k, v: i, n: nn, sc: this.dep[i] });
    }
  }

  private over(k: number) {
    this.phase = PH_OVER;
    this.iAct.fill(0);
    this.iCount = 0;
    const lost = Array.from(this.w.load.subarray(0, this.n));
    this.w.load.fill(0);
    this.send({
      type: 'o',
      a: this.idx,
      k,
      sc: Array.from(this.dep.subarray(0, this.n)),
      st: Array.from(this.steals.subarray(0, this.n)),
      lost,
    });
  }

  /* ---------------- input ---------------- */
  private vdOf(s: number) {
    if (!this.opts.lagComp) return 0;
    const d = this.viewD[s];
    return d >= 0 && this.opts.viewDelay > 0 ? d : this.opts.viewDelay;
  }

  applyInput(i: number, t: number, q: number, dx: number, dy: number, a: number, d = -1) {
    const w = this.w;
    if (i < 0 || i >= this.n) return;
    const S = w.tick;
    this.lastIn[i] = S;
    if (q >= this.ackQ[i]) this.ackQ[i] = q;
    if (d >= 0) this.viewD[i] = d > 12 ? 12 : d;
    const lo = Math.max(S - MOVE_REWIND_MAX, this.fs);
    let eff = t < lo ? lo : t;
    if (eff < this.lastT[i]) eff = this.lastT[i];
    if (!this.opts.lagComp || eff > S + 1) eff = S + 1;
    if (eff > this.lastT[i]) this.lastT[i] = eff;
    if (dx !== this.heldX[i] || dy !== this.heldY[i]) {
      this.heldX[i] = dx;
      this.heldY[i] = dy;
      if (eff <= S && this.phase === PH_PLAY) {
        w.restore(i, eff - 1);
        for (let tt = eff; tt <= S; tt++) {
          w.step(i, dx, dy);
          if (tt === this.shTick[i]) {
            w.x[i] += this.shDx[i];
            w.y[i] += this.shDy[i];
            w.collide(i);
          }
          w.recordAt(i, tt & (RING - 1));
        }
      }
    }
    if (a > this.actCnt[i]) {
      this.actCnt[i] = a;
      const loA = Math.max(S - LC_MAX, this.fs);
      let kk = this.opts.lagComp ? (t < loA ? loA : t) : S;
      if (kk > S) kk = S;
      this.act(i, kk, a);
    }
  }

  /** cướp (nếu có người đang mang đồ, không miễn nhiễm) hoặc đẩy; trượt thì chỉ mất hồi chiêu ngắn */
  private act(i: number, kk: number, n: number) {
    if (this.phase !== PH_PLAY || kk < this.fs || kk < this.nextAct[i]) return;
    const w = this.w;
    const S = w.tick;
    const hi = i * RING + (kk & (RING - 1));
    const ax = w.hx[hi];
    const ay = w.hy[hi];
    const vd = this.vdOf(i);
    const kv = Math.max(this.fs, kk - vd);
    const rr = ACT_R * ACT_R;
    let best = -1;
    let bd = rr;
    let bestS = -1;
    let bsd = rr;
    for (let j = 0; j < this.n; j++) {
      if (j === i) continue;
      const h = j * RING + (kv & (RING - 1));
      const dx = w.hx[h] - ax;
      const dy = w.hy[h] - ay;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr) continue;
      if (w.load[j] > 0 && this.immune[j] <= S && d2 < bsd) {
        bsd = d2;
        bestS = j;
      }
      if (d2 < bd) {
        bd = d2;
        best = j;
      }
    }
    if (bestS >= 0) this.steal(i, bestS, kk, S, n);
    else if (best >= 0) this.shove(i, best, kk, S, ax, ay, n);
    else {
      this.nextAct[i] = kk + MISS_CD;
      this.send({ type: 'b', a: this.idx, k: S, by: i, v: -1, n });
    }
  }

  private steal(i: number, j: number, kk: number, S: number, n: number) {
    const w = this.w;
    const { lost, drop: drop0 } = stealSplit(w.load[j]);
    let gain = lost - drop0;
    let drop = drop0;
    const room = MAXC - w.load[i];
    if (gain > room) {
      drop += gain - room;
      gain = room;
    }
    w.load[j] -= lost;
    w.load[i] += gain;
    this.immune[j] = S + IMMUNE_TICKS;
    this.pickLock[j] = S + LOCK_TICKS;
    this.pickLock[i] = S + 18;
    this.nextAct[i] = kk + STEAL_CD;
    this.steals[i]++;
    this.robbed[j]++;
    const it: number[] = [];
    for (let c = 0; c < drop; c++) {
      const a = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 24;
      let x = w.x[j] + Math.cos(a) * r;
      let y = w.y[j] + Math.sin(a) * r;
      x = Math.min(this.W - PR, Math.max(PR, x));
      y = Math.min(this.H - PR, Math.max(PR, y));
      const s = this.addItem(x, y);
      // đồ rơi KHÔNG tính vào nguồn cung mới (đã tính khi xuất hiện lần đầu)
      if (s >= 0) {
        this.supply--;
        it.push(this.iid[s], Math.round(this.ix[s]), Math.round(this.iy[s]));
      }
    }
    this.send({
      type: 'h',
      a: this.idx,
      k: S,
      by: i,
      n,
      v: j,
      g: gain,
      lb: w.load[i],
      lv: w.load[j],
      x: Math.round(w.x[j] * 4),
      y: Math.round(w.y[j] * 4),
      it,
    });
  }

  private shove(i: number, j: number, kk: number, S: number, ax: number, ay: number, n: number) {
    const w = this.w;
    this.nextAct[i] = kk + (STEAL_CD >> 1);
    let dx = w.x[j] - ax;
    let dy = w.y[j] - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) {
      dx /= d;
      dy /= d;
    } else {
      dx = 1;
      dy = 0;
    }
    const ox = w.x[j];
    const oy = w.y[j];
    w.x[j] += dx * SHOVE_DIST;
    w.y[j] += dy * SHOVE_DIST;
    w.collide(j);
    this.shTick[j] = S;
    this.shDx[j] = w.x[j] - ox;
    this.shDy[j] = w.y[j] - oy;
    w.recordAt(j, S & (RING - 1));
    this.send({ type: 'b', a: this.idx, k: S, by: i, n, v: j, x: Math.round(w.x[j] * 4), y: Math.round(w.y[j] * 4) });
  }

  /* ---------------- snapshot ---------------- */
  snapshot(): any {
    const w = this.w;
    const S = w.tick;
    const p: number[][] = [];
    for (let i = 0; i < this.n; i++) {
      p.push([Math.round(w.x[i] * 4), Math.round(w.y[i] * 4), w.face[i], w.load[i], this.immune[i] > S ? 1 : 0]);
    }
    return {
      type: 's',
      a: this.idx,
      k: S,
      p,
      q: Array.from(this.ackQ.subarray(0, this.n)),
    };
  }

  /** điểm công bằng giữa đấu trường lớn/nhỏ: tỉ lệ so với "phần chia đều" của nguồn cung đã xuất hiện */
  rawOf(i: number): number {
    const fair = this.supply / Math.max(1, this.n);
    return fair > 0 ? Math.round((1000 * this.dep[i]) / fair) : 0;
  }
}
