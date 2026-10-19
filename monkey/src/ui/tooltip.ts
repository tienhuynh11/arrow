// Tooltip kiểu Võ Lâm: nền đen trong, tên màu theo phẩm, dòng gốc trắng, dòng phụ xanh, so sánh ▲▼ với món đang mặc,
// giá bán. Chuột: rê vào hiện. Cảm ứng: chạm giữ ~0.45 s hiện (thả ra tắt).

import type { StatKey2 } from '@shared/monkey/gear';
import { api } from '../api';
import {
  KIND_NAME, SLOT_NAME, bakedExtra, levelReqOf, STAT_KEYS, baseStats, compareTarget, defOf, fmtStat, gradeColor, gradeLabel, instStats, sellPrice, statInfo, weaponDps, weaponOfItem,
  type Inv, type StatMap,
} from '../gearlib';
import { fmt, h } from './dom';

let tipEl: HTMLElement | null = null;
let owner: HTMLElement | null = null;
let lastX = 0, lastY = 0;
/** tắt tooltip khi đang kéo thả */
export let tipsMuted = false;
export function muteTips(v: boolean) {
  tipsMuted = v;
  if (v) hideTip();
}

function ensure() {
  if (!tipEl) {
    tipEl = h('div', { class: 'tip hidden' });
    document.body.append(tipEl);
  }
  return tipEl;
}

export function showTip(content: Node, x: number, y: number, from?: HTMLElement) {
  if (tipsMuted) return;
  const t = ensure();
  t.replaceChildren(content);
  t.classList.remove('hidden');
  owner = from ?? null;
  placeTip(x, y);
}
export function placeTip(x: number, y: number) {
  if (!tipEl || tipEl.classList.contains('hidden')) return;
  lastX = x;
  lastY = y;
  const r = tipEl.getBoundingClientRect();
  let px = x + 16, py = y + 14;
  if (px + r.width > innerWidth - 6) px = x - r.width - 14;
  if (px < 6) px = 6;
  if (py + r.height > innerHeight - 6) py = Math.max(6, innerHeight - r.height - 6);
  tipEl.style.transform = `translate(${Math.round(px)}px,${Math.round(py)}px)`;
}
export function hideTip() {
  tipEl?.classList.add('hidden');
  owner = null;
}
// phần tử chủ bị gỡ khỏi trang (vẽ lại) → tắt
setInterval(() => { if (owner && !owner.isConnected) hideTip(); }, 400);

/** gắn tooltip cho phần tử; build gọi lúc hiện (luôn lấy dữ liệu mới nhất) */
export function bindTip(el: HTMLElement, build: () => Node | null) {
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch') return;
    const c = build();
    if (c) showTip(c, e.clientX, e.clientY, el);
  });
  el.addEventListener('pointermove', (e) => { if (owner === el && e.pointerType !== 'touch') placeTip(e.clientX, e.clientY); });
  el.addEventListener('pointerleave', () => { if (owner === el) hideTip(); });
  let lp = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    clearTimeout(lp);
    const x = e.clientX, y = e.clientY;
    lp = window.setTimeout(() => { const c = build(); if (c) showTip(c, x, y - 40, el); }, 450);
  });
  const cancel = () => { clearTimeout(lp); };
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
}
void lastX; void lastY;

/* ======================= NỘI DUNG TOOLTIP MÓN ĐỒ ======================= */
const line = () => h('div', { class: 'tl' });

function statLines(st: StatMap, cls: string) {
  const out: HTMLElement[] = [];
  for (const k of STAT_KEYS) {
    const v = st[k];
    if (!v) continue;
    out.push(h('div', { class: cls }, `${statInfo(k).name} ${fmtStat(k, v)}`));
  }
  return out;
}

export interface TipOpts {
  /** đồ đang mất (tổng kết) */
  lost?: boolean;
  /** dòng chú thích thêm cuối */
  hint?: string;
  /** không so sánh */
  noCompare?: boolean;
}

