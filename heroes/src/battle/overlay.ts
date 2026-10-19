// HUD HTML đè lên cảnh 3D: thanh máu/năng lượng/hành động trên đầu, chip buff, số sát thương nổi, banner cắt cảnh tuyệt kỹ,
// nhật ký trận, nháy màn hình. Làm bằng DOM thuần (cập nhật mỗi khung hình theo camera) để Preact không phải render lại 60 lần/giây.
// Không dùng blur/backdrop-filter; hiệu ứng chỉ là transform/opacity.
import { ENERGY_MAX, GAUGE_MAX, type Battle } from '@shared/heroes/battle';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import { gsap } from 'gsap';
import { sfx, type Sfx } from '../audio';
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
  private dns: { e: HTMLElement; tl: gsap.core.Timeline }[] = [];
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

  constructor(private root: HTMLElement) {
    this.layer = el('hud-layer');
    this.flashEl = el('hud-flash');
    this.flashEl.style.animation = 'none';
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

  number(uid: number, text: string, kind: 'dmg' | 'crit' | 'heal' | 'text', opt?: { adv?: number; color?: string }) {
    const p = this.scene?.project(uid, 0.1);
    if (!p) return;
    while (this.dns.length > 30) {
      const o = this.dns.shift();
      if (o) {
        o.tl.kill();
        this.paced.delete(o.tl);
        o.e.remove();
      }
    }
    const e = el(`dn dn-${kind}${opt?.adv ? (opt.adv > 0 ? ' adv-up' : ' adv-dn') : ''}`);
    e.style.animation = 'none';
    const jx = (Math.random() - 0.5) * 36;
    e.style.left = `${p.x + jx}px`;
    e.style.top = `${p.y}px`;
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
      e.insertAdjacentHTML('beforeend', opt.adv > 0 ? ARROW_UP : ARROW_DOWN);
      const tag = el('bt-adv', 'small');
      tag.textContent = opt.adv > 0 ? 'KHẮC' : 'KHÁNG';
      e.append(tag);
    }
    this.layer.append(e);
    // GSAP: nảy ra (overshoot) -> bay lên -> mờ dần. Tổng ≈ 0.95s cảnh (chạy chậm thì lâu hơn để kịp đọc)
    const tl = gsap.timeline();
    const rise = kind === 'crit' ? 120 : kind === 'text' ? 56 : 74;
    gsap.set(e, { xPercent: -50, yPercent: -20, scale: 0.3, opacity: 0 });
    if (kind === 'crit') {
      tl.to(e, { yPercent: -80, scale: 1.55, opacity: 1, duration: 0.14, ease: 'back.out(3)' }, 0)
        .to(e, { scale: 1.2, duration: 0.16, ease: 'power2.out' }, 0.14)
        .to(e, { y: -rise, scale: 1.05, duration: 0.65, ease: 'power1.out' }, 0.14)
        .to(e, { opacity: 0, duration: 0.25, ease: 'power1.in' }, 0.7);
      if (sb) {
        gsap.set(sb, { xPercent: -50, yPercent: -50, scale: 0.2, rotation: 0 });
        tl.to(sb, { scale: 1.1, rotation: 30, duration: 0.22, ease: 'power2.out' }, 0)
          .to(sb, { scale: 0.8, rotation: 60, opacity: 0, duration: 0.68, ease: 'power1.in' }, 0.22);
      }
    } else {
      const big = kind === 'text' ? 1 : opt?.adv && opt.adv > 0 ? 1.35 : 1.25;
      tl.to(e, { yPercent: -60, scale: big, opacity: 1, duration: 0.13, ease: 'back.out(2.4)' }, 0)
        .to(e, { scale: 1, duration: 0.14, ease: 'power2.out' }, 0.13)
        .to(e, { y: -rise, duration: kind === 'text' ? 0.95 : 0.7, ease: 'power1.out' }, 0.1)
        .to(e, { opacity: 0, duration: 0.25, ease: 'power1.in' }, kind === 'text' ? 0.85 : 0.7);
    }
    const rec = { e, tl };
    this.pace(tl, () => {
      e.remove();
      const i = this.dns.indexOf(rec);
      if (i >= 0) this.dns.splice(i, 1);
    });
    this.dns.push(rec);
  }

  /** tên kỹ năng bật lên "bụp" trên đầu người dùng (chữ viền dày, nghiêng, nảy) — GSAP timeline theo nhịp trận */
  skill(uid: number, name: string, color: string, ult: boolean) {
    const p = this.scene?.project(uid, ult ? 0.75 : 0.55);
    if (!p) return;
    this.layer.querySelectorAll('.sk-pop').forEach((n, i, all) => {
      if (all.length - i > 3) {
        gsap.killTweensOf(n);
        n.remove();
      }
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
    const L = ult ? 1.5 : 0.95;
    gsap.set(e, { xPercent: -50, yPercent: -100, y: 10, scale: 0.2, rotation: -tilt * 2, opacity: 0 });
    const tl = gsap.timeline();
    tl.to(e, { y: -6, scale: ult ? 1.45 : 1.25, rotation: tilt, opacity: 1, duration: L * 0.2, ease: 'back.out(2.2)' })
      .to(e, { y: -2, scale: ult ? 0.94 : 0.97, rotation: -tilt * 0.4, duration: L * 0.12, ease: 'power2.inOut' })
      .to(e, { y: -8, scale: 1.04, rotation: tilt * 0.3, duration: L * 0.28, ease: 'sine.inOut' })
      .to(e, { y: -44, scale: 0.9, rotation: 0, opacity: 0, duration: L * 0.4, ease: 'power1.in' });
    this.pace(tl, () => e.remove());
  }

  /** màn cắt cảnh tuyệt kỹ: tối viền + dải chéo có chân dung, tên chiêu, vệt màu nguyên tố (GSAP, chạy theo giây THẬT) */
  cinematic(c: CineInfo) {
    this.clearCine();
    const wrap = el(`bt-cine s${c.side}${c.boss ? ' boss' : ''}${c.low ? ' low' : ''}`);
    wrap.style.setProperty('--c', c.color);
    const dim = c.boss ? null : el('bt-dim');
    if (dim) wrap.append(dim);
    const cut = el('bt-cut');
    const band = el('bt-band');
    band.append(el('bt-streak'), el('bt-streak b'));
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
    small.textContent = c.boss ? 'CHIÊU CUỐI' : `${this.battle?.unit(c.uid)?.init.name ?? ''} · TUYỆT KỸ`;
    const big = el('bt-nm', 'b');
    big.textContent = c.name;
    name.append(small, big);
    cut.append(name);
    wrap.append(cut);
    this.root.append(wrap);
    this.cine = wrap;

    // tắt animation CSS cũ, GSAP lo toàn bộ
    cut.style.animation = 'none';
    if (dim) dim.style.animation = 'none';
    // xoá transform trong CSS để GSAP tự quản (tránh cộng dồn translateX(%) của CSS với xPercent)
    cut.style.transform = 'none';
    big.style.transform = 'none';
    if (port) port.style.transform = 'none';
    const T = Math.max(0.5, c.dur * 1.28);
    const dir = c.side === 0 ? -1 : 1; // phe ta trượt vào từ trái, địch từ phải
    const rot = c.side === 0 ? -6 : 6;
    gsap.set(cut, { xPercent: dir * 120, rotation: rot });
    if (dim) gsap.set(dim, { opacity: 0 });
    if (port) gsap.set(port, { rotation: -rot, scaleX: c.side === 0 ? 1 : -1, x: dir * 70, opacity: 0 });
    gsap.set(small, { x: dir * 50, opacity: 0 });
    gsap.set(big, { x: dir * 120, opacity: 0, skewX: -8, scale: 1.25 });
    const tl = gsap.timeline({ onComplete: () => this.clearCine() });
    if (dim) tl.to(dim, { opacity: 1, duration: T * 0.18, ease: 'power2.out' }, 0);
    tl.to(cut, { xPercent: 0, duration: T * 0.2, ease: 'expo.out' }, 0);
    if (port) tl.to(port, { x: 0, opacity: 1, duration: T * 0.26, ease: 'back.out(1.5)' }, T * 0.06);
    tl.to(small, { x: 0, opacity: 1, duration: T * 0.16, ease: 'power3.out' }, T * 0.1)
      .to(big, { x: 0, opacity: 1, scale: 1, duration: T * 0.22, ease: 'back.out(1.8)' }, T * 0.13)
      // giữ: trôi nhẹ để không bị "đứng hình"
      .to(cut, { xPercent: -dir * 3, duration: T * 0.6, ease: 'none' }, T * 0.2)
      .to(cut, { xPercent: -dir * 125, duration: T * 0.2, ease: 'power3.in' }, T * 0.8);
    if (dim) tl.to(dim, { opacity: 0, duration: T * 0.2, ease: 'power1.in' }, T * 0.8);
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
  }

  died(uid: number) {
    const b = this.bars.get(uid);
    if (b) {
      b.hidden = true;
      b.el.style.display = 'none';
    }
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
              sfx('ultReady');
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
    this.cineTl?.kill();
    this.endTl?.kill();
    this.flashTw?.kill();
    for (const tl of this.paced) tl.kill();
    this.paced.clear();
    for (const b of this.bars.values()) gsap.killTweensOf(b.ghost);
    this.layer.querySelectorAll('.sk-pop').forEach((n) => gsap.killTweensOf(n));
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
