// HUD trong trận: đội, đợt, boss, radar, máu/tiền, súng/đạn, kỹ năng, tâm ngắm + dấu trúng,
// số sát thương, hướng bị đánh, nhắc đỡ dậy, màn gục, bảng tin, thông báo lớn, bảng điểm.

import * as THREE from 'three';
import { MAX_MONKEYS } from '@shared/monkey/config';
import type { GameModel } from '@shared/monkey/client';
import { CLASSES, HP_TIER_COST, MAX_HP_TIER, MAX_TIER, MK_DOT, MK_VUA, MONKEYS, REVIVE_RANGE, reloadTicks, weaponOf } from '@shared/monkey/content';
import { ARENA } from '@shared/monkey/map';
import { PF_DOWN_MASK, PF_ON, PH_BREAK, PH_FIGHT, type SnapPlayer } from '@shared/monkey/proto';
import { spreadOf, type Cmd } from '@shared/monkey/sim';
import { keyLabel, settings } from '../settings';
import { CLASS_ICON, clear, clsColor, fmt, h } from './dom';
import { gunSvg } from './icons';

export interface HudPlayer { idx: number; name: string; cls: number }

interface DNum { el: HTMLElement; x: number; y: number; z: number; t: number; life: number; dx: number }

const v3 = new THREE.Vector3();

export class Hud {
  root: HTMLElement;
  private team: HTMLElement;
  private teamRows: { el: HTMLElement; bar: HTMLElement; sh: HTMLElement; nm: HTMLElement; cash: HTMLElement; tag: HTMLElement }[] = [];
  private waveT: HTMLElement;
  private waveS: HTMLElement;
  private waveP: HTMLElement;
  private bossEl: HTMLElement;
  private bossBar: HTMLElement;
  private radar: HTMLCanvasElement;
  private rctx: CanvasRenderingContext2D;
  private netEl: HTMLElement;
  private hpV: HTMLElement;
  private hpG: HTMLElement;
  private hpLag: HTMLElement;
  private hpS: HTMLElement;
  private cashEl: HTMLElement;
  private cashN: HTMLElement;
  private tiersEl: HTMLElement;
  private gunPic: HTMLElement;
  private gunPicKey = '';
  private gunNm: HTMLElement;
  private gunAm: HTMLElement;
  private gunRl: HTMLElement;
  private gunRlWrap: HTMLElement;
  private gunUp: HTMLElement;
  private sk: { el: HTMLElement; cd: HTMLElement; num: HTMLElement; cost: HTMLElement }[] = [];
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
  private prompt: HTMLElement;
  private downed: HTMLElement;
  private downSub: HTMLElement;
  private feedEl: HTMLElement;
  private ann: HTMLElement;
  private fpsEl: HTMLElement;
  private hint: HTMLElement;
  private clickEl: HTMLElement;
  private scores: HTMLElement;
  players: HudPlayer[] = [];
  private lastCash = -1;
  private lastHp = -1;
  private waveEnds = 0;
  private wavePhase: 'fight' | 'break' = 'break';
  private waveTotal = 0;
  private ready: number[] = [];
  me = 0;
  private radarAt = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private fpsAt = 0;
  private hintUntil = 0;

