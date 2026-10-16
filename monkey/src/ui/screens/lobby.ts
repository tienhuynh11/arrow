// Phòng chờ: ô người chơi (cấp, khách), chọn nhân vật, chủ phòng chọn chế độ (vô tận / vượt ải) + ải hoặc bản đồ.

import { CLASSES } from '@shared/monkey/content';
import { MAX_PLAYERS } from '@shared/monkey/config';
import { MODIFIER_INFO, STAGE_BY_ID } from '@shared/monkey/progression';
import { api } from '../../api';
import * as A from '../../audio';
import { store } from '../../settings';
import { clear, clsColor, clsIcon, h, playerColor, toast } from '../dom';
import { S, closeModal, nav, send, type Mode } from './ctx';
import { characterPicker, mapPicker } from './home';
import { lockState } from './hub/chars';
import { starsEl } from './hub/stages';

function stagePicker(cur: string | null, list: string[], editable: boolean, onPick: (id: string) => void) {
  const me = api.me;
  const stars = new Map(me?.stages.map((s) => [s.stage, s.stars]) ?? []);
  const wrap = h('div', { class: `lstages${editable ? '' : ' ro'}` });
  if (!list.length) {
    wrap.append(h('div', { class: 'empty' }, 'Chưa có ải nào mà mọi người trong phòng đều đã mở.'));
    return wrap;
  }
  for (const id of list) {
    const d = STAGE_BY_ID[id];
    if (!d) continue;
    wrap.append(h('button', {
      class: `lst${id === cur ? ' on' : ''}${d.event ? ' ev' : ''}`, disabled: !editable && id !== cur, title: d.mods.map((m) => MODIFIER_INFO[m].name).join(', '),
      onclick: () => { if (!editable || id === cur) return; A.sfxUi(); onPick(id); },
    }, h('b', null, d.event ? '🎉' : d.id), h('span', null, d.name), h('i', null, ...d.mods.map((m) => MODIFIER_INFO[m].icon)), starsEl(stars.get(id) ?? 0)));
  }
  return wrap;
}

