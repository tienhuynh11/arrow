import {
  COUNTDOWN_MS,
  DEFAULT_MAX_PLAYERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  RECONNECT_GRACE_MS,
  SCOREBOARD_MS,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  type BoardAward,
  type BoardState,
  type Emote,
  type GameInput,
  type GameMode,
  type Phase,
  type PlayerLook,
  type PlayerState,
  type RoomState,
  type ScoreRow,
  type ServerMessage,
  type StandingRow,
  type TileInfo,
} from '../../../shared/protocol.js';
import { TILES } from '../../../shared/board.js';
import { awardTurn, beginTurn, createBoard, pickRoller, rollAll, tileInfo } from './journey.js';
import { GAMES, gameById, gameCatalog, pickMatchGames } from '../games/index.js';
import type { GameContext, GameDefinition } from '../games/types.js';
import type { Connection } from '../network/connection.js';

/** test một mình: `npm run dev:solo` (thêm cờ --solo) hoặc biến môi trường ALLOW_SOLO=1 */
const ALLOW_SOLO = process.env.ALLOW_SOLO === '1' || process.argv.includes('--solo');
const MIN_TO_START = ALLOW_SOLO ? 1 : MIN_PLAYERS;
/**
 * Điểm theo hạng, nội suy tuyến tính từ 100 (nhất) xuống 30 (bét) cho mọi cỡ phòng.
 * Với 4 người ra đúng 100 / 77 / 53 / 30 - gần như bảng cũ.
 */
const rankPoints = (rank: number, total: number) =>
  total <= 1 ? 100 : Math.round(30 + (70 * (total - rank)) / (total - 1));
const PERFORMANCE_BONUS = 60;
const COMEBACK_MULTIPLIER = 1.1;
const TICK_MS = 50;
/** ở sảnh chờ, người rớt mạng được giữ chỗ chừng này rồi mới bị xoá */
const LOBBY_GRACE_MS = 8000;
/** chế độ journey: bảng điểm lâu hơn một chút để kịp đọc Điểm Văn Hoá + huy hiệu */
const JOURNEY_SCOREBOARD_MS = 6000;

/** FORCE_GAMES=rhythm,race ghim danh sách game khi đang phát triển một minigame */
function forcedGames(): string[] {
  return (process.env.FORCE_GAMES?.split(',').map((s) => s.trim()) ?? []).filter((s) => gameById(s));
}

export interface Player {
  id: string;
  token: string;
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  spectator: boolean;
  disconnectedAt: number | null;
  total: number;
  lastEmoteAt: number;
  look: PlayerLook;
  conn: Connection | null;
}

interface ActiveRound {
  def: GameDefinition;
  config: any;
  state: any;
  ctx: GameContext;
  startAt: number;
  endAt: number;
  started: boolean;
  comebackPlayerId: string | null;
}

export class Room {
  readonly code: string;
  readonly players = new Map<string, Player>();
  hostId = '';
  phase: Phase = 'lobby';
  gameIds: string[] = [];
  /** sức chứa host chọn (2…MAX_PLAYERS) */
  maxPlayers = DEFAULT_MAX_PLAYERS;
  /** minigame host chọn cho phòng; rỗng = chơi tất cả */
  selectedGameIds: string[] = gameCatalog().map((g) => g.id);
  round = 0;
  /** classic: lần lượt các minigame đã chọn · journey: board game đi qua các tỉnh */
  mode: GameMode = 'classic';
  /** trạng thái bàn cờ; null ngoài chế độ journey */
  private board: BoardState | null = null;
  /** ô tỉnh của minigame đang chơi (journey) */
  private tile: TileInfo | null = null;
  private active: ActiveRound | null = null;
  // tin gần nhất của từng giai đoạn, để gửi lại cho người vào lại giữa trận
  private lastStart: ServerMessage | null = null;
  private lastScore: ServerMessage | null = null;
  private lastEnd: ServerMessage | null = null;
  private phaseDeadline = 0;
  private timer: NodeJS.Timeout;
  lastActivity = Date.now();

