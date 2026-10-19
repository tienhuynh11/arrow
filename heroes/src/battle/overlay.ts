// HUD HTML đè lên cảnh 3D: thanh máu/năng lượng/hành động trên đầu, chip buff, số sát thương nổi, banner cắt cảnh tuyệt kỹ,
// nhật ký trận, nháy màn hình. Làm bằng DOM thuần (cập nhật mỗi khung hình theo camera) để Preact không phải render lại 60 lần/giây.
// Không dùng blur/backdrop-filter; hiệu ứng chỉ là transform/opacity.
import { ENERGY_MAX, GAUGE_MAX, type Battle } from '@shared/heroes/battle';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import { sfx } from '../audio';
import { portraitOf } from '../render/portraits';
import type { BattleScene, CineInfo, SceneHooks } from '../render/battle-scene';
import { store } from '../settings';
import './battle.css';

interface Bar {
  el: HTMLElement;
  hp: HTMLElement;
  ghost: HTMLElement;
  en: HTMLElement | null;
  atb: HTMLElement;
  chips: HTMLElement;
  enV: number;
  atbV: number;
  chipSig: string;
  full: boolean;
  hidden: boolean;
}

const ARROW_UP = '<svg viewBox="0 0 12 14" width="18" height="21"><path d="M6 1 L11 7 H8 V13 H4 V7 H1 Z" fill="#ff5a1a" stroke="#1e2a4a" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 12 14" width="18" height="21"><path d="M6 13 L11 7 H8 V1 H4 V7 H1 Z" fill="#8fa3d0" stroke="#1e2a4a" stroke-width="1.3" stroke-linejoin="round"/></svg>';

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
  private dns: HTMLElement[] = [];
  private cine: HTMLElement | null = null;
  private cineTimer = 0;
  private endEl: HTMLElement | null = null;
  private logBtn: HTMLButtonElement;
  private logBox: HTMLElement;
  private logOn: boolean;

  constructor(private root: HTMLElement) {
    this.layer = el('hud-layer');
    this.flashEl = el('hud-flash');
    root.append(this.layer, this.flashEl);
    // nhật ký trận: mặc định tắt trên điện thoại (không che đơn vị), bật trên máy tính
    const saved = store(LOG_KEY);
    this.logOn = saved ? saved === '1' : !matchMedia('(pointer: coarse)').matches;
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

  /** tạo thanh cho đơn vị (gọi khi thêm vào cảnh) */
  addBar(uid: number, side: 0 | 1, boss: boolean) {
    if (this.bars.has(uid)) return;
    const e = el(`ubar s${side}${boss ? ' boss' : ''}`);
    e.innerHTML =
      '<div class="bt-chips"></div><div class="ub-atb"><i></i></div><div class="ub-hp"><i class="ghost"></i><i class="fill"></i></div>' +
      (side === 0 ? '<div class="ub-en"><i></i></div>' : '');
    const hp = e.querySelector('.fill') as HTMLElement;
    const ghost = e.querySelector('.ghost') as HTMLElement;
    const en = e.querySelector('.ub-en i') as HTMLElement | null;
    const atb = e.querySelector('.ub-atb i') as HTMLElement;
    const chips = e.querySelector('.bt-chips') as HTMLElement;
    this.layer.append(e);
    this.bars.set(uid, { el: e, hp, ghost, en, atb, chips, enV: -1, atbV: -1, chipSig: '', full: false, hidden: false });
  }

  number(uid: number, text: string, kind: 'dmg' | 'crit' | 'heal' | 'text', opt?: { adv?: number; color?: string }) {
    const p = this.scene?.project(uid, 0.1);
    if (!p) return;
    while (this.dns.length > 30) this.dns.shift()?.remove();
    const e = el(`dn dn-${kind}${opt?.adv ? (opt.adv > 0 ? ' adv-up' : ' adv-dn') : ''}`);
    const jx = (Math.random() - 0.5) * 36;
    e.style.left = `${p.x + jx}px`;
    e.style.top = `${p.y}px`;
    const scale = Math.max(0.3, this.scene?.timeScale || 1);
    // chữ nổi tồn tại lâu hơn khi chạy chậm để đọc kịp (tối thiểu ~0.9s thật)
    e.style.animationDuration = `${Math.max(0.9, (kind === 'text' ? 1.1 : 0.95) / scale)}s`;
    if (opt?.color) e.style.color = opt.color;
    if (kind === 'crit') e.append(el('bt-sb', 'i'));
    const t = el('bt-t', 'span');
    t.textContent = text;
    e.append(t);
    if (opt?.adv) {
      e.insertAdjacentHTML('beforeend', opt.adv > 0 ? ARROW_UP : ARROW_DOWN);
      const tag = el('bt-adv', 'small');
      tag.textContent = opt.adv > 0 ? 'KHẮC' : 'KHÁNG';
      e.append(tag);
    }
    this.layer.append(e);
    this.dns.push(e);
    const kill = () => e.remove();
    e.addEventListener('animationend', kill, { once: true });
    setTimeout(kill, 2600);
  }

  /** tên kỹ năng bật lên "bụp" trên đầu người dùng (chữ viền dày, nghiêng, nảy) — chỉ dùng Web Animations nên không cần CSS riêng */
  skill(uid: number, name: string, color: string, ult: boolean) {
    const p = this.scene?.project(uid, ult ? 0.75 : 0.55);
    if (!p) return;
    this.layer.querySelectorAll('.sk-pop').forEach((n, i, all) => {
      if (all.length - i > 3) n.remove();
    });
    const e = el('sk-pop');
    const size = ult ? 38 : 24;
    const ink = '#1a2140';
    e.textContent = name + (ult ? '!' : '');
    Object.assign(e.style, {
      position: 'absolute', left: `${p.x}px`, top: `${p.y}px`, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '5',
      fontFamily: "var(--f-title), 'Baloo 2', system-ui, sans-serif", fontWeight: '900', fontSize: `${size}px`, color: ult ? '#fff7c2' : '#fff',
      letterSpacing: '1px', willChange: 'transform, opacity',
      textShadow: `-3px 0 ${ink}, 3px 0 ${ink}, 0 -3px ${ink}, 0 3px ${ink}, -2px -2px ${ink}, 2px 2px ${ink}, -2px 2px ${ink}, 2px -2px ${ink}, 0 4px 0 ${color}, 0 0 14px ${color}`,
    } as Partial<CSSStyleDeclaration>);
    this.layer.append(e);
    // giữ chữ trong màn hình (kể cả lúc phóng to): người dùng chiêu đứng sát mép thì chữ không bị cắt
    const half = (e.offsetWidth * (ult ? 1.5 : 1.3)) / 2 + 4;
    const maxW = this.layer.clientWidth || window.innerWidth;
    e.style.left = `${half * 2 >= maxW ? maxW / 2 : Math.min(maxW - half, Math.max(half, p.x))}px`;
    const tilt = (Math.random() < 0.5 ? -1 : 1) * (ult ? 7 : 4);
    const sc = Math.max(0.3, this.scene?.timeScale || 1);
    const base = 'translate(-50%, -100%)';
    const anim = e.animate(
      [
        { transform: `${base} translateY(10px) scale(0.2) rotate(${-tilt * 2}deg)`, opacity: 0 },
        { transform: `${base} translateY(-6px) scale(${ult ? 1.45 : 1.25}) rotate(${tilt}deg)`, opacity: 1, offset: 0.2 },
        { transform: `${base} translateY(-2px) scale(${ult ? 0.94 : 0.97}) rotate(${-tilt * 0.4}deg)`, opacity: 1, offset: 0.32 },
        { transform: `${base} translateY(-8px) scale(1.04) rotate(${tilt * 0.3}deg)`, opacity: 1, offset: 0.6 },
        { transform: `${base} translateY(-44px) scale(0.9) rotate(0deg)`, opacity: 0 },
      ],
      { duration: Math.max(900, (ult ? 1500 : 950) / sc), easing: 'ease-out' },
    );
    anim.onfinish = () => e.remove();
    setTimeout(() => e.remove(), 3600);
  }

  /** màn cắt cảnh tuyệt kỹ: tối viền + dải chéo có chân dung, tên chiêu, vệt màu nguyên tố */
  cinematic(c: CineInfo) {
    this.clearCine();
    const wrap = el(`bt-cine s${c.side}${c.boss ? ' boss' : ''}${c.low ? ' low' : ''}`);
    wrap.style.setProperty('--d', `${(c.dur * 1.28).toFixed(2)}s`);
    wrap.style.setProperty('--c', c.color);
    if (!c.boss) wrap.append(el('bt-dim'));
    const cut = el('bt-cut');
    const band = el('bt-band');
    band.append(el('bt-streak'), el('bt-streak b'));
    cut.append(band);
    if (!c.boss) {
      const url = portraitOf(c.key, HERO_BY_ID[c.key]?.rarity ?? 'R').value;
      if (url && url !== 'none') {
        const img = el('bt-port', 'img') as HTMLImageElement;
        img.src = url;
        img.alt = '';
        cut.append(img);
      }
    }
    const name = el('bt-name');
    const small = el('bt-who', 'small');
    small.textContent = c.boss ? 'CHIÊU CUỐI' : `${this.battle?.unit(c.uid)?.init.name ?? ''} · TUYỆT KỸ`;
    const big = el('bt-nm', 'b');
    big.textContent = c.name;
    name.append(small, big);
    cut.append(name);
    wrap.append(cut);
    this.root.append(wrap);
    this.cine = wrap;
    this.cineTimer = window.setTimeout(() => this.clearCine(), c.dur * 1280 + 500);
  }

  clearCine() {
    clearTimeout(this.cineTimer);
    this.cine?.remove();
    this.cine = null;
  }

  /** banner kết thúc trận (giữ tới khi rời màn) */
  banner(win: boolean) {
    this.endEl?.remove();
    const e = el(`bt-end ${win ? 'win' : 'lose'}`);
    e.textContent = win ? 'CHIẾN THẮNG!' : 'THẤT BẠI';
    this.root.append(e);
    this.endEl = e;
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
    // thanh "mờ" tụt chậm phía sau để thấy lượng máu vừa mất
    setTimeout(() => {
      b.ghost.style.width = `${pct}%`;
    }, 250);
  }

  died(uid: number) {
    const b = this.bars.get(uid);
    if (b) {
      b.hidden = true;
      b.el.style.display = 'none';
    }
  }

  wave(n: number) {
    this.onWave(n);
  }

  flash(color: string) {
    const f = this.flashEl;
    f.style.background = `radial-gradient(circle at 50% 55%, ${color}aa, ${color}00 70%)`;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  sfx(k: 'hit' | 'crit' | 'ult' | 'heal') {
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

  /** gọi sau mỗi khung vẽ: đặt thanh theo vị trí chiếu của camera */
  frame() {
    const sc = this.scene;
    if (!sc) return;
    this.frameN++;
    const doChips = this.frameN % 6 === 0;
    for (const [uid, b] of this.bars) {
      if (b.hidden) continue;
      const p = sc.project(uid, 0.12);
      if (!p) {
        b.el.style.visibility = 'hidden';
        continue;
      }
      b.el.style.visibility = 'visible';
      b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      const u = this.battle?.unit(uid);
      if (u) {
        if (b.en) {
          const e = Math.floor(u.energy);
          if (e !== b.enV) {
            b.enV = e;
            b.en.style.width = `${Math.min(100, e)}%`;
            const full = u.energy >= ENERGY_MAX;
            b.el.classList.toggle('ready', full);
            if (full && !b.full) {
              // vừa đầy: lấp lánh
              b.el.classList.remove('pop');
              void b.el.offsetWidth;
              b.el.classList.add('pop');
              sc.ping(uid);
            }
            b.full = full;
          }
        }
        // thanh hành động (ATB) mỏng: đoán lượt tiếp theo
        const a = Math.max(0, Math.min(50, Math.round((u.gauge / GAUGE_MAX) * 50)));
        if (a !== b.atbV) {
          b.atbV = a;
          b.atb.style.transform = `scaleX(${a / 50})`;
        }
        if (doChips) this.refreshChips(b, uid);
      }
    }
  }

  dispose() {
    clearTimeout(this.cineTimer);
    this.layer.remove();
    this.flashEl.remove();
    this.cine?.remove();
    this.endEl?.remove();
    this.logBox.remove();
    this.logBtn.remove();
    this.bars.clear();
    this.dns.length = 0;
  }
}
