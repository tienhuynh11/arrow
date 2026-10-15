import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  ART_TOPICS,
  BONUS_FAIL,
  BONUS_FUNNY,
  MAX_STROKES_PER_MSG,
  VOTE_MAIN_POINTS,
  cleanStroke,
  mergeStrokes,
  type ArtStroke,
  type VoteKind,
} from '../../../shared/artshow.js';

/** ĐẠI HỘI HỌA SĨ: vẽ theo chủ đề → xem tranh ẩn danh và bình chọn → công bố tên + giải phụ.
 *  Tranh lưu dạng NÉT (số nguyên), mỗi tranh ≤ MAX_DRAWING_BYTES, xoá hết sau calculateScore. */

interface Config {
  topic: string;
  drawMs: number;
  voteMs: number;
  resultMs: number;
  graceMs: number;
  artVersion: 1;
}

export interface ArtRow {
  k: number;
  id: string;
  /** phiếu chính / phiếu hài nhất / phiếu thảm họa nhận được */
  m: number;
  h: number;
  t: number;
  raw: number;
}

export interface ArtTally {
  rows: ArtRow[];
  win: number[];
  fun: number[];
  fail: number[];
}

interface State {
  phase: 'draw' | 'vote' | 'result';
  started: boolean;
  drawEnd: number;
  voteStart: number;
  voteEnd: number;
  resultEnd: number;
  drawings: Map<string, ArtStroke[]>;
  final: Set<string>;
  budget: Map<string, { sec: number; n: number; bytes: number }>;
  syncAt: Map<string, number>;
  /** k → tác giả (chỉ lộ ở pha kết quả) */
  order: string[];
  keyOf: Map<string, number>;
  mainVote: Map<string, number>;
  subVote: Map<string, { c: 'h' | 't'; k: number }>;
  tally: ArtTally | null;
  lastResend: number;
  progDirty: boolean;
  lastProg: number;
  /** cả phòng đã bầu xong → rút ngắn pha bình chọn */
  votedAll: boolean;
}

const DRAW_MS = 55_000;
const GRACE_MS = 2_500;
const VOTE_MS = 22_000;
const RESULT_MS = 10_000;
const SLACK_MS = 4_000;
const RESEND_MS = 2_000;
const FAST_END_MS = 3_000;
/** tối đa 8 tin vẽ/giây/người (bản nộp cuối f=1 luôn được nhận) và ~400 KB mỗi người mỗi ván */
const MAX_MSGS_PER_SEC = 8;
const MAX_BYTES_PER_PLAYER = 400_000;

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const topWinners = (counts: number[]): number[] => {
  const max = Math.max(0, ...counts);
  if (max <= 0) return [];
  return counts.flatMap((c, k) => (c === max ? [k] : []));
};

/** Đếm phiếu → điểm. Phiếu chính 100 điểm/phiếu; giải phụ cộng thưởng nhỏ (hoà thì cùng nhận). Bỏ qua tự bình chọn. */
export function tallyVotes(
  order: string[],
  mainVote: Map<string, number>,
  subVote: Map<string, { c: 'h' | 't'; k: number }>,
): ArtTally {
  const m = order.map(() => 0);
  const h = order.map(() => 0);
  const t = order.map(() => 0);
  for (const [voter, k] of mainVote) if (k >= 0 && k < order.length && order[k] !== voter) m[k]++;
  for (const [voter, v] of subVote) {
    if (v.k < 0 || v.k >= order.length || order[v.k] === voter) continue;
    if (v.c === 'h') h[v.k]++;
    else t[v.k]++;
  }
  const fun = topWinners(h);
  const fail = topWinners(t);
  const rows = order.map(
    (id, k): ArtRow => ({
      k,
      id,
      m: m[k],
      h: h[k],
      t: t[k],
      raw: m[k] * VOTE_MAIN_POINTS + (fun.includes(k) ? BONUS_FUNNY : 0) + (fail.includes(k) ? BONUS_FAIL : 0),
    }),
  );
  rows.sort((a, b) => b.raw - a.raw || a.k - b.k);
  return { rows, win: topWinners(m), fun, fail };
}

const phaseMsg = (s: State, cfg: Config, startAt: number) => {
  if (s.phase === 'draw') return { type: 'ph', ph: 'draw', topic: cfg.topic, startAt, endAt: s.drawEnd };
  if (s.phase === 'vote') return { type: 'ph', ph: 'vote', startAt: s.voteStart, endAt: s.voteEnd, n: s.order.length };
  return { type: 'ph', ph: 'result', startAt: s.voteEnd, endAt: s.resultEnd };
};

const resMsg = (s: State) => ({ type: 'res', ...s.tally!, endAt: s.resultEnd });

const myVotes = (s: State, id: string) => {
  const sub = s.subVote.get(id);
  return { type: 'my', m: s.mainVote.get(id) ?? -1, c: sub?.c ?? null, k: sub?.k ?? -1 };
};

type Ctx = Parameters<GameDefinition['update']>[0];

