// Tab KHO ĐỒ: hàng ô đang mặc + lưới đồ (màu theo độ hiếm, lọc theo ô) + bảng chi tiết (so sánh, Mặc/Tháo/Nâng cấp/Phân rã)
// + chế độ chọn nhiều để phân rã hàng loạt.

import type { MeResponse } from '@shared/monkey/api';
import { ITEM_BY_ID, ITEM_MAX_LEVEL, RARITY, SLOTS, itemStats, salvageValue, upgradeCost, type ItemInst, type Slot } from '@shared/monkey/progression';
import { api } from '../../../api';
import * as A from '../../../audio';
import { clear, fmt, h } from '../../dom';
import { slotGhostSvg } from '../../icons';
import { act } from '../actions';
import { confirmBox } from '../ctx';
import { CUR, instTile, rarityColor, statList } from '../items';

let filter: Slot | 'all' = 'all';
let selUid: number | null = null;
let multi = false;
const picked = new Set<number>();

function sortItems(list: ItemInst[]) {
  const order: Record<Slot, number> = { helmet: 0, armor: 1, gun: 2, knife: 3, skin: 4 };
  return [...list].sort((a, b) => Number(b.equipped) - Number(a.equipped) || b.rarity - a.rarity || b.level - a.level
    || (order[ITEM_BY_ID[a.itemId]?.slot ?? 'skin'] - order[ITEM_BY_ID[b.itemId]?.slot ?? 'skin']) || b.uid - a.uid);
}

