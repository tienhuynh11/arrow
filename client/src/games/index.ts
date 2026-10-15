import type { ComponentType } from 'react';
import type { GameProps } from './types';
import RhythmGame from './rhythm';
import ReactionGame from './reaction';
import SequenceGame from './sequence';
import RaceGame from './race';
import ButtonBattle from './button';
import MathRush from './math';
import DodgeGame from './dodge';
import BombGame from './bomb';
import TugWar from './tug';
import CoconutGame from './coconut';
import HexGame from './hex';
import DoorGame from './door';
import MountainGame from './mountain';
import LavaGame from './lava';
import BlockPartyGame from './blockparty';
import MemoryGame from './memory';
import TipToeGame from './tiptoe';
import CodeHuntGame from './codehunt';
import BlindShotGame from './blindshot';
import BombMazeGame from './bombmaze';
import ChairsGame from './chairs';
import ActNaturalGame from './actnatural';
import QuizGame from './quiz';
import RooftopGame from './rooftop';
import TanksGame from './tanks';
import FartGame from './fart';
import WallRushGame from './wallrush';
import DisasterGame from './disaster';
import ArtShowGame from './artshow';
import TreasureGame from './treasure';
import FishingGame from './fishing';

/** Renderer registry - keys must match the server-side game ids. */
export const GAME_COMPONENTS: Record<string, ComponentType<GameProps>> = {
  rhythm: RhythmGame,
  reaction: ReactionGame,
  sequence: SequenceGame,
  race: RaceGame,
  button: ButtonBattle,
  math: MathRush,
  dodge: DodgeGame,
  bomb: BombGame,
  tug: TugWar,
  coconut: CoconutGame,
  hex: HexGame,
  door: DoorGame,
  mountain: MountainGame,
  lava: LavaGame,
  blockparty: BlockPartyGame,
  memory: MemoryGame,
  tiptoe: TipToeGame,
  codehunt: CodeHuntGame,
  blindshot: BlindShotGame,
  bombmaze: BombMazeGame,
  chairs: ChairsGame,
  actnatural: ActNaturalGame,
  quiz: QuizGame,
  rooftop: RooftopGame,
  tanks: TanksGame,
  wallrush: WallRushGame,
  fart: FartGame,
  disaster: DisasterGame,
  artshow: ArtShowGame,
  treasure: TreasureGame,
  fishing: FishingGame,
};
