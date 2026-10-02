import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useTipToeGame } from './useTipToeGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const TipToe3D = lazy(() => import('./TipToe3D'));

export default function TipToeGame(props: GameProps) {
  const game = useTipToeGame(props);
  return <Scene3D render={() => <TipToe3D game={game} players={props.players} meId={props.meId} />} />;
}
