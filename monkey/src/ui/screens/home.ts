// Màn chính cho KHÁCH (vô tận, không tài khoản) + các bộ chọn dùng chung: nhân vật, bản đồ, bảng xếp hạng WS.

import { CLASSES } from '@shared/monkey/content';
import { CODE_LEN, MAX_PLAYERS, NAME_MAX } from '@shared/monkey/config';
import { MAPS, MAP_RANDOM } from '@shared/monkey/map';
import type { BoardEntry } from '@shared/monkey/proto';
import * as A from '../../audio';
import { keyLabel, settings, store } from '../../settings';
import { CLASS_ICON, clear, clsIcon, fmt, h, toast } from '../dom';
import { S, closeModal, nav, send } from './ctx';

const app = () => document.getElementById('app')!;

/** chọn nhân vật; locked(i) → ô bị khoá (chỉ xem), lockText(i) chú thích */
export function characterPicker(onPick: (c: number) => void, cur: number, locked?: (i: number) => string | null) {
  const wrap = h('div');
  const grid = h('div', { class: 'classes' });
  const info = h('div', { class: 'clsinfo' });
  const draw = () => {
    clear(grid);
    CLASSES.forEach((c, i) => {
      const lk = locked?.(i) ?? null;
      grid.append(h('button', {
        class: `cls${i === cur ? ' on' : ''}${lk ? ' lockd' : ''}`, title: lk ?? c.desc,
        onclick: () => { if (lk) { toast(`🔒 ${c.name}: ${lk}`); return; } cur = i; onPick(i); A.sfxUi(); draw(); },
      }, clsIcon(i), h('b', null, c.name), h('span', null, lk ? `🔒 ${lk}` : c.role)));
    });
    const c = CLASSES[cur];
    clear(info);
    info.append(
      h('b', null, `${c.name} — `), c.desc, h('br'),
      h('span', { class: 'k' }, '♥'), `${c.hp} máu · ${c.passive}`, h('br'),
      h('span', { class: 'k' }, '🔫'), c.weapons.map((w) => w.short).join(' → '), h('br'),
      h('span', { class: 'k' }, keyLabel(settings.keys.skillG)), h('span', { title: c.g.desc }, `${c.g.icon} ${c.g.name} (${c.g.cost} xu) `),
      h('span', { class: 'k' }, keyLabel(settings.keys.skillX)), h('span', { title: c.x.desc }, `${c.x.icon} ${c.x.name} (${c.x.cost} xu) `),
      h('span', { class: 'k' }, keyLabel(settings.keys.ult)), h('span', { title: c.q.desc }, `${c.q.icon} ${c.q.name}`),
    );
  };
  draw();
  wrap.append(grid, info);
  return wrap;
}

/** chọn bản đồ: "Ngẫu nhiên" + từng bản đồ; editable = false → chỉ xem (người không phải chủ phòng) */
export function mapPicker(cur: string, editable: boolean, onPick: (id: string) => void) {
  const wrap = h('div');
  const grid = h('div', { class: `maps${editable ? '' : ' ro'}` });
  const info = h('div', { class: 'mapinfo' });
  const opts = [
    { id: MAP_RANDOM, emoji: '🎲', name: 'Ngẫu nhiên', sub: 'bốc thăm', desc: 'Máy chủ bốc thăm một bản đồ khi bắt đầu trận.' },
    ...MAPS.map((m) => ({ id: m.id, emoji: m.emoji, name: m.name, sub: `${m.arena * 2}×${m.arena * 2} m`, desc: m.desc })),
  ];
  const draw = () => {
    clear(grid);
    for (const o of opts) {
      grid.append(h('button', { class: `mapc${o.id === cur ? ' on' : ''}`, title: o.desc, disabled: !editable && o.id !== cur, onclick: () => { if (!editable || o.id === cur) return; cur = o.id; onPick(o.id); A.sfxUi(); draw(); } }, h('i', null, o.emoji), h('b', null, o.name), h('span', null, o.sub)));
    }
    clear(info);
    info.append((opts.find((o) => o.id === cur) ?? opts[0]).desc);
  };
  draw();
  wrap.append(grid, info);
  return wrap;
}

export function boardTable(list: BoardEntry[], hl?: BoardEntry | null) {
  if (!list.length) return h('div', { class: 'empty' }, 'Chưa có ai ghi danh — hãy là người đầu tiên!');
  const t = h('table', { class: 'lb' }, h('tr', null, h('th', null, '#'), h('th', null, 'NGƯỜI CHƠI'), h('th', { class: 'n' }, 'ĐỢT'), h('th', { class: 'n' }, 'ĐIỂM'), h('th', { class: 'n' }, 'HẠ')));
  list.forEach((e, i) => {
    const me = hl && e.at === hl.at && e.score === hl.score;
    t.append(h('tr', { class: me ? 'me' : '' },
      h('td', null, h('span', { class: 'medal' }, i + 1)),
      h('td', { class: 'names', title: e.names.join(', ') }, e.names.map((n, k) => `${CLASS_ICON[e.cls[k]] ?? ''}${n}`).join(' · ')),
      h('td', { class: 'n' }, e.wave),
      h('td', { class: 'n' }, fmt(e.score)),
      h('td', { class: 'n' }, e.kills)));
  });
  return t;
}

