// Mô hình phía client của XE TĂNG ĐẠN NẢY (không phụ thuộc DOM/React → chạy được trong bài kiểm tra).
//  - Xe của MÌNH: dự đoán ngay khi bấm phím (client-side prediction) + hoà giải (reconcile) khi server xác nhận.
//  - Xe người khác: nội suy giữa snapshot (đệm ~100ms, tự giãn khi mạng giật) + ngoại suy ngắn.
//  - Đạn: chỉ nhận SỰ KIỆN BẮN rồi tự mô phỏng (nảy tường) bằng cùng code xác định với server.

import {
  ANG_MASK,
  BK_MISSILE,
  BK_NORMAL,
  BK_PELLET,
  BK_RAPID,
  BSPEED,
  COS,
  SIN,
  BULLET_R,
  B_BOUNCED,
  B_DEAD,
  B_EXPIRED,
  CELL,
  LASER_BOUNCE,
  LASER_LEN,
  MAXB,
  MAXT,
  MAX_ITEMS,
  SPREAD_OFF,
  STEP_MS,
  TANK_R,
  TankWorld,
  WP_LASER,
  WP_MISSILE,
  WP_NONE,
  WP_RAPID,
  WP_SPREAD,
  angDiff,
  fireCap,
  fireCooldown,
  traceRay,
} from './tank.js';

export interface Fx {
  kind: 'boom' | 'bounce' | 'fire' | 'pick' | 'shield' | 'laser' | 'spark' | 'item' | 'round' | 'over' | 'sudden' | 'lost';
  i: number;
  x: number;
  y: number;
  a: number;
  v: number;
}

export interface LaserBeam {
  pts: Float64Array;
  n: number;
  born: number;
  by: number;
}

interface LogEntry {
  t: number;
  turn: number;
  move: number;
  f: number;
  q: number;
}

const PH_SIZE = 128;
const SN = 12;
const LOG_MAX = 80;

export class TankClient {
  readonly world = new TankWorld();
  readonly n: number;
  round = -1;
  fs = 0;
  t0 = 0;
  over = false;
  winner = -1;
  sudden = false;
  finished = false;
  /** kiểm thử: tắt dự đoán va chạm xe-xe */
  noPush = false;

  /** trạng thái server đã biết */
  alive = new Uint8Array(MAXT);
  shield = new Uint8Array(MAXT);
  wKind = new Uint8Array(MAXT);
  wLeft = new Int32Array(MAXT);
  score = new Int32Array(MAXT);
  kills = new Int32Array(MAXT);
  wins = new Int32Array(MAXT);
  deadX = new Float64Array(MAXT);
  deadY = new Float64Array(MAXT);
  deadA = new Int32Array(MAXT);

  /** vị trí HIỂN THỊ (đã dự đoán/nội suy) của mọi xe */
  rx = new Float64Array(MAXT);
  ry = new Float64Array(MAXT);
  ra = new Float64Array(MAXT);
  /** lần chạy frame gần nhất */
  alpha = 0;
  tickF = 0;

  /** vật phẩm trên sân */
  iKind = new Uint8Array(MAX_ITEMS);
  iCell = new Int16Array(MAX_ITEMS);
  iId = new Int32Array(MAX_ITEMS);

  /** đạn đang tạm ẩn vì nhìn thấy trúng (chờ server xác nhận) */
  bhide = new Int32Array(MAXB);
  bfn = new Int32Array(MAXB);

  fx: Fx[] = [];
  lasers: LaserBeam[] = [];
  /** gọi khi đạn của mình nhìn thấy chạm xe người khác (dùng đo "trúng nhìn thấy nhưng server bảo trượt") */
  onPredictedHit: ((n: number, victim: number) => void) | null = null;

  /* input */
  private curTurn = 0;
  private curMove = 0;
  private fireCount = 0;
  private qSeq = 0;
  private lastSentAt = -1e9;
  private log: LogEntry[] = [];
  private fireQ: { t: number; n: number }[] = [];
  private nextFireTick = 0;
  private forceSend = false;
  private lastLaserN = -1;

  /* dự đoán xe mình */
  private phx = new Float64Array(PH_SIZE);
  private phy = new Float64Array(PH_SIZE);
  private pha = new Int32Array(PH_SIZE);
  private phT = new Int32Array(PH_SIZE).fill(-1);
  private prevX = 0;
  private prevY = 0;
  private prevA = 0;
  private offX = 0;
  private offY = 0;
  private offA = 0;
  private lastFrameMs = 0;
  /** sai số hoà giải gần nhất (đo kiểm) */
  lastCorrection = 0;
  corrections = 0;
  snaps = 0;

