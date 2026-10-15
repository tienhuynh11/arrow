import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useTreasureGame } from './useTreasureGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Treasure3D = lazy(() => import('./Treasure3D'));

export default function TreasureGame(props: GameProps) {
  const game = useTreasureGame(props);
  return <Scene3D render={() => <Treasure3D game={game} players={props.players} meId={props.meId} />} />;
}
