import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createChairsScene } from '../../three/chairsScene';
import { useLatest, useScene } from '../view3d';
import type { ChairsGameState } from './useChairsGame';

export default function Chairs3D({ game, players, meId }: { game: ChairsGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createChairsScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  const aliveCount = players.filter((p) => game.alive[p.id] !== false).length;
  const meOut = game.alive[meId] === false;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '???';
  const color = (id: string) => players.find((p) => p.id === id)?.color ?? '#fff';
  const justOut = game.out && Date.now() - game.out.at < 3500 ? game.out.ids : [];

  const banner =
    game.phase === 'm'
      ? { cls: 'music', big: '🎵 NHẠC ĐANG PHÁT', small: 'Chạy vòng quanh ghế — ↑ → nhanh, ↓ ← chậm · nhạc sẽ dừng bất ngờ!' }
      : game.phase === 's'
        ? { cls: 'stop', big: 'DỪNG NHẠC! NGỒI NGAY!', small: 'Chạm vào ghế trống trước người khác' }
        : { cls: 'rest', big: justOut.length ? 'ĐÃ CÓ NGƯỜI BỊ LOẠI' : 'CHUẨN BỊ VÒNG MỚI', small: justOut.length ? justOut.map(name).join(', ') : 'Bớt một chiếc ghế…' };

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          CÒN LẠI <b>{aliveCount}</b>/{players.length}
        </span>
        <span className="hx-floor">
          VÒNG <b>{game.round + 1}</b>
        </span>
        <span className="hx-floor">
          GHẾ <b>{game.chairs.current.length}</b>
        </span>
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className={`bs-banner ${banner.cls === 'stop' ? 'reveal' : banner.cls === 'rest' ? '' : ''}`}>
          <b>{banner.big}</b>
          <small>{banner.small}</small>
        </div>
        {justOut.length > 0 && (
          <div className="ch-feed">
            {justOut.map((id) => (
              <div key={id}>
                <b style={{ color: color(id) }}>{name(id)}</b> bị loại
              </div>
            ))}
          </div>
        )}
        {meOut && <div className="ch-dead">💺 Bạn đã bị loại<small>xem nốt ván nhé</small></div>}
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
      <p className="hint">Nhạc phát: cả phòng chạy vòng một hướng · ↑ → nhanh hơn, ↓ ← chậm lại · nhạc dừng: ← ↑ → ↓ chạy tự do tới ghế trống</p>
    </div>
  );
}
