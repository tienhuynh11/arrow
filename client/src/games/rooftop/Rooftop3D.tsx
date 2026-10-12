import { useEffect, useRef } from 'react';
import { RT_CHARS } from '@shared/rooftop';
import type { PlayerState } from '@shared/protocol';
import { createRooftopScene } from '../../three/rooftopScene';
import { isTouchDevice } from '../../components/TouchControls';
import { useLatest, useScene } from '../view3d';
import type { RooftopGameState } from './useRooftopGame';

export default function Rooftop3D({ game, players, meId }: { game: RooftopGameState; players: PlayerState[]; meId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
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
  const pct = Math.max(0, Math.min(100, hud.grip));

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
          <span className="hx-floor">
            {hud.held ? 'ĐANG BỊ TÚM · spam di chuyển / SPACE để vùng thoát' : hud.hold ? 'ĐANG TÚM · SPACE nhấc · click trái / thả nút = quăng' : hud.down ? 'NGÃ SẤP RỒI…' : lockName ? `ĐANG KHOÁ: ${lockName} · Tab đổi mục tiêu` : `${myChar.emoji} ${myChar.name} · đấu vật trên nóc xe`}
          </span>
        )}
      </div>
      <div className="g3d-stage rt-stage" ref={stageRef}>
        <div ref={hostRef} className="g3d-host" />
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
        {banner && <div key={banner.id} className="rt-warn">⚠ {banner.text}</div>}
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
            <div className="rt-grip" title="Sức bám">
              <i style={{ width: `${pct}%` }} className={pct < 30 ? 'low' : ''} />
              <span>SỨC BÁM</span>
            </div>
          </div>
        )}
        {!game.locked && !touch && (
          <div className="rt-lock">
            <b>BẤM VÀO MÀN HÌNH ĐỂ KHOÁ CHUỘT</b>
            <span>di chuột = xoay camera quanh nhân vật · chuột giữa / Tab = khoá mục tiêu · Esc = nhả chuột</span>
          </div>
        )}
        {touch && !hud.out && (
          <div className="rt-tbtns">
            <button
              type="button"
              className="rt-tbtn punch"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                game.touch.punch();
              }}
              onPointerUp={() => game.touch.punchUp()}
              onPointerCancel={() => game.touch.punchUp()}
              onLostPointerCapture={() => game.touch.punchUp()}
            >
              ĐẤM
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
            <button
              type="button"
              className="rt-tbtn dodge"
              onPointerDown={(e) => {
                e.preventDefault();
                game.touch.dodge();
              }}
            >
              NÉ
            </button>
            <button
              type="button"
              className="rt-tbtn grab"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                game.touch.grab(true);
              }}
              onPointerUp={() => game.touch.grab(false)}
              onPointerCancel={() => game.touch.grab(false)}
              onLostPointerCapture={() => game.touch.grab(false)}
            >
              TÚM
            </button>
            <button type="button" className="rt-tbtn sk" onPointerDown={(e) => { e.preventDefault(); game.touch.skill(1); }}>
              {sk[0].icon}
            </button>
            <button type="button" className="rt-tbtn sk" onPointerDown={(e) => { e.preventDefault(); game.touch.skill(2); }}>
              {sk[1].icon}
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
                {cds[i] > 0 && <u style={{ height: `${Math.min(100, (cds[i] * 1000 / s.cd) * 100)}%` }} />}
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
        </div>
      </div>
      <p className="hint">
        WASD đi theo camera · chuột xoay camera · chuột giữa / Tab khoá mục tiêu · R / X kỹ năng thú · click trái ĐẤM (nhấn nhanh, nối 2–3 đòn = combo · giữ rồi thả = đấm mạnh) · Ctrl / Q NÉ · giữ click phải / E TÚM (gần mép xe = bám mép) · SPACE nhảy, khi đang túm = nhấc · click trái / thả nút = QUĂNG
      </p>
    </div>
  );
}
