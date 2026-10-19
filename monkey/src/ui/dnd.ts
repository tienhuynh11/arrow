// Kéo thả đồ (chuột + cảm ứng) giữa ô hành trang, kho, ô trang bị, ô bán. Không dùng HTML5 drag (kém trên điện thoại).
// Chuột: nhấn-kéo > 5px là kéo. Cảm ứng: chạm giữ ~0.3 s rồi kéo; chạm nhanh = "tap".

import type { EquipSlot } from '@shared/monkey/gear';
import type { Inv } from '../gearlib';
import { hideTip, muteTips } from './tooltip';

export interface DragSrc {
  from: 'bag' | 'stash' | 'equip';
  it: Inv;
  slot?: EquipSlot;
  cell?: number;
}
interface Target {
  accept: (s: DragSrc) => boolean;
  drop: (s: DragSrc) => void;
}
const targets = new WeakMap<Element, Target>();

export function dropTarget(el: HTMLElement, accept: Target['accept'], drop: Target['drop']) {
  el.dataset.drop = '1';
  targets.set(el, { accept, drop });
}

export interface DragOpts {
  /** chạm nhanh / bấm chuột trái không kéo */
  onTap?: (e: PointerEvent) => void;
  /** nháy đúp / chuột phải */
  onQuick?: () => void;
}

let active: { src: DragSrc; ghost: HTMLElement; el: HTMLElement; over: HTMLElement | null } | null = null;
export const isDragging = () => !!active;

function targetAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  return (hit?.closest('[data-drop]') as HTMLElement | null) ?? null;
}

function setOver(t: HTMLElement | null) {
  if (!active) return;
  if (active.over === t) return;
  active.over?.classList.remove('drop', 'bad');
  active.over = t;
  if (t) {
    const tg = targets.get(t);
    t.classList.add(tg && tg.accept(active.src) ? 'drop' : 'bad');
  }
}

function begin(el: HTMLElement, src: DragSrc, x: number, y: number) {
  muteTips(true);
  const ghost = document.createElement('div');
  ghost.className = 'dragghost';
  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.remove('dragging', 'sel');
  ghost.append(clone);
  document.body.append(ghost);
  ghost.style.transform = `translate(${x - 23}px,${y - 23}px)`;
  el.classList.add('dragging');
  active = { src, ghost, el, over: null };
  document.body.classList.add('dnd');
}
function move(x: number, y: number) {
  if (!active) return;
  active.ghost.style.transform = `translate(${x - 23}px,${y - 23}px)`;
  setOver(targetAt(x, y));
}
function end(x: number, y: number, cancel = false) {
  if (!active) return;
  const a = active;
  active = null;
  a.ghost.remove();
  a.el.classList.remove('dragging');
  a.over?.classList.remove('drop', 'bad');
  document.body.classList.remove('dnd');
  muteTips(false);
  if (cancel) return;
  const t = targetAt(x, y);
  const tg = t ? targets.get(t) : undefined;
  if (tg && tg.accept(a.src)) tg.drop(a.src);
}

export function draggable(el: HTMLElement, src: () => DragSrc, o: DragOpts = {}) {
  let sx = 0, sy = 0, down = false, armed = false, pid = -1, touch = false, lp = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = true;
    pid = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
    touch = e.pointerType === 'touch';
    armed = !touch;
    clearTimeout(lp);
    if (touch) lp = window.setTimeout(() => { armed = true; hideTip(); if (navigator.vibrate) navigator.vibrate(12); }, 300);
    if (!touch) e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== pid) return;
    if (active) { move(e.clientX, e.clientY); return; }
    const d = Math.hypot(e.clientX - sx, e.clientY - sy);
    if (touch && !armed && d > 10) { clearTimeout(lp); down = false; return; } // đang cuộn
    if (armed && d > 5) {
      el.setPointerCapture?.(pid);
      begin(el, src(), e.clientX, e.clientY);
    }
  });
  const up = (e: PointerEvent) => {
    if (!down || e.pointerId !== pid) return;
    down = false;
    clearTimeout(lp);
    if (active) { end(e.clientX, e.clientY, e.type === 'pointercancel'); return; }
    if (e.type === 'pointerup' && Math.hypot(e.clientX - sx, e.clientY - sy) < 8) o.onTap?.(e);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  // cảm ứng: đang kéo thì chặn cuộn trang
  el.addEventListener('touchmove', (e) => { if (armed || active) e.preventDefault(); }, { passive: false });
  el.addEventListener('dblclick', (e) => { e.preventDefault(); o.onQuick?.(); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!touch) o.onQuick?.(); });
}

/* ---------- menu ngữ cảnh nhỏ ---------- */
let ctxEl: HTMLElement | null = null;
export function closeCtx() {
  ctxEl?.remove();
  ctxEl = null;
}
export function ctxMenu(x: number, y: number, items: { label: string; on: () => void; disabled?: boolean }[]) {
  closeCtx();
  const m = document.createElement('div');
  m.className = 'ctxm';
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    b.onclick = (e) => { e.stopPropagation(); closeCtx(); it.on(); };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(innerWidth - r.width - 4, x))}px`;
  m.style.top = `${Math.max(4, Math.min(innerHeight - r.height - 4, y))}px`;
  ctxEl = m;
  setTimeout(() => {
    const off = (e: Event) => { if (ctxEl && !ctxEl.contains(e.target as Node)) { closeCtx(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  }, 0);
}
