// Triệu hồi: banner, x1/x10, vé/kim cương, pity, bảng tỉ lệ, hiệu ứng lật thẻ. Mỗi lần bấm một khoá chống gửi trùng.
import { useState } from 'preact/hooks';
import { BANNERS, RATES, SSR_PITY, SUMMON10_COST, SUMMON_COST, UR_PITY, NEW_PITY, type Banner } from '@shared/heroes/gacha';
import { DUPE_SHARDS, powerOf, starUpCost, statsAt } from '@shared/heroes/formulas';
import { poolOf } from '@shared/heroes/heroes';
import { skillOf } from '@shared/heroes/skills';
import { ELEMENT_NAME, RARITIES, ROLE_NAME, type HeroDef, type Rarity } from '@shared/heroes/types';
import type { SummonRes } from '@shared/heroes/api';
import { api, me } from '../../api';
import { defOf, describeSkill, ownedMap, STAT_KEYS, STAT_LABEL } from '../../game';
import { store } from '../../settings';
import { fmt, uuid, useBusy } from '../../state';
import { Btn, ElemChip, HeroCard, Modal, Portrait, RarityTag, RoleChip, Stars } from '../common';
import { Icon } from '../icons';
import { Reveal } from '../reveal';

type Pull = SummonRes['pulls'][number];

/** chỉ dev: ?demo=ur|ssr|sr (thêm &n=10 cho lô 10 lượt) -> nút phát thử phần công bố với lượt quay giả */
const demo: Rarity | null = import.meta.env.DEV
  ? (() => {
      const v = new URLSearchParams(location.search).get('demo')?.toUpperCase();
      return v === 'UR' || v === 'SSR' || v === 'SR' ? (v as Rarity) : null;
    })()
  : null;
function demoPulls(r: Rarity): Pull[] {
  const pick = (x: Rarity, i: number) => poolOf(x)[i % Math.max(1, poolOf(x).length)];
  const one = (x: Rarity, i: number, isNew: boolean): Pull => ({ heroId: pick(x, i).id, rarity: x, isNew, shards: isNew ? 0 : DUPE_SHARDS[x] });
  if (new URLSearchParams(location.search).get('n') !== '10') return [one(r, 0, true)];
  const fill: Rarity[] = ['R', 'R', 'SR', 'R', 'R', 'R', 'SSR', 'R', 'SR', 'R'];
  fill[6] = r;
  return fill.map((x, i) => one(x, i, i % 3 === 0));
}

