import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  autoMove,
  checkWall,
  isLegalMove,
  jumpedOver,
  moveKind,
  newBoard,
  reachedGoal,
  remaining,
  tableSizes,
  type Board,
  type Side,
} from '../../../shared/wallrush.js';

/**
 * ĐUA TƯỜNG (id wallrush) - Quoridor theo bàn 2-4 người, nhiều bàn chạy song song.
 * Server là trọng tài duy nhất: kiểm tra lượt + luật bằng shared/wallrush.ts.
 * Mỗi bàn chỉ gửi trạng thái cho người của bàn đó (thông tin công khai nên config chứa cả bàn chia).
 */
interface TableCfg {
  players: string[];
  sides: Side[];
  walls: number;
}

interface Config {
  tables: TableCfg[];
  turnMs: number;
  afkMs: number;
  endsAt: number;
}

interface Last {
  /** step | jump | diag | wall | auto(bước tự động khi hết giờ) */
  k: string;
  /** ghế vừa hành động */
  s: number;
  /** ghế bị nhảy qua */
  over?: number;
  /** ghế thắng bàn (nếu nước vừa rồi chạm đích) */
  win?: number;
}

interface Table {
  board: Board;
  turn: number;
  turnEndsAt: number;
  winner: number;
  over: boolean;
  overAt: number;
  seq: number;
  afk: boolean[];
  moves: number[];
  /** ghế đặt từng tường (song song với board.walls) */
  owners: number[];
  winElapsed: number;
  last: Last | null;
  lastSent: number;
  /** thứ hạng theo ghế khi bàn kết thúc (order[0] = ghế hạng nhất) */
  order: number[];
}

interface State {
  tables: Table[];
  tableOf: Record<string, number>;
  capped: boolean;
}

const TURN_MS = 12_000;
const FIRST_TURN_MS = 15_000;
const AFK_TURN_MS = 3_000;
const DURATION = 200_000;
const RESEND_MS = 1_500;
const END_GRACE_MS = 2_200;

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** thứ tự hạng trong bàn: người thắng, rồi theo quãng đường còn lại, tường còn lại, ghế */
function rankSeats(t: Table): number[] {
  const n = t.board.pos.length;
  const rem = t.board.pos.map((_, i) => (t.winner === i ? -1 : remaining(t.board, i)));
  return Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => rem[a] - rem[b] || t.board.wallsLeft[b] - t.board.wallsLeft[a] || a - b,
  );
}

function publish(t: Table, ti: number, cfg: TableCfg, ctx: { send(id: string, p: any): void }, now: number) {
  const payload = {
    type: 'tb',
    ti,
    seq: t.seq,
    pos: t.board.pos.map((p) => [p.x, p.y]),
    walls: t.board.walls.map((w, i) => [w.x, w.y, w.o, t.owners[i]]),
    wl: t.board.wallsLeft,
    turn: t.over ? -1 : t.turn,
    endsAt: t.turnEndsAt,
    winner: t.winner,
    over: t.over,
    order: t.over ? t.order : undefined,
    last: t.last ?? undefined,
  };
  t.lastSent = now;
  for (const id of cfg.players) ctx.send(id, payload);
}

function finishTable(t: Table, now: number, winner: number, startAt: number) {
  t.over = true;
  t.overAt = now;
  t.winner = winner;
  if (winner >= 0) t.winElapsed = now - startAt;
  t.order = rankSeats(t);
}

function advance(t: Table, now: number) {
  t.turn = (t.turn + 1) % t.board.pos.length;
  t.turnEndsAt = now + (t.afk[t.turn] ? AFK_TURN_MS : TURN_MS);
}

