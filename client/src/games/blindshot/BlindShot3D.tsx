import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createBlindShotScene } from '../../three/blindShotScene';
import { useLatest, useScene } from '../view3d';
import type { BlindShotGameState } from './useBlindShotGame';

export default function BlindShot3D({ game, players, meId }: { game: BlindShotGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createBlindShotScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  // đồng hồ pha theo giờ server, 5 lần/giây là đủ
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(gameRef.current.serverNow()), 200);
    return () => window.clearInterval(id);
  }, []);
  const { phase, round, left } = game.phaseAt(now);
  const secs = Math.max(1, Math.ceil(left / 1000));
  const r = game.lastResult && game.lastResult.r === round ? game.lastResult : null;

  const banner =
    phase === 'prep'
      ? { cls: 'prep', big: 'CHUẨN BỊ', small: 'Nhìn kỹ vị trí đối thủ — sắp biến mất!' }
      : phase === 'hide'
        ? { cls: 'hide', big: 'BIẾN MẤT', small: 'Đoán đối thủ đang đứng đâu và xoay súng về phía đó' }
        : { cls: 'reveal', big: r ? (r.hit ? 'TRÚNG!' : 'TRƯỢT') : 'BẮN!', small: r && r.hurt ? `Bạn bị bắn ${r.hurt} phát` : 'Vị trí thật đã lộ ra' };

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          VÒNG <b>{round + 1}</b>/{game.cfg.rounds}
        </span>
        <span className="hx-floor">
          TRÚNG <b>{game.hits[meId] ?? 0}</b>
        </span>
        <span className="hx-floor">
          BỊ BẮN <b>{game.hurt[meId] ?? 0}</b>
        </span>
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className={`bs-banner ${banner.cls}`}>
          <b>
            {banner.big} <i>{secs}</i>
          </b>
          <small>{banner.small}</small>
        </div>
        {phase === 'hide' && <div className="bs-dark" />}
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
      <p className="hint">← ↑ → ↓ (hoặc W A S D) chạy · di chuột để xoay súng · hết pha ẩn cả phòng bắn cùng lúc</p>
    </div>
  );
}
