import { useSyncExternalStore } from 'react';
import type {
  BoardAward,
  ControlHint,
  Emote,
  GameMode,
  GameSummary,
  PlayerLook,
  PlayerState,
  RoomState,
  ScoreRow,
  ServerMessage,
  StandingRow,
  TileInfo,
} from '@shared/protocol';
import { DEFAULT_LOOK, normalizeLook } from '@shared/protocol';
import { net } from '../network/net';
import { sfx } from '../utils/sound';

export interface GameInfo {
  gameId: string;
  name: string;
  instructions: string;
  controls: ControlHint[];
  config: any;
  startAt: number;
  endAt: number;
  round: number;
  totalRounds: number;
  comebackPlayerId: string | null;
  /** chỉ có ở chế độ Hành Trình Xuyên Việt: ô tỉnh đang chơi */
  tile?: TileInfo;
}

export interface Toast {
  id: number;
  text: string;
  color: string;
}

export interface AppState {
  connected: boolean;
  name: string;
  meId: string | null;
  room: RoomState | null;
  error: string | null;
  joining: boolean;
  game: GameInfo | null;
  score: {
    gameId: string;
    rows: ScoreRow[];
    standings: StandingRow[];
    nextAt: number;
    board?: { tileIndex: number; awards: Record<string, BoardAward> };
  } | null;
  final: { standings: StandingRow[]; winnerId: string } | null;
  /** danh mục minigame server gửi khi vừa kết nối */
  catalog: GameSummary[];
  /** mức đồ hoạ 3D đang chạy (CAO/VỪA/NHẸ) do cảnh 3D báo lên */
  quality3d: string | null;
  /** emote đang hiện của từng người chơi ở màn chờ */
  emotes: Record<string, { emote: Emote; at: number }>;
  toasts: Toast[];
  /** ngoại hình nhân vật của mình (nhớ trong máy, gửi lên khi vào phòng) */
  look: PlayerLook;
}

const SESSION_KEY = 'arrow-party-session';
const LOOK_KEY = 'arrow-party-look';

function readLook(): PlayerLook {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    return raw ? normalizeLook(JSON.parse(raw)) : DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}


let state: AppState = {
  connected: false,
  name: localStorage.getItem('arrow-party-name') ?? '',
  meId: null,
  room: null,
  error: null,
  joining: false,
  game: null,
  score: null,
  final: null,
  catalog: [],
  quality3d: null,
  emotes: {},
  toasts: [],
  look: readLook(),
};

const subs = new Set<() => void>();
const emit = () => {
  for (const fn of subs) fn();
};
const set = (patch: Partial<AppState>) => {
  state = { ...state, ...patch };
  emit();
};

export const getState = () => state;

export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => select(state),
  );
}

/* ----------------------------- toasts ----------------------------- */
let toastId = 0;
export function pushToast(text: string, color = '#ffd166') {
  const id = ++toastId;
  set({ toasts: [...state.toasts, { id, text, color }] });
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), 1800);
}

/* --------------------------- session save -------------------------- */
function saveSession(code: string, playerId: string, token: string) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId, token, at: Date.now() }));
}
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // sessions older than 10 minutes are not worth restoring
    if (!s.code || Date.now() - s.at > 600_000) return null;
    return s as { code: string; playerId: string; token: string };
  } catch {
    return null;
  }
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ------------------------ overtake detection ----------------------- */
let lastOrder: string[] = [];
function detectOvertake(standings: StandingRow[], players: PlayerState[]) {
  const order = standings.map((s) => s.playerId);
  if (lastOrder.length === order.length) {
    for (const id of order) {
      const before = lastOrder.indexOf(id);
      const after = order.indexOf(id);
      if (before > after && after === 0 && before > 0) {
        const p = players.find((x) => x.id === id);
        if (p) {
          pushToast(`OVERTAKE! ${p.name} dẫn đầu`, p.color);
          sfx.overtake();
        }
      }
    }
  }
  lastOrder = order;
}

/* ------------------------- message handling ------------------------ */
/** đang chờ server trả lời yêu cầu vào lại phòng (sau khi rớt mạng / tải lại trang) */
let resuming = false;

// Mỗi lần (tái) kết nối: có phiên chơi đã lưu thì xin vào lại phòng ngay.
// Trước đây chỉ làm lúc mở trang, nên rớt mạng giữa ván là bị văng khỏi phòng mà màn hình vẫn đứng yên.
net.onStatus = (connected) => {
  set({ connected });
  if (connected) actions.tryResume();
};

