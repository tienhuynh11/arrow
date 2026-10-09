import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useBombMazeGame } from './useBombMazeGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const BombMaze3D = lazy(() => import('./BombMaze3D'));

export default function BombMazeGame(props: GameProps) {
  const game = useBombMazeGame(props);
  return <Scene3D render={() => <BombMaze3D game={game} players={props.players} meId={props.meId} />} />;
}
