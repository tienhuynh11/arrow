// Thanh lọc gọn dùng chung: ô tìm kiếm + nút "Lọc" (mở popover chọn hệ/vai trò/phẩm) + sắp xếp.
// Mặc định đóng để lưới tướng có tối đa chỗ. Không có thao tác nào chỉ dùng được khi hover.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { powerOfOwned } from '../game';
import { ELEMENT_NAME, ELEMENTS, RARITIES, RARITY_RANK, ROLE_NAME, ROLES, type Element, type HeroDef, type OwnedHero, type Rarity, type Role } from '@shared/heroes/types';
import { ELEM_ICON, Icon, ROLE_ICON } from './icons';

export type SortKey = 'rarity' | 'level' | 'power';
export interface HeroFilter {
  q: string;
  el: Element | null;
  role: Role | null;
  rar: Rarity | null;
  sort: SortKey;
  /** hiện cả tướng chưa sở hữu (mặc định chỉ hiện tướng đã có) */
  all: boolean;
}
export const EMPTY_FILTER: HeroFilter = { q: '', el: null, role: null, rar: null, sort: 'rarity', all: false };

export interface Entry {
  def: HeroDef;
  o?: OwnedHero;
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const powerOfEntry = (e: Entry) => (e.o ? powerOfOwned(e.o) : 0);

/** lọc + sắp xếp (tướng đã sở hữu luôn đứng trước) */
export function applyFilter(list: Entry[], f: HeroFilter): Entry[] {
  const q = plain(f.q.trim());
  const out = list.filter(
    (e) => (!f.el || e.def.element === f.el) && (!f.role || e.def.role === f.role) && (!f.rar || e.def.rarity === f.rar) && (!q || plain(e.def.name).includes(q)),
  );
  const cmp = (a: Entry, b: Entry) => {
    if (!!a.o !== !!b.o) return a.o ? -1 : 1;
    const rar = RARITY_RANK[b.def.rarity] - RARITY_RANK[a.def.rarity];
    const pw = powerOfEntry(b) - powerOfEntry(a);
    if (f.sort === 'level') return (b.o?.level ?? 0) - (a.o?.level ?? 0) || rar || pw;
    if (f.sort === 'power') return pw || rar;
    return rar || pw;
  };
  return out.sort(cmp);
}

export function activeFilters(f: HeroFilter): number {
  return (f.el ? 1 : 0) + (f.role ? 1 : 0) + (f.rar ? 1 : 0);
}

function ChipGroup<T extends string>({ label, cur, items, onPick, render }: { label: string; cur: T | null; items: readonly T[]; onPick: (v: T | null) => void; render: (v: T) => ComponentChildren }) {
  return (
    <div class="fp-group">
      <span class="fp-label">{label}</span>
      <div class="fp-chips">
        {items.map((v) => (
          <button type="button" key={v} class={`fchip sq${cur === v ? ' on' : ''}`} onClick={() => onPick(cur === v ? null : v)} aria-pressed={cur === v} aria-label={String(v)}>
            {render(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterBar({ f, setF, children, unownedToggle }: { f: HeroFilter; setF: (f: HeroFilter) => void; children?: ComponentChildren; unownedToggle?: boolean }) {
  const [open, setOpen] = useState(false);
  const n = activeFilters(f);
  const set = (p: Partial<HeroFilter>) => setF({ ...f, ...p });
  return (
    <div class="fbar-wrap">
      <div class="fbar">
        <label class="fsearch">
          <Icon n="search" size={20} />
          <input type="search" value={f.q} placeholder="Tìm tướng..." onInput={(e) => set({ q: (e.target as HTMLInputElement).value })} aria-label="Tìm tướng theo tên" />
          {f.q && (
            <button type="button" class="fclear" aria-label="Xoá tìm kiếm" onClick={() => set({ q: '' })}>
              <Icon n="close" size={16} />
            </button>
          )}
        </label>
        <button type="button" class={`btn ghost small fbtn${n ? ' active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon n="filter" size={18} /> Lọc
          {n > 0 && <i class="fbadge">{n}</i>}
        </button>
        <select class="fsort" value={f.sort} onChange={(e) => set({ sort: (e.target as HTMLSelectElement).value as SortKey })} aria-label="Sắp xếp">
          <option value="rarity">Phẩm</option>
          <option value="level">Cấp</option>
          <option value="power">Lực chiến</option>
        </select>
        {unownedToggle && (
          <label class="fcheck">
            <input type="checkbox" checked={f.all} onChange={(e) => set({ all: (e.target as HTMLInputElement).checked })} />
            <span>Tướng chưa sở hữu</span>
          </label>
        )}
        {children && <span class="fcount">{children}</span>}
      </div>
      {open && (
        <>
          <div class="fpop-back" onPointerDown={() => setOpen(false)} />
          <div class="fpop" role="dialog" aria-label="Bộ lọc">
            <ChipGroup label={`Hệ${f.el ? `: ${ELEMENT_NAME[f.el]}` : ''}`} cur={f.el} items={ELEMENTS} onPick={(v) => set({ el: v })} render={(v) => <Icon n={ELEM_ICON[v]} size={22} />} />
            <ChipGroup label={`Vai trò${f.role ? `: ${ROLE_NAME[f.role]}` : ''}`} cur={f.role} items={ROLES} onPick={(v) => set({ role: v })} render={(v) => <Icon n={ROLE_ICON[v]} size={22} />} />
            <ChipGroup label={`Phẩm${f.rar ? `: ${f.rar}` : ''}`} cur={f.rar} items={RARITIES} onPick={(v) => set({ rar: v })} render={(v) => <b class={`rtxt r-${v}`}>{v}</b>} />
            <div class="fp-foot">
              <button type="button" class="btn ghost small" disabled={n === 0} onClick={() => set({ el: null, role: null, rar: null })}>
                Xoá lọc
              </button>
              <button type="button" class="btn green small" onClick={() => setOpen(false)}>
                Xong
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
