/**
 * Lõi phía CLIENT của XÌ HƠI CÙNG NHAU: dự đoán + rollback + hoà trộn sai số.
 * Không đụng DOM/React/three để chạy được cả trong test (tsx).
 *
 * - Mỗi khung hình: tick = floor((giờ server ước lượng - startAt)/STEP); mô phỏng bè TỚI tick đó (chỉ 1 vật thể, rất rẻ).
 * - Xì của mình: áp NGAY vào mô phỏng ở tick hiện tại (khung hình kế tiếp là thấy bè đổi vận tốc).
 * - Sự kiện của đồng đội/server xác nhận: chèn đúng tick -> rollback -> mô phỏng lại; sai khác được hoà trộn trong ~125ms.
 * - Trạng thái CUỐI CÙNG từ server (~10Hz) là mốc: lệch dự đoán thì thay mốc + mô phỏng lại.
 */
import {
  CHARGE_TIME,
  MAX_BACK,
  MIN_GAP,
  NS,
  P_MIN,
  RaftSim,
  SEAT_ORDER,
  SEAT_X,
  SEAT_Y,
  STEP_MS,
  S_A,
  S_FIN,
  S_HITS,
  S_HITV,
  S_HP,
  S_PROG,
  S_SINK,
  S_X,
  S_Y,
  clamp,
  gasCost,
  gasLimitP,
  gasRegen,
  genCourse,
  wrapPi,
  type Course,
} from './raft.js';
import type { GameInput } from './protocol.js';

export interface FartFx {
  kind: 'fart' | 'hit' | 'sink' | 'respawn' | 'fin' | 'empty';
  seat: number;
  /** tick xảy ra sự kiện (xì: tick áp dụng) */
  tick: number;
  a: number;
  p: number;
  mine: boolean;
  v?: number;
}

export interface GhostSample {
  /** thời điểm server (ms) của mẫu */
  at: number;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  prog: number;
  hp: number;
  st: number;
}

interface Pending {
  n: number;
  tick: number;
  p: number;
  acked: boolean;
}

export interface FartConfig {
  seed: number;
  teams: string[][];
  cap: number;
}

export class FartCore {
  readonly c: Course;
  readonly sim: RaftSim;
  readonly teamN: number;
  readonly myTeam: number;
  readonly mySeat: number;
  readonly nTeams: number;

  /* thời gian */
  private lead = NaN;
  private lastMono = NaN;
  tnow = 0;
  tick = 0;
  frac = 0;
  /** server ms ước lượng của khung hình hiện tại */
  serverMs = 0;

  /* pose hiển thị (đã nội suy + hoà trộn) */
  px = 0;
  py = 0;
  pa = 0;
  private ex = 0;
  private ey = 0;
  private ea = 0;
  /** pose ở tick trước (để dựng ảnh nội suy cho teammate...) */
  private tmp = new Float64Array(NS);
  private tmp2 = new Float64Array(NS);

  /* điều khiển */
  gas = 1;
  gt = 0;
  private nextN = 1;
  private lastOwnTick = -99;
  charging = false;
  private chargeT0 = 0;
  /** 0..1 lực đang tích (đã giới hạn theo khí) */
  charge = 0;
  aimWorld = Math.PI;
  aimRel = Math.PI;
  aimMode: 'key' | 'mouse' | 'world' = 'key';
  private mouseX = 0;
  private mouseY = 0;
  private keyDir = 0;
  private lastAimSent = -1e9;
  private sentAim = 99;
  private sentC = -1;
  private pend: Pending[] = [];

  /* đồng đội */
  readonly aimA = [Math.PI, Math.PI, Math.PI, Math.PI];
  readonly aimC = [0, 0, 0, 0];

  /* sự kiện cho cảnh/âm thanh */
  fx: FartFx[] = [];
  private seenHits = 0;
  private wasSink = false;
  private lastSinkFx = -1e9;

  /* các bè khác */
  readonly ghosts: GhostSample[][];
  readonly finOrder: number[] = [];
  readonly finTick: number[];

  constructor(
    config: FartConfig,
    meId: string,
    readonly startAt: number,
    private readonly sendInput: (i: GameInput) => void,
  ) {
    this.c = genCourse(config.seed);
    this.nTeams = config.teams.length;
    this.myTeam = Math.max(0, config.teams.findIndex((t) => t.includes(meId)));
    const team = config.teams[this.myTeam] ?? [];
    this.mySeat = Math.max(0, team.indexOf(meId));
    this.teamN = team.length;
    this.sim = new RaftSim(this.c, SEAT_ORDER[Math.min(4, Math.max(1, this.teamN))], 64, 96);
    this.ghosts = config.teams.map(() => []);
    this.finTick = config.teams.map(() => -1);
    this.px = this.sim.S[S_X];
    this.py = this.sim.S[S_Y];
    this.pa = this.sim.S[S_A];
  }

