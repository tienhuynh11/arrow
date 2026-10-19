// Cửa sổ THƯƠNG NHÂN (N): tab Mua (hàng bày bán, giá) + tab Bán (kéo đồ từ hành trang vào, hoặc chuột phải;
// chọn nhanh theo phẩm; tổng ngân lượng nhận được).

import type { MeResponse } from '@shared/monkey/api';
import { api } from '../../../api';
import * as A from '../../../audio';
import { bagItems, defOf, dropInst, gradeColor, gradeName, invOf, sellPrice, shopStock, type StockRow } from '../../../gearlib';
import { fmt, h } from '../../dom';
import { dropTarget } from '../../dnd';
import { bindTip, itemTip } from '../../tooltip';
import { act } from '../actions';
import type { HubCtx } from '../hub';
import { CUR, itemEl } from '../items';
import { doSell } from './gearops';

/** món đã chọn để bán (uid) — hành trang cũng đọc để tô viền */
export const sellPick = new Set<number>();
export function addSell(uid: number) {
  sellPick.add(uid);
}
let selStock = -1;
let qty = 1;

export function merchantTabs() {
  return [{ id: 'buy', name: 'Mua' }, { id: 'sell', name: `Bán${sellPick.size ? ` (${sellPick.size})` : ''}` }];
}

function head(text: string) {
  return h('div', { class: 'merhead' }, h('div', { class: 'npc' }, '🧔'), h('div', { class: 'parch' }, text));
}

function buyTab(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const rows = shopStock();
  const gold = me.profile.gold;
  body.append(head('Khách quan ghé xem! Hàng tốt giá phải chăng — súng, giáp, thuốc men đủ cả. Vào ải nhớ mang đủ thuốc nhé.'));
  if (!rows.length) {
    body.append(h('div', { class: 'empty' }, 'Thương nhân đang nhập hàng — quay lại sau.'));
    return;
  }
  if (selStock >= rows.length) selStock = -1;
  const grid = h('div', { class: 'shopgrid', style: 'margin-top:8px' });
  rows.forEach((r, i) => {
    const it = dropInst({ itemId: r.itemId, grade: r.grade, count: r.count });
    const cell = h('div', { class: 'cell' }, itemEl(it));
    bindTip(cell, () => itemTip(it, { noCompare: false }));
    grid.append(h('button', { class: `sitem${i === selStock ? ' sel' : ''}`, onclick: () => { selStock = i; qty = 1; A.sfxUi(); ctx.redraw(); } },
      cell, h('b', { style: `color:${gradeColor(r.grade)}` }, r.def.name),
      h('span', { class: `pr${gold < r.price ? ' poor' : ''}` }, `${CUR.gold} ${fmt(r.price)}${r.count > 1 ? ` / ${r.count}` : ''}`)));
  });
  body.append(grid);
  return selStock >= 0 ? buyFoot(rows[selStock], gold, ctx) : h('div', null, h('span', { class: 'dim' }, 'Chọn một món để mua · rê chuột xem chi tiết'), h('span', { class: 'grow' }), h('span', null, CUR.gold, ' ', h('b', { style: 'color:var(--gold-hi)' }, fmt(gold))));
}

function buyFoot(r: StockRow, gold: number, ctx: HubCtx) {
  const stackable = r.def.stack > 1;
  const total = r.price * qty;
  return h('div', null,
    h('b', { style: `color:${gradeColor(r.grade)}` }, r.def.name),
    stackable ? h('span', { class: 'qty' },
      h('button', { onclick: () => { qty = Math.max(1, qty - 1); ctx.redraw(); } }, '−'), h('b', null, qty),
      h('button', { onclick: () => { qty = Math.min(99, qty + 1); ctx.redraw(); } }, '+'),
      h('button', { onclick: () => { qty = Math.max(1, Math.min(99, Math.floor(gold / Math.max(1, r.price)))); ctx.redraw(); } }, 'Max')) : null,
    h('span', { class: 'grow' }),
    h('span', { class: total > gold ? 'dn' : '', style: total > gold ? 'color:#ff7a6a;font-weight:800' : 'font-weight:800' }, `${CUR.gold} ${fmt(total)}`),
    h('button', { class: 'vb gold sm', disabled: total > gold, onclick: () => act(api.buy(r.idx, qty), `Đã mua ${r.def.name}${qty > 1 ? ` ×${qty}` : ''}`) }, 'MUA'));
}

function sellTab(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const inv = invOf(me);
  for (const u of [...sellPick]) if (!inv.some((i) => i.uid === u && !i.slot)) sellPick.delete(u);
  const list = inv.filter((i) => sellPick.has(i.uid));
  const total = list.reduce((a, i) => a + sellPrice(i), 0);
  body.append(head('Đồ không dùng tới cứ để lão mua lại. Kéo đồ từ Hành trang thả vào khay, hoặc chuột phải vào món đồ.'));
  const tray = h('div', { class: 'box2 selllist', style: 'margin-top:8px' });
  if (!list.length) tray.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Khay trống — thả đồ vào đây'));
  for (const it of list) {
    const el = itemEl(it, { cls: 'pick' });
    el.style.cursor = 'pointer';
    el.title = 'Bấm để bỏ khỏi khay';
    bindTip(el, () => itemTip(it, { hint: 'Bấm: bỏ khỏi khay' }));
    el.addEventListener('click', () => { sellPick.delete(it.uid); A.sfxUi(); ctx.redraw(); });
    tray.append(h('div', { class: 'cell' }, el));
  }
  dropTarget(tray, (s) => s.from !== 'equip', (s) => { sellPick.add(s.it.uid); A.sfxUi(); ctx.redraw(); });
  const quick = (maxG: number) => h('button', { class: 'vb sm', onclick: () => {
    for (const it of bagItems(me)) {
      const d = defOf(it.itemId);
      if (it.grade <= maxG && d && d.kind !== 'consumable') sellPick.add(it.uid);
    }
    A.sfxUi();
    ctx.redraw();
  } }, `+ Mọi đồ ${maxG === 0 ? gradeName(0) : `${gradeName(0)} & ${gradeName(1)}`}`);
  body.append(tray, h('div', { class: 'row', style: 'margin-top:8px;gap:6px' }, quick(0), quick(1),
    h('button', { class: 'vb ghost sm', disabled: !sellPick.size, onclick: () => { sellPick.clear(); ctx.redraw(); } }, 'Bỏ chọn hết')));
  body.append(h('div', { class: 'dim', style: 'font-size:11.5px;margin-top:8px' }, 'Đồ đang mặc không bán được — tháo ra trước. Thuốc trong hành trang không tự chọn.'));
  return h('div', { class: 'sellsum' },
    h('span', null, h('b', null, list.length), ' món'),
    h('span', { class: 'grow' }),
    h('span', null, 'Nhận: ', h('span', { class: 'tot' }, `${CUR.gold} ${fmt(total)}`)),
    h('button', { class: 'vb red', disabled: !list.length, onclick: () => doSell(list, () => { sellPick.clear(); }) }, '🪙 BÁN'));
}

export function renderMerchantWin(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const tab = ctx.tab('merchant') ?? 'buy';
  return tab === 'sell' ? sellTab(body, me, ctx) : buyTab(body, me, ctx);
}
