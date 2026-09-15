import type { PlayerState } from '@shared/protocol';
import type { DodgeGameState } from './useDodgeGame';

export default function DodgeHud({ game, players }: { game: DodgeGameState; players: PlayerState[] }) {
  return (
    <>
      <div className="dz-hud">
        {players.slice(0, 8).map((p) => {
          const hp = game.lives[p.id] ?? game.cfg.lives;
          return (
            <span key={p.id} className="dz-hp" style={{ color: p.color }}>
              {p.name} <b>{hp > 0 ? '❤'.repeat(hp) : '💀'}</b>
            </span>
          );
        })}
      </div>
      <p className="hint">GIỮ ← → để chạy tự do · luồn qua khe trống · trúng vật là mất 1 mạng</p>
    </>
  );
}
