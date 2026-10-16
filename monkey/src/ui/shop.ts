// CỬA HÀNG: nâng bậc súng, nâng máu, xem kỹ năng lớp. Mua được mọi lúc (trận KHÔNG tạm dừng!).
// Thẻ hình ảnh: hình súng/tim/kỹ năng vẽ SVG (ui/icons.ts) + thanh chỉ số so với súng đang dùng.

import type { GameModel } from '@shared/monkey/client';
import { CLASSES, HP_TIER_BONUS, HP_TIER_COST, MAX_HP_TIER } from '@shared/monkey/content';
import type { WeaponDef } from '@shared/monkey/content';
import { PH_BREAK } from '@shared/monkey/proto';
import { keyLabel, settings } from '../settings';
import { clear, fmt, h } from './dom';
import { badgeSvg, gunSvg, heartSvg, svgEl, weaponLine } from './icons';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

interface Stats { dmg: number; rate: number; mag: number; range: number; dps: number }
function statsOf(w: WeaponDef, dmgMul: number): Stats {
  const dmg = w.dmg * w.pellets * dmgMul + (w.splashDmg || 0);
  const rate = 6000 / w.interval;
  return { dmg, rate, mag: w.mag, range: w.range, dps: dmg * rate };
}

/** Thanh chỉ số: phần tô = súng này, vạch trắng = súng đang dùng. */
function bar(label: string, val: number, cur: number, max: number, text: string, showDelta: boolean) {
  const pct = (v: number) => `${Math.max(3, Math.min(100, (v / (max || 1)) * 100)).toFixed(1)}%`;
  const d = val - cur;
  const rel = cur > 0 ? d / cur : 0;
  const delta = showDelta && Math.abs(rel) >= 0.02 ? h('em', { class: d > 0 ? 'up' : 'dn' }, d > 0 ? '▲' : '▼') : null;
  return h('div', { class: 'sb' },
    h('span', { class: 'l' }, label),
    h('div', { class: 't' },
      h('i', { class: `f${showDelta && d > 0 ? ' better' : ''}`, style: `width:${pct(val)}` }),
      showDelta ? h('i', { class: 'c', style: `left:${pct(cur)}` }) : null),
    h('span', { class: 'v' }, text, delta));
}

function stateFoot(owned: boolean, using: boolean, next: boolean, cost: number, cash: number, key: string, onBuy: () => void) {
  if (owned) return h('div', { class: 'foot ok' }, using ? '✔ ĐANG DÙNG' : '✔ ĐÃ CÓ');
  if (next) {
    const can = cash >= cost;
    return h('div', { class: 'foot' },
      h('button', { class: `btn sm${can ? ' green' : ''}`, disabled: !can, onclick: onBuy }, h('span', { class: 'kk' }, key), ` Mua ${fmt(cost)} xu`),
      can ? null : h('div', { class: 'need' }, `Thiếu ${fmt(cost - cash)} xu`));
  }
  return h('div', { class: 'foot lock' }, `🔒 ${fmt(cost)} xu · mở sau bậc trước`);
}

