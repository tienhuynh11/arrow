// Shared wire protocol between client and server.
// Keep this file dependency-free: it is compiled by both sides.

/** trần cứng của hệ thống; mỗi phòng tự chọn sức chứa riêng trong khoảng này */
export const MAX_PLAYERS = 16;
export const MIN_PLAYERS = 2;
export const DEFAULT_MAX_PLAYERS = 4;
export const NAME_MAX = 12;
export const RECONNECT_GRACE_MS = 30_000;
/** đủ dài để đọc hết luật chơi trước mỗi minigame */
export const COUNTDOWN_MS = 15_000;
export const SCOREBOARD_MS = 4200;

/** 16 màu phân biệt được trên nền tối; 4 màu đầu giữ nguyên như trước */
export const PLAYER_COLORS = [
  '#4cc9f0',
  '#ff5c7a',
  '#3ddc97',
  '#ffd166',
  '#b388ff',
  '#ff9f43',
  '#2ee6c8',
  '#ff6bd6',
  '#9fe870',
  '#7c9cff',
  '#ffa07a',
  '#e6ff5c',
  '#00bfa6',
  '#d98cff',
  '#ff4d4d',
  '#6ee7ff',
] as const;

export interface GameSummary {
  id: string;
  name: string;
  instructions: string;
}

/** giới hạn số người mà một phòng có thể chọn */
export const ROOM_SIZE_OPTIONS = [2, 4, 6, 8, 10, 12, 16] as const;

export type Phase = 'lobby' | 'countdown' | 'playing' | 'scoreboard' | 'board' | 'final';

/** classic: chơi lần lượt các minigame đã chọn · journey: board game "Hành Trình Xuyên Việt" */
export type GameMode = 'classic' | 'journey';

/** Trạng thái bàn cờ của chế độ journey; nằm trong room:state nên người vào lại phòng tự khôi phục được. */
export interface BoardState {
  /** lượt hiện tại, bắt đầu từ 1 */
  turn: number;
  totalTurns: number;
  /** roll: chờ chủ xúc xắc tung · moving: quân cờ đang di chuyển, sắp vào minigame */
  stage: 'roll' | 'moving';
  rollerId: string;
  /** hết giờ tung (stage roll) hoặc hết hoạt hình (stage moving) — giờ server */
  deadline: number;
  /** ô quyết định minigame của lượt này, -1 khi chưa tung */
  tileIndex: number;
  /** vị trí hiện tại / trước khi đi / xúc xắc lượt này của từng người (id → chỉ số ô) */
  pos: Record<string, number>;
  from: Record<string, number>;
  dice: Record<string, number>;
  /** các đặc sản (chỉ số ô) mỗi người đã thu thập */
  badges: Record<string, number[]>;
}

/** Thông tin ô tỉnh gắn vào game:start ở chế độ journey. */
export interface TileInfo {
  index: number;
  id: string;
  name: string;
  emoji: string;
  specialty: string;
  title: string;
  value: number;
  festival: boolean;
}

/** Điểm Văn Hoá của từng người ở một ô (kèm trong game:score). */
export interface BoardAward {
  points: number;
  /** đang đứng đúng ô được chọn (nhân 1,5) */
  home: boolean;
  /** vừa lấy được đặc sản mới của tỉnh này */
  badge: boolean;
}