export function renderLobby() {
  const r = S.room;
  if (!r) return;
  closeModal();
  const app = document.getElementById('app')!;
  clear(app);
  S.screen = 'lobby';
  const isHost = r.host === S.meIdx;
  const me = r.players.find((p) => p.idx === S.meIdx);
  const acc = api.me;
  const slots = h('div', { class: 'slots' });
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = r.players.find((q) => q.idx === i);
    if (!p) {
      slots.append(h('div', { class: 'slot' }, h('div', { style: 'opacity:.4;font-size:28px' }, '🐒'), h('div', { style: 'color:var(--dim);font-size:12px' }, 'Đang chờ…')));
      continue;
    }
    const st = !p.on ? h('div', { class: 'st off' }, 'MẤT KẾT NỐI') : p.idx === r.host ? h('div', { class: 'st host' }, 'CHỦ PHÒNG') : p.ready ? h('div', { class: 'st ok' }, 'SẴN SÀNG') : h('div', { class: 'st' }, 'CHƯA SẴN SÀNG');
    slots.append(h('div', { class: `slot filled${p.idx === S.meIdx ? ' me' : ''}`, style: `box-shadow:inset 0 3px 0 ${playerColor(p.idx)}` },
      h('div', { class: 'slav' }, clsIcon(p.cls, 40), p.guest ? h('i', { class: 'sltag g' }, 'KHÁCH') : p.level ? h('i', { class: 'sltag' }, `Lv ${p.level}`) : null),
      h('div', { class: 'nm' }, p.name),
      h('div', { style: `font-size:12px;color:${clsColor(p.cls)};font-weight:800` }, CLASSES[p.cls].name), st));
  }
  const notReady = r.players.filter((p) => p.idx !== r.host && p.on && !p.ready);
  const link = `${location.origin}${location.pathname}?room=${r.code}`;
  const hasModes = r.stages !== null || r.mode === 'stage';
  const mode: Mode = r.mode;
  const stageDef = r.stage ? STAGE_BY_ID[r.stage] : undefined;

  // ---- chế độ + ải / bản đồ ----
  const modeBox = h('div');
  if (hasModes) {
    const guests = r.players.some((p) => p.guest);
    modeBox.append(h('div', { class: 'field' }, h('label', null, isHost ? 'Chế độ' : 'Chế độ (chủ phòng chọn)')),
      h('div', { class: `seg lmode${isHost ? '' : ' ro'}` },
        h('button', { class: mode === 'endless' ? 'on' : '', disabled: !isHost && mode !== 'endless', onclick: () => { if (isHost && mode !== 'endless') { A.sfxUi(); send({ t: 'mode', mode: 'endless' }); } } }, '♾️ VÔ TẬN'),
        h('button', { class: mode === 'stage' ? 'on' : '', disabled: (!isHost && mode !== 'stage') || (isHost && guests), title: guests ? 'Có khách (chưa đăng nhập) trong phòng — vượt ải cần tài khoản' : '', onclick: () => { if (isHost && mode !== 'stage') { A.sfxUi(); send({ t: 'mode', mode: 'stage' }); } } }, '🗺️ VƯỢT ẢI')));
  }
  if (mode === 'stage') {
    modeBox.append(h('div', { class: 'field' }, h('label', null, isHost ? 'Chọn ải (mọi người đều đã mở)' : 'Ải (chủ phòng chọn)')),
      stagePicker(r.stage, r.stages ?? (r.stage ? [r.stage] : []), isHost, (id) => send({ t: 'stage', stage: id })),
      stageDef ? h('div', { class: 'mapinfo' }, `${stageDef.waves} đợt · độ khó ×${stageDef.diff.toFixed(2)}`, stageDef.mods.length ? ` · ${stageDef.mods.map((m) => `${MODIFIER_INFO[m].icon} ${MODIFIER_INFO[m].name}`).join(' · ')}` : '') : '');
  } else {
    modeBox.append(h('div', { class: 'field' }, h('label', null, isHost ? 'Bản đồ' : 'Bản đồ (chủ phòng chọn)')),
      mapPicker(r.map, isHost, (id) => send({ t: 'map', id })));
  }

  const locked = acc ? (i: number) => lockState(acc, i)?.text ?? null : undefined;
  app.append(h('div', { class: 'lobby' }, h('div', { class: 'card' },
    h('div', { class: 'code' },
      h('div', null, h('div', { style: 'font-size:12px;letter-spacing:.14em;color:var(--dim);font-weight:800' }, mode === 'stage' && stageDef ? `MÃ PHÒNG · ẢI ${stageDef.event ? stageDef.name : stageDef.id}` : 'MÃ PHÒNG'), h('div', { class: 'v' }, r.code)),
      h('button', { class: 'btn ghost sm', onclick: () => { navigator.clipboard?.writeText(r.code).then(() => toast('Đã chép mã phòng', true)).catch(() => {}); } }, '📋 Chép mã'),
      h('button', { class: 'btn ghost sm', onclick: () => { navigator.clipboard?.writeText(link).then(() => toast('Đã chép đường dẫn mời', true)).catch(() => {}); } }, '🔗 Chép link mời'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', onclick: () => nav.help() }, '❓'),
      h('button', { class: 'btn ghost sm', onclick: () => { send({ t: 'leave' }); } }, '← Rời phòng')),
    slots,
    h('div', { class: 'lcols' },
      h('div', null,
        h('div', { class: 'field' }, h('label', null, 'Nhân vật của bạn')),
        characterPicker((c) => {
          S.myCls = c;
          store('monkey-cls', String(c));
          send({ t: 'cls', cls: c });
          if (api.me && api.me.profile.cls !== c) api.selectChar(c).catch(() => {});
        }, me?.cls ?? S.myCls, locked)),
      h('div', null, modeBox)),
    h('div', { class: 'row' },
      h('div', { class: 'grow', style: 'color:var(--dim);font-size:13px' },
        isHost ? (notReady.length ? `Đang chờ: ${notReady.map((p) => p.name).join(', ')}` : r.players.length === 1 ? `Chơi một mình được — hoặc gửi mã cho bạn bè (tối đa ${MAX_PLAYERS} người).` : 'Mọi người đã sẵn sàng!') : 'Chủ phòng sẽ bắt đầu khi mọi người sẵn sàng.'),
      isHost
        ? h('button', { class: 'btn green big', disabled: notReady.length > 0 || (mode === 'stage' && !r.stage), onclick: () => { A.initAudio(); nav.goFullscreen(); send({ t: 'start' }); } }, '▶ BẮT ĐẦU')
        : h('button', { class: `btn big ${me?.ready ? 'ghost' : 'green'}`, onclick: () => { A.initAudio(); if (!me?.ready) nav.goFullscreen(); send({ t: 'ready', r: !me?.ready }); } }, me?.ready ? 'HUỶ SẴN SÀNG' : '✔ SẴN SÀNG')))));
}
