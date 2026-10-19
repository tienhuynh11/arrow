// Cửa sổ HÀNH TRANG (B): lưới 6 cột × 60 ô + tab Kho (200 ô). Kéo thả giữa ô, lên paperdoll (mặc), về lại (tháo),
// sang kho, vào ô bán. Chuột phải / nháy đúp: mặc nhanh. Shift + bấm: chuyển hành trang ↔ kho. Cảm ứng: chạm = menu.

import type { MeResponse } from '@shared/monkey/api';
import type { ItemKind } from '@shared/monkey/gear';
import { api } from '../../../api';
import * as A from '../../../audio';
import { ITEM_MAX_LEVEL, UPGRADE_STONE, upgradeCost, upgradeStones } from '@shared/monkey/progression';
import { BAG_SIZE, STASH_SIZE, bagItems, invOf, defOf, gridOf, sortGrid, starterEligible, starterKit, stashItems, type Inv } from '../../../gearlib';
import { fmt, h } from '../../dom';
import { ctxMenu, draggable, dropTarget, type DragSrc } from '../../dnd';
import { bindTip, itemTip } from '../../tooltip';
import { act } from '../actions';
import type { HubCtx } from '../hub';
import { CUR, itemEl } from '../items';
import { doEquip, doStash, gridDrop } from './gearops';
import { addSell, sellPick } from './merchant';

type Filt = 'all' | 'gear' | 'gun' | 'use' | 'mat';
let filt: Filt = 'all';
const FILTS: { id: Filt; name: string; kinds: ItemKind[] | null }[] = [
  { id: 'all', name: 'Tất cả', kinds: null },
  { id: 'gun', name: 'Vũ khí', kinds: ['gun', 'knife'] },
  { id: 'gear', name: 'Trang bị', kinds: ['helmet', 'armor', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'skin'] },
  { id: 'use', name: 'Tiêu hao', kinds: ['consumable'] },
  { id: 'mat', name: 'Khác', kinds: ['material'] },
];

export function bagTabs(me: MeResponse) {
  return [{ id: 'bag', name: `Hành trang ${bagItems(me).length}/${BAG_SIZE}` }, { id: 'stash', name: `Kho ${stashItems(me).length}/${STASH_SIZE}` }];
}

function itemActions(it: Inv, which: 'bag' | 'stash', ctx: HubCtx, me: MeResponse) {
  const def = defOf(it.itemId);
  const wearable = !!def && def.kind !== 'material';
  const up = def && def.kind !== 'consumable' && def.kind !== 'material' && it.level < ITEM_MAX_LEVEL;
  const gold = up ? upgradeCost(it.grade, it.level) : 0;
  const stones = up ? upgradeStones(it.level) : 0;
  const have = invOf(me).filter((i) => i.itemId === UPGRADE_STONE).reduce((a, i) => a + i.count, 0);
  return [
    { label: '⬆ Mặc / dùng', on: () => void doEquip(it), disabled: !wearable },
    { label: '🔒 Cất vào Túi an toàn', on: () => void doEquip(it, 'secure') },
    which === 'bag' ? { label: '📦 Cất vào kho', on: () => void doStash(it, true) } : { label: '🎒 Lấy ra hành trang', on: () => void doStash(it, false) },
    { label: '🪙 Bán (Thương nhân)', on: () => { addSell(it.uid); ctx.open('merchant', 'sell'); } },
    ...(up ? [{ label: `✨ Cường hoá +${it.level} (🪙${fmt(gold)} · 💎${stones}/${have} đá)`, disabled: me.profile.gold < gold || have < stones, on: () => void act(api.upgradeItem(it.uid), `${def!.name} lên +${it.level}!`) }] : []),
  ];
}

