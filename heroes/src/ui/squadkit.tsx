// Bộ xếp đội hình dùng chung (màn Đội hình đầy đủ + bảng chuẩn bị trận dạng gọn):
// logic chạm-ô-rồi-chạm-tướng, kéo thả (dnd.ts), bàn cờ 2 hàng trước / 3 hàng sau, danh sách tướng chọn.
import { useState } from 'preact/hooks';
import { FRONT_SLOTS, SQUAD_SIZE } from '@shared/heroes/config';
import type { MeResponse } from '@shared/heroes/api';
import type { OwnedHero } from '@shared/heroes/types';
import { defOf, ownedMap, powerOfOwned } from '../game';
import { toast } from '../state';
import { dragStart } from './dnd';
import { HeroCard } from './common';
import { Icon } from './icons';

export function pad(a: string[] | undefined): string[] {
  const r = (a ?? []).slice(0, SQUAD_SIZE);
  while (r.length < SQUAD_SIZE) r.push('');
  return r;
}

/** dữ liệu mang theo khi kéo: from = chỉ số ô nguồn, -1 nếu kéo từ danh sách tướng */
export interface DragData {
  id: string;
  from: number;
}

/** thả `d` vào `target` ("slot:N" | "roster"); null = không đổi gì */
export function applyDrop(slots: string[], d: DragData, target: string | null): string[] | null {
  const s = slots.slice();
  if (target?.startsWith('slot:')) {
    const j = Number(target.slice(5));
    if (!(j >= 0 && j < SQUAD_SIZE)) return null;
    if (d.from >= 0) {
      if (d.from === j) return null;
      [s[d.from], s[j]] = [s[j], s[d.from]]; // kéo giữa hai ô = hoán đổi
    } else {
      const k = s.indexOf(d.id);
      const prev = s[j];
      if (k >= 0) s[k] = prev; // tướng đã ở ô khác => hoán đổi
      s[j] = d.id;
    }
    return s;
  }
  if (target === 'roster' && d.from >= 0) {
    s[d.from] = ''; // thả về danh sách = gỡ khỏi đội
    return s;
  }
  return null;
}

/** "Tự xếp mạnh nhất": 5 tướng lực chiến cao nhất; tanker/chiến binh ra hàng trước */
export function autoSquad(m: MeResponse): string[] {
  const top = m.heroes.slice().sort((a, b) => powerOfOwned(b) - powerOfOwned(a)).slice(0, SQUAD_SIZE);
  const frontPref = (o: OwnedHero) => (defOf(o.id).role === 'tank' ? 0 : defOf(o.id).role === 'warrior' ? 1 : 2);
  const sorted = top.slice().sort((a, b) => frontPref(a) - frontPref(b) || powerOfOwned(b) - powerOfOwned(a));
  return pad(sorted.map((o) => o.id));
}

/** trạng thái thao tác: ô đang chọn + chạm ô / chạm tướng / thả */
export function useSquadOps(slots: string[], setSlots: (s: string[]) => void, opts?: { initialSel?: number | null; closeWhenFull?: boolean }) {
  const [sel, setSel] = useState<number | null>(opts?.initialSel ?? null);

  const tapSlot = (i: number) => setSel(sel === i ? null : i);

  const tapHero = (id: string) => {
    const s = slots.slice();
    const at = s.indexOf(id);
    if (sel !== null && at === sel) {
      s[sel] = ''; // chạm lại tướng đang ở ô chọn => gỡ
      setSlots(s);
      return;
    }
    if (sel !== null) {
      const prev = s[sel];
      if (at >= 0) s[at] = prev; // hoán đổi với ô đang chứa tướng đó
      s[sel] = id;
      const nxt = s.findIndex((v, k) => !v && k !== sel);
      setSlots(s);
      setSel(nxt >= 0 ? nxt : opts?.closeWhenFull ? null : sel);
      return;
    }
    if (at >= 0) {
      s[at] = '';
    } else {
      const free = s.indexOf('');
      if (free < 0) return toast('Đội đã đầy, hãy chạm một ô để thay', 'info');
      s[free] = id;
    }
    setSlots(s);
  };

  const drop = (d: DragData, target: string | null) => {
    const r = applyDrop(slots, d, target);
    if (r) setSlots(r);
  };

  return { sel, setSel, tapSlot, tapHero, drop };
}

