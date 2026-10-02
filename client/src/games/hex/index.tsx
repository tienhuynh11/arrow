import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useHexGame } from './useHexGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Hex3D = lazy(() => import('./Hex3D'));

export default function HexGame(props: GameProps) {
  const game = useHexGame(props);
  return <Scene3D render={() => <Hex3D game={game} players={props.players} meId={props.meId} />} />;
}
