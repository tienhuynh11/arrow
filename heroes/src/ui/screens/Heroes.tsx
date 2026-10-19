// Danh sách tướng (thanh lọc gọn) + chi tiết tướng dạng TAB (3D cố định ở trên, nút hành động ghim ở dưới).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { levelUpCost, levelUpPlan, powerOf, starUpCost, statsAt } from '@shared/heroes/formulas';
import { MAX_STAR } from '@shared/heroes/config';
import { skillOf } from '@shared/heroes/skills';
import { api, me } from '../../api';
import { sfx } from '../../audio';
import { describeSkill, gearBonus, gearOf, gearStatsOf, HEROES, levelCapOf, ownedMap, powerOfOwned } from '../../game';
import { runLive } from '../../render/live';
import { createDetailScene, type DetailScene } from '../../render/scenes';
import { errToast, fmt, go, useMedia } from '../../state';
import { Btn, Canvas3D, ElemChip, HeroCard, IconBtn, RarityTag, RoleChip, Stars, useDesktop } from '../common';
import { applyFilter, EMPTY_FILTER, FilterBar, type HeroFilter } from '../filters';
import { GearTab, GearTile, statText } from '../gear';
import { GEAR_SLOT_NAME, GEAR_SLOTS, gearDefOf } from '@shared/heroes/gear';
import { Icon } from '../icons';

const STAT_ROWS: { k: 'hp' | 'atk' | 'def' | 'spd'; label: string; icon: 'heart' | 'sword' | 'shield' | 'bolt' }[] = [
  { k: 'hp', label: 'Máu', icon: 'heart' },
  { k: 'atk', label: 'Công', icon: 'sword' },
  { k: 'def', label: 'Thủ', icon: 'shield' },
  { k: 'spd', label: 'Tốc', icon: 'bolt' },
];
const KIND_LABEL = { basic: 'Đòn thường', active: 'Kỹ năng', ult: 'Tuyệt kỹ' } as const;
type DTab = 'stats' | 'skills' | 'gear' | 'up';
const DTABS: { k: DTab; label: string }[] = [
  { k: 'stats', label: 'Chỉ số' },
  { k: 'skills', label: 'Kỹ năng' },
  { k: 'gear', label: 'Trang bị' },
  { k: 'up', label: 'Nâng cấp' },
];
/** màn lớn: gộp Chỉ số + Kỹ năng + tóm tắt trang bị vào một tab "Tổng quan" để không còn vùng trống */
const DTABS_DK: { k: DTab; label: string }[] = [
  { k: 'stats', label: 'Tổng quan' },
  { k: 'gear', label: 'Trang bị' },
  { k: 'up', label: 'Nâng cấp' },
];

