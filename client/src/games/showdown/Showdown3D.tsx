import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createShowdownScene } from '../../three/showdownScene';
import { useLatest, useScene } from '../view3d';
import type { ShowdownGameState } from './useShowdownGame';

export default function Showdown3D({ game, players, meId }: { game: ShowdownGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createShowdownScene({
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
      <div className="hx-hud">
        <span className="hx-alive">
          CÒN LẠI <b>{game.alive}</b>/{game.total}
        </span>
        {game.out[meId] === undefined ? (
          <span className="hx-floor">NHẢY QUA XÀ BẰNG SPACE!</span>
        ) : (
          <span className="hx-floor out">BẠN ĐÃ RƠI — xem tiếp nhé!</span>
        )}
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className="g3d-labels">
          {players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label ${p.id === meId ? 'me' : ''} ${game.out[p.id] !== undefined ? 'dim' : ''}`}
              style={{ color: p.color }}
            >
              {p.name}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">← ↑ → ↓ chạy · SPACE nhảy qua xà (nhảy xong phải chờ một nhịp) · trúng xà bị hất văng, rơi khỏi sàn là bị loại</p>
    </div>
  );
}