net.on((msg: ServerMessage) => {
  switch (msg.t) {
    case 'room:joined':
      resuming = false;
      saveSession(msg.code, msg.playerId, msg.token);
      set({ meId: msg.playerId, error: null, joining: false });
      break;

    case 'room:state': {
      const prevPhase = state.room?.phase;
      const patch: Partial<AppState> = { room: msg.room };
      if (msg.room.phase === 'lobby') {
        patch.game = null;
        patch.score = null;
        patch.final = null;
        lastOrder = [];
      }
      // bàn cờ: lượt mới bắt đầu nên bỏ minigame + bảng điểm của lượt trước
      if (msg.room.phase === 'board') {
        patch.game = null;
        patch.score = null;
        patch.final = null;
      }
      // cập nhật trạng thái TRƯỚC rồi mới phát âm thanh: lỗi âm thanh không được làm kẹt ván
      set(patch);
      if (msg.room.phase === 'playing' && prevPhase === 'countdown') sfx.start();
      break;
    }

    case 'game:start':
      set({
        game: {
          gameId: msg.gameId,
          name: msg.name,
          instructions: msg.instructions,
          controls: msg.controls ?? [],
          config: msg.config,
          startAt: msg.startAt,
          endAt: msg.endAt,
          round: msg.round,
          totalRounds: msg.totalRounds,
          comebackPlayerId: msg.comebackPlayerId,
          ...(msg.tile ? { tile: msg.tile } : {}),
        },
        score: null,
        final: null,
      });
      break;

    case 'game:score':
      set({
        score: {
          gameId: msg.gameId,
          rows: msg.rows,
          standings: msg.standings,
          nextAt: msg.nextAt,
          ...(msg.board ? { board: msg.board } : {}),
        },
      });
      detectOvertake(msg.standings, state.room?.players ?? []);
      break;

    case 'game:end':
      set({ final: { standings: msg.standings, winnerId: msg.winnerId }, score: null, game: null });
      sfx.winner();
      break;

    case 'games:catalog':
      set({ catalog: msg.games });
      break;

    case 'lobby:emote': {
      const at = Date.now();
      set({ emotes: { ...state.emotes, [msg.playerId]: { emote: msg.emote, at } } });
      // tự dọn sau khi animation chạy xong
      setTimeout(() => {
        const cur = state.emotes[msg.playerId];
        if (cur && cur.at === at) {
          const next = { ...state.emotes };
          delete next[msg.playerId];
          set({ emotes: next });
        }
      }, 2000);
      break;
    }

    case 'error':
      if (resuming) {
        // không vào lại được (phòng đã giải tán, hết thời gian chờ…) → về màn chính thay vì treo màn hình cũ
        resuming = false;
        clearSession();
        lastOrder = [];
        set({ room: null, meId: null, game: null, score: null, final: null });
      }
      set({ error: msg.message, joining: false });
      setTimeout(() => set({ error: null }), 3200);
      break;
  }
});

/* ----------------------------- actions ----------------------------- */
export const actions = {
  setName(name: string) {
    set({ name });
    localStorage.setItem('arrow-party-name', name);
  },
  createRoom(opts?: { maxPlayers?: number; gameIds?: string[]; mode?: GameMode }) {
    set({ joining: true });
    net.send({
      t: 'room:create',
      name: state.name,
      maxPlayers: opts?.maxPlayers,
      gameIds: opts?.gameIds,
      mode: opts?.mode,
      look: state.look,
    });
  },
  setSettings(opts: { maxPlayers?: number; gameIds?: string[]; mode?: GameMode }) {
    net.send({ t: 'room:settings', ...opts });
  },
  joinRoom(code: string) {
    set({ joining: true });
    net.send({ t: 'room:join', code, name: state.name, look: state.look });
  },
  leaveRoom() {
    net.send({ t: 'room:leave' });
    clearSession();
    lastOrder = [];
    set({ room: null, meId: null, game: null, score: null, final: null });
  },
  ready(ready: boolean) {
    net.send({ t: 'room:ready', ready });
  },
  start() {
    net.send({ t: 'game:start' });
  },
  /** chế độ bàn cờ: chủ xúc xắc bấm tung */
  rollDice() {
    net.send({ t: 'board:roll' });
  },
  backToLobby() {
    net.send({ t: 'match:again' });
  },
  emote(emote: Emote) {
    net.send({ t: 'lobby:emote', emote });
  },
  setLook(look: PlayerLook) {
    const next = normalizeLook(look);
    set({ look: next });
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify(next));
    } catch {
      /* chế độ ẩn danh có thể chặn localStorage */
    }
    // đang ở trong phòng thì cả phòng thấy ngay (server chỉ nhận ở sảnh chờ / màn tổng kết)
    if (state.room) net.send({ t: 'player:look', look: next });
  },
  setQuality3d(label: string | null) {
    if (state.quality3d !== label) set({ quality3d: label });
  },
  tryResume() {
    const s = loadSession();
    if (!s) return;
    resuming = true;
    net.send({ t: 'room:rejoin', code: s.code, playerId: s.playerId, token: s.token });
  },
};
