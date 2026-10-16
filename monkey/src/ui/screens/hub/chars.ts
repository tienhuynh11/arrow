// Tab NHÂN VẬT: 7 nhân vật (khoá / điều kiện mở / nút mở), xem 3D mặc đúng đồ, chọn, nâng kỹ năng G / X / Q.

import type { MeResponse } from '@shared/monkey/api';
import { CLASSES } from '@shared/monkey/content';
import { CHAR_UNLOCK, ITEM_BY_ID, SKILL_MAX, skillCost, skillCostMul, skillPower, unlockText, type SkillKey, type Slot } from '@shared/monkey/progression';
import { api } from '../../../api';
import * as A from '../../../audio';
import { AvatarPreview } from '../../../render/preview';
import { keyLabel, settings } from '../../../settings';
import { clear, clsColor, clsIcon, fmt, h } from '../../dom';
import { act } from '../actions';
import { CUR } from '../items';
import { clearedSet } from './stages';

let viewCls: number | null = null;
let preview: AvatarPreview | null = null;
let previewKey = '';

export function disposeCharsTab() {
  preview?.dispose();
  preview = null;
  previewKey = '';
}

export function equippedLook(me: MeResponse): Partial<Record<Slot, string>> {
  const look: Partial<Record<Slot, string>> = {};
  for (const it of me.items) if (it.equipped) {
    const d = ITEM_BY_ID[it.itemId];
    if (d) look[d.slot] = d.id;
  }
  return look;
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

export function renderCharsTab(body: HTMLElement, me: MeResponse) {
  const p = me.profile;
  if (viewCls === null || !CLASSES[viewCls]) viewCls = p.cls;
  const cls = viewCls;
  const c = CLASSES[cls];
  const lock = lockState(me, cls);
  const look = equippedLook(me);

  const list = h('div', { class: 'card chlist' },
    ...CLASSES.map((cc, i) => {
      const lk = lockState(me, i);
      return h('button', { class: `chit${i === cls ? ' on' : ''}${lk ? ' lk' : ''}${i === p.cls ? ' cur' : ''}`, onclick: () => { viewCls = i; A.sfxUi(); body.replaceChildren(); renderCharsTab(body, me); } },
        clsIcon(i, 38),
        h('div', null, h('b', null, cc.name), h('span', null, lk ? `🔒 ${lk.text}` : i === p.cls ? '✔ Đang dùng' : cc.role)),
        lk?.can ? h('em', { class: 'badge' }, '!') : null);
    }));

  // ---- 3D ----
  const key = `${cls}|${JSON.stringify(look)}`;
  if (!preview) preview = new AvatarPreview(cls, look);
  else if (key !== previewKey) preview.setChar(cls, look);
  previewKey = key;
  const pv = h('div', { class: 'card chprev', style: `--cc:${clsColor(cls)}` });
  if (preview.ok) pv.append(preview.el);
  else pv.append(h('div', { class: 'chfallback' }, clsIcon(cls, 120)));
  pv.append(h('div', { class: 'chhint' }, '↔ kéo để xoay · nháy đúp để chém'));
  if (lock) pv.append(h('div', { class: 'chlock' }, '🔒'));

  // ---- thông tin + kỹ năng ----
  const info = h('div', { class: 'card chinfo' });
  info.append(
    h('div', { class: 'chhead' },
      h('div', null, h('h2', null, c.name), h('div', { class: 'chrole', style: `color:${clsColor(cls)}` }, c.role)),
      lock
        ? h('button', { class: 'btn', disabled: !lock.can, title: lock.text, onclick: () => act(api.unlockChar(cls), `Đã mở khoá ${c.name}!`) }, lock.can ? '🔓 MỞ KHOÁ' : `🔒 ${lock.text}`)
        : cls === p.cls
          ? h('span', { class: 'chusing' }, '✔ ĐANG DÙNG')
          : h('button', { class: 'btn green', onclick: () => act(api.selectChar(cls), `Đã chọn ${c.name}`) }, '✔ CHỌN')),
    h('p', { class: 'chdesc' }, c.desc),
    h('div', { class: 'chstats' },
      h('span', null, '♥ ', h('b', null, c.hp), ' máu'),
      h('span', null, '🏃 ', h('b', null, `${Math.round(c.speed * 10) / 10}`), ' m/s'),
      h('span', { title: c.weapons.map((w) => w.name).join(' → ') }, '🔫 ', h('b', null, c.weapons[0].short), ' → ', h('b', null, c.weapons[c.weapons.length - 1].short))),
    h('div', { class: 'chpass' }, h('b', null, 'Nội tại: '), c.passive),
  );
  const skills = h('div', { class: 'chsk' });
  const keys: [SkillKey, string][] = [['g', settings.keys.skillG], ['x', settings.keys.skillX], ['q', settings.keys.ult]];
  for (const [k, code] of keys) {
    const sk = c[k] as { name: string; desc: string; icon: string; cost?: number; cd?: number };
    const lv = skillLv(me, cls, k);
    const max = lv >= SKILL_MAX;
    const cost = skillCost(lv + 1);
    const poor = p.gold < cost.gold || p.books < cost.books;
    skills.append(h('div', { class: 'skrow' },
      h('div', { class: 'skic' }, sk.icon, h('i', null, keyLabel(code))),
      h('div', { class: 'sktx' },
        h('div', null, h('b', null, sk.name), h('span', { class: 'pips' }, ...Array.from({ length: SKILL_MAX }, (_, i) => h('i', { class: i < lv ? 'on' : '' })))),
        h('div', { class: 'skd' }, sk.desc),
        h('div', { class: 'ske' }, `Sức mạnh ×${skillPower(lv).toFixed(1)}`, k !== 'q' ? ` · Giá & hồi chiêu ×${skillCostMul(lv).toFixed(2)}` : '',
          !max ? h('em', null, ` → ×${skillPower(lv + 1).toFixed(1)}`) : null)),
      max
        ? h('span', { class: 'skmax' }, 'TỐI ĐA')
        : h('button', { class: `btn sm${poor ? ' ghost' : ''}`, disabled: !!lock || poor, title: lock ? 'Mở khoá nhân vật trước' : poor ? 'Thiếu vàng hoặc sách' : '', onclick: () => act(api.upgradeSkill(cls, k), `${sk.name} lên cấp ${lv + 1}!`) },
          `⬆ ${CUR.gold}${fmt(cost.gold)} ${CUR.books}${cost.books}`)));
  }
  info.append(h('div', { class: 'sdt' }, 'KỸ NĂNG'), skills);

  const wrap = h('div', { class: 'ctab' }, list, pv, info);
  clear(body);
  body.append(wrap);
}
