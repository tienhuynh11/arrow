// CỬA HÀNG: nâng bậc súng, nâng máu, xem kỹ năng lớp. Mua được mọi lúc (trận KHÔNG tạm dừng!).

import type { GameModel } from '@shared/monkey/client';
import { CLASSES, HP_TIER_BONUS, HP_TIER_COST, MAX_HP_TIER, WEAPONS } from '@shared/monkey/content';
import { PH_BREAK } from '@shared/monkey/proto';
import { keyLabel, settings } from '../settings';
import { clear, fmt, h } from './dom';

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
    const s = `${me.cash}|${me.tier}|${me.hpTier}|${m.phase}|${isReady()}`;
    if (s === sig) return;
    sig = s;
    clear(body);
    const cls = CLASSES[me.cls];
    const breakNow = m.phase === PH_BREAK;
    body.append(
      h('div', { class: 'shophead' },
        h('h2', { style: 'margin:0' }, '🛒 CỬA HÀNG'),
        h('div', { class: 'cashbig' }, `🍌 ${fmt(me.cash)} xu`),
        h('button', { class: 'btn ghost sm', onclick: close }, `Đóng (${keyLabel(settings.keys.shop)})`)),
      breakNow ? h('div', { class: 'row' },
        h('div', { class: 'grow', style: 'color:var(--leaf);font-weight:800' }, 'Đang nghỉ giữa đợt — mua sắm thoải mái.'),
        h('button', { class: `btn ${isReady() ? 'ghost' : 'green'} sm`, onclick: () => breakReady(!isReady()) }, isReady() ? 'Huỷ sẵn sàng' : '✔ SẴN SÀNG ĐỢT MỚI'))
        : h('div', { class: 'warn' }, '⚠ Trận vẫn đang diễn ra! Mua nhanh bằng phím tắt cũng được.'),
      h('h3', null, `Súng (phím ${keyLabel(settings.keys.buyWeapon)} để nâng bậc kế tiếp)`),
    );
    const grid = h('div', { class: 'grid' });
    WEAPONS.forEach((w, i) => {
      const owned = i <= me.tier;
      const next = i === me.tier + 1;
      const dps = Math.round(((w.dmg * w.pellets * 6000) / w.interval) * cls.dmgMul);
      grid.append(h('div', { class: `item${owned ? ' owned' : ''}${next ? ' next' : ''}` },
        h('div', { class: 'ti' }, `${['I', 'II', 'III', 'IV', 'V'][i]} · ${w.name}`),
        h('div', { class: 'st2' },
          `Sát thương ${w.dmg}${w.pellets > 1 ? `×${w.pellets}` : ''} · ${(6000 / w.interval).toFixed(1)} phát/giây`, h('br'),
          `Băng ${w.mag} · nạp ${(w.reload / 60).toFixed(1)}s · tầm ${w.range}m`, h('br'),
          `≈ ${dps} sát thương/giây`, w.pierce ? ' · xuyên 1 con' : '', w.splashR ? ` · nổ lan ${w.splashR}m (+${w.splashDmg})` : ''),
        owned ? h('div', { class: 'pr2', style: 'color:var(--leaf)' }, i === me.tier ? '✔ Đang dùng' : '✔ Đã có')
          : next ? h('button', { class: 'btn sm', disabled: me.cash < w.cost, onclick: () => buy('weapon') }, `Mua ${fmt(w.cost)} xu`)
            : h('div', { class: 'pr2', style: 'color:var(--dim)' }, `${fmt(w.cost)} xu · mở sau bậc trước`)));
    });
    body.append(grid, h('h3', null, `Máu (phím ${keyLabel(settings.keys.buyHp)})`));
    const hp = h('div', { class: 'grid' });
    for (let i = 1; i <= MAX_HP_TIER; i++) {
      const owned = i <= me.hpTier;
      const next = i === me.hpTier + 1;
      hp.append(h('div', { class: `item${owned ? ' owned' : ''}${next ? ' next' : ''}` },
        h('div', { class: 'ti' }, `❤️ Máu bậc ${i}`),
        h('div', { class: 'st2' }, `Máu tối đa ${cls.hp + HP_TIER_BONUS * i} (+${HP_TIER_BONUS}), hồi ngay 45 máu`),
        owned ? h('div', { class: 'pr2', style: 'color:var(--leaf)' }, '✔ Đã có')
          : next ? h('button', { class: 'btn sm', disabled: me.cash < HP_TIER_COST[i], onclick: () => buy('hp') }, `Mua ${fmt(HP_TIER_COST[i])} xu`)
            : h('div', { class: 'pr2', style: 'color:var(--dim)' }, `${fmt(HP_TIER_COST[i])} xu`)));
    }
    body.append(hp, h('h3', null, `Kỹ năng ${cls.name}`));
    const sk = h('div', { class: 'grid' });
    sk.append(
      h('div', { class: 'item' }, h('div', { class: 'ti' }, `${cls.g.icon} [${keyLabel(settings.keys.skillG)}] ${cls.g.name}`), h('div', { class: 'st2' }, cls.g.desc), h('div', { class: 'pr2' }, `${cls.g.cost} xu mỗi lần · hồi ${cls.g.cd}s`)),
      h('div', { class: 'item' }, h('div', { class: 'ti' }, `${cls.x.icon} [${keyLabel(settings.keys.skillX)}] ${cls.x.name}`), h('div', { class: 'st2' }, cls.x.desc), h('div', { class: 'pr2' }, `${cls.x.cost} xu mỗi lần · hồi ${cls.x.cd}s`)),
      h('div', { class: 'item' }, h('div', { class: 'ti' }, `${cls.q.icon} [${keyLabel(settings.keys.ult)}] ${cls.q.name}`), h('div', { class: 'st2' }, cls.q.desc), h('div', { class: 'pr2' }, `Miễn phí · sạc bằng cách hạ khỉ (${Math.round((me.ult / 255) * 100)}%)`)),
    );
    body.append(sk);
  }

  render();
  timer = window.setInterval(render, 200);
  document.getElementById('app')!.append(root);
  return close;
}
