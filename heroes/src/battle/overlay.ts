// HUD HTML đè lên cảnh 3D: thanh máu/năng lượng/hành động trên đầu, chip buff, số sát thương nổi, banner cắt cảnh tuyệt kỹ,
// nhật ký trận, nháy màn hình. Làm bằng DOM thuần (cập nhật mỗi khung hình theo camera) để Preact không phải render lại 60 lần/giây.
// Không dùng blur/backdrop-filter; hiệu ứng chỉ là transform/opacity.
import { ENERGY_MAX, type Battle } from '@shared/heroes/battle';
import { BATTLE_HZ, BATTLE_MAX_TICKS } from '@shared/heroes/config';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import type { Rarity } from '@shared/heroes/types';
import { gsap } from 'gsap';
import { sfx, type Sfx } from '../audio';
import { portraitOf } from '../render/portraits';
import { compactNum, type BattleScene, type CineInfo, type SceneHooks } from '../render/battle-scene';
import { store } from '../settings';
import './battle.css';

/** số nổi đang hiển thị (để giới hạn ≤3 trên mỗi mục tiêu, số cũ mờ nhanh) */
interface Num {
  e: HTMLElement;
  tl: gsap.core.Timeline;
  act: Num[] | null;
}

interface Bar {
  el: HTMLElement;
  hp: HTMLElement;
  ghost: HTMLElement;
  chips: HTMLElement;
  chipSig: string;
  full: boolean;
  hidden: boolean;
  /** số nổi còn hiển thị trên đơn vị này */
  act: Num[];
}

/** hàng bảng sát thương của một tướng */
interface Row {
  el: HTMLElement;
  d: HTMLElement;
  r: HTMLElement;
  side: 0 | 1;
  dealt: number;
  recv: number;
}

/** thông tin hai chỉ huy cho thanh trên cùng */
export interface BattleInfo {
  meName: string;
  mePower: number;
  meKey: string;
  meRarity: Rarity;
  foeName: string;
  foePower: number;
  foeKey: string;
  foeRarity: Rarity;
}

const ARROW_UP = '<svg viewBox="0 0 12 14" width="13" height="15"><path d="M6 1 L11 7 H8 V13 H4 V7 H1 Z" fill="#ff5a1a" stroke="#1e2a4a" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 12 14" width="13" height="15"><path d="M6 13 L11 7 H8 V1 H4 V7 H1 Z" fill="#8fa3d0" stroke="#1e2a4a" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const CROWN = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M3 19 L2 7 L8 12.5 L12 4 L16 12.5 L22 7 L21 19 Z" fill="#ffd23f" stroke="#5a3a00" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const PEOPLE = '<svg viewBox="0 0 24 24" width="13" height="13"><circle cx="8" cy="8" r="3.4" fill="#e8f4ff"/><circle cx="17" cy="9" r="2.8" fill="#bcd8f5"/><path d="M1.5 20 C1.5 14 5 12.5 8 12.5 C11 12.5 14.5 14 14.5 20 Z" fill="#e8f4ff"/><path d="M14 20 C14 15.5 16 14 18 14 C20.5 14 22.5 15.5 22.5 20 Z" fill="#bcd8f5"/></svg>';
const SWORDS = '<svg viewBox="0 0 32 32" width="26" height="26"><g stroke="#1a2140" stroke-width="3.4" stroke-linecap="round"><path d="M6 6 L24 24"/><path d="M26 6 L8 24"/></g><g stroke="#f4f7ff" stroke-width="1.8" stroke-linecap="round"><path d="M6 6 L24 24"/><path d="M26 6 L8 24"/></g><g stroke="#ffd23f" stroke-width="3" stroke-linecap="round"><path d="M20 22 L27 26"/><path d="M12 22 L5 26"/></g><circle cx="25.6" cy="25.6" r="1.7" fill="#ffd23f"/><circle cx="6.4" cy="25.6" r="1.7" fill="#ffd23f"/></svg>';

const LOG_KEY = 'heroes-bt-log';
const LOG_LINES = 5;
const TICKS_PER_SEC = 20;