  /* ---------------- thời gian ---------------- */
  private clock(mono: number, serverNow: number): void {
    const target = serverNow - mono;
    if (Number.isNaN(this.lead) || Math.abs(target - this.lead) > 250) this.lead = target;
    else this.lead += clamp(target - this.lead, -0.35, 0.35);
    this.tnow = mono + this.lead;
    this.serverMs = this.tnow;
  }

  /* ---------------- hoà trộn ---------------- */
  private capture(a: Float64Array, b: Float64Array): void {
    this.sim.stateAt(this.sim.cur - 1, a) || a.set(this.sim.S);
    b.set(this.sim.S);
  }

  /** thực hiện một thay đổi lên mô phỏng và hoà trộn sai khác thay vì nhảy */
  private mutate(fn: () => boolean): boolean {
    const sim = this.sim;
    const cur0 = sim.cur;
    const A = this.tmp;
    const B = this.tmp2;
    this.capture(A, B);
    const p0x = A[S_X], p0y = A[S_Y], p0a = A[S_A], s0x = B[S_X], s0y = B[S_Y], s0a = B[S_A];
    const changed = fn();
    if (!changed || sim.cur !== cur0) return changed;
    this.capture(A, B);
    const f = this.frac;
    this.ex += (1 - f) * (p0x - A[S_X]) + f * (s0x - B[S_X]);
    this.ey += (1 - f) * (p0y - A[S_Y]) + f * (s0y - B[S_Y]);
    this.ea += (1 - f) * wrapPi(p0a - A[S_A]) + f * wrapPi(s0a - B[S_A]);
    if (Math.hypot(this.ex, this.ey) > 8) this.ex = this.ey = this.ea = 0;
    return changed;
  }

  /* ---------------- khung hình ---------------- */
  frame(mono: number, serverNow: number): void {
    this.clock(mono, serverNow);
    const dt = Number.isNaN(this.lastMono) ? 0.016 : Math.min(0.1, (mono - this.lastMono) / 1000);
    this.lastMono = mono;
    const tf = Math.max(0, (this.tnow - this.startAt) / STEP_MS);
    this.tick = Math.floor(tf);
    this.frac = tf - this.tick;
    const sim = this.sim;
    sim.advanceTo(this.tick);
    sim.prune(sim.baseTick - 1);

    // hiển thị = nội suy giữa tick trước và tick hiện tại + sai số đang tan dần
    const A = this.tmp;
    const B = this.tmp2;
    this.capture(A, B);
    // bè dịch chuyển tức thời (hồi sinh ở cột mốc) thì không nội suy xuyên qua khoảng nhảy
    const f = Math.hypot(B[S_X] - A[S_X], B[S_Y] - A[S_Y]) > 4 ? 1 : this.frac;
    this.px = A[S_X] + (B[S_X] - A[S_X]) * f + this.ex;
    this.py = A[S_Y] + (B[S_Y] - A[S_Y]) * f + this.ey;
    this.pa = A[S_A] + wrapPi(B[S_A] - A[S_A]) * f + this.ea;
    const k = Math.exp(-dt * 8);
    this.ex *= k;
    this.ey *= k;
    this.ea *= k;

    // hướng ngắm
    if (this.keyDir) this.aimRel = wrapPi(this.aimRel + this.keyDir * 2.8 * dt);
    if (this.aimMode === 'key') this.aimWorld = wrapPi(this.pa + this.aimRel);
    else if (this.aimMode === 'mouse') {
      const sx = this.seatX(this.mySeat);
      const sy = this.seatY(this.mySeat);
      this.aimWorld = Math.atan2(this.mouseY - sy, this.mouseX - sx);
      this.aimRel = wrapPi(this.aimWorld - this.pa);
    } else this.aimRel = wrapPi(this.aimWorld - this.pa);

    // lực đang tích
    if (this.charging) {
      const want = Math.min(1, (mono - this.chargeT0) / (CHARGE_TIME * 1000));
      this.charge = Math.min(want, gasLimitP(this.gasNow()) / 100);
    } else this.charge = 0;

    // sự kiện từ trạng thái (va chạm, chìm, hồi sinh)
    const S = sim.S;
    if (S[S_HITS] > this.seenHits) {
      this.seenHits = S[S_HITS];
      this.fx.push({ kind: 'hit', seat: -1, tick: this.tick, a: 0, p: 0, mine: false, v: S[S_HITV] });
    }
    const sk = S[S_SINK] > 0;
    if (sk && !this.wasSink && mono - this.lastSinkFx > 2500) {
      this.lastSinkFx = mono;
      this.fx.push({ kind: 'sink', seat: -1, tick: this.tick, a: 0, p: 0, mine: false });
    } else if (!sk && this.wasSink && mono - this.lastSinkFx > 800) this.fx.push({ kind: 'respawn', seat: -1, tick: this.tick, a: 0, p: 0, mine: false });
    this.wasSink = sk;

    // gửi hướng ngắm cho đồng đội (~15Hz, chỉ khi đổi)
    if (this.teamN > 1 && mono - this.lastAimSent >= 66) {
      const c100 = Math.round(this.charge * 100);
      if (Math.abs(wrapPi(this.aimWorld - this.sentAim)) > 0.03 || Math.abs(c100 - this.sentC) >= 6) {
        this.lastAimSent = mono;
        this.sentAim = this.aimWorld;
        this.sentC = c100;
        this.sendInput({ type: 'faim', a: Math.round(this.aimWorld * 1000), c: c100 });
      }
    }
  }

