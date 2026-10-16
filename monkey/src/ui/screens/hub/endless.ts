// Tab VÔ TẬN: chế độ cũ (đợt khỉ tăng mãi) — chọn bản đồ, chơi một mình / tạo phòng, bảng xếp hạng vô tận.

import type { MeResponse } from '@shared/monkey/api';
import { CLASSES } from '@shared/monkey/content';
import { store } from '../../../settings';
import { clsIcon, h } from '../../dom';
import { createRoom } from '../actions';
import { S, nav } from '../ctx';
import { mapPicker, wsBoard } from '../home';

export function renderEndlessTab(body: HTMLElement, me: MeResponse) {
  const c = CLASSES[me.profile.cls];
  body.append(h('div', { class: 'entab' },
    h('div', { class: 'card enl' },
      h('h2', { class: 'tabttl' }, '♾️ CHẾ ĐỘ VÔ TẬN'),
      h('p', { class: 'idesc' }, 'Đợt khỉ tăng mãi cho tới khi cả đội gục. Trụ càng lâu, điểm càng cao — có thưởng an ủi XP + vàng theo số đợt đã qua.'),
      h('div', { class: 'encur' }, clsIcon(me.profile.cls, 44), h('div', null, h('b', null, c.name), h('span', null, c.role)), h('button', { class: 'btn ghost sm', onclick: () => nav.hub('chars') }, 'Đổi nhân vật')),
      h('div', { class: 'field' }, h('label', null, 'Bản đồ')),
      mapPicker(S.myMap, true, (id) => { S.myMap = id; store('monkey-map', id); }),
      h('div', { class: 'row' },
        h('button', { class: 'btn big grow', onclick: () => createRoom({ solo: true, mode: 'endless', map: S.myMap }) }, '▶ CHƠI MỘT MÌNH'),
        h('button', { class: 'btn green big grow', onclick: () => createRoom({ solo: false, mode: 'endless', map: S.myMap }) }, '👥 TẠO PHÒNG'))),
    h('div', { class: 'card enr' }, h('h3', { class: 'sdt' }, '🏆 VÔ TẬN — TOP 10'), wsBoard())));
}
