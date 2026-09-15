import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createTugScene } from '../../three/tugScene';
import { useLatest, useScene } from '../view3d';
import TugHead from './TugHead';
import type { TugGameState } from './useTugGame';

export default function Tug3D({ game, players, meId }: { game: TugGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createTugScene({
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
      <TugHead game={game} />
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
        {game.winner && (
          <div className="g3d-hud center">
            <div className="g3d-big" style={{ color: game.winner === 'A' ? '#4cc9f0' : '#ff5c7a' }}>
              {game.winner === game.myTeam ? 'ĐỘI BẠN THẮNG! 🎉' : 'ĐỘI BẠN THUA…'}
            </div>
          </div>
        )}
      </div>
      <p className="hint">Bấm SPACE thật nhanh để kéo dây về phía đội mình</p>
    </div>
  );
}
