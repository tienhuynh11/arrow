import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createDodgeScene } from '../../three/dodgeScene';
import { useLatest, useScene } from '../view3d';
import DodgeHud from './DodgeHud';
import type { DodgeGameState } from './useDodgeGame';

export default function Dodge3D({ game, players, meId }: { game: DodgeGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createDodgeScene({
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
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className="g3d-labels">
          {players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label ${p.id === meId ? 'me' : ''} ${(game.lives[p.id] ?? game.cfg.lives) <= 0 ? 'dim' : ''}`}
              style={{ color: p.color }}
            >
              {p.name}
            </div>
          ))}
        </div>
      </div>
      <DodgeHud game={game} players={players} />
    </div>
  );
}