/** chip trạng thái: [mũi tên, nhãn ngắn, lớp màu] */
const CHIP: Record<string, [string, string, string]> = {
  atkUp: ['▲', 'CÔNG', 'atk'],
  defUp: ['▲', 'THỦ', 'def'],
  defDown: ['▼', 'THỦ', 'dd'],
  spdUp: ['▲', 'TỐC', 'spd'],
  stun: ['✦', 'CHOÁNG', 'stun'],
  shield: ['◆', 'KHIÊN', 'shd'],
};

const el = (cls: string, tag = 'div'): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
};

export class BattleOverlay implements SceneHooks {
  scene: BattleScene | null = null;
  battle: Battle | null = null;
  onWave: (n: number) => void = () => {};
  private bars = new Map<number, Bar>();
  private flashEl: HTMLElement;
  private layer: HTMLElement;
  private frameN = 0;
  private dns: Num[] = [];
  private cine: HTMLElement | null = null;
  private cineTl: gsap.core.Timeline | null = null;
  private endEl: HTMLElement | null = null;
  private endTl: gsap.core.Timeline | null = null;
  private waveEl: HTMLElement | null = null;
  private flashTw: gsap.core.Tween | null = null;
  /** các timeline "theo nhịp trận" (tốc độ chạy = timeScale cảnh; 0 khi tạm dừng) — dọn khi xong / khi rời trận */
  private paced = new Set<gsap.core.Timeline>();
  private pacedK = 1;
  private logBtn: HTMLButtonElement;
  private logBox: HTMLElement;
  private logOn: boolean;
  /* ---- HUD trên: hai chỉ huy, đồng hồ, bảng sát thương, thanh boss, dòng chạy kỹ năng ---- */
  private hud: HTMLElement;
  private nameEl: [HTMLElement, HTMLElement];
  private powEl: [HTMLElement, HTMLElement];
  private tbFill: [HTMLElement, HTMLElement];
  private tbNum: [HTMLElement, HTMLElement];
  private tbV: [number, number] = [-1, -1];
  private timerEl: HTMLElement;
  private secV = -1;
  private meterEl: [HTMLElement, HTMLElement];
  private rows = new Map<number, Row>();
  private meterDirty = false;
  private bossEl: HTMLElement;
  private bossFill: HTMLElement;
  private bossGhost: HTMLElement;
  private bossNum: HTMLElement;
  private bossUid = -1;
  private tickerEl: HTMLElement;
  private tickerTw: gsap.core.Tween | null = null;
  private skEl: [HTMLElement, HTMLElement];
  private skTl: [gsap.core.Timeline | null, gsap.core.Timeline | null] = [null, null];
  private unsubs: (() => void)[] = [];

