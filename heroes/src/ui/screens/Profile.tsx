// Hồ sơ người chơi: thẻ người chơi (ảnh đại diện, cấp, EXP, lực chiến) + 4 tab: Thông tin / Cấp / Thành tựu / Bộ sưu tập.
// Tab Thành tựu + Bộ sưu tập nằm ở ProfileAch.tsx.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MeResponse } from '@shared/heroes/api';
import { MAX_ACCOUNT_LEVEL, SQUAD_COUNT, SQUAD_SIZE } from '@shared/heroes/config';
import { accountXpToNext } from '@shared/heroes/formulas';
import { HEROES } from '@shared/heroes/heroes';
import { levelReward, LEVEL_UNLOCKS, SLOT_GEMS, SLOT_LEVEL, SQUAD_LEVEL } from '@shared/heroes/progression';
import { STAGES } from '@shared/heroes/stages';
import { TOWER_MAX_FLOOR } from '@shared/heroes/tower';
import type { Wallet } from '@shared/heroes/types';
import { api, me } from '../../api';
import { sfx } from '../../audio';
import { activeSquadIds, arenaOf, defOf, highestIndex, ownedMap, slotsOpenOf, squadPower, squadsOpenOf, towerOf } from '../../game';
import { fmt, go, useBusy, uuid, toast, screen } from '../../state';
import { Avatar, avatarIdOf, setAvatar } from '../avatar';
import { Btn, HeroCard, Modal } from '../common';
import { Icon } from '../icons';
import { ActHead, WalletChips } from './activity';
import { AchTab, CollectTab } from './ProfileAch';
import { RewardModal, StatCell } from './profile-common';
import type { AchState } from '@shared/heroes/achievements';
import '../profile.css';

type Tab = 'info' | 'level' | 'ach' | 'collect';
const RANK: Record<string, number> = { UR: 3, SSR: 2, SR: 1, R: 0 };