  /* nội suy xe người khác */
  private sT = new Int32Array(MAXT * SN).fill(-1);
  private sx = new Float64Array(MAXT * SN);
  private sy = new Float64Array(MAXT * SN);
  private sa = new Int32Array(MAXT * SN);
  private sHead = new Int32Array(MAXT);
  delayTicks = 6;
  baseDelay = 6;

  /* tên lửa (server gửi vị trí trong snapshot) */
  private missileSeen = new Map<number, number>();

  constructor(
    readonly startAt: number,
    readonly arena: number,
    readonly ids: string[],
    readonly me: number,
    readonly mw: number,
    readonly mh: number,
  ) {
    this.n = ids.length;
  }

  /* ---------------- vào ---------------- */
  onMessage(p: any, nowMs: number) {
    if (!p || p.a !== this.arena) return;
    switch (p.type) {
      case 'R': this.onRound(p, nowMs); break;
      case 's': this.onSnap(p); break;
      case 'f': this.onFire(p); break;
      case 'l': this.onLaser(p); break;
      case 'x': this.onKill(p); break;
      case 'z': this.onShield(p); break;
      case 'i': this.onItem(p); break;
      case 'p': this.onPick(p); break;
      case 'o': this.onOver(p); break;
      case 'e': if (p.e === 'sd') { this.sudden = true; this.fx.push({ kind: 'sudden', i: -1, x: 0, y: 0, a: 0, v: 0 }); } break;
      case 'end': this.finished = true; break;
    }
  }

  private tickNow(nowMs: number) {
    return Math.floor((nowMs - this.startAt) / STEP_MS);
  }

  private onRound(p: any, nowMs: number) {
    const w = this.world;
    for (let i = 0; i < this.n; i++) {
      this.score[i] = p.sc?.[i] ?? 0;
      this.kills[i] = p.kl?.[i] ?? 0;
      this.wins[i] = p.wn?.[i] ?? 0;
    }
    this.syncItems(p.it);
    if (p.r === this.round) return;
    if (p.r < this.round) return;
    this.round = p.r;
    this.world.setup(p.seed, p.w, p.h, this.n);
    w.tick = this.tickNow(nowMs);
    this.t0 = p.t0;
    this.fs = p.fs;
    this.over = false;
    this.winner = -1;
    this.sudden = !!p.sd;
    this.alive.fill(0);
    this.shield.fill(0);
    this.wKind.fill(0);
    this.wLeft.fill(0);
    for (let i = 0; i < this.n; i++) {
      this.alive[i] = 1;
      this.rx[i] = w.x[i];
      this.ry[i] = w.y[i];
      this.ra[i] = w.ang[i];
    }
    this.sT.fill(-1);
    this.sHead.fill(0);
    this.tgInit.fill(0);
    this.phT.fill(-1);
    this.log.length = 0;
    this.fireQ.length = 0;
    this.nextFireTick = 0;
    this.offX = this.offY = this.offA = 0;
    this.prevX = w.x[this.me];
    this.prevY = w.y[this.me];
    this.prevA = w.ang[this.me];
    this.bhide.fill(0);
    this.lasers.length = 0;
    this.missileSeen.clear();
    this.forceSend = true;
    this.fx.push({ kind: 'round', i: this.round, x: 0, y: 0, a: 0, v: 0 });
  }

  private syncItems(it: number[][] | undefined) {
    if (!it) return;
    this.iKind.fill(0);
    let s = 0;
    for (const e of it) {
      if (s >= MAX_ITEMS) break;
      this.iId[s] = e[0];
      this.iKind[s] = e[1];
      this.iCell[s] = e[2];
      s++;
    }
  }