export function openShop(m: GameModel, buy: (item: 'weapon' | 'hp') => void, breakReady: (r: boolean) => void, isReady: () => boolean, onClose: () => void) {
  const root = h('div', { class: 'modal shop' });
  const body = h('div');
  const card = h('div', { class: 'card' }, body);
  root.append(card);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === settings.keys.shop) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.code === settings.keys.buyWeapon) buy('weapon');
    else if (e.code === settings.keys.buyHp) buy('hp');
  };
  document.addEventListener('keydown', onKey, true);
  let timer = 0;
  let sig = '';

  function close() {
    clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    onClose();
  }

  function render() {
    const me = m.info[m.me];
    if (!me) return;
    const ultPct = Math.round((me.ult / 255) * 100);
    const s = `${me.cash}|${me.cls}|${me.tier}|${me.hpTier}|${m.phase}|${isReady()}|${ultPct}`;
    if (s === sig) return;
    sig = s;
    clear(body);
    const cls = CLASSES[me.cls];
    const line = weaponLine(me.cls);
    const breakNow = m.phase === PH_BREAK;
    const kW = keyLabel(settings.keys.buyWeapon);
    const kH = keyLabel(settings.keys.buyHp);
    body.append(
      h('div', { class: 'shophead' },
        h('h2', { style: 'margin:0' }, '🛒 CỬA HÀNG'),
        h('div', { class: 'cashbig' }, `🍌 ${fmt(me.cash)} xu`),
        h('button', { class: 'btn ghost sm', onclick: close }, `Đóng (${keyLabel(settings.keys.shop)})`)),
      breakNow ? h('div', { class: 'row' },
        h('div', { class: 'grow', style: 'color:var(--leaf);font-weight:800' }, 'Đang nghỉ giữa đợt — mua sắm thoải mái.'),
        h('button', { class: `btn ${isReady() ? 'ghost' : 'green'} sm`, onclick: () => breakReady(!isReady()) }, isReady() ? 'Huỷ sẵn sàng' : '✔ SẴN SÀNG ĐỢT MỚI'))
        : h('div', { class: 'warn' }, '⚠ Trận vẫn đang diễn ra! Mua nhanh bằng phím tắt cũng được.'),
      h('h3', null, `Súng của ${cls.name} `, h('span', { class: 'kk' }, kW), h('small', null, ' nâng bậc kế tiếp')),
    );

    // ---- súng ----
    const all = line.map((w) => statsOf(w, cls.dmgMul));
    const cur = all[Math.min(me.tier, all.length - 1)] ?? all[0];
    const max = (k: keyof Stats) => Math.max(...all.map((x) => x[k]));
    const mx = { dmg: max('dmg'), rate: max('rate'), mag: max('mag'), range: max('range'), dps: max('dps') };
    const grid = h('div', { class: 'grid guns' });
    line.forEach((w, i) => {
      const owned = i <= me.tier;
      const using = i === me.tier;
      const next = i === me.tier + 1;
      const st = all[i];
      const cmp = !using;
      const tag = [w.pellets > 1 ? `${w.pellets} viên/phát` : '', w.pierce ? `xuyên ${w.pierce}` : '', w.splashR ? `nổ ${w.splashR}m` : ''].filter(Boolean).join(' · ');
      grid.append(h('div', { class: `item wcard${owned ? ' owned' : ''}${using ? ' using' : ''}${next ? ' next' : ''}${!owned && !next ? ' locked' : ''}${next && me.cash >= w.cost ? ' afford' : ''}`, style: `--wc:#${(w.color & 0xffffff).toString(16).padStart(6, '0')}` },
        h('div', { class: 'tier' }, ROMAN[i] ?? String(i + 1)),
        svgEl(gunSvg(w)),
        h('div', { class: 'ti' }, w.name),
        h('div', { class: 'tag' }, tag || w.short),
        h('div', { class: 'stats' },
          bar('Sát thương', st.dmg, cur.dmg, mx.dmg, `${w.dmg}${w.pellets > 1 ? `×${w.pellets}` : ''}${w.splashDmg ? `+${w.splashDmg}` : ''}`, cmp),
          bar('Tốc bắn', st.rate, cur.rate, mx.rate, `${st.rate.toFixed(1)}/s`, cmp),
          bar('Băng đạn', st.mag, cur.mag, mx.mag, String(w.mag), cmp),
          bar('Tầm bắn', st.range, cur.range, mx.range, `${w.range}m`, cmp),
          bar('DPS', st.dps, cur.dps, mx.dps, String(Math.round(st.dps)), cmp)),
        h('div', { class: 'rl2' }, `Nạp ${(w.reload / 60).toFixed(1)}s`),
        stateFoot(owned, using, next, w.cost, me.cash, kW, () => buy('weapon'))));
    });
    body.append(grid, h('h3', null, 'Máu ', h('span', { class: 'kk' }, kH), h('small', null, ` +${HP_TIER_BONUS} máu tối đa mỗi bậc, hồi ngay 45 máu`)));

    // ---- máu ----
    const hp = h('div', { class: 'grid hps' });
    for (let i = 1; i <= MAX_HP_TIER; i++) {
      const owned = i <= me.hpTier;
      const next = i === me.hpTier + 1;
      hp.append(h('div', { class: `item hcard${owned ? ' owned' : ''}${next ? ' next' : ''}${!owned && !next ? ' locked' : ''}${next && me.cash >= HP_TIER_COST[i] ? ' afford' : ''}` },
        h('div', { class: 'tier' }, ROMAN[i - 1] ?? String(i)),
        svgEl(heartSvg(i)),
        h('div', { class: 'ti' }, `Máu bậc ${i}`),
        h('div', { class: 'tag' }, `Tối đa ${cls.hp + HP_TIER_BONUS * i} máu`),
        stateFoot(owned, false, next, HP_TIER_COST[i], me.cash, kH, () => buy('hp'))));
    }

    // ---- kỹ năng ----
    body.append(hp, h('h3', null, `Kỹ năng ${cls.name}`));
    const sk = h('div', { class: 'grid skills' });
    const skill = (icon: string, key: string, name: string, desc: string, price: string) =>
      h('div', { class: 'item scard' },
        svgEl(badgeSvg(icon, cls.color)),
        h('div', { class: 'ti' }, h('span', { class: 'kk' }, key), ` ${name}`),
        h('div', { class: 'st2' }, desc),
        h('div', { class: 'pr2' }, price));
    sk.append(
      skill(cls.g.icon, keyLabel(settings.keys.skillG), cls.g.name, cls.g.desc, `${cls.g.cost} xu mỗi lần · hồi ${cls.g.cd}s`),
      skill(cls.x.icon, keyLabel(settings.keys.skillX), cls.x.name, cls.x.desc, `${cls.x.cost} xu mỗi lần · hồi ${cls.x.cd}s`),
      skill(cls.q.icon, keyLabel(settings.keys.ult), cls.q.name, cls.q.desc, `Miễn phí · sạc bằng cách hạ khỉ (${ultPct}%)`),
    );
    body.append(sk);
  }

  render();
  timer = window.setInterval(render, 200);
  document.getElementById('app')!.append(root);
  return close;
}