  constructor() {
    this.root = h('div', { class: 'hud' });
    this.team = h('div', { class: 'team' });
    this.waveT = h('div', { class: 't' }, 'CHUẨN BỊ');
    this.waveS = h('div', { class: 's' });
    this.waveP = h('div');
    const wave = h('div', { class: 'wave' }, this.waveT, this.waveS, h('div', { class: 'prog' }, this.waveP));
    this.bossBar = h('div');
    this.bossEl = h('div', { class: 'boss hidden' }, h('div', { class: 'nm' }, '👑 VUA KHỈ ĐỘT'), h('div', { class: 'bb' }, this.bossBar));
    this.radar = h('canvas', { class: 'radar', width: 300, height: 300 }) as HTMLCanvasElement;
    this.rctx = this.radar.getContext('2d')!;
    this.netEl = h('div', { class: 'net' });
    this.fpsEl = h('div', { class: 'fps' });
    this.hpV = h('div', { class: 'hpv' }, '100');
    this.hpLag = h('div', { class: 'lag' });
    this.hpG = h('div', { class: 'g' });
    this.hpS = h('div', { class: 's' });
    this.cashN = h('span', null, '0');
    this.cashEl = h('div', { class: 'cash' }, '🍌', this.cashN, h('span', { style: 'font-size:13px;color:var(--dim)' }, 'xu'));
    this.tiersEl = h('div', { class: 'tiers' });
    const me = h('div', { class: 'selfbox' },
      h('div', { class: 'hp' }, this.hpV, h('div', { class: 'hpb' }, this.hpLag, this.hpG, this.hpS)),
      this.cashEl, this.tiersEl);
    this.gunPic = h('div', { class: 'gp' });
    this.gunNm = h('div', { class: 'nm' });
    this.gunAm = h('div', { class: 'am' });
    this.gunRl = h('div');
    this.gunRlWrap = h('div', { class: 'rl' }, this.gunRl);
    this.gunUp = h('div', { class: 'up' });
    const gun = h('div', { class: 'gun' }, this.gunPic, this.gunNm, this.gunAm, this.gunRlWrap, this.gunUp);
    const skills = h('div', { class: 'skills' });
    for (let i = 0; i < 3; i++) {
      const cd = h('div', { class: 'cd' });
      const num = h('div', { class: 'num' });
      const cost = h('div', { class: 'cost' });
      const el = h('div', { class: `sk${i === 2 ? ' ult' : ''}` }, h('span', { class: 'ic' }), cd, num, h('div', { class: 'key' }), cost);
      skills.append(el);
      this.sk.push({ el, cd, num, cost });
    }
    this.crossParts = ['l', 'r', 'u', 'd', 'c'].map((c) => h('i', { class: c }));
    this.cross = h('div', { class: 'cross' }, ...this.crossParts);
    this.hitm = h('div', { class: 'hitm' });
    for (let i = 0; i < 4; i++) {
      const a = 45 + i * 90;
      this.hitm.append(h('i', { style: `transform: rotate(${a}deg) translateX(10px)` }));
    }
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
    this.ann = h('div', { class: 'announce' });
    this.hint = h('div', { class: 'hint hidden' });
    this.clickEl = h('div', { class: 'click2 hidden' }, '🖱️ Bấm vào màn hình để điều khiển');
    this.scores = h('div', { class: 'scores card hidden' });
    this.root.append(this.vign, this.flashEl, this.dmgdir, this.team, wave, this.bossEl, this.radar, this.netEl, this.fpsEl, me, gun, skills, this.cross, this.hitm, this.prompt, this.downed, this.feedEl, this.ann, this.hint, this.clickEl, this.scores);
  }

  setPlayers(list: HudPlayer[], me: number) {
    this.players = list;
    this.me = me;
    clear(this.team);
    this.teamRows = [];
    for (const p of list) {
      const bar = h('div');
      const sh = h('div', { class: 'sh' });
      const cash = h('i');
      const nm = h('div', { class: 'nm' }, h('span', null, p.idx === me ? `${p.name} (bạn)` : p.name), cash);
      const tag = h('div', { class: 'tag2' });
      const el = h('div', { class: 'tm' }, h('div', { class: 'ic', style: `background:${clsColor(p.cls)}` }, CLASS_ICON[p.cls]), h('div', null, nm, h('div', { class: 'bar' }, bar, sh), tag));
      this.team.append(el);
      this.teamRows.push({ el, bar, sh, nm, cash, tag });
    }
    // nhãn tên trên đầu đồng đội
    for (const t of this.tags) t.remove();
    this.tags = [];
    for (const o of this.offs) o.remove();
    this.offs = [];
    for (let i = 0; i < 4; i++) {
      const t = h('div', { class: 'tagname hidden' });
      this.root.append(t);
      this.tags.push(t);
      const o = h('div', { class: 'offarrow hidden' }, h('i', null, '🆘'));
      this.root.append(o);
      this.offs.push(o);
    }
    const cls = CLASSES[list.find((p) => p.idx === me)?.cls ?? 0];
    const keys = [settings.keys.skillG, settings.keys.skillX, settings.keys.ult];
    const defs = [cls.g, cls.x, cls.q];
    this.sk.forEach((s, i) => {
      (s.el.querySelector('.ic') as HTMLElement).textContent = defs[i].icon;
      (s.el.querySelector('.key') as HTMLElement).textContent = keyLabel(keys[i]);
      s.el.title = `${defs[i].name}: ${defs[i].desc}`;
    });
    this.showHint(`<span class="k">${keyLabel(settings.keys.buyWeapon)}</span> nâng súng · <span class="k">${keyLabel(settings.keys.buyHp)}</span> nâng máu · <span class="k">${keyLabel(settings.keys.skillG)}</span>/<span class="k">${keyLabel(settings.keys.skillX)}</span> kỹ năng · <span class="k">${keyLabel(settings.keys.ult)}</span> tuyệt chiêu · <span class="k">${keyLabel(settings.keys.shop)}</span> cửa hàng`, 9000);
  }

