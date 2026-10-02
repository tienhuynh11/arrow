import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createCoconutScene } from '../../three/coconutScene';
import { useLatest, useScene } from '../view3d';
import type { CoconutGameState } from './useCoconutGame';
import '../g3d-extra.css';

export default function Coconut3D({ game, players, meId }: { game: CoconutGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createCoconutScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  return (
    <div className="g3d-game">
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
              <b>🥥 {game.snap[p.id]?.c ?? 0}</b>
            </div>
          ))}
        </div>
        <div className="g3d-hud top">
          <span className="g3d-chip timer">{game.live ? game.remain : game.cfg.durationMs / 1000}s</span>
          <span className={`g3d-big ${game.wind === 'none' ? 'go' : game.wind === 'warn' ? 'wait' : 'danger'}`}>
            {game.wind === 'active' ? '🌪️ GIÓ LẮC · BUÔNG TAY!' : game.wind === 'warn' ? '🌬️ Gió sắp lắc…' : '🥥 LEO!'}
          </span>
        </div>
      </div>
      <p className="hint">Bấm LUÂN PHIÊN ← → (hoặc A D) để leo · gió lắc thì buông tay, lỡ leo là bị trượt xuống</p>
    </div>
  );
}
