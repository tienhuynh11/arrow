import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useCodeHuntGame } from './useCodeHuntGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const CodeHunt3D = lazy(() => import('./CodeHunt3D'));

export default function CodeHuntGame(props: GameProps) {
  const game = useCodeHuntGame(props);
  return <Scene3D render={() => <CodeHunt3D game={game} players={props.players} meId={props.meId} />} />;
}
