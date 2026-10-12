import { useEffect, useRef } from 'react';
import type { PlayerState } from '@shared/protocol';
import { RT_CHARS } from '@shared/rooftop';
import { createRooftopScene } from '../../three/rooftopScene';
import { isTouchDevice } from '../../components/TouchControls';
import { useLatest, useScene } from '../view3d';
import type { RooftopGameState } from './useRooftopGame';

const N_POPUPS = 16;

export default function Rooftop3D({ game, players, meId }: { game: RooftopGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const popups = useRef<(HTMLDivElement | null)[]>([]);
  const gameRef = useLatest(game);
  const rosterKey = players.map((p) => `${p.id}:${p.color}`).join('|');
  const touch = isTouchDevice();

  useScene(
    hostRef,
    (host, hooks) =>
      createRooftopScene({
        host,
        hooks,
        players: players.map((p) => ({ id: p.id, color: p.color })),
        meId,
        read: () => gameRef.current,
        labels: labels.current,
        popups: popups.current.filter((x): x is HTMLDivElement => !!x),
        overlay: () => flashRef.current,
      }),
    [rosterKey, meId],
  );

  // chuột + cảm ứng gắn vào khung cảnh
  const { bindHost } = game;
  useEffect(() => {
    bindHost(stageRef.current);
    return () => bindHost(null);
  }, [bindHost]);

  const { hud, banner, shout, feed, lockName, myChar, intro, pressure } = game;
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const sk = myChar.skills;
  const cds = [hud.cd1, hud.cd2];

  return (
    <div className="g3d-game rt-game">
      <div className="hx-hud">
        <span className="hx-alive">
          CÒN SỐNG <b>{hud.alive}</b>/{game.total}
        </span>
        {hud.out ? (
          <span className="hx-floor out">BẠN ĐÃ BỊ KO · xem các bạn đánh nhau tiếp</span>
        ) : hud.winner ? (
          <span className="hx-floor">BẠN LÀ NGƯỜI SỐNG SÓT CUỐI CÙNG 🎉</span>
        ) : (
          <span className="hx-floor">{lockName ? `ĐANG KHOÁ: ${lockName} · Tab đổi mục tiêu` : `${myChar.emoji} ${myChar.name} · đấu vật trên nóc xe`}</span>
        )}
      </div>
      <div className="g3d-stage rt-stage" ref={stageRef}>
        <div ref={hostRef} className="g3d-host" />
        <div ref={flashRef} className="rt-flash" />
        {pressure && !hud.out && <div className="rt-pressure" />}
        {intro && (
          <div className="rt-intro">
            <b>
              BẠN LÀ: {myChar.emoji} {myChar.name}
            </b>
            <span>{myChar.blurb}</span>
            {sk.map((s, i) => (
              <span key={i} className="rt-intro-sk">
                <kbd>{i === 0 ? 'R' : 'X'}</kbd> {s.icon} {s.name}: {s.desc}
              </span>
            ))}
          </div>
        )}
        {banner && (
          <div key={banner.id} className="rt-warn">
            ⚠ {banner.text}
          </div>
        )}
        {shout && (
          <div key={shout.id} className="rt-shout">
            {shout.text}
          </div>
        )}
        <div className="rt-feed">
          {feed.map((f) => (
            <div key={f.id} className={`rt-feed-i ${f.tone}`}>
              {f.text}
            </div>
          ))}
        </div>
        {!hud.out && (
          <div className="rt-hpbox">
            <div className="rt-hp" title="Máu">
              <i style={{ width: `${hpPct}%` }} className={hpPct < 30 ? 'low' : ''} />
              <span>
                {myChar.emoji} {Math.ceil(hud.hp)} / {hud.maxHp}
              </span>
            </div>
          </div>
        )}
        {!game.locked && !touch && (
          <div className="rt-lock">
            <b>BẤM VÀO MÀN HÌNH ĐỂ KHOÁ CHUỘT</b>
            <span>chuột xoay camera · chuột trái đánh · R / X kỹ năng · Space nhảy · chuột giữa / Tab khoá mục tiêu</span>
          </div>
        )}
        {touch && !hud.out && (
          <div className="rt-tbtns">
            <button
              type="button"
              className="rt-tbtn punch"
              onPointerDown={(e) => {
                e.preventDefault();
                game.touch.punch();
              }}
            >
              ĐÁNH
            </button>
            <button
              type="button"
              className="rt-tbtn sk"
              onPointerDown={(e) => {
                e.preventDefault();
                game.touch.skill(1);
              }}
            >
              {sk[0].icon}
            </button>
            <button
              type="button"
              className="rt-tbtn sk"
              onPointerDown={(e) => {
                e.preventDefault();
                game.touch.skill(2);
              }}
            >
              {sk[1].icon}
            </button>
            <button
              type="button"
              className="rt-tbtn lockon"
              onPointerDown={(e) => {
                e.preventDefault();
                game.touch.lock();
              }}
            >
              KHOÁ
            </button>
          </div>
        )}
        {!hud.out && (
          <div className="rt-skills">
            {sk.map((s, i) => (
              <div key={i} className={`rt-sk ${cds[i] > 0 ? 'cd' : 'ready'}`} title={s.desc}>
                <kbd>{i === 0 ? 'R' : 'X'}</kbd>
                <b>{s.icon}</b>
                <small>{s.name}</small>
                {cds[i] > 0 && <u style={{ height: `${Math.min(100, ((cds[i] * 1000) / s.cd) * 100)}%` }} />}
                {cds[i] > 0 && <em>{Math.ceil(cds[i])}</em>}
              </div>
            ))}
          </div>
        )}
        <div className="g3d-labels">
          {players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label rt-lbl ${p.id === meId ? 'me' : ''}`}
              style={{ color: p.color }}
            >
              {RT_CHARS[game.cfg.chars[p.id] ?? 0].emoji} {p.name}
            </div>
          ))}
          {Array.from({ length: N_POPUPS }, (_, i) => (
            <div
              key={`pop${i}`}
              ref={(el) => {
                popups.current[i] = el;
              }}
              className="g3d-label rt-popbox"
            >
              <span className="rt-pop" />
            </div>
          ))}
        </div>
      </div>
      <p className="hint">WASD đi (thân tự quay theo hướng chạy) · chuột xoay camera · click trái ĐÁNH, bấm liên tiếp = combo 3 đòn · R / X kỹ năng (tung được khi đang chạy, nối với đòn thường) · Space nhảy · chuột giữa / Tab khoá mục tiêu</p>
    </div>
  );
}
