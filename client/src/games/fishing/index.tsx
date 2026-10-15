import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useFishingGame } from './useFishingGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Fishing3D = lazy(() => import('./Fishing3D'));

export default function FishingGame(props: GameProps) {
  const core = useFishingGame(props);
  return <Scene3D render={() => <Fishing3D core={core} players={props.players} meId={props.meId} live={props.live} />} />;
}
