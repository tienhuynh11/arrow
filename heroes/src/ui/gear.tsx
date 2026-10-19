// Trang bị: ô vuông trang bị (tile), tab "Trang bị" của tướng, bảng chọn món, kho đồ, chi tiết món, danh sách rớt đồ.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  enhanceCost,
  GEAR_BY_ID,
  GEAR_CAP,
  GEAR_SLOT_NAME,
  GEAR_SLOTS,
  gearDefOf,
  MAX_GEAR_LEVEL,
  salvageStones,
  type GearDef,
  type GearInst,
  type GearSlot,
} from '@shared/heroes/gear';
import type { Rarity, Stats } from '@shared/heroes/types';
import { api, me } from '../api';
import { sfx } from '../audio';
import { bagBySlot, gearBonus, gearOf, gearPower, gearStatsOf, gearUpgradePlan, HERO_BY_ID, ownedMap, powerOfOwned, STAT_LABEL, statDiff, statEntries, type StatKey } from '../game';
import { errToast, fmt, toast } from '../state';
import { Btn, HeroCard, IconBtn, Modal, Portrait, RarityTag } from './common';
import { ELEM_ICON, GEAR_ICON, Icon } from './icons';

const RANK: Record<Rarity, number> = { R: 0, SR: 1, SSR: 2, UR: 3 };
const STAT_ICON: Record<StatKey, 'heart' | 'sword' | 'shield' | 'bolt'> = { hp: 'heart', atk: 'sword', def: 'shield', spd: 'bolt' };

/** "+12 Công · +60 Máu" */
export function statText(s: Stats): string {
  return statEntries(s)
    .map((e) => `+${e.v} ${STAT_LABEL[e.k]}`)
    .join(' · ');
}

/* ------------------------------ Ô TRANG BỊ ------------------------------ */
export function GearTile(p: {
  def: GearDef;
  level?: number;
  /** tướng đang mặc: hiện chân dung nhỏ */
  hero?: string | null;
  selected?: boolean;
  checked?: boolean;
  dim?: boolean;
  /** hiệu ứng toả sáng cho đồ vừa rớt */
  glow?: boolean;
  count?: number;
  size?: number;
  onClick?: () => void;
  class?: string;
}) {
  const { def } = p;
  const lv = p.level ?? 0;
  const wear = p.hero ? HERO_BY_ID[p.hero] : null;
  const cls = `gtile r-${def.rarity}${p.selected ? ' sel' : ''}${p.checked ? ' chk' : ''}${p.dim ? ' dim' : ''}${p.glow ? ' glow' : ''} ${p.class ?? ''}`;
  const style = p.size ? ({ '--gs': `${p.size}px` } as any) : undefined;
  const inner = (
    <>
      <span class="gt-art">
        <Icon n={GEAR_ICON[def.slot]} size={36} />
        {(def.rarity === 'SSR' || def.rarity === 'UR') && <span class="shimmer" />}
      </span>
      <span class="gt-theme">
        <Icon n={ELEM_ICON[def.theme]} size={13} />
      </span>
      {lv > 0 && <span class="gt-lv">+{lv}</span>}
      <span class="gt-rar">{def.rarity}</span>
      {wear && (
        <span class="gt-wear" title={wear.name}>
          <Portrait id={wear.id} rarity={wear.rarity} />
        </span>
      )}
      {p.count && p.count > 1 ? <span class="gt-cnt">x{p.count}</span> : null}
      {p.checked && (
        <span class="gt-chk">
          <Icon n="check" size={20} />
        </span>
      )}
    </>
  );
  if (!p.onClick) return <div class={cls} style={style} title={def.name}>{inner}</div>;
  return (
    <button
      type="button"
      class={cls}
      style={style}
      aria-label={`${def.name}${lv > 0 ? ` +${lv}` : ''}`}
      onClick={() => {
        sfx('tap');
        p.onClick!();
      }}
    >
      {inner}
    </button>
  );
}

/** chênh lệch chỉ số (▲ xanh / ▼ đỏ) */
function Diff({ d }: { d: Stats }) {
  const e = statEntries(d);
  if (!e.length) return <i class="gd same">Như nhau</i>;
  return (
    <>
      {e.map((x) => (
        <i key={x.k} class={`gd ${x.v > 0 ? 'up' : 'down'}`}>
          {x.v > 0 ? '▲ +' : '▼ '}
          {x.v} {STAT_LABEL[x.k]}
        </i>
      ))}
    </>
  );
}

