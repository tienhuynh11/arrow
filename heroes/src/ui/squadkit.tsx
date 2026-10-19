// Bộ xếp đội hình dùng chung (màn Đội hình đầy đủ + bảng chuẩn bị trận dạng gọn):
// logic chạm-ô-rồi-chạm-tướng, kéo thả (dnd.ts), bàn cờ 6 ô / 3 hàng (Trước, Giữa, Sau), ô khoá theo cấp, danh sách tướng chọn.
import { useState } from 'preact/hooks';
import { ROW_NAME, SQUAD_SIZE, rowOfSlot } from '@shared/heroes/config';
import { SLOT_GEMS, SLOT_LEVEL } from '@shared/heroes/progression';
import { MONSTERS } from '@shared/heroes/stages';
import type { MeResponse } from '@shared/heroes/api';
import type { OwnedHero } from '@shared/heroes/types';
import { api } from '../api';
import { defOf, ownedMap, powerOfOwned, slotsOpenOf } from '../game';
import { fmt, toast, uuid, useBusy } from '../state';
import { Btn, HeroCard, Modal, Portrait } from './common';
import { dragStart } from './dnd';
import { Icon } from './icons';

export function pad(a: string[] | undefined): string[] {
  const r = (a ?? []).slice(0, SQUAD_SIZE);
  while (r.length < SQUAD_SIZE) r.push('');
  return r;
}

/** đội đủ 6 phần tử, ô còn khoá luôn là '' (server từ chối nếu ô khoá có tướng) */
export function fitSquad(m: MeResponse, a: string[] | undefined): string[] {
  const open = slotsOpenOf(m);
  return pad(a).map((id, i) => (i < open ? id : ''));
}

/** dữ liệu mang theo khi kéo: from = chỉ số ô nguồn, -1 nếu kéo từ danh sách tướng */
export interface DragData {
  id: string;
  from: number;
}

