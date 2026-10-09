import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useBlindShotGame } from './useBlindShotGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const BlindShot3D = lazy(() => import('./BlindShot3D'));

export default function BlindShotGame(props: GameProps) {
  const game = useBlindShotGame(props);
  return <Scene3D render={() => <BlindShot3D game={game} players={props.players} meId={props.meId} />} />;
}
