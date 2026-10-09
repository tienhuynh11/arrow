import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useChairsGame } from './useChairsGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Chairs3D = lazy(() => import('./Chairs3D'));

export default function ChairsGame(props: GameProps) {
  const game = useChairsGame(props);
  return <Scene3D render={() => <Chairs3D game={game} players={props.players} meId={props.meId} />} />;
}
