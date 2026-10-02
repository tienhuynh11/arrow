import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createBombScene } from '../../three/bombScene';
import { useLatest, useScene } from '../view3d';
import type { BombGameState } from './useBombGame';

/**
 * Bản 3D. File này (và toàn bộ Three.js) nằm trong chunk riêng, chỉ được tải
 * khi người chơi thật sự vào game — màn chính và các game khác không phải gánh.
 */
export default function Arena3D({ game, players, meId }: { game: BombGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  // cảnh 3D chạy vòng lặp riêng và đọc trạng thái mới nhất qua ref, nên React re-render không dựng lại cảnh
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createBombScene({
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
    <div className={`g3d-stage ${game.ratio < 0.25 && game.holders.length ? 'bm-panic' : ''}`}>
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
  );
}
