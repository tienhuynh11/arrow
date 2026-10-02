import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createHexScene } from '../../three/hexScene';
import { useLatest, useScene } from '../view3d';
import type { HexGameState } from './useHexGame';

export default function Hex3D({ game, players, meId }: { game: HexGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createHexScene({
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
          <span className="hx-floor">
            TẦNG <b>{game.layer + 1}</b>/{game.cfg.layers}
          </span>
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
      <p className="hint">← ↑ → ↓ chạy · SPACE nhảy qua chỗ trống · đứng yên là ô dưới chân rơi · rơi hết các tầng là bị loại</p>
    </div>
  );
}