  private onSnap(p: any) {
    if (p.r !== this.round) return;
    const w = this.world;
    const k: number = p.k;
    this.snaps++;
    for (let i = 0; i < this.n; i++) {
      const e = p.p[i];
      if (!e) continue;
      const fl: number = e[3];
      const wasAlive = this.alive[i];
      this.alive[i] = fl & 1;
      this.shield[i] = (fl >> 1) & 1;
      this.wKind[i] = (fl >> 2) & 7;
      this.wLeft[i] = e[4];
      if (!(fl & 1) && wasAlive && i !== this.me) {
        // đã chết mà chưa thấy sự kiện (mất gói): dựng hiệu ứng nổ
        this.deadX[i] = e[0] / 4;
        this.deadY[i] = e[1] / 4;
        this.deadA[i] = e[2];
        this.fx.push({ kind: 'boom', i, x: e[0] / 4, y: e[1] / 4, a: e[2], v: -1 });
      }
      if (i === this.me) continue;
      const h = this.sHead[i];
      const o = i * SN + (h % SN);
      if (h > 0 && this.sT[i * SN + ((h - 1) % SN)] >= k) continue;
      this.sT[o] = k;
      this.sx[o] = e[0] / 4;
      this.sy[o] = e[1] / 4;
      this.sa[o] = e[2];
      this.sHead[i] = h + 1;
    }
    this.syncMissiles(p.m);
    this.reconcile(p, k);
    void w;
  }

  /** tên lửa: server gửi vị trí; client chạy tiếp giữa các gói bằng cùng bước đạn */
  private syncMissiles(list: number[][]) {
    const w = this.world;
    const seen = new Set<number>();
    for (const m of list) {
      seen.add(m[0]);
      let b = -1;
      for (let s = 0; s < MAXB; s++) if (w.bAct[s] && w.bid[s] === m[0]) { b = s; break; }
      if (b < 0) {
        b = w.freeSlot();
        if (b < 0) continue;
        w.bAct[b] = 1;
        w.bn++;
        w.bid[b] = m[0];
        w.bkind[b] = BK_MISSILE;
        w.blife[b] = 300;
        w.bdist[b] = 99;
        w.bbn[b] = 0;
        w.bbirth[b] = w.tick;
        this.bfn[b] = 0;
        this.bhide[b] = 0;
      }
      w.bown[b] = m[4];
      w.bx[b] = m[1] / 4;
      w.by[b] = m[2] / 4;
      w.bang[b] = m[3];
      w.bvx[b] = COS[m[3] & ANG_MASK] * BSPEED[BK_MISSILE];
      w.bvy[b] = SIN[m[3] & ANG_MASK] * BSPEED[BK_MISSILE];
    }
    // tên lửa đã biến mất khỏi snapshot → nổ
    for (let s = 0; s < MAXB; s++) {
      if (w.bAct[s] && w.bkind[s] === BK_MISSILE && !seen.has(w.bid[s])) {
        this.fx.push({ kind: 'spark', i: -1, x: w.bx[s], y: w.by[s], a: 0, v: 1 });
        w.kill(s);
      }
    }
  }

  /* ---------------- sự kiện ---------------- */
  private spawnFromEvent(i: number, kind: number, cnt: number, id0: number, x: number, y: number, ang: number, k: number, n: number) {
    const w = this.world;
    const T = w.tick;
    for (let c = 0; c < cnt; c++) {
      const ga = cnt === 3 ? (ang + (c - 1) * SPREAD_OFF) & ANG_MASK : ang;
      const save = w.tick;
      w.tick = k;
      const b = w.spawnBullet(i, kind, x, y, ga, id0 + c);
      w.tick = save;
      if (b < 0) continue;
      this.bfn[b] = n;
      this.bhide[b] = 0;
      for (let t = k + 1; t <= T && w.bAct[b] && t - k < 400; t++) {
        const f = w.bulletTick(b);
        if (f & (B_DEAD | B_EXPIRED)) w.kill(b);
      }
    }
  }

  private onFire(p: any) {
    const w = this.world;
    const i: number = p.i;
    const cnt = p.kd === BK_PELLET ? 3 : 1;
    this.fx.push({ kind: 'fire', i, x: p.x, y: p.y, a: p.g, v: p.kd });
    if (i === this.me) {
      // gắn id thật cho đạn đã bắn dự đoán (cùng số lần bấm n)
      let found = 0;
      for (let c = 0; c < cnt; c++) {
        const lid = localId(p.n, c);
        for (let s = 0; s < MAXB; s++) {
          if (w.bAct[s] && w.bid[s] === lid && w.bkind[s] === p.kd) {
            w.bid[s] = p.b + c;
            found++;
            break;
          }
        }
      }
      if (found === cnt) return;
      // dự đoán lệch (vd. khác loại súng): bỏ viên cục bộ, dựng theo server
      for (let s = 0; s < MAXB; s++) if (w.bAct[s] && this.bfn[s] === p.n && w.bown[s] === this.me) w.kill(s);
    }
    this.spawnFromEvent(i, p.kd, cnt, p.b, p.x, p.y, p.g, p.k, p.n);
  }

