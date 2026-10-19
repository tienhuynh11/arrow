// SẢNH kiểu Võ Lâm Truyền Kỳ: nền 3D (cảnh làng/đền) + thanh trên (chân dung, cấp, XP, tiền) + thanh menu dưới
// (nút lớn có phím tắt). Các cửa sổ mở cạnh nhau: TRÁI (Nhân vật / Kỹ năng / Thương nhân), PHẢI (Hành trang),
// GIỮA (Vượt ải / Sự kiện / Xếp hạng / Vô tận). Phím: C B K M E N L V, Esc đóng cửa sổ trên cùng.

import { CODE_LEN } from '@shared/monkey/config';
import { CLASSES } from '@shared/monkey/content';
import type { MeResponse } from '@shared/monkey/api';
import { LEVEL_MAX, STAGES, stageUnlocked, xpToNext } from '@shared/monkey/progression';
import { api, onMe } from '../../api';
import * as A from '../../audio';
import { equippedMap, starterEligible } from '../../gearlib';
import { clear, clsIcon, fmt, h, toast } from '../dom';
import { closeCtx } from '../dnd';
import { hideTip } from '../tooltip';
import { winFrame, type WinSide } from '../win';
import { S, closeModal, nav, type HubTab } from './ctx';
import { countdown, joinRoom } from './actions';
import { CUR } from './items';
import { renderStagesTab, clearedSet } from './hub/stages';
import { renderCharWin, disposeCharsTab, charTabs } from './hub/chars';
import { renderBagWin, bagTabs } from './hub/inventory';
import { renderSkillsWin } from './hub/skills';
import { renderMerchantWin, merchantTabs } from './hub/merchant';
import { renderEventsTab } from './hub/events';
import { renderEndlessTab } from './hub/endless';
import { renderRankTab } from './hub/rank';

export interface HubCtx {
  redraw: () => void;
  open: (id: HubTab, tab?: string) => void;
  close: (id: HubTab) => void;
  isOpen: (id: HubTab) => boolean;
  setTab: (id: HubTab, tab: string) => void;
  tab: (id: HubTab) => string | undefined;
}

interface WinDef {
  id: HubTab;
  title: string;
  icon: string;
  key: string;
  code: string;
  side: WinSide;
  width: number | (() => number);
  height?: number | (() => number | undefined);
  menu: string;
  tabs?: (me: MeResponse) => { id: string; name: string; badge?: number }[];
  render: (body: HTMLElement, me: MeResponse, ctx: HubCtx) => HTMLElement | void;
}

const vw = () => window.innerWidth;
const areaH = () => Math.max(240, window.innerHeight - 146);
const WINS: WinDef[] = [
  { id: 'chars', title: 'Nhân vật', icon: '🧙', key: 'C', code: 'KeyC', side: 'left', width: 560, height: () => Math.min(areaH(), 520), menu: 'Nhân vật', tabs: charTabs, render: (b, me, c) => renderCharWin(b, me, c) },
  { id: 'inv', title: 'Hành trang', icon: '🎒', key: 'B', code: 'KeyB', side: 'right', width: 372, height: () => Math.min(areaH(), 520), menu: 'Hành trang', tabs: bagTabs, render: (b, me, c) => renderBagWin(b, me, c) },
  { id: 'skills', title: 'Kỹ năng', icon: '📜', key: 'K', code: 'KeyK', side: 'left', width: 500, menu: 'Kỹ năng', render: (b, me, c) => renderSkillsWin(b, me, c) },
  { id: 'stages', title: 'Vượt ải', icon: '🗺️', key: 'M', code: 'KeyM', side: 'center', width: () => Math.min(1120, vw() - 20), height: () => areaH(), menu: 'Vượt ải', render: (b, me, c) => renderStagesTab(b, me, c) },
  { id: 'events', title: 'Sự kiện', icon: '🏮', key: 'E', code: 'KeyE', side: 'center', width: () => Math.min(820, vw() - 20), menu: 'Sự kiện', render: (b, me) => renderEventsTab(b, me) },
  { id: 'merchant', title: 'Thương nhân', icon: '⚖️', key: 'N', code: 'KeyN', side: 'left', width: 520, height: () => Math.min(areaH(), 520), menu: 'Thương nhân', tabs: merchantTabs, render: (b, me, c) => renderMerchantWin(b, me, c) },
  { id: 'rank', title: 'Xếp hạng', icon: '🏆', key: 'L', code: 'KeyL', side: 'center', width: () => Math.min(760, vw() - 20), menu: 'Xếp hạng', render: (b, me) => renderRankTab(b, me) },
  { id: 'endless', title: 'Vô tận', icon: '♾️', key: 'V', code: 'KeyV', side: 'center', width: () => Math.min(820, vw() - 20), menu: 'Vô tận', render: (b, me) => renderEndlessTab(b, me) },
];
const WIN_BY_ID = new Map(WINS.map((w) => [w.id, w]));

