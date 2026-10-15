import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { FartCore } from '@shared/raftClient';
import { S_FIN, S_HP, S_SINK, STEP_MS } from '@shared/raft';
import { createFartScene, TEAM_COLORS, type FartBridge } from '../../three/fartScene';
import { isTouchDevice } from '../../components/TouchControls';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useLatest, useScene } from '../view3d';

interface Props {
  core: FartCore;
  config: { teams: string[][]; cap: number };
  players: PlayerState[];
  meId: string;
  live: boolean;
  startAt: number;
}

const MM_W = 150;
const MM_H = 120;

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function Fart3D({ core, config, players, meId, live, startAt }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const teamLabels = useRef<(HTMLDivElement | null)[]>([]);
  const bridge = useRef<FartBridge>({ pick: null, camYaw: 0 });
  const liveRef = useLatest(live);

  const gasEl = useRef<HTMLDivElement>(null);
  const chargeEl = useRef<HTMLDivElement>(null);
  const hpEl = useRef<HTMLDivElement>(null);
  const timeEl = useRef<HTMLSpanElement>(null);
  const rankEl = useRef<HTMLSpanElement>(null);
  const bannerEl = useRef<HTMLDivElement>(null);
  const mmCanvas = useRef<HTMLCanvasElement>(null);
  const dots = useRef<(HTMLDivElement | null)[]>([]);
  const hudMem = useRef({ t: 0, rank: 0, banner: '', hp: -1 });
  const [touch] = useState(() => isTouchDevice());

  const team = useMemo(
    () =>
      config.teams[core.myTeam].map((id) => {
        const p = players.find((q) => q.id === id);
        return { id, color: p?.color ?? '#ffffff', name: p?.name ?? '?' };
      }),
    [config, core, players],
  );

  /* ---- minimap: vẽ MỘT lần từ đường tâm ---- */
  const mm = useMemo(() => {
    const c = core.c;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < c.n; i++) {
      minX = Math.min(minX, c.px[i]);
      maxX = Math.max(maxX, c.px[i]);
      minY = Math.min(minY, c.py[i]);
      maxY = Math.max(maxY, c.py[i]);
    }
    const sc = Math.min((MM_W - 16) / (maxX - minX || 1), (MM_H - 16) / (maxY - minY || 1));
    const ox = (MM_W - (maxX - minX) * sc) / 2;
    const oy = (MM_H - (maxY - minY) * sc) / 2;
    return { sc, ox, oy, minX, maxY };
  }, [core]);
  const mmX = (x: number) => mm.ox + (x - mm.minX) * mm.sc;
  const mmY = (y: number) => mm.oy + (mm.maxY - y) * mm.sc;

  useEffect(() => {
    const cv = mmCanvas.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    const c = core.c;
    g.clearRect(0, 0, MM_W, MM_H);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 7;
    g.beginPath();
    for (let i = 0; i < c.n; i++) (i ? g.lineTo : g.moveTo).call(g, mmX(c.px[i]), mmY(c.py[i]));
    g.stroke();
    g.strokeStyle = '#5cc8ff';
    g.lineWidth = 4.5;
    g.beginPath();
    for (let i = 0; i < c.n; i++) (i ? g.lineTo : g.moveTo).call(g, mmX(c.px[i]), mmY(c.py[i]));
    g.stroke();
    // checkpoint + đích
    for (let q = 1; q < 4; q++) {
      const i = c.cpIdx[q];
      g.fillStyle = '#ffd23f';
      g.fillRect(mmX(c.px[i]) - 2.5, mmY(c.py[i]) - 2.5, 5, 5);
    }
    const fi = Math.min(c.n - 1, Math.round(c.finishS / c.ds));
    g.fillStyle = '#fff';
    g.fillRect(mmX(c.px[fi]) - 4, mmY(c.py[fi]) - 4, 8, 8);
    g.fillStyle = '#111';
    g.fillRect(mmX(c.px[fi]) - 2, mmY(c.py[fi]) - 2, 4, 4);
  }, [core, mm]);

  const onFrame = () => {
    const S = core.sim.S;
    const h = hudMem.current;
    if (gasEl.current) gasEl.current.style.transform = `scaleX(${core.gasNow().toFixed(3)})`;
    if (chargeEl.current) chargeEl.current.style.transform = `scaleX(${core.charge.toFixed(3)})`;
    const hp = Math.round(S[S_HP]);
    if (hpEl.current && hp !== h.hp) {
      h.hp = hp;
      hpEl.current.style.transform = `scaleX(${(hp / 100).toFixed(3)})`;
      hpEl.current.style.background = hp > 55 ? '#5be07a' : hp > 28 ? '#ffc94a' : '#ff5a4d';
    }
    // minimap: chấm các bè
    for (let ti = 0; ti < core.nTeams; ti++) {
      const el = dots.current[ti];
      if (!el) continue;
      let x: number, y: number;
      if (ti === core.myTeam) {
        x = core.px;
        y = core.py;
      } else {
        const arr = core.ghosts[ti];
        if (!arr.length) {
          el.style.opacity = '0';
          continue;
        }
        x = arr[arr.length - 1].x;
        y = arr[arr.length - 1].y;
      }
      el.style.opacity = '1';
      el.style.transform = `translate(${mmX(x) - 5}px, ${mmY(y) - 5}px)`;
    }
    const now = performance.now();
    if (now - h.t > 250) {
      h.t = now;
      const elapsed = core.serverMs - startAt;
      if (timeEl.current) timeEl.current.textContent = fmt(elapsed);
      const r = core.myRank();
      if (rankEl.current && r !== h.rank) {
        h.rank = r;
        rankEl.current.textContent = `${r}/${core.nTeams}`;
      }
      let banner = '';
      if (S[S_FIN] > 0) banner = core.myRank() === 1 ? 'CẢ BÈ VỀ ĐÍCH ĐẦU TIÊN! 🎉' : 'BÈ ĐÃ VỀ ĐÍCH! 🎉';
      else if (S[S_SINK] > 0) banner = 'BÈ CHÌM! Sắp hồi sinh ở cột mốc…';
      else if (core.gasNow() < 0.12) banner = 'Hết khí! Đợi hồi lại một chút…';
      if (bannerEl.current && banner !== h.banner) {
        h.banner = banner;
        bannerEl.current.textContent = banner;
        bannerEl.current.style.opacity = banner ? '1' : '0';
      }
    }
  };
  const frameRef = useLatest(onFrame);

  useScene(
    hostRef,
    (host, hooks) =>
      createFartScene({
        host,
        hooks,
        core,
        team,
        teamColors: TEAM_COLORS,
        meId,
        labels: labels.current,
        teamLabels: teamLabels.current,
        bridge: bridge.current,
        serverNow: () => net.now(),
        onFrame: () => frameRef.current(),
      }),
    [core, meId],
  );

  /* ---- điều khiển: chuột, bàn phím ---- */
  useEffect(() => {
    if (!live) return;
    const host = hostRef.current;
    if (!host) return;
    const b = bridge.current;
    let left = false;
    let right = false;
    const upd = () => core.turn((left ? 1 : 0) - (right ? 1 : 0));
    const doPress = () => core.press(performance.now());
    const doRelease = () => {
      const p = core.release();
      if (p > 0) sfx.fart(p / 100);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) doPress();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        left = true;
        upd();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        right = true;
        upd();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') doRelease();
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        left = false;
        upd();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        right = false;
        upd();
      }
    };
    const onBlur = () => {
      left = right = false;
      upd();
      core.cancel();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const p = b.pick?.(e.clientX, e.clientY);
      if (p) core.setMouse(p[0], p[1]);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      onMove(e);
      doPress();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      doRelease();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      core.cancel();
      core.turn(0);
    };
  }, [live, core]);

  return (
    <div className="g3d-game ft-game">
      <div className="g3d-stage">
        <div ref={hostRef} className="g3d-host ft-host" />
        <div className="ft-top">
          <span>
            ⏱ <b ref={timeEl}>0:00</b>
          </span>
          <span>
            HẠNG BÈ <b ref={rankEl}>1/{core.nTeams}</b>
          </span>
        </div>
        <div className="ft-mm">
          <canvas ref={mmCanvas} width={MM_W} height={MM_H} />
          {Array.from({ length: core.nTeams }, (_, ti) => (
            <div
              key={ti}
              ref={(el) => {
                dots.current[ti] = el;
              }}
              className={`ft-dot ${ti === core.myTeam ? 'me' : ''}`}
              style={{ background: ti === core.myTeam ? '#8dff6a' : TEAM_COLORS[ti % TEAM_COLORS.length], opacity: 0 }}
            />
          ))}
        </div>
        <div ref={bannerEl} className="ft-banner" style={{ opacity: 0 }} />
        <div className="ft-bars">
          <div className="ft-bar-row">
            <span className="ft-bar-label">KHÍ</span>
            <div className="ft-bar">
              <div ref={gasEl} className="ft-fill gas" />
              <div ref={chargeEl} className="ft-fill charge" />
            </div>
          </div>
          <div className="ft-bar-row">
            <span className="ft-bar-label">BÈ</span>
            <div className="ft-bar small">
              <div ref={hpEl} className="ft-fill hp" />
            </div>
          </div>
        </div>
        <div className="g3d-labels">
          {team.map((p) => (
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
          {Array.from({ length: core.nTeams }, (_, ti) =>
            ti === core.myTeam ? null : (
              <div
                key={ti}
                ref={(el) => {
                  teamLabels.current[ti] = el;
                }}
                className="g3d-label"
                style={{ color: TEAM_COLORS[ti % TEAM_COLORS.length] }}
              >
                Bè {ti + 1}
              </div>
            ),
          )}
        </div>
        {touch && live && <FartTouch core={core} bridge={bridge.current} />}
      </div>
      <p className="hint">
        Rê chuột chọn hướng xì (hoặc A/D · ←/→) · giữ SPACE/chuột trái để tích lực, thả để xì · bè bị đẩy NGƯỢC hướng xì · cả bè xì cùng hướng mới đi nhanh
      </p>
    </div>
  );
}

/** Cảm ứng: kéo ở vòng tròn bên trái để chọn hướng xì, giữ/thả nút XÌ bên phải */
function FartTouch({ core, bridge }: { core: FartCore; bridge: FartBridge }) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [on, setOn] = useState(false);
  const setAim = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = e.clientX - (r.left + R);
    let dy = e.clientY - (r.top + R);
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    setKnob({ x: dx, y: dy });
    if (l > R * 0.2) {
      const f = -dy;
      const rr = dx;
      const y = bridge.camYaw;
      const vx = f * Math.cos(y) + rr * Math.sin(y);
      const vy = f * Math.sin(y) - rr * Math.cos(y);
      core.setAimWorld(Math.atan2(vy, vx));
    }
  };
  return (
    <>
      <div
        ref={pad}
        className="ft-pad"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setAim(e);
        }}
        onPointerMove={(e) => e.buttons !== 0 && setAim(e)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="ft-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <button
        type="button"
        className={`ft-fire ${on ? 'on' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setOn(true);
          core.press(performance.now());
        }}
        onPointerUp={() => {
          setOn(false);
          const p = core.release();
          if (p > 0) sfx.fart(p / 100);
        }}
        onPointerCancel={() => {
          setOn(false);
          core.cancel();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        XÌ!
      </button>
    </>
  );
}

void STEP_MS;
