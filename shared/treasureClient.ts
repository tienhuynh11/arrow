// Mô hình phía client của CƯỚP KHO BÁU (không phụ thuộc DOM/React → chạy được trong bài kiểm tra).
//  - Người của MÌNH: dự đoán ngay khi bấm phím (client-side prediction) + hoà giải (reconcile) khi server xác nhận.
//  - Người khác: nội suy giữa snapshot (đệm ~100ms, tự giãn khi mạng giật) + ngoại suy ngắn.
//  - Nhặt kho báu: dự đoán (ẩn ngay viên chạm, tăng "đang mang" ngay) rồi server xác nhận; không được xác nhận thì trả lại sau ~2s.
//  - Cướp/đẩy: hiệu ứng vung tay ngay lập tức; kết quả (cướp được bao nhiêu) do server quyết (có bù trễ).

import {
  ACT_R,
  IMMUNE_TICKS,
  LOCK_TICKS,
  MAXC,
  MAXI,
  MAXP,
  MISS_CD,
  PICK_R_CLIENT,
  STEAL_CD,
  STEP_MS,
  TreasureWorld,
  faceOf,
  faceRad,
} from './treasure.js';

export interface TFx {
  kind: 'pick' | 'deliver' | 'steal' | 'swing' | 'shove' | 'drop' | 'wave' | 'go' | 'over';
  /** ghế liên quan */
  i: number;
  x: number;
  y: number;
  /** phụ: số lượng, ghế thứ hai... */
  v: number;
}

interface LogEntry {
  t: number;
  dx: number;
  dy: number;
  q: number;
  /** gói nhắc lại (không đổi hướng) */
  hb?: boolean;
}

const PH_SIZE = 128;
const SN = 12;
const LOG_MAX = 80;
const PEND_MAX = 16;

export class TreasureClient {
  readonly world = new TreasureWorld();
  readonly n: number;
  fs = 1e9;
  t0 = 0;
  endT = 1e9;
  over = false;
  finished = false;
  synced = false;
  private inited = false;

  /** điểm nộp / số lần cướp (server) */
  score = new Int32Array(MAXP);
  steals = new Int32Array(MAXP);
  /** số kho báu đang mang theo server (người mình = sload + số viên nhặt dự đoán chưa được xác nhận) */
  sload = new Int32Array(MAXP);
  immune = new Uint8Array(MAXP);
  /** lượng đang mang bị mất khi hết giờ (hiện ở màn kết thúc) */
  lostAtEnd = new Int32Array(MAXP);

  /** vị trí HIỂN THỊ (đã dự đoán/nội suy) của mọi người */
  rx = new Float64Array(MAXP);
  ry = new Float64Array(MAXP);
  rface = new Int8Array(MAXP);
  /** hướng đang giữ phím của mình (dx, dy) */
  tickF = 0;
  alpha = 0;

  /** kho báu trên sân */
  iAct = new Uint8Array(MAXI);
  ix = new Float64Array(MAXI);
  iy = new Float64Array(MAXI);
  iid = new Int32Array(MAXI);
  /** tick bắt đầu bị ẩn do nhặt dự đoán (0 = hiện) */
  ihide = new Int32Array(MAXI);

  fx: TFx[] = [];
  /** thông báo gần nhất liên quan tới MÌNH (HUD đọc ~8Hz theo seq) */
  note: { kind: 'robbed' | 'stole' | 'deliver' | 'shoved'; n: number; seq: number; at: number } = { kind: 'deliver', n: 0, seq: 0, at: 0 };
  private notify(kind: 'robbed' | 'stole' | 'deliver' | 'shoved', n: number) {
    this.note = { kind, n, seq: this.note.seq + 1, at: this.tickF };
  }

  /* input */
  private curDx = 0;
  private curDy = 0;
  private actCount = 0;
  private qSeq = 0;
  private lastSentAt = -1e9;
  private log: LogEntry[] = [];
  private forceSend = false;
  nextActTick = 0;
  private lockUntil = 0;

  /* nhặt dự đoán */
  private pendId = new Int32Array(PEND_MAX);
  private pendTick = new Int32Array(PEND_MAX);
  private pendN = 0;

