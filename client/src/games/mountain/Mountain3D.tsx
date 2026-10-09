import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createMountainScene } from '../../three/mountainScene';
import { useLatest, useScene } from '../view3d';
import type { MountainGameState } from './useMountainGame';

export default function Mountain3D({ game, players, meId }: { game: MountainGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createMountainScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!game.lastCall) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((game.lastCall - game.serverNow()) / 1000)));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [game.lastCall]);

  const done = Object.keys(game.fin).length;
  const myFin = game.fin[meId] !== undefined;
  const myRank = myFin ? Object.keys(game.fin).sort((a, b) => game.fin[a] - game.fin[b]).indexOf(meId) + 1 : 0;

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          LÊN ĐỈNH <b>{done}</b>/{game.total}
        </span>
        {myFin ? (
          <span className="hx-floor">
            BẠN LÊN ĐỈNH HẠNG <b>{myRank}</b> 🎉
          </span>
        ) : (
          <span className="hx-floor">
            ĐỘ CAO <b>{game.height}</b>%
          </span>
        )}
        {game.shield && <span className="hx-floor">🛡 KHIÊN</span>}
        {game.lastCall > 0 && left > 0 && (
          <span className="hx-floor mt-last">
            CHỐT SỔ <b>{left}</b>s
          </span>
        )}
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        {game.banner && <div className={`mt-banner mt-${game.banner.tone}`}>{game.banner.text}</div>}
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
      <p className="hint">← ↑ → ↓ chạy lên đỉnh · né bóng, gỗ, búa và vòng đỏ đá rơi · nhặt ⚡ tăng tốc, 🛡 khiên · bị trúng sẽ văng xuống (không tụt qua checkpoint)</p>
    </div>
  );
}
