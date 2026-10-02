import { useRef } from 'react';
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
              className={`g3d-label ${p.id === meId ? 'me' : ''}`}
              style={{ color: p.color }}
            >
              {p.name}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">← ↑ → ↓ chạy lên đỉnh · lách sang hai bên để né bóng, khúc gỗ và búa quét · bị trúng sẽ văng xuống dốc</p>
    </div>
  );
}