  /* dự đoán người mình */
  private phx = new Float64Array(PH_SIZE);
  private phy = new Float64Array(PH_SIZE);
  private phT = new Int32Array(PH_SIZE).fill(-1);
  private prevX = 0;
  private prevY = 0;
  private offX = 0;
  private offY = 0;
  private lastFrameMs = 0;
  /** sai số hoà giải gần nhất (đo kiểm) */
  lastCorrection = 0;
  corrections = 0;
  snaps = 0;

  /* nội suy người khác */
  private sT = new Int32Array(MAXP * SN).fill(-1);
  private sx = new Float64Array(MAXP * SN);
  private sy = new Float64Array(MAXP * SN);
  private sHead = new Int32Array(MAXP);
  delayTicks = 6;
  baseDelay = 6;
  private tgX = new Float64Array(MAXP);
  private tgY = new Float64Array(MAXP);
  private resX = new Float64Array(MAXP);
  private resY = new Float64Array(MAXP);
  private tgInit = new Uint8Array(MAXP);

  constructor(
    readonly startAt: number,
    readonly arena: number,
    readonly ids: string[],
    readonly me: number,
    readonly W: number,
    readonly H: number,
  ) {
    this.n = ids.length;
    this.world.setup(this.n, W, H);
    for (let i = 0; i < this.n; i++) {
      this.rx[i] = this.world.x[i];
      this.ry[i] = this.world.y[i];
      this.rface[i] = this.world.face[i];
    }
    this.prevX = this.world.x[me];
    this.prevY = this.world.y[me];
  }

  /* ---------------- vào ---------------- */
  onMessage(p: any, nowMs: number) {
    if (!p || p.a !== this.arena) return;
    switch (p.type) {
      case 'W': this.onSync(p); break;
      case 's': this.onSnap(p); break;
      case 'c': this.onWave(p); break;
      case 'p': this.onPick(p); break;
      case 'd': this.onDeliver(p); break;
      case 'h': this.onSteal(p); break;
      case 'b': this.onShove(p); break;
      case 'o': this.onOver(p); break;
      case 'end': this.finished = true; break;
    }
    void nowMs;
  }

  tickNow(nowMs: number) {
    return Math.floor((nowMs - this.startAt) / STEP_MS);
  }

  private findItem(id: number) {
    for (let s = 0; s < MAXI; s++) if (this.iAct[s] && this.iid[s] === id) return s;
    return -1;
  }
  private addItem(id: number, x: number, y: number) {
    if (this.findItem(id) >= 0) return;
    for (let s = 0; s < MAXI; s++) {
      if (!this.iAct[s]) {
        this.iAct[s] = 1;
        this.iid[s] = id;
        this.ix[s] = x;
        this.iy[s] = y;
        this.ihide[s] = 0;
        return;
      }
    }
  }
  private removeItem(id: number) {
    const s = this.findItem(id);
    if (s >= 0) this.iAct[s] = 0;
    return s;
  }
  private dropPend(id: number) {
    for (let q = 0; q < this.pendN; q++) {
      if (this.pendId[q] === id) {
        this.pendN--;
        this.pendId[q] = this.pendId[this.pendN];
        this.pendTick[q] = this.pendTick[this.pendN];
        return true;
      }
    }
    return false;
  }
  private syncMyLoad() {
    this.world.load[this.me] = Math.min(MAXC, this.sload[this.me] + this.pendN);
  }

  private onSync(p: any) {
    this.t0 = p.t0;
    this.fs = p.fs;
    this.endT = p.endT;
    this.synced = true;
    const seen = new Set<number>();
    const it: number[] = p.it;
    for (let q = 0; q + 2 < it.length; q += 3) {
      seen.add(it[q]);
      this.addItem(it[q], it[q + 1], it[q + 2]);
    }
    for (let s = 0; s < MAXI; s++) if (this.iAct[s] && !seen.has(this.iid[s])) this.iAct[s] = 0;
    for (let i = 0; i < this.n; i++) {
      this.score[i] = p.sc?.[i] ?? this.score[i];
      this.steals[i] = p.st?.[i] ?? this.steals[i];
    }
  }

