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
};
