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
    <div className="g3d-game">
      <BombHud
        holders={game.holders}
        meId={props.meId}
        players={props.players}
        ratio={game.ratio}
        alive={game.alive}
        total={game.total}
        round={game.round}
        iOut={game.out[props.meId] !== undefined}
      />
      <Scene3D render={() => <Arena3D game={game} players={props.players} meId={props.meId} />} />
      <p className="hint">← ↑ → ↓ chạy · SPACE nhảy lên thùng, bục · ôm bom thì đuổi chạm người khác · hết ngòi là nổ</p>
    </div>
  );
}
