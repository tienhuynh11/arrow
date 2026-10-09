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
import ShowdownGame from './showdown';
import BlockPartyGame from './blockparty';
import MemoryGame from './memory';
import TipToeGame from './tiptoe';
import CodeHuntGame from './codehunt';
import BlindShotGame from './blindshot';
import BombMazeGame from './bombmaze';
import ChairsGame from './chairs';
import ActNaturalGame from './actnatural';

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
  showdown: ShowdownGame,
  blockparty: BlockPartyGame,
  memory: MemoryGame,
  tiptoe: TipToeGame,
  codehunt: CodeHuntGame,
  blindshot: BlindShotGame,
  bombmaze: BombMazeGame,
  chairs: ChairsGame,
  actnatural: ActNaturalGame,
};
