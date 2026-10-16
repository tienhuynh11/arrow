// Hiển thị đồ đạc / phần thưởng dùng chung (kho đồ, màn thắng, ải, sự kiện, admin).

import { CLASSES } from '@shared/monkey/content';
import { ITEM_BY_ID, RARITY, STAT_INFO, itemStats, type ItemInst, type Rarity, type Reward, type StatKey, type Stats } from '@shared/monkey/progression';
import { h } from '../dom';
import { itemSvg } from '../icons';

export const CUR = { gold: '🪙', shards: '🧩', books: '📘', xp: '✨' } as const;

export function rarityColor(r: number) {
  return RARITY[Math.max(0, Math.min(3, r))].color;
}

/** định dạng một chỉ số: +12% / +30 */
export function fmtStat(k: StatKey, v: number) {
  const info = STAT_INFO[k];
  if (info.pct) {
    const p = v * 100;
    return `+${p >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`;
  }
  return `+${Math.round(v)}`;
}

/** ô đồ vuông có khung độ hiếm */
export function itemTile(itemId: string, rarity: Rarity, opts: { level?: number; size?: number; equipped?: boolean; sel?: boolean; cls?: string; onclick?: () => void; title?: string } = {}) {
  const def = ITEM_BY_ID[itemId];
  const el = h(opts.onclick ? 'button' : 'div', {
    class: `itile r${rarity}${opts.equipped ? ' eq' : ''}${opts.sel ? ' sel' : ''}${opts.cls ? ` ${opts.cls}` : ''}`,
    style: `--rc:${rarityColor(rarity)}${opts.size ? `;--sz:${opts.size}px` : ''}`,
    title: opts.title ?? (def ? `${def.name} · ${RARITY[rarity].name}` : itemId),
    onclick: opts.onclick,
  });
  el.innerHTML = itemSvg(def);
  if (opts.level && opts.level > 1) el.append(h('i', { class: 'lv' }, `+${opts.level - 1}`));
  if (opts.equipped) el.append(h('i', { class: 'eqm' }, '✔'));
  return el;
}

export function instTile(it: ItemInst, opts: Parameters<typeof itemTile>[2] = {}) {
  return itemTile(it.itemId, it.rarity, { level: it.level, equipped: it.equipped, ...opts });
}

export function itemName(itemId: string) {
  return ITEM_BY_ID[itemId]?.name ?? itemId;
}

/** danh sách dòng chỉ số; cmp = chỉ số món đang mặc cùng ô để so sánh */
export function statList(st: Stats, cmp?: Stats | null) {
  const keys = new Set<StatKey>([...(Object.keys(st) as StatKey[]), ...(cmp ? (Object.keys(cmp) as StatKey[]) : [])]);
  const box = h('div', { class: 'stl' });
  if (!keys.size) box.append(h('div', { class: 'stl-e' }, 'Chỉ để đẹp — không có chỉ số.'));
  for (const k of keys) {
    const v = st[k] ?? 0;
    const c = cmp ? cmp[k] ?? 0 : null;
    const d = c === null ? 0 : v - c;
    const eps = STAT_INFO[k].pct ? 0.0005 : 0.5;
    box.append(h('div', { class: 'stl-r' },
      h('span', null, STAT_INFO[k].name),
      h('b', null, v ? fmtStat(k, v) : '—'),
      c !== null && Math.abs(d) > eps ? h('em', { class: d > 0 ? 'up' : 'dn' }, `${d > 0 ? '▲' : '▼'} ${fmtStat(k, Math.abs(d)).slice(1)}`) : h('em')));
  }
  return box;
}

export function instStats(it: ItemInst) {
  return itemStats(it);
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
  for (const it of r.items ?? []) {
    if (opts.tiles !== false) box.append(itemTile(it.itemId, it.rarity, { size: 38, cls: 'mini' }));
    else box.append(h('span', { class: 'chip', style: `color:${rarityColor(it.rarity)}` }, `${itemName(it.itemId)} (${RARITY[it.rarity].name})`));
  }
  return box;
}