function sendPics(ctx: Ctx, s: State, to?: string) {
  const out = (p: any) => (to ? ctx.send(to, p) : ctx.broadcast(p));
  s.order.forEach((id, k) => out({ type: 'pic', k, s: s.drawings.get(id) ?? [] }));
}

function startVote(ctx: Ctx, s: State, cfg: Config, now: number) {
  // chỉ tranh có nét mới được đưa lên; thứ tự xáo ngẫu nhiên nên số thứ tự không lộ ai vẽ
  s.order = shuffle(ctx.playerIds.filter((id) => (s.drawings.get(id)?.length ?? 0) > 0));
  s.order.forEach((id, k) => s.keyOf.set(id, k));
  if (s.order.length < 2) {
    startResult(ctx, s, cfg, now);
    return;
  }
  s.phase = 'vote';
  s.voteStart = now;
  s.voteEnd = now + cfg.voteMs;
  s.lastResend = now;
  ctx.broadcast(phaseMsg(s, cfg, 0));
  sendPics(ctx, s);
  for (const id of ctx.playerIds) ctx.send(id, { type: 'mine', k: s.keyOf.get(id) ?? -1 });
  ctx.broadcast({ type: 'vp', voted: 0, total: ctx.playerIds.length });
}

function startResult(ctx: Ctx, s: State, cfg: Config, now: number) {
  s.phase = 'result';
  s.voteEnd = s.voteEnd ? Math.min(s.voteEnd, now) : now;
  s.resultEnd = now + cfg.resultMs;
  s.tally = tallyVotes(s.order, s.mainVote, s.subVote);
  s.lastResend = now;
  ctx.broadcast(phaseMsg(s, cfg, 0));
  if (s.order.length < 2) sendPics(ctx, s);
  ctx.broadcast(resMsg(s));
}

