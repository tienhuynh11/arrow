// Tiện ích DOM nhỏ: tạo phần tử an toàn (chữ luôn là textContent), toast, biểu tượng lớp.

import { CLASSES } from '@shared/monkey/content';

type Kid = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(msg: string, ok = false) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast' });
    document.body.append(toastEl);
  }
  toastEl.className = `toast${ok ? ' ok' : ''}`;
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl && (toastEl.style.display = 'none'), 2600);
}

export const CLASS_ICON = ['🎖️', '⛑️', '🔧', '🛡️'];

export function clsColor(cls: number) {
  return `#${CLASSES[cls].color.toString(16).padStart(6, '0')}`;
}

export function clsIcon(cls: number, size = 42) {
  return h('div', { class: 'ico', style: `background:${clsColor(cls)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px` }, CLASS_ICON[cls]);
}

export function fmt(n: number) {
  return Math.round(n).toLocaleString('vi-VN');
}

export function timeStr(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