export function renderInvTab(body: HTMLElement, me: MeResponse) {
  const items = me.items;
  const bySlot = new Map<Slot, ItemInst>();
  for (const it of items) if (it.equipped) { const d = ITEM_BY_ID[it.itemId]; if (d) bySlot.set(d.slot, it); }
  for (const u of [...picked]) if (!items.some((i) => i.uid === u && !i.equipped)) picked.delete(u);
  if (selUid !== null && !items.some((i) => i.uid === selUid)) selUid = null;
  if (selUid === null) selUid = (bySlot.values().next().value as ItemInst | undefined)?.uid ?? items[0]?.uid ?? null;

  const redraw = () => { clear(body); renderInvTab(body, me); };

  // ---- hàng đang mặc ----
  const eqRow = h('div', { class: 'eqrow' }, ...SLOTS.map((s) => {
    const it = bySlot.get(s.id);
    if (it) return h('div', { class: 'eqs' }, instTile(it, { size: 58, sel: it.uid === selUid && !multi, onclick: () => { multi = false; selUid = it.uid; A.sfxUi(); redraw(); } }), h('span', null, s.name));
    const ghost = h('div', { class: 'itile empty', style: '--sz:58px' });
    ghost.innerHTML = slotGhostSvg(s.id);
    return h('div', { class: 'eqs' }, ghost, h('span', null, s.name));
  }));

  // ---- lọc ----
  const count = (s: Slot | 'all') => items.filter((i) => s === 'all' || ITEM_BY_ID[i.itemId]?.slot === s).length;
  const filters = h('div', { class: 'ifilt' },
    ...[{ id: 'all' as const, icon: '🎒', name: 'Tất cả' }, ...SLOTS].map((s) => h('button', { class: filter === s.id ? 'on' : '', onclick: () => { filter = s.id; A.sfxUi(); redraw(); } }, `${s.icon} ${s.name}`, h('em', null, count(s.id)))),
    h('div', { class: 'grow' }),
    h('button', { class: `msel${multi ? ' on' : ''}`, onclick: () => { multi = !multi; picked.clear(); A.sfxUi(); redraw(); } }, multi ? '✕ Thôi chọn' : '☑ Chọn nhiều'));

  const shown = sortItems(items.filter((i) => filter === 'all' || ITEM_BY_ID[i.itemId]?.slot === filter));
  const grid = h('div', { class: 'igrid' });
  if (!shown.length) grid.append(h('div', { class: 'empty' }, items.length ? 'Không có món nào ở ô này.' : 'Kho trống — vượt ải để nhặt đồ!'));
  for (const it of shown) {
    grid.append(instTile(it, {
      sel: multi ? picked.has(it.uid) : it.uid === selUid,
      cls: multi && it.equipped ? 'dis' : '',
      onclick: () => {
        if (multi) {
          if (it.equipped) return;
          if (picked.has(it.uid)) picked.delete(it.uid);
          else picked.add(it.uid);
        } else selUid = it.uid;
        A.sfxUi();
        redraw();
      },
    }));
  }

  const left = h('div', { class: 'card invl' }, eqRow, filters, grid);
  const right = h('div', { class: 'card invr' });

  if (multi) {
    const list = items.filter((i) => picked.has(i.uid));
    const gold = list.reduce((a, i) => a + salvageValue(i), 0);
    right.append(
      h('h3', { class: 'ittl' }, '♻️ PHÂN RÃ HÀNG LOẠT'),
      h('p', { class: 'idesc' }, 'Bấm vào các món trong kho để chọn. Đồ đang mặc không phân rã được.'),
      h('div', { class: 'msum' }, h('b', null, list.length), ' món đã chọn', h('br'), 'Nhận về ', h('b', { class: 'gold' }, `${CUR.gold} ${fmt(gold)}`)),
      h('div', { class: 'col' },
        ...([0, 1] as const).map((r) => h('button', { class: 'btn ghost sm', onclick: () => { for (const i of items) if (!i.equipped && i.rarity <= r && (filter === 'all' || ITEM_BY_ID[i.itemId]?.slot === filter)) picked.add(i.uid); redraw(); } }, `+ Chọn mọi đồ ${r === 0 ? 'Thường' : 'Thường & Hiếm'}`)),
        h('button', { class: 'btn ghost sm', disabled: !picked.size, onclick: () => { picked.clear(); redraw(); } }, 'Bỏ chọn hết'),
        h('button', { class: 'btn red', disabled: !list.length, onclick: () => {
          const hi = list.some((i) => i.rarity >= 2);
          confirmBox('Phân rã đồ?', `Phân rã ${list.length} món${hi ? ' (có đồ Sử thi/Huyền thoại!)' : ''} để nhận ${fmt(gold)} vàng. Không hoàn tác được.`, 'PHÂN RÃ', async () => {
            if (await act(api.salvage([...picked]), `+${fmt(gold)} vàng`)) { picked.clear(); multi = false; }
          }, true);
        } }, `♻️ PHÂN RÃ ${list.length || ''}`)));
  } else {
    const it = items.find((i) => i.uid === selUid);
    const def = it ? ITEM_BY_ID[it.itemId] : undefined;
    if (!it || !def) {
      right.append(h('div', { class: 'empty' }, 'Chọn một món để xem chi tiết.'));
    } else {
      const cur = bySlot.get(def.slot);
      const cmp = cur && cur.uid !== it.uid ? itemStats(cur) : null;
      const maxed = it.level >= ITEM_MAX_LEVEL;
      const cost = upgradeCost(it.rarity, it.level);
      const sv = salvageValue(it);
      const big = instTile(it, { size: 96 });
      right.append(
        h('div', { class: 'ihead', style: `--rc:${rarityColor(it.rarity)}` }, big,
          h('div', null,
            h('h3', { class: 'ittl' }, def.name),
            h('div', { class: 'irar', style: `color:${rarityColor(it.rarity)}` }, RARITY[it.rarity].name, ' · ', SLOTS.find((s) => s.id === def.slot)?.name ?? ''),
            h('div', { class: 'ilv' }, `Cấp ${it.level}/${ITEM_MAX_LEVEL}`, h('span', { class: 'pips' }, ...Array.from({ length: ITEM_MAX_LEVEL }, (_, i) => h('i', { class: i < it.level ? 'on' : '' })))),
            it.equipped ? h('div', { class: 'ieq' }, '✔ Đang mặc') : null)),
        h('p', { class: 'idesc' }, def.desc),
        h('div', { class: 'sdt' }, cmp ? 'CHỈ SỐ (so với món đang mặc)' : 'CHỈ SỐ'),
        statList(itemStats(it), cmp),
        h('div', { class: 'iact' },
          it.equipped
            ? h('button', { class: 'btn ghost', onclick: () => act(api.unequip(def.slot)) }, '⬇ THÁO')
            : h('button', { class: 'btn green', onclick: () => act(api.equip(it.uid), `Đã mặc ${def.name}`) }, '⬆ MẶC'),
          h('button', { class: 'btn', disabled: maxed || me.profile.gold < cost, title: maxed ? 'Đã tối đa' : me.profile.gold < cost ? 'Thiếu vàng' : 'Mỗi cấp +8% chỉ số chính', onclick: () => act(api.upgradeItem(it.uid), `${def.name} lên cấp ${it.level + 1}!`) },
            maxed ? 'TỐI ĐA' : `⬆ NÂNG ${CUR.gold}${fmt(cost)}`),
          h('button', { class: 'btn red', disabled: it.equipped, title: it.equipped ? 'Tháo ra trước' : '', onclick: () => {
            const go = () => act(api.salvage([it.uid]), `+${fmt(sv)} vàng`);
            if (it.rarity >= 2 || it.level > 1) confirmBox('Phân rã?', `Phân rã ${def.name} (${RARITY[it.rarity].name}, cấp ${it.level}) để nhận ${fmt(sv)} vàng?`, 'PHÂN RÃ', go, true);
            else go();
          } }, `♻️ ${CUR.gold}${fmt(sv)}`)));
    }
  }
  body.append(h('div', { class: 'itab' }, left, right));
}