function grid(me: MeResponse, which: 'bag' | 'stash', ctx: HubCtx) {
  const list = which === 'bag' ? bagItems(me) : stashItems(me);
  const size = which === 'bag' ? BAG_SIZE : STASH_SIZE;
  const cells = gridOf(list, which, size);
  const kinds = FILTS.find((f) => f.id === filt)?.kinds ?? null;
  const merchantSell = ctx.isOpen('merchant') && ctx.tab('merchant') === 'sell';
  const g = h('div', { class: `bgrid${which === 'stash' ? ' st' : ''}`, 'data-keep-scroll': '1' });
  cells.forEach((it, i) => {
    const cell = h('div', { class: 'cell' });
    if (it) {
      const def = defOf(it.itemId);
      const dim = kinds && def && !kinds.includes(def.kind);
      const el = itemEl(it, { cls: `${dim ? 'locked' : ''}${sellPick.has(it.uid) ? ' pick' : ''}` });
      cell.append(el);
      bindTip(el, () => itemTip(it, { hint: merchantSell ? 'Chuột phải: thêm vào danh sách bán' : which === 'bag' ? 'Bấm: menu · Chuột phải / nháy đúp: mặc · Shift+bấm: cất kho · Kéo thả để di chuyển' : 'Chuột phải: lấy ra hành trang · Kéo thả để di chuyển' }));
      draggable(el, (): DragSrc => ({ from: which, it, cell: i }), {
        onQuick: () => {
          if (merchantSell) { addSell(it.uid); A.sfxUi(); ctx.redraw(); return; }
          if (which === 'stash') void doStash(it, false);
          else void doEquip(it);
        },
        onTap: (e) => {
          if (e.shiftKey) { void doStash(it, which === 'bag'); return; }
          ctxMenu(e.clientX, e.clientY, itemActions(it, which, ctx, me));
        },
      });
    }
    dropTarget(cell, (s) => !(s.from === which && s.cell === i), (s) => gridDrop(which, i, it, s, ctx.redraw));
    g.append(cell);
  });
  return g;
}

export function renderBagWin(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const tab = (ctx.tab('inv') ?? 'bag') as 'bag' | 'stash';
  const list = tab === 'bag' ? bagItems(me) : stashItems(me);
  body.style.overflow = 'hidden';
  const wrap = h('div', { class: 'bagw' });
  if (tab === 'bag' && starterEligible(me)) {
    const kit = starterKit();
    wrap.append(h('div', { class: 'starter' }, h('span', { style: 'font-size:20px' }, '🎁'),
      h('span', { class: 'grow' }, h('b', null, 'Bộ tân binh'), kit.length ? ` — ${kit.length} món: súng, giáp, thuốc…` : ' — súng, giáp và thuốc để vào ải'),
      h('button', { class: 'vb gold sm', onclick: () => act(api.claimStarter(), '🎁 Đã nhận bộ tân binh — mở Nhân vật (C) để mặc!') }, 'NHẬN')));
  }
  wrap.append(h('div', { class: 'bagtools' },
    h('div', { class: 'bagfilt' }, ...FILTS.map((f) => h('button', { class: f.id === filt ? 'on' : '', onclick: () => { filt = f.id; A.sfxUi(); ctx.redraw(); } }, f.name))),
    h('span', { class: 'grow' }),
    h('button', { class: 'vb sm', title: 'Sắp xếp theo loại / phẩm', onclick: () => { sortGrid(list, tab); A.sfxUi(); ctx.redraw(); } }, '⇅ Xếp')));
  wrap.append(grid(me, tab, ctx));
  // ô thả nhanh
  const toOther = h('div', { class: 'dropz' }, tab === 'bag' ? '📦 Thả vào đây: cất kho' : '🎒 Thả vào đây: lấy ra hành trang');
  dropTarget(toOther, (s) => s.from !== (tab === 'bag' ? 'stash' : 'bag'), (s) => {
    if (s.from === 'equip') gridDrop(tab === 'bag' ? 'stash' : 'bag', 9999, null, s, ctx.redraw);
    else void doStash(s.it, tab === 'bag');
  });
  const sellZ = h('div', { class: 'dropz sell' }, '🪙 Thả vào đây: bán');
  dropTarget(sellZ, (s) => s.from !== 'equip', (s) => { addSell(s.it.uid); ctx.open('merchant', 'sell'); });
  wrap.append(h('div', { class: 'dropbar' }, toOther, sellZ));
  body.append(wrap);
  const foot = h('div', null,
    h('span', null, CUR.gold, ' ', h('b', { style: 'color:var(--gold-hi)' }, fmt(me.profile.gold))),
    h('span', { class: 'grow' }),
    h('span', { class: 'dim' }, tab === 'bag' ? `${list.length}/${BAG_SIZE} ô` : `${list.length}/${STASH_SIZE} ô`));
  return foot;
}
