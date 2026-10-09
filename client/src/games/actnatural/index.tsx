import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useActNaturalGame } from './useActNaturalGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const ActNatural3D = lazy(() => import('./ActNatural3D'));

export default function ActNaturalGame(props: GameProps) {
  const game = useActNaturalGame(props);
  return <Scene3D render={() => <ActNatural3D game={game} players={props.players} meId={props.meId} />} />;
}