/* ------------------------------ THẺ NGƯỜI CHƠI ------------------------------ */
function AvatarPicker({ m, onClose }: { m: MeResponse; onClose: () => void }) {
  const cur = avatarIdOf(m);
  const list = m.heroes.filter((h) => HEROES.some((d) => d.id === h.id)).sort((a, b) => RANK[defOf(b.id).rarity] - RANK[defOf(a.id).rarity] || b.level - a.level);
  return (
    <Modal title="Chọn ảnh đại diện" onClose={onClose} wide>
      <p class="muted small">Chọn một tướng bạn đang sở hữu làm ảnh đại diện.</p>
      <div class="pf-pick scroll">
        {list.map((o) => (
          <div class="pf-pick-c" key={o.id}>
            <HeroCard def={defOf(o.id)} owned={o} selected={cur === o.id} onClick={() => { setAvatar(m, o.id); sfx('select'); onClose(); }} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function PlayerCard({ m }: { m: MeResponse }) {
  const [pick, setPick] = useState(false);
  const lv = m.profile.level;
  const max = lv >= MAX_ACCOUNT_LEVEL;
  const need = accountXpToNext(lv);
  const xp = Math.min(m.profile.xp, need);
  const pct = max ? 100 : Math.min(100, Math.floor((xp * 100) / need));
  const power = squadPower(m, activeSquadIds(m));
  return (
    <section class="pf-card" aria-label="Thẻ người chơi">
      <button type="button" class="pf-av-btn" onClick={() => setPick(true)} aria-label="Đổi ảnh đại diện">
        <Avatar m={m} size={84} />
        <span class="pf-av-edit"><Icon n="edit" size={16} /></span>
      </button>
      <div class="pf-card-tx">
        <h3 class="pf-name">{m.profile.username}</h3>
        <div class="pf-lvline">
          <span class="pf-lvtag">Cấp {lv}</span>
          <span class="pf-pow" title="Lực chiến đội đang dùng"><Icon n="sword" size={18} /> {fmt(power)}</span>
        </div>
        <div class="pf-xp" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="EXP tài khoản">
          <i style={{ width: `${pct}%` }} />
          <span>{max ? 'Tối đa' : `${fmt(xp)}/${fmt(need)}`}</span>
        </div>
        <small class="pf-xpsub">{max ? 'Bạn đã đạt cấp tối đa' : `${pct}% · còn ${fmt(need - xp)} EXP lên cấp ${lv + 1}`}</small>
      </div>
      {pick && <AvatarPicker m={m} onClose={() => setPick(false)} />}
    </section>
  );
}

/* ------------------------------ TAB 1: THÔNG TIN ------------------------------ */
function InfoTab({ m, ach }: { m: MeResponse; ach: AchState[] | null }) {
  const [guild, setGuild] = useState<string | null | undefined>(m.guildId ? undefined : null); // undefined = đang tải / lỗi
  useEffect(() => {
    if (!m.guildId) return;
    let alive = true;
    api.guild().then((r) => alive && setGuild(r.info?.guild.name ?? null)).catch(() => {});
    return () => void (alive = false);
  }, [m.guildId]);

  const hi = highestIndex(m);
  const stars = m.progress.reduce((a, p) => a + p.stars, 0);
  const tw = towerOf(m);
  const ar = arenaOf(m);
  const heroDefs = m.heroes.map((h) => defOf(h.id)).filter(Boolean);
  const ur = heroDefs.filter((d) => d.rarity === 'UR').length;
  const ssr = heroDefs.filter((d) => d.rarity === 'SSR').length;
  const gearUR = m.gear.filter((g) => g.def.endsWith('_UR')).length;
  const pulls = ach?.find((a) => a.id === 'a_pulls')?.progress;
  const squad = m.squads[m.activeSquad] ?? [];
  const open = slotsOpenOf(m);
  const mp = ownedMap(m);

  return (
    <div class="pf-pane scroll">
      <div class="pf-stats">
        <StatCell ic="battle" label="Ải cao nhất" value={hi >= 0 ? STAGES[hi].name : 'Chưa qua ải nào'} sub={`Ải ${hi + 1}/${STAGES.length}`} />
        <StatCell ic="star" label="Tổng số sao" value={`${stars}/${STAGES.length * 3}`} />
        <StatCell ic="tower" label="Tầng tháp" value={`${tw.floor}/${TOWER_MAX_FLOOR}`} />
        <StatCell ic="arena" label="Đấu trường" value={`${fmt(ar.rating)} điểm`} sub={`${ar.wins} thắng · ${ar.losses} thua`} />
        <StatCell ic="heroes" label="Tướng sở hữu" value={`${m.heroes.length}/${HEROES.length}`} sub={`UR ${ur} · SSR ${ssr}`} />
        <StatCell ic="bag" label="Trang bị" value={`${m.gear.length} món`} sub={`UR ${gearUR}`} />
        <StatCell ic="summon" label="Tổng lượt triệu hồi" value={pulls == null ? '...' : fmt(pulls)} />
        <StatCell ic="guild" label="Bang hội" value={guild === undefined ? '...' : guild ?? 'Chưa vào bang'} />
      </div>
      <h4 class="pf-h">Đội hình đang dùng <small>Đội {m.activeSquad + 1}</small></h4>
      <div class="pf-squad">
        {Array.from({ length: SQUAD_SIZE }, (_, i) => {
          const id = squad[i];
          const o = id ? mp.get(id) : undefined;
          if (i >= open) {
            return (
              <div class="pf-slot lock" key={i} aria-label={`Ô ${i + 1} chưa mở, cần cấp ${SLOT_LEVEL[i]}`}>
                <Icon n="lock" size={22} />
                <small>Cấp {SLOT_LEVEL[i]}</small>
              </div>
            );
          }
          return (
            <div class={`pf-slot${o ? '' : ' empty'}`} key={i}>
              {o ? <HeroCard def={defOf(o.id)} owned={o} mini onClick={() => go({ n: 'heroes', id: o.id })} /> : <small>Trống</small>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ TAB 2: CẤP ------------------------------ */
function sumRewards(from: number, to: number): Partial<Wallet> {
  const t: Partial<Wallet> = {};
  for (let l = from; l <= to; l++) {
    const r = levelReward(l);
    for (const k of Object.keys(r) as (keyof Wallet)[]) t[k] = (t[k] ?? 0) + (r[k] ?? 0);
  }
  return t;
}

function SlotCard({ m }: { m: MeResponse }) {
  const open = slotsOpenOf(m);
  const teams = squadsOpenOf(m);
  const [busy, run] = useBusy();
  const [ask, setAsk] = useState(false);
  const lv = m.profile.level;
  const cost = SLOT_GEMS[open] ?? 0;
  const short = m.wallet.gems < cost;
  const buy = () =>
    run(async () => {
      await api.slotUnlock(open, uuid());
      sfx('claim');
      toast(`Đã mở ô đội hình thứ ${open + 1}`, 'ok');
      setAsk(false);
    });
  return (
    <div class="pf-slotcard">
      <div class="pf-slothead">
        <b><Icon n="squad" size={20} /> Ô đội hình</b>
        <small>{open}/{SQUAD_SIZE} đã mở</small>
      </div>
      <div class="pf-slotrow">
        {Array.from({ length: SQUAD_SIZE }, (_, i) => (
          <div key={i} class={`pf-sl${i < open ? ' on' : i === open ? ' next' : ''}`} title={`Ô ${i + 1}`}>
            <span class="pf-sl-c">{i < open ? <Icon n="check" size={20} /> : <Icon n="lock" size={18} />}</span>
            <small>{i < open ? `Ô ${i + 1}` : `Cấp ${SLOT_LEVEL[i]}`}</small>
          </div>
        ))}
      </div>
      {open < SQUAD_SIZE ? (
        <div class="pf-slotbuy">
          <span class="pf-slotbuy-tx">
            Ô {open + 1} mở miễn phí ở <b>cấp {SLOT_LEVEL[open]}</b> (còn {Math.max(0, SLOT_LEVEL[open] - lv)} cấp).
          </span>
          <Btn kind="blue" small onClick={() => setAsk(true)}>
            Mở sớm <span class={`ah-chip${short ? ' lack' : ''}`}><Icon n="gem" size={16} /><b>{fmt(cost)}</b></span>
          </Btn>
        </div>
      ) : (
        <small class="muted">Đã mở đủ {SQUAD_SIZE} ô đội hình.</small>
      )}
      <div class="pf-teams">
        {Array.from({ length: SQUAD_COUNT }, (_, i) => (
          <span key={i} class={`pf-team${i < teams ? ' on' : ''}`}>
            <Icon n={i < teams ? 'unlock' : 'lock'} size={16} /> Đội {i + 1}{i >= teams ? ` (cấp ${SQUAD_LEVEL[i]})` : ''}
          </span>
        ))}
      </div>
      {ask && (
        <Modal title={`Mở sớm ô thứ ${open + 1}?`} onClose={() => setAsk(false)}>
          <p>Dùng kim cương để mở ngay ô đội hình thứ {open + 1} mà không cần chờ đến cấp {SLOT_LEVEL[open]}.</p>
          <div class="pf-cost">
            <span class={`ah-chip${short ? ' lack' : ''}`}><Icon n="gem" size={18} /><b>{fmt(cost)}</b></span>
            <small class={short ? 'pf-red' : 'muted'}>Bạn có {fmt(m.wallet.gems)} kim cương{short ? ` (thiếu ${fmt(cost - m.wallet.gems)})` : ''}</small>
          </div>
          <div class="btn-row wrap">
            <Btn kind="ghost" onClick={() => setAsk(false)}>Huỷ</Btn>
            <Btn kind="green" busy={busy} disabled={short} onClick={() => void buy()}>Mở ô</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LevelTab({ m }: { m: MeResponse }) {
  const lv = m.profile.level;
  const claimed = Math.max(1, m.levels.claimedUpTo);
  const pending = Math.max(0, lv - claimed);
  const [busy, run] = useBusy();
  const [rw, setRw] = useState<{ levels: number[]; wallet: Partial<Wallet> } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const unlockAt = new Map(LEVEL_UNLOCKS.map((u) => [u.level, u]));

  // tự cuộn tới cấp hiện tại
  useEffect(() => {
    const b = box.current;
    const el = b?.querySelector<HTMLElement>('[data-cur="1"]');
    if (b && el) b.scrollTop = Math.max(0, el.offsetTop - 70);
  }, []);

  const claim = () =>
    run(async () => {
      const r = await api.levelClaim();
      sfx('claim');
      setRw({ levels: r.levels, wallet: r.reward });
    });

  return (
    <div class="pf-lvtab">
      <div class={`pf-banner${pending ? ' on' : ''}`}>
        <div class="pf-banner-tx">
          <b>{pending ? `Thưởng lên cấp có thể nhận: ${pending}` : 'Đã nhận hết thưởng lên cấp'}</b>
          {pending > 0 ? <span class="pf-banner-rw"><WalletChips w={sumRewards(claimed + 1, lv)} /></span> : <small>{lv >= MAX_ACCOUNT_LEVEL ? 'Bạn đã đạt cấp tối đa' : `Lên cấp ${lv + 1} để nhận thêm`}</small>}
        </div>
        <Btn kind="green" big={false} busy={busy} disabled={!pending} onClick={() => void claim()} class="pf-claimall">NHẬN TẤT CẢ</Btn>
      </div>
      <div class="pf-ladder scroll" ref={box}>
        <SlotCard m={m} />
        {Array.from({ length: MAX_ACCOUNT_LEVEL }, (_, i) => i + 1).map((l) => {
          const st = l <= claimed ? 'claimed' : l <= lv ? 'ready' : 'future';
          const u = unlockAt.get(l);
          return (
            <div key={l} class={`pf-lrow ${st}${l === lv ? ' cur' : ''}`} data-cur={l === lv ? '1' : undefined}>
              <span class="pf-lnode">{st === 'claimed' ? <Icon n="check" size={20} /> : l}</span>
              <div class="pf-lbody">
                <div class="pf-lhead">
                  <b>Cấp {l}</b>
                  {l === lv && <span class="pf-tag you">Bạn ở đây</span>}
                  {st === 'ready' && <span class="pf-tag ready">Nhận được</span>}
                  {st === 'claimed' && l > 1 && <span class="pf-tag done">Đã nhận</span>}
                </div>
                {l > 1 ? <div class="pf-lrw"><WalletChips w={levelReward(l)} /></div> : <small class="muted">Điểm khởi đầu</small>}
                {u && (
                  <div class={`pf-unl${l <= lv ? ' on' : ''}`}>
                    <Icon n={l <= lv ? 'unlock' : 'lock'} size={24} />
                    <span>
                      <b>{u.title}</b>
                      <small>{u.desc}</small>
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {rw && (
        <RewardModal
          title="Nhận thưởng lên cấp"
          sub={rw.levels.length ? `Cấp ${rw.levels[0]}${rw.levels.length > 1 ? ` - ${rw.levels[rw.levels.length - 1]}` : ''} (${rw.levels.length} cấp)` : undefined}
          r={{ wallet: rw.wallet }}
          onClose={() => setRw(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------ MÀN HỒ SƠ ------------------------------ */
export function Profile({ tab: initial }: { tab?: Tab }) {
  const m = me.value!;
  const [tab, setTab] = useState<Tab>(initial ?? 'info');
  const [ach, setAch] = useState<AchState[] | null>(null);

  // điều hướng lại từ nơi khác (vd. popup lên cấp) khi đang ở màn Hồ sơ
  const want = screen.value.n === 'profile' ? screen.value.tab : undefined;
  useEffect(() => {
    if (want) setTab(want);
  }, [want]);

  const loadAch = () => api.achievements().then((r) => setAch(r.list)).catch(() => {});
  useEffect(() => {
    void api.refresh().catch(() => {});
    void loadAch();
  }, []);

  const tabs: { id: Tab; label: string; dot: number }[] = [
    { id: 'info', label: 'Thông tin', dot: 0 },
    { id: 'level', label: 'Cấp', dot: m.levelBadge },
    { id: 'ach', label: 'Thành tựu', dot: m.achBadge },
    { id: 'collect', label: 'Bộ sưu tập', dot: 0 },
  ];

  return (
    <div class="pf">
      <ActHead title="Hồ sơ" icon="user" />
      <div class="pf-main">
        <PlayerCard m={m} />
        <div class="pf-right">
          <div class="seg wide pf-tabs" role="tablist" aria-label="Mục hồ sơ">
            {tabs.map((t) => (
              <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => { sfx('tap'); setTab(t.id); }}>
                <span>{t.label}</span>
                {t.dot > 0 && <i class="pf-td">{t.dot}</i>}
              </button>
            ))}
          </div>
          {tab === 'info' && <InfoTab m={m} ach={ach} />}
          {tab === 'level' && <LevelTab m={m} />}
          {tab === 'ach' && <AchTab m={m} list={ach} setList={setAch} reload={() => void loadAch()} />}
          {tab === 'collect' && <CollectTab m={m} />}
        </div>
      </div>
    </div>
  );
}
