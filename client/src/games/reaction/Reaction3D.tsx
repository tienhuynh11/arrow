import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createReactionScene } from '../../three/reactionScene';
import { useLatest, useScene } from '../view3d';
import { resultText, type ReactionGameState } from './useReactionGame';
import '../g3d-extra.css';

export default function Reaction3D({ game, players, meId }: { game: ReactionGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');
  const state = game.go ? 'go' : game.fake ? 'fake' : 'wait';

  useScene(
    hostRef,
    (host, hooks) =>
      createReactionScene({
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
            const r = game.results[p.id];
            return (
              <div
                key={p.id}
                ref={(el) => {
                  labels.current.set(p.id, el);
                }}
                className={`g3d-label ${p.id === meId ? 'me' : ''} ${r?.falseStart ? 'dim' : ''}`}
                style={{ color: p.color }}
              >
                {p.name}
                {r && <b>{resultText(r)}</b>}
              </div>
            );
          })}
        </div>
        <div className="g3d-hud top">
          <div className={`g3d-big ${state}`}>{game.go ? 'GO!' : game.fake ? 'WAIT!' : 'READY...'}</div>
        </div>
      </div>
      <ReactionHint go={game.go} />
    </div>
  );
}

function ReactionHint({ go }: { go: boolean }) {
  return <p className="hint">{go ? 'NHẤN SPACE!' : 'Chỉ nhấn khi thấy GO! xanh - tín hiệu đỏ là giả'}</p>;
}