/** thả `d` vào `target` ("slot:N" | "roster"); null = không đổi gì. Ô ≥ open (đang khoá) bị bỏ qua. */
export function applyDrop(slots: string[], d: DragData, target: string | null, open: number = SQUAD_SIZE): string[] | null {
  const s = slots.slice();
  if (target?.startsWith('slot:')) {
    const j = Number(target.slice(5));
    if (!(j >= 0 && j < open)) return null;
    if (d.from >= 0) {
      if (d.from === j || d.from >= open) return null;
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

/** "Tự xếp mạnh nhất": chỉ điền các ô ĐANG MỞ, mạnh nhất trước; tanker/chiến binh ra hàng trước, pháp sư/y sĩ/cung thủ ra hàng sau */
export function autoSquad(m: MeResponse): string[] {
  const open = slotsOpenOf(m);
  const top = m.heroes.slice().sort((a, b) => powerOfOwned(b) - powerOfOwned(a)).slice(0, open);
  const pref = (o: OwnedHero) => {
    const r = defOf(o.id).role;
    return r === 'tank' ? 0 : r === 'warrior' ? 1 : r === 'archer' ? 2 : r === 'support' ? 3 : 4; // mage/healer ra sau cùng
  };
  const sorted = top.slice().sort((a, b) => pref(a) - pref(b) || powerOfOwned(b) - powerOfOwned(a));
  return fitSquad(m, sorted.map((o) => o.id));
}

/** trạng thái thao tác: ô đang chọn + chạm ô / chạm tướng / thả. `open` = số ô đang mở (mặc định 6) */
export function useSquadOps(slots: string[], setSlots: (s: string[]) => void, opts?: { initialSel?: number | null; closeWhenFull?: boolean; open?: number }) {
  const [sel, setSel] = useState<number | null>(opts?.initialSel ?? null);
  const open = opts?.open ?? SQUAD_SIZE;

  const tapSlot = (i: number) => {
    if (i >= open) return; // ô khoá không chọn được
    setSel(sel === i ? null : i);
  };

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
      const nxt = s.findIndex((v, k) => !v && k !== sel && k < open);
      setSlots(s);
      setSel(nxt >= 0 ? nxt : opts?.closeWhenFull ? null : sel);
      return;
    }
    if (at >= 0) {
      s[at] = '';
    } else {
      const free = s.findIndex((v, k) => !v && k < open);
      if (free < 0) return toast('Đội đã đầy, hãy chạm một ô để thay', 'info');
      s[free] = id;
    }
    setSlots(s);
  };

  const drop = (d: DragData, target: string | null) => {
    const r = applyDrop(slots, d, target, open);
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

/** ô đang khoá: KHÔNG có data-drop (kéo thả bỏ qua). Ô kế tiếp chạm được để mua sớm bằng kim cương. */
function LockedSlot({ i, next, onTap }: { i: number; next: boolean; onTap: () => void }) {
  return (
    <button type="button" class={`slot sq6-lock${next ? ' next' : ''}`} onClick={onTap} aria-label={`Ô ${i + 1} đang khoá, mở ở cấp ${SLOT_LEVEL[i]}`}>
      <Icon n="lock" size={20} />
      <span class="sq6-lv">Cấp {SLOT_LEVEL[i]}</span>
      <span class="sq6-lvl">Mở ở cấp {SLOT_LEVEL[i]}</span>
      {next && <Icon n="gem" size={14} />}
    </button>
  );
}

/** hộp xác nhận mở ô bằng kim cương */
function UnlockModal({ m, slot, onClose }: { m: MeResponse; slot: number; onClose: () => void }) {
  const [busy, run] = useBusy();
  const cost = SLOT_GEMS[slot] ?? 0;
  const short = m.wallet.gems < cost;
  const go = () =>
    run(async () => {
      await api.slotUnlock(slot, uuid());
      toast(`Đã mở ô ${slot + 1}`, 'ok');
      onClose();
    });
  return (
    <Modal title={`Mở ô ${slot + 1} (${ROW_NAME[rowOfSlot(slot)]})`} onClose={onClose}>
      <p>
        Ô này sẽ tự mở ở cấp {SLOT_LEVEL[slot]}. Mở sớm tốn <b>{fmt(cost)}</b> <Icon n="gem" size={16} /> kim cương.
      </p>
      <p class={short ? 'sq6-short' : 'muted'}>Bạn đang có {fmt(m.wallet.gems)} kim cương{short ? ` (thiếu ${fmt(cost - m.wallet.gems)})` : ''}.</p>
      <div class="btn-row">
        <Btn kind="ghost" small onClick={onClose}>Để sau</Btn>
        <Btn kind={short ? 'red' : 'green'} busy={busy} disabled={short} onClick={() => void go()}>
          <Icon n="gem" size={18} /> Mở bằng {fmt(cost)} kim cương
        </Btn>
      </div>
    </Modal>
  );
}

/** bàn cờ 6 ô / 3 hàng (Trước, Giữa, Sau; mỗi hàng 2 ô, so le). `compact` = gộp một dòng cho điện thoại / dải nhỏ. Ô khoá hiện ổ khoá. */
export function SquadBoard(p: {
  m: MeResponse;
  slots: string[];
  sel: number | null;
  onTapSlot: (i: number) => void;
  onDrop: (d: DragData, target: string | null) => void;
  compact?: boolean;
}) {
  const owned = ownedMap(p.m);
  const open = slotsOpenOf(p.m);
  const [buy, setBuy] = useState<number | null>(null);
  const lockTap = (i: number) => {
    if (i === open) setBuy(i);
    else toast(`Ô ${i + 1} mở ở cấp ${SLOT_LEVEL[i]} (cần mở ô ${open + 1} trước)`, 'info');
  };
  const el = (i: number) =>
    i < open ? (
      <Slot key={i} i={i} id={p.slots[i]} o={owned.get(p.slots[i])} sel={p.sel === i} onTap={() => p.onTapSlot(i)} onDrop={p.onDrop} />
    ) : (
      <LockedSlot key={i} i={i} next={i === open} onTap={() => lockTap(i)} />
    );
  const nextCost = open < SQUAD_SIZE ? SLOT_GEMS[open] : 0;
  return (
    <div class={`sq6-wrap${p.compact ? ' compact' : ''}`}>
      <div class={`sq6-board${p.compact ? ' compact' : ''}`}>
        {[0, 1, 2].map((r) => (
          <div key={r} class={`sq6-row r${r}`}>
            <small class="row-label">
              <span class="l-long">{ROW_NAME[r]}</span>
              <span class="l-short">{ROW_NAME[r].replace('Hàng ', '')}</span>
            </small>
            <div class="sq6-slots">{[r * 2, r * 2 + 1].map(el)}</div>
          </div>
        ))}
      </div>
      {open < SQUAD_SIZE && !p.compact && (
        <button type="button" class={`sq6-buy${p.m.wallet.gems < nextCost ? ' short' : ''}`} onClick={() => setBuy(open)}>
          <Icon n="lock" size={16} /> Ô {open + 1}: cấp {SLOT_LEVEL[open]} · Mở bằng {fmt(nextCost)} <Icon n="gem" size={16} /> kim cương
        </button>
      )}
      {buy !== null && <UnlockModal m={p.m} slot={buy} onClose={() => setBuy(null)} />}
    </div>
  );
}

/** xem trước đội địch: MỘT đợt, tối đa 6 chân dung xếp theo hàng như bàn cờ; `boss` = ruy băng BOSS + vương miện */
export function EnemyLineup({ ids, boss }: { ids: string[]; boss?: boolean }) {
  const mName = (k: string) => MONSTERS.find((x) => x.id === k)?.name ?? k;
  return (
    <div class={`sq6-enemy${boss ? ' is-boss' : ''}`}>
      {boss && (
        <div class="sq6-ribbon">
          <Icon n="crown" size={16} /> BOSS
        </div>
      )}
      <div class="sq6-en-rows">
        {[0, 1, 2].map((r) => {
          const row = ids.slice(r * 2, r * 2 + 2);
          if (!row.length) return null;
          return (
            <div key={r} class={`sq6-row r${r}`}>
              <small class="row-label">{ROW_NAME[r].replace('Hàng ', '')}</small>
              <div class="sq6-slots">
                {row.map((k, j) => {
                  const big = !!MONSTERS.find((x) => x.id === k)?.boss;
                  return (
                    <div key={j} class={`sq6-mon${big ? ' boss' : ''}`} title={mName(k)}>
                      <Portrait id={k} rarity="R" />
                      {big && <span class="sq6-crown"><Icon n="crown" size={14} /></span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
