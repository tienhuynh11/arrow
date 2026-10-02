import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createTipToeScene } from '../../three/tipToeScene';
import { useLatest, useScene } from '../view3d';
import type { TipToeGameState } from './useTipToeGame';

export default function TipToe3D({ game, players, meId }: { game: TipToeGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createTipToeScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  // đồng hồ đóng ván theo giờ server, cập nhật 5 lần/giây là đủ
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const g = gameRef.current;
      const c = g.closeAt.current;
      setLeft(c === null ? null : Math.max(0, Math.ceil((g.startAt + c - g.serverNow()) / 1000)));
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const done = game.fin[meId];

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          VỀ ĐÍCH <b>{Object.keys(game.fin).length}</b>/{players.length}
        </span>
        <span className="hx-floor">
          NGÃ <b>{game.falls}</b>
        </span>
        {left !== null && (
          <span className="hx-floor out">
            ĐÓNG VÁN SAU <b>{left}</b>s
          </span>
        )}
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        {done !== undefined && <div className="tt-done">🏁 BẠN VỀ ĐÍCH · HẠNG {done}</div>}
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
            </div>
          ))}
        </div>
      </div>
      <p className="hint">← ↑ → ↓ chạy về đích · ô giả sẽ vỡ khi bước lên — nhìn người khác thử sai để tìm đường</p>
    </div>
  );
}
