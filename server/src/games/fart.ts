import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  GAS_BASE,
  MAX_BACK,
  MIN_GAP,
  NS,
  P_MIN,
  SEAT_ORDER,
  STEP_MS,
  S_FIN,
  S_HITS,
  S_HP,
  S_PROG,
  S_SINK,
  S_VX,
  S_VY,
  S_X,
  S_Y,
  S_A,
  RaftSim,
  clamp,
  gasCost,
  gasLimitP,
  gasRegen,
  genCourse,
  teamSizes,
  wrapPi,
  type Course,
} from '../../../shared/raft.js';

/**
 * XÌ HƠI CÙNG NHAU (id fart) - 2-4 người điều khiển MỘT chiếc bè bằng sức đẩy của những cú xì.
 *
 * Mạng: server là trọng tài, mô phỏng bè xác định (shared/raft.ts) tới tick hiện tại;
 * sự kiện xì mang tick của client -> tua lại (rollback, ≤ 14 tick ≈ 233ms) rồi mô phỏng lại.
 * Chỉ phát: sự kiện xì đã chốt (cho cả bè), trạng thái CUỐI CÙNG của bè ~10Hz (cho bè đó), trạng thái nhẹ các bè ~6.7Hz, hướng ngắm ~10Hz.
 * Bộ nhớ mỗi bè: vài KB (vòng đệm cố định), khóa học dùng chung. Không cấp phát mới trong vòng bước.
 */
interface Config {
  seed: number;
  teams: string[][];
  cap: number;
}

interface SeatSt {
  id: string;
  gas: number;
  /** tick của lần cập nhật khí */
  gt: number;
  last: number;
  lastN: number;
  aimA: number;
  aimC: number;
  aimDirty: boolean;
  aimAt: number;
}

interface Team {
  sim: RaftSim;
  seats: SeatSt[];
  finFinal: boolean;
  finTick: number;
  finAt: number;
  sinks: number;
  wasSink: boolean;
}

interface State {
  course: Course;
  teams: Team[];
  of: Record<string, { ti: number; seat: number }>;
  maxTick: number;
  lastSnap: number;
  lastGhost: number;
  lastAim: number;
  firstFinAt: number;
  fins: number;
  scored: boolean;
}

const DURATION = 215_000;
const FIN_GRACE = 20_000;
const SNAP_MS = 100;
const GHOST_MS = 150;
const AIM_MS = 100;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

function rankTeams(st: State): number[] {
  const idx = st.teams.map((_, i) => i);
  const key = (t: Team) => {
    const f = t.sim.S[S_FIN];
    return f > 0 ? [0, f] : [1, -t.sim.S[S_PROG]];
  };
  idx.sort((a, b) => {
    const ka = key(st.teams[a]);
    const kb = key(st.teams[b]);
    return ka[0] - kb[0] || ka[1] - kb[1] || a - b;
  });
  return idx;
}