  constructor(private root: HTMLElement) {
    this.hud = el('bh');
    const side = (cls: string) =>
      `<div class="bh-side ${cls}"><div class="bh-ava"><img alt="" draggable="false"></div><div class="bh-inf"><b class="bh-name"></b>` +
      `<span class="bh-pw">${CROWN}<em></em></span><div class="bh-tb"><i class="bh-ppl">${PEOPLE}</i><span class="bh-tbar"><i></i></span><em>0</em></div></div></div>`;
    this.hud.innerHTML =
      `<div class="bh-top">${side('me')}<div class="bh-vs">${SWORDS}</div>${side('foe')}</div>` +
      '<div class="bh-timer">2:00</div><div class="bh-meter l"></div><div class="bh-meter r"></div>' +
      '<div class="bh-boss"><b></b><span class="bh-bbar"><i class="ghost"></i><i class="fill"></i></span><em></em></div>' +
      '<div class="bh-ticker"><span></span></div><div class="bh-sk s0"></div><div class="bh-sk s1"></div>';
    const q = <T extends HTMLElement>(sel: string, i = 0) => this.hud.querySelectorAll<T>(sel)[i];
    this.nameEl = [q('.bh-name', 0), q('.bh-name', 1)];
    this.powEl = [q('.bh-pw em', 0), q('.bh-pw em', 1)];
    this.tbFill = [q('.bh-tbar i', 0), q('.bh-tbar i', 1)];
    this.tbNum = [q('.bh-tb em', 0), q('.bh-tb em', 1)];
    this.timerEl = q('.bh-timer');
    this.meterEl = [q('.bh-meter', 0), q('.bh-meter', 1)];
    this.bossEl = q('.bh-boss');
    this.bossFill = q('.bh-bbar .fill');
    this.bossGhost = q('.bh-bbar .ghost');
    this.bossNum = q('.bh-boss em');
    this.tickerEl = q('.bh-ticker');
    this.skEl = [q('.bh-sk', 0), q('.bh-sk', 1)];
    this.layer = el('hud-layer');
    this.flashEl = el('hud-flash');
    this.flashEl.style.animation = 'none';
    root.append(this.hud, this.layer, this.flashEl);
    // nhật ký trận: MẶC ĐỊNH TẮT trên mọi thiết bị (che màn hình); người chơi bật bằng nút ☰ và lựa chọn được nhớ lại
    this.logOn = store(LOG_KEY) === '1';
    this.logBox = el('bt-log');
    for (let i = 0; i < LOG_LINES; i++) this.logBox.append(el('bt-ll'));
    this.logBtn = el('bt-logbtn', 'button') as HTMLButtonElement;
    this.logBtn.type = 'button';
    this.logBtn.textContent = '☰';
    this.logBtn.setAttribute('aria-label', 'Nhật ký trận');
    this.logBtn.addEventListener('click', () => {
      this.logOn = !this.logOn;
      store(LOG_KEY, this.logOn ? '1' : '0');
      this.applyLog();
    });
    root.append(this.logBox, this.logBtn);
    this.applyLog();
  }

  private applyLog() {
    this.logBox.classList.toggle('on', this.logOn);
    this.logBtn.classList.toggle('on', this.logOn);
  }

  /** điền thông tin hai chỉ huy (tên, lực chiến, avatar) — gọi trước khi trận bắt đầu */
  setInfo(i: BattleInfo) {
    this.nameEl[0].textContent = i.meName;
    this.nameEl[1].textContent = i.foeName;
    this.powEl[0].textContent = compactNum(i.mePower);
    this.powEl[1].textContent = compactNum(i.foePower);
    const imgs = this.hud.querySelectorAll<HTMLImageElement>('.bh-ava img');
    this.bindPortrait(imgs[0], i.meKey, i.meRarity);
    this.bindPortrait(imgs[1], i.foeKey, i.foeRarity);
  }

  /** gán ảnh chân dung (cache chung, vẽ xong mới có ảnh) */
  private bindPortrait(img: HTMLImageElement | undefined, key: string, rarity: Rarity) {
    if (!img) return;
    const sig = portraitOf(key, rarity);
    this.unsubs.push(
      sig.subscribe((v) => {
        if (v && v !== 'none') img.src = v;
      }),
    );
  }

  /** tạo thanh cho đơn vị + hàng bảng sát thương (gọi khi thêm vào cảnh) */
  addBar(uid: number, side: 0 | 1, boss: boolean) {
    if (this.bars.has(uid)) return;
    const u = this.battle?.unit(uid);
    const e = el(`ubar s${side}${boss ? ' boss' : ''}`);
    e.innerHTML = '<div class="bt-chips"></div><div class="ub-hp"><i class="ghost"></i><i class="fill"></i></div>';
    const hp = e.querySelector('.fill') as HTMLElement;
    const ghost = e.querySelector('.ghost') as HTMLElement;
    const chips = e.querySelector('.bt-chips') as HTMLElement;
    this.layer.append(e);
    this.bars.set(uid, { el: e, hp, ghost, chips, chipSig: '', full: false, hidden: false, act: [] });
    if (boss) {
      // boss: thanh máu LỚN ở đầu đấu trường, thay cho thanh nhỏ trên đầu
      e.classList.add('nobar');
      this.bossUid = uid;
      (this.bossEl.firstElementChild as HTMLElement).textContent = u?.init.name ?? 'Boss';
      this.bossEl.classList.add('on');
      this.bossNum.textContent = u ? `${compactNum(u.hp)} / ${compactNum(u.maxHp)}` : '';
    }
    if (u) this.addRow(uid, side, u.init.key, boss);
  }