/** Emote bấm được ở sảnh chờ - server chỉ chấp nhận đúng các giá trị này. */
export const EMOTES = ['wave', 'dance', 'laugh', 'angry', 'sad', 'jump'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_COOLDOWN_MS = 600;

/* ---------------- ngoại hình nhân vật ---------------- */
/**
 * Mỗi phần là chỉ số trong LOOK_PARTS. Màu áo vẫn là màu của người chơi trong phòng
 * để trong trận ai cũng nhận ra nhau.
 */
export interface PlayerLook {
  /** 0 = nam, 1 = nữ */
  gender: number;
  skin: number;
  /** chỉ số trong HAIR_STYLES[gender] */
  hair: number;
  hairColor: number;
  eyes: number;
  mouth: number;
  /** điểm nhấn trên mặt: má hồng, tàn nhang… */
  face: number;
  glasses: number;
  outfit: number;
  hat: number;
  shoes: number;
}
export type LookPart = keyof PlayerLook;

/** kiểu tóc riêng cho nam và nữ (hai danh sách dài bằng nhau) */
export const HAIR_STYLES: readonly (readonly string[])[] = [
  ['Ngắn gọn', 'Dựng ngược', 'Mái lệch', 'Xoăn tít', 'Undercut', 'Trọc'],
  ['Xoã dài', 'Đuôi ngựa', 'Hai bím', 'Búi củ tỏi', 'Bob ngắn', 'Hai búi'],
];

export const LOOK_PARTS: Record<LookPart, readonly string[]> = {
  gender: ['Nam', 'Nữ'],
  skin: ['#ffe0c7', '#f7cfa6', '#e8b387', '#c98b5b', '#9a6038', '#6a3f22'],
  hair: HAIR_STYLES[0],
  /** 'auto' = tối hơn màu áo một chút */
  hairColor: [
    'auto', '#2a2230', '#5a3a28', '#8b5a2b', '#c98a3d', '#f2d16b', '#f4efe6',
    '#b8bccb', '#ff6bd6', '#b388ff', '#4cc9f0', '#3ddc97', '#ff5c5c',
  ],
  eyes: ['Tròn xoe', 'Long lanh', 'Mắt cười', 'Lim dim', 'Mắt mèo', 'Ngầu lòi'],
  mouth: ['Mỉm cười', 'Cười toe', 'Miệng mèo', 'Lè lưỡi', 'Chu môi'],
  face: ['Không', 'Má hồng', 'Tàn nhang', 'Nốt ruồi', 'Râu mép', 'Sticker sao'],
  glasses: ['Không', 'Kính tròn', 'Kính râm', 'Kính tim'],
  outfit: ['Áo thun', 'Áo sọc', 'Hoodie', 'Áo khoác', 'Sơ mi cà vạt', 'Váy xoè'],
  hat: [
    'Không đội', 'Mũ lưỡi trai', 'Mũ len', 'Vương miện', 'Nơ xinh',
    'Tai mèo', 'Tai nghe', 'Sừng quỷ', 'Hoa cài', 'Vòng thiên thần',
  ],
  shoes: ['#f4f4f8', '#2a2230', '#ff5c7a', '#4cc9f0', '#ffd166', '#3ddc97', '#b388ff'],
};

export const DEFAULT_LOOK: PlayerLook = {
  gender: 0,
  skin: 0,
  hair: 0,
  hairColor: 0,
  eyes: 0,
  mouth: 0,
  face: 0,
  glasses: 0,
  outfit: 0,
  hat: 0,
  shoes: 0,
};

/** Dùng ở cả server (không tin client) lẫn client (dữ liệu cũ trong localStorage). */
export function normalizeLook(raw: unknown): PlayerLook {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LOOK };
  for (const key of Object.keys(DEFAULT_LOOK) as LookPart[]) {
    const n = Number(src[key]);
    if (Number.isInteger(n) && n >= 0 && n < LOOK_PARTS[key].length) out[key] = n;
  }
  return out;
}

export interface PlayerState {
  id: string;
  name: string;
  slot: number;          // 0..3 -> color index
  color: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  spectator: boolean;
  ping: number;
  total: number;         // accumulated match score
  look: PlayerLook;
}

export interface RoomState {
  code: string;
  phase: Phase;
  players: PlayerState[];
  hostId: string;
  round: number;         // 1-based index of current minigame
  totalRounds: number;
  gameIds: string[];     // ids picked for this match (revealed progressively)
  /** sức chứa do host chọn lúc tạo phòng */
  maxPlayers: number;
  /** danh sách minigame host chọn cho phòng này */
  selectedGameIds: string[];
  /** số người tối thiểu để bắt đầu (1 khi server chạy chế độ test một mình) */
  minPlayers: number;
  mode: GameMode;
  /** chỉ có ở chế độ journey (kể cả sau khi trận kết thúc, để màn tổng kết hiện huy hiệu) */
  board: BoardState | null;
}

