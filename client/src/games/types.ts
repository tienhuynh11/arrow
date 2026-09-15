import type { PlayerState } from '@shared/protocol';

export interface GameProps {
  gameId: string;
  config: any;
  startAt: number;
  endAt: number;
  players: PlayerState[];
  meId: string;
  /** true once the countdown finished and inputs are accepted */
  live: boolean;
}