  /** hàng bảng sát thương: chân dung tròn, tổng sát thương gây ra, "(−nhận)" đỏ; tối đa 6 hàng mỗi bên */
  private addRow(uid: number, side: 0 | 1, key: string, boss: boolean) {
    if (this.rows.has(uid)) return;
    let n = 0;
    for (const r of this.rows.values()) if (r.side === side) n++;
    if (n >= 6) {
      // hết chỗ (đợt mới): bỏ hàng của tướng đã gục
      for (const [id, r] of this.rows) {
        if (r.side === side && !(this.battle?.unit(id)?.alive ?? true)) {
          r.el.remove();
          this.rows.delete(id);
          n--;
          break;
        }
      }
      if (n >= 6) return;
    }
    const e = el(`bh-row s${side}`);
    const img = el('bh-p', 'img') as HTMLImageElement;
    img.alt = '';
    img.draggable = false;
    const d = el('bh-d', 'b');
    d.textContent = '0';
    const r = el('bh-r', 'em');
    e.append(img, d, r);
    this.meterEl[side].append(e);
    this.bindPortrait(img, key, boss ? 'SSR' : HERO_BY_ID[key]?.rarity ?? 'R');
    this.rows.set(uid, { el: e, d, r, side, dealt: 0, recv: 0 });
  }

  /** bảng sát thương: cộng dồn ở đây, DOM cập nhật gộp mỗi vài khung */
  meter(src: number, dst: number, n: number) {
    const a = this.rows.get(src);
    if (a) a.dealt += n;
    const b = this.rows.get(dst);
    if (b) b.recv += n;
    this.meterDirty = true;
  }

