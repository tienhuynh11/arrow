import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { MAXC } from '@shared/treasure';
import { createTreasureScene } from '../../three/treasureScene';
import { useLatest, useScene } from '../view3d';
import { isTouchDevice } from '../../components/TouchControls';
import type { TreasureGameState } from './useTreasureGame';

export default function Treasure3D({ game, players, meId }: { game: TreasureGameState; players: PlayerState[]; meId: string }) {
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
      createTreasureScene({
        host,
        hooks,
        players: arenaPlayers,
        meSeat: seat,
        W: ac.w,
        H: ac.h,
        read: () => ({ cl: gameRef.current.cl, step: gameRef.current.step, serverNow: gameRef.current.serverNow }),
        labels: labels.current,
      }),
    [rosterKey, meId, game.cl],
  );

  // thông báo nổi khi mình cướp / bị cướp / nộp điểm
  const [toast, setToast] = useState<{ text: string; cls: string; key: number } | null>(null);
  useEffect(() => {
    if (!hud.noteSeq || !hud.noteKind) return;
    const text =
      hud.noteKind === 'robbed'
        ? `😱 BỊ CƯỚP −${hud.noteN}`
        : hud.noteKind === 'stole'
          ? `😈 CƯỚP ĐƯỢC +${hud.noteN}`
          : hud.noteKind === 'deliver'
            ? `💰 NỘP +${hud.noteN}`
            : '💥 Bị đẩy!';
    setToast({ text, cls: hud.noteKind, key: hud.noteSeq });
    const t = window.setTimeout(() => setToast(null), 1300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud.noteSeq]);

  const nameOf = (i: number) => byId.get(ac.ids[i])?.name ?? '?';
  const order = ac.ids
    .map((_, i) => i)
    .sort((a, b) => (hud.score[b] ?? 0) - (hud.score[a] ?? 0) || (hud.steals[b] ?? 0) - (hud.steals[a] ?? 0));
  const mm = Math.floor(hud.secLeft / 60);
  const ss = String(hud.secLeft % 60).padStart(2, '0');
  const warnEnd = hud.phase === 1 && hud.secLeft <= 12 && hud.load > 0;

  let banner: { text: string; sub?: string; cls: string } | null = null;
  if (hud.finished || hud.phase === 2) {
    const win = order[0] === seat && (hud.score[seat] ?? 0) > 0;
    banner = {
      text: win ? '🏆 HẾT GIỜ - BẠN GIÀU NHẤT!' : 'HẾT GIỜ!',
      sub: hud.lostAtEnd > 0 ? `${hud.lostAtEnd} kho báu đang mang bị mất (chưa nộp)` : 'Đang tổng kết điểm…',
      cls: win ? 'win' : 'end',
    };
  } else if (hud.phase === 0 && hud.count > 0) banner = { text: String(hud.count), sub: 'Chạy ra giữa sân nhặt kho báu!', cls: 'count' };
  else if (hud.go) banner = { text: 'CƯỚP!', cls: 'go' };

  return (
    <div className="g3d-game">
      <div className="hx-hud">
        <span className="hx-alive">
          NỘP <b>{hud.score[seat] ?? 0}</b> 💰
        </span>
        <span className="hx-floor">
          ⏱{' '}
          <b>
            {mm}:{ss}
          </b>
        </span>
        <span className={`hx-floor ${hud.load >= 7 ? 'out' : ''}`}>
          🎒 <b>{hud.load}</b>/{MAXC} · chạy <b>{hud.speedPct}%</b>
        </span>
      </div>
      <div
        className="g3d-stage"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button === 0) game.actOnce();
        }}
      >
        <div ref={hostRef} className="g3d-host" />
        <div className="tk-board">
          {order.map((i) => (
            <div key={i} className={`tk-row ${i === seat ? 'me' : ''}`}>
              <i style={{ background: byId.get(ac.ids[i])?.color }} />
              <span>{nameOf(i)}</span>
              <b>{hud.score[i] ?? 0}</b>
            </div>
          ))}
        </div>
        <div className="tr-gauge" aria-hidden="true">
          <div className="tr-bar">
            <i style={{ width: `${(hud.load / MAXC) * 100}%` }} className={hud.load >= 7 ? 'heavy' : ''} />
          </div>
          <div className={`tr-cd ${hud.cd > 0 ? 'wait' : 'ready'}`}>
            <i style={{ width: `${(1 - hud.cd) * 100}%` }} />
            <span>{hud.cd > 0 ? 'hồi chiêu…' : isTouchDevice() ? 'CƯỚP / ĐẨY' : 'SPACE: CƯỚP / ĐẨY'}</span>
          </div>
        </div>
        {hud.immune && hud.phase === 1 && <div className="tr-imm">🛡 Miễn cướp</div>}
        {toast && (
          <div className={`tr-toast ${toast.cls}`} key={toast.key}>
            {toast.text}
          </div>
        )}
        {warnEnd && <div className="tr-warn">⏱ Đồ đang mang KHÔNG được tính - về căn cứ ngay!</div>}
        {banner && (
          <div className={`tk-banner ${banner.cls}`} key={`${banner.cls}-${banner.text}`}>
            <b>{banner.text}</b>
            {banner.sub && <small>{banner.sub}</small>}
          </div>
        )}
        <div className="g3d-labels">
          {ac.ids.map((id) => (
            <div
              key={id}
              ref={(el) => {
                labels.current.set(id, el);
              }}
              className={`g3d-label ${id === meId ? 'me' : ''}`}
              style={{ color: byId.get(id)?.color }}
            >
              {byId.get(id)?.name}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">WASD / ← ↑ ↓ → chạy · SPACE hoặc chuột trái cướp / đẩy · mang càng nhiều chạy càng chậm, về căn cứ (vòng màu của bạn) để ghi điểm</p>
    </div>
  );
}
