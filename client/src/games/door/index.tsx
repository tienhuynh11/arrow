import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useDoorGame } from './useDoorGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Door3D = lazy(() => import('./Door3D'));

export default function DoorGame(props: GameProps) {
  const game = useDoorGame(props);
  return <Scene3D render={() => <Door3D game={game} players={props.players} meId={props.meId} />} />;
}