  /** dòng chạy tên kỹ năng phía trên thẻ tướng */
  ticker(who: string, skill: string, side: 0 | 1, ult: boolean, color: string) {
    const t = this.tickerEl;
    const sp = t.firstElementChild as HTMLElement;
    sp.textContent = `${who}  ·  ${skill}${ult ? '!' : ''}`;
    t.style.setProperty('--c', color);
    t.classList.toggle('ult', ult);
    t.classList.toggle('foe', side === 1);
    this.tickerTw?.kill();
    this.tickerTw = gsap.fromTo(t, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.14, ease: 'power2.out' });
    gsap.to(t, { opacity: 0.55, duration: 0.5, delay: 2.2, overwrite: 'auto' });
  }

  /** tốc độ chạy cho hoạt ảnh UI: bám timeScale của cảnh nhưng kẹp [0.55, 1.1] để chữ không vụt mất khi x3; 0 khi tạm dừng */
  private paceK(): number {
    const t = this.scene?.timeScale ?? 1;
    return t <= 0 ? 0 : Math.min(1.1, Math.max(0.55, t));
  }

  /** đăng ký timeline theo nhịp trận; tự gỡ khi xong */
  private pace<T extends gsap.core.Timeline>(tl: T, onDone?: () => void): T {
    tl.timeScale(this.pacedK);
    this.paced.add(tl);
    tl.eventCallback('onComplete', () => {
      this.paced.delete(tl);
      onDone?.();
    });
    return tl;
  }

  /** bỏ một số nổi (nhanh = mờ đi trong 0,1 s) */
  private dropNum(n: Num, fast: boolean) {
    n.tl.kill();
    this.paced.delete(n.tl);
    const i = this.dns.indexOf(n);
    if (i >= 0) this.dns.splice(i, 1);
    if (n.act) {
      const j = n.act.indexOf(n);
      if (j >= 0) n.act.splice(j, 1);
    }
    if (fast) gsap.to(n.e, { opacity: 0, duration: 0.1, onComplete: () => n.e.remove(), overwrite: true });
    else n.e.remove();
  }

  number(uid: number, text: string, kind: 'dmg' | 'crit' | 'heal' | 'text', opt?: { adv?: number; color?: string }) {
    const p = this.scene?.project(uid, 0.1);
    if (!p) return;
    while (this.dns.length > 24) this.dropNum(this.dns[0], false);
    // tối đa 3 số hiện cùng lúc trên một mục tiêu: số cũ nhất mờ nhanh
    const b = this.bars.get(uid);
    const act = b ? b.act : null;
    while (act && act.length >= 3) this.dropNum(act[0], true);
    const vis = act ? act.length : 0;
    const e = el(`dn dn-${kind}${opt?.adv ? (opt.adv > 0 ? ' adv-up' : ' adv-dn') : ''}`);
    e.style.animation = 'none';
    e.style.left = `${p.x + (Math.random() - 0.5) * 22}px`;
    e.style.top = `${p.y - vis * 20}px`;
    if (opt?.color) e.style.color = opt.color;
    let sb: HTMLElement | null = null;
    if (kind === 'crit') {
      sb = el('bt-sb', 'i');
      sb.style.animation = 'none';
      e.append(sb);
    }
    const t = el('bt-t', 'span');
    t.textContent = text;
    e.append(t);
    if (opt?.adv) {
      // đông số trên mục tiêu thì chỉ còn mũi tên nhỏ, không nhãn KHẮC/KHÁNG
      e.insertAdjacentHTML('beforeend', opt.adv > 0 ? ARROW_UP : ARROW_DOWN);
      if (vis < 2) {
        const tag = el('bt-adv', 'small');
        tag.textContent = opt.adv > 0 ? 'KHẮC' : 'KHÁNG';
        e.append(tag);
      }
    }
    this.layer.append(e);
    // GSAP: nảy ra (overshoot) -> bay lên -> mờ dần, ngắn gọn để không chất đống
    const tl = gsap.timeline();
    const rise = kind === 'crit' ? 90 : kind === 'text' ? 44 : 56;
    gsap.set(e, { xPercent: -50, yPercent: -20, scale: 0.3, opacity: 0 });
    if (kind === 'crit') {
      tl.to(e, { yPercent: -80, scale: 1.35, opacity: 1, duration: 0.12, ease: 'back.out(3)' }, 0)
        .to(e, { scale: 1.1, duration: 0.14, ease: 'power2.out' }, 0.12)
        .to(e, { y: -rise, scale: 1, duration: 0.5, ease: 'power1.out' }, 0.12)
        .to(e, { opacity: 0, duration: 0.2, ease: 'power1.in' }, 0.5);
      if (sb) {
        gsap.set(sb, { xPercent: -50, yPercent: -50, scale: 0.2, rotation: 0 });
        tl.to(sb, { scale: 0.9, rotation: 30, duration: 0.2, ease: 'power2.out' }, 0)
          .to(sb, { scale: 0.7, rotation: 60, opacity: 0, duration: 0.45, ease: 'power1.in' }, 0.2);
      }
    } else {
      const big = kind === 'text' ? 1 : opt?.adv && opt.adv > 0 ? 1.2 : 1.1;
      tl.to(e, { yPercent: -60, scale: big, opacity: 1, duration: 0.12, ease: 'back.out(2.4)' }, 0)
        .to(e, { scale: 1, duration: 0.12, ease: 'power2.out' }, 0.12)
        .to(e, { y: -rise, duration: kind === 'text' ? 0.8 : 0.55, ease: 'power1.out' }, 0.08)
        .to(e, { opacity: 0, duration: 0.2, ease: 'power1.in' }, kind === 'text' ? 0.65 : 0.45);
    }
    const rec: Num = { e, tl, act };
    this.pace(tl, () => {
      e.remove();
      const i = this.dns.indexOf(rec);
      if (i >= 0) this.dns.splice(i, 1);
      if (act) {
        const j = act.indexOf(rec);
        if (j >= 0) act.splice(j, 1);
      }
    });
    this.dns.push(rec);
    if (act) act.push(rec);
  }

  /** biển tên kỹ năng: MỖI PHE chỉ một biển nhỏ ở đầu đội hình, cái mới thay cái cũ */
  skill(uid: number, name: string, color: string, ult: boolean) {
    const side = this.battle?.unit(uid)?.init.side ?? 0;
    const sc = this.scene;
    const e = this.skEl[side];
    if (!sc) return;
    const p = sc.sideAnchor(side);
    e.textContent = name + (ult ? '!' : '');
    e.style.left = `${Math.max(48, Math.min((this.layer.clientWidth || window.innerWidth) - 48, p.x))}px`;
    e.style.top = `${p.y}px`;
    e.style.setProperty('--c', color);
    const old = this.skTl[side];
    if (old) {
      old.kill();
      this.paced.delete(old);
    }
    gsap.set(e, { xPercent: -50, yPercent: -100, scale: 0.6, y: 6, opacity: 0 });
    const tl = gsap.timeline();
    tl.to(e, { scale: 1, y: 0, opacity: 1, duration: 0.14, ease: 'back.out(2.2)' }).to(e, { opacity: 0, y: -8, duration: 0.25, ease: 'power1.in' }, 0.95);
    this.skTl[side] = tl;
    this.pace(tl, () => {
      if (this.skTl[side] === tl) this.skTl[side] = null;
    });
  }

  /** cut-in tuyệt kỹ NHẸ, không chặn trận: dải nhỏ có chân dung + tên chiêu trượt vào từ phía người dùng, ≤ ~0,6 s (giây THẬT) */
  cinematic(c: CineInfo) {
    this.clearCine();
    const wrap = el(`bt-cine s${c.side}${c.boss ? ' boss' : ''}${c.low ? ' low' : ''}`);
    wrap.style.setProperty('--c', c.color);
    const cut = el('bt-cut');
    const band = el('bt-band');
    cut.append(band);
    let port: HTMLElement | null = null;
    if (!c.boss) {
      const url = portraitOf(c.key, HERO_BY_ID[c.key]?.rarity ?? 'R').value;
      if (url && url !== 'none') {
        const img = el('bt-port', 'img') as HTMLImageElement;
        img.src = url;
        img.alt = '';
        cut.append(img);
        port = img;
      }
    }
    const name = el('bt-name');
    const small = el('bt-who', 'small');
    small.textContent = c.boss ? 'CHIÊU CUỐI' : `${this.battle?.unit(c.uid)?.init.name ?? ''}`;
    const big = el('bt-nm', 'b');
    big.textContent = c.name;
    name.append(small, big);
    cut.append(name);
    wrap.append(cut);
    this.root.append(wrap);
    this.cine = wrap;
    const T = Math.max(0.3, c.dur);
    const dir = c.side === 0 ? -1 : 1; // phe ta trượt vào từ trái, địch từ phải
    gsap.set(cut, { xPercent: dir * 110, opacity: 0 });
    if (port) gsap.set(port, { scale: 0.6 });
    const tl = gsap.timeline({ onComplete: () => this.clearCine() });
    tl.to(cut, { xPercent: 0, opacity: 1, duration: T * 0.22, ease: 'expo.out' }, 0);
    if (port) tl.to(port, { scale: 1.12, duration: T * 0.3, ease: 'back.out(2)' }, 0);
    tl.to(cut, { xPercent: -dir * 4, duration: T * 0.5, ease: 'none' }, T * 0.22)
      .to(cut, { xPercent: dir * 110, opacity: 0, duration: T * 0.28, ease: 'power2.in' }, T * 0.72);
    this.cineTl = tl;
  }

  clearCine() {
    this.cineTl?.kill();
    this.cineTl = null;
    this.cine?.remove();
    this.cine = null;
  }

  /** banner kết thúc trận (giữ tới khi rời màn) */
  banner(win: boolean) {
    this.endTl?.kill();
    this.endEl?.remove();
    const e = el(`bt-end ${win ? 'win' : 'lose'}`);
    e.style.animation = 'none';
    e.textContent = win ? 'CHIẾN THẮNG!' : 'THẤT BẠI';
    this.root.append(e);
    this.endEl = e;
    gsap.set(e, { scale: 2.6, rotation: -8, opacity: 0 });
    const tl = gsap.timeline();
    tl.to(e, { scale: 1, rotation: -2, opacity: 1, duration: 0.6, ease: 'back.out(1.7)' });
    // thắng: lắc lư nhẹ vô hạn (bị kill khi rời màn)
    if (win) tl.to(e, { rotation: 1.5, scale: 1.04, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    this.endTl = tl;
  }

  /** banner ĐỢT n / BOSS: dải tối trượt ngang + chữ nảy; bám nhịp trận */
  waveBanner(text: string) {
    this.waveEl?.remove();
    const e = el('wave-banner bt-wave', 'div');
    e.style.animation = 'none';
    e.textContent = text;
    this.root.append(e);
    this.waveEl = e;
    gsap.set(e, { xPercent: -110, skewX: -12, opacity: 0 });
    const tl = gsap.timeline();
    tl.to(e, { xPercent: 0, skewX: -4, opacity: 1, duration: 0.3, ease: 'expo.out' })
      .fromTo(e, { scale: 1.35 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' }, 0)
      .to(e, { xPercent: 2, skewX: 0, duration: 0.9, ease: 'none' })
      .to(e, { xPercent: 110, skewX: -12, opacity: 0, duration: 0.25, ease: 'power3.in' });
    this.pace(tl, () => {
      e.remove();
      if (this.waveEl === e) this.waveEl = null;
    });
  }

  log(text: string, side: 0 | 1) {
    // tái dùng 5 dòng có sẵn: đẩy dòng cũ nhất xuống cuối
    const first = this.logBox.firstElementChild as HTMLElement | null;
    if (!first) return;
    first.textContent = text;
    first.className = `bt-ll s${side}`;
    this.logBox.append(first);
  }

  hp(uid: number, hp: number, max: number) {
    const b = this.bars.get(uid);
    if (!b) return;
    const pct = Math.max(0, Math.min(100, (hp * 100) / Math.max(1, max)));
    b.hp.style.width = `${pct}%`;
    b.el.classList.toggle('low', pct < 30);
    // thanh "mờ" tụt chậm phía sau để thấy lượng máu vừa mất (GSAP delay: huỷ được khi rời trận)
    gsap.to(b.ghost, { width: `${pct}%`, duration: 0.2, delay: 0.25, ease: 'power2.out', overwrite: 'auto' });
    if (uid === this.bossUid) {
      this.bossFill.style.width = `${pct}%`;
      this.bossNum.textContent = `${compactNum(Math.max(0, hp))} / ${compactNum(max)}`;
      gsap.to(this.bossGhost, { width: `${pct}%`, duration: 0.3, delay: 0.3, ease: 'power2.out', overwrite: 'auto' });
    }
  }

  died(uid: number) {
    const b = this.bars.get(uid);
    if (b) {
      b.hidden = true;
      b.el.style.display = 'none';
    }
    const r = this.rows.get(uid);
    if (r) r.el.classList.add('dead');
    if (uid === this.bossUid) this.bossEl.classList.remove('on');
  }

  wave(n: number) {
    sfx('wave');
    this.onWave(n);
  }

  flash(color: string) {
    const f = this.flashEl;
    f.style.background = `radial-gradient(circle at 50% 55%, ${color}aa, ${color}00 70%)`;
    this.flashTw?.kill();
    this.flashTw = gsap.fromTo(f, { opacity: 0.95 }, { opacity: 0, duration: 0.55, ease: 'power2.out' });
  }

  sfx(k: Sfx) {
    sfx(k);
  }

  /** chip buff/debuff + giây còn lại (đọc trạng thái engine) */
  private refreshChips(b: Bar, uid: number) {
    const bt = this.battle;
    const u = bt?.unit(uid);
    if (!bt || !u) return;
    let sig = '';
    let html = '';
    let n = 0;
    for (const e of u.effs) {
      if (e.until <= bt.tick || n >= 4) continue;
      const c = CHIP[e.type];
      if (!c) continue;
      const s = Math.ceil((e.until - bt.tick) / TICKS_PER_SEC);
      sig += `${e.type}${s};`;
      html += `<span class="bt-chip ${c[2]}"><b>${c[0]}</b>${c[1]}<em>${s}</em></span>`;
      n++;
    }
    if (u.shield > 0 && n < 4) {
      const s = Math.max(1, Math.ceil((u.shieldUntil - bt.tick) / TICKS_PER_SEC));
      sig += `shield${s};`;
      html += `<span class="bt-chip shd"><b>◆</b>KHIÊN<em>${s}</em></span>`;
    }
    if (sig === b.chipSig) return;
    b.chipSig = sig;
    b.chips.innerHTML = html;
  }

  /** thanh trên (máu đội, đồng hồ) + bảng sát thương: cập nhật gộp, chỉ ghi DOM khi giá trị đổi */
  private refreshHud() {
    const bt = this.battle;
    if (!bt) return;
    const secs = Math.max(0, Math.ceil((BATTLE_MAX_TICKS - bt.tick) / BATTLE_HZ));
    if (secs !== this.secV) {
      this.secV = secs;
      this.timerEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.timerEl.classList.toggle('warn', secs <= 15);
    }
    for (const s of [0, 1] as const) {
      let hp = 0;
      let max = 0;
      for (const u of bt.units) {
        if (u.init.side !== s) continue;
        max += u.maxHp;
        if (u.alive) hp += u.hp;
      }
      if (hp !== this.tbV[s]) {
        this.tbV[s] = hp;
        this.tbFill[s].style.transform = `scaleX(${max > 0 ? hp / max : 0})`;
        this.tbNum[s].textContent = compactNum(hp);
      }
    }
    if (this.meterDirty) {
      this.meterDirty = false;
      for (const r of this.rows.values()) {
        r.d.textContent = compactNum(r.dealt);
        r.r.textContent = r.recv > 0 ? `(-${compactNum(r.recv)})` : '';
      }
    }
  }

  /** gọi sau mỗi khung vẽ: đặt thanh theo vị trí chiếu của camera */
  frame() {
    const sc = this.scene;
    if (!sc) return;
    // đồng bộ tốc độ các timeline UI với timeScale/tạm dừng của cảnh (không cấp phát)
    if (this.paced.size) {
      const k = this.paceK();
      if (k !== this.pacedK) {
        this.pacedK = k;
        for (const tl of this.paced) tl.timeScale(k);
      }
    }
    this.frameN++;
    const slow = this.frameN % 6 === 0;
    if (slow) this.refreshHud();
    for (const [uid, b] of this.bars) {
      if (b.hidden) continue;
      const u = this.battle?.unit(uid);
      // vừa đầy năng lượng: lấp lánh + tiếng (thẻ tướng phía dưới tự hiện "ĐẦY")
      if (u && u.init.side === 0) {
        const full = u.energy >= ENERGY_MAX;
        if (full && !b.full) {
          sfx('ultReady');
          sc.ping(uid);
        }
        b.full = full;
      }
      const p = b.el.classList.contains('nobar') ? null : sc.project(uid, 0.12);
      if (!p) {
        b.el.style.visibility = 'hidden';
        continue;
      }
      b.el.style.visibility = 'visible';
      b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      if (slow) this.refreshChips(b, uid);
    }
  }

  dispose() {
    this.cineTl?.kill();
    this.endTl?.kill();
    this.flashTw?.kill();
    for (const tl of this.paced) tl.kill();
    this.paced.clear();
    for (const b of this.bars.values()) gsap.killTweensOf(b.ghost);
    this.layer.querySelectorAll('.sk-pop').forEach((n) => gsap.killTweensOf(n));
    this.tickerTw?.kill();
    gsap.killTweensOf([this.tickerEl, this.bossGhost]);
    for (const tl of this.skTl) tl?.kill();
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.rows.clear();
    this.hud.remove();
    this.layer.remove();
    this.flashEl.remove();
    this.cine?.remove();
    this.endEl?.remove();
    this.waveEl?.remove();
    this.logBox.remove();
    this.logBtn.remove();
    this.bars.clear();
    this.dns.length = 0;
  }
}
