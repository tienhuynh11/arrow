// Cửa sổ VƯỢT ẢI (M): 3 chương, mỗi chương là chuỗi 10 nút uốn lượn (sao, khoá, luật đặc biệt) + bảng chi tiết ải:
// luật mang đồ (chết = mất đồ trừ Túi an toàn), kiểm tra hành trang trước khi vào, bảng rớt theo phẩm.

import type { MeResponse, StageProgress } from '@shared/monkey/api';
import { mapById } from '@shared/monkey/map';
import { MODIFIER_INFO, STAGES, STAGE_BY_ID, stageUnlocked, type StageDef } from '@shared/monkey/progression';
import { api } from '../../../api';
import { GRADE_COLORS, KIND_ICON, defOf, equippedMap, gradeName, gradeWeights } from '../../../gearlib';
import type { HubCtx } from '../hub';
import * as A from '../../../audio';
import { clear, h, timeStr } from '../../dom';
import { createRoom } from '../actions';
import { confirmBox } from '../ctx';
import { CUR, rewardChips } from '../items';

const CHAPTERS = [
  { n: 1, name: 'Đền Rừng', icon: '🌴', bg: 'linear-gradient(135deg,#1f4d1a,#0f2a0c)' },
  { n: 2, name: 'Làng Ven Sông', icon: '🛶', bg: 'linear-gradient(135deg,#1b4b5a,#0d2530)' },
  { n: 3, name: 'Mỏ Đá', icon: '⛏️', bg: 'linear-gradient(135deg,#4a3a2a,#1f1810)' },
];

let chapter = 0;
let selected: string | null = null;

export function progressMap(me: MeResponse) {
  const m = new Map<string, StageProgress>();
  for (const s of me.stages) m.set(s.stage, s);
  return m;
}
export function clearedSet(me: MeResponse) {
  return new Set(me.stages.filter((s) => s.clears > 0).map((s) => s.stage));
}

export function starsEl(n: number, max = 3) {
  return h('span', { class: 'stars' }, ...Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'on' : '' }, '★')));
}

export function modIcons(def: StageDef) {
  return h('span', { class: 'mods' }, ...def.mods.map((m) => h('i', { title: `${MODIFIER_INFO[m].name}: ${MODIFIER_INFO[m].desc}` }, MODIFIER_INFO[m].icon)));
}

/** nút trên chuỗi: vị trí trong viewBox 1000×300 */
function nodePos(i: number) {
  const x = 60 + i * 97;
  const y = 150 + Math.sin(i * 1.15 + 0.4) * 88;
  return { x, y };
}

function pathSvg(n: number, unlockedTo: number) {
  let d = '';
  let dl = '';
  for (let i = 0; i < n; i++) {
    const p = nodePos(i);
    if (i === 0) { d = `M${p.x} ${p.y}`; continue; }
    const q = nodePos(i - 1);
    const mx = (p.x + q.x) / 2;
    const seg = ` C${mx} ${q.y} ${mx} ${p.y} ${p.x} ${p.y}`;
    if (i <= unlockedTo) d += seg;
    else {
      if (!dl) dl = `M${q.x} ${q.y}`;
      dl += seg;
    }
  }
  const el = h('div', { class: 'spsvg' });
  el.innerHTML = `<svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="${d}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="16" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    + `<path d="${d}" fill="none" stroke="#f2cc6a" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 12" vector-effect="non-scaling-stroke"/>`
    + (dl ? `<path d="${dl}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12" vector-effect="non-scaling-stroke"/>` : '')
    + `</svg>`;
  return el;
}


/** thanh tỉ lệ 5 phẩm + chú thích % */
function gradeBar(w: readonly number[], legend = false) {
  const g = gradeWeights(w);
  const tot = g.reduce((a, b) => a + b, 0) || 1;
  const bar = h('div', { class: 'gradebar', title: g.map((x, i) => `${gradeName(i)} ${Math.round((x / tot) * 100)}%`).join(' · ') },
    ...g.map((x, i) => h('i', { style: `flex:${x};background:${GRADE_COLORS[i]}` })));
  if (!legend) return bar;
  return h('div', null, bar, h('div', { class: 'gradeleg' }, ...g.map((x, i) => h('span', null, h('i', { style: `background:${GRADE_COLORS[i]}` }), `${gradeName(i)} ${x / tot >= 0.095 ? Math.round((x / tot) * 100) : Math.round((x / tot) * 1000) / 10}%`))));
}

