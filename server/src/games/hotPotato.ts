import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import { stepBody, type ArenaBox, type ArenaCfg } from '../../../shared/bombArena.js';

/**
 * Đuổi bắt bom: vài người ôm bom đang cháy ngòi và phải đuổi theo CHẠM người khác để chuyền bom đi.
 * Hết ngòi, ai đang ôm bom thì nổ và bị loại; vòng sau bom gắn cho người khác (ngòi ngắn dần) cho tới khi còn một người.
 * Sân rộng có thùng, bục và cột: nhảy (SPACE) lên bục để né; người ôm bom chạy nhanh hơn một chút.
 */
interface Config extends ArenaCfg {
  speed: number;
  /** người ôm bom chạy nhanh hơn một chút để còn đuổi kịp */
  carrierBoost: number;
  tagRadius: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  z: number;
  vz: number;
  dx: number;
  dy: number;
  moveAt: number;
  /** lúc bấm nhảy gần nhất; còn hiệu lực một lúc để bấm hơi sớm vẫn nhảy */
  jumpAt: number;
  tags: number;
  /** vừa chuyền/nhận bom xong thì miễn nhiễm một lúc, tránh chạm qua chạm lại */
  safeUntil: number;
  /** người vừa chuyền bom cho mình: tạm thời không được tống ngược lại */
  backId: string;
  backUntil: number;
  outAt: number | null;
  outRound: number;
}

interface State {
  players: Record<string, PState>;
  order: string[];
  holders: string[];
  fuseEnd: number;
  fuseLen: number;
  round: number;
  lastBlast: number;
  lastTick: number;
  lastBroadcast: number;
}

const W = 320;
const H = 210;
const SPEED = 50;
const CARRIER_BOOST = 1.14;
const TAG_RADIUS = 11;
const TAG_DZ = 6.5;
const PLAYER_R = 5;
const TAG_IMMUNITY = 900;
const HOLD_TIMEOUT = 900;
const JUMP_BUFFER = 150;
const BACK_BLOCK = 2600;
const BLAST_GRACE = 1700;
const DURATION = 95_000;

/** ngòi ngắn dần theo vòng: 14 giây → 7 giây */
const fuseFor = (round: number) => Math.max(7000, 14_000 - round * 1500);
/** luôn đúng một quả bom */
const bombsFor = () => 1;

/** bố cục đối xứng trái-phải: bục sân khấu giữa sân, các cụm thùng/bục để leo, tường thấp để nhảy qua, cột cao để núp */
function makeBoxes(): ArenaBox[] {
  const half: ArenaBox[] = [
    { x: 70, y: 50, w: 22, d: 22, h: 6, kind: 'crate' },
    { x: 92, y: 50, w: 22, d: 22, h: 12, kind: 'block' },
    { x: 60, y: 150, w: 20, d: 20, h: 6, kind: 'crate' },
    { x: 60, y: 172, w: 20, d: 20, h: 6, kind: 'crate' },
    { x: 112, y: 150, w: 8, d: 50, h: 6, kind: 'wall' },
    { x: 106, y: 96, w: 14, d: 14, h: 24, kind: 'pillar' },
    { x: 36, y: 104, w: 16, d: 16, h: 6, kind: 'crate' },
    { x: 132, y: 28, w: 18, d: 14, h: 6, kind: 'crate' },
    { x: 140, y: 184, w: 18, d: 14, h: 12, kind: 'block' },
  ];
  const out: ArenaBox[] = [{ x: W / 2, y: H / 2, w: 60, d: 44, h: 6, kind: 'stage' }, { x: W / 2, y: H / 2, w: 28, d: 20, h: 12, kind: 'block' }];
  for (const b of half) {
    out.push(b, { ...b, x: W - b.x });
  }
  return out;
}

function freeSpot(boxes: ArenaBox[], x: number, y: number): boolean {
  if (x < PLAYER_R + 4 || x > W - PLAYER_R - 4 || y < PLAYER_R + 4 || y > H - PLAYER_R - 4) return false;
  for (const b of boxes) {
    const nx = Math.max(b.x - b.w / 2, Math.min(b.x + b.w / 2, x));
    const ny = Math.max(b.y - b.d / 2, Math.min(b.y + b.d / 2, y));
    if (Math.hypot(nx - x, ny - y) < PLAYER_R + 4) return false;
  }
  return true;
}