export const fartGame: GameDefinition<Config, State> = {
  id: 'fart',
  name: 'XÌ HƠI CÙNG NHAU',
  instructions:
    'Cả bè chung một chiếc bè trên sông: mỗi cú xì đẩy bè NGƯỢC hướng bạn xì, nên phải phối hợp cùng hướng, cùng lúc để né đá, cổng, khúc gỗ và xoáy nước. Va mạnh làm hỏng bè, hết độ bền bè chìm và hồi sinh ở cột mốc. Bè nào về đích đầu tiên thắng!',
  controls: [
    { keys: ['CHUỘT'], desc: 'Rê chuột để chọn hướng xì (mũi tên xanh trên bè)' },
    { keys: ['A', 'D'], desc: 'hoặc ← → xoay hướng xì' },
    { keys: ['SPACE'], desc: 'Giữ để tích lực, THẢ để xì (cũng dùng được chuột trái)' },
    { keys: ['KHÍ'], desc: 'Thanh khí hao khi xì và hồi dần, xì cùng nhau mới đúng nhịp' },
  ],
  duration: DURATION + 3000,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const ids = shuffle([...ctx.playerIds]);
    const sizes = teamSizes(ids.length);
    const teams: string[][] = [];
    let at = 0;
    for (const sz of sizes) {
      teams.push(ids.slice(at, at + sz));
      at += sz;
    }
    return { seed: 1 + Math.floor(Math.random() * 2_000_000_000), teams, cap: DURATION };
  },

  createState(ctx, config) {
    const course = genCourse(config.seed);
    const of: Record<string, { ti: number; seat: number }> = {};
    const teams = config.teams.map((ids, ti) => {
      const sim = new RaftSim(course, SEAT_ORDER[Math.min(4, ids.length)], 16, 40);
      ids.forEach((id, seat) => (of[id] = { ti, seat }));
      const t: Team = {
        sim,
        seats: ids.map((id) => ({ id, gas: 1, gt: 0, last: -99, lastN: -1, aimA: 0, aimC: 0, aimDirty: false, aimAt: 0 })),
        finFinal: false,
        finTick: -1,
        finAt: 0,
        sinks: 0,
        wasSink: false,
      };
      return t;
    });
    return {
      course,
      teams,
      of,
      maxTick: Math.floor(DURATION / STEP_MS),
      lastSnap: 0,
      lastGhost: 0,
      lastAim: 0,
      firstFinAt: 0,
      fins: 0,
      scored: false,
    };
  },

  handleInput(ctx, st, _config, playerId, input: GameInput) {
    if (input.type !== 'fart' && input.type !== 'faim') return;
    const me = st.of[playerId];
    if (!me || st.scored) return;
    const now = ctx.now();
    if (now < ctx.startAt) return;
    const team = st.teams[me.ti];
    const seat = team.seats[me.seat];

    if (input.type === 'faim') {
      if (now - seat.aimAt < 45) return;
      const a = Number(input.a);
      if (!Number.isFinite(a)) return;
      seat.aimAt = now;
      seat.aimA = clamp(Math.round(wrapPi(a / 1000) * 1000), -3142, 3142);
      seat.aimC = clamp(Math.round(Number(input.c) || 0), 0, 100);
      seat.aimDirty = true;
      return;
    }

    const cur = Math.min(st.maxTick, Math.floor((now - ctx.startAt) / STEP_MS));
    const sim = team.sim;
    sim.advanceTo(cur);
    const n = Number.isFinite(input.n) ? Math.floor(input.n as number) : seat.lastN + 1;
    const reject = () => ctx.send(playerId, { k: 'x', n });
    const t0 = Number(input.t);
    const a0 = Number(input.a);
    const p0 = Number(input.p);
    if (!Number.isFinite(t0) || !Number.isFinite(a0) || !Number.isFinite(p0) || n <= seat.lastN || n > 1e9) return reject();
    // tick: không quá cũ (rollback tối đa MAX_BACK), không ở tương lai, mỗi người cách nhau ≥ MIN_GAP tick
    let tick = clamp(Math.floor(t0), cur - MAX_BACK, cur);
    if (tick < seat.last + MIN_GAP) tick = seat.last + MIN_GAP;
    if (tick > cur) return reject();
    const ai = clamp(Math.round(wrapPi(a0 / 1000) * 1000), -3142, 3142);
    let pi = clamp(Math.round(p0), 0, 100);
    const g = gasRegen(seat.gas, tick - seat.gt);
    pi = Math.min(pi, gasLimitP(g));
    if (pi < P_MIN) return reject();
    seat.gas = g - gasCost(pi);
    seat.gt = tick;
    seat.last = tick;
    seat.lastN = n;
    sim.setEvent(tick, me.seat, ai, pi, n);
    const msg = { k: 'f', ti: me.ti, s: me.seat, n, t: tick, a: ai, p: pi, g: Math.round(seat.gas * 100) };
    for (const s of team.seats) ctx.send(s.id, msg);
  },

  update(ctx, st, config) {
    const now = ctx.now();
    if (now < ctx.startAt) return;
    const tick = Math.min(st.maxTick, Math.floor((now - ctx.startAt) / STEP_MS));
    for (let ti = 0; ti < st.teams.length; ti++) {
      const t = st.teams[ti];
      const sim = t.sim;
      sim.advanceTo(tick);
      sim.prune(tick - 20);
      const sk = sim.S[S_SINK] > 0;
      if (sk && !t.wasSink) t.sinks++;
      t.wasSink = sk;
      if (!t.finFinal && sim.S[S_FIN] > 0 && tick - (sim.S[S_FIN] - 1) > MAX_BACK + 2) {
        t.finFinal = true;
        t.finTick = sim.S[S_FIN] - 1;
        t.finAt = now;
        if (st.fins === 0) st.firstFinAt = now;
        st.fins++;
        ctx.broadcast({ k: 'fin', ti, t: t.finTick, r: st.fins });
      }
    }

    if (now - st.lastSnap >= SNAP_MS) {
      st.lastSnap = now;
      const F = tick - MAX_BACK;
      if (F > 0) {
        for (let ti = 0; ti < st.teams.length; ti++) {
          const t = st.teams[ti];
          if (!t.sim.stateAt(F, tmpState)) continue;
          const v = new Array<number>(NS);
          for (let j = 0; j < NS; j++) v[j] = r4(tmpState[j]);
          const msg = { k: 's', ti, t: F, v };
          for (const s of t.seats) ctx.send(s.id, msg);
        }
      }
    }
    if (now - st.lastGhost >= GHOST_MS) {
      st.lastGhost = now;
      const v = st.teams.map((t) => {
        const S = t.sim.S;
        return [r2(S[S_X]), r2(S[S_Y]), r2(S[S_A]), r2(S[S_VX]), r2(S[S_VY]), Math.round(S[S_PROG]), Math.round(S[S_HP]), t.finFinal ? 2 : S[S_SINK] > 0 ? 1 : 0];
      });
      ctx.broadcast({ k: 'g', t: tick, v });
    }
    if (now - st.lastAim >= AIM_MS) {
      st.lastAim = now;
      for (let ti = 0; ti < st.teams.length; ti++) {
        const t = st.teams[ti];
        let v: number[][] | null = null;
        for (let s = 0; s < t.seats.length; s++) {
          const se = t.seats[s];
          if (!se.aimDirty) continue;
          se.aimDirty = false;
          (v ??= []).push([s, se.aimA, se.aimC]);
        }
        if (v) {
          const msg = { k: 'a', ti, v };
          for (const s of t.seats) ctx.send(s.id, msg);
        }
      }
    }
    void config;
  },

  isFinished(ctx, st) {
    if (st.fins >= st.teams.length) return true;
    if (st.fins > 0 && ctx.now() - st.firstFinAt >= FIN_GRACE) return true;
    return false;
  },

  calculateScore(ctx, st, config) {
    const order = rankTeams(st);
    const T = st.teams.length;
    const out: Record<string, PlayerResult> = {};
    order.forEach((ti, rank) => {
      const t = st.teams[ti];
      const S = t.sim.S;
      const fin = S[S_FIN] > 0;
      const hp = Math.round(S[S_HP]);
      const hits = Math.round(S[S_HITS]);
      const pct = Math.round((Math.min(S[S_PROG], st.course.finishS) / st.course.finishS) * 100);
      const secs = fin ? (((S[S_FIN] - 1) * STEP_MS) / 1000).toFixed(1) : '';
      const bonus = (fin ? 100 + hp : Math.round(hp / 2)) - Math.min(40, t.sinks * 20);
      const raw = (T - rank) * 1000 + (fin ? 300 : pct * 2) + bonus;
      const detail = `Bè ${rank + 1}/${T} · ${fin ? `về đích ${secs}s` : `đi được ${pct}%`} · bền ${hp}%${t.sinks ? ` · chìm ${t.sinks} lần` : ''} · ${hits} cú va`;
      for (const s of t.seats) out[s.id] = { raw, detail };
    });
    for (const id of ctx.playerIds) out[id] ??= { raw: 0, detail: 'Không tham gia' };
    // dọn dữ liệu sau ván
    st.scored = true;
    st.teams.length = 0;
    st.of = {};
    void config;
    return out;
  },
};

const tmpState = new Float64Array(NS);
void GAS_BASE;
