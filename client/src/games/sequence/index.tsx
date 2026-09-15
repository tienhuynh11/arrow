import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useSequenceGame } from './useSequenceGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Sequence3D = lazy(() => import('./Sequence3D'));

export default function SequenceGame(props: GameProps) {
  const game = useSequenceGame(props);
  return <Scene3D render={() => <Sequence3D game={game} players={props.players} meId={props.meId} />} />;
}
