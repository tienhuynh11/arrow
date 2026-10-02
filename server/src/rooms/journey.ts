import { JOURNEY_TURNS, MOVE_BASE_MS, MOVE_STEP_MS, ROLL_MS, TILES, culturePoints } from '../../../shared/board.js';
import type { BoardAward, BoardState, TileInfo } from '../../../shared/protocol.js';

// Logic thuần của chế độ "Hành Trình Xuyên Việt": không đụng tới mạng hay đồng hồ phòng,
// nhờ vậy dễ kiểm tra riêng. Room.ts chỉ điều phối các bước này.

/** số lượt của trận; JOURNEY_TURNS=3 (biến môi trường) để chạy thử nhanh khi phát triển */
function turnsPerMatch(): number {
  const n = Math.round(Number(process.env.JOURNEY_TURNS));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : JOURNEY_TURNS;
}

export function createBoard(playerIds: string[]): BoardState {
  const pos: Record<string, number> = {};
  const from: Record<string, number> = {};
  const dice: Record<string, number> = {};
  const badges: Record<string, number[]> = {};
  for (const id of playerIds) {
    pos[id] = 0; // ai cũng xuất phát ở Hà Nội
    from[id] = 0;
    dice[id] = 0;
    badges[id] = [];
  }
  return {
    turn: 0,
    totalTurns: turnsPerMatch(),
    stage: 'roll',
    rollerId: '',
    deadline: 0,
    tileIndex: -1,
    pos,
    from,
    dice,
    badges,
  };
}

/** Mở lượt mới: chọn chủ xúc xắc và mở cửa sổ tung. */
export function beginTurn(board: BoardState, rollerId: string, now: number) {
  board.turn += 1;
  board.stage = 'roll';
  board.rollerId = rollerId;
  board.deadline = now + ROLL_MS;
  board.tileIndex = -1;
  for (const id of Object.keys(board.pos)) {
    board.dice[id] = 0;
    board.from[id] = board.pos[id];
  }
}

/**
 * Chủ xúc xắc xoay vòng theo thứ tự ghế: lượt k thuộc người thứ (k-1) mod n.
 * Chỉ tính người đang kết nối để không phải chờ ai đó đã rời.
 */
export function pickRoller(turn: number, connectedIds: string[]): string {
  if (connectedIds.length === 0) return '';
  return connectedIds[(turn - 1) % connectedIds.length];
}

/**
 * Server tung 1–6 cho MỌI người cùng lúc, mỗi quân đi theo xúc xắc của mình.
 * Ô nơi quân của chủ xúc xắc dừng lại quyết định tỉnh/minigame của lượt.
 */
export function rollAll(board: BoardState, now: number, rng: () => number = Math.random) {
  for (const id of Object.keys(board.pos)) {
    const d = 1 + Math.floor(rng() * 6);
    board.dice[id] = d;
    board.from[id] = board.pos[id];
    board.pos[id] = (board.pos[id] + d) % TILES.length;
  }
  board.tileIndex = board.pos[board.rollerId] ?? 0;
  board.stage = 'moving';
  const longest = Math.max(1, ...Object.values(board.dice));
  board.deadline = now + MOVE_BASE_MS + MOVE_STEP_MS * longest;
}

export function tileInfo(index: number): TileInfo {
  const t = TILES[index];
  return {
    index,
    id: t.id,
    name: t.name,
    emoji: t.emoji,
    specialty: t.specialty,
    title: t.title,
    value: t.value,
    festival: !!t.festival,
  };
}

/**
 * Chia Điểm Văn Hoá cho lượt vừa chơi (dựa trên hạng minigame) và ghi huy hiệu đặc sản cho người về nhất.
 * Hạng đồng nhau nhận cùng mức điểm; huy hiệu chỉ cộng điểm "sưu tập" ở lần đầu tiên.
 */
export function awardTurn(board: BoardState, ranks: { playerId: string; rank: number }[]): Record<string, BoardAward> {
  const tile = TILES[board.tileIndex];
  const awards: Record<string, BoardAward> = {};
  for (const { playerId, rank } of ranks) {
    const owned = (board.badges[playerId] ??= []);
    const isNewBadge = rank === 1 && !owned.includes(board.tileIndex);
    const home = board.pos[playerId] === board.tileIndex;
    awards[playerId] = { points: culturePoints(tile, rank, home, isNewBadge), home, badge: isNewBadge };
    if (isNewBadge) owned.push(board.tileIndex);
  }
  return awards;
}
