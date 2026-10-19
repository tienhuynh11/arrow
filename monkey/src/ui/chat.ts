// Khung chat kiểu VLTK có tab: Tất cả / Đội / Hệ thống (nhặt đồ theo màu phẩm, sự kiện trận).
// Enter mở ô gõ, Enter gửi, Esc đóng. Tin nhắn chỉ đặt bằng textContent (không HTML).

import { CHAT_MAX } from '@shared/monkey/config';
import { h, playerColor } from './dom';

const KEEP = 60; // số tin giữ lại
const FADE_MS = 9000; // tin cũ mờ đi khi không mở chat
type Tab = 'all' | 'team' | 'sys';

export class Chat {
  readonly root = h('div', { class: 'chat hidden f-all' });
  private log = h('div', { class: 'chatlog' });
  private tabsEl = h('div', { class: 'chtabs2' });
  private tab: Tab = 'all';
  private input = h('input', { class: 'chatin', maxlength: String(CHAT_MAX), placeholder: 'Nhập tin nhắn… (Enter gửi · Esc đóng)', autocomplete: 'off' }) as HTMLInputElement;
  isOpen = false;
  /** gửi tin lên server */
  onSend: (m: string) => void = () => {};
  /** mở / đóng (để main tạm tắt điều khiển) */
  onToggle: (open: boolean) => void = () => {};

  constructor() {
    this.input.classList.add('hidden');
    this.drawTabs();
    this.root.append(this.tabsEl, this.log, this.input);
    document.body.append(this.root);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const m = this.input.value.trim();
        if (m) this.onSend(m);
        this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.setTab(this.tab === 'all' ? 'team' : this.tab === 'team' ? 'sys' : 'all');
      }
    });
    this.input.addEventListener('blur', () => { setTimeout(() => { if (this.isOpen && document.activeElement !== this.input) this.close(); }, 150); });
  }

  private drawTabs() {
    this.tabsEl.replaceChildren(...([['all', 'Tất cả'], ['team', 'Đội'], ['sys', 'Hệ thống']] as [Tab, string][]).map(([t, n]) => h('button', {
      class: t === this.tab ? 'on' : '',
      onmousedown: (e: Event) => { e.preventDefault(); this.setTab(t); },
    }, n)));
  }

  private setTab(t: Tab) {
    this.tab = t;
    this.root.className = this.root.className.replace(/\bf-\w+/, `f-${t}`);
    this.drawTabs();
    this.log.scrollTop = this.log.scrollHeight;
  }

  setVisible(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (!on && this.isOpen) this.close();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.input.classList.remove('hidden');
    this.input.value = '';
    this.onToggle(true);
    // đợi qua phím Enter vừa bấm rồi mới focus (tránh gõ dính ký tự)
    setTimeout(() => this.input.focus(), 0);
    this.log.scrollTop = this.log.scrollHeight;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.classList.add('hidden');
    this.input.blur();
    this.onToggle(false);
  }

  private push(line: HTMLElement) {
    this.log.append(line);
    while (this.log.childElementCount > KEEP) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('old'), FADE_MS);
  }

  /** tin người chơi (kênh Đội) */
  add(idx: number, name: string, msg: string) {
    this.push(h('div', { class: 'cl' },
      h('span', { class: 'tg team' }, '[Đội] '),
      h('b', { style: `color:${playerColor(idx)}` }, `${name}: `),
      h('span', null, msg)));
  }

  /** dòng hệ thống (màu tuỳ chọn — ví dụ màu phẩm khi nhặt đồ) */
  system(msg: string, color?: string) {
    this.push(h('div', { class: 'cl sys' }, h('span', { class: 'tg' }, '[Hệ thống] '), h('span', { style: color ? `color:${color}` : '' }, msg)));
  }

  clear() {
    this.log.textContent = '';
  }
}