/** kiểm tra hành trang trước khi vào ải */
function loadoutCheck(ctx?: HubCtx) {
  const me = api.me;
  const eq = equippedMap(me);
  const gun = eq.get('weapon1') ?? eq.get('weapon2');
  const q = [eq.get('quick1'), eq.get('quick2')].filter(Boolean);
  const sec = eq.get('secure');
  const armor = ['helmet', 'armor', 'gloves', 'boots', 'belt'].filter((s) => eq.get(s as never)).length;
  const name = (u: { itemId: string } | undefined) => (u ? defOf(u.itemId)?.name ?? u.itemId : '');
  const box = h('div', { class: 'lcheck' },
    gun ? h('div', { class: 'ok' }, `✔ Súng: ${name(gun)}${eq.get('weapon1') && eq.get('weapon2') ? ` + ${name(eq.get('weapon2'))}` : ''}`)
      : h('div', { class: 'bad' }, '✖ Chưa mang súng — sẽ chỉ có súng lục cơ bản!'),
    q.length ? h('div', { class: 'ok' }, `✔ Ô nhanh: ${q.map((x) => `${name(x)} ×${x!.count}`).join(', ')}`)
      : h('div', { class: 'wn' }, '⚠ Không có vật phẩm tiêu hao (thuốc / lựu đạn) ở ô [3] [4]'),
    h('div', { class: armor >= 3 ? 'ok' : 'wn' }, `${armor >= 3 ? '✔' : '⚠'} Trang bị phòng thủ: ${armor}/5 món`),
    sec ? h('div', { class: 'ok' }, `🔒 Túi an toàn giữ: ${name(sec)}`) : h('div', { class: 'wn' }, '⚠ Túi an toàn đang trống — đặt món quý nhất vào đó'));
  if (ctx) box.append(h('div', { class: 'row2', style: 'margin-top:4px' },
    h('button', { class: 'vb sm', onclick: () => { ctx.open('chars', 'equip'); ctx.open('inv'); } }, '🧙 Trang bị (C+B)'),
    h('button', { class: 'vb sm', onclick: () => ctx.open('merchant', 'buy') }, '⚖️ Mua thuốc (N)')));
  return { box, ok: !!gun };
}

