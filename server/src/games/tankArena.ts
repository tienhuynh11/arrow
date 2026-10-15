import {
  ANG_MASK,
  BK_MISSILE,
  BK_NORMAL,
  BK_PELLET,
  BK_RAPID,
  BULLET_R,
  B_DEAD,
  B_EXPIRED,
  COUNT_TICKS,
  ITEM_R,
  IMMUNE_DIST,
  LASER_BOUNCE,
  LASER_LEN,
  LC_MAX,
  MOVE_REWIND_MAX,
  MAXB,
  MAXT,
  MAX_ITEMS,
  OVER_TICKS,
  PK_AMOUNT,
  PK_SHIELD,
  RING,
  ROUND_TICKS,
  SHIELD_TICKS,
  SPREAD_OFF,
  SUDDEN_TICKS,
  TANK_R,
  CELL,
  TankWorld,
  WP_LASER,
  WP_MISSILE,
  WP_NONE,
  WP_RAPID,
  WP_SPREAD,
  fireCap,
  fireCooldown,
  mazeDims,
  segDist2,
  traceRay,
} from '../../../shared/tank.js';

/**
 * Một ĐẤU TRƯỜNG xe tăng: 2-6 xe, mê cung riêng. Toàn bộ trạng thái nằm trong typed array cố định,
 * vòng bước (stepTick) không cấp phát object.
 *
 * Mạng: input mang tick của client; server TUA LẠI riêng xe đó từ tick ấy (vòng đệm RING) nên quỹ đạo
 * trùng khớp bit-for-bit với bản dự đoán ở client. Đạn bắn trễ được mô phỏng bù từ tick bắn
 * và đối chiếu vị trí xe LỊCH SỬ (lag compensation, tối đa LC_MAX tick = 250ms).
 */
export interface ArenaOpts {
  lagComp: boolean;
  /** kiểm thử: tắt đẩy nhau giữa xe */
  noPush: boolean;
  /** kiểm thử: đạn không giết (để so quỹ đạo dài) */
  noKill: boolean;
  noItems: boolean;
  /** kiểm thử: ghi nhận trúng (sự kiện x) nhưng xe không chết → đo thống kê dài */
  immortal?: boolean;
  /**
   * Bù trễ "theo màn hình người bắn": người bắn thấy xe khác chậm ~viewDelay tick (đệm nội suy),
   * nên đạn được đối chiếu với vị trí xe đích tại (tick đạn − viewDelay). Chỉ có tác dụng khi lagComp.
   */
  viewDelay: number;
}

export const DEFAULT_OPTS: ArenaOpts = { lagComp: true, noPush: false, noKill: false, noItems: false, viewDelay: 6 };

const ITEM_WEIGHTS = [0, 3, 3, 2, 2, 3];
const ITEM_BAG: number[] = [];
for (let k = 1; k <= 5; k++) for (let c = 0; c < ITEM_WEIGHTS[k]; c++) ITEM_BAG.push(k);

export const PH_COUNT = 0;
export const PH_FIGHT = 1;
export const PH_OVER = 2;
export const PH_DONE = 3;

export class Arena {
  readonly w = new TankWorld();
  readonly n: number;
  readonly mw: number;
  readonly mh: number;

  round = -1;
  phase = PH_DONE;
  seed = 0;
  t0 = 0;
  fs = 0;
  decidedAt = 0;
  winner = -1;
  sudden = false;
  nextBid = 1;
  nextItemAt = 0;

  heldTurn = new Int8Array(MAXT);
  heldMove = new Int8Array(MAXT);
  lastT = new Int32Array(MAXT);
  fireCnt = new Int32Array(MAXT);
  ackQ = new Int32Array(MAXT);
  nextFire = new Int32Array(MAXT);
  wKind = new Uint8Array(MAXT);
  wLeft = new Int32Array(MAXT);
  shield = new Int32Array(MAXT);
  deathTick = new Int32Array(MAXT).fill(-1);
  /** độ trễ nội suy người chơi đang thấy (tick); -1 = chưa biết → dùng opts.viewDelay */
  viewD = new Int8Array(MAXT).fill(-1);

