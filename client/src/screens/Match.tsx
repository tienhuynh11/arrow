import type { RoomState } from '@shared/protocol';
import { useStore } from '../state/store';
import { GAME_COMPONENTS } from '../games';
import Countdown from '../components/Countdown';
import Scoreboard from '../components/Scoreboard';
import Leaderboard from '../components/Leaderboard';
import Board from './Board';
import FullscreenHint from '../components/FullscreenHint';
import TouchControls, { isTouchDevice } from '../components/TouchControls';

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
          {!game && room.mode === 'journey' && room.board && (
            <span className="mh-game">
              HÀNH TRÌNH XUYÊN VIỆT · {room.board.turn}/{room.board.totalTurns}
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
        {room.phase === 'board' && room.board ? (
          <Board room={room} meId={meId} />
        ) : score ? (
          <Scoreboard
            rows={score.rows}
            standings={score.standings}
            players={players}
            nextAt={score.nextAt}
            meId={meId}
            board={score.board}
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
            {live && !score && isTouchDevice() && <TouchControls gameId={game.gameId} controls={game.controls} />}
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
