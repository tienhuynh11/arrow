// Tab VƯỢT ẢI: 3 chương, mỗi chương là chuỗi 10 nút uốn lượn (sao, khoá, luật đặc biệt) + bảng chi tiết ải.

import type { MeResponse, StageProgress } from '@shared/monkey/api';
import { mapById } from '@shared/monkey/map';
import { MODIFIER_INFO, RARITY, SLOTS, STAGES, STAGE_BY_ID, stageUnlocked, type StageDef } from '@shared/monkey/progression';
import * as A from '../../../audio';
import { clear, h, timeStr } from '../../dom';
import { createRoom } from '../actions';
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
    + `<path d="${d}" fill="none" stroke="#ffd23f" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 12" vector-effect="non-scaling-stroke"/>`
    + (dl ? `<path d="${dl}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12" vector-effect="non-scaling-stroke"/>` : '')
    + `</svg>`;
  return el;
}

/** bảng tỉ lệ độ hiếm (thanh màu) */
function rarityBar(w: readonly number[]) {
  const tot = w.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return h('div', { class: 'rbar', title: w.map((x, i) => `${RARITY[i].name} ${Math.round((Math.max(0, x) / tot) * 100)}%`).join(' · ') },
    ...w.map((x, i) => h('i', { style: `flex:${Math.max(0, x)};background:${RARITY[i].color}` })));
}

export function stageDetail(def: StageDef, prog: StageProgress | undefined, unlocked: boolean, opts: { compact?: boolean } = {}) {
  const map = mapById(def.map);
  const d = def.drops;
  const box = h('div', { class: 'sdet' });
  const cleared = !!prog && prog.clears > 0;
  box.append(
    h('div', { class: 'sdh' },
      h('div', null,
        h('div', { class: 'sid' }, def.event ? '🎉 ẢI SỰ KIỆN' : `ẢI ${def.id}`, def.drops.book && def.drops.book >= 0.5 ? h('em', { class: 'boss' }, '👑 BOSS') : null),
        h('h3', null, def.name),
        h('div', { class: 'smap' }, `${map.emoji} ${map.name}`)),
      starsEl(prog?.stars ?? 0)),
    h('div', { class: 'sfacts' },
      h('span', null, h('b', null, def.waves), ' đợt'),
      h('span', null, 'Độ khó ', h('b', null, `×${def.diff.toFixed(2)}`)),
      h('span', null, 'Bắt đầu đợt ', h('b', null, def.startWave)),
      prog?.bestSecs ? h('span', null, 'Kỷ lục ', h('b', null, timeStr(prog.bestSecs))) : null,
      prog?.clears ? h('span', null, 'Đã qua ', h('b', null, prog.clears), ' lần') : null),
  );
  if (def.mods.length) {
    box.append(h('div', { class: 'smods' }, ...def.mods.map((m) => h('div', { class: 'smod' }, h('i', null, MODIFIER_INFO[m].icon), h('div', null, h('b', null, MODIFIER_INFO[m].name), h('span', null, MODIFIER_INFO[m].desc))))));
  }
  if (!opts.compact) {
    box.append(h('div', { class: 'scrit' },
      h('div', null, starsEl(1, 1), ' Vượt hết đợt'),
      h('div', null, starsEl(1, 1), ' Đội còn ≥ 50% máu'),
      h('div', null, starsEl(1, 1), ` Không ai gục & dưới ${timeStr(def.star3Secs)}`)));
  }
  const slots = (r: { slots: string[] }) => (r.slots.length ? r.slots : SLOTS.map((s) => s.id)).map((s) => SLOTS.find((x) => x.id === s)?.icon ?? '').join('');
  box.append(h('div', { class: 'sdrops' },
    h('div', { class: 'sdt' }, 'CÓ THỂ RỚT'),
    h('div', { class: 'rwd' },
      h('span', { class: 'chip gold' }, `${CUR.gold} ${d.gold[0]}–${d.gold[1]}`),
      h('span', { class: 'chip xp' }, `${CUR.xp} ${d.xp} XP`),
      d.shards ? h('span', { class: 'chip' }, `${CUR.shards} ${d.shards[0]}–${d.shards[1]}`) : null,
      d.book ? h('span', { class: 'chip' }, `${CUR.books} ${Math.round(d.book * 100)}%`) : null),
    ...d.rolls.map((r) => h('div', { class: 'droll' }, h('span', { class: 'dc' }, `${Math.round(r.chance * 100)}%`), h('span', { class: 'ds' }, slots(r)), rarityBar(r.weights)))));
  box.append(h('div', { class: 'sfirst' + (cleared ? ' got' : '') },
    h('div', { class: 'sdt' }, cleared ? '✔ THƯỞNG LẦN ĐẦU (ĐÃ NHẬN)' : '🎁 THƯỞNG LẦN ĐẦU'),
    rewardChips(def.first)));
  box.append(h('div', { class: 'row sbtn' },
    h('button', { class: 'btn big grow', disabled: !unlocked, onclick: () => createRoom({ solo: true, mode: 'stage', stage: def.id, map: def.map }) }, unlocked ? '▶ CHƠI MỘT MÌNH' : '🔒 CHƯA MỞ'),
    h('button', { class: 'btn green big grow', disabled: !unlocked, onclick: () => createRoom({ solo: false, mode: 'stage', stage: def.id, map: def.map }) }, '👥 TẠO PHÒNG')));
  return box;
}

export function renderStagesTab(body: HTMLElement, me: MeResponse) {
  const prog = progressMap(me);
  const cleared = clearedSet(me);
  // mặc định: chương + ải xa nhất đã mở
  if (selected === null || !STAGE_BY_ID[selected]) {
    let last = STAGES[0];
    for (const s of STAGES) if (stageUnlocked(s.id, cleared)) last = s;
    selected = last.id;
    chapter = last.chapter - 1;
  }
  const wrap = h('div', { class: 'stab' });
  const left = h('div', { class: 'smapcol' });
  const right = h('div', { class: 'card sdetcard' });
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
    right.append(stageDetail(def, prog.get(def.id), stageUnlocked(def.id, cleared)));
  };
  draw();
  wrap.append(left, right);
  body.append(wrap);
}
