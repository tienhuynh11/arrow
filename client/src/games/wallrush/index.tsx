import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useWallRushGame } from './useWallRushGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const WallRush3D = lazy(() => import('./WallRush3D'));

export default function WallRushGame(props: GameProps) {
  const game = useWallRushGame(props);
  return <Scene3D render={() => <WallRush3D game={game} players={props.players} meId={props.meId} />} />;
}