export function HeroDetail({ id, onClose, onStep, pos }: { id: string; onClose?: () => void; /** đổi tướng: -1 = trước, 1 = sau */ onStep?: (d: -1 | 1) => void; pos?: string }) {
  const m = me.value!;
  const def = HEROES.find((h) => h.id === id)!;
  const o = ownedMap(m).get(id);
  const [tab0, setTab] = useState<DTab>('stats');
  const dk = useDesktop();
  const tab: DTab = dk && tab0 === 'skills' ? 'stats' : tab0;
  const sceneRef = useRef<DetailScene | null>(null);
  const shown = useRef('');

  const level = o?.level ?? 1;
  const star = o?.star ?? 1;
  const baseStats = statsAt(def.role, def.rarity, level, star);
  // chỉ số hiển thị = gốc + trang bị đang mặc (khớp với trận đánh)
  const gb = o ? gearBonus(m, id) : { hp: 0, atk: 0, def: 0, spd: 0 };
  const stats = { hp: baseStats.hp + gb.hp, atk: baseStats.atk + gb.atk, def: baseStats.def + gb.def, spd: baseStats.spd + gb.spd };
  const nextLv = o && level < levelCapOf(star) ? statsAt(def.role, def.rarity, level + 1, star) : null;
  const lvCost = levelUpCost(level);
  const cap = levelCapOf(star);
  const stCost = starUpCost(star);
  const w = m.wallet;
  const plan = o ? levelUpPlan(level, star, w.gold, w.exp) : { n: 0, gold: 0, exp: 0 };
  const canLv = plan.n > 0;
  const canSt = !!o && stCost !== null && o.shards >= stCost;

  useEffect(() => {
    if (shown.current !== def.id) {
      shown.current = def.id;
      sceneRef.current?.setHero(def.id, def.rarity);
    }
  }, [def.id]);

  const start = (canvas: HTMLCanvasElement) => {
    const sc = createDetailScene();
    sceneRef.current = sc;
    shown.current = def.id;
    sc.setHero(def.id, def.rarity);
    const h = runLive(canvas, sc, 40);
    let last = 0;
    let moved = 0;
    const down = (e: PointerEvent) => {
      last = e.clientX;
      moved = 0;
      sc.dragging(true);
      canvas.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!(e.buttons || e.pointerType === 'touch')) return;
      const dx = e.clientX - last;
      last = e.clientX;
      moved += Math.abs(dx);
      sc.drag(dx);
    };
    const up = () => {
      sc.dragging(false);
      if (moved < 4) sc.poke();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      sceneRef.current = null;
      h.stop();
    };
  };

  // cập nhật tức thì trên màn hình (api.levelUp/starUp tự làm "lạc quan"), server đối chiếu sau; lỗi thì toast + trả về số thật
  const levelUp = (times: number) => {
    if (!canLv) return;
    sfx('level');
    api.levelUp(id, times).catch(errToast);
  };
  const starUp = () => {
    if (!canSt) return;
    sfx('rare');
    api.starUp(id).catch(errToast);
  };

  return (
    <section class={`detail r-${def.rarity}`}>
      <div class="d-view">
        <Canvas3D start={start} class="d-canvas" onPointer />
        {onClose && <IconBtn class="d-back" n="close" label="Đóng" onClick={onClose} />}
        {onStep && (
          <>
            <IconBtn class="d-nav prev" n="back" label="Tướng trước" onClick={() => onStep(-1)} />
            <IconBtn class="d-nav next" n="back" label="Tướng sau" onClick={() => onStep(1)} />
            {pos && <span class="d-pos">{pos}</span>}
          </>
        )}
        <div class="d-title">
          <RarityTag r={def.rarity} />
          <div>
            <h2>{def.name}</h2>
            <small>{def.title}</small>
          </div>
        </div>
      </div>

      <div class="seg wide d-tabs" role="tablist">
        {(dk ? DTABS_DK : DTABS).map((t) => (
          <button type="button" role="tab" key={t.k} class={tab === t.k ? 'on' : ''} aria-selected={tab === t.k} onClick={() => setTab(t.k)}>
            {t.label}
          </button>
        ))}
      </div>

      <div class="d-pane scroll">
        {tab === 'stats' && (
          <div class={dk ? 'dk-ov' : 'dk-flat'}>
            <div class="dk-ov-stats">
            <div class="d-tags">
              <ElemChip el={def.element} label />
              <RoleChip role={def.role} label />
              {o && <Stars n={o.star} size={16} />}
              {o && <span class="lvtag">Lv {o.level}/{cap}</span>}
            </div>
            <div class="stat-grid">
              {STAT_ROWS.map((r) => (
                <div class="stat" key={r.k}>
                  <Icon n={r.icon} size={18} />
                  <span>{r.label}</span>
                  <b>{stats[r.k]}</b>
                  {((nextLv && nextLv[r.k] > baseStats[r.k]) || gb[r.k] > 0) && (
                    <span class="stat-ex">
                      {nextLv && nextLv[r.k] > baseStats[r.k] && <em>+{nextLv[r.k] - baseStats[r.k]}</em>}
                      {gb[r.k] > 0 && <small class="gb" title="Từ trang bị">+{gb[r.k]}</small>}
                    </span>
                  )}
                </div>
              ))}
              <div class="stat power">
                <Icon n="sparkle" size={18} />
                <span>Lực chiến</span>
                <b>{fmt(powerOf(stats))}</b>
              </div>
            </div>
            {!o && <small class="muted">Chỉ số mẫu ở Lv1, 1 sao.</small>}
            </div>
            {dk && (
              <div class="dk-ov-skills">
                <h4 class="dk-h">Kỹ năng</h4>
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
            )}
            {dk && (
              <div class="dk-ov-gear">
                <h4 class="dk-h">Trang bị</h4>
                {o ? (
                  <div class="dk-gear-row">
                    {GEAR_SLOTS.map((slot) => {
                      const it = gearOf(m, id)[slot];
                      const d = it ? gearDefOf(it.def) : null;
                      return (
                        <div class={`dk-gear${d ? '' : ' empty'}`} key={slot}>
                          {d && it ? <GearTile def={d} level={it.level} size={44} /> : <span class="gtile gt-empty"><Icon n="sparkle" size={18} /></span>}
                          <span class="dk-gear-t">
                            <small>{GEAR_SLOT_NAME[slot]}</small>
                            <b>{d ? d.name : 'Trống'}</b>
                            {it && <em>{statText(gearStatsOf(it))}</em>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <small class="muted">Chưa sở hữu tướng này.</small>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'skills' && !dk &&
          def.skills.map((sid) => {
            const s = skillOf(sid);
            return (
              <div class={`skill k-${s.kind}`} key={sid}>
                <span class="sk-kind">{KIND_LABEL[s.kind]}</span>
                <b>{s.name}</b>
                <p>{describeSkill(s)}</p>
              </div>
            );
          })}

        {tab === 'gear' && (o ? <GearTab heroId={id} /> : <p class="muted">Bạn chưa sở hữu tướng này nên chưa thể mặc trang bị.</p>)}

        {tab === 'up' &&
          (o ? (
            <>
              <div class="up-row">
                <div class="up-info">
                  <b>Cấp {level} → {Math.min(cap, level + 1)}</b>
                  {level >= cap ? (
                    <small>Đã đạt cấp tối đa của {star} sao. Hãy lên sao để mở thêm.</small>
                  ) : (
                    <span class="cost">
                      <span class={w.gold >= lvCost.gold ? '' : 'lack'}><Icon n="gold" size={16} />{fmt(lvCost.gold)}</span>
                      <span class={w.exp >= lvCost.exp ? '' : 'lack'}><Icon n="exp" size={16} />{fmt(lvCost.exp)}</span>
                    </span>
                  )}
                </div>
              </div>
              <div class="up-row">
                <div class="up-info">
                  <b>Sao {star}{stCost !== null ? ` → ${star + 1}` : ''}</b>
                  {stCost === null ? (
                    <small>Đã đạt {MAX_STAR} sao.</small>
                  ) : (
                    <div class="shard-bar"><i style={{ width: `${Math.min(100, (o.shards * 100) / stCost)}%` }} /><span>{o.shards}/{stCost} mảnh</span></div>
                  )}
                </div>
              </div>
              <small class="muted">Lực chiến hiện tại: {fmt(powerOfOwned(o))}. Quay trùng tướng sẽ đổi ra mảnh. Nút nâng cấp nằm ngay bên dưới.</small>
            </>
          ) : (
            <p class="muted">Bạn chưa sở hữu tướng này. Hãy thử vận may ở màn Triệu hồi!</p>
          ))}
      </div>

      <div class="d-actions">
        {o ? (
          <>
            <Btn kind="green" disabled={!canLv} onClick={() => levelUp(1)}>
              <span class="act-t">Lên cấp</span>
              <span class="act-s">
                {level < cap ? (
                  <>
                    <Icon n="gold" size={14} />{fmt(lvCost.gold)} <Icon n="exp" size={14} />{fmt(lvCost.exp)}
                  </>
                ) : (
                  'Đã tối đa'
                )}
              </span>
            </Btn>
            <Btn kind="green" disabled={plan.n < 2} onClick={() => levelUp(plan.n)}>
              <span class="act-t">{plan.n > 1 ? `Lên +${plan.n}` : 'Lên nhiều'}</span>
              <span class="act-s">
                {plan.n > 1 ? (
                  <>
                    <Icon n="gold" size={14} />{fmt(plan.gold)} <Icon n="exp" size={14} />{fmt(plan.exp)}
                  </>
                ) : (
                  'Nâng nhiều cấp'
                )}
              </span>
            </Btn>
            <Btn kind="purple" disabled={!canSt} onClick={starUp}>
              <span class="act-t">Lên sao</span>
              <span class="act-s">{stCost === null ? 'Đã tối đa' : `${o.shards}/${stCost} mảnh`}</span>
            </Btn>
          </>
        ) : (
          <Btn kind="purple" onClick={() => go({ n: 'summon' })}>Chưa sở hữu · Đến Triệu hồi</Btn>
        )}
      </div>
    </section>
  );
}

export function Heroes({ initial }: { initial?: string }) {
  const m = me.value!;
  const owned = ownedMap(m);
  // chia đôi màn hình chỉ khi đủ rộng VÀ đủ cao; màn thấp (điện thoại ngang) dùng bảng chi tiết toàn màn
  const wide = useMedia('(min-aspect-ratio: 6/5) and (min-width: 640px) and (min-height: 521px)');
  const [f, setF] = useState<HeroFilter>(EMPTY_FILTER);
  const [sel, setSel] = useState<string | null>(initial ?? null);
  const [open, setOpen] = useState(!!initial);

  const list = useMemo(
    () =>
      applyFilter(
        HEROES.map((def) => ({ def, o: owned.get(def.id) })).filter((e) => f.all || e.o),
        f,
      ).map((e) => e.def),
    // eslint-disable-next-line
    [f, m.heroes, m.gear],
  );

  // đang xem tướng chưa có mà tắt "hiện tướng chưa có" thì chuyển về tướng đầu danh sách
  const cur = sel && list.some((h) => h.id === sel) ? sel : (list[0]?.id ?? null);
  // mũi tên đổi tướng (xoay vòng trong danh sách đang lọc)
  const idx = list.findIndex((h) => h.id === cur);
  const step = (d: -1 | 1) => {
    if (list.length > 1 && idx >= 0) setSel(list[(idx + d + list.length) % list.length].id);
  };
  const pos = list.length > 1 && idx >= 0 ? `${idx + 1}/${list.length}` : undefined;
  const onStep = list.length > 1 ? step : undefined;

  const grid = (
    <div class="hlist">
      <FilterBar f={f} setF={setF} unownedToggle>
        Đã sở hữu {m.heroes.length}/{HEROES.length}
      </FilterBar>
      <div class="fade-wrap">
        <div class="hgrid scroll">
          {list.map((h) => (
            <HeroCard
              key={h.id}
              def={h}
              owned={owned.get(h.id)}
              dim={!owned.has(h.id)}
              selected={wide && cur === h.id}
              onClick={() => {
                setSel(h.id);
                setOpen(true);
              }}
            />
          ))}
          {list.length === 0 && <p class="muted empty">Không có tướng phù hợp bộ lọc.</p>}
          {!f.all && list.length > 0 && m.heroes.length < HEROES.length && (
            <button type="button" class="more-unowned" onClick={() => setF({ ...f, all: true })}>
              Xem {HEROES.length - m.heroes.length} tướng chưa có
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (wide) {
    return (
      <div class="split">
        {grid}
        {cur ? <HeroDetail id={cur} onStep={onStep} pos={pos} /> : null}
      </div>
    );
  }
  return (
    <div class="single">
      {grid}
      {open && cur && (
        <div class="sheet">
          <HeroDetail id={cur} onClose={() => setOpen(false)} onStep={onStep} pos={pos} />
        </div>
      )}
    </div>
  );
}
