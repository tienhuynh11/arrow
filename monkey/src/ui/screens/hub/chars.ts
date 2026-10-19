// Cửa sổ NHÂN VẬT (C) kiểu VLTK: tab Trang bị (paperdoll — nhân vật 3D xoay ở giữa, ô trang bị xếp quanh),
// tab Thuộc tính (tổng mọi chỉ số + sát thương/giây của súng), tab Nhân vật (chọn / mở khoá 7 nhân vật).

import type { MeResponse } from '@shared/monkey/api';
import { CLASSES } from '@shared/monkey/content';
import type { EquipSlot } from '@shared/monkey/gear';
import { CHAR_UNLOCK, unlockText, type SkillKey } from '@shared/monkey/progression';
import { api } from '../../../api';
import * as A from '../../../audio';
import {
  SLOT_NAME, STAT_KEYS, bakedExtra, defOf, equippedMap, fmtStat, gradeColor, lookOf, statInfo, sumStats, weaponDps, weaponOfItem,
} from '../../../gearlib';
import { AvatarPreview } from '../../../render/preview';
import { clsColor, clsIcon, fmt, h } from '../../dom';
import { ctxMenu, draggable, dropTarget } from '../../dnd';
import { gunSvg, slotGhostSvg } from '../../icons';
import { bindTip, itemTip } from '../../tooltip';
import { act } from '../actions';
import type { HubCtx } from '../hub';
import { CUR, itemEl } from '../items';
import { doUnequip, equipDropOk, onEquipDrop } from './gearops';
import { clearedSet } from './stages';

let viewCls: number | null = null;
let preview: AvatarPreview | null = null;
let previewKey = '';
/** đang xem súng ô nào trong khung 3D (null = xem nhân vật) */
let gunView: EquipSlot | null = null;

export function disposeCharsTab() {
  preview?.dispose();
  preview = null;
  previewKey = '';
}

export function charTabs() {
  return [{ id: 'equip', name: 'Trang bị' }, { id: 'stats', name: 'Thuộc tính' }, { id: 'chars', name: 'Nhân vật' }];
}

/** trạng thái mở khoá: null = đã mở; còn lại = { text, can } */
export function lockState(me: MeResponse, cls: number): { text: string; can: boolean } | null {
  if (me.profile.chars.includes(cls)) return null;
  const r = CHAR_UNLOCK[cls] ?? { kind: 'event' as const };
  const p = me.profile;
  let can = false;
  if (r.kind === 'default') can = true;
  else if (r.kind === 'level') can = p.level >= r.level;
  else if (r.kind === 'stage') can = clearedSet(me).has(r.stage);
  else if (r.kind === 'shards') can = p.shards >= r.shards;
  const extra = r.kind === 'level' ? ` (bạn: cấp ${p.level})` : r.kind === 'shards' ? ` (có ${p.shards}/${r.shards} ${CUR.shards})` : '';
  return { text: unlockText(r) + extra, can };
}

export function skillLv(me: MeResponse, cls: number, k: SkillKey) {
  return Math.max(1, me.profile.skills?.[cls]?.[k] ?? 1);
}

/** lực chiến (để so sánh vui, kiểu VLTK) */
export function powerOf(me: MeResponse) {
  const eq = equippedMap(me);
  const st = sumStats(eq.values());
  const cls = me.profile.cls;
  const w1 = weaponDps(weaponOfItem(eq.get('weapon1') ?? null, cls, bakedExtra(me))).sustained;
  const w2 = eq.get('weapon2') ? weaponDps(weaponOfItem(eq.get('weapon2')!, cls, bakedExtra(me))).sustained : 0;
  let p = w1 + w2 * 0.5 + (CLASSES[cls]?.hp ?? 100) + (st.hp ?? 0) * 2 + (st.knifeDmg ?? 0);
  for (const k of STAT_KEYS) if (statInfo(k).pct) p += (st[k] ?? 0) * 600;
  return Math.round(p);
}

/* ======================= Ô TRANG BỊ ======================= */
function slotCell(me: MeResponse, slot: EquipSlot, ctx: HubCtx, label = false) {
  const eq = equippedMap(me);
  const it = eq.get(slot);
  const cell = h('div', { class: 'cell', title: it ? '' : SLOT_NAME[slot] });
  if (it) {
    const el = itemEl(it);
    cell.append(el);
    bindTip(el, () => itemTip(it, { hint: 'Chuột phải / nháy đúp: tháo · Kéo vào hành trang để tháo' }));
    draggable(el, () => ({ from: 'equip', it, slot }), {
      onQuick: () => doUnequip(slot),
      onTap: (e) => {
        ctxMenu(e.clientX, e.clientY, [
          { label: '⬇ Tháo ra', on: () => doUnequip(slot) },
          ...(defOf(it.itemId)?.kind === 'gun' ? [{ label: '🔍 Xem súng', on: () => { gunView = slot; ctx.redraw(); } }] : []),
        ]);
      },
    });
  } else {
    const g = h('div', { class: 'ghost' });
    g.innerHTML = slotGhostSvg(slot); // SVG tự vẽ
    cell.append(g);
  }
  dropTarget(cell, (s) => equipDropOk(slot, s), (s) => onEquipDrop(slot, s));
  const wrap = h('div', { class: `pdslot${slot === 'secure' ? ' safe' : ''}` }, slot === 'secure' ? h('span', { class: 'lock' }, '🔒') : null, cell, label ? h('small', null, SLOT_NAME[slot]) : null);
  return wrap;
}