  constructor(code: string, private onEmpty: (code: string) => void) {
    this.code = code;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /* ------------------------------------------------------------------ */
  /* players                                                             */
  /* ------------------------------------------------------------------ */

  get activePlayers(): Player[] {
    return [...this.players.values()].filter((p) => !p.spectator);
  }

  get isEmpty() {
    return [...this.players.values()].every((p) => !p.connected);
  }

  private freeSlot(): number {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < this.maxPlayers; i++) if (!used.has(i)) return i;
    return -1;
  }

  canJoin(): string | null {
    if (this.phase !== 'lobby') return 'Ván đấu đã bắt đầu';
    if (this.activePlayers.length >= this.maxPlayers) return 'Phòng đã đầy';
    return null;
  }

  /**
   * Host đặt sức chứa và danh sách minigame. Chỉ đổi được khi đang ở sảnh chờ,
   * và không hạ sức chứa xuống dưới số người đang có trong phòng.
   */
  setSettings(playerId: string, maxPlayers?: number, gameIds?: string[], mode?: GameMode): string | null {
    if (playerId !== this.hostId) return 'Chỉ host mới đổi được cài đặt';
    if (this.phase !== 'lobby') return 'Không đổi được khi đang chơi';

    if (typeof maxPlayers === 'number' && Number.isFinite(maxPlayers)) {
      const want = Math.round(maxPlayers);
      const floor = Math.max(MIN_PLAYERS, this.activePlayers.length);
      this.maxPlayers = Math.min(MAX_PLAYERS, Math.max(floor, want));
    }

    if (Array.isArray(gameIds)) {
      const valid = gameIds.filter((id) => typeof id === 'string' && gameById(id));
      const unique = [...new Set(valid)];
      if (unique.length > 0) this.selectedGameIds = unique;
    }

    if (mode === 'classic' || mode === 'journey') this.mode = mode;

    this.broadcastState();
    return null;
  }

  addPlayer(conn: Connection, name: string, id: string, token: string, look: PlayerLook): Player {
    const slot = this.freeSlot();
    const player: Player = {
      id,
      token,
      name,
      slot,
      ready: false,
      connected: true,
      spectator: false,
      disconnectedAt: null,
      total: 0,
      lastEmoteAt: 0,
      look,
      conn,
    };
    this.players.set(id, player);
    if (!this.hostId) this.hostId = id;
    this.lastActivity = Date.now();
    return player;
  }

  rejoin(conn: Connection, playerId: string, token: string): Player | null {
    const p = this.players.get(playerId);
    if (!p || p.token !== token) return null;
    p.conn?.close();
    p.conn = conn;
    p.connected = true;
    p.disconnectedAt = null;
    if (p.spectator && this.phase === 'lobby') p.spectator = false;
    if (!this.players.get(this.hostId)?.connected) this.hostId = playerId;
    this.lastActivity = Date.now();
    return p;
  }

  markDisconnected(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.conn = null;
    p.ready = false;
    p.disconnectedAt = Date.now();

    // Ở sảnh chờ KHÔNG xoá ngay: rớt mạng thoáng qua (wifi, ngrok…) vẫn vào lại được đúng chỗ cũ.
    // tick() sẽ dọn sau LOBBY_GRACE_MS nếu người đó không quay lại.
    // Quyền host cũng được giữ trong thời gian đó (tick() mới chuyển), để chập mạng một nhịp
    // không làm người tạo phòng mất nút START.
    this.broadcastState();
    if (this.isEmpty) this.destroy();
  }

  setReady(playerId: string, ready: boolean) {
    const p = this.players.get(playerId);
    // host là người bấm START nên không cần (và không có nút) sẵn sàng
    if (!p || this.phase !== 'lobby' || playerId === this.hostId) return;
    p.ready = ready;
    this.broadcastState();
  }

