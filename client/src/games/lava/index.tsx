import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useLavaGame } from './useLavaGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Lava3D = lazy(() => import('./Lava3D'));

export default function LavaGame(props: GameProps) {
  const game = useLavaGame(props);
  return <Scene3D render={() => <Lava3D game={game} players={props.players} meId={props.meId} />} />;
}
