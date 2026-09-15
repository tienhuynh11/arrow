import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useButtonGame } from './useButtonGame';

// Three.js chỉ được tải khi vào game — không nằm trong bundle ban đầu
const Button3D = lazy(() => import('./Button3D'));

export default function ButtonBattle(props: GameProps) {
  const game = useButtonGame(props);
  return <Scene3D render={() => <Button3D game={game} players={props.players} meId={props.meId} />} />;
}
