import { lazy } from 'react';
import type { GameProps } from '../types';
import { Scene3D } from '../view3d';
import { useBombGame } from './useBombGame';
import BombHud from './BombHud';

// Three.js chỉ được tải ở đây, lúc game bắt đầu — không nằm trong bundle ban đầu
const Arena3D = lazy(() => import('./Arena3D'));

export default function BombGame(props: GameProps) {
  const game = useBombGame(props);

  return (
    <div className="bomb">
      <BombHud holder={game.holder} meId={props.meId} players={props.players} ratio={game.ratio} />
      <Scene3D render={() => <Arena3D game={game} players={props.players} meId={props.meId} />} />
      <p className="hint">← ↑ → ↓ chạy tự do · ôm bom thì đuổi chạm người khác · hết ngòi là nổ</p>
    </div>
  );
}