export interface ControlHint {
  /** phím hiển thị dạng keycap, ví dụ "→" hoặc "SPACE" */
  keys: string[];
  desc: string;
}

export interface ScoreRow {
  playerId: string;
  rank: number;
  raw: number;
  points: number;
  detail: string;
}

export interface StandingRow {
  playerId: string;
  rank: number;
  total: number;
}

/* ---------------- client -> server ---------------- */
export type ClientMessage =
  | { t: 'time:ping'; clientSent: number; rtt?: number }
  | { t: 'room:create'; name: string; maxPlayers?: number; gameIds?: string[]; mode?: GameMode; look?: PlayerLook }
  | { t: 'room:join'; code: string; name: string; look?: PlayerLook }
  | { t: 'player:look'; look: PlayerLook }
  | { t: 'room:rejoin'; code: string; playerId: string; token: string }
  | { t: 'room:leave' }
  | { t: 'room:ready'; ready: boolean }
  | { t: 'room:settings'; maxPlayers?: number; gameIds?: string[]; mode?: GameMode }
  | { t: 'board:roll' }
  | { t: 'game:start' }
  | { t: 'game:input'; gameId: string; input: GameInput }
  | { t: 'match:again' }
  | { t: 'lobby:emote'; emote: Emote };

/* ---------------- server -> client ---------------- */
export type ServerMessage =
  | { t: 'time:pong'; clientSent: number; serverTime: number }
  | { t: 'room:joined'; code: string; playerId: string; token: string; serverTime: number }
  | { t: 'room:state'; room: RoomState }
  | { t: 'games:catalog'; games: GameSummary[] }
  | { t: 'error'; message: string }
  | {
      t: 'game:start';
      gameId: string;
      name: string;
      instructions: string;
      controls: ControlHint[];
      config: any;
      startAt: number;      // server clock
      endAt: number;        // server clock (hard deadline)
      round: number;
      totalRounds: number;
      comebackPlayerId: string | null;
      /** chỉ có ở chế độ journey: ô tỉnh đang chơi (name/instructions ở trên đã được đổi theo chủ đề tỉnh) */
      tile?: TileInfo;
    }
  | { t: 'game:event'; gameId: string; payload: any }
  | {
      t: 'game:score';
      gameId: string;
      rows: ScoreRow[];
      standings: StandingRow[];
      nextAt: number;
      /** chỉ có ở chế độ journey */
      board?: { tileIndex: number; awards: Record<string, BoardAward> };
    }
  | { t: 'game:end'; standings: StandingRow[]; winnerId: string }
  | { t: 'lobby:emote'; playerId: string; emote: Emote };

/* ---------------- per-minigame inputs ---------------- */
export type GameInput =
  | { type: 'hit'; at: number; key?: 'space' | 'up' }   // bắt nhịp (giờ có 2 làn phím)
  | { type: 'press'; at: number }                       // reaction
  | { type: 'key'; key: 'L' | 'U' | 'R' | 'D' }         // sequence
  | { type: 'step'; key: 'L' | 'R' }                    // race (giữ lại cho tương thích)
  | { type: 'hold'; dir: 'L' | 'R' | 'N' }              // race: giữ mũi tên để chạy
  | { type: 'jump' }                                    // race
  | { type: 'tap' }                                     // button battle
  | { type: 'move'; dir: 'L' | 'R' }                    // math rush: đi sang ô bên cạnh
  | { type: 'lock' }                                    // math rush: chốt đáp án
  | { type: 'moveXY'; dx: number; dy: number }          // di chuyển tự do 2D trong đấu trường
  | { type: 'pull' }                                    // kéo co
  | { type: 'climb'; side: 'L' | 'R' };                 // hái dừa: bấm luân phiên trái/phải để leo

export type Judgement = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS' | 'TRAP';
