import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { PK_ICON, PK_NAME } from '@shared/tank';
import { createTanksScene } from '../../three/tanksScene';
import { useLatest, useScene } from '../view3d';
import type { TanksGameState } from './useTanksGame';

export default function Tanks3D({ game, players, meId }: { game: TanksGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const { ac, seat, hud } = game;
  const byId = new Map(players.map((p) => [p.id, p]));
  const arenaPlayers = ac.ids.map((id) => ({ id, color: byId.get(id)?.color ?? '#ffffff' }));
  const rosterKey = ac.ids.map((id) => `${id}:${byId.get(id)?.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createTanksScene({
        host,
        hooks,
        players: arenaPlayers,
        meSeat: seat,
        mw: ac.w,
        mh: ac.h,
        read: () => ({ cl: gameRef.current.cl, step: gameRef.current.step, serverNow: gameRef.current.serverNow }),
        labels: labels.current,
      }),
    [rosterKey, meId, game.cl],
  );

  const nameOf = (i: number) => byId.get(ac.ids[i])?.name ?? '?';
  const iAlive = hud.alive[seat] ?? true;
  const order = ac.ids.map((_, i) => i).sort((a, b) => (hud.score[b] ?? 0) + (hud.kills[b] ?? 0) * 0.01 - ((hud.score[a] ?? 0) + (hud.kills[a] ?? 0) * 0.01));
  const weaponTxt = hud.weapon === 1 ? `${Math.ceil(hud.weaponLeft / 60)}s` : hud.weapon > 1 ? `×${hud.weaponLeft}` : '';

  let banner: { text: string; sub?: string; cls: string } | null = null;
  if (hud.finished) banner = { text: 'HẾT VÁN!', sub: 'Đang tổng kết điểm…', cls: 'end' };
  else if (hud.phase === 0 && hud.count > 0) banner = { text: String(hud.count), sub: `VÒNG ${hud.round}/${hud.rounds}`, cls: 'count' };
  else if (hud.go) banner = { text: 'BẮN!', cls: 'go' };
  else if (hud.phase === 2)
    banner =
      hud.winner === seat
        ? { text: '🏆 BẠN THẮNG VÒNG!', sub: '+1000 điểm', cls: 'win' }
        : hud.winner >= 0
          ? { text: `${nameOf(hud.winner)} thắng vòng`, sub: iAlive ? undefined : 'Bạn đã bị hạ', cls: 'lose' }
          : { text: 'HOÀ VÒNG', sub: 'Hết giờ - không ai thắng', cls: 'draw' };
  else if (!iAlive && hud.phase === 1) banner = { text: '💥 Bạn đã bị hạ', sub: 'Xem các bạn đấu tiếp', cls: 'dead' };

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          CÒN LẠI <b>{hud.aliveN}</b>/{ac.ids.length}
        </span>
        <span className="hx-floor">
          VÒNG <b>{hud.round}</b>/{hud.rounds}
        </span>
        <span className="hx-floor">
          ĐIỂM <b>{Math.round(hud.score[seat] ?? 0)}</b>
        </span>
        {hud.sudden && hud.phase === 1 && <span className="hx-floor out">⚠ ĐẠN BÃO!</span>}
      </div>
      <div
        className="g3d-stage"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button === 0) game.fireOnce();
        }}
      >
        <div ref={hostRef} className="g3d-host" />
        <div className="tk-board">
          {order.map((i) => (
            <div key={i} className={`tk-row ${i === seat ? 'me' : ''} ${hud.alive[i] === false ? 'dead' : ''}`}>
              <i style={{ background: byId.get(ac.ids[i])?.color }} />
              <span>{nameOf(i)}</span>
              <em>{hud.alive[i] === false ? '💀' : ''}</em>
              <b>{Math.round(hud.score[i] ?? 0)}</b>
            </div>
          ))}
        </div>
        {(hud.weapon > 0 || hud.shield) && iAlive && (
          <div className="tk-items">
            {hud.weapon > 0 && (
              <span>
                {PK_ICON[hud.weapon]} {PK_NAME[hud.weapon]} <b>{weaponTxt}</b>
              </span>
            )}
            {hud.shield && (
              <span>
                {PK_ICON[5]} {PK_NAME[5]}
              </span>
            )}
          </div>
        )}
        {banner && (
          <div className={`tk-banner ${banner.cls}`} key={`${hud.round}-${banner.cls}-${banner.text}`}>
            <b>{banner.text}</b>
            {banner.sub && <small>{banner.sub}</small>}
          </div>
        )}
        <div className="g3d-labels">
          {ac.ids.map((id, i) => (
            <div
              key={id}
              ref={(el) => {
                labels.current.set(id, el);
              }}
              className={`g3d-label ${id === meId ? 'me' : ''} ${hud.alive[i] === false ? 'dim' : ''}`}
              style={{ color: byId.get(id)?.color }}
            >
              {byId.get(id)?.name}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">W/↑ tiến · S/↓ lùi · A D / ← → xoay · SPACE hoặc chuột trái bắn · đạn nảy tường, coi chừng chính mình!</p>
    </div>
  );
}
