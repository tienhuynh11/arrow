// Tab XẾP HẠNG: bảng xếp hạng từ DB theo ải hoặc vô tận, một mình / đồng đội.

import type { LeaderRow, MeResponse } from '@shared/monkey/api';
import { EVENT_STAGES, STAGES } from '@shared/monkey/progression';
import { api } from '../../../api';
import { CLASS_ICON, clear, fmt, h, timeStr } from '../../dom';

let which = 'endless';
let solo = true;
const cache = new Map<string, { at: number; rows: LeaderRow[] }>();

export function renderRankTab(body: HTMLElement, me: MeResponse) {
  const table = h('div', { class: 'rkbody' });
  const sel = h('select', { class: 'rksel' }) as HTMLSelectElement;
  sel.append(h('option', { value: 'endless' }, '♾️ Vô tận'));
  for (const ch of [1, 2, 3]) {
    const g = h('optgroup', { label: `Chương ${ch}` });
    for (const s of STAGES.filter((x) => x.chapter === ch)) g.append(h('option', { value: s.id }, `${s.id} · ${s.name}`));
    sel.append(g);
  }
  if (EVENT_STAGES.length) {
    const g = h('optgroup', { label: 'Sự kiện' });
    for (const s of EVENT_STAGES) g.append(h('option', { value: s.id }, `🎉 ${s.name}`));
    sel.append(g);
  }
  sel.value = which;
  const seg = h('div', { class: 'seg' });
  const drawSeg = () => {
    clear(seg);
    seg.append(
      h('button', { class: solo ? 'on' : '', onclick: () => { solo = true; drawSeg(); load(); } }, 'MỘT MÌNH'),
      h('button', { class: solo ? '' : 'on', onclick: () => { solo = false; drawSeg(); load(); } }, 'ĐỒNG ĐỘI'));
  };
  const show = (rows: LeaderRow[]) => {
    clear(table);
    if (!rows.length) {
      table.append(h('div', { class: 'empty' }, 'Chưa có ai ghi danh — hãy là người đầu tiên!'));
      return;
    }
    const stage = which !== 'endless';
    const t = h('table', { class: 'lb' }, h('tr', null, h('th', null, '#'), h('th', null, 'NGƯỜI CHƠI'),
      h('th', { class: 'n' }, stage ? 'THỜI GIAN' : 'ĐỢT'), h('th', { class: 'n' }, 'ĐIỂM'), h('th', { class: 'n' }, 'HẠ'), h('th', { class: 'n' }, 'NGÀY')));
    rows.forEach((r, i) => {
      const mine = r.names.includes(me.profile.username);
      t.append(h('tr', { class: mine ? 'me' : '' },
        h('td', null, h('span', { class: 'medal' }, i + 1)),
        h('td', { class: 'names', title: r.names.join(', ') }, r.names.map((n, k) => `${CLASS_ICON[r.cls[k]] ?? ''}${n}`).join(' · ')),
        h('td', { class: 'n' }, stage ? timeStr(r.secs) : r.wave),
        h('td', { class: 'n' }, fmt(r.score)),
        h('td', { class: 'n' }, r.kills),
        h('td', { class: 'n dim' }, r.at ? new Date(r.at).toLocaleDateString('vi-VN') : '')));
    });
    table.append(t);
  };
  const load = async () => {
    const key = `${which}|${solo}`;
    const c = cache.get(key);
    if (c) show(c.rows);
    if (c && Date.now() - c.at < 30000) return;
    if (!c) { clear(table); table.append(h('div', { class: 'empty' }, h('div', { class: 'spin' }), 'Đang tải…')); }
    try {
      const rows = await api.leaderboard(which, solo);
      cache.set(key, { at: Date.now(), rows });
      if (`${which}|${solo}` === key && table.isConnected) show(rows);
    } catch (e) {
      if (table.isConnected) { clear(table); table.append(h('div', { class: 'empty' }, `Không tải được: ${(e as Error).message}`)); }
    }
  };
  sel.addEventListener('change', () => { which = sel.value; load(); });
  drawSeg();
  body.append(h('div', { class: 'card rktab' }, h('div', { class: 'rkhead' }, h('h2', { class: 'tabttl' }, '🏆 BẢNG XẾP HẠNG'), sel, seg), table));
  load();
}
