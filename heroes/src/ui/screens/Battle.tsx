// Màn trận đánh: xin seed -> chạy Battle dùng chung theo thời gian thực -> nộp seed + inputs để server chạy lại chấm.
import { useEffect, useRef, useState } from 'preact/hooks';
import { heroUnit, type UnitInit } from '@shared/heroes/battle';
import { powerOf } from '@shared/heroes/formulas';
import type { ArenaOpponent } from '@shared/heroes/arena';
import { arenaSetup } from '@shared/heroes/arena';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import { stageOf, stageSetup } from '@shared/heroes/stages';
import { BOSS_UID, bossSetup, type GuildInfo } from '@shared/heroes/guild';
import { towerStage } from '@shared/heroes/tower';
import { api, me } from '../../api';
import { music } from '../../audio';
import { BattleOverlay, type BattleInfo } from '../../battle/overlay';
import { BattleSession, type HudUnit } from '../../battle/session';
import { defOf, gearBonus, ownedMap, starsOfStage, towerOf } from '../../game';
import { BattleScene } from '../../render/battle-scene';
import { runLive, type LiveHandle } from '../../render/live';
import { autoPref, saveSettings, speedPref } from '../../settings';
import { errToast, fmt, go, toast } from '../../state';
import { Btn, Modal, Portrait, Spinner } from '../common';
import { Icon } from '../icons';
import { BossHp } from './Guild';

/** nhãn hồi chiêu phía trên thẻ: "8.2s" tới lượt kế, "ĐẦY" khi đủ năng lượng (chạm để tung), "--" khi choáng */
const cdLabel = (u: HudUnit) => (!u.alive ? '' : u.ready ? 'ĐẦY' : u.cd < 0 ? '--' : `${u.cd.toFixed(1)}s`);

function UltBtn({ u, hot, lv, star, onUlt }: { u: HudUnit; hot: number; lv: number; star: number; onUlt: () => void }) {
  const d = defOf(u.key);
  return (
    <button
      type="button"
      class={`bt-card r-${d.rarity}${u.ready ? ' ready' : ''}${u.alive ? '' : ' dead'}`}
      disabled={!u.alive}
      onClick={onUlt}
      aria-label={`Tuyệt kỹ ${u.name}`}
    >
      <span class={`bc-cd${u.ready ? ' full' : ''}`}>{cdLabel(u)}</span>
      <span class="bc-frame">
        <span class="bc-face">
          <Portrait id={u.key} rarity={d.rarity} />
        </span>
        <span class="bc-lv">Lv{lv}</span>
        <span class="bc-stars">
          {Array.from({ length: Math.min(5, star) }, (_, i) => (
            <Icon key={i} n="star" size={9} />
          ))}
        </span>
        <span class="bc-hp"><i style={{ width: `${u.hpPct}%` }} /></span>
      </span>
      <span class="bc-en"><i style={{ width: `${u.energy}%` }} /></span>
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
  const [lvOf] = useState(() => ownedMap(m0));
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
      // chủ đề sảnh theo chương của ải (1 Đền Rừng / 2 Làng Ven Sông / 3 Mỏ Đá); tháp, đấu trường, boss bang dùng chủ đề 1
      const scene = new BattleScene(overlay, def && !isTower ? def.chapter : 1);
      overlay.scene = scene;
      // thanh trên cùng: hai chỉ huy (tên, lực chiến, avatar)
      const topMe = units.reduce((a, b) => (powerOf(b.stats) > powerOf(a.stats) ? b : a), units[0]);
      const foes = setup.waves.flat();
      const topFoe = foes[0];
      const foeBoss = foes.some((f) => f.boss);
      const info: BattleInfo = {
        meName: m0.profile.username,
        mePower: units.reduce((a, u) => a + powerOf(u.stats), 0),
        meKey: topMe.key,
        meRarity: HERO_BY_ID[topMe.key]?.rarity ?? 'R',
        foeName: isGuildBoss ? (gi?.boss.name ?? 'Boss bang') : isArena ? (opp?.name ?? 'Đối thủ') : (def?.name ?? ''),
        foePower: isArena && opp ? opp.power : foes.reduce((a, u) => a + powerOf(u.stats), 0),
        foeKey: foeBoss ? 'mk_chua' : (topFoe?.key ?? 'mk_con'),
        foeRarity: foeBoss ? 'SSR' : (HERO_BY_ID[topFoe?.key ?? '']?.rarity ?? 'R'),
      };
      overlay.setInfo(info);
      overlay.onWave = (n) => {
        if (!def) return;
        // chỉ còn MỘT đợt: chỉ báo BOSS khi là ải boss (banner do GSAP trong overlay lo, bám timeScale/tạm dừng)
        if (def.waves.length > 1) overlay?.waveBanner(`ĐỢT ${n + 1}`);
        else if (def.boss) overlay?.waveBanner('BOSS!');
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

  // phím tắt PC: 1-6 tuyệt kỹ, A tự động, Space tạm dừng
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!sess || phase !== 'fight') return;
      const n = Number(e.key);
      if (n >= 1 && n <= 6) {
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
          <div class="bt-rail l">
            <button type="button" class="bt-rb" onClick={() => { sess.setPaused(true); setExit(true); }} aria-label="Rời trận">
              <Icon n="back" size={20} />
            </button>
          </div>
          <div class="bt-rail r">
            <button type="button" class="bt-rb" onClick={() => sess.setPaused(!hud.paused)} aria-label="Tạm dừng">
              <Icon n={hud.paused ? 'play' : 'pause'} size={20} />
            </button>
            {cleared && (
              <button type="button" class="bt-rb" onClick={() => sess.skip()} aria-label="Bỏ qua">
                <Icon n="skip" size={20} />
              </button>
            )}
            <button type="button" class={`bt-rb auto${hud.auto ? ' on' : ''}`} onClick={toggleAuto} aria-pressed={hud.auto} aria-label="Tự động">
              <Icon n="auto" size={20} />
            </button>
            <button type="button" class={`bt-rb speed s${hud.speed}`} onClick={cycleSpeed} aria-label="Tốc độ">
              <b>x{hud.speed}</b>
            </button>
          </div>

          {isGuildBoss && pool && (
            <div class="gld-bbar" aria-label="Máu boss bang">
              <BossHp hp={Math.max(0, pool.hp - dealt)} hpMax={pool.hpMax} />
              <small>Sát thương trận này: <b>{fmt(dealt)}</b></small>
            </div>
          )}
          <div class="bt-cards">
            {hud.units.map((u, i) => (
              <UltBtn key={u.uid} u={u} hot={i + 1} lv={lvOf.get(u.key)?.level ?? 1} star={lvOf.get(u.key)?.star ?? 1} onUlt={() => sess.ult(u.uid)} />
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
