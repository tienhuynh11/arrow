import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createBombMazeScene } from '../../three/bombMazeScene';
import { useLatest, useScene } from '../view3d';
import type { BombMazeGameState } from './useBombMazeGame';

export default function BombMaze3D({ game, players, meId }: { game: BombMazeGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createBombMazeScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  // đồng hồ báo sập sàn theo giờ server, 5 lần/giây là đủ
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(gameRef.current.serverNow()), 200);
    return () => window.clearInterval(id);
  }, []);

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '???';
  const color = (id: string) => players.find((p) => p.id === id)?.color ?? '#fff';
  const aliveCount = players.filter((p) => game.alive[p.id] !== false).length;
  const meDead = game.alive[meId] === false;
  const rel = now - game.startAt;
  const toClose = game.cfg.closeStartMs - rel;
  const closing = rel >= game.cfg.closeStartMs;

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          CÒN LẠI <b>{aliveCount}</b>/{players.length}
        </span>
        <span className="hx-floor">
          💣 <b>{game.stats[0]}</b>
        </span>
        <span className="hx-floor">
          🔥 <b>{game.stats[1]}</b>
        </span>
        <span className="hx-floor">
          ⚡ <b>{game.stats[2] + 1}</b>
        </span>
        <span className={`hx-floor ${closing || toClose < 10000 ? 'out' : ''}`}>
          {closing ? 'SÀN ĐANG SẬP!' : toClose < 15000 && toClose > 0 ? `SÀN SẬP SAU ${Math.ceil(toClose / 1000)}s` : ''}
        </span>
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className="ch-feed">
          {game.feed.map((e) => (
            <div key={e.id}>
              {e.by && e.by !== e.who ? (
                <>
                  <b style={{ color: color(e.by) }}>{name(e.by)}</b> 💥 <b style={{ color: color(e.who) }}>{name(e.who)}</b>
                </>
              ) : (
                <>
                  <b style={{ color: color(e.who) }}>{name(e.who)}</b> {e.by ? 'tự nổ mình' : 'rơi theo sàn'}
                </>
              )}
            </div>
          ))}
        </div>
        {meDead && <div className="ch-dead">💥 Bạn đã bị loại<small>xem nốt ván — người cuối cùng sẽ thắng</small></div>}
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
            </div>
          ))}
        </div>
      </div>
      <p className="hint">← ↑ → ↓ (hoặc W A S D) chạy · SPACE đặt bom · phá thùng nhặt 💣 🔥 ⚡ · đừng đứng trong lửa</p>
    </div>
  );
}
