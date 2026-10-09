import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { createActNaturalScene } from '../../three/actNaturalScene';
import { useLatest, useScene } from '../view3d';
import type { ActNaturalGameState } from './useActNaturalGame';

export default function ActNatural3D({ game, players, meId }: { game: ActNaturalGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<number, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createActNaturalScene({
        host,
        hooks,
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

  const iSeeker = game.role.seeker === meId;
  const seekerName = players.find((p) => p.id === game.role.seeker)?.name ?? '???';
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '???';
  const total = game.phase === 'h' ? game.cfg.hideMs : game.phase === 'u' ? game.cfg.huntMs : game.cfg.restMs;
  const left = Math.max(0, Math.ceil((total - (now - game.phaseAt.current)) / 1000));
  const blind = iSeeker && game.phase === 'h';

  const title = iSeeker
    ? game.phase === 'h'
      ? 'ĐANG NHẮM MẮT…'
      : game.phase === 'u'
        ? 'TÌM VÀ BẮN NGƯỜI THẬT'
        : 'HẾT VÒNG'
    : game.role.alive
      ? game.phase === 'r'
        ? 'HẾT VÒNG'
        : 'HOÀ VÀO ĐÁM NPC'
      : 'BẠN ĐÃ BỊ TÌM RA';
  const sub = iSeeker
    ? game.phase === 'u'
      ? '← → bay quanh bản đồ · di chuột để rọi laze · bấm để bắn · bắn nhầm NPC là mất đạn, bị choáng'
      : 'Người trốn đang tản ra…'
    : game.role.alive
      ? game.phase === 'r'
        ? 'Danh tính lộ ra'
        : `Thợ săn: ${seekerName} (thấy tia laze của họ) · đi chậm và dừng nghỉ như NPC, đừng chạy thẳng tắp!`
      : 'Xem nốt vòng nhé';

  const revealed = Object.entries(game.reveal);

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          VÒNG <b>{game.round + 1}</b>/{game.cfg.rounds}
        </span>
        <span className="hx-floor">
          {iSeeker ? '🎯 THỢ SĂN' : '🕵️ NGƯỜI TRỐN'}
        </span>
        {iSeeker && (
          <span className={`hx-floor ${game.ammo <= 1 ? 'out' : ''}`}>
            ĐẠN <b>{game.ammo}</b>
          </span>
        )}
        <span className={`hx-floor ${left <= 8 && game.phase === 'u' ? 'out' : ''}`}>
          CÒN <b>{left}</b>s
        </span>
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className={`g3d-host ${iSeeker && game.phase === 'u' ? 'an-aim' : ''}`} />
        <div className="bs-banner">
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        {blind && (
          <div className="an-blind">
            <b>Nhắm mắt…</b>
            <span>{left}</span>
            <small>người trốn đang tản ra khắp quảng trường</small>
          </div>
        )}
        {game.stunned && iSeeker && <div className="ch-dead">💫 Choáng vì bắn nhầm NPC!</div>}
        <div className="ch-feed">
          {game.feed.map((e) => (
            <div key={e.id} style={{ color: e.bad ? '#ff9ab0' : '#fff' }}>
              {e.text}
            </div>
          ))}
        </div>
        {game.phase === 'r' && revealed.length > 0 && (
          <div className="ch-rank">
            <div>
              <b>Đã trốn:</b>
            </div>
            {revealed.map(([ent, id]) => (
              <div key={ent}>
                <b>{nameOf(id)}</b>
              </div>
            ))}
          </div>
        )}
        <div className="g3d-labels">
          {Array.from({ length: game.cfg.ents }, (_, i) => (
            <div
              key={i}
              ref={(el) => {
                labels.current.set(i, el);
              }}
              className="g3d-label"
              style={{ color: '#fff' }}
            />
          ))}
        </div>
      </div>
      <p className="hint">
        {iSeeker ? '← → bay quanh bản đồ · di chuột để rọi laze · bấm chuột (hoặc chạm) để bắn' : '← ↑ → ↓ (hoặc W A S D) đi như NPC · thợ săn đoán người thật qua cách di chuyển'}
      </p>
    </div>
  );
}