  /* ---------------- vị trí chỗ ngồi (theo pose hiển thị) ---------------- */
  seatX(seat: number): number {
    const slot = this.sim.slots[seat] ?? 0;
    return this.px + Math.cos(this.pa) * SEAT_X[slot] - Math.sin(this.pa) * SEAT_Y[slot];
  }
  seatY(seat: number): number {
    const slot = this.sim.slots[seat] ?? 0;
    return this.py + Math.sin(this.pa) * SEAT_X[slot] + Math.cos(this.pa) * SEAT_Y[slot];
  }

  /* ---------------- điều khiển ---------------- */
  gasNow(): number {
    return gasRegen(this.gas, this.tick - this.gt);
  }

  setMouse(wx: number, wy: number): void {
    this.mouseX = wx;
    this.mouseY = wy;
    this.aimMode = 'mouse';
  }
  setAimWorld(a: number): void {
    this.aimWorld = a;
    this.aimMode = 'world';
  }
  turn(dir: number): void {
    if (dir !== 0 && this.aimMode !== 'key') {
      this.aimRel = wrapPi(this.aimWorld - this.pa);
      this.aimMode = 'key';
    }
    this.keyDir = dir;
  }
  press(mono: number): void {
    if (this.charging) return;
    this.charging = true;
    this.chargeT0 = mono;
  }
  /** thả nút: xì. Trả về lực đã xì (0..100) hoặc 0 nếu không xì được */
  release(): number {
    if (!this.charging) return 0;
    this.charging = false;
    return this.fire(this.charge, this.aimWorld);
  }
  cancel(): void {
    this.charging = false;
    this.charge = 0;
  }

  /** xì NGAY: áp vào mô phỏng ở tick hiện tại + gửi server */
  fire(power01: number, worldAngle: number): number {
    const tick = this.tick;
    if (tick < 0 || tick < this.lastOwnTick + MIN_GAP) return 0;
    const g = gasRegen(this.gas, tick - this.gt);
    const pi = Math.min(Math.round(power01 * 100), gasLimitP(g));
    if (pi < P_MIN) {
      if (power01 * 100 >= P_MIN) this.fx.push({ kind: 'empty', seat: this.mySeat, tick, a: 0, p: 0, mine: true });
      return 0;
    }
    const ai = clamp(Math.round(wrapPi(worldAngle) * 1000), -3142, 3142);
    const n = this.nextN++;
    this.gas = g - gasCost(pi);
    this.gt = tick;
    this.lastOwnTick = tick;
    this.pend.push({ n, tick, p: pi, acked: false });
    if (this.pend.length > 24) this.pend.shift();
    this.mutate(() => this.sim.setEvent(tick, this.mySeat, ai, pi, n));
    this.fx.push({ kind: 'fart', seat: this.mySeat, tick, a: ai / 1000, p: pi / 100, mine: true });
    this.sendInput({ type: 'fart', t: tick, a: ai, p: pi, n });
    return pi;
  }

