import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { stepChair, trackFactor, trackStep, type ChairCfg } from '../../../shared/chairArena.js';

/**
 * Ghế âm nhạc: cả phòng chạy vòng quanh một vòng ghế khi nhạc đang phát. Nhạc DỪNG vào một lúc ngẫu nhiên mà
 * không ai biết trước (chỉ server biết) — lúc đó ai chạm vào ghế trống trước thì ngồi được. Ghế luôn ít hơn người,
 * ai không có ghế bị loại; mỗi vòng bớt ghế cho tới khi còn một người thắng.
 */
interface Config extends ChairCfg {
  /** bán kính vòng ghế */
  ring: number;
  /** chạm ghế trong bán kính này là ngồi được */
  sit: number;
  /** tốc độ chạy vòng khi nhạc phát (đơn vị sân/giây) */
  run: number;
  scrambleMs: number;
  restMs: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

type Phase = 'music' | 'scramble' | 'rest';

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  alive: boolean;
  /** chỉ số ghế đang ngồi, -1 = chưa */
  seat: number;
  outRound: number;
  outAt: number | null;
  /** bán kính làn chạy khi nhạc phát */
  lane: number;
}

interface Chair {
  x: number;
  y: number;
  by: string | null;
}

interface State {
  players: Record<string, PState>;
  round: number;
  phase: Phase;
  phaseAt: number;
  /** giờ nhạc dừng — BÍ MẬT của server, không bao giờ gửi đi trước khi dừng */
  musicEnd: number;
  chairs: Chair[];
  lastTick: number;
  lastBroadcast: number;
  lastFull: number;
  doneAt: number;
}

const R = 105;
const BODY = 4.5;
const SPEED = 40;
const RING = 60;
const SIT = 7.5;
const RUN = 34;
const LANES = [76, 84, 92];
const SCRAMBLE_MS = 3300;
const REST_MS = 2100;
const INTRO_MS = 1200;
const DURATION = 150_000;
const HOLD_TIMEOUT = 900;
const BROADCAST_MS = 66;
const FULL_MS = 1000;
const END_GRACE = 1800;

/** nhiều người thì loại 2 người mỗi vòng cho ván khỏi quá dài */
const eliminateFor = (alive: number) => (alive >= 10 ? 2 : 1);
/** nhạc dừng sau 3,5–8 giây, vòng sau ngắn dần */
const musicFor = (round: number) => 3500 + Math.random() * Math.max(1500, 4500 - round * 350);

const r1 = (n: number) => Math.round(n * 10) / 10;

