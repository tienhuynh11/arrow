// Màn trận đánh: xin seed -> chạy Battle dùng chung theo thời gian thực -> nộp seed + inputs để server chạy lại chấm.
import { useEffect, useRef, useState } from 'preact/hooks';
import { heroUnit, type UnitInit } from '@shared/heroes/battle';
import type { ArenaOpponent } from '@shared/heroes/arena';
import { arenaSetup } from '@shared/heroes/arena';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import { BATTLE_HZ } from '@shared/heroes/config';
import { stageOf, stageSetup } from '@shared/heroes/stages';
import { BOSS_UID, bossSetup, type GuildInfo } from '@shared/heroes/guild';
import { towerStage } from '@shared/heroes/tower';
import { api, me } from '../../api';
import { music } from '../../audio';
import { BattleOverlay } from '../../battle/overlay';
import { BattleSession, type HudUnit } from '../../battle/session';
import { defOf, gearBonus, ownedMap, starsOfStage, towerOf } from '../../game';
import { BattleScene } from '../../render/battle-scene';
import { runLive, type LiveHandle } from '../../render/live';
import { autoPref, saveSettings, speedPref } from '../../settings';
import { errToast, fmt, go, toast } from '../../state';
import { Btn, IconBtn, Modal, Portrait, Spinner } from '../common';
import { Icon } from '../icons';
import { BossHp } from './Guild';

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
      {u.ready && <span class="bt-full">ĐẦY</span>}
      <kbd>{hot}</kbd>
    </button>
  );
}