/** bảng xếp hạng vô tận (WS) có tab Một mình / Đồng đội */
export function wsBoard() {
  const box = h('div');
  const draw = () => {
    clear(box);
    box.append(
      h('div', { class: 'tabs' },
        h('button', { class: S.lbTab === 'solo' ? 'on' : '', onclick: () => { S.lbTab = 'solo'; draw(); } }, 'MỘT MÌNH'),
        h('button', { class: S.lbTab === 'team' ? 'on' : '', onclick: () => { S.lbTab = 'team'; draw(); } }, 'ĐỒNG ĐỘI')),
      boardTable((S.lbTab === 'solo' ? S.lb.solo : S.lb.team).slice(0, 10)),
    );
  };
  draw();
  return box;
}

function nameOk() {
  const n = S.name.trim();
  if (!n) {
    toast('Nhập tên trước đã!');
    (document.querySelector('.home .field input') as HTMLInputElement | null)?.focus();
    return false;
  }
  store('monkey-name', n);
  return true;
}

export function renderHome() {
  closeModal();
  const root = app();
  clear(root);
  S.screen = 'home';
  const nameIn = h('input', { maxlength: String(NAME_MAX), placeholder: 'Tên của bạn', value: S.name, autocomplete: 'off' }) as HTMLInputElement;
  nameIn.addEventListener('input', () => { S.name = nameIn.value; });
  const codeIn = h('input', { maxlength: String(CODE_LEN), placeholder: 'MÃ', value: S.pendingJoin ?? '' }) as HTMLInputElement;
  const join = () => {
    A.initAudio();
    if (!nameOk()) return;
    const code = codeIn.value.trim().toUpperCase();
    if (code.length < 4) return toast('Mã phòng gồm 5 ký tự');
    send({ t: 'join', code, name: S.name.trim(), cls: S.myCls });
  };
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  const create = (solo: boolean) => {
    A.initAudio();
    if (!nameOk()) return;
    if (solo) nav.goFullscreen();
    send({ t: 'create', name: S.name.trim(), cls: S.myCls, solo, map: S.myMap, mode: 'endless' });
  };
  root.append(h('div', { class: 'home' },
    h('div', { class: 'card main' },
      h('div', { class: 'guestbar' }, h('span', null, '👤 Đang chơi KHÁCH — chỉ chế độ vô tận, không lưu đồ.'), h('button', { class: 'btn sm', onclick: () => nav.login() }, '🔑 Đăng nhập')),
      h('div', { class: 'field' }, h('label', null, 'Tên'), nameIn),
      h('div', { class: 'field' }, h('label', null, 'Chọn nhân vật')),
      characterPicker((c) => { S.myCls = c; store('monkey-cls', String(c)); }, S.myCls),
      h('div', { class: 'field' }, h('label', null, 'Bản đồ')),
      mapPicker(S.myMap, true, (id) => { S.myMap = id; store('monkey-map', id); }),
      h('div', { class: 'row' },
        h('button', { class: 'btn big grow', onclick: () => create(true) }, '▶ CHƠI MỘT MÌNH'),
        h('button', { class: 'btn green big grow', onclick: () => create(false) }, '👥 TẠO PHÒNG')),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('div', { class: 'grow', style: 'font-size:13px;color:var(--dim)' }, 'Có mã phòng của bạn bè?'),
        h('div', { class: 'join' }, codeIn, h('button', { class: 'btn ghost', onclick: join }, 'VÀO PHÒNG')))),
    h('div', { class: 'side' },
      h('h1', { class: 'logo' }, 'SINH TỒN', h('small', null, 'BẦY KHỈ 🐒')),
      h('p', { class: 'tag' }, `Bắn súng sinh tồn co-op 1–${MAX_PLAYERS} người. Bầy khỉ ùa ra từ rừng mỗi đợt một đông — hạ khỉ kiếm xu, nâng cấp súng, dùng kỹ năng nhân vật và đỡ đồng đội dậy. Trụ được bao nhiêu đợt?`),
      h('div', { class: 'card lbcard' }, h('h3', { style: 'margin:0 0 10px;letter-spacing:.12em;font-size:13px;color:var(--dim)' }, '🏆 BẢNG XẾP HẠNG'), wsBoard()),
      h('div', { class: 'foot' },
        h('button', { class: 'btn ghost grow', onclick: () => { A.initAudio(); nav.help(); } }, '❓ CÁCH CHƠI'),
        h('button', { class: 'btn ghost grow', onclick: () => { A.initAudio(); nav.settings(); } }, '⚙ CÀI ĐẶT'),
        document.fullscreenEnabled ? h('button', { class: 'btn ghost', title: 'Toàn màn hình', onclick: () => nav.toggleFullscreen() }, '⛶') : null))));
  if (!S.name) setTimeout(() => nameIn.focus(), 50);
  if (S.pendingJoin && S.name) {
    S.pendingJoin = null;
    setTimeout(join, 400);
  }
}
