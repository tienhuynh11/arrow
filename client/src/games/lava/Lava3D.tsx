import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createLavaScene } from '../../three/lavaScene';
import { useLatest, useScene } from '../view3d';
import type { LavaGameState } from './useLavaGame';

export default function Lava3D({ game, players, meId }: { game: LavaGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createLavaScene({
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
  const { gap, out, pct } = game.hud;
  const hot = !myFin && !out && gap < 4;

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          VỀ ĐÍCH <b>{done}</b>/{game.total}
        </span>
        {myFin ? (
          <span className="hx-floor">
            BẠN VỀ ĐÍCH HẠNG <b>{myRank}</b> 🎉
          </span>
        ) : out ? (
          <span className="hx-floor out">BẠN BỊ DUNG NHAM NUỐT · {pct}%</span>
        ) : (
          <>
            <span className="hx-floor">
              ĐỘ CAO <b>{pct}</b>%
            </span>
            <span className={`hx-floor lv-gap ${hot ? 'hot' : ''}`}>
              DUNG NHAM CÁCH <b>{Math.max(0, gap).toFixed(0)}</b>m
            </span>
          </>
        )}
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className={`lv-heat ${hot ? 'on' : ''}`} style={{ opacity: hot ? Math.min(0.85, (4 - Math.max(0, gap)) / 4 + 0.25) : 0 }} />
        {out && !myFin && <div className="lv-banner">BỊ LOẠI · xem các bạn chạy tiếp</div>}
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
      <p className="hint">← ↑ → ↓ chạy · SPACE nhảy · bục cam sụp sau khi giẫm · bục xanh nhạt trơn · bục tím biến mất theo nhịp</p>
    </div>
  );
}
