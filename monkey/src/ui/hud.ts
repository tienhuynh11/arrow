// HUD trong trận kiểu Võ Lâm: khung chân dung (máu đỏ + khiên xanh + cấp + bùa), đồng đội, minimap vuông có khung,
// bảng "Nhiệm vụ ải", thanh hành động [1][2] súng · [F] dao · [G][X][Q] kỹ năng (quét hồi chiêu) · [3][4] vật phẩm,
// nhãn túi đồ dưới đất, thông báo nhặt đồ theo màu phẩm, tâm ngắm + dấu trúng, số sát thương, màn gục, bảng điểm.
// Chế độ vô tận giữ xu + gợi ý nâng cấp / cửa hàng.

import * as THREE from 'three';
import { MAX_MONKEYS, MAX_PLAYERS } from '@shared/monkey/config';
import type { GameModel } from '@shared/monkey/client';
import { CLASSES, HP_TIER_COST, MAX_HP_TIER, MAX_TIER, MK_DOT, MK_VUA, REVIVE_RANGE, weaponOf, type WeaponDef } from '@shared/monkey/content';
import type { GroundLoot } from '@shared/monkey/gear';
import { ARENA } from '@shared/monkey/map';
import { PF_DOWN_MASK, PF_ON, PH_BREAK, PH_FIGHT, type QuickSlot, type SnapPlayer } from '@shared/monkey/proto';
import { curReloadTicks, curWeapon, spreadOf, type Cmd } from '@shared/monkey/sim';
import { GRADE_COLORS, defOf, gradeName, weaponDps } from '../gearlib';
import { keyLabel, settings } from '../settings';
import { CLASS_ICON, clear, clsColor, fmt, h, playerColor } from './dom';
import { gunSvg, itemSvg } from './icons';

export interface HudPlayer { idx: number; name: string; cls: number }
export interface HudOpts {
  /** false = ải (không xu, không cửa hàng) */
  economy: boolean;
  /** ải: súng mang theo của mình */
  weapons: WeaponDef[] | null;
  /** ải: vật phẩm ô nhanh lúc vào trận */
  quick: QuickSlot[];
  /** ải: tổng số đợt */
  waves?: number;
  stageName?: string;
}

interface DNum { el: HTMLElement; x: number; y: number; z: number; t: number; life: number; dx: number }
interface Slot { el: HTMLElement; sweep: HTMLElement; num: HTMLElement; sub: HTMLElement; pic: HTMLElement; key: HTMLElement; picKey: string }

const v3 = new THREE.Vector3();

export class Hud {
  root: HTMLElement;
  private o: HudOpts;
  // ---- chân dung ----
  private hpBar: HTMLElement;
  private hpLag: HTMLElement;
  private hpTxt: HTMLElement;
  private shBar: HTMLElement;
  private shTxt: HTMLElement;
  private buffs: HTMLElement;
  private buffKey = '';
  private lvBadge: HTMLElement;
  private cashEl: HTMLElement;
  private cashN: HTMLElement;
  private team: HTMLElement;
  private teamRows: { el: HTMLElement; bar: HTMLElement; sh: HTMLElement; tag: HTMLElement }[] = [];
  // ---- đợt / boss ----
  private waveT: HTMLElement;
  private waveS: HTMLElement;
  private waveP: HTMLElement;
  private bossEl: HTMLElement;
  private bossBar: HTMLElement;
  // ---- minimap + nhiệm vụ ----
  private radar: HTMLCanvasElement;
  private rctx: CanvasRenderingContext2D;
  private coord: HTMLElement;
  private quest: HTMLElement;
  private qWave: HTMLElement;
  private qLeft: HTMLElement;
  private qLoot: HTMLElement;
  private qTime: HTMLElement;
  private netEl: HTMLElement;
  private fpsEl: HTMLElement;
  // ---- thanh hành động ----
  private bar: HTMLElement;
  private wSlots: Slot[] = [];
  private knifeS: Slot;
  private sk: Slot[] = [];
  private qSlots: Slot[] = [];
  private ammoBig: HTMLElement;
  private rlBar: HTMLElement;
  private rlWrap: HTMLElement;
  private upHint: HTMLElement;
  private bagEl: HTMLElement;
  // ---- tâm ngắm, hiệu ứng ----
  private cross: HTMLElement;
  private crossParts: HTMLElement[];
  private hitm: HTMLElement;
  private hitT = 0;
  private dmgdir: HTMLElement;
  private dirs: { el: HTMLElement; t: number; ang: number; x: number; z: number }[] = [];
  private vign: HTMLElement;
  private flashEl: HTMLElement;
  private flashT = 0;
  private dnums: DNum[] = [];
  private dnumPool: HTMLElement[] = [];
  private tags: HTMLElement[] = [];
  private offs: HTMLElement[] = [];
  private lootTags = new Map<number, HTMLElement>();
  private prompt: HTMLElement;
  private downed: HTMLElement;
  private downSub: HTMLElement;
  private feedEl: HTMLElement;
  private pickEl: HTMLElement;
  private ann: HTMLElement;
  private hint: HTMLElement;
  private clickEl: HTMLElement;
  private scores: HTMLElement;
  private inspectEl: HTMLElement;
  players: HudPlayer[] = [];
  /** túi đồ trên đất (game.ts cập nhật) */
  loot = new Map<number, GroundLoot>();
  /** số món nhặt được trong trận (mình) */
  picked = 0;
  /** gọi khi bấm nút trên thanh hành động (chuột / cảm ứng) */
  onSlot: (k: 'w1' | 'w2' | 'knife' | 'g' | 'x' | 'q' | 'u1' | 'u2' | 'inspect') => void = () => {};
  /** hệ thống: dòng tin cho chat (tab Hệ thống) */
  onSystem: (msg: string, color?: string) => void = () => {};
  private lastCash = -1;
  private lastHp = -1;
  private waveEnds = 0;
  private wavePhase: 'fight' | 'break' = 'break';
  private waveTotal = 0;
  private waveN = 0;
  private ready: number[] = [];
  private t0 = performance.now();
  me = 0;
  private radarAt = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private fpsAt = 0;
  private hintUntil = 0;

