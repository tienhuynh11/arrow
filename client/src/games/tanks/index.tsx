import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useTanksGame } from './useTanksGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Tanks3D = lazy(() => import('./Tanks3D'));

export default function TanksGame(props: GameProps) {
  const game = useTanksGame(props);
  return <Scene3D render={() => <Tanks3D game={game} players={props.players} meId={props.meId} />} />;
}
