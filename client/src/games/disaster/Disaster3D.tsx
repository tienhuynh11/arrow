import { useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { DEATH_TXT, KIND_HINT, KIND_ICON, KIND_NAME } from '@shared/disaster';
import { createDisasterScene } from '../../three/disasterScene';
import { isTouchDevice } from '../../components/TouchControls';
import { useLatest, useScene } from '../view3d';
import type { DisasterGameState } from './useDisasterGame';

export default function Disaster3D({ game, players, meId }: { game: DisasterGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const gameRef = useLatest(game);
  const { ids, seat, hud, cl } = game;
  const byId = new Map(players.map((p) => [p.id, p]));
  const rosterKey = ids.map((id) => `${id}:${byId.get(id)?.color}`).join('|');
  const touch = isTouchDevice();

  useScene(
    hostRef,
    (host, hooks) =>
      createDisasterScene({
        host,
        hooks,
        players: ids.map((id) => ({ id, color: byId.get(id)?.color ?? '#ffffff' })),
        meSeat: seat,
        read: () => ({ cl: gameRef.current.cl, step: gameRef.current.step, serverNow: gameRef.current.serverNow }),
        labels: labels.current,
      }),
    [rosterKey, meId, cl],
  );

  const nameOf = (i: number) => byId.get(ids[i])?.name ?? '?';
  const colorOf = (i: number) => byId.get(ids[i])?.color ?? '#fff';
  const res = hud.result;

  let banner: { cls: string; icon: string; title: string; sub?: string } | null = null;
  if (res) banner = null;
  else if (hud.stage === 'intro')
    banner = {
      cls: 'intro',
      icon: '🌍',
      title: `VÒNG ${hud.round}/${hud.rounds} · ${hud.theme.toUpperCase()}`,
      sub: hud.secs > 0 ? `Thảm họa nào sẽ ập tới? Chưa ai biết… (${hud.secs})` : undefined,
    };
  else if (hud.stage === 'warn')
    banner = { cls: 'warn', icon: KIND_ICON[hud.kind], title: `${KIND_NAME[hud.kind]} SẮP TỚI!`, sub: `${KIND_HINT[hud.kind]} (${hud.secs})` };
  else if (hud.stage === 'act')
    banner = {
      cls: 'act',
      icon: hud.kind ? KIND_ICON[hud.kind] : '✔',
      title: hud.kind ? KIND_NAME[hud.kind] + (hud.alsoKind ? ` + ${KIND_NAME[hud.alsoKind]}` : '') : 'SẮP XONG VÒNG',
      sub: hud.kind ? KIND_HINT[hud.kind] : undefined,
    };
  else if (hud.stage === 'gap') banner = { cls: 'gap', icon: '❓', title: 'THẢM HỌA TIẾP THEO LÀ GÌ?', sub: 'Giữ bình tĩnh, ở nơi an toàn…' };

  const order = ids.map((_, i) => i).sort((a, b) => (res ? res.rk[a] - res.rk[b] : Number(hud.alive[b]) - Number(hud.alive[a])));

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          CÒN SỐNG <b>{hud.aliveN}</b>/{ids.length}
        </span>
        <span className="hx-floor">
          VÒNG <b>{hud.round}</b>/{hud.rounds}
        </span>
        {hud.stage === 'warn' || hud.stage === 'act' ? (
          <span className={`hx-floor ${hud.stage === 'warn' ? 'out' : ''}`}>
            {KIND_ICON[hud.kind]} {KIND_NAME[hud.kind]}
          </span>
        ) : null}
      </div>
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host" />
        <div className="dz-board">
          {order.map((i) => (
            <div key={i} className={`dz-row ${i === seat ? 'me' : ''} ${hud.alive[i] === false ? 'dead' : ''}`}>
              <i style={{ background: colorOf(i) }} />
              <span>{nameOf(i)}</span>
              <em>{res ? `#${res.rk[i]}` : hud.alive[i] === false ? '💀' : ''}</em>
              {res && <b>{res.tot[i]}</b>}
            </div>
          ))}
        </div>
        {banner && (
          <div className={`dz-banner ${banner.cls}`} key={`${hud.round}-${banner.cls}-${hud.kind}`}>
            <span className="dz-ico">{banner.icon}</span>
            <b>{banner.title}</b>
            {banner.sub && <small>{banner.sub}</small>}
          </div>
        )}
        {hud.wet > 0.05 && hud.meAlive && (
          <div className="dz-wet" title="Sắp chết đuối!">
            <i style={{ width: `${hud.wet * 100}%` }} />
            <span>🌊 CHẠY LÊN CAO!</span>
          </div>
        )}
        {!hud.meAlive && !res && (
          <div className="dz-dead">
            💀 Bạn {DEATH_TXT[hud.cause] || 'đã bị loại'}
            <small>Xem các bạn đấu tiếp…</small>
          </div>
        )}
        {hud.meWon && !res && <div className="dz-dead win">🏆 Bạn là người sống sót cuối cùng!</div>}
        {res && (
          <div className="dz-result">
            <b>{res.rk[seat] === 1 ? '🏆 BẠN THẮNG VÒNG!' : `HẠNG ${res.rk[seat]}/${ids.length} VÒNG ${res.r + 1}`}</b>
            <small>
              +{res.pt[seat]} điểm · tổng {res.tot[seat]}
              {res.nb < 0 ? ' · hết ván, đang tổng kết…' : ' · vòng sau sắp bắt đầu'}
            </small>
          </div>
        )}
        <div className="g3d-labels">
          {ids.map((id, i) => (
            <div
              key={id}
              ref={(el) => {
                labels.current.set(id, el);
              }}
              className={`g3d-label ${id === meId ? 'me' : ''} ${hud.alive[i] === false ? 'dim' : ''}`}
              style={{ color: colorOf(i) }}
            >
              {byId.get(id)?.name}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">
        {touch ? 'Cần điều khiển để chạy · nút NHẢY để né sóng động đất' : 'W A S D / ← ↑ ↓ → chạy · SPACE nhảy (né sóng động đất)'} · không ai biết thảm họa tiếp theo là gì!
      </p>
    </div>
  );
}
