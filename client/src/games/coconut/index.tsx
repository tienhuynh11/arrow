import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useCoconutGame } from './useCoconutGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Coconut3D = lazy(() => import('./Coconut3D'));

export default function CoconutGame(props: GameProps) {
  const game = useCoconutGame(props);
  return <Scene3D render={() => <Coconut3D game={game} players={props.players} meId={props.meId} />} />;
}