  /** Đổi ngoại hình: chỉ ở sảnh chờ / màn tổng kết để cảnh 3D đang chạy không bị lệch. */
  setLook(playerId: string, look: PlayerLook) {
    const p = this.players.get(playerId);
    if (!p || (this.phase !== 'lobby' && this.phase !== 'final')) return;
    p.look = look;
    this.broadcastState();
  }

  /* ------------------------------------------------------------------ */
  /* messaging                                                           */
  /* ------------------------------------------------------------------ */

  send(playerId: string, msg: ServerMessage) {
    this.players.get(playerId)?.conn?.send(msg);
  }

  broadcast(msg: ServerMessage) {
    for (const p of this.players.values()) p.conn?.send(msg);
  }

  toState(): RoomState {
    const players: PlayerState[] = [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        color: PLAYER_COLORS[p.slot % PLAYER_COLORS.length],
        isHost: p.id === this.hostId,
        ready: p.ready,
        connected: p.connected,
        spectator: p.spectator,
        ping: p.conn?.ping ?? 0,
        total: p.total,
        look: p.look,
      }));
    return {
      code: this.code,
      phase: this.phase,
      players,
      hostId: this.hostId,
      round: this.round,
      totalRounds: this.board ? this.board.totalTurns : this.gameIds.length,
      gameIds: this.gameIds.slice(0, Math.max(this.round, 0)),
      maxPlayers: this.maxPlayers,
      selectedGameIds: this.selectedGameIds,
      minPlayers: MIN_TO_START,
      mode: this.mode,
      board: this.board,
    };
  }

  broadcastState() {
    this.broadcast({ t: 'room:state', room: this.toState() });
  }

  /* ------------------------------------------------------------------ */
  /* match flow                                                          */
  /* ------------------------------------------------------------------ */

  startMatch(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Chỉ host mới bắt đầu được';
    if (this.phase !== 'lobby' && this.phase !== 'final') return 'Ván đấu đang diễn ra';
    const count = this.activePlayers.filter((p) => p.connected).length;
    if (count < MIN_TO_START) return `Cần ít nhất ${MIN_TO_START} người chơi`;
    // ở sảnh chờ: mọi người (trừ host) phải SẴN SÀNG hết. Màn tổng kết bấm "chơi lại" thì ai cũng vừa chơi xong nên bỏ qua.
    if (this.phase === 'lobby') {
      const waiting = this.activePlayers.filter((p) => p.connected && p.id !== this.hostId && !p.ready);
      if (waiting.length > 0) return `Còn ${waiting.length} người chưa sẵn sàng`;
    }

    // người đang rớt mạng ở sảnh chờ không bị kéo vào trận
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    this.lastStart = this.lastScore = this.lastEnd = null;

    for (const p of this.players.values()) {
      p.total = 0;
      p.ready = false;
      if (p.spectator && p.connected) p.spectator = false;
    }
    this.round = 0;
    this.tile = null;

    if (this.mode === 'journey') {
      // bàn cờ: mỗi lượt một ô tỉnh quyết định minigame, nên không cần xáo danh sách game trước
      this.gameIds = [];
      this.board = createBoard(this.activePlayers.map((p) => p.id));
      this.startTurn();
      return null;
    }

    this.board = null;
    const forced = forcedGames();
    this.gameIds = forced.length ? forced : pickMatchGames(count, this.selectedGameIds);
    this.nextRound();
    return null;
  }

  /* ------------------------------ journey ------------------------------ */

  /** Mở lượt mới: chọn chủ xúc xắc rồi chờ họ tung. */
  private startTurn() {
    const board = this.board;
    if (!board) return;
    const connected = this.activePlayers
      .filter((p) => p.connected)
      .sort((a, b) => a.slot - b.slot)
      .map((p) => p.id);
    beginTurn(board, pickRoller(board.turn + 1, connected), Date.now());
    this.round = board.turn;
    this.phase = 'board';
    this.lastStart = this.lastScore = null;
    this.broadcastState();
  }

  /** Chủ xúc xắc bấm tung (hoặc server tự tung khi hết giờ / họ rớt mạng). */
  rollDice(playerId: string): string | null {
    const board = this.board;
    if (this.phase !== 'board' || !board || board.stage !== 'roll') return 'Chưa tới lúc tung xúc xắc';
    if (playerId !== board.rollerId) return 'Chưa tới lượt bạn tung xúc xắc';
    this.doRoll();
    return null;
  }

  private doRoll() {
    const board = this.board;
    if (!board) return;
    rollAll(board, Date.now());
    this.broadcastState();
  }

  /** Hết hoạt hình di chuyển: vào minigame của ô tỉnh. */
  private launchTileGame() {
    const board = this.board;
    if (!board) return;
    const tile = TILES[board.tileIndex];
    const count = this.activePlayers.length;

    // game không hợp số người (vd. KÉO CO cần từ 2 người) thì thay bằng BẤM NHANH TAY nhưng vẫn giữ chủ đề tỉnh
    let gameId = forcedGames()[0] ?? tile.gameId;
    const def = gameById(gameId);
    if (!def || count < def.minPlayers || count > def.maxPlayers) gameId = 'button';

    this.tile = tileInfo(board.tileIndex);
    this.gameIds.push(gameId);
    this.startRound(gameId, tile.intro);
  }

  /** Sau bảng điểm: hết lượt cuối thì kết thúc, không thì sang lượt kế. */
  private afterJourneyScoreboard() {
    const board = this.board;
    if (!board || board.turn >= board.totalTurns) return this.endMatch();
    this.startTurn();
  }

  private nextRound() {
    this.round += 1;
    if (this.round > this.gameIds.length) return this.endMatch();
    this.startRound(this.gameIds[this.round - 1]);
  }

  /** `tileIntro` chỉ có ở chế độ journey: lời dẫn theo tỉnh ghép vào trước luật chơi gốc. */
  private startRound(gameId: string, tileIntro?: string) {
    const def = gameById(gameId) ?? GAMES[0];
    const playerIds = this.activePlayers.map((p) => p.id);
    const startAt = Date.now() + COUNTDOWN_MS;
    const endAt = startAt + def.duration;

    const ctx: GameContext = {
      playerIds,
      startAt,
      endAt,
      now: () => Date.now(),
      broadcast: (payload) => this.broadcast({ t: 'game:event', gameId: def.id, payload }),
      send: (pid, payload) => this.send(pid, { t: 'game:event', gameId: def.id, payload }),
    };

    const config = def.createConfig(ctx);
    const state = def.createState(ctx, config);
    // journey tính điểm theo ô tỉnh nên không có người được cộng bù
    const comebackPlayerId = this.board ? null : this.pickComebackPlayer();

    this.active = { def, config, state, ctx, startAt, endAt, started: false, comebackPlayerId };
    this.phase = 'countdown';
    this.phaseDeadline = startAt;

    this.lastStart = {
      t: 'game:start',
      gameId: def.id,
      name: this.tile ? `${this.tile.emoji} ${this.tile.title}` : def.name,
      instructions: tileIntro ? `${tileIntro} ${def.instructions}` : def.instructions,
      controls: def.controls,
      config,
      startAt,
      endAt,
      round: this.round,
      totalRounds: this.board ? this.board.totalTurns : this.gameIds.length,
      comebackPlayerId,
      ...(this.tile ? { tile: this.tile } : {}),
    };
    this.lastScore = null;
    this.broadcast(this.lastStart);
    this.broadcastState();
  }

  /** Last place gets a small multiplier so a leader cannot snowball. */
  private pickComebackPlayer(): string | null {
    if (this.round <= 1) return null;
    const sorted = this.activePlayers.slice().sort((a, b) => a.total - b.total);
    if (sorted.length < 2) return null;
    const last = sorted[0];
    if (last.total >= sorted[sorted.length - 1].total) return null; // everyone tied
    if (last.total === sorted[1].total) return null; // tie for last place
    return last.id;
  }

  private tick() {
    const now = Date.now();

    // host rời hẳn hoặc rớt mạng quá lâu → trao quyền host cho người đang kết nối
    const host = this.players.get(this.hostId);
    if (!host || (!host.connected && host.disconnectedAt !== null && now - host.disconnectedAt > LOBBY_GRACE_MS)) {
      const next = [...this.players.values()].find((x) => x.connected);
      if (next && next.id !== this.hostId) {
        this.hostId = next.id;
        this.broadcastState();
      }
    }
    const a = this.active;

    if (this.phase === 'countdown' && a) {
      if (now >= a.startAt) {
        this.phase = 'playing';
        a.started = true;
        a.def.onStart?.(a.ctx, a.state, a.config);
        this.broadcastState();
      }
      return;
    }

    if (this.phase === 'playing' && a) {
      a.def.update(a.ctx, a.state, a.config);
      if (a.def.isFinished(a.ctx, a.state, a.config) || now >= a.endAt) this.finishRound();
      return;
    }

    if (this.phase === 'scoreboard' && now >= this.phaseDeadline) {
      if (this.board) this.afterJourneyScoreboard();
      else this.nextRound();
      return;
    }

    if (this.phase === 'board' && this.board) {
      const board = this.board;
      if (board.stage === 'roll') {
        // hết giờ, hoặc chủ xúc xắc đã rớt mạng: server tung giúp để cả phòng không phải chờ
        const roller = this.players.get(board.rollerId);
        if (now >= board.deadline || !roller || !roller.connected) this.doRoll();
      } else if (now >= board.deadline) {
        this.launchTileGame();
        return;
      }
    }

    // sảnh chờ: xoá hẳn người rớt mạng quá lâu (trong trận thì chuyển sang khán giả ở dưới)
    if (this.phase === 'lobby') {
      let removed = false;
      for (const [id, p] of this.players) {
        if (!p.connected && p.disconnectedAt && now - p.disconnectedAt > LOBBY_GRACE_MS) {
          this.players.delete(id);
          removed = true;
        }
      }
      if (removed) this.broadcastState();
      return;
    }

    // reap players who never came back
    for (const p of this.players.values()) {
      if (!p.connected && !p.spectator && p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE_MS) {
        p.spectator = true;
        this.broadcastState();
      }
    }
  }

  private finishRound() {
    const a = this.active;
    if (!a) return;
    const results = a.def.calculateScore(a.ctx, a.state, a.config);

    const entries = a.ctx.playerIds
      .map((id) => ({ id, ...(results[id] ?? { raw: 0, detail: '-' }) }))
      .sort((x, y) => y.raw - x.raw);

    const maxRaw = Math.max(...entries.map((e) => e.raw), 0);
    const rows: ScoreRow[] = [];
    // journey: điểm tính riêng (Điểm Văn Hoá theo hạng + ô tỉnh) sau khi đã có hạng của mọi người
    const journeyRanks: { playerId: string; rank: number }[] = [];

    entries.forEach((e, i) => {
      // ties share a rank
      let rank = i + 1;
      if (i > 0 && e.raw === entries[i - 1].raw) rank = rows[i - 1].rank;

      journeyRanks.push({ playerId: e.id, rank });

      let points: number;
      if (this.board) {
        points = 0; // điền sau bằng awardTurn
      } else if (e.raw < 0) {
        points = -30; // false start / penalty
      } else {
        const base = rankPoints(rank, entries.length);
        const bonus = maxRaw > 0 ? Math.round((e.raw / maxRaw) * PERFORMANCE_BONUS) : 0;
        points = base + bonus;
      }
      if (e.id === a.comebackPlayerId && points > 0) points = Math.round(points * COMEBACK_MULTIPLIER);

      const player = this.players.get(e.id);
      if (player && !this.board) player.total = Math.max(0, player.total + points);

      rows.push({ playerId: e.id, rank, raw: e.raw, points, detail: e.detail });
    });

    let boardInfo: { tileIndex: number; awards: Record<string, BoardAward> } | undefined;
    if (this.board) {
      const awards = awardTurn(this.board, journeyRanks);
      for (const row of rows) {
        row.points = awards[row.playerId]?.points ?? 0;
        const player = this.players.get(row.playerId);
        if (player) player.total += row.points;
      }
      boardInfo = { tileIndex: this.board.tileIndex, awards };
    }

    this.phase = 'scoreboard';
    this.phaseDeadline = Date.now() + (this.board ? JOURNEY_SCOREBOARD_MS : SCOREBOARD_MS);
    this.active = null;

    this.lastScore = {
      t: 'game:score',
      gameId: a.def.id,
      rows,
      standings: this.standings(),
      nextAt: this.phaseDeadline,
      ...(boardInfo ? { board: boardInfo } : {}),
    };
    this.broadcast(this.lastScore);
    this.broadcastState();
  }

  standings(): StandingRow[] {
    const sorted = this.activePlayers.slice().sort((a, b) => b.total - a.total);
    const rows: StandingRow[] = [];
    sorted.forEach((p, i) => {
      const rank = i > 0 && p.total === sorted[i - 1].total ? rows[i - 1].rank : i + 1;
      rows.push({ playerId: p.id, rank, total: p.total });
    });
    return rows;
  }

  private endMatch() {
    this.phase = 'final';
    this.active = null;
    const standings = this.standings();
    this.lastEnd = { t: 'game:end', standings, winnerId: standings[0]?.playerId ?? '' };
    this.broadcast(this.lastEnd);
    this.broadcastState();
  }

  /** Chủ động rời phòng (bấm nút): ở sảnh chờ thì xoá ngay, không giữ chỗ như khi rớt mạng. */
  leave(playerId: string) {
    this.markDisconnected(playerId);
    if (this.phase === 'lobby' && this.players.delete(playerId)) this.broadcastState();
  }

  /** Người vừa vào lại giữa trận: gửi lại đúng thứ họ cần để vẽ màn hình hiện tại. */
  resendCurrent(playerId: string) {
    if ((this.phase === 'countdown' || this.phase === 'playing') && this.lastStart) this.send(playerId, this.lastStart);
    else if (this.phase === 'scoreboard' && this.lastScore) this.send(playerId, this.lastScore);
    else if (this.phase === 'final' && this.lastEnd) this.send(playerId, this.lastEnd);
  }

  backToLobby(playerId: string) {
    if (playerId !== this.hostId || this.phase !== 'final') return;
    this.phase = 'lobby';
    this.round = 0;
    this.gameIds = [];
    this.board = null;
    this.tile = null;
    for (const p of this.players.values()) {
      p.total = 0;
      p.ready = false;
      if (p.spectator && p.connected) p.spectator = false;
    }
    this.broadcastState();
  }

  /** Emote chỉ dùng ở màn chờ, có cooldown để không ai spam được. */
  emote(playerId: string, emote: Emote) {
    if (this.phase !== 'lobby') return;
    if (!EMOTES.includes(emote)) return;
    const p = this.players.get(playerId);
    if (!p || !p.connected) return;
    const now = Date.now();
    if (now - p.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    p.lastEmoteAt = now;
    this.broadcast({ t: 'lobby:emote', playerId, emote });
  }

  /* ------------------------------------------------------------------ */
  /* input                                                               */
  /* ------------------------------------------------------------------ */

  handleGameInput(playerId: string, gameId: string, input: GameInput) {
    const a = this.active;
    if (!a || this.phase !== 'playing') return;          // wrong phase -> ignored
    if (a.def.id !== gameId) return;                     // stale round -> ignored
    const p = this.players.get(playerId);
    if (!p || p.spectator) return;                       // spectators cannot play
    if (!a.ctx.playerIds.includes(playerId)) return;
    a.def.handleInput(a.ctx, a.state, a.config, playerId, input);
  }

  destroy() {
    clearInterval(this.timer);
    this.onEmpty(this.code);
  }
}
