// Màn kết thúc trận: THẮNG ẢI (sao lần lượt sáng, rương mở, đồ rớt theo độ hiếm, vàng/XP chạy số, lên cấp)
// và THUA / hết vô tận (bảng thành tích + thưởng an ủi nếu có).

import type { RunReward } from '@shared/monkey/api';
import { CLASSES } from '@shared/monkey/content';
import { STAGE_BY_ID, nextStage } from '@shared/monkey/progression';
import type { ExtractResult } from '@shared/monkey/gear';
import { defOf, dropInst, gradeColor, gradeName, invOf, normInst, sellPrice, type Inv } from '../../gearlib';
import { bindTip, itemTip } from '../tooltip';
import { api } from '../../api';
import * as A from '../../audio';
import { CLASS_ICON, fmt, h, timeStr } from '../dom';
import { createRoom } from './actions';
import { S, closeModal, send, type OverMsgX, type VictoryMsg } from './ctx';
import { boardTable } from './home';
import { CUR, itemEl, itemTile, rewardChips } from './items';

let timers: number[] = [];
function later(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms));
}
export function clearResultTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

/** chạy số từ 0 → v */
function countUp(el: HTMLElement, v: number, ms: number, prefix = '') {
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = `${prefix}${fmt(v * e)}`;
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function chestEl() {
  return h('div', { class: 'chest' }, h('div', { class: 'clid' }), h('div', { class: 'cbase' }, h('i', { class: 'clock' })), h('div', { class: 'cglow' }));
}

/** đồ rớt + tiền tệ của mình (dùng cho cả thắng lẫn thưởng an ủi) */
function lootBlock(rw: RunReward | undefined, startMs: number, opts: { chest: boolean }) {
  const box = h('div', { class: 'vloot' });
  if (!rw || !rw.reward) {
    box.append(h('div', { class: 'vguest' }, '👤 Khách không nhận thưởng — ', h('b', null, 'đăng nhập'), ' để cày đồ, lên cấp và mở khoá nhân vật!'));
    return { box, endMs: startMs };
  }
  const r = rw.reward;
  const items = r.items ?? [];
  const chest = opts.chest ? chestEl() : null;
  const drops = h('div', { class: 'vdrops' });
  const cur = h('div', { class: 'vcur' });
  const gold = h('b', null, '0');
  const xp = h('b', null, '0');
  cur.append(h('div', { class: 'vc gold' }, h('i', null, CUR.gold), gold, h('span', null, 'VÀNG')), h('div', { class: 'vc xp' }, h('i', null, CUR.xp), xp, h('span', null, 'XP')));
  if (r.shards) cur.append(h('div', { class: 'vc' }, h('i', null, CUR.shards), h('b', null, `+${r.shards}`), h('span', null, 'MẢNH')));
  if (r.books) cur.append(h('div', { class: 'vc' }, h('i', null, CUR.books), h('b', null, `+${r.books}`), h('span', null, 'SÁCH')));
  if (r.unlockChar !== undefined && CLASSES[r.unlockChar]) cur.append(h('div', { class: 'vc' }, h('i', null, '🔓'), h('b', null, CLASSES[r.unlockChar].name), h('span', null, 'MỞ KHOÁ')));
  if (chest) box.append(chest);
  box.append(h('div', { class: 'vright' }, drops, cur));
  let t = startMs;
  if (chest) {
    later(t, () => { chest.classList.add('shake'); });
    t += 600;
    later(t, () => { chest.classList.remove('shake'); chest.classList.add('open'); A.sfxBuy(); });
    t += 350;
  }
  if (!items.length) {
    later(t, () => drops.append(h('div', { class: 'vnone' }, 'Lần này không rớt đồ — thử lại để cầu may!')));
  }
  for (const it of items) {
    const def = defOf(it.itemId);
    const g = it.grade;
    later(t, () => {
      const card = h('div', { class: `vdrop r${g}`, style: `--rc:${gradeColor(g)}` },
        itemTile(it.itemId, g, { size: 'big', count: it.count }),
        h('b', null, def?.name ?? it.itemId),
        h('span', { style: `color:${gradeColor(g)}` }, gradeName(g)));
      drops.append(card);
      A.sfxLoot(g);
    });
    t += g >= 3 ? 700 : 380;
  }
  later(t, () => {
    countUp(gold, r.gold ?? 0, 900, '+');
    countUp(xp, r.xp ?? 0, 900, '+');
  });
  t += 950;
  if (rw.levelUps > 0) {
    later(t, () => {
      box.append(h('div', { class: 'vlevel' }, h('b', null, '⬆ LÊN CẤP!'), h('span', null, `Cấp ${rw.newLevel}`)));
      A.sfxWaveClear();
    });
    t += 400;
  }
  return { box, endMs: t };
}

/** đồ của mình trước trận (uid → món) để hiện đồ giữ / mất */
let gearSnap = new Map<number, Inv>();
/** gọi lúc vào trận: chụp lại đồ đang mặc (hồ sơ sẽ đổi sau trận) */
export function snapGear() {
  gearSnap = new Map(invOf(api.me).map((i) => [i.uid, i]));
}

function cellOf(it: Inv, lost: boolean) {
  const cell = h('div', { class: 'cell' });
  const el = itemEl(it);
  cell.append(el);
  bindTip(el, () => itemTip(it, { lost, noCompare: true }));
  return cell;
}

/** tổng kết mang đồ: SỐNG SÓT / GỤC NGÃ + đồ giữ / mất (gạch đỏ) / nhặt được */
function extractBlock(ex: ExtractResult | undefined, rw: RunReward | undefined, won: boolean) {
  if (!ex) return null;
  const box = h('div', { class: 'xbox' });
  box.append(h('div', { class: `xbanner ${ex.survived ? 'ok' : 'bad'}` }, ex.survived ? 'SỐNG SÓT ✔' : 'GỤC NGÃ ✖'),
    h('div', { class: 'xsub' }, ex.survived
      ? 'Bạn mang được toàn bộ đồ về — kể cả đồ nhặt trong ải.'
      : won ? 'Đội đã thắng nhưng bạn gục giữa đường: đồ đang mang đã mất, trừ Túi an toàn.' : 'Đồ đang mang đã mất — chỉ Túi an toàn còn lại.'));
  const inst = (u: number) => gearSnap.get(u) ?? invOf(api.me).find((i) => i.uid === u);
  const kept = ex.kept.map(inst).filter((x): x is Inv => !!x);
  const lost = ex.lost.map(inst).filter((x): x is Inv => !!x);
  const looted = ex.looted.map((d) => dropInst(d));
  const items = (rw?.reward?.items ?? []).map((x) => normInst({ ...x, level: 1, slot: null, stash: false }));
  const col = (title: string, list: Inv[], cls: string, empty: string, isLost: boolean) => h('div', { class: `xcol ${cls}` },
    h('div', { class: 'hsec' }, title),
    h('div', { class: 'xl' }, ...(list.length ? list.map((i) => cellOf(i, isLost)) : [h('span', { class: 'none' }, empty)])));
  const lostVal = lost.reduce((a, i) => a + sellPrice(i), 0);
  box.append(h('div', { class: 'xres' },
    col(`✔ Giữ lại (${kept.length})`, kept, 'kept', 'Không có', false),
    col(`✖ Mất (${lost.length})${lostVal ? ` · ~${fmt(lostVal)} vàng` : ''}`, lost, 'lost', 'Không mất gì 🎉', true),
    col(`🎒 Nhặt được (${looted.length})`, ex.survived ? (items.length ? items : looted) : looted, ex.survived ? 'loot' : 'lost', 'Chưa nhặt được gì', !ex.survived)));
  const used = Object.entries(ex.usedConsumables ?? {}).filter(([, n]) => n > 0);
  if (used.length) box.append(h('div', { class: 'dim', style: 'font-size:12px;margin-top:6px;text-align:center' }, 'Đã dùng: ', used.map(([id, n]) => `${defOf(id)?.name ?? id} ×${n}`).join(' · ')));
  if (rw?.overflowGold) box.append(h('div', { class: 'dim', style: 'font-size:12px;margin-top:4px;text-align:center' }, `Kho đầy — ${fmt(rw.overflowGold)} vàng đổi từ đồ không còn chỗ chứa`));
  if (!ex.survived && kept.some((k) => k.slot === 'secure')) box.append(h('div', { class: 'xsafe', style: 'text-align:center;font-size:12px;margin-top:4px' }, '🔒 Túi an toàn đã giữ món quý của bạn'));
  return box;
}

function teamBlock(rewards: RunReward[], names: Map<number, { name: string; cls: number }>) {
  const others = rewards.filter((r) => r.idx !== S.meIdx);
  if (!others.length) return null;
  return h('div', { class: 'vteam' }, h('div', { class: 'sdt' }, 'ĐỒNG ĐỘI NHẬN ĐƯỢC'),
    ...others.map((r) => {
      const p = names.get(r.idx);
      return h('div', { class: 'vtm' }, h('b', null, `${CLASS_ICON[p?.cls ?? 0] ?? ''} ${p?.name ?? '?'}`),
        r.reward ? rewardChips({ ...r.reward, xp: undefined }, {}) : h('span', { class: 'dim' }, 'Khách'),
        r.levelUps > 0 ? h('em', null, `⬆ Cấp ${r.newLevel}`) : null);
    }));
}

function playerNames() {
  const m = new Map<number, { name: string; cls: number }>();
  for (const p of S.room?.players ?? []) m.set(p.idx, { name: p.name, cls: p.cls });
  return m;
}

export function showVictory(m: VictoryMsg) {
  closeModal();
  clearResultTimers();
  S.screen = 'victory';
  S.lastStage = m.stage;
  const app = document.getElementById('app')!;
  app.querySelector('.over, .victory')?.remove();
  const def = STAGE_BY_ID[m.stage];
  const mine = m.rewards.find((r) => r.idx === S.meIdx);
  const solo = !!S.room?.solo;
  const isHost = S.room ? S.room.host === S.meIdx : true;
  const nxt = def && !def.event ? nextStage(def.id) : null;
  const nextDef = nxt ? STAGE_BY_ID[nxt] : undefined;

  const stars = h('div', { class: 'vstars' }, ...[0, 1, 2].map((i) => h('i', { class: `vs s${i}` }, '★')));
  const facts = h('div', { class: 'vfacts' },
    h('span', null, '⏱ ', h('b', null, timeStr(m.secs))),
    h('span', null, '🌊 ', h('b', null, `${m.wave} đợt`)),
    mine?.firstClear ? h('span', { class: 'vfirst' }, '🏅 LẦN ĐẦU VƯỢT ẢI') : null);
  const myEx = mine?.extract;
  const exBox = extractBlock(myEx, mine, true);
  const loot = lootBlock(myEx && !myEx.survived ? undefined : mine, 400 + m.stars * 450 + 200, { chest: true });
  const btns = h('div', { class: 'row vbtns' });
  const goNext = () => {
    if (!nextDef) return;
    A.initAudio();
    if (solo) {
      S.afterLeave = () => createRoom({ solo: true, mode: 'stage', stage: nextDef.id, map: nextDef.map });
      send({ t: 'leave' });
    } else if (isHost) {
      send({ t: 'again' });
      setTimeout(() => send({ t: 'stage', stage: nextDef.id }), 150);
    }
  };
  if (nextDef && (solo || isHost)) btns.append(h('button', { class: 'btn green big', onclick: goNext }, `▶ ẢI TIẾP THEO ${nextDef.id}`));
  btns.append(
    h('button', { class: 'btn big', onclick: () => send({ t: 'again' }) }, solo ? '↻ CHƠI LẠI' : '↻ VỀ PHÒNG CHỜ'),
    h('button', { class: 'btn ghost big', onclick: () => send({ t: 'leave' }) }, '⌂ VỀ SẢNH'));
  const el = h('div', { class: 'victory' }, h('div', { class: 'card vcard' },
    h('div', { class: 'vrays' }),
    h('h1', { class: 'vttl' }, 'CHIẾN THẮNG!'),
    h('div', { class: 'vsub' }, def ? (def.event ? `🎉 ${def.name}` : `Ải ${def.id} · ${def.name}`) : m.stage),
    stars, facts, exBox, myEx && !myEx.survived ? null : h('div', { class: 'hsec' }, '🎁 Rương thưởng'), myEx && !myEx.survived ? null : loot.box,
    teamBlock(m.rewards, playerNames()),
    btns));
  app.append(el);
  A.sfxWaveClear();
  for (let i = 0; i < m.stars; i++) later(500 + i * 450, () => { stars.children[i]?.classList.add('on'); A.sfxStar(i); });
  // hồ sơ mới (server ghi DB chạy nền → hỏi lại sau chút)
  if (api.loggedIn) later(1500, () => { api.refresh().catch(() => {}); });
}

export function showOver(m: OverMsgX) {
  closeModal();
  clearResultTimers();
  S.screen = 'over';
  const app = document.getElementById('app')!;
  app.querySelector('.over, .victory')?.remove();
  A.sfxGameOver();
  const solo = !!S.room?.solo;
  const stageDef = m.stage ? STAGE_BY_ID[m.stage] : undefined;
  const best = Math.max(...m.stats.map((s) => s.kills));
  const tb = h('table', { class: 'lb' }, h('tr', null, h('th', null, 'NGƯỜI CHƠI'), h('th', { class: 'n' }, 'HẠ'), h('th', { class: 'n' }, 'SÁT THƯƠNG'), h('th', { class: 'n' }, 'ĐỠ DẬY'), h('th', { class: 'n' }, 'GỤC'), h('th', { class: 'n' }, 'XU KIẾM')));
  for (const s of m.stats) {
    tb.append(h('tr', { class: s.idx === S.meIdx ? 'me' : '' },
      h('td', null, `${CLASS_ICON[s.cls]} ${s.name}${s.kills === best && m.stats.length > 1 ? ' 🏅' : ''}`),
      h('td', { class: 'n' }, s.kills), h('td', { class: 'n' }, fmt(s.dmg)), h('td', { class: 'n' }, s.revives), h('td', { class: 'n' }, s.downs), h('td', { class: 'n' }, fmt(s.earned))));
  }
  const mineBoard = m.board.find((e) => e.score === m.score && e.wave === m.wave && e.kills === m.kills) ?? null;
  const mine = m.rewards?.find((r) => r.idx === S.meIdx);
  const myEx = mine?.extract;
  const exBox = extractBlock(myEx, mine, false);
  const consol = m.rewards ? h('div', { class: 'consol' }, h('div', { class: 'sdt' }, '🎁 THƯỞNG AN ỦI'), lootBlock(mine, 300, { chest: false }).box) : null;
  const right = stageDef
    ? h('div', null, h('h3', { class: 'sdt' }, 'ẢI'), h('div', { class: 'ostage' }, h('b', null, stageDef.event ? `🎉 ${stageDef.name}` : `${stageDef.id} · ${stageDef.name}`), h('span', null, `Đạt ${m.wave}/${stageDef.waves} đợt — thử nâng đồ, nâng kỹ năng rồi quay lại!`)), consol)
    : h('div', null, h('h3', { class: 'sdt' }, `TOP 10 ${solo ? 'MỘT MÌNH' : 'ĐỒNG ĐỘI'}`), boardTable(m.board, mineBoard), consol);
  const isHost = S.room ? S.room.host === S.meIdx : true;
  const el = h('div', { class: 'over' }, h('div', { class: 'card' },
    h('h1', { class: 'ttl' }, stageDef ? 'THẤT BẠI!' : solo ? 'BẠN ĐÃ GỤC!' : 'CẢ ĐỘI ĐÃ GỤC!'),
    m.rank > 0 ? h('div', { class: 'rank' }, `🏆 Hạng #${m.rank} bảng ${solo ? 'Một mình' : 'Đồng đội'}`) : null,
    exBox,
    h('div', { class: 'big3' },
      h('div', null, h('b', null, m.wave), h('span', null, 'ĐỢT ĐẠT TỚI')),
      h('div', null, h('b', null, fmt(m.score)), h('span', null, 'ĐIỂM ĐỘI')),
      h('div', null, h('b', null, m.kills), h('span', null, 'KHỈ BỊ HẠ')),
      h('div', null, h('b', null, timeStr(m.secs)), h('span', null, 'THỜI GIAN SỐNG'))),
    h('div', { class: 'cols' },
      h('div', null, h('h3', { class: 'sdt' }, 'THÀNH TÍCH'), tb),
      right),
    h('div', { class: 'row', style: 'margin-top:14px;justify-content:center' },
      h('button', { class: 'btn green big', onclick: () => send({ t: 'again' }) }, solo ? '↻ CHƠI LẠI' : isHost ? '↻ VỀ PHÒNG CHỜ' : '↻ VỀ PHÒNG CHỜ'),
      h('button', { class: 'btn ghost big', onclick: () => send({ t: 'leave' }) }, api.loggedIn ? '⌂ VỀ SẢNH' : '⌂ VỀ MÀN CHÍNH'))));
  app.append(el);
  if (api.loggedIn && m.rewards) later(1500, () => { api.refresh().catch(() => {}); });
}
