// Sảnh chờ cho người đã đăng nhập: thẻ người chơi + 6 tab (Vượt ải, Nhân vật, Kho đồ, Sự kiện, Vô tận, Xếp hạng).

import { CODE_LEN } from '@shared/monkey/config';
import { CLASSES } from '@shared/monkey/content';
import type { MeResponse } from '@shared/monkey/api';
import { LEVEL_MAX, xpToNext } from '@shared/monkey/progression';
import { api, onMe } from '../../api';
import * as A from '../../audio';
import { clear, clsIcon, fmt, h, toast } from '../dom';
import { S, closeModal, nav, type HubTab } from './ctx';
import { countdown, joinRoom } from './actions';
import { CUR } from './items';
import { renderStagesTab } from './hub/stages';
import { renderCharsTab, disposeCharsTab } from './hub/chars';
import { renderInvTab } from './hub/inventory';
import { renderEventsTab } from './hub/events';
import { renderEndlessTab } from './hub/endless';
import { renderRankTab } from './hub/rank';

const TABS: { id: HubTab; icon: string; name: string }[] = [
  { id: 'stages', icon: '🗺️', name: 'Vượt ải' },
  { id: 'chars', icon: '🧍', name: 'Nhân vật' },
  { id: 'inv', icon: '🎒', name: 'Kho đồ' },
  { id: 'events', icon: '🎉', name: 'Sự kiện' },
  { id: 'endless', icon: '♾️', name: 'Vô tận' },
  { id: 'rank', icon: '🏆', name: 'Xếp hạng' },
];

let tick = 0;
let loading = false;

/** đếm ngược mọi phần tử [data-ends] (ISO) trong sảnh */
function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('.hub [data-ends]').forEach((el) => {
    const ms = new Date(el.dataset.ends!).getTime() - now;
    el.textContent = countdown(ms);
  });
}
function playerCard(me: MeResponse) {
  const p = me.profile;
  const need = xpToNext(p.level);
  const pct = p.level >= LEVEL_MAX ? 1 : Math.min(1, p.xp / Math.max(1, need));
  return h('div', { class: 'pcard' },
    h('div', { class: 'pav' }, clsIcon(p.cls, 46), h('i', { class: 'plv' }, p.level)),
    h('div', { class: 'pinfo' },
      h('div', { class: 'pname' }, h('b', null, p.username), h('span', null, CLASSES[p.cls]?.name ?? '')),
      h('div', { class: 'xpbar', title: `${fmt(p.xp)} / ${fmt(need)} XP` }, h('div', { style: `transform:scaleX(${pct})` }), h('span', null, p.level >= LEVEL_MAX ? 'CẤP TỐI ĐA' : `Cấp ${p.level} · ${fmt(p.xp)}/${fmt(need)} XP`))));
}

function currencies(me: MeResponse) {
  const p = me.profile;
  return h('div', { class: 'curr' },
    h('span', { title: 'Vàng — nâng cấp đồ, kỹ năng' }, CUR.gold, h('b', null, fmt(p.gold))),
    h('span', { title: 'Mảnh nhân vật — ghép Pháo Thủ' }, CUR.shards, h('b', null, fmt(p.shards))),
    h('span', { title: 'Sách kỹ năng — nâng G / X / Q' }, CUR.books, h('b', null, fmt(p.books))));
}

function actions() {
  const codeIn = h('input', { maxlength: String(CODE_LEN), placeholder: 'MÃ PHÒNG', value: S.pendingJoin ?? '', autocomplete: 'off' }) as HTMLInputElement;
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(codeIn.value); });
  return h('div', { class: 'hubact' },
    h('div', { class: 'join' }, codeIn, h('button', { class: 'btn ghost sm', onclick: () => joinRoom(codeIn.value) }, 'VÀO')),
    h('button', { class: 'iconbtn', title: 'Cài đặt', onclick: () => { A.initAudio(); nav.settings(); } }, '⚙'),
    h('button', { class: 'iconbtn', title: 'Cách chơi', onclick: () => { A.initAudio(); nav.help(); } }, '❓'),
    document.fullscreenEnabled ? h('button', { class: 'iconbtn', title: 'Toàn màn hình', onclick: () => nav.toggleFullscreen() }, '⛶') : null,
    h('button', { class: 'iconbtn', title: 'Đăng xuất', onclick: () => nav.logout() }, '⏻'));
}

function eventBadge(me: MeResponse) {
  let n = 0;
  for (const e of me.events) for (const o of e.event.objectives) if ((e.progress[o.id] ?? 0) >= o.target && !e.claimed.includes(o.id)) n++;
  return n;
}

export function renderHub(tab?: HubTab) {
  if (tab) S.hubTab = tab;
  if (S.hubTab !== 'chars') disposeCharsTab();
  const app = document.getElementById('app')!;
  const me = api.me;
  if (S.screen !== 'hub') closeModal();
  S.screen = 'hub';
  clear(app);
  if (!me) {
    app.append(h('div', { class: 'hub loading' }, h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'spin' }), h('p', null, 'Đang tải hồ sơ…'))));
    if (!loading) {
      loading = true;
      api.refresh().catch((e) => { if (api.loggedIn) { toast((e as Error).message); nav.login(); } }).finally(() => { loading = false; });
    }
    return;
  }
  const body = h('div', { class: `hubbody t-${S.hubTab}` });
  const evN = eventBadge(me);
  const tabs = h('div', { class: 'hubtabs', role: 'tablist' },
    ...TABS.map((t) => h('button', {
      class: S.hubTab === t.id ? 'on' : '', role: 'tab',
      onclick: () => { if (S.hubTab === t.id) return; A.sfxUi(); renderHub(t.id); },
    }, h('i', null, t.icon), h('span', null, t.name), t.id === 'events' && evN ? h('em', { class: 'badge' }, evN) : null)));
  app.append(h('div', { class: 'hub' },
    h('div', { class: 'hubtop' }, playerCard(me), currencies(me), actions()),
    tabs,
    body));
  try {
    switch (S.hubTab) {
      case 'stages': renderStagesTab(body, me); break;
      case 'chars': renderCharsTab(body, me); break;
      case 'inv': renderInvTab(body, me); break;
      case 'events': renderEventsTab(body, me); break;
      case 'endless': renderEndlessTab(body, me); break;
      case 'rank': renderRankTab(body, me); break;
    }
  } catch (e) {
    console.error(e);
    body.append(h('div', { class: 'empty' }, 'Không hiển thị được mục này.'));
  }
  if (!tick) tick = window.setInterval(tickCountdowns, 1000);
  tickCountdowns();
  if (S.pendingJoin) {
    const c = S.pendingJoin;
    S.pendingJoin = null;
    setTimeout(() => joinRoom(c), 300);
  }
}

// hồ sơ đổi (sau thao tác, sau trận) → vẽ lại sảnh nếu đang mở
onMe(() => {
  if (S.screen === 'hub' && !S.modalClose) renderHub();
});
