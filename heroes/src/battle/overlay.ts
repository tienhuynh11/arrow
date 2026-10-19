// HUD HTML đè lên cảnh 3D: thanh máu/năng lượng trên đầu, số sát thương nổi, nháy màn hình khi tuyệt kỹ.
// Làm bằng DOM thuần (cập nhật mỗi khung hình theo camera) để Preact không phải render lại 60 lần/giây.
import type { Battle } from '@shared/heroes/battle';
import { sfx } from '../audio';
import type { BattleScene, SceneHooks } from '../render/battle-scene';

interface Bar {
  el: HTMLElement;
  hp: HTMLElement;
  ghost: HTMLElement;
  en: HTMLElement | null;
  enV: number;
  hidden: boolean;
}

const ARROW_UP = '<svg viewBox="0 0 12 14" width="12" height="14"><path d="M6 1 L11 7 H8 V13 H4 V7 H1 Z" fill="#ff7a1a" stroke="#1e2a4a" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 12 14" width="12" height="14"><path d="M6 13 L11 7 H8 V1 H4 V7 H1 Z" fill="#7b8cb0" stroke="#1e2a4a" stroke-width="1.3" stroke-linejoin="round"/></svg>';

export class BattleOverlay implements SceneHooks {
  scene: BattleScene | null = null;
  battle: Battle | null = null;
  onWave: (n: number) => void = () => {};
  private bars = new Map<number, Bar>();
  private flashEl: HTMLElement;
  private layer: HTMLElement;

  constructor(private root: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'hud-layer';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'hud-flash';
    root.append(this.layer, this.flashEl);
  }

  /** tạo thanh cho đơn vị (gọi khi thêm vào cảnh) */
  addBar(uid: number, side: 0 | 1, boss: boolean) {
    if (this.bars.has(uid)) return;
    const el = document.createElement('div');
    el.className = `ubar s${side}${boss ? ' boss' : ''}`;
    el.innerHTML = '<div class="ub-hp"><i class="ghost"></i><i class="fill"></i></div>' + (side === 0 ? '<div class="ub-en"><i></i></div>' : '');
    const hp = el.querySelector('.fill') as HTMLElement;
    const ghost = el.querySelector('.ghost') as HTMLElement;
    const en = el.querySelector('.ub-en i') as HTMLElement | null;
    this.layer.append(el);
    this.bars.set(uid, { el, hp, ghost, en, enV: -1, hidden: false });
  }

  number(uid: number, text: string, kind: 'dmg' | 'crit' | 'heal' | 'text', opt?: { adv?: number; color?: string }) {
    const p = this.scene?.project(uid, 0.1);
    if (!p) return;
    while (this.layer.querySelectorAll('.dn').length > 34) this.layer.querySelector('.dn')?.remove();
    const el = document.createElement('div');
    el.className = `dn dn-${kind}`;
    const jx = (Math.random() - 0.5) * 36;
    el.style.left = `${p.x + jx}px`;
    el.style.top = `${p.y}px`;
    const scale = this.scene?.timeScale || 1;
    el.style.animationDuration = `${(kind === 'text' ? 1.1 : 0.95) / scale}s`;
    if (opt?.color) el.style.color = opt.color;
    el.textContent = text;
    if (opt?.adv) el.insertAdjacentHTML('beforeend', opt.adv > 0 ? ARROW_UP : ARROW_DOWN);
    this.layer.append(el);
    const kill = () => el.remove();
    el.addEventListener('animationend', kill, { once: true });
    setTimeout(kill, 1800);
  }

  /** tên kỹ năng bật lên "bụp" trên đầu người dùng (chữ viền dày, nghiêng, nảy) — chỉ dùng Web Animations nên không cần CSS riêng */
  skill(uid: number, name: string, color: string, ult: boolean) {
    const p = this.scene?.project(uid, ult ? 0.75 : 0.55);
    if (!p) return;
    while (this.layer.querySelectorAll('.sk-pop').length > 4) this.layer.querySelector('.sk-pop')?.remove();
    const el = document.createElement('div');
    el.className = 'sk-pop';
    const size = ult ? 38 : 24;
    const ink = '#1a2140';
    el.textContent = name + (ult ? '!' : '');
    Object.assign(el.style, {
      position: 'absolute', left: `${p.x}px`, top: `${p.y}px`, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '5',
      fontFamily: "var(--f-title), 'Baloo 2', system-ui, sans-serif", fontWeight: '900', fontSize: `${size}px`, color: ult ? '#fff7c2' : '#fff',
      letterSpacing: '1px', willChange: 'transform, opacity',
      textShadow: `-3px 0 ${ink}, 3px 0 ${ink}, 0 -3px ${ink}, 0 3px ${ink}, -2px -2px ${ink}, 2px 2px ${ink}, -2px 2px ${ink}, 2px -2px ${ink}, 0 4px 0 ${color}, 0 0 14px ${color}`,
    } as Partial<CSSStyleDeclaration>);
    this.layer.append(el);
    // giữ chữ trong màn hình (kể cả lúc phóng to): người dùng chiêu đứng sát mép thì chữ không bị cắt
    const half = (el.offsetWidth * (ult ? 1.5 : 1.3)) / 2 + 4;
    const maxW = this.layer.clientWidth || window.innerWidth;
    el.style.left = `${half * 2 >= maxW ? maxW / 2 : Math.min(maxW - half, Math.max(half, p.x))}px`;
    const tilt = (Math.random() < 0.5 ? -1 : 1) * (ult ? 7 : 4);
    const sc = this.scene?.timeScale || 1;
    const base = 'translate(-50%, -100%)';
    const anim = el.animate(
      [
        { transform: `${base} translateY(10px) scale(0.2) rotate(${-tilt * 2}deg)`, opacity: 0 },
        { transform: `${base} translateY(-6px) scale(${ult ? 1.45 : 1.25}) rotate(${tilt}deg)`, opacity: 1, offset: 0.2 },
        { transform: `${base} translateY(-2px) scale(${ult ? 0.94 : 0.97}) rotate(${-tilt * 0.4}deg)`, opacity: 1, offset: 0.32 },
        { transform: `${base} translateY(-8px) scale(1.04) rotate(${tilt * 0.3}deg)`, opacity: 1, offset: 0.6 },
        { transform: `${base} translateY(-44px) scale(0.9) rotate(0deg)`, opacity: 0 },
      ],
      { duration: (ult ? 1500 : 950) / sc, easing: 'ease-out' },
    );
    anim.onfinish = () => el.remove();
    setTimeout(() => el.remove(), 2600);
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

  /** gọi sau mỗi khung vẽ: đặt thanh theo vị trí chiếu của camera */
  frame() {
    const sc = this.scene;
    if (!sc) return;
    for (const [uid, b] of this.bars) {
      if (b.hidden) continue;
      const p = sc.project(uid, 0.12);
      if (!p) {
        b.el.style.visibility = 'hidden';
        continue;
      }
      b.el.style.visibility = 'visible';
      b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      if (b.en && this.battle) {
        const u = this.battle.unit(uid);
        const e = u ? Math.floor(u.energy) : 0;
        if (e !== b.enV) {
          b.enV = e;
          b.en.style.width = `${Math.min(100, e)}%`;
          b.el.classList.toggle('ready', e >= 100);
        }
      }
    }
  }

  dispose() {
    this.layer.remove();
    this.flashEl.remove();
    this.bars.clear();
  }
}