export function stageDetail(def: StageDef, prog: StageProgress | undefined, unlocked: boolean, opts: { compact?: boolean; ctx?: HubCtx } = {}) {
  const map = mapById(def.map);
  const d = def.drops as unknown as { gold: [number, number]; xp: number; rolls?: { slots?: string[]; kinds?: string[]; chance: number; weights: number[] }[]; shards?: [number, number]; book?: number; grades?: number[]; perKill?: number };
  const box = h('div', { class: 'sdet' });
  const cleared = !!prog && prog.clears > 0;
  box.append(
    h('div', { class: 'sdh' },
      h('div', null,
        h('div', { class: 'sid' }, def.event ? '🎉 ẢI SỰ KIỆN' : `ẢI ${def.id}`, d.book && d.book >= 0.5 ? h('em', { class: 'boss' }, '👑 BOSS') : null),
        h('h3', null, def.name),
        h('div', { class: 'smap' }, `${map.emoji} ${map.name}`)),
      starsEl(prog?.stars ?? 0)),
    h('div', { class: 'sfacts' },
      h('span', null, h('b', null, def.waves), ' đợt'),
      h('span', null, 'Độ khó ', h('b', null, `×${def.diff.toFixed(2)}`)),
      prog?.bestSecs ? h('span', null, 'Kỷ lục ', h('b', null, timeStr(prog.bestSecs))) : null,
      prog?.clears ? h('span', null, 'Đã qua ', h('b', null, prog.clears), ' lần') : null),
  );
  if (def.mods.length) {
    box.append(h('div', { class: 'smods' }, ...def.mods.map((m) => h('div', { class: 'smod' }, h('i', null, MODIFIER_INFO[m].icon), h('div', null, h('b', null, MODIFIER_INFO[m].name), h('span', null, MODIFIER_INFO[m].desc))))));
  }
  if (!opts.compact) {
    box.append(h('div', { class: 'hsec' }, 'Luật vượt ải'), h('div', { class: 'parch rules' },
      h('div', null, h('i', null, '🎒'), h('span', null, 'Mang đồ vào ải và ', h('b', null, 'chỉ dùng đúng đồ đó'), ' — không có cửa hàng giữa trận.')),
      h('div', null, h('i', null, '🐒'), h('span', null, 'Khỉ bị hạ rơi ', h('b', null, 'túi đồ'), ' có cột sáng theo phẩm — chạy qua để nhặt.')),
      h('div', null, h('i', null, '☠️'), h('span', { class: 'warnl' }, 'Chết = mất đồ đang mang, trừ Túi an toàn.')),
      h('div', null, h('i', null, '🏁'), h('span', null, 'Sống sót tới cuối: giữ hết đồ mang vào + đồ nhặt được + rương thưởng.'))));
    const chk = loadoutCheck(opts.ctx);
    box.append(h('div', { class: 'hsec' }, 'Kiểm tra hành trang'), h('div', { class: 'box2' }, chk.box));
  }
  // ---- bảng rớt theo phẩm ----
  const rolls = d.rolls ?? [];
  const drops = h('div', { class: 'sdrops' }, h('div', { class: 'hsec' }, 'Có thể rớt'),
    h('div', { class: 'rwd' },
      h('span', { class: 'chip gold' }, `${CUR.gold} ${d.gold[0]}–${d.gold[1]}`),
      h('span', { class: 'chip xp' }, `${CUR.xp} ${d.xp} XP`),
      d.shards ? h('span', { class: 'chip' }, `${CUR.shards} ${d.shards[0]}–${d.shards[1]}`) : null,
      d.book ? h('span', { class: 'chip' }, `${CUR.books} ${Math.round(d.book * 100)}%`) : null));
  if (d.grades) drops.append(h('div', { style: 'margin-top:6px' }, h('div', { class: 'dim', style: 'font-size:11.5px;margin-bottom:3px' }, `Túi đồ khỉ rơi${d.perKill ? ` (${Math.round(d.perKill * 100)}% mỗi con)` : ''}`), gradeBar(d.grades, true)));
  rolls.forEach((r, i) => {
    const kinds = (r.kinds ?? r.slots ?? []) as string[];
    const icons = kinds.length ? kinds.map((k) => KIND_ICON[(k === 'gun' ? 'gun' : k) as keyof typeof KIND_ICON] ?? '').join('') : 'mọi loại';
    drops.append(h('div', { style: 'margin-top:6px' },
      h('div', { class: 'dim', style: 'font-size:11.5px;margin-bottom:3px;display:flex;justify-content:space-between' }, h('span', null, `${i === 0 && !d.grades ? 'Túi đồ khỉ rơi' : 'Rương thưởng'} · ${Math.round(r.chance * 100)}%`), h('span', null, icons)),
      gradeBar(r.weights, i === 0 || rolls.length === 1)));
  });
  box.append(drops);
  box.append(h('div', { class: 'sfirst' + (cleared ? ' got' : '') },
    h('div', { class: 'hsec' }, cleared ? '✔ Thưởng lần đầu (đã nhận)' : '🎁 Thưởng lần đầu'),
    rewardChips(def.first)));
  const go = (solo: boolean) => () => {
    const chk = loadoutCheck();
    const start = () => createRoom({ solo, mode: 'stage', stage: def.id, map: def.map });
    if (!chk.ok) confirmBox('Chưa mang súng!', 'Bạn chưa trang bị súng nào — vào ải sẽ chỉ có súng lục cơ bản. Vẫn vào?', 'VẪN VÀO', start, true);
    else start();
  };
  box.append(h('div', { class: 'row sbtn' },
    h('button', { class: 'vb gold big grow', disabled: !unlocked, onclick: go(true) }, unlocked ? '▶ MỘT MÌNH' : '🔒 CHƯA MỞ'),
    h('button', { class: 'vb big grow', disabled: !unlocked, onclick: go(false) }, '👥 TẠO PHÒNG')));
  return box;
}