  private onWave(p: any) {
    const it: number[] = p.it;
    let cx = 0;
    let cy = 0;
    for (let q = 0; q + 2 < it.length; q += 3) {
      this.addItem(it[q], it[q + 1], it[q + 2]);
      cx += it[q + 1];
      cy += it[q + 2];
    }
    const cnt = it.length / 3;
    if (cnt > 0) this.fx.push({ kind: 'wave', i: -1, x: cx / cnt, y: cy / cnt, v: cnt });
  }

  private onPick(p: any) {
    const v: number = p.v;
    const ids: number[] = p.ids;
    let sx = 0;
    let sy = 0;
    let got = 0;
    for (const id of ids) {
      const s = this.removeItem(id);
      if (s >= 0) {
        sx = this.ix[s];
        sy = this.iy[s];
        got++;
      }
      // một viên mình đã nhặt dự đoán: server xác nhận (v = mình) hoặc người khác nhanh hơn (mình mất viên đó)
      this.dropPend(id);
    }
    this.sload[v] = p.ld;
    if (v === this.me) this.syncMyLoad();
    else {
      this.world.load[v] = p.ld;
      if (got > 0) this.fx.push({ kind: 'pick', i: v, x: sx, y: sy, v: got });
    }
  }

  private onDeliver(p: any) {
    const v: number = p.v;
    this.score[v] = p.sc;
    this.sload[v] = 0;
    if (v === this.me) {
      this.syncMyLoad();
      this.notify('deliver', p.n);
    } else this.world.load[v] = 0;
    const w = this.world;
    this.fx.push({ kind: 'deliver', i: v, x: w.bx[v], y: w.by[v], v: p.n });
  }

  private onSteal(p: any) {
    const v: number = p.v;
    const by: number = p.by;
    if (v === this.me) this.notify('robbed', this.sload[v] - p.lv);
    if (by === this.me) this.notify('stole', p.g);
    this.sload[v] = p.lv;
    this.sload[by] = p.lb;
    this.steals[by]++;
    this.immune[v] = 1;
    if (v === this.me) {
      this.lockUntil = this.world.tick + LOCK_TICKS;
      this.syncMyLoad();
    } else this.world.load[v] = p.lv;
    if (by === this.me) {
      this.lockUntil = this.world.tick + 18;
      this.nextActTick = Math.max(this.nextActTick, this.world.tick + STEAL_CD - 8);
      this.syncMyLoad();
    } else this.world.load[by] = p.lb;
    const it: number[] = p.it;
    for (let q = 0; q + 2 < it.length; q += 3) this.addItem(it[q], it[q + 1], it[q + 2]);
    this.fx.push({ kind: 'steal', i: v, x: p.x / 4, y: p.y / 4, v: by });
    if (it.length) this.fx.push({ kind: 'drop', i: v, x: p.x / 4, y: p.y / 4, v: it.length / 3 });
  }

  private onShove(p: any) {
    if (p.v < 0) {
      if (p.by !== this.me) this.fx.push({ kind: 'swing', i: p.by, x: 0, y: 0, v: 0 });
      return;
    }
    this.fx.push({ kind: 'shove', i: p.v, x: p.x / 4, y: p.y / 4, v: p.by });
    if (p.v === this.me) this.notify('shoved', 0);
    if (p.by === this.me) this.nextActTick = Math.max(this.nextActTick, this.world.tick + (STEAL_CD >> 1) - 8);
  }

  private onOver(p: any) {
    this.over = true;
    for (let i = 0; i < this.n; i++) {
      this.score[i] = p.sc?.[i] ?? this.score[i];
      this.steals[i] = p.st?.[i] ?? this.steals[i];
      this.lostAtEnd[i] = p.lost?.[i] ?? 0;
      this.sload[i] = 0;
      this.world.load[i] = 0;
    }
    this.pendN = 0;
    this.iAct.fill(0);
    this.fx.push({ kind: 'over', i: -1, x: 0, y: 0, v: 0 });
  }

  private onSnap(p: any) {
    const k: number = p.k;
    this.snaps++;
    const w = this.world;
    for (let i = 0; i < this.n; i++) {
      const e = p.p[i];
      if (!e) continue;
      this.sload[i] = e[3];
      this.immune[i] = e[4];
      w.face[i] = e[2];
      if (i === this.me) continue;
      w.load[i] = e[3];
      const h = this.sHead[i];
      const o = i * SN + (h % SN);
      if (h > 0 && this.sT[i * SN + ((h - 1) % SN)] >= k) continue;
      this.sT[o] = k;
      this.sx[o] = e[0] / 4;
      this.sy[o] = e[1] / 4;
      this.rface[i] = e[2];
      this.sHead[i] = h + 1;
    }
    if (!this.over) this.syncMyLoad();
    this.reconcile(p, k);
  }

