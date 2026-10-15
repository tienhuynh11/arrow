import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useDisasterGame } from './useDisasterGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Disaster3D = lazy(() => import('./Disaster3D'));

export default function DisasterGame(props: GameProps) {
  const game = useDisasterGame(props);
  return <Scene3D render={() => <Disaster3D game={game} players={props.players} meId={props.meId} />} />;
}