/** cửa sổ đang mở (thứ tự mở — cuối = trên cùng) + tab của từng cửa sổ */
const open: HubTab[] = [];
const tabs = new Map<HubTab, string>();
const narrow = () => matchMedia('(max-width: 760px), (max-height: 560px)').matches;

function openWin(id: HubTab, tab?: string) {
  const def = WIN_BY_ID.get(id);
  if (!def) return;
  if (tab) tabs.set(id, tab);
  const i = open.indexOf(id);
  if (i >= 0) open.splice(i, 1);
  // cùng phía → thay; giữa ↔ hai bên loại nhau; màn hẹp → chỉ 1 cửa sổ
  for (let k = open.length - 1; k >= 0; k--) {
    const o = WIN_BY_ID.get(open[k])!;
    if (narrow() || o.side === def.side || def.side === 'center' || o.side === 'center') open.splice(k, 1);
  }
  open.push(id);
  S.hubTab = id;
}
function closeWin(id: HubTab) {
  const i = open.indexOf(id);
  if (i >= 0) open.splice(i, 1);
  if (id === 'chars') disposeCharsTab();
}
export function hubWinOpen(id: HubTab) {
  return S.screen === 'hub' && open.includes(id);
}

const ctx: HubCtx = {
  redraw: () => renderHub(),
  open: (id, tab) => { openWin(id, tab); A.sfxUi(); renderHub(); },
  close: (id) => { closeWin(id); renderHub(); },
  isOpen: (id) => open.includes(id),
  setTab: (id, tab) => { tabs.set(id, tab); A.sfxUi(); renderHub(); },
  tab: (id) => tabs.get(id),
};

let tick = 0;
let loading = false;

function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('.vhub [data-ends]').forEach((el) => {
    const ms = new Date(el.dataset.ends!).getTime() - now;
    el.textContent = countdown(ms);
  });
}

function eventBadge(me: MeResponse) {
  let n = 0;
  for (const e of me.events) for (const o of e.event.objectives) if ((e.progress[o.id] ?? 0) >= o.target && !e.claimed.includes(o.id)) n++;
  return n;
}

function topBar(me: MeResponse) {
  const p = me.profile;
  const need = xpToNext(p.level);
  const pct = p.level >= LEVEL_MAX ? 1 : Math.min(1, p.xp / Math.max(1, need));
  const codeIn = h('input', { maxlength: String(CODE_LEN), placeholder: 'MÃ PHÒNG', value: S.pendingJoin ?? '', autocomplete: 'off' }) as HTMLInputElement;
  codeIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') joinRoom(codeIn.value); });
  return h('div', { class: 'vtop' },
    h('div', { class: 'vport', title: 'Nhân vật (C)', onclick: () => ctx.open('chars') }, clsIcon(p.cls, 50), h('i', { class: 'vlv' }, p.level)),
    h('div', { class: 'vme' },
      h('div', { class: 'vname' }, h('b', null, p.username), h('span', null, `${CLASSES[p.cls]?.name ?? ''} · cấp ${p.level}`)),
      h('div', { class: 'vbar xp', title: `${fmt(p.xp)} / ${fmt(need)} kinh nghiệm` }, h('div', { style: `transform:scaleX(${pct})` }), h('span', null, p.level >= LEVEL_MAX ? 'CẤP TỐI ĐA' : `Kinh nghiệm ${fmt(p.xp)} / ${fmt(need)} (${Math.floor(pct * 100)}%)`))),
    h('div', { class: 'vcur' },
      h('span', { class: 'g', title: 'Ngân lượng — mua bán, nâng cấp' }, CUR.gold, h('b', null, fmt(p.gold))),
      h('span', { title: 'Sách kỹ năng — nâng G / X / Q' }, CUR.books, h('b', null, fmt(p.books))),
      h('span', { title: 'Mảnh nhân vật — ghép Pháo Thủ' }, CUR.shards, h('b', null, fmt(p.shards)))),
    h('div', { class: 'vtopr' },
      h('div', { class: 'join' }, codeIn, h('button', { class: 'vb sm', onclick: () => joinRoom(codeIn.value) }, 'VÀO')),
      h('button', { class: 'iconbtn', title: 'Cách chơi', onclick: () => { A.initAudio(); nav.help(); } }, '❓'),
      document.fullscreenEnabled ? h('button', { class: 'iconbtn', title: 'Toàn màn hình', onclick: () => nav.toggleFullscreen() }, '⛶') : null,
      h('button', { class: 'iconbtn', title: 'Đăng xuất', onclick: () => nav.logout() }, '⏻')));
}