/* ------------------------------ LỊCH SỬ (localStorage, theo tài khoản) ------------------------------ */
interface HistItem {
  h: string;
  r: Rarity;
  t: number;
  n: boolean;
}
const HIST_MAX = 50;
const histKey = (uid: number) => `heroes-summon-hist-v1-${uid}`;
function loadHist(uid: number): HistItem[] {
  try {
    const a = JSON.parse(store(histKey(uid)) || '[]');
    if (!Array.isArray(a)) return [];
    return a.filter((x) => x && typeof x.h === 'string' && RARITIES.includes(x.r)).slice(0, HIST_MAX);
  } catch {
    return [];
  }
}
function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------ TỈ LỆ ------------------------------ */
/** 1 -> "1", 0.5 -> "0.5", 0.0833 -> "0.083" */
function pct(x: number): string {
  const s = x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(3);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
/** tỉ lệ cơ bản của cả phẩm (%) */
const rateOf = (r: Rarity) => RATES[r] / 100;
/** tỉ lệ ra đúng 1 tướng (%) ở banner này, chưa tính bảo hiểm.
 *  Banner nổi bật, phẩm UR: tướng nổi bật chiếm 50% số lượt UR, các UR còn lại chia đều 50% còn lại. */
function chanceOf(h: HeroDef, b: Banner): number {
  const pool = poolOf(h.rarity);
  const base = rateOf(h.rarity);
  if (h.rarity === 'UR' && b.featured && pool.some((x) => x.id === b.featured)) {
    const others = pool.length - 1;
    if (others <= 0) return base;
    return h.id === b.featured ? base * 0.5 : (base * 0.5) / others;
  }
  return base / pool.length;
}

/* ------------------------------ CHI TIẾT TƯỚNG ------------------------------ */
const KIND_LABEL = { basic: 'Đòn thường', active: 'Kỹ năng', ult: 'Tuyệt kỹ' } as const;
function HeroInfo({ def, chance, onClose }: { def: HeroDef; chance: number; onClose: () => void }) {
  const o = ownedMap(me.value!).get(def.id);
  const st = statsAt(def.role, def.rarity, 1, 1);
  return (
    <Modal title={def.name} onClose={onClose} class="sm-info">
      <div class="sm-ihead">
        <div class={`sm-iart r-${def.rarity}`}><Portrait id={def.id} rarity={def.rarity} /></div>
        <div class="sm-ibox">
          <small class="muted">{def.title}</small>
          <div class="sm-chips">
            <RarityTag r={def.rarity} />
            <ElemChip el={def.element} label />
            <RoleChip role={def.role} label />
          </div>
          <span class="sm-line">Tỉ lệ ra: <b>{pct(chance)}%</b> mỗi lượt</span>
          {o ? (
            <span class="sm-line">Đã có: Lv{o.level} <Stars n={o.star} size={13} /></span>
          ) : (
            <span class="sm-line sm-newtxt">Chưa sở hữu</span>
          )}
        </div>
      </div>
      <div class="sm-stats">
        {STAT_KEYS.map((k) => (
          <div key={k}><small>{STAT_LABEL[k]}</small><b>{fmt(st[k])}</b></div>
        ))}
        <div><small>Lực chiến</small><b>{fmt(powerOf(st))}</b></div>
      </div>
      <small class="muted">Chỉ số mẫu ở Lv1, 1 sao ({ELEMENT_NAME[def.element]} - {ROLE_NAME[def.role]}).</small>
      <div class="sm-skills">
        {def.skills.map((sid) => {
          const s = skillOf(sid);
          return (
            <div class={`skill k-${s.kind}`} key={sid}>
              <span class="sk-kind">{KIND_LABEL[s.kind]}</span>
              <b>{s.name}</b>
              <p>{describeSkill(s)}</p>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ------------------------------ TAB: DANH SÁCH TƯỚNG ------------------------------ */
function PoolTab({ banner, onPick }: { banner: Banner; onPick: (h: HeroDef) => void }) {
  const owned = ownedMap(me.value!);
  return (
    <div class="sm-pool">
      {RARITIES.slice().reverse().map((r) => {
        const pool = poolOf(r);
        if (!pool.length) return null;
        const featUR = r === 'UR' && !!banner.featured;
        return (
          <section class={`sm-rar r-${r}`} key={r}>
            <header>
              <RarityTag r={r} />
              <b class="sm-rate">{pct(rateOf(r))}%</b>
              <small>
                {featUR
                  ? `${pool.length} tướng, nổi bật 50% số lượt UR`
                  : `${pool.length} tướng, mỗi tướng ${pct(rateOf(r) / pool.length)}%`}
              </small>
            </header>
            <div class="sm-grid">
              {pool.map((h) => {
                const has = owned.has(h.id);
                const feat = h.id === banner.featured;
                return (
                  <div class="sm-cell" key={h.id}>
                    <HeroCard
                      def={h}
                      dim={!has}
                      onClick={() => onPick(h)}
                      badge={
                        <>
                          {has ? <span class="sm-own" aria-label="Đã sở hữu"><Icon n="check" size={14} /></span> : <span class="sm-newtag">MỚI</span>}
                          {feat && <span class="sm-feat">Nổi bật</span>}
                        </>
                      }
                    />
                    <small class="sm-chance">{pct(chanceOf(h, banner))}%</small>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------ TAB: TỈ LỆ & BẢO HIỂM ------------------------------ */
function RulesTab({ banner }: { banner: Banner }) {
  const f = banner.featured ? defOf(banner.featured) : null;
  return (
    <div class="sm-rules">
      <table class="sm-table">
        <thead>
          <tr><th>Phẩm</th><th>Tỉ lệ</th><th>Số tướng</th><th>Trùng tướng</th></tr>
        </thead>
        <tbody>
          {RARITIES.slice().reverse().map((r) => (
            <tr key={r}>
              <td><RarityTag r={r} /></td>
              <td><b>{pct(rateOf(r))}%</b></td>
              <td>{poolOf(r).length}</td>
              <td>+{DUPE_SHARDS[r]} mảnh</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 class="sm-h">Bảo hiểm</h4>
      <ul class="sm-list">
        <li>Quay x10 đảm bảo ít nhất 1 tướng SR trở lên.</li>
        <li>Chạm mốc <b>{SSR_PITY}</b> lượt chưa ra SSR trở lên: lượt kế chắc chắn ra SSR+ (bộ đếm về 0 khi ra SSR+).</li>
        <li>Chạm mốc <b>{UR_PITY}</b> lượt chưa ra UR: lượt kế chắc chắn ra UR (bộ đếm về 0 khi ra UR).</li>
        {f ? (
          <>
            <li>Khi ra UR ở banner này: <b>50%</b> là <b>{f.name}</b>, 50% còn lại chia đều cho các UR khác.</li>
            <li>Nếu UR vừa ra không phải {f.name}, UR kế tiếp <b>chắc chắn</b> là {f.name}.</li>
          </>
        ) : (
          <li>Banner thường: mỗi phẩm chia đều cho mọi tướng trong phẩm đó.</li>
        )}
      </ul>
      <h4 class="sm-h">Tướng trùng và mảnh</h4>
      <ul class="sm-list">
        <li>Quay trúng tướng đã có sẽ đổi thành mảnh: {RARITIES.map((r) => `${r} +${DUPE_SHARDS[r]}`).join(', ')}.</li>
        <li>Mảnh dùng để lên sao: sao 1 lên 2 cần {starUpCost(1)} mảnh, rồi {starUpCost(2)}, {starUpCost(3)}, {starUpCost(4)} mảnh.</li>
      </ul>
      <h4 class="sm-h">Chi phí</h4>
      <table class="sm-table">
        <tbody>
          <tr><td></td><td><b>x1</b></td><td><b>x10</b></td></tr>
          <tr>
            <td><Icon n="ticket" size={18} /> Vé</td><td>{SUMMON_COST.tickets}</td><td>{SUMMON10_COST.tickets}</td>
          </tr>
          <tr>
            <td><Icon n="gem" size={18} /> Kim cương</td><td>{fmt(SUMMON_COST.gems)}</td><td>{fmt(SUMMON10_COST.gems)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ TAB: LỊCH SỬ ------------------------------ */
function HistRow({ x }: { x: HistItem }) {
  const d = defOf(x.h);
  if (!d) return null;
  return (
    <li class={`sm-hrow r-${x.r}`}>
      <span class="sm-hav"><Portrait id={d.id} rarity={d.rarity} /></span>
      <span class="sm-hn">
        <b>{d.name}</b>
        <small>{fmtTime(x.t)}</small>
      </span>
      {x.n && <span class="sm-newtag inline">MỚI</span>}
      <RarityTag r={x.r} />
    </li>
  );
}
function HistStats({ hist }: { hist: HistItem[] }) {
  const rare = hist.filter((x) => x.r === 'SSR' || x.r === 'UR').length;
  return (
    <div class="sm-hstat">
      <span>{hist.length} lượt gần nhất</span>
      <span>SSR+ : <b>{rare}</b></span>
      <span>UR : <b>{hist.filter((x) => x.r === 'UR').length}</b></span>
    </div>
  );
}
function HistTab({ hist }: { hist: HistItem[] }) {
  if (!hist.length) return <p class="sm-none">Chưa có lượt quay nào trên thiết bị này.</p>;
  return (
    <div class="sm-hist">
      <HistStats hist={hist} />
      <ul class="sm-hlist">{hist.map((x, i) => <HistRow key={i} x={x} />)}</ul>
    </div>
  );
}

type Tab = 'heroes' | 'rates' | 'hist';
const TABS: { id: Tab; label: string }[] = [
  { id: 'heroes', label: 'Tướng' },
  { id: 'rates', label: 'Tỉ lệ & bảo hiểm' },
  { id: 'hist', label: 'Lịch sử' },
];

export function Summon() {
  const m = me.value!;
  const uid = m.profile.id;
  const [bi, setBi] = useState(0);
  const [tab, setTab] = useState<Tab>('heroes');
  const [pay, setPay] = useState<'tickets' | 'gems'>('tickets');
  const [busy, run] = useBusy();
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const [info, setInfo] = useState<HeroDef | null>(null);
  const [hist, setHist] = useState<HistItem[]>(() => loadHist(uid));
  const banner = BANNERS[bi];
  const pity = m.pity[banner.id] ?? NEW_PITY;
  const w = m.wallet;
  const c1 = SUMMON_COST[pay];
  const c10 = SUMMON10_COST[pay];
  const have = w[pay];
  const feat = banner.featured ? defOf(banner.featured) : null;
  const payName = pay === 'tickets' ? 'vé' : 'kim cương';
  const stdTop = poolOf('UR').concat(poolOf('SSR')).slice(0, 5);
  const leftSSR = Math.max(0, SSR_PITY - pity.sinceSSR);
  const leftUR = Math.max(0, UR_PITY - pity.sinceUR);

  const doSummon = (count: 1 | 10) =>
    run(async () => {
      const r = await api.summon(banner.id, count, pay, uuid());
      // lưu lịch sử trước khi hiện kết quả; lượt cuối của đợt là mới nhất
      const now = Date.now();
      const add: HistItem[] = r.pulls.map((p) => ({ h: p.heroId, r: p.rarity, t: now, n: !!p.isNew })).reverse();
      const next = add.concat(hist).slice(0, HIST_MAX);
      setHist(next);
      store(histKey(uid), JSON.stringify(next));
      setPulls(r.pulls);
    });

  const lack1 = have < c1 ? c1 - have : 0;
  const lack10 = have < c10 ? c10 - have : 0;
  const lackText = lack1
    ? `Thiếu ${fmt(lack1)} ${payName} để quay x1.`
    : lack10
      ? `Thiếu ${fmt(lack10)} ${payName} để quay x10.`
      : '';

  return (
    <div class="summon">
      <div class="sm-main">
        <div class="sm-left">
          <div class="banner-tabs">
            {BANNERS.map((b, i) => (
              <button type="button" key={b.id} class={`fchip wide${bi === i ? ' on' : ''}`} onClick={() => setBi(i)}>
                {b.name}
              </button>
            ))}
          </div>

          <div class={`sm-banner${feat ? ' feat' : ''}`}>
            {feat ? (
              <>
                <button type="button" class="sm-bhero" aria-label={`Xem ${feat.name}`} onClick={() => setInfo(feat)}>
                  <Portrait id={feat.id} rarity={feat.rarity} />
                </button>
                <div class="sm-btext">
                  <span class="sm-ribbon">Tăng tỉ lệ</span>
                  <h2>{feat.name}</h2>
                  <div class="sm-chips">
                    <RarityTag r={feat.rarity} />
                    <ElemChip el={feat.element} label />
                    <RoleChip role={feat.role} label />
                  </div>
                  <p>50% số lượt UR là {feat.name}, trượt thì lần UR sau chắc chắn.</p>
                </div>
              </>
            ) : (
              <div class="sm-btext">
                <h2>Triệu Hồi Thường</h2>
                <p>Tướng phẩm cao nhất đang có trong banner:</p>
                <div class="sm-showcase">
                  {stdTop.map((h) => (
                    <button type="button" class={`sm-mini r-${h.rarity}`} key={h.id} aria-label={h.name} onClick={() => setInfo(h)}>
                      <Portrait id={h.id} rarity={h.rarity} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div class="seg wide sm-tabs" role="tablist">
            {TABS.map((t) => (
              <button type="button" role="tab" aria-selected={tab === t.id} key={t.id} class={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div class="sm-detail">
            {tab === 'heroes' && <PoolTab banner={banner} onPick={setInfo} />}
            {tab === 'rates' && <RulesTab banner={banner} />}
            {tab === 'hist' && <HistTab hist={hist} />}
          </div>
        </div>

        <div class="sm-ctrl">
          <div class="sm-pity" data-tut="summon-pity">
            <div class="sm-pcol">
              <div class="sm-ptop"><span>SSR</span><b>{pity.sinceSSR}/{SSR_PITY}</b></div>
              <div class="pbar"><i class="ssr" style={{ width: `${Math.min(100, (pity.sinceSSR * 100) / SSR_PITY)}%` }} /></div>
              <small>Còn {leftSSR} lượt nữa chắc chắn SSR</small>
            </div>
            <div class="sm-pcol">
              <div class="sm-ptop"><span>UR</span><b>{pity.sinceUR}/{UR_PITY}</b></div>
              <div class="pbar"><i class="ur" style={{ width: `${Math.min(100, (pity.sinceUR * 100) / UR_PITY)}%` }} /></div>
              <small>Còn {leftUR} lượt nữa chắc chắn UR</small>
            </div>
            {feat && (
              <small class={`sm-guar${pity.guaranteed ? ' ok' : ''}`}>
                {pity.guaranteed ? `UR kế tiếp chắc chắn là ${feat.name}!` : `UR kế tiếp: 50% là ${feat.name}.`}
              </small>
            )}
          </div>

          <div class="sm-hprev">
            <div class="sm-hp-head"><b>Lượt quay gần đây</b><button type="button" class="sm-link" onClick={() => setTab('hist')}>Xem tất cả</button></div>
            {hist.length ? (
              <>
                <HistStats hist={hist} />
                <ul class="sm-hlist">{hist.slice(0, 5).map((x, i) => <HistRow key={i} x={x} />)}</ul>
              </>
            ) : (
              <p class="sm-none">Chưa có lượt quay nào.</p>
            )}
          </div>

          <div class="sm-pull">
            <div class="seg wide sm-pay">
              <button type="button" class={pay === 'tickets' ? 'on' : ''} onClick={() => setPay('tickets')}>
                <Icon n="ticket" size={18} /> Vé ({fmt(w.tickets)})
              </button>
              <button type="button" class={pay === 'gems' ? 'on' : ''} onClick={() => setPay('gems')}>
                <Icon n="gem" size={18} /> Kim cương ({fmt(w.gems)})
              </button>
            </div>
            <div class="summon-btns">
              <Btn kind="blue" big busy={busy} disabled={have < c1} onClick={() => doSummon(1)} tut="summon-x1">
                <span class="sb-top">Quay x1</span>
                <span class="sb-cost"><Icon n={pay === 'tickets' ? 'ticket' : 'gem'} size={16} />{fmt(c1)}</span>
              </Btn>
              <Btn kind="primary" big busy={busy} disabled={have < c10} onClick={() => doSummon(10)}>
                <span class="sb-top">Quay x10</span>
                <span class="sb-cost"><Icon n={pay === 'tickets' ? 'ticket' : 'gem'} size={16} />{fmt(c10)}</span>
              </Btn>
            </div>
            {lackText && <small class="lack-note">{lackText}</small>}
          </div>
        </div>
      </div>

      {info && <HeroInfo def={info} chance={chanceOf(info, banner)} onClose={() => setInfo(null)} />}
      {pulls && (
        <Reveal
          pulls={pulls}
          onClose={() => setPulls(null)}
          onAgain={
            have >= (pulls.length === 1 ? c1 : c10)
              ? () => {
                  const n = pulls.length === 1 ? 1 : 10;
                  setPulls(null);
                  void doSummon(n);
                }
              : undefined
          }
        />
      )}
      {import.meta.env.DEV && demo && (
        <button type="button" class="btn primary" style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 60 }} onClick={() => setPulls(demoPulls(demo))}>
          Demo {demo.toUpperCase()}
        </button>
      )}
    </div>
  );
}
