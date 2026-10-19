// Màn trận đánh: xin seed -> chạy Battle dùng chung theo thời gian thực -> nộp seed + inputs để server chạy lại chấm.
import { useEffect, useRef, useState } from 'preact/hooks';
import { heroUnit, type UnitInit } from '@shared/heroes/battle';
import { BATTLE_HZ } from '@shared/heroes/config';
import { stageOf, stageSetup } from '@shared/heroes/stages';
import { api, me } from '../../api';
import { BattleOverlay } from '../../battle/overlay';
import { BattleSession, type HudUnit } from '../../battle/session';
import { defOf, gearBonus, ownedMap, starsOfStage } from '../../game';
import { BattleScene } from '../../render/battle-scene';
import { runLive, type LiveHandle } from '../../render/live';
import { autoPref, saveSettings, speedPref } from '../../settings';
import { errToast, go, toast } from '../../state';
import { Btn, IconBtn, Modal, Portrait, Spinner } from '../common';
import { Icon } from '../icons';

function UltBtn({ u, hot, onUlt }: { u: HudUnit; hot: number; onUlt: () => void }) {
  const d = defOf(u.key);
  return (
    <button
      type="button"
      class={`ult r-${d.rarity}${u.ready ? ' ready' : ''}${u.alive ? '' : ' dead'}`}
      style={{ '--p': `${u.energy}%` } as any}
      disabled={!u.alive}
      onClick={onUlt}
      aria-label={`Tuyệt kỹ ${u.name}`}
    >
      <span class="ult-ring" />
      <span class="ult-face">
        <Portrait id={u.key} rarity={d.rarity} />
      </span>
      <span class="ult-hp"><i style={{ width: `${u.hpPct}%` }} /></span>
      <kbd>{hot}</kbd>
    </button>
  );
}