/* ------------------------------ BẢNG DƯỚI (bottom sheet) ------------------------------ */
function Sheet(p: { title: string; onClose: () => void; children: ComponentChildren; class?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        p.onClose();
      }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [p.onClose]);
  return (
    <div class="gs-back" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class={`gsheet ${p.class ?? ''}`} role="dialog" aria-modal="true">
        <div class="gs-head">
          <h2>{p.title}</h2>
          <IconBtn n="close" label="Đóng" onClick={p.onClose} />
        </div>
        <div class="gs-body">{p.children}</div>
      </div>
    </div>
  );
}

/* ------------------------------ CHỌN MÓN CHO MỘT Ô CỦA TƯỚNG ------------------------------ */
export function GearPicker({ heroId, slot, onClose }: { heroId: string; slot: GearSlot; onClose: () => void }) {
  const m = me.value!;
  const worn = gearOf(m, heroId)[slot];
  const wornStats = worn ? gearStatsOf(worn) : null;
  const zero: Stats = { hp: 0, atk: 0, def: 0, spd: 0 };
  const items = m.gear
    .filter((g) => GEAR_BY_ID[g.def]?.slot === slot && g.uid !== worn?.uid)
    .sort((a, b) => (a.hero ? 1 : 0) - (b.hero ? 1 : 0) || gearPower(b) - gearPower(a));
  const equip = (uid: number) => {
    sfx('rare');
    api.gearEquip(uid, heroId).catch(errToast);
    onClose();
  };
  const unequip = (uid: number) => {
    api.gearUnequip(uid).catch(errToast);
    onClose();
  };
  return (
    <Sheet title={`${GEAR_SLOT_NAME[slot]} · ${HERO_BY_ID[heroId]?.name ?? ''}`} onClose={onClose}>
      {worn && (
        <div class="gp-row cur">
          <GearTile def={gearDefOf(worn.def)} level={worn.level} size={48} />
          <div class="gp-txt">
            <b>{gearDefOf(worn.def).name}</b>
            <span class="gp-sub">Đang mặc · {statText(gearStatsOf(worn))}</span>
          </div>
          <Btn kind="red" small onClick={() => unequip(worn.uid)}>Tháo</Btn>
        </div>
      )}
      {items.length === 0 && <p class="muted empty">{worn ? 'Không còn món nào khác cho ô này.' : 'Kho chưa có món nào cho ô này. Hãy đánh ải để nhận trang bị.'}</p>}
      {items.map((g) => {
        const d = gearDefOf(g.def);
        const diff = statDiff(gearStatsOf(g), wornStats ?? zero);
        return (
          <div class="gp-row" key={g.uid}>
            <GearTile def={d} level={g.level} hero={g.hero} size={48} />
            <div class="gp-txt">
              <b>{d.name}</b>
              <span class="gp-diff">
                <Diff d={diff} />
              </span>
              {g.hero && <span class="gp-sub">Đang ở {HERO_BY_ID[g.hero]?.name} (sẽ chuyển sang)</span>}
            </div>
            <Btn kind="green" small onClick={() => equip(g.uid)}>Mặc</Btn>
          </div>
        );
      })}
    </Sheet>
  );
}

