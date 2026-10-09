import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createDoorScene } from '../../three/doorScene';
import { useLatest, useScene } from '../view3d';
import type { DoorGameState } from './useDoorGame';

export default function Door3D({ game, players, meId }: { game: DoorGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createDoorScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  const done = Object.keys(game.fin).length;
  const myFin = game.fin[meId] !== undefined;
  const myRank = myFin ? Object.keys(game.fin).sort((a, b) => game.fin[a] - game.fin[b]).indexOf(meId) + 1 : 0;

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          VỀ ĐÍCH <b>{done}</b>/{game.total}
        </span>
        <span className="hx-alive">
          ĐIỂM <b>{game.pts}</b>
          {game.toast ? <i key={game.toast.n} className="door-pop"> +{game.toast.pts}</i> : null}
        </span>
        {myFin ? (
          <span className="hx-floor">
            BẠN VỀ HẠNG <b>{myRank}</b> 🎉
          </span>
        ) : (
          <span className="hx-floor">
            HÀNG CỬA <b>{Math.min(game.row + 1, game.cfg.rows)}</b>/{game.cfg.rows}
          </span>
        )}
      </div>
      {game.banner ? (
        <div key={game.banner.n} className="door-banner">
          {game.banner.text}
        </div>
      ) : null}
      {game.boost > 1.2 || game.behind ? (
        <div className="door-buff">{game.boost > 1.2 ? 'TĂNG TỐC' : 'ĐUỔI KỊP: chạy nhanh hơn, ít choáng, cửa giả đã thử bị tối đi'}</div>
      ) : null}
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
            </div>
          ))}
        </div>
      </div>
      <p className="hint">← ↑ → ↓ chạy · cửa thật mở vài giây rồi đóng sầm, đổi chỗ · người tìm ra cửa +1 điểm và tăng tốc · tụt lùi 2 hàng được chạy nhanh hơn · qua hàng đầu 3/2/1 điểm</p>
    </div>
  );
}
