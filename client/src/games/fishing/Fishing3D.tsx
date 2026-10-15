import { useEffect, useRef, useState } from 'react';
import type { PlayerState } from '@shared/protocol';
import { BAR_H, CLS_NAMES, HOOK_MS, SPECIES, STEAL_CD_MS, ST_BITE, ST_IDLE, ST_NIB, ST_REEL, ST_STUN, ST_WAIT } from '@shared/fishing';
import { createFishingScene } from '../../three/fishingScene';
import { isTouchDevice } from '../../components/TouchControls';
import { useScene } from '../view3d';
import type { FishingCore } from './core';
import '../g3d-extra.css';

interface Props {
  core: FishingCore;
  players: PlayerState[];
  meId: string;
  live: boolean;
}

const LITE_KEY = 'arrow-fishing-lite';
const readLite = () => {
  try {
    return localStorage.getItem(LITE_KEY) === '1';
  } catch {
    return false;
  }
};

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export default function Fishing3D({ core, players, meId, live }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLDivElement | null>());
  const [lite, setLite] = useState(readLite);
  const [, force] = useState(0);
  const [touch] = useState(() => isTouchDevice());

  const timeEl = useRef<HTMLSpanElement>(null);
  const promptEl = useRef<HTMLDivElement>(null);
  const meterEl = useRef<HTMLDivElement>(null);
  const zoneEl = useRef<HTMLDivElement>(null);
  const fishEl = useRef<HTMLDivElement>(null);
  const progEl = useRef<HTMLDivElement>(null);
  const clsEl = useRef<HTMLSpanElement>(null);
  const biteEl = useRef<HTMLDivElement>(null);
  const stealEl = useRef<HTMLButtonElement>(null);
  const mem = useRef({ prompt: '', cls: -1, ptsShown: -1 });
  const ptsEl = useRef<HTMLSpanElement>(null);

  const members = core.ids.map((id) => players.find((p) => p.id === id)).filter((p): p is PlayerState => !!p);
  const rosterKey = members.map((p) => `${p.id}:${p.color}`).join('|');

  useScene(
    hostRef,
    (host, hooks) =>
      createFishingScene({
        host,
        hooks,
        core,
        players: members.map((p) => ({ id: p.id, color: p.color })),
        meId,
        labels: labels.current,
        lite,
      }),
    [rosterKey, meId, lite, core],
  );

  // re-render nhẹ ~7Hz khi có snapshot / tin mới (bảng người chơi, nhật ký); phần chạy theo khung hình dùng ref
  useEffect(() => {
    let a = -1;
    let b = -1;
    const id = window.setInterval(() => {
      if (a !== core.snapVer || b !== core.feedVer) {
        a = core.snapVer;
        b = core.feedVer;
        force((x) => x + 1);
      }
    }, 140);
    return () => window.clearInterval(id);
  }, [core]);

  // HUD theo khung hình
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      core.frame();
      const now = core.nowMs();
      const left = core.endsAt - now;
      if (timeEl.current) timeEl.current.textContent = live ? fmt(left) : fmt(core.endsAt - core.startAt);

      const st = core.ls;
      let text: string;
      let tone = '';
      if (!live) text = '⏳ Chuẩn bị… sắp bắt đầu!';
      else if (now >= core.endsAt) text = '⏰ HẾT GIỜ!';
      else if (core.spectating) text = '👀 Bạn đang xem';
      else if (core.flashUntil > now && st !== ST_BITE) {
        text = core.flash;
        tone = 'flash';
      } else if (st === ST_IDLE) text = core.canCast() ? (touch ? '🎣 Chạm nút to để QUĂNG CẦN' : '🎣 Bấm SPACE / chuột để QUĂNG CẦN') : '…';
      else if (st === ST_WAIT) text = '🌊 Chờ cá cắn… đừng giật vội!';
      else if (st === ST_NIB) text = '👀 Phao rung… sắp cắn!';
      else if (st === ST_BITE) {
        text = '❗ CÁ CẮN! GIẬT NGAY!';
        tone = 'bite';
      } else if (st === ST_REEL) {
        text = core.localEnd === 1 ? '🎉 Kéo lên…' : core.localEnd === -1 ? '😢 Tuột mất…' : 'GIỮ để nâng thanh · NHẢ để hạ';
        tone = 'reel';
      } else text = '💫 Choáng… chờ hết choáng';
      const pe = promptEl.current;
      if (pe && mem.current.prompt !== text + tone) {
        mem.current.prompt = text + tone;
        pe.textContent = text;
        pe.className = `fs-prompt ${tone}`;
      }

      const me = meterEl.current;
      if (me) {
        const show = st === ST_REEL;
        me.style.display = show ? '' : 'none';
        if (show) {
          const h = BAR_H[core.cls] * 100;
          const y = core.barY(now) * 100;
          if (zoneEl.current) {
            zoneEl.current.style.height = `${h}%`;
            zoneEl.current.style.bottom = `${y - h / 2}%`;
          }
          if (fishEl.current) fishEl.current.style.bottom = `${core.fishAt(now) * 100}%`;
          if (progEl.current) progEl.current.style.height = `${Math.round(core.reel.p * 100)}%`;
          if (core.cls !== mem.current.cls) {
            mem.current.cls = core.cls;
            if (clsEl.current) clsEl.current.textContent = `Cá ${CLS_NAMES[core.cls]}`;
          }
        }
      }
      const be = biteEl.current;
      if (be) {
        const show = st === ST_BITE;
        be.style.display = show ? '' : 'none';
        if (show) be.style.setProperty('--k', String(Math.max(0, Math.min(1, core.hookLeft(now) / HOOK_MS))));
      }
      const sb = stealEl.current;
      if (sb) {
        const cd = Math.max(0, core.stealCdUntil - now);
        sb.style.setProperty('--cd', String(Math.min(1, cd / STEAL_CD_MS)));
        sb.disabled = cd > 0 || st === ST_REEL || st === ST_STUN;
      }
      const row = core.rows[core.seat];
      if (ptsEl.current && row && mem.current.ptsShown !== row.pts) {
        mem.current.ptsShown = row.pts;
        ptsEl.current.textContent = String(row.pts);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [core, live, touch]);

  const toggleLite = () => {
    const v = !lite;
    try {
      localStorage.setItem(LITE_KEY, v ? '1' : '0');
    } catch {
      /* bỏ qua */
    }
    setLite(v);
  };

  const now = core.nowMs();
  return (
    <div className="g3d-game fs-game">
      <div
        className="g3d-stage fs-stage"
        onPointerDown={(e) => {
          if (e.button > 0) return;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          core.down('ptr');
        }}
        onPointerUp={() => core.up('ptr')}
        onPointerCancel={() => core.up('ptr')}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={hostRef} className="g3d-host" />
        <div className="g3d-labels">
          {members.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                labels.current.set(p.id, el);
              }}
              className={`g3d-label ${p.id === meId ? 'me' : ''}`}
              style={{ color: p.color }}
            >
              <span className="fs-tag" />
              <div>{p.name}</div>
            </div>
          ))}
        </div>

        <div className="g3d-hud top">
          <div className="fs-topbar">
            <span className="g3d-chip timer">
              ⏱ <span ref={timeEl}>1:20</span>
            </span>
            <span className="g3d-chip">
              🐟 <span ref={ptsEl}>0</span> điểm
            </span>
            {core.cfg.lakes.length > 1 && (
              <span className="g3d-chip">
                HỒ {core.lake + 1}/{core.cfg.lakes.length}
              </span>
            )}
          </div>
          <div ref={promptEl} className="fs-prompt" />
        </div>

        <div ref={biteEl} className="fs-bite" style={{ display: 'none' }} aria-hidden="true">
          <span>❗</span>
        </div>

        <div ref={meterEl} className="fs-meter" style={{ display: 'none' }} aria-hidden="true">
          <span ref={clsEl} className="fs-meter-cls" />
          <div className="fs-track">
            <div ref={zoneEl} className="fs-zone" />
            <div ref={fishEl} className="fs-fish">
              🐟
            </div>
          </div>
          <div className="fs-prog">
            <div ref={progEl} className="fs-prog-fill" />
          </div>
        </div>

        <div className="fs-roster" onPointerDown={stop}>
          {members.map((p) => {
            const i = core.ids.indexOf(p.id);
            const r = core.rows[i];
            const me = p.id === meId;
            const st = core.stOf(i);
            const held = r && r.heldUntil > now && r.heldSp >= 0 && SPECIES[r.heldSp].value > 0 ? SPECIES[r.heldSp] : null;
            const imm = r && r.immuneUntil > now;
            const reeling = st === ST_REEL;
            return (
              <button
                key={p.id}
                type="button"
                disabled={me || core.spectating}
                className={`fs-chip ${me ? 'me' : ''} ${held ? 'held' : ''} ${reeling ? 'reeling' : ''} ${imm ? 'imm' : ''}`}
                style={{ ['--c' as any]: p.color }}
                onClick={() => core.steal(i)}
                title={me ? 'Bạn' : `Giật cá của ${p.name}`}
              >
                <span className="fs-dot" />
                <span className="fs-nm">{p.name}</span>
                <b>{r?.pts ?? 0}</b>
                <span className="fs-ic">{imm ? '🛡️' : st === ST_STUN ? '💫' : held ? held.emoji : reeling ? '🎣' : st === ST_BITE ? '❗' : ''}</span>
                {!me && <span className="fs-hook">🪝</span>}
              </button>
            );
          })}
        </div>

        {!core.spectating && (
          <button
            ref={stealEl}
            type="button"
            className="fs-steal"
            onPointerDown={stop}
            onClick={() => core.steal()}
            title="Giật cá của người khác (F)"
          >
            <span className="fs-steal-cd" />
            🪝 GIẬT <small>{touch ? '' : '(F)'}</small>
          </button>
        )}

        <button type="button" className="fs-lite" onPointerDown={stop} onClick={toggleLite} title="Giảm đồ hoạ cho máy yếu">
          {lite ? '🎨 Đồ hoạ đầy đủ' : '⚡ Giảm đồ hoạ'}
        </button>

        <div className="fs-feed" aria-live="polite">
          {core.feed.map((f) => (
            <div key={f.id} className={`fs-feed-item ${f.tone}`}>
              {f.text}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">
        SPACE / chuột / chạm: quăng cần → giật khi phao nhúng → GIỮ để kéo, NHẢ để thanh tụt · F hoặc nút 🪝: giật cá người khác (hụt là bị choáng!)
      </p>
    </div>
  );
}