  kills = new Int32Array(MAXT);
  wins = new Int32Array(MAXT);
  pts = new Float64Array(MAXT);
  roundsPlayed = 0;

  iKind = new Uint8Array(MAX_ITEMS);
  iCell = new Int16Array(MAX_ITEMS);
  iId = new Int32Array(MAX_ITEMS);
  private ray = new Float64Array(24);
  private rankTmp = new Float64Array(MAXT);

  constructor(
    readonly idx: number,
    readonly ids: string[],
    private send: (payload: any) => void,
    readonly opts: ArenaOpts = DEFAULT_OPTS,
  ) {
    this.n = ids.length;
    [this.mw, this.mh] = mazeDims(this.n);
  }

  /* ---------------- vòng đấu ---------------- */
  startRound() {
    const w = this.w;
    this.round++;
    this.seed = (Math.random() * 4294967296) >>> 0;
    w.setup(this.seed, this.mw, this.mh, this.n);
    this.t0 = w.tick;
    this.fs = w.tick + COUNT_TICKS;
    this.phase = PH_COUNT;
    this.winner = -1;
    this.sudden = false;
    this.iKind.fill(0);
    this.nextItemAt = this.fs + 300 + Math.floor(Math.random() * 200);
    for (let i = 0; i < this.n; i++) {
      this.heldTurn[i] = 0;
      this.heldMove[i] = 0;
      this.lastT[i] = 0;
      this.nextFire[i] = 0;
      this.wKind[i] = WP_NONE;
      this.wLeft[i] = 0;
      this.shield[i] = 0;
      this.deathTick[i] = -1;
    }
    this.sendRound();
  }

  sendRound() {
    const it: number[][] = [];
    for (let k = 0; k < MAX_ITEMS; k++) if (this.iKind[k]) it.push([this.iId[k], this.iKind[k], this.iCell[k]]);
    this.send({
      type: 'R',
      a: this.idx,
      r: this.round,
      seed: this.seed,
      w: this.mw,
      h: this.mh,
      t0: this.t0,
      fs: this.fs,
      ph: this.phase,
      sd: this.sudden ? 1 : 0,
      sc: Array.from(this.pts.subarray(0, this.n), Math.round),
      kl: Array.from(this.kills.subarray(0, this.n)),
      wn: Array.from(this.wins.subarray(0, this.n)),
      it,
    });
  }

  finish() {
    this.phase = PH_DONE;
  }

  advance(T: number) {
    while (this.w.tick < T) this.stepTick();
  }

