import type { GameDefinition, PlayerResult } from './types';
import type { GameInput } from '../../../shared/protocol';

export type ObstacleKind = 'ufo' | 'saw' | 'blob' | 'crystal' | 'eye' | 'bomb' | 'star' | 'worm';

interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** vị trí ngang lúc mới xuất hiện, theo đơn vị sân 0…WIDTH */
  x0: number;
  /** trôi ngang bao nhiêu đơn vị mỗi giây (0 = rơi thẳng) */
  vx: number;
  /** bề ngang (đơn vị sân) */
  w: number;
  /** thời điểm chạm vạch người chơi, offset từ startAt */
  t: number;
  /** thời gian rơi từ đỉnh xuống vạch */
  travel: number;
  /** tốc độ xoay, chỉ để client vẽ */
  spin: number;
}

interface Config {
  width: number;
  playerWidth: number;
  speed: number; // đơn vị/giây khi giữ phím
  obstacles: Obstacle[];
  lives: number;
  endsAt: number;
}

interface PState {
  x: number;
  holding: 'L' | 'R' | 'N';
  holdAt: number;
  lives: number;
  dodged: number;
  hits: number;
  stunUntil: number;
  outAt: number | null;
}

interface State {
  players: Record<string, PState>;
  cursor: number;
  lastTick: number;
  lastBroadcast: number;
}

const WIDTH = 100;
const PLAYER_W = 6;
const SPEED = 62;
const LIVES = 3;
const STUN_MS = 420;
const HOLD_TIMEOUT = 900;
const WAVE_COUNT = 30;

const KINDS: ObstacleKind[] = ['ufo', 'saw', 'blob', 'crystal', 'eye', 'bomb', 'star', 'worm'];
const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export const dodgeGame: GameDefinition<Config, State> = {
  id: 'dodge',
  name: 'NÉ VẬT THỂ LẠ',
  instructions:
    'Đủ thứ vật thể kỳ quái rơi từ trên xuống. GIỮ phím ← hoặc → để chạy tự do sang trái/phải ' +
    'và luồn qua khe trống giữa chúng. Trúng một vật là mất 1 mạng (bạn có 3 mạng) và đứng hình gần nửa giây. ' +
    'Càng về sau vật rơi càng nhanh, càng dày và khe trống càng hẹp, lại còn có vật bay chéo. ' +
    'Né được càng nhiều đợt và giữ được càng nhiều mạng thì điểm càng cao.',
  controls: [{ keys: ['←', '→'], desc: 'Giữ để chạy tự do sang hai bên' }],
  duration: 50_000,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig() {
    const obstacles: Obstacle[] = [];
    let t = 2200;
    let id = 0;

    for (let i = 0; i < WAVE_COUNT; i++) {
      const p = i / (WAVE_COUNT - 1);
      const travel = Math.round(1700 + (950 - 1700) * p); // rơi nhanh dần
      const gapW = 30 + (15 - 30) * p; // khe trống hẹp dần
      // hai khe ở đầu ván cho dễ thở, về sau chỉ còn một
      const gaps: number[] = [];
      if (p < 0.35) {
        gaps.push(rnd(12, 42), rnd(58, 88));
      } else {
        gaps.push(rnd(gapW / 2 + 4, WIDTH - gapW / 2 - 4));
      }
      gaps.sort((a, b) => a - b);

      // các đoạn đặc nằm giữa các khe
      const edges = [0];
      for (const g of gaps) {
        edges.push(g - gapW / 2, g + gapW / 2);
      }
      edges.push(WIDTH);

      for (let k = 0; k < edges.length; k += 2) {
        const from = Math.max(0, edges[k]);
        const to = Math.min(WIDTH, edges[k + 1]);
        let span = to - from;
        if (span < 6) continue;

        // lấp đoạn đặc bằng 1-3 vật thể kích thước khác nhau
        let cursor = from;
        while (span > 5) {
          const w = Math.min(span, rnd(11, 24));
          const drift = p > 0.45 && Math.random() < 0.3 ? rnd(-9, 9) : 0;
          obstacles.push({
            id: id++,
            kind: pick(KINDS),
            x0: Math.round((cursor + w / 2 - (drift * travel) / 1000) * 10) / 10,
            vx: Math.round(drift * 10) / 10,
            w: Math.round(w * 10) / 10,
            t: Math.round(t),
            travel,
            spin: Math.round(rnd(-160, 160)),
          });
          cursor += w;
          span -= w;
        }
      }

      t += 1350 + (620 - 1350) * p; // các đợt dồn dập dần
    }

    return {
      width: WIDTH,
      playerWidth: PLAYER_W,
      speed: SPEED,
      obstacles,
      lives: LIVES,
      endsAt: Math.round(t + 1200),
    };
  },

  createState(ctx) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      players[id] = {
        x: WIDTH / 2,
        holding: 'N',
        holdAt: 0,
        lives: LIVES,
        dodged: 0,
        hits: 0,
        stunUntil: 0,
        outAt: null,
      };
    }
    return { players, cursor: 0, lastTick: ctx.startAt, lastBroadcast: 0 };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'hold') return;
    const p = state.players[playerId];
    if (!p || p.outAt !== null) return;
    p.holding = input.dir;
    p.holdAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 250) / 1000;
    state.lastTick = now;

    // di chuyển tự do theo phím đang giữ
    if (dt > 0) {
      const half = config.playerWidth / 2;
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.outAt !== null) continue;
        const holding = now - p.holdAt > HOLD_TIMEOUT ? 'N' : p.holding;
        if (now < p.stunUntil || holding === 'N') continue;
        const dir = holding === 'L' ? -1 : 1;
        p.x = Math.max(half, Math.min(config.width - half, p.x + dir * config.speed * dt));
      }
    }

    // vật thể chạm vạch người chơi: kiểm tra va chạm theo bề ngang thật
    while (state.cursor < config.obstacles.length && config.obstacles[state.cursor].t <= rel) {
      const o = config.obstacles[state.cursor];
      state.cursor += 1;
      const landX = o.x0 + (o.vx * o.travel) / 1000;
      const half = o.w / 2 + config.playerWidth / 2;

      const hits: string[] = [];
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.outAt !== null) continue;
        if (Math.abs(p.x - landX) < half) {
          // một đợt có nhiều vật, chỉ trừ một mạng cho mỗi lần dính
          if (now < p.stunUntil) continue;
          p.lives -= 1;
          p.hits += 1;
          p.stunUntil = now + STUN_MS;
          hits.push(id);
          if (p.lives <= 0) p.outAt = now;
        } else {
          p.dodged += 1;
        }
      }
      if (hits.length > 0) ctx.broadcast({ type: 'impact', obstacleId: o.id, hits });
    }

    if (now - state.lastBroadcast < 90) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; lives: number; stunned: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = { x: Math.round(p.x * 10) / 10, lives: Math.max(0, p.lives), stunned: now < p.stunUntil };
    }
    ctx.broadcast({ type: 'pos', positions });
  },

  isFinished(ctx, state, config) {
    if (ctx.now() - ctx.startAt >= config.endsAt) return true;
    return ctx.playerIds.every((id) => state.players[id].outAt !== null);
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const raw = p.dodged * 10 + Math.max(0, p.lives) * 120;
      out[id] = {
        raw,
        detail:
          p.outAt !== null
            ? `né ${p.dodged} vật · hết mạng`
            : `né ${p.dodged} vật · còn ${p.lives} ❤`,
      };
    }
    return out;
  },
};