function previewBox(me: MeResponse, ctx: HubCtx) {
  const p = me.profile;
  const cls = p.cls;
  const look = lookOf(me);
  const eq = equippedMap(me);
  const box = h('div', { class: 'pdmid' });
  const key = `${cls}|${JSON.stringify(look)}`;
  if (!preview) preview = new AvatarPreview(cls, look);
  else if (key !== previewKey) preview.setChar(cls, look);
  previewKey = key;
  const gi = gunView ? eq.get(gunView) : undefined;
  if (gunView && !gi) gunView = null;
  if (gi) {
    const w = weaponOfItem(gi, cls);
    preview.showGun(w, defOf(gi.itemId)?.look.color ?? w.color);
  } else preview.showAvatar();
  if (preview.ok) box.append(preview.el);
  else box.append(h('div', { class: 'pdfallback' }, clsIcon(cls, 110)));
  box.append(
    h('div', { class: 'pdname' }, gi ? h('span', { style: `color:${gradeColor(gi.grade)}` }, defOf(gi.itemId)?.name ?? '') : p.username, h('small', null, gi ? SLOT_NAME[gunView!] : `${CLASSES[cls]?.name ?? ''} · Cấp ${p.level}`)),
    h('div', { class: 'pdpow' }, 'Lực chiến', h('b', null, fmt(powerOf(me)))),
    h('div', { class: 'pdtools' },
      h('button', { class: 'vb sm', title: 'Xem súng 3D', disabled: !eq.get('weapon1') && !eq.get('weapon2'), onclick: () => {
        const order: (EquipSlot | null)[] = [null, 'weapon1', 'weapon2'];
        let i = order.indexOf(gunView);
        do i = (i + 1) % order.length; while (order[i] && !eq.get(order[i]!));
        gunView = order[i];
        A.sfxUi();
        ctx.redraw();
      } }, gi ? (gunView === 'weapon1' && eq.get('weapon2') ? '🔫 Súng 2' : '🧍 Nhân vật') : '🔍 Xem súng'),
      h('button', { class: 'vb sm', title: 'Chém dao', onclick: () => preview?.slash() }, '🔪')),
    h('div', { class: 'pdhint' }, '↔ kéo để xoay · thả đồ vào ô để mặc'));
  return box;
}

function equipTab(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const L: EquipSlot[] = ['helmet', 'amulet', 'armor', 'belt', 'gloves', 'boots'];
  const R: EquipSlot[] = ['weapon1', 'weapon2', 'knife', 'ring1', 'ring2', 'skin'];
  const eq = equippedMap(me);
  const n = [...eq.keys()].length;
  body.append(h('div', { class: 'pdoll', style: 'height:100%' },
    h('div', { class: 'pdcol' }, ...L.map((s) => slotCell(me, s, ctx))),
    previewBox(me, ctx),
    h('div', { class: 'pdcol' }, ...R.map((s) => slotCell(me, s, ctx))),
    h('div', { class: 'pdbot' },
      slotCell(me, 'quick1', ctx, true), slotCell(me, 'quick2', ctx, true),
      h('span', { class: 'grow', style: 'font-size:11.5px;color:var(--dim);line-height:1.35;align-self:center' },
        h('b', { style: 'color:var(--gold-hi)' }, `${n}/15 ô`), ' đã mặc', h('br'),
        h('span', { style: 'color:#7fdcff' }, '🔒 Túi an toàn'), ': 1 món bất kỳ, không mất khi gục'),
      slotCell(me, 'secure', ctx, true))));
}

