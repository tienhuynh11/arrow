// Cửa sổ KỸ NĂNG (K): 3 kỹ năng G / X / Q của nhân vật đang dùng — cấp, mô tả, nâng cấp bằng vàng + sách.

import type { MeResponse } from '@shared/monkey/api';
import { CLASSES } from '@shared/monkey/content';
import { SKILL_MAX, skillCost, skillCostMul, skillPower, type SkillKey } from '@shared/monkey/progression';
import { api } from '../../../api';
import * as A from '../../../audio';
import { keyLabel, settings } from '../../../settings';
import { clsIcon, fmt, h } from '../../dom';
import { act } from '../actions';
import type { HubCtx } from '../hub';
import { CUR } from '../items';
import { lockState, skillLv } from './chars';

let viewCls: number | null = null;

export function renderSkillsWin(body: HTMLElement, me: MeResponse, ctx: HubCtx) {
  const p = me.profile;
  if (viewCls === null || !CLASSES[viewCls] || lockState(me, viewCls)) viewCls = p.cls;
  const cls = viewCls;
  const c = CLASSES[cls];
  const owned = CLASSES.map((_, i) => i).filter((i) => !lockState(me, i));
  body.append(h('div', { class: 'row', style: 'gap:4px;margin-bottom:8px' },
    ...owned.map((i) => h('button', { class: `vb sm${i === cls ? ' gold' : ''}`, title: CLASSES[i].name, onclick: () => { viewCls = i; A.sfxUi(); ctx.redraw(); } }, clsIcon(i, 20), CLASSES[i].name))));
  const keys: [SkillKey, string, string][] = [['g', settings.keys.skillG, 'Kỹ năng 1'], ['x', settings.keys.skillX, 'Kỹ năng 2'], ['q', settings.keys.ult, 'Tuyệt chiêu']];
  const list = h('div', { class: 'skl' });
  for (const [k, code, kindName] of keys) {
    const sk = c[k] as { name: string; desc: string; icon: string; cost?: number; cd?: number };
    const lv = skillLv(me, cls, k);
    const max = lv >= SKILL_MAX;
    const cost = skillCost(lv + 1);
    const poor = p.gold < cost.gold || p.books < cost.books;
    list.append(h('div', { class: 'box2 skr' },
      h('div', { class: 'skic2' }, sk.icon, h('kbd', null, keyLabel(code))),
      h('div', null,
        h('div', null, h('b', null, sk.name), h('span', { class: 'dim', style: 'font-size:11px;margin-left:6px' }, kindName), h('span', { class: 'pips' }, ...Array.from({ length: SKILL_MAX }, (_, i) => h('i', { class: i < lv ? 'on' : '' })))),
        h('div', { class: 'skd' }, sk.desc),
        h('div', { class: 'ske' }, `Sức mạnh ×${skillPower(lv).toFixed(1)}`, k !== 'q' ? ` · Hồi chiêu ×${skillCostMul(lv).toFixed(2)}` : '', sk.cd ? ` · ${sk.cd}s` : '',
          !max ? h('em', null, ` → ×${skillPower(lv + 1).toFixed(1)}`) : null)),
      max ? h('span', { style: 'color:var(--gold-hi);font-weight:900' }, 'TỐI ĐA')
        : h('button', { class: `vb sm${poor ? '' : ' gold'}`, disabled: poor, title: poor ? 'Thiếu vàng hoặc sách' : '', onclick: () => act(api.upgradeSkill(cls, k), `${sk.name} lên cấp ${lv + 1}!`) },
          `⬆ ${CUR.gold}${fmt(cost.gold)} ${CUR.books}${cost.books}`)));
  }
  body.append(list, h('div', { class: 'parch', style: 'margin-top:8px' }, h('b', null, 'Nội tại: '), c.passive, h('br'), 'Trong ải không có xu: kỹ năng chỉ tính hồi chiêu, không tốn tiền.'));
  return h('div', null, h('span', null, CUR.gold, ' ', h('b', { style: 'color:var(--gold-hi)' }, fmt(p.gold))), h('span', null, ' ', CUR.books, ' ', h('b', null, fmt(p.books))), h('span', { class: 'grow' }), h('span', { class: 'dim' }, `Đang dùng: ${CLASSES[p.cls].name}`));
}
