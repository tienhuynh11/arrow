import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createBlockPartyScene } from '../../three/blockPartyScene';
import { useLatest, useScene } from '../view3d';
import { BP_COLORS, type BlockPartyGameState } from './useBlockPartyGame';

export default function BlockParty3D({ game, players, meId }: { game: BlockPartyGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createBlockPartyScene({
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
  const [left, setLeft] = useState(0);
  const [since, setSince] = useState(-1);
  useEffect(() => {
    const id = window.setInterval(() => {
      const g = gameRef.current;
      const now = g.serverNow();
      setLeft((g.round.current.dropAt - now) / 1000);
      setSince((now - g.round.current.startAt) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const rd = game.round.current;
  const col = BP_COLORS[rd.target] ?? BP_COLORS[0];
  const dropped = left <= 0;

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
        {/* màu an toàn: 0,5 giây đầu hiện to giữa màn hình, sau đó chính ô màu đó đếm ngược số giây còn lại */}
        {!dropped && (
          <div
            key={`${rd.r}-${game.live}`}
            className={`bp-center ${since >= 0.5 ? 'num' : ''}`}
            style={{ ['--c' as string]: col.hex }}
          >
            {since >= 0.5 && <b className="bp-num">{Math.max(1, Math.ceil(left))}</b>}
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
      <p className="hint">← ↑ → ↓ chạy tới ô cùng màu với “MÀU AN TOÀN” trước khi hết giờ · ô khác màu sẽ rơi</p>
    </div>
  );
}
