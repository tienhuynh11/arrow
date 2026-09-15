import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useRaceGame } from './useRaceGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Race3D = lazy(() => import('./Race3D'));

export default function RaceGame(props: GameProps) {
  const game = useRaceGame(props);
  return <Scene3D render={() => <Race3D game={game} players={props.players} meId={props.meId} />} />;
}
