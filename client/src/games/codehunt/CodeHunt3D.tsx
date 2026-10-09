import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createCodeHuntScene } from '../../three/codeHuntScene';
import { isTouchDevice } from '../../components/TouchControls';
import { useLatest, useScene } from '../view3d';
import type { CodeHuntGameState } from './useCodeHuntGame';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function CodeHunt3D({ game, players, meId }: { game: CodeHuntGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createCodeHuntScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
      }),
    [rosterKey, meId],
  );

  // đồng hồ 2:30, đếm hồi sinh và các hiệu ứng ngắn: cập nhật 5 lần/giây là đủ
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(gameRef.current.serverNow()), 200);
    return () => window.clearInterval(id);
  }, []);

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '???';
  const color = (id: string) => players.find((p) => p.id === id)?.color ?? '#fff';
  const left = game.endAt - now;
  const ranking = [...players].sort(
    (a, b) => (game.kills[b.id] ?? 0) - (game.kills[a.id] ?? 0) || (game.deaths[a.id] ?? 0) - (game.deaths[b.id] ?? 0),
  );
  const locked = Date.now() < game.lockUntil;
  const respawnIn = Math.max(0, game.respawnAt - now);
  const touch = isTouchDevice();
  const f = game.flash && Date.now() - game.flash.at < 900 ? game.flash : null;

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          HẠ <b>{game.kills[meId] ?? 0}</b>
        </span>
        <span className="hx-floor">
          BỊ HẠ <b>{game.deaths[meId] ?? 0}</b>
        </span>
        <span className={`hx-floor ${left < 15000 ? 'out' : ''}`}>
          CÒN <b>{fmt(left)}</b>
        </span>
        <span className="hx-floor">
          MÃ CỦA BẠN <b>{game.myCode || '---'}</b>
        </span>
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />

        <div className="ch-rank">
          {ranking.slice(0, 5).map((p, i) => (
            <div key={p.id} className={p.id === meId ? 'me' : ''}>
              <span>{i + 1}</span>
              <b style={{ color: p.color }}>{p.name}</b>
              <em>{game.kills[p.id] ?? 0}</em>
            </div>
          ))}
        </div>

        <div className="ch-feed">
          {game.feed.map((e) => (
            <div key={e.id}>
              <b style={{ color: color(e.killer) }}>{name(e.killer)}</b> ➜ <b style={{ color: color(e.victim) }}>{name(e.victim)}</b>
            </div>
          ))}
        </div>

        {game.alive ? (
          <div className={`ch-code ${locked ? 'lock' : ''} ${f ? (f.ok ? 'ok' : 'bad') : ''}`}>
            {[0, 1, 2].map((i) => (
              <span key={i}>{game.typed[i] ?? '·'}</span>
            ))}
            {f && <em>{f.text}</em>}
          </div>
        ) : (
          <div className="ch-dead">
            💥 {game.killer ? <b style={{ color: color(game.killer) }}>{name(game.killer)}</b> : 'Bạn'} đã hạ bạn
            <small>hồi sinh sau {Math.max(1, Math.ceil(respawnIn / 1000))}s</small>
          </div>
        )}

        {touch && game.alive && (
          <div className="ch-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} type="button" onPointerDown={(e) => (e.preventDefault(), game.type(d))}>
                {d}
              </button>
            ))}
            <button type="button" onPointerDown={(e) => (e.preventDefault(), game.backspace())}>
              ⌫
            </button>
            <button type="button" onPointerDown={(e) => (e.preventDefault(), game.type('0'))}>
              0
            </button>
          </div>
        )}

        <div className="g3d-labels">
          {players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label ch-label ${p.id === meId ? 'me' : ''}`}
              style={{ color: p.color }}
            >
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="hint">← ↑ → ↓ chạy · hai người phải nhìn thẳng vào mặt nhau mới đọc được mã 3 số trên bảng 3D trên đầu · gõ số để hạ · tường che mất tầm nhìn</p>
    </div>
  );
}
