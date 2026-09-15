import type { PlayerState } from '@shared/protocol';
import type { RaceGameState } from './useRaceGame';

export default function RaceStandings({ game, players }: { game: RaceGameState; players: PlayerState[] }) {
  const ranked = players
    .slice()
    .sort((a, b) => (game.pos[b.id]?.pos ?? 0) - (game.pos[a.id]?.pos ?? 0))
    .slice(0, 8);
  return (
    <div className="track-standings">
      {ranked.map((p, i) => (
        <span key={p.id} className="ts-item" style={{ color: p.color }}>
          {i + 1}. {p.name}{' '}
          <b>
            {game.finished[p.id]
              ? `${(game.finished[p.id] / 1000).toFixed(2)}s`
              : `${Math.round(((game.pos[p.id]?.pos ?? 0) / game.cfg.distance) * 100)}%`}
          </b>
        </span>
      ))}
    </div>
  );
}
