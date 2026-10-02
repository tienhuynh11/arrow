import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useMemoryGame } from './useMemoryGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Memory3D = lazy(() => import('./Memory3D'));

export default function MemoryGame(props: GameProps) {
  const game = useMemoryGame(props);
  return <Scene3D render={() => <Memory3D game={game} players={props.players} meId={props.meId} />} />;
}
