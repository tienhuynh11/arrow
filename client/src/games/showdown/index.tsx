import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useShowdownGame } from './useShowdownGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Showdown3D = lazy(() => import('./Showdown3D'));

export default function ShowdownGame(props: GameProps) {
  const game = useShowdownGame(props);
  return <Scene3D render={() => <Showdown3D game={game} players={props.players} meId={props.meId} />} />;
}