export const hotPotatoGame: GameDefinition<Config, State> = {
  id: 'bomb',
  name: 'ĐUỔI BẮT BOM',
  instructions:
    'Người ôm BOM phải đuổi và CHẠM người khác để chuyền bom đi. Hết giờ, ai đang ôm bom thì NỔ và bị loại. ' +
    'Nhấn SPACE để nhảy lên thùng, bục mà né. Người sống sót cuối cùng thắng.',
  controls: [
    { keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy mọi hướng' },
    { keys: ['SPACE'], desc: 'Nhảy lên thùng, bục · nhảy qua tường thấp' },
  ],
  duration: DURATION + 2500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const boxes = makeBoxes();
    const n = ctx.playerIds.length;
    const spawns: Record<string, [number, number]> = {};
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // xếp đều trên một vòng elip; vướng khối thì thu/phóng vòng cho tới khi trống chỗ
    ids.forEach((id, i) => {
      const a = (i / n) * Math.PI * 2 + 0.2;
      for (const f of [1, 0.9, 1.1, 0.8, 1.2, 0.7, 0.6, 0.5]) {
        const x = W / 2 + Math.cos(a) * W * 0.36 * f;
        const y = H / 2 + Math.sin(a) * H * 0.36 * f;
        if (freeSpot(boxes, x, y) || f === 0.5) {
          spawns[id] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
          break;
        }
      }
    });
    return {
      w: W,
      h: H,
      speed: SPEED,
      carrierBoost: CARRIER_BOOST,
      tagRadius: TAG_RADIUS,
      playerRadius: PLAYER_R,
      boxes,
      endsAt: DURATION,
      spawns,
    };
  },

  createState(ctx, config) {
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, z: 0, vz: 0, dx: 0, dy: 0, moveAt: 0, jumpAt: 0, tags: 0, safeUntil: 0, backId: '', backUntil: 0, outAt: null, outRound: 0 };
    }
    const order = [...ctx.playerIds];
    const pool = [...order];
    const holders: string[] = [];
    for (let i = bombsFor(); i > 0; i--) holders.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    const fuseLen = fuseFor(0);
    return {
      players,
      order,
      holders,
      fuseEnd: ctx.startAt + fuseLen,
      fuseLen,
      round: 0,
      lastBlast: 0,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
    };
  },

  onStart(ctx, state) {
    ctx.broadcast({ type: 'bomb', holders: state.holders, fuseEnd: state.fuseEnd, fuseLen: state.fuseLen, round: 0 });
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    const p = state.players[playerId];
    if (!p || p.outAt !== null) return;
    if (input.type === 'jump') {
      if (ctx.now() >= ctx.startAt) p.jumpAt = ctx.now();
      return;
    }
    if (input.type !== 'moveXY') return;
    // chỉ nhận -1 / 0 / 1, tự chuẩn hoá để không ai đi chéo nhanh hơn
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;

    if (dt > 0 && now >= ctx.startAt) {
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.outAt !== null) continue;
        if (now - p.moveAt > HOLD_TIMEOUT) {
          p.dx = 0;
          p.dy = 0;
        }
        const sp = config.speed * (state.holders.includes(id) ? config.carrierBoost : 1);
        stepBody(config, p, p.dx, p.dy, sp, now - p.jumpAt < JUMP_BUFFER, dt);
        if (p.vz > 0) p.jumpAt = 0;
      }
    }

    // người ôm bom chạm được ai (cùng độ cao) thì tống bom sang người đó
    for (const hid of [...state.holders]) {
      const h = state.players[hid];
      if (!h || h.outAt !== null || now < h.safeUntil) continue;
      for (const id of ctx.playerIds) {
        if (id === hid || state.holders.includes(id)) continue;
        const t = state.players[id];
        if (t.outAt !== null || now < t.safeUntil) continue;
        if (h.backId === id && now < h.backUntil) continue;
        if (Math.hypot(h.x - t.x, h.y - t.y) <= config.tagRadius && Math.abs(h.z - t.z) <= TAG_DZ) {
          h.tags += 1;
          h.safeUntil = now + TAG_IMMUNITY;
          t.safeUntil = now + TAG_IMMUNITY;
          t.backId = hid;
          t.backUntil = now + BACK_BLOCK;
          state.holders[state.holders.indexOf(hid)] = id;
          ctx.broadcast({ type: 'tag', from: hid, to: id });
          break;
        }
      }
    }

    if (now >= state.fuseEnd) {
      for (const hid of state.holders) {
        const v = state.players[hid];
        v.outAt = now;
        v.outRound = state.round + 1;
        v.dx = v.dy = 0;
        ctx.broadcast({ type: 'blast', playerId: hid, at: rel });
      }
      state.lastBlast = now;
      const alive = state.order.filter((id) => state.players[id].outAt === null);
      state.holders = [];
      if (alive.length <= 1) {
        state.fuseEnd = Number.POSITIVE_INFINITY;
      } else {
        state.round += 1;
        const pool = [...alive];
        for (let i = bombsFor(); i > 0; i--) state.holders.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        for (const hid of state.holders) state.players[hid].safeUntil = now + TAG_IMMUNITY;
        state.fuseLen = fuseFor(state.round);
        state.fuseEnd = now + state.fuseLen + 1200;
        ctx.broadcast({ type: 'bomb', holders: state.holders, fuseEnd: state.fuseEnd, fuseLen: state.fuseLen + 1200, round: state.round });
      }
    }

    if (now - state.lastBroadcast < 60) return;
    state.lastBroadcast = now;
    const pos: Record<string, { x: number; y: number; z: number; safe: boolean; out: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      pos[id] = {
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        z: Math.round(p.z * 10) / 10,
        safe: now < p.safeUntil,
        out: p.outAt !== null,
      };
    }
    // kèm danh sách người ôm bom + ngòi nổ để người vừa kết nối lại giữa ván vẫn thấy đủ
    ctx.broadcast({
      type: 'pos',
      positions: pos,
      holders: state.holders,
      round: state.round,
      fuseEnd: Number.isFinite(state.fuseEnd) ? state.fuseEnd : null,
      fuseLen: state.fuseLen + (state.round > 0 ? 1200 : 0),
    });
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    const alive = state.order.filter((id) => state.players[id].outAt === null).length;
    // chờ vụ nổ cuối diễn xong rồi mới chốt kết quả
    return alive <= 1 && state.lastBlast > 0 && now - state.lastBlast >= BLAST_GRACE;
  },

  calculateScore(ctx, state) {
    const alive = ctx.playerIds.filter((id) => state.players[id].outAt === null).length;
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.outAt !== null) {
        out[id] = { raw: Math.max(0, p.outAt - ctx.startAt) + p.tags, detail: `nổ ở vòng ${p.outRound} · chuyền ${p.tags}` };
      } else {
        out[id] = {
          raw: 1_000_000 + p.tags,
          detail: alive === 1 ? `🏆 sống sót cuối cùng · chuyền ${p.tags}` : `sống sót đến hết giờ · chuyền ${p.tags}`,
        };
      }
    }
    return out;
  },
};