function Slot({ i, id, o, sel, onTap, onDrop }: { i: number; id: string; o?: OwnedHero; sel: boolean; onTap: () => void; onDrop: (d: DragData, t: string | null) => void }) {
  const d = id ? defOf(id) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      data-drop={`slot:${i}`}
      class={`slot${sel ? ' sel' : ''}${d ? ` r-${d.rarity} filled drag-h` : ' empty'}`}
      onClick={onTap}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onTap())}
      onPointerDown={d ? dragStart<DragData>({ payload: () => ({ id, from: i }), onDrop, instant: true }) : undefined}
      aria-label={d ? `Ô ${i + 1}: ${d.name}` : `Ô ${i + 1} trống`}
    >
      {d ? (
        <HeroCard def={d} owned={o} mini />
      ) : (
        <span class="slot-plus">
          <Icon n="plus" size={26} />
        </span>
      )}
      <span class="slot-n">{i + 1}</span>
    </div>
  );
}

/** bàn cờ: hàng trước (2 ô) + hàng sau (3 ô), nhãn rõ ràng. `compact` = gộp 5 ô trên một dòng */
export function SquadBoard(p: {
  m: MeResponse;
  slots: string[];
  sel: number | null;
  onTapSlot: (i: number) => void;
  onDrop: (d: DragData, target: string | null) => void;
  compact?: boolean;
}) {
  const owned = ownedMap(p.m);
  const el = (i: number) => <Slot key={i} i={i} id={p.slots[i]} o={owned.get(p.slots[i])} sel={p.sel === i} onTap={() => p.onTapSlot(i)} onDrop={p.onDrop} />;
  return (
    <div class={`board${p.compact ? ' compact' : ''}`}>
      <div class="b-row front">
        <small class="row-label">Hàng trước<span class="l-long"> · chịu đòn</span></small>
        <div class="slots">{Array.from({ length: FRONT_SLOTS }, (_, i) => el(i))}</div>
      </div>
      <div class="b-row back">
        <small class="row-label">Hàng sau<span class="l-long"> · ít bị đánh</span></small>
        <div class="slots">{Array.from({ length: SQUAD_SIZE - FRONT_SLOTS }, (_, i) => el(FRONT_SLOTS + i))}</div>
      </div>
    </div>
  );
}

/** danh sách tướng để chọn/kéo; là vùng thả "roster" (thả tướng từ ô vào đây = gỡ khỏi đội) */
export function Roster(p: { heroes: OwnedHero[]; slots: string[]; onTap: (id: string) => void; onDrop: (d: DragData, target: string | null) => void; compact?: boolean }) {
  return (
    <div class="fade-wrap">
      <div class={`hgrid scroll${p.compact ? ' compact mini-grid' : ' compact'}`} data-drop="roster">
        {p.heroes.map((o) => {
          const d = defOf(o.id);
          const inSquad = p.slots.includes(o.id);
          return (
            <div key={o.id} class="rcard drag-y" onPointerDown={dragStart<DragData>({ payload: () => ({ id: o.id, from: -1 }), onDrop: p.onDrop })}>
              <HeroCard
                def={d}
                owned={o}
                selected={inSquad}
                badge={inSquad ? <span class="in-squad"><Icon n="check" size={14} /></span> : undefined}
                onClick={() => p.onTap(o.id)}
              />
            </div>
          );
        })}
        {p.heroes.length === 0 && <p class="muted empty">Không có tướng phù hợp.</p>}
      </div>
    </div>
  );
}
