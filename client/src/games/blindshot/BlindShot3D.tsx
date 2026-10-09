import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createBlindShotScene } from '../../three/blindShotScene';
import { useLatest, useScene } from '../view3d';
import type { BlindShotGameState } from './useBlindShotGame';

export default function BlindShot3D({ game, players, meId }: { game: BlindShotGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const hitLabels = useRef(new Map<string, HTMLDivElement | null>());
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
        hitLabels: hitLabels.current,
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
  const tr = game.cfg.revealMs - left; // ms từ đầu pha kết quả
  const radius = Math.round(game.radiusAt(now));
  const meOut = game.out.current.has(meId);
  const secs = Math.max(1, Math.ceil(left / 1000));
  const r = game.lastResult && game.lastResult.r === round ? game.lastResult : null;

  const done = tr >= 4600; // đã tới cảnh trúng đạn
  const banner =
    phase === 'prep'
      ? { cls: 'prep', big: 'CHUẨN BỊ', small: meOut ? 'Bạn đã bị loại — đang xem trận' : 'Sân đang thu nhỏ · nhìn kỹ vị trí đối thủ — sắp biến mất!' }
      : phase === 'hide'
        ? { cls: 'hide', big: 'BIẾN MẤT', small: meOut ? 'Bạn đã bị loại — khán giả thấy hết' : 'Đoán đối thủ đang đứng đâu và xoay súng về phía đó' }
        : !r
          ? { cls: 'reveal', big: 'BẮN!', small: 'Đang chờ kết quả...' }
          : tr < 1300
            ? { cls: 'reveal', big: 'HIỆN HÌNH', small: 'Vị trí thật của mọi người' }
            : !done
              ? { cls: 'reveal', big: 'LAZE!', small: 'Xem tia đạn của từng người' }
              : r.died
                ? { cls: 'reveal', big: 'BẠN BỊ LOẠI', small: 'Bạn trúng đạn — ở lại xem trận' }
                : { cls: 'reveal', big: r.hit ? 'TRÚNG!' : 'TRƯỢT', small: r.hit ? 'Bạn đã hạ một đối thủ' : 'Bạn sống sót qua vòng này' };

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          VÒNG <b>{round + 1}</b>/{game.cfg.rounds}
        </span>
        <span className="hx-floor">
          CÒN LẠI <b>{game.alive}</b>
        </span>
        <span className="hx-floor">
          SÂN <b>{radius}</b>
        </span>
        <span className="hx-floor">
          HẠ <b>{game.kills[meId] ?? 0}</b>
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
              key={`h${p.id}`}
              ref={(el) => {
                hitLabels.current.set(p.id, el);
              }}
              className="g3d-label bs-hit"
            >
              TRÚNG!
            </div>
          ))}
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
      <p className="hint">← ↑ → ↓ (hoặc W A S D) chạy · di chuột để xoay súng · hết pha ẩn cả phòng bắn cùng lúc · trúng đạn là bị loại</p>
    </div>
  );
}