  private alive(): number {
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.w.alive[i]) c++;
    return c;
  }

  stepTick() {
    const w = this.w;
    const k = ++w.tick;
    if (this.phase === PH_COUNT && k >= this.fs) this.phase = PH_FIGHT;
    const moving = this.phase === PH_FIGHT || this.phase === PH_OVER;
    if (moving) {
      for (let i = 0; i < this.n; i++) if (w.alive[i]) w.stepTank(i, this.heldTurn[i], this.heldMove[i]);
      if (!this.opts.noPush) this.pushPairs();
    }
    for (let i = 0; i < this.n; i++) w.record(i);
    if (this.phase !== PH_FIGHT) return;

    if (!this.sudden && k - this.fs >= SUDDEN_TICKS) {
      this.sudden = true;
      this.send({ type: 'e', a: this.idx, k, e: 'sd' });
    }
    for (let i = 0; i < this.n; i++) {
      if (!w.alive[i]) continue;
      if (this.wKind[i] === WP_RAPID && --this.wLeft[i] <= 0) this.wKind[i] = WP_NONE;
      if (this.shield[i] && k >= this.shield[i]) this.shield[i] = 0;
    }
    if (!this.opts.noItems) this.stepItems(k);
    if (w.bn > 0) {
      for (let b = 0; b < MAXB; b++) {
        if (!w.bAct[b]) continue;
        this.stepOneBullet(b, k);
      }
    }
    if (this.phase === PH_FIGHT) {
      if (this.alive() <= 1) this.decide(k);
      else if (k - this.fs >= ROUND_TICKS) this.decide(k);
    }
  }

  /** đạn b đi một tick tới tick k rồi xét trúng xe (vị trí lịch sử tại k) */
  private stepOneBullet(b: number, k: number) {
    const w = this.w;
    if (w.bkind[b] === BK_MISSILE) this.steer(b, k);
    const f = w.bulletTick(b);
    if (f & (B_DEAD | B_EXPIRED)) {
      w.kill(b);
      return;
    }
    if (this.opts.noKill) return;
    const t = this.hitTank(b, k);
    if (t >= 0) this.onHit(b, t, k);
  }

  private steer(b: number, k: number) {
    const w = this.w;
    const o = w.bown[b];
    let best = -1;
    let bd = 1e18;
    for (let i = 0; i < this.n; i++) {
      if (i === o || !this.aliveAt(i, k)) continue;
      const h = i * RING + (k & (RING - 1));
      const dx = w.hx[h] - w.bx[b];
      const dy = w.hy[h] - w.by[b];
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (best >= 0) w.steerMissile(b, w.hx[best], w.hy[best]);
  }

  /** số tick xe đích bị lùi lại khi đối chiếu đạn của người bắn s (bù trễ theo màn hình người bắn) */
  private vdOf(s: number) {
    if (!this.opts.lagComp) return 0;
    const d = this.viewD[s];
    return d >= 0 && this.opts.viewDelay > 0 ? d : this.opts.viewDelay;
  }

  aliveAt(i: number, k: number) {
    const d = this.deathTick[i];
    return d < 0 || d > k;
  }

  private hitTank(b: number, k: number): number {
    const w = this.w;
    const own = w.bown[b];
    const bx = w.bx[b];
    const by = w.by[b];
    const rr = (TANK_R + BULLET_R) * (TANK_R + BULLET_R);
    const vd = this.vdOf(own);
    for (let i = 0; i < this.n; i++) {
      const kv = i === own ? k : k - vd;
      if (!this.aliveAt(i, kv)) continue;
      if (i === own && w.bdist[b] < IMMUNE_DIST) continue;
      const h = i * RING + (kv & (RING - 1));
      const dx = w.hx[h] - bx;
      const dy = w.hy[h] - by;
      if (dx * dx + dy * dy < rr) return i;
    }
    return -1;
  }

  private onHit(b: number, i: number, k: number) {
    const w = this.w;
    const id = w.bid[b];
    const own = w.bown[b];
    w.kill(b);
    this.strike(i, own, k, id, w.bkind[b]);
  }

  /** xe i bị trúng (đạn id của xe own) tại tick k: khiên hấp thụ hoặc nổ */
  private strike(i: number, own: number, k: number, id: number, kind: number) {
    const w = this.w;
    if (this.shield[i]) {
      this.shield[i] = 0;
      this.send({ type: 'z', a: this.idx, k, v: i, b: id });
      return;
    }
    if (this.opts.immortal) {
      this.send({ type: 'x', a: this.idx, k, v: i, by: own, b: id, kd: kind, x: Math.round(w.x[i] * 4), y: Math.round(w.y[i] * 4) });
      return;
    }
    w.alive[i] = 0;
    this.deathTick[i] = k;
    const kp = this.opts.lagComp && i !== own ? k - this.vdOf(own) : k;
    if (kp < w.tick) {
      // trúng ở quá khứ (bù trễ): xác xe nằm đúng chỗ lúc bị trúng
      const h = i * RING + (kp & (RING - 1));
      w.x[i] = w.hx[h];
      w.y[i] = w.hy[h];
      w.ang[i] = w.ha[h];
      for (let t = kp + 1; t <= w.tick; t++) w.recordAt(i, t & (RING - 1));
    }
    if (own !== i) this.kills[own]++;
    this.send({ type: 'x', a: this.idx, k, v: i, by: own, b: id, kd: kind, x: Math.round(w.x[i] * 4), y: Math.round(w.y[i] * 4) });
  }

  private pushPairs() {
    const w = this.w;
    const min = TANK_R * 2;
    for (let i = 0; i < this.n; i++) {
      if (!w.alive[i]) continue;
      for (let j = i + 1; j < this.n; j++) {
        if (!w.alive[j]) continue;
        const dx = w.x[j] - w.x[i];
        const dy = w.y[j] - w.y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const f = ((min - d) * 0.5) / d;
        w.x[i] -= dx * f;
        w.y[i] -= dy * f;
        w.x[j] += dx * f;
        w.y[j] += dy * f;
        w.collideTank(i);
        w.collideTank(j);
      }
    }
  }

  /* ---------------- vật phẩm ---------------- */
  private stepItems(k: number) {
    const w = this.w;
    if (k >= this.nextItemAt) {
      let free = -1;
      let cnt = 0;
      for (let s = 0; s < MAX_ITEMS; s++) {
        if (this.iKind[s]) cnt++;
        else if (free < 0) free = s;
      }
      this.nextItemAt = k + 360 + Math.floor(Math.random() * 300);
      if (free >= 0 && cnt < 2) {
        const cell = Math.floor(Math.random() * this.mw * this.mh);
        let taken = false;
        for (let s = 0; s < MAX_ITEMS; s++) if (this.iKind[s] && this.iCell[s] === cell) taken = true;
        if (!taken) {
          const kind = ITEM_BAG[Math.floor(Math.random() * ITEM_BAG.length)];
          this.iKind[free] = kind;
          this.iCell[free] = cell;
          this.iId[free] = this.nextBid++;
          this.send({ type: 'i', a: this.idx, k, id: this.iId[free], kd: kind, c: cell });
        }
      }
    }
    for (let s = 0; s < MAX_ITEMS; s++) {
      if (!this.iKind[s]) continue;
      const ix = ((this.iCell[s] % this.mw) + 0.5) * CELL;
      const iy = (((this.iCell[s] / this.mw) | 0) + 0.5) * CELL;
      for (let i = 0; i < this.n; i++) {
        if (!w.alive[i]) continue;
        const dx = w.x[i] - ix;
        const dy = w.y[i] - iy;
        if (dx * dx + dy * dy > (ITEM_R + TANK_R) * (ITEM_R + TANK_R)) continue;
        const kind = this.iKind[s];
        if (kind === PK_SHIELD) this.shield[i] = k + SHIELD_TICKS;
        else {
          this.wKind[i] = kind;
          this.wLeft[i] = PK_AMOUNT[kind];
        }
        this.send({ type: 'p', a: this.idx, k, id: this.iId[s], v: i, kd: kind });
        this.iKind[s] = 0;
        break;
      }
    }
  }

  /* ---------------- kết thúc vòng ---------------- */
  private decide(k: number) {
    const w = this.w;
    this.phase = PH_OVER;
    this.decidedAt = k;
    this.roundsPlayed++;
    let winner = -1;
    let aliveN = 0;
    for (let i = 0; i < this.n; i++) if (w.alive[i]) { aliveN++; winner = i; }
    if (aliveN !== 1) winner = -1;
    this.winner = winner;
    if (winner >= 0) this.wins[winner]++;
    this.addRoundPoints();
    w.bAct.fill(0);
    w.bn = 0;
    this.send({
      type: 'o',
      a: this.idx,
      r: this.round,
      k,
      w: winner,
      sc: Array.from(this.pts.subarray(0, this.n), Math.round),
      kl: Array.from(this.kills.subarray(0, this.n)),
      wn: Array.from(this.wins.subarray(0, this.n)),
    });
  }

  /** điểm hạng trong vòng: 1000 · (n − hạng)/(n − 1), đồng hạng chia trung bình → công bằng giữa trường 2 và 6 xe */
  private addRoundPoints() {
    const n = this.n;
    const dt = this.rankTmp;
    for (let i = 0; i < n; i++) dt[i] = this.w.alive[i] ? 1e9 : this.deathTick[i];
    for (let i = 0; i < n; i++) {
      let better = 0;
      let ties = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        if (dt[j] > dt[i]) better++;
        else if (dt[j] === dt[i]) ties++;
      }
      const rank = 1 + better + ties / 2;
      this.pts[i] += (1000 * (n - rank)) / (n - 1);
    }
  }

  /** điểm tạm của vòng đang dở (hết giờ ván giữa chừng) */
  provisional(out: Float64Array) {
    const n = this.n;
    for (let i = 0; i < n; i++) out[i] = this.pts[i];
    if (this.phase !== PH_FIGHT && this.phase !== PH_COUNT) return;
    if (this.phase === PH_COUNT) return;
    const save = this.pts.slice();
    this.addRoundPoints();
    for (let i = 0; i < n; i++) out[i] = this.pts[i];
    this.pts.set(save);
  }

  /* ---------------- input / bắn ---------------- */
  applyInput(i: number, t: number, q: number, turn: number, move: number, f: number, d = -1) {
    const w = this.w;
    if (i < 0 || i >= this.n) return;
    const S = w.tick;
    if (q >= this.ackQ[i]) this.ackQ[i] = q;
    if (d >= 0) this.viewD[i] = d > 12 ? 12 : d;
    if (!w.alive[i]) return;
    const lo = Math.max(S - MOVE_REWIND_MAX, this.fs);
    const loFire = Math.max(S - LC_MAX, this.fs);
    let eff = t < lo ? lo : t;
    if (eff < this.lastT[i]) eff = this.lastT[i];
    if (!this.opts.lagComp || eff > S + 1) eff = S + 1;
    if (eff > this.lastT[i]) this.lastT[i] = eff;
    if (turn !== this.heldTurn[i] || move !== this.heldMove[i]) {
      this.heldTurn[i] = turn;
      this.heldMove[i] = move;
      if (eff <= S && S >= this.fs) {
        w.restore(i, eff - 1);
        for (let tt = eff; tt <= S; tt++) {
          w.stepTank(i, turn, move);
          w.recordAt(i, tt & (RING - 1));
        }
      }
    }
    if (f > this.fireCnt[i]) {
      this.fireCnt[i] = f;
      let fk = this.opts.lagComp ? (t < loFire ? loFire : t) : S;
      if (fk > S) fk = S;
      this.fire(i, fk);
    }
  }

  private ownedBullets(i: number) {
    const w = this.w;
    let c = 0;
    for (let b = 0; b < MAXB; b++) if (w.bAct[b] && w.bown[b] === i) c++;
    return c;
  }

  private fire(i: number, kk: number) {
    const w = this.w;
    if (this.phase !== PH_FIGHT || !w.alive[i] || kk < this.fs) return;
    if (kk < this.nextFire[i]) return;
    const wk = this.wKind[i];
    const need = wk === WP_SPREAD ? 3 : 1;
    if (this.ownedBullets(i) + need > fireCap(wk, this.sudden)) return;
    this.nextFire[i] = kk + fireCooldown(wk, this.sudden);
    const h = i * RING + (kk & (RING - 1));
    const x = w.hx[h];
    const y = w.hy[h];
    const ang = w.ha[h];
    const n = this.fireCnt[i];
    const live = this.opts.lagComp ? w.tick : kk;

    if (wk === WP_LASER) {
      this.fireLaser(i, kk, x, y, ang, n);
    } else {
      const kind = wk === WP_RAPID || this.sudden ? BK_RAPID : wk === WP_SPREAD ? BK_PELLET : wk === WP_MISSILE ? BK_MISSILE : BK_NORMAL;
      const id0 = this.nextBid;
      const cnt = wk === WP_SPREAD ? 3 : 1;
      this.nextBid += cnt;
      this.send({
        type: 'f',
        a: this.idx,
        k: kk,
        i,
        n,
        kd: kind,
        b: id0,
        x,
        y,
        g: ang,
      });
      const saveTick = w.tick;
      for (let c = 0; c < cnt; c++) {
        const ga = cnt === 3 ? (ang + (c - 1) * SPREAD_OFF) & ANG_MASK : ang;
        w.tick = kk;
        const b = w.spawnBullet(i, kind, x, y, ga, id0 + c);
        w.tick = saveTick;
        if (b < 0) continue;
        // bù trễ: chạy bù từ kk+1 tới tick hiện tại, đối chiếu vị trí xe lịch sử
        for (let tt = kk + 1; tt <= live && w.bAct[b]; tt++) this.stepOneBullet(b, tt);
      }
    }
    if (wk === WP_SPREAD || wk === WP_LASER || wk === WP_MISSILE) {
      if (--this.wLeft[i] <= 0) this.wKind[i] = WP_NONE;
    }
    // bắn ở quá khứ có thể đã hạ người cuối cùng
    if (this.phase === PH_FIGHT && this.alive() <= 1) this.decide(w.tick);
  }

  private fireLaser(i: number, kk: number, x: number, y: number, ang: number, n: number) {
    const w = this.w;
    const np = traceRay(w.maze, x, y, ang, LASER_LEN, LASER_BOUNCE, this.ray);
    const hits: number[] = [];
    const rr = (TANK_R + 1.5) * (TANK_R + 1.5);
    const vd = this.vdOf(i);
    for (let j = 0; j < this.n; j++) {
      const kv = j === i ? kk : kk - vd;
      if (!this.aliveAt(j, kv)) continue;
      const h = j * RING + (kv & (RING - 1));
      for (let s = 0; s + 1 < np; s++) {
        if (j === i && s === 0) continue;
        if (segDist2(this.ray[s * 2], this.ray[s * 2 + 1], this.ray[s * 2 + 2], this.ray[s * 2 + 3], w.hx[h], w.hy[h]) < rr) {
          hits.push(j);
          break;
        }
      }
    }
    this.send({ type: 'l', a: this.idx, k: kk, i, n, x, y, g: ang });
    if (this.opts.noKill) return;
    const id = this.nextBid++;
    for (const j of hits) this.strike(j, i, kk, id, 4);
  }

  /* ---------------- snapshot ---------------- */
  snapshot(): any {
    const w = this.w;
    const p: number[][] = [];
    for (let i = 0; i < this.n; i++) {
      const fl = (w.alive[i] ? 1 : 0) | (this.shield[i] ? 2 : 0) | (this.wKind[i] << 2);
      p.push([Math.round(w.x[i] * 4), Math.round(w.y[i] * 4), w.ang[i], fl, this.wLeft[i]]);
    }
    const m: number[][] = [];
    if (w.bn > 0) {
      for (let b = 0; b < MAXB; b++) {
        if (w.bAct[b] && w.bkind[b] === BK_MISSILE) m.push([w.bid[b], Math.round(w.bx[b] * 4), Math.round(w.by[b] * 4), w.bang[b], w.bown[b]]);
      }
    }
    return {
      type: 's',
      a: this.idx,
      r: this.round,
      k: w.tick,
      p,
      q: Array.from(this.ackQ.subarray(0, this.n)),
      m,
    };
  }
}
