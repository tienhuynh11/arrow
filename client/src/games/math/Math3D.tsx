import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createMathScene } from '../../three/mathScene';
import { useLatest, useScene } from '../view3d';
import { MathHead, MathHint, MathStatus } from './MathHud';
import type { MathGameState } from './useMathGame';
import '../g3d-extra.css';

export default function Math3D({ game, players, meId }: { game: MathGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');
  const setLabel = (key: string) => (el: HTMLDivElement | null) => {
    labels.current.set(key, el);
  };

  useScene(
    hostRef,
    (host, hooks) =>
      createMathScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId, game.lanes],
  );

  return (
    <div className="g3d-game">
      <MathHead game={game} />
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className="g3d-labels">
          {game.q.options.map((v, i) => (
            <div
              key={`pad${i}`}
              ref={setLabel(`pad${i}`)}
              className={`g3d-label pad ${game.reveal === null ? '' : i === game.reveal ? 'right' : 'wrong'}`}
            >
              {v}
            </div>
          ))}
          {players.map((p) => {
            const lk = game.locked[p.id];
            return (
              <div
                key={p.id}
                ref={setLabel(p.id)}
                className={`g3d-label ${p.id === meId ? 'me' : ''}`}
                style={{ color: p.color }}
              >
                {p.name}
                {lk && (
                  <b>
                    🔒{lk.order > 0 ? ` #${lk.order}` : ''}
                    {game.reveal !== null ? ` ${lk.gained >= 0 ? '+' : ''}${lk.gained}` : ''}
                  </b>
                )}
              </div>
            );
          })}
        </div>
        <div className="g3d-hud bottom">
          <MathStatus game={game} />
        </div>
      </div>
      <MathHint />
    </div>
  );
}
