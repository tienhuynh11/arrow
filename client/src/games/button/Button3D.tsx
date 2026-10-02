import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createButtonScene } from '../../three/buttonScene';
import { useLatest, useScene } from '../view3d';
import type { ButtonGameState } from './useButtonGame';
import '../g3d-extra.css';

export default function Button3D({ game, players, meId }: { game: ButtonGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createButtonScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  return (
    <div className="g3d-game">
      <div className="g3d-stage clickable" onPointerDown={() => game.live && game.tap()}>
        <div ref={hostRef} className="g3d-host" />
        <div className="g3d-labels">
          {players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label ${p.id === meId ? 'me' : ''}`}
              style={{ color: p.color }}
            >
              {p.name}
              <b>{game.counts[p.id] ?? 0}</b>
            </div>
          ))}
        </div>
        <div className="g3d-hud top">
          <span className="g3d-chip timer">{game.live ? game.remain : game.cfg.windowMs / 1000}s</span>
          <span className={`g3d-big ${game.isDanger ? 'danger' : ''}`}>{game.isDanger ? '✋ DỪNG!' : '🔥 BẤM!'}</span>
        </div>
      </div>
      <ButtonHint />
    </div>
  );
}

function ButtonHint() {
  return <p className="hint">Spam SPACE - nút chuyển ĐỎ thì dừng ngay, nhấn lúc đỏ bị trừ 15 lượt và đơ tay</p>;
}