export function BattleScreen({ stage }: { stage: string }) {
  const m0 = me.value!;
  const def = stageOf(stage);
  const [phase, setPhase] = useState<'loading' | 'fight' | 'submit'>('loading');
  const [sess, setSess] = useState<BattleSession | null>(null);
  const [banner, setBanner] = useState('');
  const [exit, setExit] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cleared = starsOfStage(m0, stage) > 0;

  useEffect(() => {
    if (!def) {
      go({ n: 'campaign' });
      return;
    }
    let cancelled = false;
    let live: LiveHandle | null = null;
    let overlay: BattleOverlay | null = null;
    let timer = 0;

    const submit = (s: BattleSession) => {
      setPhase('submit');
      api
        .battle({ stage, squad: m0.activeSquad, seed: s.setup.seed, inputs: s.inputs, auto: s.initialAuto })
        .then((res) => {
          if (!cancelled) go({ n: 'result', stage, res });
        })
        .catch((e) => {
          errToast(e);
          if (!cancelled) go({ n: 'campaign', stage });
        });
    };

    void (async () => {
      const owned = ownedMap(m0);
      const units: UnitInit[] = [];
      (m0.squads[m0.activeSquad] ?? []).forEach((id, slot) => {
        const o = id ? owned.get(id) : undefined;
        if (o) units.push(heroUnit(o, slot, gearBonus(m0, id)));
      });
      if (!units.length) {
        toast('Đội hình trống — hãy xếp tướng trước', 'error');
        go({ n: 'squad' });
        return;
      }
      let seed: number;
      try {
        seed = (await api.battleStart(stage)).seed;
      } catch (e) {
        errToast(e);
        go({ n: 'campaign', stage });
        return;
      }
      if (cancelled || !canvasRef.current || !overlayRef.current) return;
      const setup = stageSetup(def, units, seed);
      overlay = new BattleOverlay(overlayRef.current);
      const scene = new BattleScene(overlay, def.element);
      overlay.scene = scene;
      overlay.onWave = (n) => {
        setBanner(def.boss && n === def.waves.length - 1 ? `BOSS!` : `ĐỢT ${n + 1}`);
        clearTimeout(timer);
        timer = window.setTimeout(() => setBanner(''), 1500);
      };
      const session = new BattleSession(setup, scene, overlay, autoPref.value, speedPref.value, () => submit(session));
      scene.onTick = (dt) => session.advance(dt);
      live = runLive(canvasRef.current, scene);
      if (!live.ok) toast('Thiết bị không hỗ trợ WebGL — trận vẫn được tính nhưng không có hình', 'error');
      setSess(session);
      setPhase('fight');
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      live?.stop();
      overlay?.dispose();
    };
    // eslint-disable-next-line
  }, []);

  // phím tắt PC: 1-5 tuyệt kỹ, A tự động, Space tạm dừng
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!sess || phase !== 'fight') return;
      const n = Number(e.key);
      if (n >= 1 && n <= 5) {
        const u = sess.hud.value.units[n - 1];
        if (u) sess.ult(u.uid);
      } else if (e.key === 'a' || e.key === 'A') toggleAuto();
      else if (e.key === ' ') sess.setPaused(!sess.paused);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
    // eslint-disable-next-line
  }, [sess, phase]);

  const hud = sess?.hud.value;
  const toggleAuto = () => {
    if (!sess) return;
    sess.setAuto(!sess.battle.auto);
    autoPref.value = sess.battle.auto;
    saveSettings();
  };
  const cycleSpeed = () => {
    if (!sess) return;
    const s = (sess.speed === 1 ? 2 : sess.speed === 2 ? 3 : 1) as 1 | 2 | 3;
    sess.setSpeed(s);
    speedPref.value = s;
    saveSettings();
  };
  const secs = hud ? Math.ceil(hud.ticksLeft / BATTLE_HZ) : 0;

  return (
    <div class="battle">
      <div class="battle-sky" />
      <canvas ref={canvasRef} class="battle-canvas" />
      <div ref={overlayRef} class="battle-overlay" />

      {phase === 'loading' && (
        <div class="battle-wait">
          <Spinner />
          <b>Chuẩn bị chiến đấu...</b>
        </div>
      )}
      {phase === 'submit' && (
        <div class="battle-wait">
          <Spinner />
          <b>Đang chấm kết quả...</b>
        </div>
      )}

      {sess && hud && phase === 'fight' && (
        <>
          <div class="b-top">
            <IconBtn n="back" label="Rời trận" onClick={() => { sess.setPaused(true); setExit(true); }} />
            <div class="b-info">
              <b>{def?.name}</b>
              <span>Đợt {hud.wave}/{hud.waves}</span>
              <span class={secs <= 15 ? 'warn' : ''}>
                <Icon n="clock" size={14} /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
              </span>
            </div>
            <div class="b-ctrl">
              <button type="button" class={`pill speed s${hud.speed}`} onClick={cycleSpeed} aria-label="Tốc độ">
                <Icon n="ffwd" size={18} /> x{hud.speed}
              </button>
              <button type="button" class={`pill auto${hud.auto ? ' on' : ''}`} onClick={toggleAuto} aria-pressed={hud.auto}>
                <Icon n="auto" size={18} /> Auto
              </button>
              {cleared && (
                <button type="button" class="pill" onClick={() => sess.skip()} aria-label="Bỏ qua">
                  <Icon n="skip" size={18} /> <span class="pl">Bỏ qua</span>
                </button>
              )}
              <button type="button" class="pill" onClick={() => sess.setPaused(!hud.paused)} aria-label="Tạm dừng">
                <Icon n={hud.paused ? 'play' : 'pause'} size={18} />
              </button>
            </div>
          </div>

          <div class="b-ults">
            {hud.units.map((u, i) => (
              <UltBtn key={u.uid} u={u} hot={i + 1} onUlt={() => sess.ult(u.uid)} />
            ))}
          </div>
          {banner && <div key={banner + hud.wave} class="wave-banner">{banner}</div>}
          {hud.paused && !exit && (
            <div class="pause-veil" onClick={() => sess.setPaused(false)}>
              <b>TẠM DỪNG</b>
              <small>Chạm để tiếp tục</small>
            </div>
          )}
        </>
      )}

      {exit && sess && (
        <Modal title="Rời trận?" onClose={() => { setExit(false); sess.setPaused(false); }}>
          <p>Trận đang đánh sẽ không được tính và không mất thể lực.</p>
          <div class="btn-row">
            <Btn kind="ghost" onClick={() => { setExit(false); sess.setPaused(false); }}>Tiếp tục đánh</Btn>
            <Btn kind="red" onClick={() => go({ n: 'campaign', stage })}>Rời trận</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
