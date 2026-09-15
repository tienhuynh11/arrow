import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createSequenceScene } from '../../three/sequenceScene';
import { useLatest, useScene } from '../view3d';
import SequenceHead from './SequenceHead';
import type { SequenceGameState } from './useSequenceGame';
import '../g3d-extra.css';

export default function Sequence3D({ game, players, meId }: { game: SequenceGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createSequenceScene({
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
          {players.map((p) => {
            const q = game.prog[p.id];
            return (
              <div
                key={p.id}
                ref={(el) => {
                  labels.current.set(p.id, el);
                }}
                className={`g3d-label ${p.id === meId ? 'me' : ''}`}
                style={{ color: p.color }}
              >
                {p.name}
                <b>{q?.done ? '🏆' : `${game.doneOf(q)}/${game.totalKeys}`}</b>
              </div>
            );
          })}
        </div>
        <div className="g3d-hud top">
          <SequenceHead game={game} meId={meId} />
        </div>
      </div>
      <p className="hint">Dùng phím mũi tên ← ↑ → ↓ · gõ đúng mỗi phím là leo lên 1 bậc</p>
    </div>
  );
}
