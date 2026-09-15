import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useRhythmGame } from './useRhythmGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Rhythm3D = lazy(() => import('./Rhythm3D'));

export default function RhythmGame(props: GameProps) {
  const game = useRhythmGame(props);
  return <Scene3D render={() => <Rhythm3D game={game} players={props.players} meId={props.meId} />} />;
}
