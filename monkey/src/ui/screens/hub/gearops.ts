// Thao tác đồ dùng chung giữa paperdoll, hành trang, kho, thương nhân: mặc / tháo / cất kho / bán (gọi REST + thông báo).

import type { EquipSlot } from '@shared/monkey/gear';
import { api } from '../../../api';
import { SLOT_NAME, bestSlotFor, defOf, levelReqOf, placeAt, preferCell, sellPrice, slotAccepts, type Inv } from '../../../gearlib';
import { fmt, toast } from '../../dom';
import type { DragSrc } from '../../dnd';
import { act } from '../actions';
import { confirmBox } from '../ctx';

export async function doEquip(it: Inv, slot?: EquipSlot | null) {
  const me = api.me;
  const def = defOf(it.itemId);
  if (!def) return false;
  const s = slot ?? bestSlotFor(me, it);
  if (!s) {
    toast(def.kind === 'material' ? 'Nguyên liệu chỉ cất trong hành trang / Túi an toàn' : 'Không có ô phù hợp');
    return false;
  }
  if (s !== 'secure' && !slotAccepts(s, def)) {
    toast(`${def.name} không đặt vào ô ${SLOT_NAME[s]} được`);
    return false;
  }
  const req = levelReqOf(it);
  if (s !== 'secure' && me && req > me.profile.level) {
    toast(`Cần đạt cấp ${req} để dùng ${def.name}`);
    return false;
  }
  return act(api.equip(it.uid, s), s === 'secure' ? `🔒 Đã cất ${def.name} vào Túi an toàn` : undefined);
}

export function doUnequip(slot: EquipSlot, prefer?: { which: 'bag' | 'stash'; cell: number }, uid?: number) {
  if (prefer && uid !== undefined) preferCell(prefer.which, uid, prefer.cell);
  return act(api.unequip(slot));
}

export function doStash(it: Inv, stash: boolean, cell?: number) {
  if (cell !== undefined) preferCell(stash ? 'stash' : 'bag', it.uid, cell);
  return act(api.stash(it.uid, stash), stash ? 'Đã cất vào kho' : 'Đã lấy ra hành trang');
}

export function doSell(list: Inv[], after?: () => void) {
  const items = list.filter((i) => !i.slot);
  if (!items.length) return;
  const gold = items.reduce((a, i) => a + sellPrice(i), 0);
  const hi = items.some((i) => i.grade >= 2);
  const go = async () => { if (await act(api.sell(items.map((i) => i.uid)), `+${fmt(gold)} ngân lượng`)) after?.(); };
  if (hi || items.length > 1) {
    confirmBox('Bán đồ?', `Bán ${items.length} món${hi ? ' (có đồ phẩm Tím trở lên!)' : ''} lấy ${fmt(gold)} ngân lượng. Không hoàn tác được.`, 'BÁN', go, true);
  } else go();
}

/* ---------- đích thả ---------- */
export function equipDropOk(slot: EquipSlot, s: DragSrc) {
  if (s.from === 'equip' && s.slot === slot) return false;
  const def = defOf(s.it.itemId);
  if (!def) return false;
  return slot === 'secure' || slotAccepts(slot, def);
}
export function onEquipDrop(slot: EquipSlot, s: DragSrc) {
  void doEquip(s.it, slot);
}

/** thả vào ô lưới hành trang / kho; occupant = món đang nằm ở ô đó */
export function gridDrop(which: 'bag' | 'stash', cell: number, occupant: Inv | null, s: DragSrc, redraw: () => void) {
  if (s.from === which) {
    placeAt(which, s.it.uid, cell, occupant?.uid ?? null);
    redraw();
    return;
  }
  if (s.from === 'equip' && s.slot) {
    if (which === 'stash') {
      // tháo rồi cất kho
      preferCell('stash', s.it.uid, cell);
      void act(api.unequip(s.slot)).then((ok) => { if (ok) void act(api.stash(s.it.uid, true)); });
    } else void doUnequip(s.slot, { which, cell }, s.it.uid);
    return;
  }
  void doStash(s.it, which === 'stash', cell);
}