  /* ---------------- tin nhắn từ server ---------------- */
  onMessage(m: any): void {
    switch (m.k) {
      case 's': {
        if (m.ti !== this.myTeam) return;
        this.mutate(() => this.sim.setBase(m.t, m.v));
        // sự kiện của mình chưa được xác nhận mà đã nằm trước mốc cuối cùng => server không nhận (mất gói)
        for (let i = this.pend.length - 1; i >= 0; i--) {
          const p = this.pend[i];
          if (!p.acked && p.tick < m.t) {
            this.pend.splice(i, 1);
            this.mutate(() => this.sim.removeEvent(this.mySeat, p.n));
          }
        }
        break;
      }
      case 'f': {
        if (m.ti !== this.myTeam) return;
        const known = this.sim.hasEvent(m.s, m.n);
        if (m.s === this.mySeat) {
          const p = this.pend.find((q) => q.n === m.n);
          if (p) {
            p.acked = true;
            p.tick = m.t;
          }
          if (!this.pend.some((q) => !q.acked)) {
            this.gas = m.g / 100;
            this.gt = m.t;
          }
          this.mutate(() => this.sim.setEvent(m.t, m.s, m.a, m.p, m.n));
          if (!p && !known) this.fx.push({ kind: 'fart', seat: m.s, tick: m.t, a: m.a / 1000, p: m.p / 100, mine: true });
        } else {
          this.mutate(() => this.sim.setEvent(m.t, m.s, m.a, m.p, m.n));
          if (!known) this.fx.push({ kind: 'fart', seat: m.s, tick: m.t, a: m.a / 1000, p: m.p / 100, mine: false });
        }
        break;
      }
      case 'x': {
        const i = this.pend.findIndex((q) => q.n === m.n);
        if (i >= 0) {
          const p = this.pend[i];
          this.pend.splice(i, 1);
          this.gas = Math.min(1, this.gas + gasCost(p.p));
          this.mutate(() => this.sim.removeEvent(this.mySeat, m.n));
        }
        break;
      }
      case 'a': {
        if (m.ti !== this.myTeam) return;
        for (const [s, a, c] of m.v) {
          if (s !== this.mySeat) {
            this.aimA[s] = a / 1000;
            this.aimC[s] = c / 100;
          }
        }
        break;
      }
      case 'g': {
        const at = this.startAt + m.t * STEP_MS;
        for (let ti = 0; ti < m.v.length; ti++) {
          const v = m.v[ti];
          const arr = this.ghosts[ti];
          if (!arr) continue;
          arr.push({ at, x: v[0], y: v[1], a: v[2], vx: v[3], vy: v[4], prog: v[5], hp: v[6], st: v[7] });
          if (arr.length > 6) arr.shift();
        }
        break;
      }
      case 'fin': {
        this.finTick[m.ti] = m.t;
        this.finOrder.push(m.ti);
        this.fx.push({ kind: 'fin', seat: m.ti, tick: m.t, a: 0, p: 0, mine: m.ti === this.myTeam, v: m.r });
        break;
      }
    }
  }

  /** pose của bè khác ở server-time `at` (nội suy giữa 2 mẫu; vượt mẫu cuối thì ngoại suy nhẹ) */
  ghostPose(ti: number, at: number, out: Float64Array): boolean {
    const arr = this.ghosts[ti];
    if (!arr || arr.length === 0) return false;
    let a = arr[0];
    let b = arr[arr.length - 1];
    for (let i = arr.length - 1; i > 0; i--) {
      if (arr[i - 1].at <= at) {
        a = arr[i - 1];
        b = arr[i];
        break;
      }
    }
    if (arr.length === 1 || at <= a.at) {
      out[0] = a.x;
      out[1] = a.y;
      out[2] = a.a;
      return true;
    }
    if (at >= b.at && a === arr[arr.length - 2] && b === arr[arr.length - 1]) {
      const dt = Math.min(0.4, (at - b.at) / 1000);
      out[0] = b.x + b.vx * dt;
      out[1] = b.y + b.vy * dt;
      out[2] = b.a;
      return true;
    }
    const u = clamp((at - a.at) / Math.max(1, b.at - a.at), 0, 1);
    out[0] = a.x + (b.x - a.x) * u;
    out[1] = a.y + (b.y - a.y) * u;
    out[2] = a.a + wrapPi(b.a - a.a) * u;
    return true;
  }

  /** tiến độ (quãng đường) của một bè */
  progOf(ti: number): number {
    if (ti === this.myTeam) return this.sim.S[S_PROG];
    const arr = this.ghosts[ti];
    return arr && arr.length ? arr[arr.length - 1].prog : 0;
  }

  /** hạng (1-based) của bè mình theo tiến độ */
  myRank(): number {
    let r = 1;
    const mine = this.sim.S[S_FIN] > 0 ? 1e9 - this.sim.S[S_FIN] : this.sim.S[S_PROG];
    for (let ti = 0; ti < this.nTeams; ti++) {
      if (ti === this.myTeam) continue;
      const fin = this.finTick[ti] >= 0;
      const other = fin ? 1e9 - this.finTick[ti] : this.progOf(ti);
      if (other > mine) r++;
    }
    return r;
  }

  get hp(): number {
    return this.sim.S[S_HP];
  }
  get maxBack(): number {
    return MAX_BACK;
  }
}
