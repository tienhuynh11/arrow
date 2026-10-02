import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createMemoryScene } from '../../three/memoryScene';
import { useLatest, useScene } from '../view3d';
import { MM_SYMBOLS, drawHidden, drawSymbol } from './symbols';
import type { MemoryGameState } from './useMemoryGame';

/** ô vuông hiện hình cần tìm (vẽ bằng canvas, dùng lại đúng bộ hình trên sàn) */
function SymbolPic({ id }: { id: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    if (id < 0) drawHidden(g, 128);
    else drawSymbol(g, id, 128);
  }, [id]);
  return <canvas ref={ref} width={128} height={128} className="mm-pic" />;
}

export default function Memory3D({ game, players, meId }: { game: MemoryGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createMemoryScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  // đếm ngược theo đồng hồ server, cập nhật 10 lần/giây là đủ
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(gameRef.current.serverNow()), 100);
    return () => window.clearInterval(id);
  }, []);

  const rd = game.round.current;
  const memorizing = now < rd.hideAt;
  const left = ((memorizing ? rd.hideAt : rd.dropAt) - now) / 1000;
  const dropped = now >= rd.dropAt;
  const color = rd.target >= 0 ? MM_SYMBOLS[rd.target]?.hex : '#8c9ad6';

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          CÒN LẠI <b>{game.alive}</b>/{game.total}
        </span>
        <span className="hx-floor">
          VÒNG <b>{game.roundNo + 1}</b>
        </span>
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        {/* trước giờ úp: "GHI NHỚ" + số giây; sau đó: hình cần tìm + số giây còn lại */}
        {!dropped && (
          <div key={`${rd.r}-${memorizing}`} className="mm-hud" style={{ ['--c' as string]: color }}>
            {memorizing ? (
              <span className="mm-memo">GHI NHỚ!</span>
            ) : (
              <SymbolPic id={rd.target} />
            )}
            <b className="mm-num">{Math.max(1, Math.ceil(left))}</b>
          </div>
        )}
        <div className="g3d-labels">
          {players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label ${p.id === meId ? 'me' : ''} ${game.out[p.id] !== undefined ? 'dim' : ''}`}
              style={{ color: p.color }}
            >
              {p.name}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">← ↑ → ↓ nhớ vị trí các hình, rồi chạy tới ô có HÌNH CẦN TÌM trước khi hết giờ · ô khác hình sẽ rơi</p>
    </div>
  );
}
