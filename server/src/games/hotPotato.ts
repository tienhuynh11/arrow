import type { GameDefinition, PlayerResult } from './types';
import type { GameInput } from '../../../shared/protocol';

interface Pillar {
  x: number;
  y: number;
  r: number;
}

interface Config {
  w: number;
  h: number;
  speed: number;
  /** người ôm bom chạy nhanh hơn một chút để còn đuổi kịp */
  carrierBoost: number;
  tagRadius: number;
  playerRadius: number;
  pillars: Pillar[];
  lives: number;
  endsAt: number;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  lives: number;
  tags: number;
  blasts: number;
  /** vừa chuyền/nhận bom xong thì miễn nhiễm một lúc, tránh chạm qua chạm lại */
  safeUntil: number;
  outAt: number | null;
}

interface State {
  players: Record<string, PState>;
  order: string[];
  holder: string;
  fuseEnd: number;
  round: number;
  lastTick: number;
  lastBroadcast: number;
}

const W = 200;
const H = 128;
const SPEED = 48;
const CARRIER_BOOST = 1.16;
const TAG_RADIUS = 11;
const PLAYER_R = 6;
const LIVES = 3;
const TAG_IMMUNITY = 850;
const HOLD_TIMEOUT = 900;
const DURATION = 52_000;

const fuseFor = (round: number) => 7000 - Math.min(3300, round * 380) + Math.random() * 1400;

