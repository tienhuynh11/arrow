import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useDodgeGame } from './useDodgeGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Dodge3D = lazy(() => import('./Dodge3D'));

export default function DodgeGame(props: GameProps) {
  const game = useDodgeGame(props);
  return <Scene3D render={() => <Dodge3D game={game} players={props.players} meId={props.meId} />} />;
}
