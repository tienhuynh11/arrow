import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { freeAt, los, makeMap, stepCode, type CodeBox } from '../../../shared/codeArena.js';

/**
 * Mã sát thủ: mỗi người mang một MÃ 3 SỐ nổi trên đầu. Thấy mã của ai thì gõ đúng mã đó để hạ người ấy;
 * bị hạ thì hồi sinh ngẫu nhiên ở chỗ khác với MÃ MỚI. Hết 2 phút 30, ai hạ nhiều nhất xếp trên.
 *
 * Bí mật nằm ở server: mã và vị trí của người khác CHỈ được gửi cho ai đang nhìn thấy họ (không bị tường/khối che,
 * trong tầm nhìn VÀ hai mặt đối nhau). Gõ mã của người chưa từng thấy là gõ sai và bị khoá tay một chút, nên đoán mò không ăn thua.
 */
interface Config {
  w: number;
  h: number;
  radius: number;
  boxes: CodeBox[];
  speed: number;
  /** tầm nhìn tối đa (đơn vị sân) */
  vis: number;
  endsAt: number;
  respawnMs: number;
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** hướng mặt (vector đơn vị) = hướng bấm gần nhất */
  fx: number;
  fy: number;
  moveAt: number;
  code: string;
  alive: boolean;
  respawnAt: number;
  /** miễn nhiễm sau khi hồi sinh */
  invUntil: number;
  kills: number;
  deaths: number;
  /** khoá gõ mã sau khi gõ sai */
  lockUntil: number;
  /** lần cuối nhìn thấy từng người khác (để gõ chậm một nhịp vẫn tính) */
  seen: Record<string, number>;
  lastKiller: string;
}

interface State {
  players: Record<string, PState>;
  lastTick: number;
  lastBroadcast: number;
  lastScore: number;
}

const SPEED = 46;
const VIS = 85;
const DURATION = 150_000;
const RESPAWN_MS = 2800;
const INV_MS = 2200;
const SEEN_MS = 2200;
/** góc nhìn đối mặt: lệch tối đa 60° so với đường nối hai người */
const FACE_COS = 0.5;
const WRONG_LOCK_MS = 900;
const HOLD_TIMEOUT = 900;
const BROADCAST_MS = 66;

const map = makeMap();

function newCode(state: Record<string, PState> | null, self?: string): string {
  const used = new Set(Object.entries(state ?? {}).filter(([id]) => id !== self).map(([, p]) => p.code));
  for (let i = 0; i < 200; i++) {
    const c = String(100 + Math.floor(Math.random() * 900));
    if (!used.has(c)) return c;
  }
  return String(100 + Math.floor(Math.random() * 900));
}

/** chọn chỗ hồi sinh: thử nhiều điểm, lấy điểm xa mọi người còn sống nhất */
function pickSpawn(players: Record<string, PState>, self?: string): [number, number] {
  let best: [number, number] = [map.w / 2, 20];
  let bestD = -1;
  for (let i = 0; i < 40; i++) {
    const x = 10 + Math.random() * (map.w - 20);
    const y = 10 + Math.random() * (map.h - 20);
    if (!freeAt(map, x, y, 3)) continue;
    let d = Infinity;
    for (const [id, p] of Object.entries(players)) {
      if (id === self || !p.alive) continue;
      d = Math.min(d, Math.hypot(p.x - x, p.y - y));
    }
    if (d > bestD) {
      bestD = d;
      best = [x, y];
    }
  }
  return [Math.round(best[0] * 10) / 10, Math.round(best[1] * 10) / 10];
}

