import type { RoomState } from '@shared/protocol';
import { useStore } from '../state/store';
import { GAME_COMPONENTS } from '../games';
import Countdown from '../components/Countdown';
import Scoreboard from '../components/Scoreboard';
import Leaderboard from '../components/Leaderboard';
import FullscreenHint from '../components/FullscreenHint';

export default function Match({ room }: { room: RoomState }) {
  const meId = useStore((s) => s.meId) ?? '';
  const game = useStore((s) => s.game);
  const score = useStore((s) => s.score);
  const quality = useStore((s) => s.quality3d);

  const players = room.players.filter((p) => !p.spectator);
  const live = room.phase === 'playing';
  const Game = game ? GAME_COMPONENTS[game.gameId] : null;

  return (
    <div className="match">
      <header className="match-head">
        <div className="mh-left">
          <span className="mh-code">#{room.code}</span>
          {game && (
            <span className="mh-game">
              {game.name} · {game.round}/{game.totalRounds}
            </span>
          )}
        </div>
        <Leaderboard players={players} meId={meId} comebackPlayerId={game?.comebackPlayerId} />
        {quality && (
          <div className="mh-view">
            <span className="mh-quality" title="Tự hạ mức nếu máy chạy không kịp">
              ĐỒ HOẠ 3D · {quality}
            </span>
          </div>
        )}
      </header>

      <main className="match-stage">
        {score ? (
          <Scoreboard
            rows={score.rows}
            standings={score.standings}
            players={players}
            nextAt={score.nextAt}
            meId={meId}
          />
        ) : game && Game ? (
          <>
            <Game
              gameId={game.gameId}
              config={game.config}
              startAt={game.startAt}
              endAt={game.endAt}
              players={players}
              meId={meId}
              live={live}
            />
            {room.phase === 'countdown' && (
              <div className="overlay">
                <FullscreenHint compact />
                <Countdown
                  startAt={game.startAt}
                  name={game.name}
                  instructions={game.instructions}
                  controls={game.controls}
                  round={game.round}
                  totalRounds={game.totalRounds}
                  bonus={game.comebackPlayerId === meId}
                />
              </div>
            )}
          </>
        ) : (
          <div className="loading">Đang chuẩn bị minigame…</div>
        )}
      </main>
    </div>
  );
}
