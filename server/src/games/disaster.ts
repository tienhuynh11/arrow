import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  F_DEAD,
  F_DTICK,
  F_GR,
  F_INW,
  F_X,
  F_Y,
  NF,
  PSim,
  STEP_MS,
  World,
} from '../../../shared/disaster.js';

/**
 * SURVIVAL HỖN LOẠN (id disaster) - sống sót qua thảm họa ngẫu nhiên, 3 vòng, mỗi vòng địa hình + thứ tự thảm họa khác.
 *
 * Netcode: thảm họa là hàm xác định của (seed, tick) nên KHÔNG stream; config chỉ có seed từng vòng.
 * Mỗi người là một PSim độc lập (không va chạm với nhau) → server tua lại (rewind) từng người khi input tới trễ,
 * kết quả khớp bit với bản dự đoán ở client. Snapshot ~20 Hz, chỉ gửi cho người cùng arena (tối đa 8/arena).
 * Mọi arena dùng CHUNG seed nên thảm họa giống hệt nhau → điểm giữa các arena công bằng (xếp hạng chuẩn hoá theo cỡ arena).
 */
export const DZ_ROUNDS = 3;
const ARENA_MAX = 8;
const INTER_TICKS = 300;
const DONE_GRACE = 36;
const SNAP_MS = 45;
const DURATION = 178_000;
const FL_WON = 8;
const FL_AIR = 16;
const FL_WET = 32;

interface Config {
  arenas: string[][];
  seeds: number[];
  rounds: number;
}

interface PS {
  id: string;
  arena: number;
  seat: number;
  sim: PSim;
  q: number;
  won: boolean;
  /** tổng điểm các vòng */
  score: number;
  /** số vòng sống sót tới cuối / thắng */
  survived: number;
  /** tổng giây sống */
  life: number;
}

interface ArenaS {
  ids: string[];
  members: PS[];
  done: boolean;
  doneSince: number;
  lastE: any;
}