  private onLaser(p: any) {
    if (p.i === this.me && p.n === this.lastLaserN) return;
    this.addLaser(p.i, p.x, p.y, p.g);
  }

  private addLaser(by: number, x: number, y: number, g: number) {
    const pts = new Float64Array(24);
    const np = traceRay(this.world.maze, x, y, g, LASER_LEN, LASER_BOUNCE, pts);
    this.lasers.push({ pts, n: np, born: this.lastFrameMs, by });
    if (this.lasers.length > 8) this.lasers.shift();
    this.fx.push({ kind: 'laser', i: by, x, y, a: g, v: 0 });
  }

  private onKill(p: any) {
    const w = this.world;
    const v: number = p.v;
    for (let s = 0; s < MAXB; s++) if (w.bAct[s] && w.bid[s] === p.b) { w.kill(s); break; }
    if (!this.alive[v]) return;
    this.alive[v] = 0;
    this.shield[v] = 0;
    this.deadX[v] = p.x / 4;
    this.deadY[v] = p.y / 4;
    this.deadA[v] = Math.round(this.ra[v]) & ANG_MASK;
    if (v === this.me) {
      w.x[v] = p.x / 4;
      w.y[v] = p.y / 4;
      this.deadA[v] = w.ang[v];
    }
    if (p.by !== v) this.kills[p.by]++;
    this.fx.push({ kind: 'boom', i: v, x: p.x / 4, y: p.y / 4, a: this.deadA[v], v: p.by });
  }

  private onShield(p: any) {
    const w = this.world;
    for (let s = 0; s < MAXB; s++) if (w.bAct[s] && w.bid[s] === p.b) { w.kill(s); break; }
    this.shield[p.v] = 0;
    this.fx.push({ kind: 'shield', i: p.v, x: this.rx[p.v], y: this.ry[p.v], a: 0, v: 0 });
  }

  private onItem(p: any) {
    for (let s = 0; s < MAX_ITEMS; s++) {
      if (this.iKind[s] === 0) {
        this.iKind[s] = p.kd;
        this.iCell[s] = p.c;
        this.iId[s] = p.id;
        this.fx.push({ kind: 'item', i: s, x: ((p.c % this.mw) + 0.5) * CELL, y: (((p.c / this.mw) | 0) + 0.5) * CELL, a: 0, v: p.kd });
        return;
      }
    }
  }

  private onPick(p: any) {
    for (let s = 0; s < MAX_ITEMS; s++) {
      if (this.iKind[s] && this.iId[s] === p.id) {
        const c = this.iCell[s];
        this.iKind[s] = 0;
        this.fx.push({ kind: 'pick', i: p.v, x: ((c % this.mw) + 0.5) * CELL, y: (((c / this.mw) | 0) + 0.5) * CELL, a: 0, v: p.kd });
        break;
      }
    }
    if (p.v === this.me && p.kd !== 5) {
      this.wKind[p.v] = p.kd;
      this.wLeft[p.v] = p.kd === WP_RAPID ? 360 : p.kd === WP_SPREAD ? 4 : p.kd === WP_LASER ? 1 : 2;
    } else if (p.v === this.me) this.shield[p.v] = 1;
  }

  private onOver(p: any) {
    this.over = true;
    this.winner = p.w;
    for (let i = 0; i < this.n; i++) {
      this.score[i] = p.sc?.[i] ?? this.score[i];
      this.kills[i] = p.kl?.[i] ?? this.kills[i];
      this.wins[i] = p.wn?.[i] ?? this.wins[i];
    }
    const w = this.world;
    w.bAct.fill(0);
    w.bn = 0;
    this.fx.push({ kind: 'over', i: p.w, x: 0, y: 0, a: 0, v: 0 });
  }