  constructor(o: HudOpts = { economy: true, weapons: null, quick: [] }) {
    this.o = o;
    this.root = h('div', { class: `hud vh${o.economy ? ' eco' : ' stage'}` });
    // ---- chân dung ----
    this.hpLag = h('div', { class: 'lag' });
    this.hpBar = h('div', { class: 'f' });
    this.hpTxt = h('span');
    this.shBar = h('div', { class: 'f' });
    this.shTxt = h('span');
    this.buffs = h('div', { class: 'hbuffs' });
    this.lvBadge = h('i', { class: 'hlv' });
    this.cashN = h('b', null, '0');
    this.cashEl = h('div', { class: 'hcash' }, '🍌 ', this.cashN, h('small', null, ' xu'));
    this.team = h('div', { class: 'hteam' });
    const portrait = h('div', { class: 'hport' },
      h('div', { class: 'hface' }, h('span', { class: 'hico' }), this.lvBadge),
      h('div', { class: 'hbars' },
        h('div', { class: 'hname' }),
        h('div', { class: 'hb hp' }, this.hpLag, this.hpBar, this.hpTxt),
        h('div', { class: 'hb sh' }, this.shBar, this.shTxt),
        this.buffs, o.economy ? this.cashEl : null));
    // ---- đợt ----
    this.waveT = h('div', { class: 't' }, 'CHUẨN BỊ');
    this.waveS = h('div', { class: 's' });
    this.waveP = h('div');
    const wave = h('div', { class: 'wave' }, this.waveT, this.waveS, h('div', { class: 'prog' }, this.waveP));
    this.bossBar = h('div');
    this.bossEl = h('div', { class: 'boss hidden' }, h('div', { class: 'nm' }, '👑 VUA KHỈ ĐỘT'), h('div', { class: 'bb' }, this.bossBar));
    // ---- minimap ----
    this.radar = h('canvas', { class: 'hmap', width: 256, height: 256 }) as HTMLCanvasElement;
    this.rctx = this.radar.getContext('2d')!;
    this.coord = h('div', { class: 'hcoord' });
    this.netEl = h('span');
    this.fpsEl = h('div', { class: 'fps' });
    const mapBox = h('div', { class: 'hmapbox' }, h('i', { class: 'cn tl' }), h('i', { class: 'cn tr' }), h('i', { class: 'cn bl' }), h('i', { class: 'cn br' }), this.radar, h('div', { class: 'hmapn' }, '▲ B'));
    this.qWave = h('b');
    this.qLeft = h('b');
    this.qLoot = h('b');
    this.qTime = h('b');
    this.quest = h('div', { class: 'hquest' },
      h('div', { class: 'qh' }, o.economy ? '♾️ Vô tận' : `📜 Nhiệm vụ ải${o.stageName ? ` · ${o.stageName}` : ''}`),
      h('div', null, h('span', null, 'Đợt'), this.qWave),
      h('div', null, h('span', null, 'Khỉ còn lại'), this.qLeft),
      o.economy ? null : h('div', null, h('span', null, '🎒 Đồ đã nhặt'), this.qLoot),
      h('div', null, h('span', null, 'Thời gian'), this.qTime),
      o.economy ? null : h('div', { class: 'qn' }, 'Sống sót tới cuối để mang đồ về!'));
    const right = h('div', { class: 'hright' }, mapBox, h('div', { class: 'hcoordrow' }, this.coord, this.netEl), this.quest);
    // ---- thanh hành động ----
    const mk = (cls: string, key: string, k: Parameters<Hud['onSlot']>[0]): Slot => {
      const sweep = h('div', { class: 'sw' });
      const num = h('div', { class: 'num' });
      const sub = h('div', { class: 'sub' });
      const pic = h('div', { class: 'pic' });
      const keyEl = h('kbd', null, key);
      const el = h('button', { class: `as ${cls}`, onclick: () => this.onSlot(k) }, pic, sweep, num, sub, keyEl);
      return { el, sweep, num, sub, pic, key: keyEl, picKey: '' };
    };
    const K = settings.keys;
    this.wSlots = [mk('wpn', keyLabel(K.weapon1), 'w1'), mk('wpn', keyLabel(K.weapon2), 'w2')];
    this.knifeS = mk('kn', keyLabel(K.knife), 'knife');
    this.knifeS.pic.textContent = '🔪';
    this.sk = [mk('sk', keyLabel(K.skillG), 'g'), mk('sk', keyLabel(K.skillX), 'x'), mk('sk ult', keyLabel(K.ult), 'q')];
    this.qSlots = [mk('qs', keyLabel(K.item1), 'u1'), mk('qs', keyLabel(K.item2), 'u2')];
    const insp = h('button', { class: 'as mini', title: `Ngắm nghía súng (${keyLabel(K.inspect)})`, onclick: () => this.onSlot('inspect') }, h('div', { class: 'pic' }, '🔍'), h('kbd', null, keyLabel(K.inspect)));
    this.ammoBig = h('div', { class: 'hammo' });
    this.rlBar = h('div');
    this.rlWrap = h('div', { class: 'hrl' }, this.rlBar);
    this.upHint = h('div', { class: 'hup' });
    this.bagEl = h('div', { class: 'hbag', title: 'Ba lô trận' });
    this.bar = h('div', { class: 'hbar' },
      h('i', { class: 'cn tl' }), h('i', { class: 'cn tr' }),
      h('div', { class: 'grp' }, ...this.wSlots.map((s) => s.el), this.knifeS.el),
      h('i', { class: 'sep' }),
      h('div', { class: 'grp' }, ...this.sk.map((s) => s.el)),
      o.economy ? null : h('i', { class: 'sep' }),
      o.economy ? null : h('div', { class: 'grp' }, ...this.qSlots.map((s) => s.el)),
      h('i', { class: 'sep' }),
      h('div', { class: 'grp' }, insp));
    if (!o.weapons || o.weapons.length < 2) this.wSlots[1].el.classList.add('empty');
    o.quick.forEach((q, i) => {
      const s = this.qSlots[i];
      if (!s) return;
      const def = defOf(q.itemId);
      s.pic.innerHTML = itemSvg(def); // SVG tự vẽ
      s.el.title = def?.name ?? q.itemId;
    });
    for (let i = o.quick.length; i < 2; i++) this.qSlots[i].el.classList.add('empty');
    const bottom = h('div', { class: 'hbottom' }, this.rlWrap, h('div', { class: 'hbarrow' }, this.bar, h('div', { class: 'hside' }, this.ammoBig, this.bagEl)), this.upHint);
    // ---- tâm ngắm + hiệu ứng ----
    this.crossParts = ['l', 'r', 'u', 'd', 'c'].map((c) => h('i', { class: c }));
    this.cross = h('div', { class: 'cross' }, ...this.crossParts);
    this.hitm = h('div', { class: 'hitm' });
    for (let i = 0; i < 4; i++) this.hitm.append(h('i', { style: `transform: rotate(${45 + i * 90}deg) translateX(10px)` }));
    this.dmgdir = h('div', { class: 'dmgdir' });
    for (let i = 0; i < 4; i++) {
      const el = h('i');
      this.dmgdir.append(el);
      this.dirs.push({ el, t: 0, ang: 0, x: 0, z: 0 });
    }
    this.vign = h('div', { class: 'vign' });
    this.flashEl = h('div', { class: 'flash' });
    this.prompt = h('div', { class: 'prompt hidden' });
    this.downSub = h('div', { class: 'sub' });
    this.downed = h('div', { class: 'downed hidden' }, h('div', { class: 'box' }, h('div', { class: 'big' }, 'BẠN ĐÃ GỤC!'), this.downSub));
    this.feedEl = h('div', { class: 'feed' });
    this.pickEl = h('div', { class: 'hpick' });
    this.ann = h('div', { class: 'announce' });
    this.hint = h('div', { class: 'hint hidden' });
    this.clickEl = h('div', { class: 'click2 hidden' }, '🖱️ Bấm vào màn hình để điều khiển');
    this.scores = h('div', { class: 'scores card hidden' });
    this.inspectEl = h('div', { class: 'hinspect hidden' });
    this.root.append(this.vign, this.flashEl, this.dmgdir, h('div', { class: 'hleft' }, portrait, this.team), wave, this.bossEl, right, this.fpsEl,
      bottom, this.cross, this.hitm, this.prompt, this.downed, this.feedEl, this.pickEl, this.ann, this.hint, this.clickEl, this.scores, this.inspectEl);
  }