export function BattleScreen({ stage, opp }: { stage: string; opp?: ArenaOpponent }) {
  const m0 = me.value!;
  // stage 'tower' = Tháp: ải dựng theo tầng kế tiếp (chốt lúc vào trận), nộp kết quả qua /tower-battle
  const isTower = stage === 'tower';
  // stage 'arena' = Đấu trường: địch là đội phòng thủ của `opp`, nộp qua /arena-battle
  const isArena = stage === 'arena';
  // stage 'guildboss' = Boss bang: địch = bossSetup(cấp bang, chu kỳ, seed), nộp qua /guild-boss (sát thương do server chấm)
  const isGuildBoss = stage === 'guildboss';
  const [pool, setPool] = useState<{ name: string; hp: number; hpMax: number } | null>(null); // máu boss CẢ BANG lúc vào trận
  const [dealt, setDealt] = useState(0); // sát thương đã gây trong trận (hiển thị)
  const [def] = useState(() => (isArena || isGuildBoss ? null : isTower ? towerStage(towerOf(m0).floor + 1) : stageOf(stage)));
  const leave = () => go(isGuildBoss ? { n: 'guild', tab: 'boss' } : isArena ? { n: 'arena' } : isTower ? { n: 'tower' } : { n: 'campaign', stage });
  const [phase, setPhase] = useState<'loading' | 'fight' | 'submit'>('loading');
  const [sess, setSess] = useState<BattleSession | null>(null);
  const [exit, setExit] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cleared = !isTower && !isArena && !isGuildBoss && starsOfStage(m0, stage) > 0;

  useEffect(() => {
    if (isGuildBoss ? false : isArena ? !opp : !def) {
      go(isArena ? { n: 'arena' } : { n: 'campaign' });
      return;
    }
    let cancelled = false;
    let live: LiveHandle | null = null;
    let overlay: BattleOverlay | null = null;
    let timer = 0;
    music('battle');

    const submit = (s: BattleSession) => {
      setPhase('submit');
      const body = { squad: m0.activeSquad, seed: s.setup.seed, inputs: s.inputs, auto: s.initialAuto };
      const onErr = (e: unknown) => {
        errToast(e);
        if (!cancelled) leave();
      };
      if (isGuildBoss) {
        api
          .guildBoss(body)
          .then((res) => {
            if (!cancelled) go({ n: 'guildBossResult', res });
          })
          .catch(onErr);
      } else if (isArena) {
        api
          .arenaBattle({ opponent: opp!.id, ...body })
          .then((res) => {
            if (!cancelled) go({ n: 'arenaResult', res });
          })
          .catch(onErr);
      } else if (isTower) {
        api
          .towerBattle(body)
          .then((res) => {
            if (!cancelled) go({ n: 'towerResult', res });
          })
          .catch(onErr);
      } else {
        api
          .battle({ stage, ...body })
          .then((res) => {
            if (!cancelled) go({ n: 'result', stage, res });
          })
          .catch(onErr);
      }
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
        go(isGuildBoss ? { n: 'guild', tab: 'boss' } : isArena ? { n: 'arena' } : isTower ? { n: 'tower' } : { n: 'squad' });
        return;
      }
      // Boss bang: cần cấp bang + chu kỳ hiện tại để dựng đúng boss như server
      let gi: GuildInfo | null = null;
      if (isGuildBoss) {
        try {
          gi = (await api.guild()).info;
        } catch (e) {
          errToast(e);
          leave();
          return;
        }
        if (!gi || gi.boss.killed || gi.boss.hp <= 0 || gi.mine.bossTries <= 0) {
          toast(!gi ? 'Bạn chưa vào bang nào' : gi.boss.killed || gi.boss.hp <= 0 ? 'Boss đã bị hạ' : 'Hết lượt đánh boss hôm nay', 'error');
          leave();
          return;
        }
        if (cancelled) return;
        setPool({ name: gi.boss.name, hp: gi.boss.hp, hpMax: gi.boss.hpMax });
      }
      let seed: number;
      try {
        seed = (await api.battleStart(isGuildBoss ? 'guildboss' : isArena ? 'arena' : stage)).seed;
      } catch (e) {
        errToast(e);
        leave();
        return;
      }
      if (cancelled || !canvasRef.current || !overlayRef.current) return;
      // đội phòng thủ dựng từ danh sách {id, level, star} (không có trang bị) — chỉ để chạy hình; server chấm lại là chuẩn
      const foe: UnitInit[] = [];
      if (isArena) {
        opp!.heroes.forEach((h, slot) => {
          if (h.id && HERO_BY_ID[h.id]) foe.push(heroUnit({ id: h.id, level: h.level, star: h.star, shards: 0 }, slot));
        });
      }
      const setup = isGuildBoss ? bossSetup(gi!.guild.level, gi!.boss.cycle, seed, units) : isArena ? arenaSetup(units, foe, seed) : stageSetup(def!, units, seed);
      overlay = new BattleOverlay(overlayRef.current);
      const scene = new BattleScene(overlay, def ? def.element : (foe[0]?.element ?? setup.waves[0]?.[0]?.element ?? 'light'));
      overlay.scene = scene;
      overlay.onWave = (n) => {
        if (!def) return;
        // banner do GSAP trong overlay lo (bám timeScale/tạm dừng, tự dọn khi rời trận)
        overlay?.waveBanner(def.boss && n === def.waves.length - 1 ? `BOSS!` : `ĐỢT ${n + 1}`);
      };
      const session = new BattleSession(setup, scene, overlay, autoPref.value, speedPref.value, () => submit(session));
      scene.onTick = (dt, sdt) => session.advance(dt, sdt);
      live = runLive(canvasRef.current, scene);
      if (!live.ok) toast('Thiết bị không hỗ trợ WebGL — trận vẫn được tính nhưng không có hình', 'error');
      setSess(session);
      setPhase('fight');
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      music('menu');
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

  // Boss bang: theo dõi sát thương đã gây (boss local có máu rất lớn, mất bao nhiêu = đã gây bấy nhiêu)
  useEffect(() => {
    if (!isGuildBoss || !sess) return;
    const t = setInterval(() => {
      const u = sess.battle.units.find((x) => x.uid === BOSS_UID);
      if (u) setDealt(Math.max(0, u.maxHp - u.hp));
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [sess]);

  const hud = sess?.hud.value;
  const toggleAuto = () => {
    if (!sess) return;
    sess.setAuto(!sess.battle.auto);
    autoPref.value = sess.battle.auto;
    saveSettings();
  };
  const cycleSpeed = () => {
    if (!sess) return;
    const s = (sess.speed === 1 ? 2 : sess.speed === 2 ? 3 : 1) as 1 | 2 | 3; // x1 -> x2 -> x3 -> x1 (hệ số thật ở battle/pacing.ts)
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
              <b>{isGuildBoss ? `Boss bang · ${pool?.name ?? ''}` : isArena ? `Đấu trường · vs ${opp?.name ?? ''}` : def?.name}</b>
              {!isArena && !isGuildBoss && <span>Đợt {hud.wave}/{hud.waves}</span>}
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

          {isGuildBoss && pool && (
            <div class="gld-bbar" aria-label="Máu boss bang">
              <BossHp hp={Math.max(0, pool.hp - dealt)} hpMax={pool.hpMax} />
              <small>Sát thương trận này: <b>{fmt(dealt)}</b></small>
            </div>
          )}
          <div class="b-ults">
            {hud.units.map((u, i) => (
              <UltBtn key={u.uid} u={u} hot={i + 1} onUlt={() => sess.ult(u.uid)} />
            ))}
          </div>
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
            <Btn kind="red" onClick={leave}>Rời trận</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
