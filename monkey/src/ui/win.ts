// Khung cửa sổ kiểu Võ Lâm: tiêu đề giấy da + góc chạm vàng + nút đóng; kéo tiêu đề để dời (nhớ vị trí trong phiên).

import { h } from './dom';

export type WinSide = 'left' | 'right' | 'center';

/** độ dời do người chơi kéo, theo id cửa sổ */
const offs = new Map<string, { x: number; y: number }>();

export function resetWinOffset(id: string) {
  offs.delete(id);
}

export interface WinOpts {
  id: string;
  title: string;
  icon: string;
  key?: string;
  side: WinSide;
  width: number;
  /** chiều cao cố định (px) — mặc định co theo nội dung, tối đa vùng cửa sổ */
  height?: number;
  tabs?: { id: string; name: string; badge?: number }[];
  tab?: string;
  onTab?: (id: string) => void;
  onClose: () => void;
  onFront?: () => void;
  /** nội dung chân cửa sổ (tuỳ chọn) */
  foot?: HTMLElement | null;
  front?: boolean;
}

export function winFrame(o: WinOpts, body: HTMLElement) {
  const head = h('div', { class: 'vwh' },
    h('span', { class: 'vwi' }, o.icon),
    h('b', null, o.title),
    o.key ? h('kbd', null, o.key) : null,
    h('span', { class: 'grow' }),
    h('button', { class: 'vwx', title: 'Đóng (Esc)', onclick: (e: Event) => { e.stopPropagation(); o.onClose(); } }, '✕'));
  const el = h('div', {
    class: `vw s-${o.side}${o.front ? ' front' : ''}`,
    'data-win': o.id,
    style: `--w:${o.width}px;width:${o.width}px${o.height ? `;height:${o.height}px` : ''}`,
  },
  h('i', { class: 'cn tl' }), h('i', { class: 'cn tr' }), h('i', { class: 'cn bl' }), h('i', { class: 'cn br' }),
  head);
  if (o.tabs && o.tabs.length > 1) {
    el.append(h('div', { class: 'vwtabs' }, ...o.tabs.map((t) => h('button', {
      class: t.id === o.tab ? 'on' : '', 'data-tab': t.id,
      onclick: () => { if (t.id !== o.tab) o.onTab?.(t.id); },
    }, t.name, t.badge ? h('em', { class: 'badge' }, t.badge) : null))));
  }
  body.classList.add('vwb');
  el.append(body);
  if (o.foot) {
    o.foot.classList.add('vwfoot');
    el.append(o.foot);
  }
  el.addEventListener('pointerdown', () => o.onFront?.(), true);
  // kéo để dời
  const off = offs.get(o.id);
  if (off) el.style.transform = `translate(${off.x}px,${off.y}px)`;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (matchMedia('(max-width: 760px), (max-height: 560px)').matches) return;
    const start = offs.get(o.id) ?? { x: 0, y: 0 };
    const sx = e.clientX, sy = e.clientY;
    const r0 = el.getBoundingClientRect();
    head.setPointerCapture?.(e.pointerId);
    head.style.cursor = 'grabbing';
    const move = (ev: PointerEvent) => {
      let x = start.x + ev.clientX - sx;
      let y = start.y + ev.clientY - sy;
      // giữ tiêu đề trong màn hình
      const nl = r0.left + (x - start.x), nt = r0.top + (y - start.y);
      if (nl < -r0.width + 80) x += -r0.width + 80 - nl;
      if (nl > innerWidth - 80) x -= nl - (innerWidth - 80);
      if (nt < 0) y -= nt;
      if (nt > innerHeight - 40) y -= nt - (innerHeight - 40);
      offs.set(o.id, { x, y });
      el.style.transform = `translate(${x}px,${y}px)`;
    };
    const up = () => {
      head.style.cursor = '';
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  head.addEventListener('dblclick', () => { offs.delete(o.id); el.style.transform = ''; });
  return el;
}

/** khung trang trí nhỏ (4 góc vàng) bọc quanh phần tử bất kỳ */
export function ornate(el: HTMLElement) {
  el.style.position = el.style.position || 'relative';
  el.append(h('i', { class: 'cn tl' }), h('i', { class: 'cn tr' }), h('i', { class: 'cn bl' }), h('i', { class: 'cn br' }));
  return el;
}
