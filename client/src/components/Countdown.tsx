import { useEffect, useRef } from 'react';
import type { ControlHint } from '@shared/protocol';
import { sfx } from '../utils/sound';
import { useServerClock } from '../utils/hooks';

/**
 * Màn hướng dẫn trước mỗi minigame: có đủ thời gian đọc luật và xem phím bấm,
 * 3 giây cuối mới đếm ngược lớn.
 */
export default function Countdown({
  startAt,
  name,
  instructions,
  controls,
  round,
  totalRounds,
  bonus,
}: {
  startAt: number;
  name: string;
  instructions: string;
  controls: ControlHint[];
  round: number;
  totalRounds: number;
  bonus: boolean;
}) {
  const now = useServerClock(60);
  const remain = Math.max(0, startAt - now);
  const n = Math.ceil(remain / 1000);
  const lastTick = useRef(-1);

  useEffect(() => {
    if (n !== lastTick.current && n > 0 && n <= 3) {
      lastTick.current = n;
      sfx.tick();
    }
  }, [n]);

  return (
    <div className="howto">
      <div className="ht-round">
        MINIGAME {round}/{totalRounds}
      </div>
      <div className="ht-name">{name}</div>

      <div className="ht-card">
        <div className="ht-label">CÁCH CHƠI</div>
        <p className="ht-text">{instructions}</p>

        <div className="ht-controls">
          {controls.map((c, i) => (
            <div key={i} className="ht-control">
              <span className="ht-keys">
                {c.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
              <span className="ht-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {bonus && <div className="ht-bonus">LAST PLACE BONUS · +10% điểm ván này</div>}

      {n > 3 ? (
        <div className="ht-wait">
          Bắt đầu sau <b>{n}</b> giây…
          <div className="ht-bar">
            <div className="ht-bar-fill" style={{ width: `${(1 - remain / 10_000) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div key={n} className="ht-number">
          {n > 0 ? n : 'GO!'}
        </div>
      )}
    </div>
  );
}
