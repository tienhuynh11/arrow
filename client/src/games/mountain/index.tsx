import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useMountainGame } from './useMountainGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Mountain3D = lazy(() => import('./Mountain3D'));

export default function MountainGame(props: GameProps) {
  const game = useMountainGame(props);
  return <Scene3D render={() => <Mountain3D game={game} players={props.players} meId={props.meId} />} />;
}
