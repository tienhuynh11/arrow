import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useFartGame } from './useFartGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Fart3D = lazy(() => import('./Fart3D'));

export default function FartGame(props: GameProps) {
  const core = useFartGame(props);
  return (
    <Scene3D
      render={() => (
        <Fart3D core={core} config={props.config} players={props.players} meId={props.meId} live={props.live} startAt={props.startAt} />
      )}
    />
  );
}