  /* ---------------- input ---------------- */
  /** đổi hướng chạy / bấm cướp: trả gói cần gửi ngay (hoặc null). Hiệu lực ở khung hình KẾ TIẾP, không chờ mạng. */
  setKeys(dx: number, dy: number, actEdge: boolean, nowMs: number): any | null {
    const changed = dx !== this.curDx || dy !== this.curDy || actEdge;
    if (!changed) return null;
    this.curDx = dx;
    this.curDy = dy;
    if (actEdge) {
      this.actCount++;
      this.localSwing();
    }
    if (!this.inited) return null;
    const t = Math.max(this.tickNow(nowMs), this.world.tick + 1);
    const q = ++this.qSeq;
    this.log.push({ t, dx, dy, q });
    if (this.log.length > LOG_MAX) this.log.shift();
    this.lastSentAt = nowMs;
    return { type: 'trs', t, q, dx, dy, a: this.actCount, d: Math.round(this.delayTicks) };
  }

  /** vung tay ngay (dự đoán): chỉ khi đã hết hồi chiêu và đang trong giờ chơi */
  private localSwing() {
    const w = this.world;
    const T = w.tick;
    if (T < this.fs || T >= this.endT || this.over || T < this.nextActTick) return;
    this.nextActTick = T + MISS_CD;
    this.fx.push({ kind: 'swing', i: this.me, x: w.x[this.me], y: w.y[this.me], v: 0 });
  }

  /** nhắc lại ~10Hz khi đang giữ phím (chống mất gói) */
  poll(nowMs: number): any | null {
    if (!this.inited) return null;
    if (this.forceSend) {
      this.forceSend = false;
      return this.sendNow(nowMs);
    }
    const holding = this.curDx !== 0 || this.curDy !== 0;
    if ((holding && nowMs - this.lastSentAt >= 100) || nowMs - this.lastSentAt >= 1000) return this.sendNow(nowMs);
    return null;
  }

  private sendNow(nowMs: number) {
    this.lastSentAt = nowMs;
    const t = Math.max(this.tickNow(nowMs), this.world.tick + 1);
    const q = ++this.qSeq;
    this.log.push({ t, dx: this.curDx, dy: this.curDy, q, hb: true });
    if (this.log.length > LOG_MAX) this.log.shift();
    return { type: 'trs', t, q, dx: this.curDx, dy: this.curDy, a: this.actCount, d: Math.round(this.delayTicks) };
  }

  private hDx = 0;
  private hDy = 0;
  private holdAt(tt: number) {
    const log = this.log;
    for (let e = log.length - 1; e >= 0; e--) {
      if (log[e].t <= tt) {
        this.hDx = log[e].dx;
        this.hDy = log[e].dy;
        return;
      }
    }
    this.hDx = 0;
    this.hDy = 0;
  }

  /* ---------------- dự đoán người mình ---------------- */
  private stepMine(tt: number) {
    const w = this.world;
    const me = this.me;
    if (tt >= this.fs && tt < this.endT && !this.over) {
      this.holdAt(tt);
      w.step(me, this.hDx, this.hDy);
    }
    const o = tt & (PH_SIZE - 1);
    this.phx[o] = w.x[me];
    this.phy[o] = w.y[me];
    this.phT[o] = tt;
  }