  /* ---------------- input ---------------- */
  /** giữ phím/cần: trả gói cần gửi ngay (hoặc null). Hiệu lực ở khung hình KẾ TIẾP, không chờ mạng. */
  setKeys(turn: number, move: number, fireEdge: boolean, nowMs: number): any | null {
    if (this.round < 0) {
      this.curTurn = turn;
      this.curMove = move;
      if (fireEdge) this.fireCount++;
      return null;
    }
    const changed = turn !== this.curTurn || move !== this.curMove || fireEdge;
    if (!changed) return null;
    this.curTurn = turn;
    this.curMove = move;
    if (fireEdge) this.fireCount++;
    const t = Math.max(this.tickNow(nowMs), this.world.tick + 1);
    const q = ++this.qSeq;
    this.log.push({ t, turn, move, f: this.fireCount, q });
    if (this.log.length > LOG_MAX) this.log.shift();
    if (fireEdge) this.fireQ.push({ t, n: this.fireCount });
    this.lastSentAt = nowMs;
    return { type: 'tank', t, q, turn, move, f: this.fireCount, d: Math.round(this.delayTicks) };
  }

  /** nhắc lại ~10Hz khi đang giữ phím (chống mất gói) hoặc sau khi sang vòng mới */
  poll(nowMs: number): any | null {
    if (this.round < 0) return null;
    if (this.forceSend) {
      this.forceSend = false;
      return this.sendNow(nowMs);
    }
    const holding = this.curTurn !== 0 || this.curMove !== 0;
    if ((holding && nowMs - this.lastSentAt >= 100) || nowMs - this.lastSentAt >= 1000) return this.sendNow(nowMs);
    return null;
  }

  private sendNow(nowMs: number) {
    this.lastSentAt = nowMs;
    const t = Math.max(this.tickNow(nowMs), this.world.tick + 1);
    const q = ++this.qSeq;
    // gói nhắc lại không tạo mốc mới trong log; chỉ cần ack được q mới
    this.log.push({ t, turn: this.curTurn, move: this.curMove, f: this.fireCount, q });
    if (this.log.length > LOG_MAX) this.log.shift();
    return { type: 'tank', t, q, turn: this.curTurn, move: this.curMove, f: this.fireCount, d: Math.round(this.delayTicks) };
  }

  private heldTurn = 0;
  private heldMove = 0;
  private holdAt(tt: number) {
    const log = this.log;
    for (let e = log.length - 1; e >= 0; e--) {
      if (log[e].t <= tt) {
        this.heldTurn = log[e].turn;
        this.heldMove = log[e].move;
        return;
      }
    }
    this.heldTurn = 0;
    this.heldMove = 0;
  }

  /* ---------------- dự đoán xe mình ---------------- */
  private stepMine(tt: number) {
    const w = this.world;
    const me = this.me;
    if (tt >= this.fs && this.alive[me]) {
      this.holdAt(tt);
      w.stepTank(me, this.heldTurn, this.heldMove);
      let pushed = false;
      for (let j = 0; j < this.n; j++) {
        if (this.noPush || j === me || !this.alive[j]) continue;
        const bx = w.x[me];
        const by = w.y[me];
        w.pushFrom(me, this.rx[j], this.ry[j], 0.5);
        if (w.x[me] !== bx || w.y[me] !== by) pushed = true;
      }
      if (pushed) w.collideTank(me);
    }
    const o = tt & (PH_SIZE - 1);
    this.phx[o] = w.x[me];
    this.phy[o] = w.y[me];
    this.pha[o] = w.ang[me];
    this.phT[o] = tt;
  }

  private tryFire(tt: number, n: number) {
    const w = this.world;
    const me = this.me;
    if (tt < this.fs || !this.alive[me] || this.over) return;
    if (tt < this.nextFireTick) return;
    const wk = this.wKind[me];
    let owned = 0;
    for (let b = 0; b < MAXB; b++) if (w.bAct[b] && w.bown[b] === me) owned++;
    const need = wk === WP_SPREAD ? 3 : 1;
    if (owned + need > fireCap(wk, this.sudden)) return;
    this.nextFireTick = tt + fireCooldown(wk, this.sudden);
    const x = w.x[me];
    const y = w.y[me];
    const ang = w.ang[me];
    if (wk === WP_LASER) {
      this.lastLaserN = n;
      this.addLaser(me, x, y, ang);
      return;
    }
    if (wk === WP_MISSILE) {
      this.fx.push({ kind: 'fire', i: me, x, y, a: ang, v: BK_MISSILE });
      return;
    }
    const kind = wk === WP_RAPID || this.sudden ? BK_RAPID : wk === WP_SPREAD ? BK_PELLET : BK_NORMAL;
    const cnt = wk === WP_SPREAD ? 3 : 1;
    this.fx.push({ kind: 'fire', i: me, x, y, a: ang, v: kind });
    for (let c = 0; c < cnt; c++) {
      const ga = cnt === 3 ? (ang + (c - 1) * SPREAD_OFF) & ANG_MASK : ang;
      const b = w.spawnBullet(me, kind, x, y, ga, localId(n, c));
      if (b >= 0) {
        this.bfn[b] = n;
        this.bhide[b] = 0;
      }
    }
  }