export const artShowGame: GameDefinition<Config, State> = {
  id: 'artshow',
  name: 'ĐẠI HỘI HỌA SĨ',
  instructions:
    'Cả phòng nhận cùng một chủ đề và có 55 giây để vẽ. Hết giờ, tranh được đưa lên màn hình ẩn danh để mọi người bình chọn: một phiếu ❤️ cho tranh bạn thích nhất, thêm một phiếu phụ 🤣 hài nhất hoặc 💩 thảm họa nghệ thuật. Không được bình chọn tranh của chính mình. Tên họa sĩ chỉ lộ sau khi bình chọn xong.',
  controls: [
    { keys: ['KÉO'], desc: 'Vẽ bằng chuột / ngón tay' },
    { keys: ['CHẠM'], desc: 'Chọn tranh để phóng to và bình chọn' },
  ],
  duration: DRAW_MS + GRACE_MS + VOTE_MS + RESULT_MS + SLACK_MS,
  // 3 người trở lên: với 2 người mỗi người chỉ có đúng 1 tranh để chọn nên bình chọn vô nghĩa
  minPlayers: 3,
  maxPlayers: 16,

  createConfig() {
    return {
      topic: ART_TOPICS[Math.floor(Math.random() * ART_TOPICS.length)],
      drawMs: DRAW_MS,
      voteMs: VOTE_MS,
      resultMs: RESULT_MS,
      graceMs: GRACE_MS,
      artVersion: 1,
    };
  },

  createState(ctx, cfg) {
    return {
      phase: 'draw',
      started: false,
      drawEnd: ctx.startAt + cfg.drawMs,
      voteStart: 0,
      voteEnd: 0,
      resultEnd: 0,
      drawings: new Map(),
      final: new Set(),
      budget: new Map(),
      syncAt: new Map(),
      order: [],
      keyOf: new Map(),
      mainVote: new Map(),
      subVote: new Map(),
      tally: null,
      lastResend: 0,
      progDirty: false,
      lastProg: 0,
      votedAll: false,
    };
  },

  handleInput(ctx, s, cfg, playerId, input: GameInput) {
    if (!s.started || !ctx.playerIds.includes(playerId)) return;
    const now = ctx.now();
    const t = (input as { type?: unknown }).type;

    if (t === 'adraw') {
      if (s.phase !== 'draw' || now > s.drawEnd + cfg.graceMs) return;
      const inp = input as Extract<GameInput, { type: 'adraw' }>;
      const isFinal = inp.f === 1 && now >= s.drawEnd - 1000;
      const b = s.budget.get(playerId) ?? { sec: 0, n: 0, bytes: 0 };
      const sec = Math.floor(now / 1000);
      if (b.sec !== sec) {
        b.sec = sec;
        b.n = 0;
      }
      s.budget.set(playerId, b);
      if (!isFinal && b.n >= MAX_MSGS_PER_SEC) return;
      b.n++;
      if (!Array.isArray(inp.s) || inp.s.length > MAX_STROKES_PER_MSG) return;
      b.bytes += inp.s.length * 24;
      if (b.bytes > MAX_BYTES_PER_PLAYER && !isFinal) return;
      const tail: ArtStroke[] = [];
      for (const raw of inp.s) {
        const c = cleanStroke(raw);
        if (c) tail.push(c);
      }
      const base = s.drawings.get(playerId) ?? [];
      const next = mergeStrokes(base, inp.n, tail);
      if (!next) return; // lệch vị trí hoặc vượt giới hạn: bỏ; bản sao lưu đầy đủ (n=0) sau đó sẽ sửa
      s.drawings.set(playerId, next);
      if (isFinal) s.final.add(playerId);
      return;
    }

    if (t === 'avote') {
      if (s.phase !== 'vote' || now >= s.voteEnd) return;
      const inp = input as Extract<GameInput, { type: 'avote' }>;
      const { k, c } = inp;
      if (c !== 'm' && c !== 'h' && c !== 't') return;
      if (typeof k !== 'number' || !Number.isInteger(k)) return;
      const kind: VoteKind = c;
      if (k === -1) {
        if (kind === 'm') s.mainVote.delete(playerId);
        else if (s.subVote.get(playerId)?.c === kind) s.subVote.delete(playerId);
      } else {
        if (k < 0 || k >= s.order.length) return;
        if (s.order[k] === playerId) return; // cấm tự bình chọn
        if (kind === 'm') s.mainVote.set(playerId, k);
        else s.subVote.set(playerId, { c: kind, k });
      }
      ctx.send(playerId, myVotes(s, playerId));
      s.progDirty = true;
      if (!s.votedAll && ctx.playerIds.every((id) => s.mainVote.has(id))) {
        s.votedAll = true;
        s.voteEnd = Math.min(s.voteEnd, now + FAST_END_MS);
        ctx.broadcast(phaseMsg(s, cfg, 0));
      }
      return;
    }

    if (t === 'async') {
      if (now - (s.syncAt.get(playerId) ?? 0) < 1000) return;
      s.syncAt.set(playerId, now);
      ctx.send(playerId, phaseMsg(s, cfg, ctx.startAt));
      if (s.phase === 'draw') {
        const mine = s.drawings.get(playerId);
        if (mine?.length) ctx.send(playerId, { type: 'mydraw', s: mine });
      } else {
        sendPics(ctx, s, playerId);
        ctx.send(playerId, { type: 'mine', k: s.keyOf.get(playerId) ?? -1 });
        ctx.send(playerId, myVotes(s, playerId));
        ctx.send(playerId, { type: 'vp', voted: s.mainVote.size, total: ctx.playerIds.length });
        if (s.phase === 'result' && s.tally) ctx.send(playerId, resMsg(s));
      }
    }
  },

  onStart(ctx, s, cfg) {
    s.started = true;
    s.lastResend = ctx.now();
    ctx.broadcast(phaseMsg(s, cfg, ctx.startAt));
  },

  update(ctx, s, cfg) {
    const now = ctx.now();
    if (!s.started) {
      // Room gọi onStart; phòng hờ nếu update tới trước
      s.started = true;
      ctx.broadcast(phaseMsg(s, cfg, ctx.startAt));
      s.lastResend = now;
    }
    if (s.phase === 'draw') {
      const allIn = now >= s.drawEnd && ctx.playerIds.every((id) => s.final.has(id));
      if (allIn || now >= s.drawEnd + cfg.graceMs) startVote(ctx, s, cfg, now);
      else if (now - s.lastResend >= RESEND_MS) {
        s.lastResend = now;
        ctx.broadcast(phaseMsg(s, cfg, ctx.startAt));
      }
      return;
    }
    if (s.phase === 'vote') {
      if (now >= s.voteEnd) {
        startResult(ctx, s, cfg, now);
        return;
      }
      if (s.progDirty && now - s.lastProg >= 250) {
        s.progDirty = false;
        s.lastProg = now;
        ctx.broadcast({ type: 'vp', voted: s.mainVote.size, total: ctx.playerIds.length });
      }
      if (now - s.lastResend >= RESEND_MS) {
        s.lastResend = now;
        ctx.broadcast(phaseMsg(s, cfg, 0));
      }
      return;
    }
    if (now - s.lastResend >= RESEND_MS && now < s.resultEnd) {
      s.lastResend = now;
      ctx.broadcast(phaseMsg(s, cfg, 0));
      ctx.broadcast(resMsg(s));
    }
  },

  isFinished(ctx, s) {
    return s.phase === 'result' && ctx.now() >= s.resultEnd;
  },

  calculateScore(ctx, s) {
    const tally = s.tally ?? tallyVotes(s.order, s.mainVote, s.subVote);
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) out[id] = { raw: 0, detail: 'không có tranh' };
    for (const r of tally.rows) {
      const tags = [
        tally.win.includes(r.k) && r.m > 0 ? '🏆' : '',
        tally.fun.includes(r.k) ? '🤣 Hài nhất' : '',
        tally.fail.includes(r.k) ? '💩 Thảm họa' : '',
      ].filter(Boolean);
      out[r.id] = { raw: r.raw, detail: `${r.m} phiếu ❤️${tags.length ? ' · ' + tags.join(' ') : ''}` };
    }
    // dọn dữ liệu ván để không giữ tranh trong RAM
    s.drawings.clear();
    s.final.clear();
    s.budget.clear();
    s.syncAt.clear();
    s.keyOf.clear();
    s.mainVote.clear();
    s.subVote.clear();
    s.order = [];
    s.tally = null;
    return out;
  },
};
