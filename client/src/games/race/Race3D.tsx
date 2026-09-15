import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createRaceScene } from '../../three/raceScene';
import { useLatest, useScene } from '../view3d';
import RaceStandings from './RaceStandings';
import type { RaceGameState } from './useRaceGame';

export default function Race3D({ game, players, meId }: { game: RaceGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createRaceScene({
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
      <RaceStandings game={game} players={players} />
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
              {game.finished[p.id] ? <b>🏁 {(game.finished[p.id] / 1000).toFixed(2)}s</b> : null}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">GIỮ → để chạy · ↑ hoặc SPACE để nhảy · vấp thì vẫn phải nhảy lại rào đó</p>
    </div>
  );
}