  private reconcile(p: any, k: number) {
    const w = this.world;
    const me = this.me;
    const ack: number = p.q[me] ?? 0;
    const e = p.p[me];
    if (!e || !(e[3] & 1)) return;
    // còn input chưa được server xử lý mà có hiệu lực ≤ k → snapshot này chưa phản ánh → bỏ qua
    for (const l of this.log) if (l.q > ack && l.t <= k) return;
    if (k > w.tick) return;
    const o = k & (PH_SIZE - 1);
    const known = this.phT[o] === k && w.tick - k <= PH_SIZE - 4;
    const sx = e[0] / 4;
    const sy = e[1] / 4;
    const sa: number = e[2];
    const dx = known ? sx - this.phx[o] : 1e9;
    const dy = known ? sy - this.phy[o] : 0;
    const da = known ? angDiff(this.pha[o], sa) : 1;
    if (dx * dx + dy * dy < 0.5 * 0.5 && da === 0) return;
    const oldX = w.x[me];
    const oldY = w.y[me];
    const oldA = w.ang[me];
    w.x[me] = sx;
    w.y[me] = sy;
    w.ang[me] = sa;
    for (let tt = Math.max(k + 1, w.tick - 100); tt <= w.tick; tt++) this.stepMine(tt);
    this.lastCorrection = Math.hypot(oldX - w.x[me], oldY - w.y[me]);
    this.corrections++;
    this.offX += oldX - w.x[me];
    this.offY += oldY - w.y[me];
    this.offA += angDiff(w.ang[me], oldA);
    if (Math.hypot(this.offX, this.offY) > 60) {
      this.offX = this.offY = this.offA = 0;
    }
  }

  /* ---------------- khung hình ---------------- */
  frame(nowMs: number) {
    const w = this.world;
    if (this.round < 0) return;
    const dtS = this.lastFrameMs ? Math.min(0.1, (nowMs - this.lastFrameMs) / 1000) : 0.016;
    this.lastFrameMs = nowMs;
    const Tf = (nowMs - this.startAt) / STEP_MS;
    const T = Math.floor(Tf);
    this.alpha = Tf - T;
    this.tickF = Tf;
    if (T - w.tick > 180) w.tick = T - 180;
    while (w.tick < T) {
      const tt = w.tick + 1;
      this.prevX = w.x[this.me];
      this.prevY = w.y[this.me];
      this.prevA = w.ang[this.me];
      w.tick = tt;
      this.stepMine(tt);
      while (this.fireQ.length && this.fireQ[0].t <= tt) {
        this.tryFire(tt, this.fireQ.shift()!.n);
      }
      this.stepBullets(tt);
    }

    // xe mình: trạng thái dự đoán + ngoại suy phần lẻ tick + độ lệch hoà giải đang tan dần
    const me = this.me;
    const kOff = Math.exp(-dtS * 9);
    this.offX *= kOff;
    this.offY *= kOff;
    this.offA *= kOff;
    if (this.alive[me]) {
      const a = this.alpha;
      this.rx[me] = w.x[me] + (w.x[me] - this.prevX) * a + this.offX;
      this.ry[me] = w.y[me] + (w.y[me] - this.prevY) * a + this.offY;
      this.ra[me] = w.ang[me] + angDiff(this.prevA, w.ang[me]) * a + this.offA;
    } else {
      this.rx[me] = this.deadX[me];
      this.ry[me] = this.deadY[me];
    }
    this.interpolateOthers(Tf);
    this.smoothOthers(dtS);
    this.checkPredictedHits(T);
  }

