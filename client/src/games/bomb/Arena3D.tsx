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
    (host, callbacks) =>
      createBombScene({
        host,
        cfg: gameRef.current.cfg,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
        onQuality: callbacks.onQuality,
        onFail: callbacks.onFail,
      }),
    [rosterKey, meId],
  );

  return (
    <div className={`bm-stage3d ${game.ratio < 0.25 && game.holder ? 'panic' : ''}`}>
      <div ref={hostRef} className="bm-canvas-host" />
      <div className="bm-labels">
        {players.map((p) => {
          const hp = game.lives[p.id] ?? game.cfg.lives;
          return (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`bm-label3d ${p.id === meId ? 'me' : ''} ${hp <= 0 ? 'dead' : ''}`}
              style={{ color: p.color }}
            >
              {p.name}
              <b>{hp > 0 ? '❤'.repeat(hp) : '💀'}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}