  showHint(html: string, ms: number) {
    this.hint.innerHTML = html; // chỉ chứa chuỗi tĩnh của game (không có dữ liệu người dùng)
    this.hint.classList.remove('hidden');
    this.hintUntil = performance.now() + ms;
  }

  setWave(phase: 'fight' | 'break', n: number, ends: number, total: number, boss: boolean, ready: number[]) {
    this.wavePhase = phase;
    this.waveEnds = ends;
    this.waveTotal = total;
    this.ready = ready;
    this.waveT.textContent = phase === 'fight' ? `ĐỢT ${n}${boss ? ' · BOSS' : ''}` : n === 0 ? 'CHUẨN BỊ!' : `NGHỈ SAU ĐỢT ${n}`;
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

  /** hướng nguồn sát thương (toạ độ thế giới) */
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
    while (this.feedEl.children.length > 6) this.feedEl.lastChild!.remove();
    setTimeout(() => el.remove(), 5000);
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
    const tb = h('table', null, h('tr', null, h('th', null, 'NGƯỜI CHƠI'), h('th', { class: 'n' }, 'HẠ'), h('th', { class: 'n' }, 'XU'), h('th', { class: 'n' }, 'SÚNG'), h('th', { class: 'n' }, 'MÁU')));
    for (const p of this.players) {
      const i = m.info[p.idx];
      tb.append(h('tr', null, h('td', null, `${CLASS_ICON[p.cls]} ${p.name}`), h('td', { class: 'n' }, i ? i.kills : 0), h('td', { class: 'n' }, i ? fmt(i.cash) : 0), h('td', { class: 'n' }, i ? weaponOf(p.cls, i.tier).short : ''), h('td', { class: 'n' }, i ? `${i.hp}/${i.maxHp}` : '')));
    }
    this.scores.append(h('h3', { style: 'margin:0 0 8px' }, `BẢNG ĐIỂM · ĐỢT ${m.wave}`), tb);
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
    this.players.forEach((p, i) => {
      const row = this.teamRows[i];
      const inf = m.info[p.idx];
      if (!row || !inf) return;
      const down = inf.flags & PF_DOWN_MASK;
      row.bar.style.transform = `scaleX(${Math.max(0, inf.hp / Math.max(1, inf.maxHp))})`;
      row.sh.style.transform = `scaleX(${Math.min(1, inf.shield / Math.max(1, inf.maxHp))})`;
      row.cash.textContent = `${fmt(inf.cash)} xu`;
      row.el.className = `tm${down === 1 ? ' down' : down === 2 ? ' dead' : ''}`;
      row.tag.textContent = down === 1 ? `GỤC · ${inf.bleed}s` : down === 2 ? 'TỬ TRẬN · hồi sinh đợt sau' : !(inf.flags & PF_ON) ? 'mất kết nối' : '';
    });
    // ---- đợt ----
    const secs = Math.max(0, Math.ceil((this.waveEnds - Date.now()) / 1000));
    if (m.phase === PH_BREAK || this.wavePhase === 'break') {
      const ready = this.ready.length;
      this.waveS.textContent = `Đợt ${m.wave + 1} sau ${secs}s · ${keyLabel(settings.keys.shop)}: cửa hàng · sẵn sàng ${ready}/${this.players.length}`;
      this.waveP.style.transform = `scaleX(${Math.min(1, secs / 14)})`;
    } else if (m.phase === PH_FIGHT) {
      this.waveS.textContent = `Còn ${m.left} khỉ`;
      this.waveP.style.transform = `scaleX(${this.waveTotal ? Math.min(1, m.left / this.waveTotal) : 0})`;
    }
    this.bossEl.classList.toggle('hidden', m.bossHp === 0);
    if (m.bossHp) this.bossBar.style.transform = `scaleX(${m.bossHp / 65535})`;

    if (me) {
      const cls = CLASSES[me.cls];
      // ---- máu ----
      const f = Math.max(0, me.hp / Math.max(1, me.maxHp));
      if (me.hp !== this.lastHp) {
        this.hpV.textContent = String(me.hp);
        this.hpG.style.transform = `scaleX(${f})`;
        this.hpLag.style.transform = `scaleX(${f})`;
        this.lastHp = me.hp;
      }
      this.hpS.style.transform = `scaleX(${Math.min(1, me.shield / Math.max(1, me.maxHp))})`;
      this.vign.style.opacity = me.hp > 0 && f < 0.35 ? String(0.35 + (0.35 - f) * 1.6) : '0';
      if (me.cash !== this.lastCash) {
        if (this.lastCash >= 0 && me.cash > this.lastCash) {
          const pop = h('span', { class: 'pop' }, `+${fmt(me.cash - this.lastCash)}`);
          this.cashEl.append(pop);
          setTimeout(() => pop.remove(), 900);
        }
        this.cashN.textContent = fmt(me.cash);
        this.lastCash = me.cash;
      }
      clear(this.tiersEl);
      const pips = (n: number, max: number) => h('span', { class: 'pips' }, ...Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
      this.tiersEl.append(h('span', null, 'Súng ', pips(me.tier + 1, MAX_TIER + 1)), h('span', null, 'Máu ', pips(me.hpTier, MAX_HP_TIER)));
      // ---- súng ----
      const w = weaponOf(me.cls, me.tier);
      const ammo = m.pred.ammo;
      this.gunNm.textContent = w.name.toUpperCase();
      const pk = `${w.name}|${w.color}`;
      if (pk !== this.gunPicKey) {
        this.gunPicKey = pk;
        this.gunPic.innerHTML = gunSvg(w); // SVG tự vẽ trong icons.ts, không có dữ liệu người dùng
      }
      this.gunAm.className = `am${ammo <= Math.ceil(w.mag * 0.25) ? ' low' : ''}`;
      this.gunAm.textContent = '';
      this.gunAm.append(String(ammo), h('small', null, ` / ${w.mag}`));
      const rl = m.pred.reloadT;
      this.gunRlWrap.style.visibility = rl > 0 ? 'visible' : 'hidden';
      if (rl > 0) this.gunRl.style.transform = `scaleX(${1 - rl / reloadTicks(me.cls, me.tier)})`;
      clear(this.gunUp);
      if (me.tier < MAX_TIER) {
        const nw = weaponOf(me.cls, me.tier + 1);
        const c = nw.cost;
        this.gunUp.className = `up${me.cash >= c ? ' can' : ''}`;
        this.gunUp.append(`[${keyLabel(settings.keys.buyWeapon)}] ${nw.short}: `, h('b', null, `${fmt(c)} xu`));
      }
      if (me.hpTier < MAX_HP_TIER) {
        const c = HP_TIER_COST[me.hpTier + 1];
        this.gunUp.append(h('br'), `[${keyLabel(settings.keys.buyHp)}] +25 máu: `, h('b', { style: me.cash >= c ? 'color:var(--leaf)' : '' }, `${fmt(c)} xu`));
      }
      // ---- kỹ năng ----
      const cds = [me.cdG / 10, me.cdX / 10];
      const maxs = [cls.g.cd, cls.x.cd];
      const costs = [cls.g.cost, cls.x.cost];
      for (let i = 0; i < 2; i++) {
        const s = this.sk[i];
        s.cd.style.transform = `scaleY(${Math.min(1, cds[i] / maxs[i])})`;
        s.num.textContent = cds[i] > 0 ? cds[i].toFixed(cds[i] < 3 ? 1 : 0) : '';
        s.cost.textContent = String(costs[i]);
        s.el.classList.toggle('poor', me.cash < costs[i]);
      }
      const u = this.sk[2];
      u.cd.style.transform = `scaleY(${1 - me.ult / 255})`;
      u.el.classList.toggle('ready', me.ult >= 255);
      u.num.textContent = me.ult >= 255 ? '' : `${Math.floor((me.ult / 255) * 100)}%`;
      u.cost.textContent = '';
      // ---- tâm ngắm (độ tản thật theo sim) ----
      const sp = lastCmd ? spreadOf(m.pred, lastCmd) : w.spread;
      const px = Math.max(4, (Math.tan(sp) / Math.tan(((cam.fov / 2) * Math.PI) / 180)) * (H / 2));
      this.crossParts[0].style.transform = `translate(${-px - 9}px,0)`;
      this.crossParts[1].style.transform = `translate(${px}px,0)`;
      this.crossParts[2].style.transform = `translate(0,${-px - 9}px)`;
      this.crossParts[3].style.transform = `translate(0,${px}px)`;
      this.cross.style.setProperty('--cross', settings.crossColor);
      this.cross.style.opacity = (me.flags & PF_DOWN_MASK) ? '0' : '1';
      // ---- gục ----
      const down = me.flags & PF_DOWN_MASK;
      this.downed.classList.toggle('hidden', down === 0);
      if (down === 1) {
        this.downSub.textContent = me.revive > 0 ? `Đồng đội đang đỡ bạn dậy… ${Math.round((me.revive / 255) * 100)}%` : `Bò về phía đồng đội! Còn ${me.bleed} giây trước khi tử trận`;
      } else if (down === 2) {
        this.downSub.textContent = 'Bạn sẽ hồi sinh khi cả đội vượt qua đợt này';
        (this.downed.querySelector('.big') as HTMLElement).textContent = 'TỬ TRẬN';
      }
      if (down === 1) (this.downed.querySelector('.big') as HTMLElement).textContent = 'BẠN ĐÃ GỤC!';
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
      const s = 1 + Math.max(0, this.hitT) * 1.2;
      this.hitm.style.transform = `scale(${s})`;
    } else this.hitm.style.opacity = '0';
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashEl.style.opacity = String(Math.max(0, this.flashT * 3));
    } else this.flashEl.style.opacity = '0';
    // hướng bị đánh: góc tương đối với hướng camera
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
          // mũi tên chỉ đồng đội gục ở mép màn hình
          let x = v3.x, y = v3.y;
          if (v3.z > 1) { x = -x; y = -y; }
          const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 0.001);
          x *= k; y *= k;
          off.classList.remove('hidden');
          off.style.transform = `translate(${(x * 0.5 + 0.5) * W}px, ${(-y * 0.5 + 0.5) * H}px)`;
        } else off.classList.add('hidden');
      }
    }
    // ---- radar (10 lần/giây) ----
    if (now - this.radarAt > 100) {
      this.radarAt = now;
      this.drawRadar(m, camYaw);
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
    const S = 300, R = S / 2;
    const range = 30;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.clip();
    g.translate(R, R);
    g.rotate(camYaw);
    const k = (R - 8) / range;
    const toR = (x: number, z: number): [number, number] => [-(x - m.rx) * k, -(z - m.rz) * k];
    // mép sân
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 3;
    const [ax, az] = toR(-ARENA, -ARENA);
    g.strokeRect(ax, az, -ARENA * 2 * k, -ARENA * 2 * k);
    // vòng khoảng cách
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.beginPath();
    g.arc(0, 0, 10 * k, 0, Math.PI * 2);
    g.stroke();
    for (let sl = 0; sl < MAX_MONKEYS; sl++) {
      if (!m.rmVisible[sl]) continue;
      const [x, y] = toR(m.rmX[sl], m.rmZ[sl]);
      const t = m.mType[sl];
      const big = t === MK_VUA ? 9 : t === MK_DOT ? 6 : 3.5;
      g.fillStyle = t === MK_VUA ? '#ff3b3b' : t === 3 ? '#ff7a59' : '#ffb347';
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
      g.fillStyle = down ? (Math.floor(performance.now() / 250) % 2 ? '#ff4d4d' : '#fff') : clsColor(p.cls);
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
    }
    g.restore();
    // mình ở giữa: mũi tên chỉ lên (hướng nhìn)
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.moveTo(R, R - 12);
    g.lineTo(R - 8, R + 8);
    g.lineTo(R + 8, R + 8);
    g.closePath();
    g.fill();
    void MONKEYS;
  }

  destroy() {
    this.root.remove();
  }
}
