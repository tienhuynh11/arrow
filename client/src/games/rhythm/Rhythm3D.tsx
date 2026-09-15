import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createRhythmScene } from '../../three/rhythmScene';
import { useLatest, useScene } from '../view3d';
import RhythmJudge from './RhythmJudge';
import type { RhythmGameState } from './useRhythmGame';
import '../g3d-extra.css';

export default function Rhythm3D({ game, players, meId }: { game: RhythmGameState; players: PlayerState[]; meId: string }) {
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
      createRhythmScene({
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
          <div ref={setLabel('lane0')} className="g3d-label lane" style={{ color: '#4cc9f0' }}>
            SPACE
          </div>
          <div ref={setLabel('lane1')} className="g3d-label lane" style={{ color: '#b388ff' }}>
            ↑
          </div>
          {players.map((p) => {
            const s = game.status[p.id];
            return (
              <div
                key={p.id}
                ref={setLabel(p.id)}
                className={`g3d-label ${p.id === meId ? 'me' : ''}`}
                style={{ color: p.color }}
              >
                {p.name}
                <b>
                  {s?.score ?? 0}
                  {s && s.combo > 1 ? ` · x${s.combo}` : ''}
                </b>
              </div>
            );
          })}
        </div>
        <RhythmJudge game={game} meId={meId} />
      </div>
      <p className="hint">Làn trái SPACE · làn phải ↑ · nốt vàng gấp đôi · nốt gai đỏ là BẪY, đừng bấm!</p>
    </div>
  );
}
