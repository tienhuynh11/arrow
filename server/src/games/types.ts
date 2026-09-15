import type { ControlHint, GameInput } from '../../../shared/protocol';

export interface GameContext {
  /** ids of players actually competing in this round */
  playerIds: string[];
  startAt: number;
  endAt: number;
  now(): number;
  broadcast(payload: any): void;
  send(playerId: string, payload: any): void;
}

export interface PlayerResult {
  /** higher is better; used for ranking */
  raw: number;
  /** short human readable summary shown on the scoreboard */
  detail: string;
}

/**
 * Every minigame implements this interface. The core match loop knows nothing
 * about the games themselves, so adding a new one is a single file + registry entry.
 */
export interface GameDefinition<C = any, S = any> {
  id: string;
  name: string;
  instructions: string;
  /** hiển thị trên màn hướng dẫn trước mỗi ván */
  controls: ControlHint[];
  /** hard deadline in ms; the round also ends early when isFinished() returns true */
  duration: number;
  minPlayers: number;
  maxPlayers: number;

  /** config is sent verbatim to every client (must not leak secrets) */
  createConfig(ctx: GameContext): C;
  createState(ctx: GameContext, config: C): S;

  onStart?(ctx: GameContext, state: S, config: C): void;
  handleInput(ctx: GameContext, state: S, config: C, playerId: string, input: GameInput): void;
  update(ctx: GameContext, state: S, config: C): void;
  isFinished(ctx: GameContext, state: S, config: C): boolean;
  calculateScore(ctx: GameContext, state: S, config: C): Record<string, PlayerResult>;
}

export const rnd = (min: number, max: number) => min + Math.random() * (max - min);
export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
