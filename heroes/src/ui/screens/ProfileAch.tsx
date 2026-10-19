// Hồ sơ: tab Thành tựu (nhiều bậc, nhận từng bậc) và tab Bộ sưu tập (tướng + trang bị).
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { ACHIEVEMENTS, achClaimable, ACH_GROUP_NAME, type AchDef, type AchGroup, type AchState } from '@shared/heroes/achievements';
import type { MeResponse } from '@shared/heroes/api';
import { GEAR_DEFS, GEAR_SLOT_NAME, GEAR_SLOTS, GEAR_THEMES } from '@shared/heroes/gear';
import { HEROES } from '@shared/heroes/heroes';
import { SKILLS } from '@shared/heroes/skills';
import { ELEMENT_NAME, type HeroDef, type Rarity } from '@shared/heroes/types';
import { api } from '../../api';
import { sfx } from '../../audio';
import { describeSkill, ownedMap } from '../../game';
import { fmt, go, useBusy } from '../../state';
import { Btn, ElemChip, HeroCard, Modal, Portrait, RarityTag, RoleChip } from '../common';
import { GearTile } from '../gear';
import { ELEM_ICON, GEAR_ICON, Icon, type IconName } from '../icons';
import { RewardChips, RewardModal, type Rw } from './profile-common';
import '../profile.css';

/* ------------------------------ THÀNH TỰU ------------------------------ */
const GROUP_ICON: Record<AchGroup, IconName> = { campaign: 'battle', collect: 'heroes', growth: 'up', battle: 'arena', social: 'guild' };
const GROUPS = Object.keys(ACH_GROUP_NAME) as AchGroup[];

interface Row {
  def: AchDef;
  st: AchState;
  ready: boolean;
  done: boolean;
  ratio: number;
}

function AchCard({ r, busy, onClaim }: { r: Row; busy: boolean; onClaim: (id: string) => void }) {
  const { def, st } = r;
  const tier = def.tiers[st.claimed];
  const target = tier?.target ?? def.tiers[def.tiers.length - 1].target;
  const pr = Math.min(target, st.progress);
  return (
    <div class={`pf-ach${r.ready ? ' ready' : ''}${r.done ? ' done' : ''}`}>
      {r.done && <span class="pf-ribbon">HOÀN THÀNH</span>}
      <div class="pf-ach-top">
        <span class="pf-ach-ic"><Icon n={GROUP_ICON[def.group]} size={26} /></span>
        <span class="pf-ach-nm">
          <b>{def.name}</b>
          <small>{def.desc}</small>
        </span>
      </div>
      <div class="pf-tiers" aria-label={`Bậc ${st.claimed}/${def.tiers.length}`}>
        {def.tiers.map((t, i) => {
          const s = i < st.claimed ? 'got' : i === st.claimed ? (r.ready ? 'ready' : 'next') : 'wait';
          return (
            <span key={i} class={`pf-tier ${s}`} title={`Bậc ${i + 1}: ${fmt(t.target)}`}>
              {s === 'got' ? <Icon n="check" size={14} /> : fmt(t.target)}
            </span>
          );
        })}
      </div>
      <div class="qs-bar pf-bar" aria-label={`Tiến trình ${pr}/${target}`}>
        <i style={{ width: `${(pr * 100) / target}%` }} />
        <span>{fmt(pr)}/{fmt(target)}</span>
      </div>
      {tier && (
        <div class="pf-ach-bot">
          <RewardChips r={tier.reward} tile={34} />
          {r.ready ? (
            <Btn kind="green" small busy={busy} onClick={() => onClaim(def.id)}>Nhận</Btn>
          ) : (
            <small class="pf-lk"><Icon n="lock" size={12} /> Chưa đạt</small>
          )}
        </div>
      )}
    </div>
  );
}