interface State {
  world: World;
  round: number;
  mode: 'play' | 'inter' | 'over';
  nextBase: number;
  overG: number;
  lastSnap: number;
  lastResend: number;
  players: Map<string, PS>;
  arenas: ArenaS[];
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** chia arena đều: ≤8 người một arena, 9–16 thì hai arena */
export function arenaSizes(n: number): number[] {
  if (n <= ARENA_MAX) return [n];
  const a = Math.ceil(n / 2);
  return [a, n - a];
}

const spawnTmp = new Float64Array(2);

function startRound(st: State, cfg: Config, r: number, base: number) {
  st.round = r;
  st.world = new World(cfg.seeds[r], r, base);
  st.mode = 'play';
  for (const a of st.arenas) {
    a.done = false;
    a.doneSince = -1;
    a.lastE = null;
    const n = a.members.length;
    for (const p of a.members) {
      st.world.spawn(p.seat, n, spawnTmp);
      p.sim.reset(base, spawnTmp[0], spawnTmp[1], st.world.groundZ(0, spawnTmp[0], spawnTmp[1]));
      p.won = false;
    }
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function flagsOf(p: PS): number {
  const s = p.sim.s;
  return (s[F_DEAD] & 7) | (p.won ? FL_WON : 0) | (s[F_GR] === 0 ? FL_AIR : 0) | (s[F_INW] > 0 ? FL_WET : 0);
}

function snapshot(st: State, g: number, send: (id: string, p: any) => void) {
  const base = st.world.base;
  for (const a of st.arenas) {
    const o: number[][] = [];
    for (const p of a.members) {
      const s = p.sim.s;
      o.push([p.seat, Math.round(s[F_X] * 16), Math.round(s[F_Y] * 16), Math.round(s[2] * 16), flagsOf(p)]);
    }
    for (const p of a.members) {
      const m = new Array<number>(NF);
      for (let i = 0; i < NF; i++) m[i] = r3(p.sim.s[i]);
      send(p.id, { y: 's', T: g, r: st.round, b: base, q: p.q, m, o });
    }
  }
}

function endRound(st: State, cfg: Config, g: number) {
  const w = st.world;
  const last = st.round >= cfg.rounds - 1;
  const nb = last ? -1 : g + INTER_TICKS;
  st.mode = last ? 'over' : 'inter';
  st.nextBase = nb;
  st.overG = g;
  st.lastResend = g;
  const endT = w.endTick;
  for (const a of st.arenas) {
    const ms = a.members;
    const n = ms.length;
    const dk = ms.map((p) => (p.sim.s[F_DEAD] > 0 ? p.sim.s[F_DTICK] : 1e9));
    const rk: number[] = new Array(n);
    const pt: number[] = new Array(n);
    const tot: number[] = new Array(n);
    const dt: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      let rank = 1;
      for (let j = 0; j < n; j++) if (dk[j] > dk[i]) rank++;
      const p = ms[i];
      const alive = dk[i] >= 1e9;
      const lifeT = alive ? endT : Math.min(endT, dk[i]);
      const raw = Math.round((n > 1 ? (700 * (n - rank)) / (n - 1) : 700) + 300 * Math.min(1, lifeT / endT));
      p.score += raw;
      p.life += lifeT / 60;
      if (alive) {
        p.survived++;
        p.won = true;
        p.sim.frozen = true;
      }
      rk[p.seat] = rank;
      pt[p.seat] = raw;
      dt[p.seat] = alive ? -1 : dk[i];
    }
    for (let i = 0; i < n; i++) tot[ms[i].seat] = ms[i].score;
    a.lastE = { y: 'e', r: st.round, rk, pt, tot, dt, nb };
  }
}

export const disasterGame: GameDefinition<Config, State> = {
  id: 'disaster',
  name: '🌋 SURVIVAL HỖN LOẠN',
  instructions:
    'Sống sót qua 3 vòng thảm họa bất ngờ: thiên thạch, động đất, lũ lụt, lốc xoáy, sàn sụp đổ. Không ai biết thảm họa kế tiếp là gì - chỉ có vài giây cảnh báo! Mỗi vòng địa hình khác nhau. Người sống lâu nhất thắng vòng; nhiều vòng cộng điểm.',
  controls: [
    { keys: ['←', '→', '↑', '↓'], desc: 'Chạy (hoặc W A S D)' },
    { keys: ['SPACE'], desc: 'Nhảy - né sóng động đất' },
  ],
  duration: DURATION,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const ids = shuffle([...ctx.playerIds]);
    const arenas: string[][] = [];
    let at = 0;
    for (const sz of arenaSizes(ids.length)) {
      arenas.push(ids.slice(at, at + sz));
      at += sz;
    }
    const seeds: number[] = [];
    for (let i = 0; i < DZ_ROUNDS; i++) seeds.push((Math.random() * 0x7fffffff) | 0);
    return { arenas, seeds, rounds: DZ_ROUNDS };
  },

  createState(ctx, config) {
    const players = new Map<string, PS>();
    const arenas: ArenaS[] = config.arenas.map((ids, ai) => {
      const members = ids.map((id, seat) => {
        const p: PS = { id, arena: ai, seat, sim: new PSim(), q: 0, won: false, score: 0, survived: 0, life: 0 };
        players.set(id, p);
        return p;
      });
      return { ids, members, done: false, doneSince: -1, lastE: null };
    });
    const st: State = {
      world: new World(config.seeds[0], 0, 0),
      round: 0,
      mode: 'play',
      nextBase: -1,
      overG: 0,
      lastSnap: 0,
      lastResend: 0,
      players,
      arenas,
    };
    startRound(st, config, 0, 0);
    return st;
  },

  handleInput(ctx, st, cfg, playerId, input: GameInput) {
    if (input.type !== 'dz') return;
    const p = st.players.get(playerId);
    if (!p) return;
    const q = Number(input.q);
    if (Number.isFinite(q) && q > p.q) p.q = q | 0;
    if (st.mode !== 'play') return;
    const a = st.arenas[p.arena];
    if (a.done || p.sim.frozen) return;
    const g = Math.floor((ctx.now() - ctx.startAt) / STEP_MS);
    if (g < 0) return;
    const t = Number(input.t);
    if (!Number.isFinite(t)) return;
    const dx = input.dx > 0 ? 1 : input.dx < 0 ? -1 : 0;
    const dy = input.dy > 0 ? 1 : input.dy < 0 ? -1 : 0;
    p.sim.advance(st.world, g);
    p.sim.input(st.world, Math.floor(t), dx, dy, input.j ? 1 : 0);
  },

  update(ctx, st, cfg) {
    const now = ctx.now();
    const g = Math.floor((now - ctx.startAt) / STEP_MS);
    if (g < 0) return;

    if (st.mode === 'inter') {
      if (g >= st.nextBase) {
        startRound(st, cfg, st.round + 1, st.nextBase);
        return;
      }
      if (g - st.lastResend >= 120) {
        st.lastResend = g;
        for (const a of st.arenas) for (const p of a.members) ctx.send(p.id, a.lastE);
      }
      return;
    }
    if (st.mode === 'over') return;

    const w = st.world;
    for (const a of st.arenas) {
      let alive = 0;
      for (const p of a.members) {
        p.sim.advance(w, g);
        if (p.sim.s[F_DEAD] === 0) alive++;
      }
      if (!a.done) {
        if (alive <= 1) {
          if (a.doneSince < 0) a.doneSince = g;
          else if (g - a.doneSince >= DONE_GRACE) {
            a.done = true;
            for (const p of a.members) {
              if (p.sim.s[F_DEAD] === 0) {
                p.won = true;
                p.sim.frozen = true;
              }
            }
          }
        } else a.doneSince = -1;
      }
    }

    let allDone = true;
    for (const a of st.arenas) if (!a.done) allDone = false;
    if (allDone || g - w.base >= w.endTick) {
      // một nhịp snapshot cuối để ai cũng thấy trạng thái chết/thắng, rồi chốt vòng
      snapshot(st, g, ctx.send);
      endRound(st, cfg, g);
      for (const a of st.arenas) for (const p of a.members) ctx.send(p.id, a.lastE);
      return;
    }
    if (now - st.lastSnap >= SNAP_MS) {
      st.lastSnap = now;
      snapshot(st, g, ctx.send);
    }
  },

  isFinished(ctx, st) {
    if (st.mode !== 'over') return false;
    return ctx.now() - ctx.startAt >= st.overG * STEP_MS + 4500;
  },

  calculateScore(ctx, st, cfg) {
    if (st.mode === 'play') endRound(st, cfg, Math.floor((ctx.now() - ctx.startAt) / STEP_MS));
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = st.players.get(id);
      if (!p) {
        out[id] = { raw: 0, detail: 'không vào arena' };
        continue;
      }
      const avg = Math.round(p.life / cfg.rounds);
      out[id] = {
        raw: p.score,
        detail: `sống sót ${p.survived}/${cfg.rounds} vòng · trung bình ${avg}s`,
      };
    }
    // dọn dữ liệu ván để giải phóng RAM
    st.players.clear();
    st.arenas.length = 0;
    return out;
  },
};
