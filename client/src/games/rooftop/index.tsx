import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useRooftopGame } from './useRooftopGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Rooftop3D = lazy(() => import('./Rooftop3D'));

export default function RooftopGame(props: GameProps) {
  const game = useRooftopGame(props);
  return <Scene3D render={() => <Rooftop3D game={game} players={props.players} meId={props.meId} />} />;
}