export function renderStagesTab(body: HTMLElement, me: MeResponse, ctx?: HubCtx) {
  const prog = progressMap(me);
  const cleared = clearedSet(me);
  // mặc định: chương + ải xa nhất đã mở
  if (selected === null || !STAGE_BY_ID[selected]) {
    let last = STAGES[0];
    for (const s of STAGES) if (stageUnlocked(s.id, cleared)) last = s;
    selected = last.id;
    chapter = last.chapter - 1;
  }
  body.style.overflow = 'hidden';
  const wrap = h('div', { class: 'vstage' });
  const left = h('div', { class: 'smapcol' });
  const right = h('div', { class: 'sdetcol', 'data-keep-scroll': '1' });
  const draw = () => {
    clear(left);
    clear(right);
    const ch = CHAPTERS[chapter];
    const list = STAGES.filter((s) => s.chapter === ch.n);
    const stars = list.reduce((a, s) => a + (prog.get(s.id)?.stars ?? 0), 0);
    const chUnlocked = stageUnlocked(list[0].id, cleared);
    left.append(h('div', { class: 'chtabs' }, ...CHAPTERS.map((c, i) => {
      const l = STAGES.filter((s) => s.chapter === c.n);
      const st = l.reduce((a, s) => a + (prog.get(s.id)?.stars ?? 0), 0);
      const open = stageUnlocked(l[0].id, cleared);
      return h('button', { class: `cht${i === chapter ? ' on' : ''}${open ? '' : ' lk'}`, onclick: () => { chapter = i; const f = l.filter((s) => stageUnlocked(s.id, cleared)); selected = (f[f.length - 1] ?? l[0]).id; A.sfxUi(); draw(); } },
        h('i', null, open ? c.icon : '🔒'), h('b', null, `Chương ${c.n}`), h('span', null, `${c.name} · ★ ${st}/30`));
    })));
    let unlockedTo = -1;
    list.forEach((s, i) => { if (stageUnlocked(s.id, cleared)) unlockedTo = i; });
    const path = h('div', { class: 'spath', style: `background:${ch.bg}` },
      h('div', { class: 'sphead' }, h('b', null, `${ch.icon} ${ch.name}`), h('span', null, `★ ${stars}/30`), chUnlocked ? null : h('em', null, `🔒 Qua ải ${CHAPTERS[chapter - 1]?.n ?? 1}-10 để mở`)),
      pathSvg(list.length, unlockedTo));
    list.forEach((s, i) => {
      const p = nodePos(i);
      const un = stageUnlocked(s.id, cleared);
      const pr = prog.get(s.id);
      const boss = i === list.length - 1;
      const cur = un && !(pr && pr.clears > 0);
      path.append(h('button', {
        class: `snode${un ? '' : ' lk'}${boss ? ' boss' : ''}${s.id === selected ? ' on' : ''}${cur ? ' cur' : ''}${pr && pr.clears ? ' done' : ''}`,
        style: `left:${p.x / 10}%;top:${(p.y / 300) * 100}%`,
        title: `${s.id} · ${s.name}`,
        onclick: () => { selected = s.id; A.sfxUi(); draw(); },
      },
        h('span', { class: 'sn' }, un ? (boss ? '👑' : s.id.split('-')[1]) : '🔒'),
        s.mods.length ? h('span', { class: 'smi' }, ...s.mods.map((m) => MODIFIER_INFO[m].icon)) : null,
        h('span', { class: 'sst' }, starsEl(pr?.stars ?? 0))));
    });
    left.append(path);
    const def = STAGE_BY_ID[selected!];
    right.append(stageDetail(def, prog.get(def.id), stageUnlocked(def.id, cleared), { ctx }));
  };
  draw();
  wrap.append(left, right);
  body.append(wrap);
}