export function itemTip(it: Inv, o: TipOpts = {}): HTMLElement {
  const me = api.me;
  const def = defOf(it.itemId);
  const box = h('div');
  if (!def) {
    box.append(h('div', { class: 'tn' }, it.itemId), h('div', { class: 'tk' }, 'Không rõ món đồ'));
    return box;
  }
  const col = gradeColor(it.grade);
  box.append(h('div', { class: 'tn', style: `color:${col}` }, def.name, it.level > 1 ? ` +${it.level - 1}` : '', it.count > 1 ? ` ×${it.count}` : ''));
  box.append(h('div', { class: 'tk' }, `${KIND_NAME[def.kind]} · `, h('span', { style: `color:${col}` }, gradeLabel(it.grade)), it.slot ? ` · đang mặc (${SLOT_NAME[it.slot]})` : it.stash ? ' · trong kho' : ''));
  const lvl = me?.profile.level ?? 1;
  const req = levelReqOf(it);
  if (req > 1) box.append(h('div', { class: `tr${lvl < req ? ' no' : ''}` }, `Yêu cầu cấp ${req}`));
  // ---- súng: thông số ----
  if (def.kind === 'gun') {
    const w = weaponOfItem(it, me?.profile.cls ?? 0, bakedExtra(me));
    const dps = weaponDps(w);
    box.append(line(), h('div', { class: 'tg' },
      h('span', null, 'Sát thương'), h('b', null, w.pellets > 1 ? `${w.dmg} × ${w.pellets}` : String(w.dmg)),
      h('span', null, 'Tốc bắn'), h('b', null, `${Math.round(dps.rpm)} phát/phút`),
      h('span', null, 'Băng đạn'), h('b', null, String(w.mag)),
      h('span', null, 'Nạp đạn'), h('b', null, `${(w.reload / 60).toFixed(1)} giây`),
      h('span', null, 'Tầm bắn'), h('b', null, `${w.range} m`),
      w.pierce ? h('span', null, 'Xuyên') : null, w.pierce ? h('b', null, `${w.pierce} mục tiêu`) : null,
      w.splashR ? h('span', null, 'Nổ lan') : null, w.splashR ? h('b', null, `${w.splashR} m · ${w.splashDmg}`) : null,
      h('span', null, 'Sát thương/giây'), h('b', { style: 'color:var(--gold-hi)' }, fmt(dps.sustained))));
  }
  // ---- tiêu hao ----
  if (def.consumable) {
    const c = def.consumable;
    const txt = c.kind === 'heal' ? `Hồi ${c.amount} sinh lực`
      : c.kind === 'shield' ? `Khiên chắn ${c.amount} trong ${c.secs} giây`
        : c.kind === 'speed' ? `Tốc chạy ×${c.mul} trong ${c.secs} giây`
          : c.kind === 'grenade' ? `Ném lựu: ${c.dmg} sát thương, bán kính ${c.radius} m`
            : 'Tự đứng dậy khi gục';
    box.append(line(), h('div', { class: 'ts' }, `Công dụng: ${txt}`), h('div', { class: 'th' }, 'Đặt vào ô nhanh [3] / [4] để dùng trong ải'));
  }
  // ---- chỉ số ----
  const base = statLines(baseStats(it), 'ts');
  const aff = statLines(it.affixes, 'ta');
  if (base.length || aff.length) box.append(line(), ...base, ...aff);
  // ---- so sánh ----
  if (!o.noCompare) {
    const cur = me ? compareTarget(me, it) : null;
    if (cur && cur.uid !== it.uid) {
      const a = instStats(it), b = instStats(cur);
      const rows: HTMLElement[] = [];
      for (const k of STAT_KEYS) {
        const d = (a[k] ?? 0) - (b[k] ?? 0);
        const eps = statInfo(k as StatKey2).pct ? 0.0005 : 0.5;
        if (Math.abs(d) <= eps) continue;
        rows.push(h('div', { class: d > 0 ? 'up' : 'dn' }, `${d > 0 ? '▲' : '▼'} ${statInfo(k).name} ${fmtStat(k, Math.abs(d), false)}`));
      }
      if (def.kind === 'gun') {
        const cls = me?.profile.cls ?? 0;
        const d = weaponDps(weaponOfItem(it, cls, bakedExtra(me))).sustained - weaponDps(weaponOfItem(cur, cls, bakedExtra(me))).sustained;
        if (Math.abs(d) >= 1) rows.unshift(h('div', { class: d > 0 ? 'up' : 'dn' }, `${d > 0 ? '▲' : '▼'} Sát thương/giây ${fmt(Math.abs(d))}`));
      }
      if (rows.length) box.append(line(), h('div', { class: 'tk' }, `So với ${defOf(cur.itemId)?.name ?? 'đang mặc'}:`), h('div', { class: 'tcmp' }, ...rows));
    }
  }
  if (def.desc) box.append(line(), h('div', { class: 'td' }, def.desc));
  if (it.slot === 'secure') box.append(h('div', { class: 'tsafe' }, '🔒 Túi an toàn: không mất khi gục trong ải'));
  if (o.lost) box.append(h('div', { class: 'dn' }, '✖ Đã mất trong ải'));
  if (it.uid >= 0) {
    const p = sellPrice(it);
    if (p > 0) box.append(line(), h('div', { class: 'tp' }, `Giá bán: 🪙 ${fmt(p)}`));
  }
  if (o.hint) box.append(h('div', { class: 'th' }, o.hint));
  return box;
}