  /** nhặt dự đoán: chạm là ẩn ngay + tăng số đang mang (server xác nhận sau) */
  private predictPickups(T: number) {
    const w = this.world;
    const me = this.me;
    if (T < this.fs || this.over || T < this.lockUntil) return;
    // quá hạn không được xác nhận → trả lại kho báu
    for (let q = this.pendN - 1; q >= 0; q--) {
      if (T - this.pendTick[q] > 120) {
        const s = this.findItem(this.pendId[q]);
        if (s >= 0) this.ihide[s] = 0;
        this.pendN--;
        this.pendId[q] = this.pendId[this.pendN];
        this.pendTick[q] = this.pendTick[this.pendN];
      }
    }
    if (w.load[me] >= MAXC) return;
    const rr = PICK_R_CLIENT * PICK_R_CLIENT;
    const px = w.x[me];
    const py = w.y[me];
    for (let s = 0; s < MAXI && w.load[me] < MAXC && this.pendN < PEND_MAX; s++) {
      if (!this.iAct[s] || this.ihide[s]) continue;
      const dx = this.ix[s] - px;
      const dy = this.iy[s] - py;
      if (dx * dx + dy * dy >= rr) continue;
      this.ihide[s] = T || 1;
      this.pendId[this.pendN] = this.iid[s];
      this.pendTick[this.pendN] = T;
      this.pendN++;
      w.load[me]++;
      this.fx.push({ kind: 'pick', i: me, x: this.ix[s], y: this.iy[s], v: 1 });
    }
  }

  private deferred: any = null;

  private reconcile(p: any, k: number) {
    const w = this.world;
    const me = this.me;
    if (!this.inited) return;
    const ack: number = p.q[me] ?? 0;
    const e = p.p[me];
    if (!e) return;
    // còn input chưa được server xử lý mà có hiệu lực ≤ k → snapshot này chưa phản ánh → bỏ qua
    for (const l of this.log) if (l.q > ack && l.t <= k && !l.hb) return;
    if (k > w.tick) {
      // snapshot mới hơn tick đã chạy của client (mạng rất nhanh): hoãn tới khung hình sau
      this.deferred = p;
      return;
    }
    const o = k & (PH_SIZE - 1);
    const known = this.phT[o] === k && w.tick - k <= PH_SIZE - 4;
    const sx = e[0] / 4;
    const sy = e[1] / 4;
    const dx = known ? sx - this.phx[o] : 1e9;
    const dy = known ? sy - this.phy[o] : 0;
    if (dx * dx + dy * dy < 0.5 * 0.5) return;
    const oldX = w.x[me];
    const oldY = w.y[me];
    w.x[me] = sx;
    w.y[me] = sy;
    for (let tt = Math.max(k + 1, w.tick - 100); tt <= w.tick; tt++) this.stepMine(tt);
    this.lastCorrection = Math.hypot(oldX - w.x[me], oldY - w.y[me]);
    this.corrections++;
    this.offX += oldX - w.x[me];
    this.offY += oldY - w.y[me];
    if (Math.hypot(this.offX, this.offY) > 80) {
      this.offX = this.offY = 0;
    }
  }

  /* ---------------- khung hình ---------------- */
  frame(nowMs: number) {
    const w = this.world;
    const dtS = this.lastFrameMs ? Math.min(0.1, (nowMs - this.lastFrameMs) / 1000) : 0.016;
    this.lastFrameMs = nowMs;
    const Tf = (nowMs - this.startAt) / STEP_MS;
    const T = Math.floor(Tf);
    this.alpha = Tf - T;
    this.tickF = Tf;
    if (!this.inited) {
      this.inited = true;
      w.tick = T;
      this.forceSend = true;
    }
    if (T - w.tick > 180) w.tick = T - 180;
    while (w.tick < T) {
      const tt = w.tick + 1;
      this.prevX = w.x[this.me];
      this.prevY = w.y[this.me];
      w.tick = tt;
      this.stepMine(tt);
    }
    if (this.deferred) {
      const d = this.deferred;
      this.deferred = null;
      this.reconcile(d, d.k);
    }
    this.predictPickups(T);

    // người mình: trạng thái dự đoán + ngoại suy phần lẻ tick + độ lệch hoà giải đang tan dần
    const me = this.me;
    const kOff = Math.exp(-dtS * 9);
    this.offX *= kOff;
    this.offY *= kOff;
    const a = this.alpha;
    this.rx[me] = w.x[me] + (w.x[me] - this.prevX) * a + this.offX;
    this.ry[me] = w.y[me] + (w.y[me] - this.prevY) * a + this.offY;
    // hướng nhìn của mình theo phím đang giữ (tức thì)
    if (this.curDx !== 0 || this.curDy !== 0) this.rface[me] = faceOf(this.curDx, this.curDy);
    else this.rface[me] = w.face[me];
    this.interpolateOthers(Tf);
    this.smoothOthers(dtS);
  }