export function AchTab({ m, list, setList, reload }: { m: MeResponse; list: AchState[] | null; setList: (l: AchState[]) => void; reload: () => void }) {
  const [group, setGroup] = useState<AchGroup | 'all'>('all');
  const [onlyReady, setOnlyReady] = useState(false);
  const [busy, run] = useBusy();
  const [cur, setCur] = useState('');
  const [rw, setRw] = useState<{ title: string; sub: string; r: Rw } | null>(null);
  void m;

  if (!list) {
    return (
      <div class="pf-pane pf-load">
        <p class="muted">Đang tải thành tựu...</p>
        <Btn kind="blue" small onClick={reload}>Tải lại</Btn>
      </div>
    );
  }
  const by = new Map(list.map((s) => [s.id, s]));
  const rows: Row[] = ACHIEVEMENTS.map((def) => {
    const st = by.get(def.id) ?? { id: def.id, progress: 0, claimed: 0 };
    const done = st.claimed >= def.tiers.length;
    const ready = achClaimable(def, st) >= 0;
    const t = def.tiers[st.claimed];
    return { def, st, ready, done, ratio: done ? 1 : Math.min(1, st.progress / (t?.target || 1)) };
  });
  const total = rows.length;
  const nDone = rows.filter((r) => r.done).length;
  const nReady = rows.filter((r) => r.ready).length;
  const shown = rows
    .filter((r) => (group === 'all' || r.def.group === group) && (!onlyReady || r.ready))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || Number(a.done) - Number(b.done) || b.ratio - a.ratio);

  const claim = (id: string) => {
    setCur(id);
    void run(async () => {
      const r = await api.achievementClaim(id);
      sfx('claim');
      setList(r.list);
      const d = ACHIEVEMENTS.find((x) => x.id === id);
      setRw({ title: d?.name ?? 'Thành tựu', sub: `Bậc ${r.tier + 1}/${d?.tiers.length ?? '?'}`, r: r.reward });
    });
  };

  return (
    <div class="pf-achtab">
      <div class="pf-achhead">
        <span class="ah-pill"><Icon n="trophy" size={18} /> {nDone}/{total} thành tựu hoàn thành</span>
        {nReady > 0 && <span class="pf-readycnt">{nReady} có thể nhận</span>}
      </div>
      <div class="pf-chips scroll" role="tablist" aria-label="Nhóm thành tựu">
        <button type="button" class={`pf-chip${group === 'all' ? ' on' : ''}`} onClick={() => { sfx('tap'); setGroup('all'); }}>Tất cả</button>
        {GROUPS.map((g) => {
          const n = rows.filter((r) => r.def.group === g && r.ready).length;
          return (
            <button type="button" key={g} class={`pf-chip${group === g ? ' on' : ''}`} onClick={() => { sfx('tap'); setGroup(g); }}>
              {ACH_GROUP_NAME[g]}
              {n > 0 && <i class="pf-td">{n}</i>}
            </button>
          );
        })}
        <button type="button" class={`pf-chip ready${onlyReady ? ' on' : ''}`} aria-pressed={onlyReady} onClick={() => { sfx('tap'); setOnlyReady((v) => !v); }}>
          Có thể nhận
        </button>
      </div>
      <div class="pf-achlist scroll">
        {shown.length === 0 && <p class="muted pf-empty">Không có thành tựu nào trong mục này.</p>}
        {shown.map((r) => (
          <AchCard key={r.def.id} r={r} busy={busy && cur === r.def.id} onClaim={claim} />
        ))}
      </div>
      {rw && <RewardModal title={rw.title} sub={rw.sub} r={rw.r} onClose={() => setRw(null)} />}
    </div>
  );
}

/* ------------------------------ BỘ SƯU TẬP ------------------------------ */
const RARITIES: Rarity[] = ['UR', 'SSR', 'SR', 'R'];
const RAR_ASC: Rarity[] = ['R', 'SR', 'SSR', 'UR'];

function HeroInfo({ def, onClose }: { def: HeroDef; onClose: () => void }) {
  return (
    <Modal title={def.name} onClose={onClose}>
      <div class="pf-hi">
        <div class={`pf-hi-art r-${def.rarity}`}><Portrait id={def.id} rarity={def.rarity} /></div>
        <div class="pf-hi-tx">
          <b class="pf-hi-title">{def.title}</b>
          <div class="pf-hi-chips"><RarityTag r={def.rarity} /><ElemChip el={def.element} label /><RoleChip role={def.role} label /></div>
          <small class="muted">Hệ {ELEMENT_NAME[def.element]}</small>
        </div>
      </div>
      <div class="pf-skills">
        {def.skills.map((id) => {
          const s = SKILLS[id];
          return s ? (
            <div class="pf-skill" key={id}>
              <b>{s.name}</b>
              <small>{describeSkill(s)}</small>
            </div>
          ) : null;
        })}
      </div>
      <div class="pf-howto">
        <Icon n="info" size={20} />
        <span>
          <b>Cách nhận</b>
          <small>{def.summonable ? 'Triệu hồi bằng vé hoặc kim cương ở màn Triệu hồi.' : 'Tướng đặc biệt: nhận từ quà Tân thủ hoặc sự kiện.'}</small>
        </span>
      </div>
      {def.summonable && <Btn kind="green" onClick={() => { onClose(); go({ n: 'summon' }); }}>Đến Triệu hồi</Btn>}
    </Modal>
  );
}