export const hotPotatoGame: GameDefinition<Config, State> = {
  id: 'bomb',
  name: 'ĐUỔI BẮT BOM',
  instructions:
    'Cả phòng chạy tự do trong một đấu trường. Một người bị gắn quả bom đang cháy ngòi - ' +
    'người đó phải ĐUỔI THEO và CHẠM vào người khác để tống quả bom sang cho họ, ' +
    'còn những người kia phải chạy trốn! Người ôm bom chạy nhanh hơn một chút nên trốn mãi không được đâu. ' +
    'Vừa chuyền xong thì cả hai miễn nhiễm gần 1 giây, không chạm lại ngay được. ' +
    'Khi ngòi cháy hết, ai đang ôm bom thì NỔ và mất 1 mạng (mỗi người 3 mạng), ' +
    'rồi bom gắn cho người khác với ngòi ngắn hơn. Trong sân có mấy cột đá để né và cắt đuôi. ' +
    'Hết mạng là bị loại - còn nhiều mạng nhất thì thắng!',
  controls: [{ keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy mọi hướng trong đấu trường' }],
  duration: DURATION + 2500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig() {
    const pillars: Pillar[] = [
      { x: W * 0.28, y: H * 0.34, r: 13 },
      { x: W * 0.72, y: H * 0.34, r: 13 },
      { x: W * 0.5, y: H * 0.68, r: 16 },
      { x: W * 0.14, y: H * 0.78, r: 10 },
      { x: W * 0.86, y: H * 0.78, r: 10 },
    ];
    return {
      w: W,
      h: H,
      speed: SPEED,
      carrierBoost: CARRIER_BOOST,
      tagRadius: TAG_RADIUS,
      playerRadius: PLAYER_R,
      pillars,
      lives: LIVES,
      endsAt: DURATION,
    };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    const n = ctx.playerIds.length;
    ctx.playerIds.forEach((id, i) => {
      // xếp đều trên một vòng tròn để không ai bị dồn vào góc
      const a = (i / n) * Math.PI * 2;
      players[id] = {
        x: W / 2 + Math.cos(a) * W * 0.32,
        y: H / 2 + Math.sin(a) * H * 0.3,
        dx: 0,
        dy: 0,
        moveAt: 0,
        lives: LIVES,
        tags: 0,
        blasts: 0,
        safeUntil: 0,
        outAt: null,
      };
    });
    const order = [...ctx.playerIds];
    const holder = order[Math.floor(Math.random() * order.length)];
    return {
      players,
      order,
      holder,
      fuseEnd: ctx.startAt + fuseFor(0),
      round: 0,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
    };
  },

  onStart(ctx, state) {
    ctx.broadcast({ type: 'bomb', holder: state.holder, fuseEnd: state.fuseEnd, round: 0 });
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'moveXY') return;
    const p = state.players[playerId];
    if (!p || p.outAt !== null) return;
    // chỉ nhận -1 / 0 / 1, tự chuẩn hoá để không ai đi chéo nhanh hơn
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;

    if (dt > 0) {
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.outAt !== null) continue;
        if (now - p.moveAt > HOLD_TIMEOUT) {
          p.dx = 0;
          p.dy = 0;
        }
        if (p.dx === 0 && p.dy === 0) continue;

        const len = Math.hypot(p.dx, p.dy) || 1;
        const sp = config.speed * (id === state.holder ? config.carrierBoost : 1);
        p.x += (p.dx / len) * sp * dt;
        p.y += (p.dy / len) * sp * dt;

        // giữ trong sân
        p.x = Math.max(config.playerRadius, Math.min(config.w - config.playerRadius, p.x));
        p.y = Math.max(config.playerRadius, Math.min(config.h - config.playerRadius, p.y));

        // đẩy ra khỏi cột đá
        for (const c of config.pillars) {
          const ddx = p.x - c.x;
          const ddy = p.y - c.y;
          const d = Math.hypot(ddx, ddy);
          const min = c.r + config.playerRadius;
          if (d < min && d > 0.001) {
            p.x = c.x + (ddx / d) * min;
            p.y = c.y + (ddy / d) * min;
          }
        }
      }
    }

    // người ôm bom chạm được ai thì tống bom sang người đó
    const holder = state.players[state.holder];
    if (holder && holder.outAt === null && now >= holder.safeUntil) {
      for (const id of ctx.playerIds) {
        if (id === state.holder) continue;
        const t = state.players[id];
        if (t.outAt !== null || now < t.safeUntil) continue;
        if (Math.hypot(holder.x - t.x, holder.y - t.y) <= config.tagRadius) {
          holder.tags += 1;
          holder.safeUntil = now + TAG_IMMUNITY;
          t.safeUntil = now + TAG_IMMUNITY;
          const from = state.holder;
          state.holder = id;
          ctx.broadcast({ type: 'tag', from, to: id, fuseEnd: state.fuseEnd });
          break;
        }
      }
    }

    if (now >= state.fuseEnd) {
      const victim = state.players[state.holder];
      if (victim) {
        victim.lives -= 1;
        victim.blasts += 1;
        victim.safeUntil = now + TAG_IMMUNITY;
        if (victim.lives <= 0) victim.outAt = now;
      }
      ctx.broadcast({ type: 'blast', playerId: state.holder, lives: Math.max(0, victim?.lives ?? 0) });

      const alive = state.order.filter((id) => state.players[id].outAt === null);
      if (alive.length <= 1) {
        state.fuseEnd = Number.POSITIVE_INFINITY;
      } else {
        state.round += 1;
        state.holder = alive[Math.floor(Math.random() * alive.length)];
        state.players[state.holder].safeUntil = now + TAG_IMMUNITY;
        state.fuseEnd = now + fuseFor(state.round);
        ctx.broadcast({ type: 'bomb', holder: state.holder, fuseEnd: state.fuseEnd, round: state.round });
      }
    }

    if (now - state.lastBroadcast < 60) return;
    state.lastBroadcast = now;
    const pos: Record<string, { x: number; y: number; safe: boolean; out: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      pos[id] = {
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        safe: now < p.safeUntil,
        out: p.outAt !== null,
      };
    }
    // kèm fuseEnd để người vừa kết nối lại giữa ván vẫn thấy được ngòi nổ
    ctx.broadcast({
      type: 'pos',
      positions: pos,
      holder: state.holder,
      fuseEnd: Number.isFinite(state.fuseEnd) ? state.fuseEnd : null,
    });
  },

  isFinished(ctx, state, config) {
    if (ctx.now() - ctx.startAt >= config.endsAt) return true;
    return state.order.filter((id) => state.players[id].outAt === null).length <= 1;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const raw = Math.max(0, p.lives) * 1000 + p.tags * 25;
      out[id] = {
        raw,
        detail:
          p.outAt !== null
            ? `nổ ${p.blasts} lần · bị loại`
            : `còn ${p.lives} ❤ · nổ ${p.blasts} · chuyền ${p.tags}`,
      };
    }
    return out;
  },
};