  setPlayers(list: HudPlayer[], me: number) {
    this.players = list;
    this.me = me;
    clear(this.team);
    this.teamRows = [];
    this.team.classList.toggle('compact', list.length > 5);
    const mine = list.find((p) => p.idx === me);
    if (mine) {
      const ico = this.root.querySelector('.hico') as HTMLElement;
      ico.textContent = CLASS_ICON[mine.cls];
      (ico.parentElement as HTMLElement).style.setProperty('--cc', clsColor(mine.cls));
      (this.root.querySelector('.hname') as HTMLElement).textContent = mine.name;
    }
    for (const p of list) {
      if (p.idx === me) continue;
      const bar = h('div', { class: 'f' });
      const sh = h('div', { class: 'f s' });
      const tag = h('div', { class: 'tg' });
      const el = h('div', { class: 'htm', style: `--pc:${playerColor(p.idx)}` },
        h('div', { class: 'ic', style: `background:${clsColor(p.cls)}` }, CLASS_ICON[p.cls]),
        h('div', { class: 'tx' }, h('div', { class: 'nm' }, p.name), h('div', { class: 'hb hp sm' }, bar, sh), tag));
      this.team.append(el);
      this.teamRows.push({ el, bar, sh, tag });
    }
    for (const t of this.tags) t.remove();
    this.tags = [];
    for (const o of this.offs) o.remove();
    this.offs = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const t = h('div', { class: 'tagname hidden' });
      this.root.append(t);
      this.tags.push(t);
      const o = h('div', { class: 'offarrow hidden' }, h('i', null, '🆘'));
      this.root.append(o);
      this.offs.push(o);
    }
    const cls = CLASSES[mine?.cls ?? 0];
    const defs = [cls.g, cls.x, cls.q];
    this.sk.forEach((s, i) => {
      s.pic.textContent = defs[i].icon;
      s.el.title = `${defs[i].name}: ${defs[i].desc}`;
    });
    const K = settings.keys;
    const k = (c: string) => `<span class="k">${keyLabel(c)}</span>`;
    if (this.o.economy) this.showHint(`${k(K.buyWeapon)} nâng súng · ${k(K.buyHp)} nâng máu · ${k(K.skillG)}/${k(K.skillX)} kỹ năng · ${k(K.ult)} tuyệt chiêu · ${k(K.shop)} cửa hàng · ${k(K.camera)} đổi camera`, 9000);
    else this.showHint(`${k(K.weapon1)}/${k(K.weapon2)} đổi súng · ${k(K.item1)}/${k(K.item2)} dùng vật phẩm · ${k(K.knife)} dao · chạy qua túi đồ để nhặt · ${k(K.camera)} camera · ${k(K.inspect)} xem súng`, 10000);
  }

  showHint(html: string, ms: number) {
    this.hint.innerHTML = html; // chỉ chứa chuỗi tĩnh của game + tên phím
    this.hint.classList.remove('hidden');
    this.hintUntil = performance.now() + ms;
  }

  setWave(phase: 'fight' | 'break', n: number, ends: number, total: number, boss: boolean, ready: number[]) {
    this.wavePhase = phase;
    this.waveEnds = ends;
    this.waveTotal = total;
    this.waveN = n;
    this.ready = ready;
    const of = this.o.waves ? `/${this.o.waves}` : '';
    this.waveT.textContent = phase === 'fight' ? `ĐỢT ${n}${of}${boss ? ' · BOSS' : ''}` : n === 0 ? 'CHUẨN BỊ!' : `NGHỈ SAU ĐỢT ${n}${of}`;
  }

  setClickPrompt(on: boolean, text = '🖱️ Bấm vào màn hình để điều khiển') {
    if (on && this.clickEl.textContent !== text) this.clickEl.textContent = text;
    this.clickEl.classList.toggle('hidden', !on);
  }

  /* ---------------- sự kiện ---------------- */
  hitmarker(kind: 'hit' | 'crit' | 'kill') {
    this.hitm.className = `hitm ${kind === 'hit' ? '' : kind}`;
    this.hitT = kind === 'kill' ? 0.3 : 0.16;
  }

  damageNumber(x: number, y: number, z: number, text: string, cls: '' | 'crit' | 'coin') {
    if (cls !== 'coin' && !settings.dmgNumbers) return;
    let el = this.dnumPool.pop();
    if (!el) {
      el = h('div', { class: 'dnum' });
      this.root.append(el);
    }
    el.className = `dnum ${cls}`;
    el.textContent = text;
    el.style.display = 'block';
    if (this.dnums.length > 40) {
      const old = this.dnums.shift()!;
      old.el.style.display = 'none';
      this.dnumPool.push(old.el);
    }
    this.dnums.push({ el, x, y, z, t: 0, life: cls === 'coin' ? 1 : 0.75, dx: (Math.random() - 0.5) * 30 });
  }

  hurtFrom(sx: number, sz: number, heavy: boolean) {
    const d = this.dirs.reduce((a, b) => (a.t < b.t ? a : b));
    d.t = 1.2;
    d.x = sx;
    d.z = sz;
    this.flashT = heavy ? 0.35 : 0.2;
  }

  feed(msg: string, kind: '' | 'bad' | 'good' | 'gold' = '') {
    const el = h('div', { class: kind }, msg);
    this.feedEl.prepend(el);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild!.remove();
    setTimeout(() => el.remove(), 5000);
    this.onSystem(msg, kind === 'bad' ? '#ff8a7a' : kind === 'good' ? '#8fe39a' : kind === 'gold' ? '#f2cc6a' : undefined);
  }

  /** thông báo nhặt đồ (màu phẩm) */
  pickup(itemId: string, grade: number, who?: string) {
    const def = defOf(itemId);
    const col = GRADE_COLORS[Math.max(0, Math.min(4, grade))];
    const name = def?.name ?? itemId;
    if (!who) {
      this.picked++;
      const pic = h('span', { class: 'pp' });
      pic.innerHTML = itemSvg(def); // SVG tự vẽ
      const el = h('div', { class: `g${grade}`, style: `--gc:${col}` }, pic, h('span', null, 'Nhặt được ', h('b', { style: `color:${col}` }, name)), h('small', null, gradeName(grade)));
      this.pickEl.prepend(el);
      while (this.pickEl.children.length > 4) this.pickEl.lastChild!.remove();
      setTimeout(() => el.classList.add('out'), 2600);
      setTimeout(() => el.remove(), 3200);
    }
    this.onSystem(`${who ? `${who} nhặt` : 'Bạn nhặt'} [${name}] (${gradeName(grade)})`, col);
  }

  announce(a1: string, a2: string, boss = false) {
    clear(this.ann);
    this.ann.className = `announce${boss ? ' boss' : ''}`;
    this.ann.append(h('div', { class: 'a1' }, a1), h('div', { class: 'a2' }, a2));
    void this.ann.offsetWidth;
    this.ann.classList.add('show');
  }

  showScores(on: boolean, m: GameModel | null) {
    this.scores.classList.toggle('hidden', !on);
    if (!on || !m) return;
    clear(this.scores);
    this.scores.classList.toggle('compact', this.players.length > 5);
    const eco = this.o.economy;
    const tb = h('table', null, h('tr', null, h('th', null, 'NGƯỜI CHƠI'), h('th', { class: 'n' }, 'HẠ'), eco ? h('th', { class: 'n' }, 'XU') : h('th', { class: 'n' }, 'BA LÔ'), h('th', { class: 'n' }, 'SÚNG'), h('th', { class: 'n' }, 'MÁU')));
    for (const p of this.players) {
      const i = m.info[p.idx];
      tb.append(h('tr', null, h('td', null, `${CLASS_ICON[p.cls]} ${p.name}`), h('td', { class: 'n' }, i ? i.kills : 0), h('td', { class: 'n' }, i ? (eco ? fmt(i.cash) : i.bag) : 0), h('td', { class: 'n' }, i ? (eco ? weaponOf(p.cls, i.tier).short : `ô ${i.wslot + 1}`) : ''), h('td', { class: 'n' }, i ? `${i.hp}/${i.maxHp}` : '')));
    }
    this.scores.append(h('h3', { style: 'margin:0 0 8px' }, `BẢNG ĐIỂM · ĐỢT ${m.wave}`), tb);
  }

  /** khung ngắm nghía súng (bên phải) */
  showInspect(w: WeaponDef | null, extra?: { name?: string; grade?: number; affixes?: [string, string][] }) {
    this.root.classList.toggle('inspecting', !!w);
    this.inspectEl.classList.toggle('hidden', !w);
    if (!w) return;
    clear(this.inspectEl);
    const d = weaponDps(w);
    const pic = h('div', { class: 'ip' });
    pic.innerHTML = gunSvg(w); // SVG tự vẽ
    const col = extra?.grade !== undefined ? GRADE_COLORS[extra.grade] : 'var(--gold-hi)';
    const row = (a: string, b: string | number) => h('div', null, h('span', null, a), h('b', null, String(b)));
    this.inspectEl.append(h('i', { class: 'cn tl' }), h('i', { class: 'cn tr' }), h('i', { class: 'cn bl' }), h('i', { class: 'cn br' }),
      h('div', { class: 'ih' }, '🔍 NGẮM NGHÍA'), pic,
      h('div', { class: 'in', style: `color:${col}` }, extra?.name ?? w.name),
      h('div', { class: 'ig', style: `color:${col}` }, extra?.grade !== undefined ? gradeName(extra.grade) : ''),
      h('div', { class: 'is' },
        row('Sát thương', w.pellets > 1 ? `${w.dmg} × ${w.pellets}` : w.dmg),
        row('Tốc bắn', `${Math.round(d.rpm)} phát/phút`),
        row('Băng đạn', w.mag),
        row('Nạp đạn', `${(w.reload / 60).toFixed(1)} giây`),
        row('Tầm bắn', `${w.range} m`),
        w.pierce ? row('Xuyên', w.pierce) : null,
        w.splashR ? row('Nổ lan', `${w.splashR} m`) : null,
        row('Độ tản', `${(w.spread * 57.3).toFixed(1)}°`),
        h('div', { class: 'dps' }, h('span', null, 'Sát thương/giây'), h('b', null, fmt(d.sustained)))),
      ...(extra?.affixes ?? []).map(([a, b]) => h('div', { class: 'ia' }, `${a} ${b}`)),
      h('div', { class: 'ix' }, `Kéo chuột để xoay · ${keyLabel(settings.keys.inspect)} / Esc để thoát`));
  }

  /* ---------------- mỗi khung hình ---------------- */
  update(m: GameModel, cam: THREE.PerspectiveCamera, dt: number, now: number, lastCmd: Cmd | null, ping: number, fps: number) {
    const W = window.innerWidth, H = window.innerHeight;
    const me = m.info[this.me];
    if (this.hintUntil && now > this.hintUntil) {
      this.hint.classList.add('hidden');
      this.hintUntil = 0;
    }
    // ---- đội ----
    let r = 0;
    for (const p of this.players) {
      if (p.idx === this.me) continue;
      const row = this.teamRows[r++];
      const inf = m.info[p.idx];
      if (!row || !inf) continue;
      const down = inf.flags & PF_DOWN_MASK;
      row.bar.style.transform = `scaleX(${Math.max(0, inf.hp / Math.max(1, inf.maxHp))})`;
      row.sh.style.transform = `scaleX(${Math.min(1, inf.shield / Math.max(1, inf.maxHp))})`;
      row.el.className = `htm${down === 1 ? ' down' : down === 2 ? ' dead' : ''}`;
      row.tag.textContent = down === 1 ? `GỤC · ${inf.bleed}s` : down === 2 ? (this.o.economy ? 'TỬ TRẬN' : 'BỊ LOẠI') : !(inf.flags & PF_ON) ? 'mất kết nối' : '';
    }
    // ---- đợt ----
    const secs = Math.max(0, Math.ceil((this.waveEnds - Date.now()) / 1000));
    if (m.phase === PH_BREAK || this.wavePhase === 'break') {
      this.waveS.textContent = this.o.economy
        ? `Đợt ${m.wave + 1} sau ${secs}s · ${keyLabel(settings.keys.shop)}: cửa hàng · sẵn sàng ${this.ready.length}/${this.players.length}`
        : `Đợt ${m.wave + 1} sau ${secs}s · nhặt đồ rơi trong lúc nghỉ`;
      this.waveP.style.transform = `scaleX(${Math.min(1, secs / 14)})`;
    } else if (m.phase === PH_FIGHT) {
      this.waveS.textContent = `Còn ${m.left} khỉ`;
      this.waveP.style.transform = `scaleX(${this.waveTotal ? Math.min(1, m.left / this.waveTotal) : 0})`;
    }
    this.bossEl.classList.toggle('hidden', m.bossHp === 0);
    if (m.bossHp) this.bossBar.style.transform = `scaleX(${m.bossHp / 65535})`;
    // ---- nhiệm vụ ----
    this.qWave.textContent = `${Math.max(this.waveN, m.wave)}${this.o.waves ? ` / ${this.o.waves}` : ''}`;
    this.qLeft.textContent = m.phase === PH_FIGHT ? String(m.left) : '—';
    this.qLoot.textContent = `${me ? me.bag : this.picked} món`;
    const el = Math.floor((now - this.t0) / 1000);
    this.qTime.textContent = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;

    if (me) {
      const cls = CLASSES[me.cls];
      // ---- máu + khiên ----
      const f = Math.max(0, me.hp / Math.max(1, me.maxHp));
      if (me.hp !== this.lastHp) {
        this.hpTxt.textContent = `${me.hp} / ${me.maxHp}`;
        this.hpBar.style.transform = `scaleX(${f})`;
        this.hpLag.style.transform = `scaleX(${f})`;
        this.lastHp = me.hp;
      }
      this.shBar.style.transform = `scaleX(${Math.min(1, me.shield / Math.max(1, me.maxHp))})`;
      this.shTxt.textContent = me.shield > 0 ? `Khiên ${me.shield}` : 'Khiên 0';
      this.vign.style.opacity = me.hp > 0 && f < 0.35 ? String(0.35 + (0.35 - f) * 1.6) : '0';
      this.lvBadge.textContent = this.o.economy ? String(me.tier + 1) : String(me.kills);
      this.lvBadge.title = this.o.economy ? 'Bậc súng' : 'Khỉ đã hạ';
      // bùa (buff)
      const bk = `${m.pred.spdT > 0 ? 's' : ''}${me.shield > 0 ? 'h' : ''}${m.pred.braceT > 0 ? 'b' : ''}${me.ult >= 255 ? 'u' : ''}${!this.o.economy && me.hpTier ? 't' : ''}`;
      if (bk !== this.buffKey) {
        this.buffKey = bk;
        clear(this.buffs);
        const b = (ic: string, t: string) => h('i', { title: t }, ic);
        if (bk.includes('s')) this.buffs.append(b('💨', 'Tăng tốc'));
        if (bk.includes('h')) this.buffs.append(b('🛡️', 'Khiên chắn'));
        if (bk.includes('b')) this.buffs.append(b('💪', 'Gồng mình'));
        if (bk.includes('u')) this.buffs.append(b('⭐', 'Tuyệt chiêu sẵn sàng'));
      }
      if (this.o.economy && me.cash !== this.lastCash) {
        if (this.lastCash >= 0 && me.cash > this.lastCash) {
          const pop = h('span', { class: 'pop' }, `+${fmt(me.cash - this.lastCash)}`);
          this.cashEl.append(pop);
          setTimeout(() => pop.remove(), 900);
        }
        this.cashN.textContent = fmt(me.cash);
        this.lastCash = me.cash;
      }
      // ---- súng ----
      const w = curWeapon(m.pred);
      const ws = this.o.weapons;
      const active = ws ? m.pred.wslot : 0;
      for (let i = 0; i < 2; i++) {
        const s = this.wSlots[i];
        const wi = ws ? ws[i] : i === 0 ? weaponOf(me.cls, me.tier) : null;
        if (!wi) continue;
        const pk = `${wi.model}|${wi.color}`;
        if (pk !== s.picKey) {
          s.picKey = pk;
          s.pic.innerHTML = gunSvg(wi); // SVG tự vẽ
          s.el.title = wi.name;
        }
        const ammo = i === active ? m.pred.ammo : m.pred.ammoAlt;
        s.sub.textContent = `${ammo}/${wi.mag}`;
        s.el.classList.toggle('on', i === active);
        s.el.classList.toggle('low', ammo <= Math.ceil(wi.mag * 0.25));
        s.sweep.style.setProperty('--p', i === active && m.pred.swapT > 0 ? String(m.pred.swapT / 24) : '0');
      }
      const ammo = m.pred.ammo;
      this.ammoBig.className = `hammo${ammo <= Math.ceil(w.mag * 0.25) ? ' low' : ''}`;
      this.ammoBig.textContent = '';
      this.ammoBig.append(String(ammo), h('small', null, ` / ${w.mag}`), h('em', null, w.short || w.name));
      const rl = m.pred.reloadT;
      this.rlWrap.style.visibility = rl > 0 ? 'visible' : 'hidden';
      if (rl > 0) this.rlBar.style.transform = `scaleX(${1 - rl / curReloadTicks(m.pred)})`;
      // ---- vô tận: gợi ý nâng cấp ----
      if (this.o.economy) {
        clear(this.upHint);
        if (me.tier < MAX_TIER) {
          const c = weaponOf(me.cls, me.tier + 1).cost;
          this.upHint.append(h('span', { class: me.cash >= c ? 'can' : '' }, `[${keyLabel(settings.keys.buyWeapon)}] ${weaponOf(me.cls, me.tier + 1).short} `, h('b', null, `${fmt(c)} xu`)));
        }
        if (me.hpTier < MAX_HP_TIER) {
          const c = HP_TIER_COST[me.hpTier + 1];
          this.upHint.append(h('span', { class: me.cash >= c ? 'can' : '' }, `[${keyLabel(settings.keys.buyHp)}] +25 máu `, h('b', null, `${fmt(c)} xu`)));
        }
        this.upHint.append(h('span', null, `[${keyLabel(settings.keys.shop)}] cửa hàng`));
      } else {
        this.bagEl.textContent = `🎒 ${me.bag}`;
      }
      // ---- kỹ năng (quét hồi chiêu) ----
      const cds = [me.cdG / 10, me.cdX / 10];
      const maxs = [cls.g.cd, cls.x.cd];
      const costs = [cls.g.cost, cls.x.cost];
      for (let i = 0; i < 2; i++) {
        const s = this.sk[i];
        s.sweep.style.setProperty('--p', String(Math.min(1, cds[i] / Math.max(0.1, maxs[i]))));
        s.num.textContent = cds[i] > 0 ? cds[i].toFixed(cds[i] < 3 ? 1 : 0) : '';
        s.sub.textContent = this.o.economy ? String(costs[i]) : '';
        s.el.classList.toggle('poor', this.o.economy && me.cash < costs[i]);
      }
      const u = this.sk[2];
      u.sweep.style.setProperty('--p', String(1 - me.ult / 255));
      u.el.classList.toggle('ready', me.ult >= 255);
      u.num.textContent = me.ult >= 255 ? '' : `${Math.floor((me.ult / 255) * 100)}%`;
      // ---- vật phẩm ô nhanh ----
      const qc = [me.q1, me.q2];
      this.o.quick.forEach((q, i) => {
        const s = this.qSlots[i];
        if (!s) return;
        s.sub.textContent = String(qc[i]);
        s.el.classList.toggle('used', qc[i] <= 0);
        void q;
      });
      // ---- tâm ngắm (độ tản thật theo sim) ----
      const sp = lastCmd ? spreadOf(m.pred, lastCmd) : w.spread;
      const px = Math.max(4, (Math.tan(sp) / Math.tan(((cam.fov / 2) * Math.PI) / 180)) * (H / 2));
      this.crossParts[0].style.transform = `translate(${-px - 9}px,0)`;
      this.crossParts[1].style.transform = `translate(${px}px,0)`;
      this.crossParts[2].style.transform = `translate(0,${-px - 9}px)`;
      this.crossParts[3].style.transform = `translate(0,${px}px)`;
      this.cross.style.setProperty('--cross', settings.crossColor);
      this.cross.style.opacity = (me.flags & PF_DOWN_MASK) || this.root.classList.contains('inspecting') ? '0' : '1';
      // ---- gục ----
      const down = me.flags & PF_DOWN_MASK;
      this.downed.classList.toggle('hidden', down === 0);
      const big = this.downed.querySelector('.big') as HTMLElement;
      if (down === 1) {
        big.textContent = 'BẠN ĐÃ GỤC!';
        this.downSub.textContent = me.revive > 0 ? `Đồng đội đang đỡ bạn dậy… ${Math.round((me.revive / 255) * 100)}%` : `Bò về phía đồng đội! Còn ${me.bleed} giây trước khi ${this.o.economy ? 'tử trận' : 'bị loại (mất đồ)'}`;
      } else if (down === 2) {
        big.textContent = this.o.economy ? 'TỬ TRẬN' : 'GỤC NGÃ';
        this.downSub.textContent = this.o.economy ? 'Bạn sẽ hồi sinh khi cả đội vượt qua đợt này' : 'Đồ đang mang đã rơi mất (trừ Túi an toàn) — xem đồng đội chiến đấu';
      }
      // ---- nhắc đỡ dậy ----
      let near: SnapPlayer | null = null;
      let nd = 1e9;
      for (const p of this.players) {
        if (p.idx === this.me) continue;
        const inf = m.info[p.idx];
        if (!inf || (inf.flags & PF_DOWN_MASK) !== 1) continue;
        const d = Math.hypot(m.oX[p.idx] - m.rx, m.oZ[p.idx] - m.rz);
        if (d < nd) { nd = d; near = inf; }
      }
      if (near && nd < REVIVE_RANGE + 0.3 && down === 0) {
        const name = this.players.find((p) => p.idx === near!.idx)?.name ?? '';
        this.prompt.classList.remove('hidden');
        clear(this.prompt);
        this.prompt.append('Giữ ', h('span', { class: 'k' }, keyLabel(settings.keys.use)), ` để đỡ ${name} dậy`, h('div', { class: 'pr' }, h('div', { style: `transform:scaleX(${near.revive / 255})` })));
      } else this.prompt.classList.add('hidden');
    }

    // ---- dấu trúng ----
    if (this.hitT > 0) {
      this.hitT -= dt;
      this.hitm.style.opacity = String(Math.min(1, this.hitT * 8));
      this.hitm.style.transform = `scale(${1 + Math.max(0, this.hitT) * 1.2})`;
    } else this.hitm.style.opacity = '0';
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashEl.style.opacity = String(Math.max(0, this.flashT * 3));
    } else this.flashEl.style.opacity = '0';
    const camYaw = Math.atan2(-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[10]);
    for (const d of this.dirs) {
      if (d.t <= 0) { d.el.style.opacity = '0'; continue; }
      d.t -= dt;
      const a = Math.atan2(d.x - m.rx, d.z - m.rz) - camYaw;
      d.el.style.opacity = String(Math.min(1, d.t * 1.5));
      d.el.style.transform = `rotate(${-a}rad)`;
    }
    // ---- số sát thương ----
    for (let i = this.dnums.length - 1; i >= 0; i--) {
      const d = this.dnums[i];
      d.t += dt;
      if (d.t >= d.life) {
        d.el.style.display = 'none';
        this.dnumPool.push(d.el);
        this.dnums.splice(i, 1);
        continue;
      }
      v3.set(d.x, d.y, d.z).project(cam);
      if (v3.z > 1) { d.el.style.opacity = '0'; continue; }
      const sx = (v3.x * 0.5 + 0.5) * W + d.dx * d.t;
      const sy = (-v3.y * 0.5 + 0.5) * H - d.t * 50;
      const p = d.t / d.life;
      d.el.style.opacity = String(p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3);
      d.el.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(${p < 0.12 ? 1.4 - p * 3 : 1})`;
    }
    // ---- nhãn túi đồ dưới đất ----
    for (const [id, tag] of this.lootTags) if (!this.loot.has(id)) { tag.remove(); this.lootTags.delete(id); }
    for (const l of this.loot.values()) {
      let tag = this.lootTags.get(l.id);
      if (!tag) {
        const def = defOf(l.itemId);
        tag = h('div', { class: `ltag g${l.grade}`, style: `color:${GRADE_COLORS[l.grade] ?? '#fff'}` }, def?.name ?? l.itemId);
        this.root.append(tag);
        this.lootTags.set(l.id, tag);
      }
      const dx = l.x - m.rx, dz = l.z - m.rz;
      const dist = Math.hypot(dx, dz);
      v3.set(l.x, 0.95, l.z).project(cam);
      const vis = dist < 28 && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
      tag.style.display = vis ? 'block' : 'none';
      if (vis) {
        tag.style.transform = `translate(${(v3.x * 0.5 + 0.5) * W}px,${(-v3.y * 0.5 + 0.5) * H}px) translate(-50%,-100%)`;
        tag.style.opacity = String(Math.max(0.35, 1 - dist / 30));
      }
    }
    // ---- nhãn đồng đội + mũi tên SOS ----
    for (const p of this.players) {
      const tag = this.tags[p.idx];
      const off = this.offs[p.idx];
      if (!tag) continue;
      const inf = m.info[p.idx];
      if (p.idx === this.me || !inf) { tag.classList.add('hidden'); off.classList.add('hidden'); continue; }
      const down = inf.flags & PF_DOWN_MASK;
      v3.set(m.oX[p.idx], m.oY[p.idx] + (down ? 0.9 : 2.25), m.oZ[p.idx]).project(cam);
      const onScreen = v3.z < 1 && Math.abs(v3.x) < 1 && Math.abs(v3.y) < 1;
      if (onScreen) {
        tag.classList.remove('hidden');
        tag.className = `tagname${down ? ' down' : ''}`;
        clear(tag);
        tag.append(down === 1 ? `🆘 ${p.name} · ${inf.bleed}s` : down === 2 ? `💀 ${p.name}` : p.name);
        if (down === 1 && inf.revive > 0) tag.append(h('div', { class: 'rv' }, `đang đỡ ${Math.round((inf.revive / 255) * 100)}%`));
        if (!down) tag.append(h('div', { class: 'b' }, h('div', { style: `transform:scaleX(${inf.hp / Math.max(1, inf.maxHp)})` })));
        tag.style.left = `${(v3.x * 0.5 + 0.5) * W}px`;
        tag.style.top = `${(-v3.y * 0.5 + 0.5) * H}px`;
        off.classList.add('hidden');
      } else {
        tag.classList.add('hidden');
        if (down === 1) {
          let x = v3.x, y = v3.y;
          if (v3.z > 1) { x = -x; y = -y; }
          const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 0.001);
          x *= k; y *= k;
          off.classList.remove('hidden');
          off.style.transform = `translate(${(x * 0.5 + 0.5) * W}px, ${(-y * 0.5 + 0.5) * H}px)`;
        } else off.classList.add('hidden');
      }
    }
    // ---- minimap (10 lần/giây) ----
    if (now - this.radarAt > 100) {
      this.radarAt = now;
      this.drawRadar(m, camYaw);
      this.coord.textContent = `X ${Math.round(m.rx)} · Z ${Math.round(m.rz)}`;
    }
    // ---- fps/ping ----
    this.fpsAcc += fps;
    this.fpsN++;
    if (now - this.fpsAt > 500) {
      this.fpsAt = now;
      this.netEl.textContent = `ping ${Math.round(ping)}ms`;
      this.fpsEl.textContent = settings.showFps ? `${Math.round(this.fpsAcc / this.fpsN)} FPS · đệm ${Math.round(m.delay * 50)}ms · khỉ ${m.visibleMonkeys()}` : '';
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
  }

  private drawRadar(m: GameModel, camYaw: number) {
    const g = this.rctx;
    const S = 256, R = S / 2;
    const range = 32;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(30, 22, 12, .72)';
    g.fillRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();
    g.translate(R, R);
    g.rotate(camYaw);
    const k = (R - 6) / range;
    const toR = (x: number, z: number): [number, number] => [-(x - m.rx) * k, -(z - m.rz) * k];
    // nền "giấy": lưới mờ
    g.strokeStyle = 'rgba(214,178,94,.10)';
    g.lineWidth = 1;
    for (let gx = -ARENA; gx <= ARENA; gx += 8) {
      const [a1, b1] = toR(gx, -ARENA), [a2, b2] = toR(gx, ARENA);
      g.beginPath(); g.moveTo(a1, b1); g.lineTo(a2, b2); g.stroke();
      const [c1, d1] = toR(-ARENA, gx), [c2, d2] = toR(ARENA, gx);
      g.beginPath(); g.moveTo(c1, d1); g.lineTo(c2, d2); g.stroke();
    }
    g.strokeStyle = 'rgba(247,225,160,.45)';
    g.lineWidth = 3;
    const [ax, az] = toR(-ARENA, -ARENA);
    g.strokeRect(ax, az, -ARENA * 2 * k, -ARENA * 2 * k);
    // túi đồ
    for (const l of this.loot.values()) {
      const [x, y] = toR(l.x, l.z);
      g.fillStyle = GRADE_COLORS[l.grade] ?? '#fff';
      g.beginPath();
      g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y);
      g.closePath();
      g.fill();
    }
    for (let sl = 0; sl < MAX_MONKEYS; sl++) {
      if (!m.rmVisible[sl]) continue;
      const [x, y] = toR(m.rmX[sl], m.rmZ[sl]);
      const t = m.mType[sl];
      const big = t === MK_VUA ? 8 : t === MK_DOT ? 5 : 3;
      g.fillStyle = t === MK_VUA ? '#ff3b3b' : t === 3 ? '#ff7a59' : '#e8a050';
      g.beginPath();
      g.arc(x, y, big, 0, Math.PI * 2);
      g.fill();
    }
    for (const e of m.entities) {
      const [x, y] = toR(e.x, e.z);
      g.fillStyle = '#5ab4ff';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const p of this.players) {
      if (p.idx === this.me) continue;
      const inf = m.info[p.idx];
      if (!inf) continue;
      const [x, y] = toR(m.oX[p.idx], m.oZ[p.idx]);
      const down = inf.flags & PF_DOWN_MASK;
      g.fillStyle = down ? (Math.floor(performance.now() / 250) % 2 ? '#ff4d4d' : '#fff') : playerColor(p.idx);
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.stroke();
    }
    g.restore();
    g.fillStyle = '#f7e1a0';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(R, R - 11);
    g.lineTo(R - 7, R + 7);
    g.lineTo(R, R + 3);
    g.lineTo(R + 7, R + 7);
    g.closePath();
    g.fill();
    g.stroke();
  }

  destroy() {
    for (const t of this.lootTags.values()) t.remove();
    this.lootTags.clear();
    this.root.remove();
  }
}