/* ======================= THUỘC TÍNH ======================= */
function statsTab(body: HTMLElement, me: MeResponse) {
  const eq = equippedMap(me);
  const st = sumStats(eq.values());
  const c = CLASSES[me.profile.cls];
  const sheet = h('div', { class: 'stsheet' },
    h('div', null, h('span', null, 'Sinh lực gốc'), h('b', null, c.hp)),
    h('div', null, h('span', null, 'Tốc chạy gốc'), h('b', null, `${c.speed.toFixed(1)} m/s`)),
    ...STAT_KEYS.map((k) => {
      const v = st[k] ?? 0;
      return h('div', null, h('span', null, statInfo(k).name), h('b', { class: v ? '' : 'z' }, v ? fmtStat(k, v) : '—'));
    }));
  const wcard = (slot: EquipSlot) => {
    const it = eq.get(slot);
    const w = weaponOfItem(it ?? null, me.profile.cls, bakedExtra(me));
    const d = weaponDps(w);
    const pic = h('span');
    pic.innerHTML = gunSvg(w); // SVG tự vẽ
    return h('div', { class: 'box2 wcard2' },
      h('div', { class: 'wh' }, pic, h('div', null, h('b', { style: it ? `color:${gradeColor(it.grade)}` : '' }, it ? defOf(it.itemId)?.name ?? w.name : `${w.name} (mặc định)`), h('small', null, SLOT_NAME[slot]))),
      h('div', { class: 'stsheet', style: 'grid-template-columns:1fr;margin-top:4px' },
        h('div', null, h('span', null, 'Sát thương'), h('b', null, w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg)),
        h('div', null, h('span', null, 'Tốc bắn'), h('b', null, `${Math.round(d.rpm)}/phút`)),
        h('div', null, h('span', null, 'Băng · nạp'), h('b', null, `${w.mag} · ${(w.reload / 60).toFixed(1)}s`)),
        h('div', null, h('span', null, 'Tầm bắn'), h('b', null, `${w.range} m`))),
      h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin-top:4px' }, h('span', { class: 'dim', style: 'font-size:11.5px' }, 'Sát thương/giây'), h('span', { class: 'dps' }, fmt(d.sustained))));
  };
  body.append(
    h('div', { class: 'hsec' }, 'Vũ khí'),
    h('div', { class: 'wcards' }, wcard('weapon1'), eq.get('weapon2') ? wcard('weapon2') : h('div', { class: 'box2', style: 'display:grid;place-items:center;color:var(--dim);font-size:12px;text-align:center' }, 'Chưa có súng phụ', h('br'), 'Phím [2] để đổi súng trong ải')),
    h('div', { class: 'hsec' }, `Tổng thuộc tính · Lực chiến ${fmt(powerOf(me))}`),
    sheet,
    h('div', { class: 'parch', style: 'margin-top:8px' }, 'Chỉ số cộng từ mọi món đang mặc (trừ ô nhanh và Túi an toàn). ', h('b', null, 'Dòng xanh'), ' là dòng phụ ngẫu nhiên — phẩm càng cao càng nhiều dòng.'));
}

/* ======================= NHÂN VẬT ======================= */
function charsTab(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const p = me.profile;
  if (viewCls === null || !CLASSES[viewCls]) viewCls = p.cls;
  const cls = viewCls;
  const c = CLASSES[cls];
  const lock = lockState(me, cls);
  const grid = h('div', { class: 'chgrid' }, ...CLASSES.map((cc, i) => {
    const lk = lockState(me, i);
    return h('button', { class: `chit2${i === cls ? ' on' : ''}${lk ? ' lk' : ''}${i === p.cls ? ' cur' : ''}`, onclick: () => { viewCls = i; A.sfxUi(); ctx.redraw(); } },
      clsIcon(i, 38), h('b', null, cc.name), h('span', null, lk ? `🔒 ${lk.text}` : cc.role), lk?.can ? h('em', { class: 'badge' }, '!') : null);
  }));
  body.append(grid, h('div', { class: 'box2 chdet' },
    h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:flex-start' },
      h('div', null, h('h3', null, c.name), h('div', { class: 'role', style: `color:${clsColor(cls)}` }, c.role)),
      lock
        ? h('button', { class: 'vb gold', disabled: !lock.can, title: lock.text, onclick: () => act(api.unlockChar(cls), `Đã mở khoá ${c.name}!`) }, lock.can ? '🔓 MỞ KHOÁ' : `🔒 ${lock.text}`)
        : cls === p.cls ? h('span', { style: 'color:var(--leaf);font-weight:900' }, '✔ ĐANG DÙNG')
          : h('button', { class: 'vb gold', onclick: () => act(api.selectChar(cls), `Đã chọn ${c.name}`) }, '✔ CHỌN')),
    h('p', null, c.desc),
    h('div', { class: 'facts' },
      h('span', null, '♥ ', h('b', null, c.hp), ' sinh lực'),
      h('span', null, '🏃 ', h('b', null, c.speed.toFixed(1)), ' m/s'),
      h('span', null, '✦ ', h('b', null, 'Nội tại: '), c.passive)),
    h('div', { class: 'facts', style: 'margin-top:6px' },
      ...(['g', 'x', 'q'] as const).map((k) => h('span', { title: c[k].desc }, `${c[k].icon} ${c[k].name} `, h('b', { style: 'color:var(--gold)' }, `Lv ${skillLv(me, cls, k)}`)))),
    h('div', { class: 'dim', style: 'font-size:11.5px;margin-top:6px' }, 'Nâng kỹ năng ở cửa sổ Kỹ năng (K).')));
}

export function renderCharWin(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const tab = ctx.tab('chars') ?? 'equip';
  if (tab === 'equip') {
    body.style.overflow = 'hidden';
    equipTab(body, me, ctx);
  } else if (tab === 'stats') statsTab(body, me);
  else charsTab(body, me, ctx);
  if (tab !== 'equip' && preview) {
    // rời tab trang bị: trả WebGL (khung 3D chỉ sống khi đang xem)
    disposeCharsTab();
  }
}