function menuBar(me: MeResponse) {
  const evN = eventBadge(me);
  const starter = starterEligible(me);
  const btn = (d: WinDef, badge?: number | string | null) => h('button', {
    class: `vmb${open.includes(d.id) ? ' on' : ''}${d.id === 'stages' ? ' play' : ''}`, title: `${d.title} (${d.key})`,
    onclick: () => { if (open.includes(d.id)) { closeWin(d.id); A.sfxUi(); renderHub(); } else ctx.open(d.id); },
  }, h('kbd', null, d.key), h('i', null, d.icon), h('span', null, d.menu), badge ? h('em', { class: 'badge' }, badge) : null);
  const W = (id: HubTab) => WIN_BY_ID.get(id)!;
  return h('div', { class: 'vmenu' },
    btn(W('chars')), btn(W('inv'), starter ? '!' : null), btn(W('skills')),
    h('i', { class: 'vmsep' }),
    btn(W('stages')), btn(W('events'), evN || null), btn(W('merchant')),
    h('i', { class: 'vmsep' }),
    btn(W('rank')), btn(W('endless')),
    h('button', { class: 'vmb', title: 'Cài đặt (O)', onclick: () => { A.initAudio(); nav.settings(); } }, h('kbd', null, 'O'), h('i', null, '⚙️'), h('span', null, 'Cài đặt')));
}

/** bảng tin khi chưa mở cửa sổ nào: ải kế tiếp, cảnh báo trang bị, sự kiện */
function newsPanel(me: MeResponse) {
  const cleared = clearedSet(me);
  let next = STAGES[0];
  for (const s of STAGES) if (stageUnlocked(s.id, cleared)) next = s;
  const eq = equippedMap(me);
  const warn: string[] = [];
  if (!eq.get('weapon1') && !eq.get('weapon2')) warn.push('Chưa mang súng — vào ải sẽ dùng súng lục cơ bản.');
  if (!eq.get('quick1') && !eq.get('quick2')) warn.push('Chưa có vật phẩm ô nhanh [3]/[4].');
  const evN = eventBadge(me);
  const body = h('div', { class: 'nx' },
    h('div', null, h('div', { class: 'hsec' }, 'Hành trình'), h('div', { class: 'big' }, `Ải ${next.id} · ${next.name}`), h('div', { class: 'dim' }, `${next.waves} đợt · độ khó ×${next.diff.toFixed(2)}`)),
    h('button', { class: 'vb gold', onclick: () => ctx.open('stages') }, '🗺️ VƯỢT ẢI (M)'),
    starterEligible(me) ? h('div', { class: 'starter' }, '🎁', h('span', null, h('b', null, 'Bộ tân binh'), ' đang chờ bạn ở Hành trang (B)')) : null,
    warn.length ? h('div', { class: 'parch' }, ...warn.map((w) => h('div', { class: 'warnl' }, `⚠ ${w}`)), h('div', null, 'Mở ', h('b', null, 'Nhân vật (C)'), ' + ', h('b', null, 'Hành trang (B)'), ' để trang bị.')) : null,
    evN ? h('button', { class: 'vb', onclick: () => ctx.open('events') }, `🏮 ${evN} phần thưởng sự kiện chờ nhận`) : null,
    h('div', { class: 'parch' }, h('b', null, 'Luật vượt ải: '), 'mang đồ vào ải, chỉ dùng đúng đồ đó. Khỉ rơi túi đồ — chạy qua để nhặt. ', h('span', { class: 'warnl' }, 'Gục ngã = mất đồ đang mang, trừ Túi an toàn.')));
  const w = h('div', { class: 'vw' }, h('i', { class: 'cn tl' }), h('i', { class: 'cn tr' }), h('i', { class: 'cn bl' }), h('i', { class: 'cn br' }),
    h('div', { class: 'vwh', style: 'cursor:default' }, h('span', { class: 'vwi' }, '📯'), h('b', null, 'Bảng tin')), h('div', { class: 'vwb' }, body));
  return h('div', { class: 'vnews' }, w);
}

