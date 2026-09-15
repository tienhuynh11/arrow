import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useReactionGame } from './useReactionGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Reaction3D = lazy(() => import('./Reaction3D'));

export default function ReactionGame(props: GameProps) {
  const game = useReactionGame(props);
  return <Scene3D render={() => <Reaction3D game={game} players={props.players} meId={props.meId} />} />;
}