/* ------------------------------ TAB "TRANG BỊ" CỦA TƯỚNG ------------------------------ */
export function GearTab({ heroId }: { heroId: string }) {
  const m = me.value!;
  const [pick, setPick] = useState<GearSlot | null>(null);
  const [bag, setBag] = useState(false);
  const worn = gearOf(m, heroId);
  const bonus = gearBonus(m, heroId);
  const o = ownedMap(m).get(heroId);
  return (
    <>
      <div class="gslots">
        {GEAR_SLOTS.map((slot) => {
          const it = worn[slot];
          const d = it ? gearDefOf(it.def) : null;
          const spare = bagBySlot(m, slot).length;
          return (
            <button
              type="button"
              key={slot}
              class={`gslot${d ? ` r-${d.rarity}` : ' unfilled'}`}
              onClick={() => {
                sfx('tap');
                setPick(slot);
              }}
              aria-label={`${GEAR_SLOT_NAME[slot]}: ${d ? d.name : 'trống'}`}
            >
              {d && it ? (
                <GearTile def={d} level={it.level} size={48} />
              ) : (
                <span class="gtile gt-empty">
                  <Icon n={GEAR_ICON[slot]} size={30} />
                </span>
              )}
              <span class="gs-txt">
                <small>{GEAR_SLOT_NAME[slot]}</small>
                <b>{d ? d.name : 'Trống'}</b>
                <em>{it ? statText(gearStatsOf(it)) : spare > 0 ? `${spare} trong kho` : 'Chạm để chọn'}</em>
              </span>
            </button>
          );
        })}
      </div>
      <div class="gfoot">
      <div class="gbonus">
        <b>Tổng thưởng</b>
        <span class="gb-vals">
          {statEntries(bonus).length ? (
            statEntries(bonus).map((e) => (
              <span key={e.k}>
                <Icon n={STAT_ICON[e.k]} size={16} />+{e.v}
              </span>
            ))
          ) : (
            <small class="muted">Chưa mặc món nào</small>
          )}
        </span>
        {o && <small class="muted">Lực chiến {fmt(powerOfOwned(o))}</small>}
      </div>
      <Btn kind="blue" small onClick={() => setBag(true)}>
        <Icon n="bag" size={20} /> Kho đồ {m.gear.length}/{GEAR_CAP}
      </Btn>
      </div>
      {pick && <GearPicker heroId={heroId} slot={pick} onClose={() => setPick(null)} />}
      {bag && <GearBag onClose={() => setBag(false)} />}
    </>
  );
}

/* ------------------------------ CHI TIẾT MỘT MÓN ------------------------------ */
export function GearSheet({ uid, onClose }: { uid: number; onClose: () => void }) {
  const m = me.value!;
  const it = m.gear.find((g) => g.uid === uid);
  const [heroPick, setHeroPick] = useState(false);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!it) onClose();
  }, [!!it]);
  const heroes = useMemo(
    () => m.heroes.slice().sort((a, b) => powerOfOwned(b) - powerOfOwned(a)),
    // eslint-disable-next-line
    [m.heroes, m.gear],
  );
  if (!it) return null;
  const d = gearDefOf(it.def);
  const st = gearStatsOf(it);
  const nextC = enhanceCost(d.rarity, it.level);
  const nextSt = nextC ? gearStatsOf({ def: it.def, level: it.level + 1 }) : null;
  const w = m.wallet;
  const plan = gearUpgradePlan(it.level, d.rarity, w.gold, w.stones, MAX_GEAR_LEVEL);
  const can1 = !!nextC && w.gold >= nextC.gold && w.stones >= nextC.stones;
  const wearer = it.hero ? HERO_BY_ID[it.hero] : null;
  const back = Salvage(it);

  const up = (times: number) => {
    sfx('level');
    api.gearUpgrade(uid, times).catch(errToast);
  };
  const equipTo = (hero: string) => {
    sfx('rare');
    api.gearEquip(uid, hero).catch(errToast);
    setHeroPick(false);
  };
  const salvage = () => {
    if (!ask) return setAsk(true);
    api
      .gearSalvage([uid])
      .then((r) => toast(`+${r.stones} đá cường hoá`, 'ok'))
      .catch(errToast);
    onClose();
  };

  if (heroPick) {
    return (
      <Sheet title={`Mặc ${d.name} cho…`} onClose={() => setHeroPick(false)}>
        <div class="gp-heroes">
          {heroes.map((h) => {
            const cur = gearOf(m, h.id)[d.slot];
            const dp = gearPower(it) - (cur ? gearPower(cur) : 0);
            const same = it.hero === h.id;
            return (
              <HeroCard
                key={h.id}
                def={HERO_BY_ID[h.id]}
                owned={h}
                dim={same}
                onClick={() => !same && equipTo(h.id)}
                badge={<span class={`gp-badge ${same ? 'same' : dp > 0 ? 'up' : dp < 0 ? 'down' : 'same'}`}>{same ? 'Đang mặc' : dp > 0 ? `▲${dp}` : dp < 0 ? `▼${-dp}` : '='}</span>}
              />
            );
          })}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={d.name} onClose={onClose} class="gdetail">
      <div class="gd-info">
        <div class="gd-head">
          <GearTile def={d} level={it.level} size={64} />
          <div class="gd-id">
            <span>
              <RarityTag r={d.rarity} /> <small>{GEAR_SLOT_NAME[d.slot]}</small>
            </span>
            <b class="gd-lv">
              Cấp +{it.level}/{MAX_GEAR_LEVEL}
            </b>
            <small class="muted">{wearer ? `Đang mặc: ${wearer.name}` : 'Trong kho'}</small>
          </div>
        </div>
        <div class="gd-stats">
          {statEntries(nextSt ?? st).map((e) => (
            <div class="stat" key={e.k}>
              <Icon n={STAT_ICON[e.k]} size={18} />
              <span>{STAT_LABEL[e.k]}</span>
              <b>+{st[e.k]}</b>
              {nextSt && nextSt[e.k] > st[e.k] && <em>▲ +{nextSt[e.k] - st[e.k]}</em>}
            </div>
          ))}
        </div>
        {nextC ? (
          <span class="cost gd-cost">
            <span class={w.gold >= nextC.gold ? '' : 'lack'}><Icon n="gold" size={16} />{fmt(nextC.gold)}</span>
            <span class={w.stones >= nextC.stones ? '' : 'lack'}><Icon n="stone" size={16} />{nextC.stones}</span>
            <small class="muted">Có {fmt(w.gold)} vàng · {w.stones} đá</small>
          </span>
        ) : (
          <small class="muted">Đã cường hoá tối đa.</small>
        )}
      </div>
      <div class="gd-acts">
        <div class="gd-row">
          <Btn kind="green" disabled={!can1} onClick={() => up(1)}>
            <span class="act-t">Cường hoá</span>
            <span class="act-s">{nextC ? `+${it.level + 1}` : 'Tối đa'}</span>
          </Btn>
          <Btn kind="green" disabled={plan.n < 2} onClick={() => up(plan.n)}>
            <span class="act-t">{plan.n > 1 ? `Tối đa +${plan.n}` : 'Tối đa'}</span>
            <span class="act-s">
              {plan.n > 1 ? (
                <>
                  <Icon n="gold" size={13} />{fmt(plan.gold)} <Icon n="stone" size={13} />{plan.stones}
                </>
              ) : (
                'Nâng nhiều cấp'
              )}
            </span>
          </Btn>
        </div>
        <div class="gd-row">
          <Btn kind="blue" onClick={() => setHeroPick(true)}>Mặc cho tướng…</Btn>
          {it.hero && <Btn kind="ghost" onClick={() => { api.gearUnequip(uid).catch(errToast); }}>Tháo</Btn>}
        </div>
        <Btn kind="red" disabled={!!it.hero} onClick={salvage} title={it.hero ? 'Hãy tháo ra trước' : ''}>
          {it.hero ? 'Tháo ra mới phân rã được' : ask ? `Chắc chắn? Nhận ${back} đá` : `Phân rã (+${back} đá)`}
        </Btn>
      </div>
    </Sheet>
  );
}
const Salvage = (it: GearInst) => salvageStones(gearDefOf(it.def).rarity, it.level);