export const musicalChairsGame: GameDefinition<Config, State> = {
  id: 'chairs',
  name: 'GHẾ ÂM NHẠC',
  instructions:
    'Khi nhạc phát, cả phòng chạy vòng quanh các chiếc ghế theo MỘT hướng (chỉ chọn nhanh hay chậm). Nhạc DỪNG bất cứ lúc nào — lúc đó chạy tự do tới một chiếc ghế trống thật nhanh để ngồi! ' +
    'Ghế luôn ít hơn người nên ai không có ghế bị loại. Người cuối cùng còn lại thắng.',
  controls: [
    { keys: ['↑', '→'], desc: 'Nhạc phát: chạy nhanh hơn (W D cũng được)' },
    { keys: ['↓', '←'], desc: 'Nhạc phát: chạy chậm lại · nhạc dừng: ← ↑ → ↓ chạy tự do tới ghế trống' },
  ],
  duration: DURATION + 1500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const spawns: Record<string, [number, number]> = {};
    ids.forEach((id, i) => {
      const a = (i / n) * Math.PI * 2;
      spawns[id] = [r1(Math.cos(a) * R * 0.8), r1(Math.sin(a) * R * 0.8)];
    });
    return { r: R, body: BODY, speed: SPEED, ring: RING, sit: SIT, run: RUN, scrambleMs: SCRAMBLE_MS, restMs: REST_MS, endsAt: DURATION, spawns };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, dx: 0, dy: 0, moveAt: 0, alive: true, seat: -1, outRound: 0, outAt: null, lane: LANES[0] };
    }
    return {
      players,
      round: -1,
      phase: 'rest',
      phaseAt: ctx.startAt - 1,
      musicEnd: Infinity,
      chairs: [],
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastFull: 0,
      doneAt: 0,
    };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'moveXY') return;
    const p = state.players[playerId];
    if (!p || !p.alive || p.seat >= 0) return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    if (now < ctx.startAt) return;
    const alive = () => ctx.playerIds.filter((id) => state.players[id].alive);

    // chạy + đẩy nhau nhẹ cho khỏi chồng lên nhau
    const mv = alive().filter((id) => state.players[id].seat < 0);
    for (const id of mv) {
      const p = state.players[id];
      if (now - p.moveAt > HOLD_TIMEOUT) p.dx = p.dy = 0;
      // nhạc phát: chạy vòng một hướng (chỉ chọn nhanh/chậm); nhạc dừng và giờ nghỉ: chạy tự do
      if (state.phase === 'music' && state.round >= 0) trackStep(config.run, p, p.lane, trackFactor(p.dx, p.dy), dt);
      else stepChair(config, p, p.dx, p.dy, dt);
    }
    for (let i = 0; i < mv.length; i++) {
      for (let j = i + 1; j < mv.length; j++) {
        const a = state.players[mv[i]];
        const b = state.players[mv[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = BODY * 2;
        if (d < min && d > 1e-3) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }

    // vòng mới: bớt ghế, đặt ghế đều quanh tâm
    const startRound = () => {
      const a = alive().length;
      state.round += 1;
      const count = Math.max(1, a - eliminateFor(a));
      const off = Math.random() * Math.PI * 2;
      state.chairs = [];
      for (let i = 0; i < count; i++) {
        const ang = off + (i / count) * Math.PI * 2;
        state.chairs.push({ x: r1(Math.cos(ang) * config.ring), y: r1(Math.sin(ang) * config.ring), by: null });
      }
      const lanes: Record<string, number> = {};
      alive().forEach((id, i) => {
        const p = state.players[id];
        p.lane = LANES[i % LANES.length];
        p.seat = -1;
        // vào làn chạy ngay tại góc đang đứng
        const ang = Math.atan2(p.y, p.x);
        p.x = Math.cos(ang) * p.lane;
        p.y = Math.sin(ang) * p.lane;
        lanes[id] = p.lane;
      });
      state.phase = 'music';
      state.phaseAt = now;
      state.musicEnd = now + musicFor(state.round);
      ctx.broadcast({ type: 'round', r: state.round, chairs: state.chairs.map((c) => [c.x, c.y]), lanes, at: now });
    };

    if (state.round < 0 && now >= ctx.startAt + INTRO_MS) startRound();

    if (state.phase === 'music' && state.round >= 0 && now >= state.musicEnd) {
      state.phase = 'scramble';
      state.phaseAt = now;
      ctx.broadcast({ type: 'stop', r: state.round, at: now });
    }

    if (state.phase === 'scramble') {
      // ai chạm ghế trống trước (gần nhất) thì ngồi
      for (let ci = 0; ci < state.chairs.length; ci++) {
        const c = state.chairs[ci];
        if (c.by) continue;
        let best: string | null = null;
        let bestD = config.sit;
        for (const id of alive()) {
          const p = state.players[id];
          if (p.seat >= 0) continue;
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d <= bestD) {
            bestD = d;
            best = id;
          }
        }
        if (best) {
          const p = state.players[best];
          c.by = best;
          p.seat = ci;
          p.x = c.x;
          p.y = c.y;
          p.dx = p.dy = 0;
          ctx.broadcast({ type: 'seat', p: best, c: ci, at: now });
        }
      }
      const seated = alive().filter((id) => state.players[id].seat >= 0).length;
      const full = state.chairs.every((c) => c.by);
      if (full || now - state.phaseAt >= config.scrambleMs) {
        const losers = seated > 0 ? alive().filter((id) => state.players[id].seat < 0) : [];
        for (const id of losers) {
          const p = state.players[id];
          p.alive = false;
          p.outRound = state.round + 1;
          p.outAt = now;
          p.dx = p.dy = 0;
        }
        state.phase = 'rest';
        state.phaseAt = now;
        ctx.broadcast({ type: 'out', ids: losers, r: state.round, at: now });
        if (alive().length <= 1) state.doneAt = now;
      }
    }

    if (state.phase === 'rest' && state.round >= 0 && !state.doneAt && now - state.phaseAt >= config.restMs) startRound();

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;
    const pp: Record<string, [number, number, number, number]> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      pp[id] = [r1(p.x), r1(p.y), p.seat, p.alive ? 1 : 0];
    }
    const payload: Record<string, unknown> = { type: 'p', p: pp, ph: state.phase === 'music' ? 'm' : state.phase === 'scramble' ? 's' : 'r' };
    // nhắc lại ván hiện tại mỗi giây cho ai vào lại giữa chừng (KHÔNG kèm giờ nhạc dừng)
    if (now - state.lastFull >= FULL_MS) {
      state.lastFull = now;
      payload.full = {
        r: state.round,
        chairs: state.chairs.map((c) => [c.x, c.y, c.by ?? '']),
        lanes: Object.fromEntries(alive().map((id) => [id, state.players[id].lane])),
      };
    }
    ctx.broadcast(payload);
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    return state.doneAt > 0 && now - state.doneAt >= END_GRACE;
  },

  calculateScore(ctx, state) {
    const left = ctx.playerIds.filter((id) => state.players[id].alive).length;
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      out[id] = p.alive
        ? { raw: 1_000_000, detail: left === 1 ? '🏆 người cuối cùng còn ghế' : 'còn trụ lại đến hết giờ' }
        : { raw: p.outRound * 1000, detail: `bị loại ở vòng ${p.outRound}` };
    }
    return out;
  },
};