  private stepBullets(tt: number) {
    const w = this.world;
    if (w.bn === 0) return;
    for (let b = 0; b < MAXB; b++) {
      if (!w.bAct[b] || w.bbirth[b] === tt) continue; // đạn vừa bắn ở tick này bắt đầu bay từ tick sau (như server)
      const f = w.bulletTick(b);
      if (f & B_BOUNCED && w.bkind[b] !== BK_MISSILE) this.fx.push({ kind: 'bounce', i: w.bown[b], x: w.bx[b], y: w.by[b], a: 0, v: 0 });
      if (f & (B_DEAD | B_EXPIRED)) {
        w.kill(b);
        continue;
      }
      // đạn dự đoán không được server xác nhận (bị từ chối): dọn sau 1.5s
      if (w.bid[b] < 0 && tt - w.bbirth[b] > 90) {
        w.kill(b);
      } else if (this.bhide[b] && tt - this.bhide[b] > 36) {
        this.bhide[b] = 0;
      }
    }
  }

  private checkPredictedHits(T: number) {
    const w = this.world;
    if (w.bn === 0) return;
    const rr = (TANK_R + BULLET_R) * (TANK_R + BULLET_R);
    for (let b = 0; b < MAXB; b++) {
      if (!w.bAct[b] || w.bown[b] !== this.me || this.bhide[b]) continue;
      if (w.bkind[b] === BK_MISSILE) continue;
      for (let j = 0; j < this.n; j++) {
        if (j === this.me || !this.alive[j]) continue;
        const dx = this.rx[j] - w.bx[b];
        const dy = this.ry[j] - w.by[b];
        if (dx * dx + dy * dy < rr) {
          this.bhide[b] = T || 1;
          this.fx.push({ kind: 'spark', i: j, x: w.bx[b], y: w.by[b], a: 0, v: 0 });
          this.onPredictedHit?.(this.bfn[b], j);
          break;
        }
      }
    }
  }

  private tgX = new Float64Array(MAXT);
  private tgY = new Float64Array(MAXT);
  private resX = new Float64Array(MAXT);
  private resY = new Float64Array(MAXT);
  private tgInit = new Uint8Array(MAXT);

  /** xe người khác nhảy vọt (hết nghẽn, gói tới muộn…) → không giật: giữ liên tục rồi tan dần phần chênh */
  private smoothOthers(dt: number) {
    const k = Math.exp(-dt * 12);
    for (let i = 0; i < this.n; i++) {
      if (i === this.me || !this.alive[i]) {
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
      if (!this.alive[i]) {
        this.rx[i] = this.deadX[i] || w.x[i];
        this.ry[i] = this.deadY[i] || w.y[i];
        continue;
      }
      const head = this.sHead[i];
      if (head === 0) {
        this.rx[i] = w.x[i];
        this.ry[i] = w.y[i];
        this.ra[i] = w.ang[i];
        continue;
      }
      const newest = i * SN + ((head - 1) % SN);
      const nt = this.sT[newest];
      if (rt >= nt) {
        // ngoại suy ngắn theo vận tốc 2 mẫu cuối (tối đa 9 tick)
        let x = this.sx[newest];
        let y = this.sy[newest];
        const ang = this.sa[newest];
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
        this.ra[i] = ang;
        comfy = false;
        continue;
      }
      if (nt - rt < 3) comfy = false;
      // tìm cặp mẫu bao quanh rt
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
        this.ra[i] = this.sa[hi];
        continue;
      }
      const span = this.sT[hi] - this.sT[lo];
      const u = span > 0 ? (rt - this.sT[lo]) / span : 1;
      this.rx[i] = this.sx[lo] + (this.sx[hi] - this.sx[lo]) * u;
      this.ry[i] = this.sy[lo] + (this.sy[hi] - this.sy[lo]) * u;
      this.ra[i] = this.sa[lo] + angDiff(this.sa[lo], this.sa[hi]) * u;
    }
    // đệm tự giãn khi mạng giật, co lại từ từ khi ổn định
    if (underrun) this.delayTicks = Math.min(14, this.delayTicks + 0.35);
    else if (comfy && this.delayTicks > this.baseDelay) this.delayTicks = Math.max(this.baseDelay, this.delayTicks - 0.01);
  }

  /** tick của mẫu snapshot mới nhất của xe i (đo kiểm) */
  newestTick(i: number) {
    const h = this.sHead[i];
    return h > 0 ? this.sT[i * SN + ((h - 1) % SN)] : -1;
  }

  /** số xe còn sống */
  aliveCount() {
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.alive[i]) c++;
    return c;
  }
}

/** id cục bộ (âm) của viên đạn dự đoán: tách biệt id thật của server (dương) */
export const localId = (n: number, c: number) => -(n * 4 + c + 1);

void WP_NONE;