/* ------------------------------ KHO ĐỒ ------------------------------ */
type SortK = 'rar' | 'lv';
export function GearBag({ onClose }: { onClose: () => void }) {
  const m = me.value!;
  const [slot, setSlot] = useState<GearSlot | null>(null);
  const [sort, setSort] = useState<SortK>('rar');
  const [multi, setMulti] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const [ask, setAsk] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const list = useMemo(
    () => {
      const l = m.gear.filter((g) => !slot || GEAR_BY_ID[g.def]?.slot === slot);
      const r = (g: GearInst) => RANK[gearDefOf(g.def).rarity];
      return l.sort((a, b) => (sort === 'rar' ? r(b) - r(a) || b.level - a.level : b.level - a.level || r(b) - r(a)) || a.uid - b.uid);
    },
    // eslint-disable-next-line
    [m.gear, slot, sort],
  );
  const alive = new Set(m.gear.filter((g) => !g.hero).map((g) => g.uid));
  const chosen = sel.filter((u) => alive.has(u));
  const stones = chosen.reduce((a, u) => {
    const g = m.gear.find((x) => x.uid === u)!;
    return a + salvageStones(gearDefOf(g.def).rarity, g.level);
  }, 0);

  const toggle = (u: number) => {
    setAsk(false);
    setSel(chosen.includes(u) ? chosen.filter((x) => x !== u) : [...chosen, u]);
  };
  const quick = (maxRank: number) => {
    setAsk(false);
    setSel(list.filter((g) => !g.hero && RANK[gearDefOf(g.def).rarity] <= maxRank).map((g) => g.uid));
  };
  const doSalvage = () => {
    if (!chosen.length) return;
    if (!ask) return setAsk(true);
    sfx('level');
    api
      .gearSalvage(chosen)
      .then((r) => toast(`Phân rã ${chosen.length} món: +${r.stones} đá cường hoá`, 'ok'))
      .catch(errToast);
    setSel([]);
    setAsk(false);
  };

  return (
    <Modal title={`Kho đồ ${m.gear.length}/${GEAR_CAP}`} onClose={onClose} wide class="gbag">
      <div class="gb-bar">
        <div class="gchips" role="tablist">
          <button type="button" class={`gchip${!slot ? ' on' : ''}`} onClick={() => setSlot(null)}>Tất cả</button>
          {GEAR_SLOTS.map((s) => (
            <button type="button" key={s} class={`gchip${slot === s ? ' on' : ''}`} aria-label={GEAR_SLOT_NAME[s]} title={GEAR_SLOT_NAME[s]} onClick={() => setSlot(slot === s ? null : s)}>
              <Icon n={GEAR_ICON[s]} size={24} />
            </button>
          ))}
        </div>
        <div class="gchips">
          <button type="button" class="gchip" onClick={() => setSort(sort === 'rar' ? 'lv' : 'rar')} aria-label="Đổi cách sắp xếp">
            {sort === 'rar' ? 'Xếp: Phẩm' : 'Xếp: Cấp'}
          </button>
          <button
            type="button"
            class={`gchip${multi ? ' on' : ''}`}
            onClick={() => {
              setMulti(!multi);
              setSel([]);
              setAsk(false);
            }}
          >
            Phân rã nhiều
          </button>
          <span class="gb-stone" title="Đá cường hoá"><Icon n="stone" size={18} /><b>{m.wallet.stones}</b></span>
        </div>
      </div>
      <div class="ggrid scroll">
        {list.map((g) => (
          <GearTile
            key={g.uid}
            def={gearDefOf(g.def)}
            level={g.level}
            hero={g.hero}
            checked={multi && chosen.includes(g.uid)}
            dim={multi && !!g.hero}
            onClick={() => (multi ? (g.hero ? toast('Món đang mặc, hãy tháo ra trước', 'info') : toggle(g.uid)) : setOpen(g.uid))}
          />
        ))}
        {list.length === 0 && <p class="muted empty">{m.gear.length ? 'Không có món nào ở ô này.' : 'Kho trống. Đánh ải để nhận trang bị!'}</p>}
      </div>
      {multi && (
        <div class="gb-foot">
          <div class="gb-quick">
            <button type="button" class="gchip" onClick={() => quick(0)}>Chọn R</button>
            <button type="button" class="gchip" onClick={() => quick(1)}>Chọn R+SR</button>
            <button type="button" class="gchip" onClick={() => { setSel([]); setAsk(false); }}>Bỏ chọn</button>
          </div>
          <Btn kind="red" disabled={!chosen.length} onClick={doSalvage}>
            {chosen.length ? (ask ? `Chắc chắn? ${chosen.length} món · +${stones} đá` : `Phân rã ${chosen.length} món · +${stones} đá`) : 'Chọn món để phân rã'}
          </Btn>
        </div>
      )}
      {open !== null && <GearSheet uid={open} onClose={() => setOpen(null)} />}
    </Modal>
  );
}

/* ------------------------------ ĐỒ RỚT ------------------------------ */
/** các món vừa rớt (gộp trùng thành xN), có toả sáng cho SSR/UR */
export function GearDrops({ ids, full }: { ids: string[]; full?: boolean }) {
  const groups = new Map<string, number>();
  for (const id of ids) groups.set(id, (groups.get(id) ?? 0) + 1);
  if (!groups.size) return full ? <small class="muted drops-none">Kho đồ đầy, không nhận được trang bị.</small> : null;
  const arr = [...groups].map(([id, n]) => ({ d: GEAR_BY_ID[id], n })).filter((x) => x.d).sort((a, b) => RANK[b.d.rarity] - RANK[a.d.rarity]);
  return (
    <div class="drops">
      {arr.map((x, i) => (
        <div class="drop" key={x.d.id} style={{ animationDelay: `${0.9 + i * 0.18}s` }}>
          <GearTile def={x.d} count={x.n} glow />
          <small class={`rtxt r-${x.d.rarity}`}>{x.d.name}</small>
        </div>
      ))}
    </div>
  );
}
