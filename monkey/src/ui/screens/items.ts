// Hiển thị đồ đạc / phần thưởng dùng chung (hành trang, paperdoll, thương nhân, tổng kết, ải, sự kiện).

import { CLASSES } from '@shared/monkey/content';
import type { Reward } from '@shared/monkey/progression';
import { clampGrade, defOf, dropInst, gradeColor, gradeName, itemName, type Inv } from '../../gearlib';
import { h } from '../dom';
import { itemSvg } from '../icons';
import { bindTip, itemTip } from '../tooltip';

export const CUR = { gold: '🪙', shards: '🧩', books: '📘', xp: '✨' } as const;

/** màu phẩm (tên cũ — vẫn dùng ở vài màn) */
export function rarityColor(r: number) {
  return gradeColor(r);
}
export { itemName };

/** phần tử đồ (.it) — đặt trong .cell */
export function itemEl(it: Inv, opts: { equipped?: boolean; sel?: boolean; cls?: string } = {}) {
  const def = defOf(it.itemId);
  const el = h('div', {
    class: `it g${it.grade}${opts.sel ? ' sel' : ''}${opts.cls ? ` ${opts.cls}` : ''}`,
    style: `--gc:${gradeColor(it.grade)}`,
    'data-uid': String(it.uid),
  });
  el.innerHTML = itemSvg(def); // SVG tự vẽ trong icons.ts (không có dữ liệu người dùng)
  if (it.level > 1) el.append(h('i', { class: 'lv' }, `+${it.level - 1}`));
  if (it.count > 1) el.append(h('i', { class: 'cnt' }, it.count));
  if (opts.equipped) el.append(h('i', { class: 'eqm' }, 'E'));
  return el;
}

/** ô có đồ, kèm tooltip; size: '', 'big', 'sm' */
export function itemCell(it: Inv, opts: { size?: '' | 'big' | 'sm'; onclick?: () => void; tip?: boolean; cls?: string } = {}) {
  const cell = h(opts.onclick ? 'button' : 'div', { class: `cell${opts.size ? ` ${opts.size}` : ''}${opts.cls ? ` ${opts.cls}` : ''}`, onclick: opts.onclick });
  const el = itemEl(it);
  el.style.cursor = opts.onclick ? 'pointer' : 'default';
  cell.append(el);
  if (opts.tip !== false) bindTip(el, () => itemTip(it));
  return cell;
}

/** ô từ itemId + phẩm (thưởng, bảng rớt) */
export function itemTile(itemId: string, grade: number, opts: { size?: '' | 'big' | 'sm'; count?: number; level?: number; cls?: string } = {}) {
  return itemCell(dropInst({ itemId, grade, count: opts.count, level: opts.level }), { size: opts.size ?? 'sm', cls: opts.cls });
}

/** phần thưởng dạng chip: 🪙 500 · 📘 1 · [ô đồ] */
export function rewardChips(r: Reward | null | undefined, opts: { tiles?: boolean } = {}) {
  const box = h('div', { class: 'rwd' });
  if (!r) return box;
  if (r.gold) box.append(h('span', { class: 'chip gold' }, `${CUR.gold} ${r.gold.toLocaleString('vi-VN')}`));
  if (r.xp) box.append(h('span', { class: 'chip xp' }, `${CUR.xp} ${r.xp} XP`));
  if (r.shards) box.append(h('span', { class: 'chip' }, `${CUR.shards} ${r.shards}`));
  if (r.books) box.append(h('span', { class: 'chip' }, `${CUR.books} ${r.books}`));
  if (r.unlockChar !== undefined && CLASSES[r.unlockChar]) box.append(h('span', { class: 'chip char' }, `🔓 ${CLASSES[r.unlockChar].name}`));
  for (const raw of (r.items ?? []) as { itemId: string; grade?: number; rarity?: number; count?: number }[]) {
    const g = clampGrade(raw.grade ?? raw.rarity ?? 0);
    if (opts.tiles !== false) box.append(itemTile(raw.itemId, g, { size: 'sm', count: raw.count }));
    else box.append(h('span', { class: 'chip', style: `color:${gradeColor(g)}` }, `${itemName(raw.itemId)} (${gradeName(g)})`));
  }
  return box;
}
