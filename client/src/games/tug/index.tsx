import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useTugGame } from './useTugGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Tug3D = lazy(() => import('./Tug3D'));

export default function TugWar(props: GameProps) {
  const game = useTugGame(props);
  return <Scene3D render={() => <Tug3D game={game} players={props.players} meId={props.meId} />} />;
}