export const wallRushGame: GameDefinition<Config, State> = {
  id: 'wallrush',
  name: 'ĐUA TƯỜNG',
  instructions:
    'Đưa quân của bạn sang cạnh bàn cờ đối diện trước mọi người. Mỗi lượt chỉ làm MỘT việc: đi một ô, hoặc đặt tường chặn đường đối thủ (không được bít kín hẳn đường về đích). Hết giờ lượt, quân sẽ tự đi một bước.',
  controls: [
    { keys: ['CLICK'], desc: 'Bấm ô sáng để đi quân' },
    { keys: ['W'], desc: 'Bật/tắt chế độ ĐẶT TƯỜNG, bấm vào rãnh để đặt' },
    { keys: ['R'], desc: 'Xoay tường ngang/dọc' },
    { keys: ['ESC'], desc: 'Quay lại chế độ đi quân' },
  ],
  duration: DURATION + 5000,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const ids = shuffle([...ctx.playerIds]);
    const sizes = tableSizes(ids.length);
    const tables: TableCfg[] = [];
    let at = 0;
    for (const sz of sizes) {
      const b = newBoard(sz);
      tables.push({ players: ids.slice(at, at + sz), sides: b.sides, walls: b.wallsLeft[0] });
      at += sz;
    }
    return { tables, turnMs: TURN_MS, afkMs: AFK_TURN_MS, endsAt: DURATION };
  },

  createState(ctx, config) {
    const tableOf: Record<string, number> = {};
    const tables = config.tables.map((tc, ti) => {
      tc.players.forEach((id) => (tableOf[id] = ti));
      const t: Table = {
        board: newBoard(tc.players.length),
        turn: 0,
        turnEndsAt: ctx.startAt + FIRST_TURN_MS,
        winner: -1,
        over: false,
        overAt: 0,
        seq: 0,
        afk: tc.players.map(() => false),
        moves: tc.players.map(() => 0),
        owners: [],
        winElapsed: 0,
        last: null,
        lastSent: 0,
        order: [],
      };
      return t;
    });
    return { tables, tableOf, capped: false };
  },

  onStart(ctx, state, config) {
    const now = ctx.now();
    state.tables.forEach((t, ti) => publish(t, ti, config.tables[ti], ctx, now));
  },

  handleInput(ctx, state, config, playerId, input: GameInput) {
    if (input.type !== 'wmove' && input.type !== 'wwall') return;
    const now = ctx.now();
    if (now < ctx.startAt || state.capped) return;
    const ti = state.tableOf[playerId];
    if (ti === undefined) return;
    const t = state.tables[ti];
    const tc = config.tables[ti];
    if (t.over) return;
    const seat = tc.players.indexOf(playerId);
    if (seat < 0 || seat !== t.turn) return;

    let last: Last;
    if (input.type === 'wmove') {
      const to = { x: Number(input.x), y: Number(input.y) };
      if (!Number.isInteger(to.x) || !Number.isInteger(to.y)) return;
      if (!isLegalMove(t.board, seat, to)) return;
      const jo = jumpedOver(t.board, seat, to);
      const kind = moveKind(t.board.pos[seat], to);
      t.board.pos[seat] = to;
      last = { k: kind, s: seat, ...(jo >= 0 ? { over: jo } : {}) };
    } else {
      const w = { x: Number(input.x), y: Number(input.y), o: input.o };
      if (!checkWall(t.board, seat, w).ok) return;
      t.board.walls.push(w);
      t.owners.push(seat);
      t.board.wallsLeft[seat] -= 1;
      last = { k: 'wall', s: seat };
    }
    t.afk[seat] = false;
    t.moves[seat] += 1;
    t.seq += 1;
    t.last = last;
    if (last.k !== 'wall' && reachedGoal(t.board.sides[seat], t.board.pos[seat])) {
      last.win = seat;
      finishTable(t, now, seat, ctx.startAt);
    } else {
      advance(t, now);
    }
    publish(t, ti, tc, ctx, now);
  },

  update(ctx, state, config) {
    const now = ctx.now();
    if (now < ctx.startAt) return;
    const capNow = now - ctx.startAt >= config.endsAt;
    state.tables.forEach((t, ti) => {
      const tc = config.tables[ti];
      if (t.over) {
        if (now - t.lastSent > RESEND_MS * 2) publish(t, ti, tc, ctx, now);
        return;
      }
      if (capNow) {
        state.capped = true;
        finishTable(t, now, -1, ctx.startAt);
        t.seq += 1;
        publish(t, ti, tc, ctx, now);
        return;
      }
      if (now >= t.turnEndsAt) {
        const seat = t.turn;
        const to = autoMove(t.board, seat);
        t.afk[seat] = true;
        t.seq += 1;
        if (to) {
          const jo = jumpedOver(t.board, seat, to);
          t.board.pos[seat] = to;
          t.moves[seat] += 1;
          t.last = { k: 'auto', s: seat, ...(jo >= 0 ? { over: jo } : {}) };
          if (reachedGoal(t.board.sides[seat], to)) {
            t.last.win = seat;
            finishTable(t, now, seat, ctx.startAt);
            publish(t, ti, tc, ctx, now);
            return;
          }
        } else {
          t.last = { k: 'auto', s: seat };
        }
        advance(t, now);
        publish(t, ti, tc, ctx, now);
        return;
      }
      if (now - t.lastSent >= RESEND_MS) publish(t, ti, tc, ctx, now);
    });
  },

  isFinished(ctx, state) {
    if (!state.tables.every((t) => t.over)) return false;
    const last = state.tables.reduce((m, t) => Math.max(m, t.overAt), 0);
    return ctx.now() - last >= END_GRACE_MS;
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    state.tables.forEach((t, ti) => {
      const tc = config.tables[ti];
      const n = tc.players.length;
      const order = t.over ? t.order : rankSeats(t);
      const label = config.tables.length > 1 ? `bàn ${ti + 1}` : 'bàn';
      order.forEach((seat, idx) => {
        const rank = idx + 1;
        const wl = t.board.wallsLeft[seat];
        const won = t.winner === seat;
        let base = n > 1 ? ((n - rank) / (n - 1)) * 1000 : 1000;
        // bàn không ai chạm đích: điểm hạng nhẹ hơn một chút so với thắng thật
        if (t.winner < 0) base *= 0.9;
        let bonus = wl * 6;
        if (won) bonus += Math.round(100 * Math.max(0, 1 - t.winElapsed / config.endsAt));
        const raw = Math.round(base + bonus);
        const far = remaining(t.board, seat);
        let detail: string;
        if (won) detail = `thắng ${label} · còn ${wl} tường`;
        else if (t.winner >= 0) detail = `hạng ${rank}/${n} ${label} · cách đích ${far} bước`;
        else detail = `${rank === 1 ? 'dẫn đầu' : `hạng ${rank}/${n}`} ${label} khi hết giờ · cách đích ${far} bước`;
        out[tc.players[seat]] = { raw, detail };
      });
    });
    for (const id of ctx.playerIds) out[id] ??= { raw: 0, detail: 'không vào bàn' };
    return out;
  },
};