export const codeHuntGame: GameDefinition<Config, State> = {
  id: 'codehunt',
  name: 'MÃ SÁT THỦ',
  instructions:
    'Mỗi người có một MÃ 3 SỐ cố định trên đầu, nhưng chỉ đọc được khi hai bên NHÌN THẲNG VÀO MẶT NHAU (không bị tường che). Gõ đúng 3 số để hạ người ấy. ' +
    'Bị hạ sẽ hồi sinh ở chỗ khác (mã vẫn giữ nguyên). Sau 2 phút 30, ai hạ nhiều nhất thắng.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy và quay mặt · đối mặt người khác để đọc mã' },
    { keys: ['0-9'], desc: 'Gõ 3 số trên đầu mục tiêu để hạ · Backspace xoá' },
  ],
  duration: DURATION + 1500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const spawns: Record<string, [number, number]> = {};
    const fake: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = pickSpawn(fake);
      spawns[id] = [x, y];
      fake[id] = { x, y, alive: true } as PState;
    }
    return {
      w: map.w,
      h: map.h,
      radius: map.radius,
      boxes: map.boxes,
      speed: SPEED,
      vis: VIS,
      endsAt: DURATION,
      respawnMs: RESPAWN_MS,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = {
        x,
        y,
        dx: 0,
        dy: 0,
        fx: 0,
        fy: 1,
        moveAt: 0,
        code: newCode(players, id),
        alive: true,
        respawnAt: 0,
        invUntil: 0,
        kills: 0,
        deaths: 0,
        lockUntil: 0,
        seen: {},
        lastKiller: '',
      };
    }
    return { players, lastTick: ctx.startAt, lastBroadcast: 0, lastScore: 0 };
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    const me = state.players[playerId];
    if (!me) return;
    const now = ctx.now();
    if (input.type === 'moveXY') {
      if (!me.alive) return;
      me.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
      me.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
      me.moveAt = now;
      if (me.dx !== 0 || me.dy !== 0) {
        const l = Math.hypot(me.dx, me.dy);
        me.fx = me.dx / l;
        me.fy = me.dy / l;
      }
      return;
    }
    if (input.type !== 'code') return;
    if (!me.alive || now < ctx.startAt || now >= ctx.startAt + config.endsAt || now < me.lockUntil) return;
    const code = String(input.code ?? '');
    if (!/^\d{3}$/.test(code)) return;

    // mục tiêu phải là người còn sống, đã được MÌNH nhìn thấy trong vài giây gần đây
    const victimId = ctx.playerIds.find((id) => id !== playerId && state.players[id].code === code);
    const victim = victimId ? state.players[victimId] : undefined;
    const seenAt = victimId ? me.seen[victimId] ?? 0 : 0;
    if (!victim || !victimId || !victim.alive || now - seenAt > SEEN_MS) {
      me.lockUntil = now + WRONG_LOCK_MS;
      ctx.send(playerId, { type: 'result', ok: false, reason: 'wrong', lockMs: WRONG_LOCK_MS });
      return;
    }
    if (now < victim.invUntil) {
      ctx.send(playerId, { type: 'result', ok: false, reason: 'shield' });
      return;
    }

    // hạ mục tiêu
    me.kills += 1;
    victim.alive = false;
    victim.deaths += 1;
    victim.dx = victim.dy = 0;
    victim.respawnAt = now + config.respawnMs;
    victim.lastKiller = playerId;
    ctx.send(playerId, { type: 'result', ok: true, victim: victimId });
    ctx.broadcast({ type: 'kill', killer: playerId, victim: victimId, x: Math.round(victim.x), y: Math.round(victim.y) });
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    if (now < ctx.startAt) return;

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (!p.alive) {
        if (now >= p.respawnAt && now < ctx.startAt + config.endsAt) {
          const [x, y] = pickSpawn(state.players, id);
          p.x = x;
          p.y = y;
          p.alive = true;
          p.invUntil = now + INV_MS;
          p.seen = {};
        }
        continue;
      }
      if (now - p.moveAt > HOLD_TIMEOUT) {
        p.dx = 0;
        p.dy = 0;
      }
      stepCode(map, p, p.dx, p.dy, config.speed, dt);
    }

    if (now - state.lastBroadcast < BROADCAST_MS) return;
    state.lastBroadcast = now;

    // tầm nhìn: ai thấy ai (không bị khối che, trong tầm). Người chết "nhìn" từ chỗ đã ngã.
    const vis2 = config.vis * config.vis;
    for (const aid of ctx.playerIds) {
      const a = state.players[aid];
      const others: Record<string, [number, number, string, number, number, number]> = {};
      for (const bid of ctx.playerIds) {
        if (bid === aid) continue;
        const b = state.players[bid];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy > vis2 || !los(map, a.x, a.y, b.x, b.y)) continue;
        // bảng mã nằm cố định trên đầu mỗi người (3D, chỉ mặt trước có số) nên luôn gửi mã cho ai đang thấy người đó;
        // nhưng CHỈ tính là đã đọc được mã khi HAI MẶT ĐỐI NHAU — a quay mặt về b VÀ b quay mặt về a
        const dist = Math.hypot(dx, dy) || 1;
        const aSeesB = (a.fx * dx + a.fy * dy) / dist > FACE_COS;
        const bFacesA = (b.fx * -dx + b.fy * -dy) / dist > FACE_COS;
        const behind = a.alive && aSeesB && bFacesA;
        if (behind) a.seen[bid] = now;
        others[bid] = [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, b.code, now < b.invUntil ? 1 : 0, Math.round(b.fx * 100) / 100, Math.round(b.fy * 100) / 100];
      }
      ctx.send(aid, {
        type: 'pos',
        me: {
          x: Math.round(a.x * 10) / 10,
          y: Math.round(a.y * 10) / 10,
          code: a.code,
          alive: a.alive,
          respawnAt: a.respawnAt,
          inv: now < a.invUntil ? 1 : 0,
          killer: a.alive ? '' : a.lastKiller,
        },
        o: others,
      });
    }

    if (now - state.lastScore >= 600) {
      state.lastScore = now;
      const k: Record<string, number> = {};
      const d: Record<string, number> = {};
      for (const id of ctx.playerIds) {
        k[id] = state.players[id].kills;
        d[id] = state.players[id].deaths;
      }
      ctx.broadcast({ type: 'score', k, d });
    }
  },

  isFinished(ctx, _state, config) {
    return ctx.now() - ctx.startAt >= config.endsAt;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      out[id] = { raw: p.kills * 1000 - p.deaths, detail: `hạ ${p.kills} · bị hạ ${p.deaths}` };
    }
    return out;
  },
};
