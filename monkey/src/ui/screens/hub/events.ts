// Tab SỰ KIỆN: banner sự kiện đang mở, đếm ngược, thanh tiến trình mục tiêu, nút Nhận, ải sự kiện.

import type { EventObjective, EventState, MeResponse } from '@shared/monkey/api';
import { STAGE_BY_ID } from '@shared/monkey/progression';
import { api } from '../../../api';
import { fmt, h } from '../../dom';
import { act } from '../actions';
import { rewardChips } from '../items';
import { progressMap, stageDetail } from './stages';

const KIND: Record<EventObjective['kind'], string> = { kills: '🐒', clearStage: '🏁', reachWave: '🌊', playRuns: '🎮' };

function eventCard(es: EventState, me: MeResponse) {
  const e = es.event;
  const prog = progressMap(me);
  const now = Date.now();
  const started = new Date(e.startsAt).getTime() <= now;
  const card = h('div', { class: 'card evcard' });
  card.append(h('div', { class: 'evban' },
    h('div', { class: 'evic' }, e.icon || '🎉'),
    h('div', { class: 'evtx' }, h('h2', null, e.name), h('p', null, e.desc)),
    h('div', { class: 'evtime' }, started ? h('span', { 'data-ends': e.endsAt }) : h('span', null, `Bắt đầu ${new Date(e.startsAt).toLocaleString('vi-VN')}`))));
  const objs = h('div', { class: 'evobjs' });
  for (const o of e.objectives) {
    const v = Math.min(o.target, es.progress[o.id] ?? 0);
    const done = v >= o.target;
    const claimed = es.claimed.includes(o.id);
    objs.append(h('div', { class: `evo${done ? ' done' : ''}${claimed ? ' claimed' : ''}` },
      h('div', { class: 'evok' }, KIND[o.kind] ?? '🎯'),
      h('div', { class: 'evom' },
        h('div', { class: 'evol' }, h('b', null, o.label || (o.kind === 'clearStage' && o.stage ? `Qua ải ${STAGE_BY_ID[o.stage]?.name ?? o.stage}` : o.kind)), h('span', null, `${fmt(v)} / ${fmt(o.target)}`)),
        h('div', { class: 'evbar' }, h('div', { style: `transform:scaleX(${o.target ? v / o.target : 0})` })),
        rewardChips(o.reward)),
      claimed
        ? h('span', { class: 'evgot' }, '✔ ĐÃ NHẬN')
        : h('button', { class: `btn ${done ? 'green' : 'ghost'} sm`, disabled: !done, onclick: () => act(api.claimEvent(e.id, o.id), '🎁 Đã nhận thưởng!') }, done ? '🎁 NHẬN' : 'CHƯA ĐỦ')));
  }
  card.append(objs);
  if (e.stage && STAGE_BY_ID[e.stage]) {
    const def = STAGE_BY_ID[e.stage];
    card.append(h('div', { class: 'evstage' }, stageDetail(def, prog.get(def.id), started, { compact: true })));
  }
  return card;
}

export function renderEventsTab(body: HTMLElement, me: MeResponse) {
  const list = me.events.filter((e) => e.event.enabled !== false);
  if (!list.length) {
    body.append(h('div', { class: 'card evnone' }, h('div', { style: 'font-size:64px' }, '🍌'), h('h2', null, 'Chưa có sự kiện nào'), h('p', null, 'Sự kiện mới mở hằng tuần — quay lại sau nhé! Trong lúc chờ, hãy vượt ải để cày đồ.')));
    return;
  }
  body.append(h('div', { class: 'evtab' }, ...list.map((e) => eventCard(e, me))));
}