function HeroCollection({ m }: { m: MeResponse }) {
  const mp = ownedMap(m);
  const [info, setInfo] = useState<HeroDef | null>(null);
  return (
    <div class="pf-pane scroll">
      {RARITIES.map((r) => {
        const list = HEROES.filter((h) => h.rarity === r);
        if (!list.length) return null;
        const own = list.filter((h) => mp.has(h.id)).length;
        return (
          <section class="pf-cgroup" key={r}>
            <h4 class="pf-h"><RarityTag r={r} /> <small>{own}/{list.length}</small></h4>
            <div class="pf-hgrid">
              {list.map((d) => {
                const o = mp.get(d.id);
                return (
                  <div class={`pf-hcell${o ? '' : ' none'}`} key={d.id}>
                    <HeroCard
                      def={d}
                      owned={o}
                      dim={!o}
                      badge={o ? undefined : <span class="pf-nohave">Chưa có</span>}
                      onClick={() => (o ? go({ n: 'heroes', id: d.id }) : setInfo(d))}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {info && <HeroInfo def={info} onClose={() => setInfo(null)} />}
    </div>
  );
}

function GearCollection({ m }: { m: MeResponse }) {
  const cnt = new Map<string, number>();
  for (const g of m.gear) cnt.set(g.def, (cnt.get(g.def) ?? 0) + 1);
  const owned = GEAR_DEFS.filter((d) => cnt.has(d.id)).length;
  return (
    <div class="pf-pane scroll">
      <div class="pf-gtotal"><Icon n="bag" size={20} /> Đã sưu tầm <b>{owned}/{GEAR_DEFS.length}</b> loại trang bị</div>
      <div class="pf-gslots">
        {GEAR_SLOTS.map((slot) => {
          const defs = GEAR_DEFS.filter((d) => d.slot === slot);
          const have = defs.filter((d) => cnt.has(d.id)).length;
          return (
            <section class="pf-gslot" key={slot}>
              <h4 class="pf-h"><Icon n={GEAR_ICON[slot]} size={22} /> {GEAR_SLOT_NAME[slot]} <small>{have}/{defs.length}</small></h4>
              <div class="pf-gmat">
                <span />
                {RAR_ASC.map((r) => <RarityTag key={r} r={r} />)}
                {GEAR_THEMES.map((th) => (
                  <Fragment key={th}>
                    <span class="pf-gth" title={th}><Icon n={ELEM_ICON[th]} size={20} /></span>
                    {RAR_ASC.map((r) => {
                      const d = defs.find((x) => x.theme === th && x.rarity === r)!;
                      const n = cnt.get(d.id) ?? 0;
                      return (
                        <span class="pf-gcell" key={d.id} title={`${d.name}${n ? ` (x${n})` : ' (chưa có)'}`}>
                          <GearTile def={d} dim={!n} count={n > 1 ? n : undefined} size={44} />
                        </span>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function CollectTab({ m }: { m: MeResponse }) {
  const [sub, setSub] = useState<'hero' | 'gear'>('hero');
  const mp = ownedMap(m);
  const nOwn = HEROES.filter((h) => mp.has(h.id)).length;
  const gOwn = new Set(m.gear.map((g) => g.def)).size;
  return (
    <div class="pf-collect">
      <div class="seg wide pf-sub" role="tablist" aria-label="Bộ sưu tập">
        <button type="button" role="tab" aria-selected={sub === 'hero'} class={sub === 'hero' ? 'on' : ''} onClick={() => { sfx('tap'); setSub('hero'); }}>
          <Icon n="heroes" size={18} /> Tướng {nOwn}/{HEROES.length}
        </button>
        <button type="button" role="tab" aria-selected={sub === 'gear'} class={sub === 'gear' ? 'on' : ''} onClick={() => { sfx('tap'); setSub('gear'); }}>
          <Icon n="bag" size={18} /> Trang bị {gOwn}/{GEAR_DEFS.length}
        </button>
      </div>
      {sub === 'hero' ? <HeroCollection m={m} /> : <GearCollection m={m} />}
    </div>
  );
}