/** giữ vị trí cuộn của từng cửa sổ khi vẽ lại */
function saveScroll(app: HTMLElement) {
  const m = new Map<string, number[]>();
  app.querySelectorAll<HTMLElement>('.vw[data-win]').forEach((w) => {
    m.set(w.dataset.win!, [...w.querySelectorAll<HTMLElement>('.vwb, [data-keep-scroll]')].map((e) => e.scrollTop));
  });
  return m;
}
function restoreScroll(app: HTMLElement, m: Map<string, number[]>) {
  app.querySelectorAll<HTMLElement>('.vw[data-win]').forEach((w) => {
    const v = m.get(w.dataset.win!);
    if (!v) return;
    [...w.querySelectorAll<HTMLElement>('.vwb, [data-keep-scroll]')].forEach((e, i) => { if (v[i] !== undefined) e.scrollTop = v[i]; });
  });
}

export function renderHub(tab?: HubTab) {
  if (tab) openWin(tab);
  const app = document.getElementById('app')!;
  const me = api.me;
  if (S.screen !== 'hub') closeModal();
  S.screen = 'hub';
  hideTip();
  closeCtx();
  if (!me) {
    clear(app);
    app.append(h('div', { class: 'vhub loading' }, h('div', { class: 'card', style: 'text-align:center;padding:20px' }, h('div', { class: 'spin' }), h('p', null, 'Đang tải hồ sơ…'))));
    if (!loading) {
      loading = true;
      api.refresh().catch((e) => { if (api.loggedIn) { toast((e as Error).message); nav.login(); } }).finally(() => { loading = false; });
    }
    return;
  }
  const scroll = saveScroll(app);
  clear(app);
  if (!open.includes('chars')) disposeCharsTab();
  const wins = h('div', { class: 'vwins' });
  const front = open[open.length - 1];
  for (const id of open) {
    const d = WIN_BY_ID.get(id)!;
    const body = h('div');
    const tlist = d.tabs?.(me);
    if (tlist && !tlist.some((t) => t.id === tabs.get(id))) tabs.set(id, tlist[0].id);
    let foot: HTMLElement | void | null = null;
    try {
      foot = d.render(body, me, ctx);
    } catch (e) {
      console.error(e);
      body.append(h('div', { class: 'empty' }, 'Không hiển thị được mục này.'));
    }
    const width = typeof d.width === 'function' ? d.width() : d.width;
    const height = typeof d.height === 'function' ? d.height() : d.height;
    wins.append(winFrame({
      id, title: d.title, icon: d.icon, key: d.key, side: d.side, width: Math.min(width, vw() - 8), height,
      tabs: tlist, tab: tabs.get(id), onTab: (t) => ctx.setTab(id, t),
      onClose: () => { A.sfxUi(); ctx.close(id); }, front: id === front, foot: foot || null,
      onFront: () => {
        if (open[open.length - 1] === id) return;
        open.splice(open.indexOf(id), 1);
        open.push(id);
        app.querySelectorAll('.vw.front').forEach((x) => x.classList.remove('front'));
        app.querySelector(`.vw[data-win="${id}"]`)?.classList.add('front');
      },
    }, body));
  }
  app.append(h('div', { class: 'vhub' }, topBar(me), wins, open.length ? null : newsPanel(me), menuBar(me)));
  restoreScroll(app, scroll);
  if (!tick) tick = window.setInterval(tickCountdowns, 1000);
  tickCountdowns();
  if (S.pendingJoin) {
    const c = S.pendingJoin;
    S.pendingJoin = null;
    setTimeout(() => joinRoom(c), 300);
  }
}

/* ---------- phím tắt sảnh ---------- */
window.addEventListener('keydown', (e) => {
  if (S.screen !== 'hub' || S.modalClose || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const tgt = e.target as HTMLElement | null;
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
  if (!api.me) return;
  if (e.code === 'Escape') {
    const top = open[open.length - 1];
    if (top) {
      e.preventDefault();
      closeWin(top);
      A.sfxUi();
      renderHub();
    }
    return;
  }
  if (e.code === 'KeyO') {
    A.initAudio();
    nav.settings();
    return;
  }
  const d = WINS.find((w) => w.code === e.code);
  if (!d) return;
  e.preventDefault();
  A.initAudio();
  if (open.includes(d.id)) {
    closeWin(d.id);
    A.sfxUi();
    renderHub();
  } else ctx.open(d.id);
});
window.addEventListener('resize', () => {
  if (S.screen === 'hub' && !S.modalClose) {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(() => renderHub(), 150);
  }
});
let resizeT = 0;

// hồ sơ đổi (sau thao tác, sau trận) → vẽ lại sảnh nếu đang mở
onMe(() => {
  if (S.screen === 'hub' && !S.modalClose) renderHub();
});