  /** người khác nhảy vọt (hết nghẽn, bị đẩy…) → không giật: giữ liên tục rồi tan dần phần chênh */
  private smoothOthers(dt: number) {
    const k = Math.exp(-dt * 12);
    for (let i = 0; i < this.n; i++) {
      if (i === this.me) {
        this.tgInit[i] = 0;
        continue;
      }
      const x = this.rx[i];
      const y = this.ry[i];
      if (this.tgInit[i]) {
        const jx = x - this.tgX[i];
        const jy = y - this.tgY[i];
        if (jx * jx + jy * jy > 64) {
          this.resX[i] -= jx;
          this.resY[i] -= jy;
        }
      } else {
        this.resX[i] = 0;
        this.resY[i] = 0;
      }
      this.tgX[i] = x;
      this.tgY[i] = y;
      this.tgInit[i] = 1;
      this.resX[i] *= k;
      this.resY[i] *= k;
      this.rx[i] = x + this.resX[i];
      this.ry[i] = y + this.resY[i];
    }
  }

  private interpolateOthers(Tf: number) {
    const w = this.world;
    const rt = Tf - this.delayTicks;
    let underrun = false;
    let comfy = true;
    for (let i = 0; i < this.n; i++) {
      if (i === this.me) continue;
      const head = this.sHead[i];
      if (head === 0) {
        this.rx[i] = w.x[i];
        this.ry[i] = w.y[i];
        continue;
      }
      const newest = i * SN + ((head - 1) % SN);
      const nt = this.sT[newest];
      if (rt >= nt) {
        // ngoại suy ngắn theo vận tốc 2 mẫu cuối (tối đa 9 tick)
        let x = this.sx[newest];
        let y = this.sy[newest];
        if (head > 1) {
          const prev = i * SN + ((head - 2) % SN);
          const dt = nt - this.sT[prev];
          if (dt > 0 && dt <= 12) {
            const ex = Math.min(rt - nt, 9);
            x += ((x - this.sx[prev]) / dt) * ex;
            y += ((y - this.sy[prev]) / dt) * ex;
          }
        }
        if (rt - nt > 1) underrun = true;
        this.rx[i] = x;
        this.ry[i] = y;
        comfy = false;
        continue;
      }
      if (nt - rt < 3) comfy = false;
      let lo = -1;
      let hi = newest;
      for (let s = 1; s < Math.min(head, SN); s++) {
        const idx = i * SN + ((head - 1 - s) % SN);
        if (this.sT[idx] < 0) break;
        if (this.sT[idx] <= rt) {
          lo = idx;
          break;
        }
        hi = idx;
      }
      if (lo < 0) {
        this.rx[i] = this.sx[hi];
        this.ry[i] = this.sy[hi];
        continue;
      }
      const span = this.sT[hi] - this.sT[lo];
      const u = span > 0 ? (rt - this.sT[lo]) / span : 1;
      this.rx[i] = this.sx[lo] + (this.sx[hi] - this.sx[lo]) * u;
      this.ry[i] = this.sy[lo] + (this.sy[hi] - this.sy[lo]) * u;
    }
    // đệm tự giãn khi mạng giật, co lại từ từ khi ổn định
    if (underrun) this.delayTicks = Math.min(14, this.delayTicks + 0.35);
    else if (comfy && this.delayTicks > this.baseDelay) this.delayTicks = Math.max(this.baseDelay, this.delayTicks - 0.01);
  }

  /** tick của mẫu snapshot mới nhất của người i (đo kiểm) */
  newestTick(i: number) {
    const h = this.sHead[i];
    return h > 0 ? this.sT[i * SN + ((h - 1) % SN)] : -1;
  }

  /** pha: 0 = đếm ngược, 1 = đang chơi, 2 = hết giờ */
  phase(): number {
    if (this.over || this.tickF >= this.endT) return 2;
    return this.tickF < this.fs ? 0 : 1;
  }

  /** phần hồi chiêu còn lại 0..1 (cho nút bấm) */
  cooldownFrac(): number {
    const left = this.nextActTick - this.world.tick;
    return left <= 0 ? 0 : Math.min(1, left / STEAL_CD);
  }
}

void ACT_R;
void IMMUNE_TICKS;
void faceRad;
