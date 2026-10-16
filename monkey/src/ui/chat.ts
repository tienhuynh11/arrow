// Khung chat trong phòng: Enter mở ô gõ, Enter gửi, Esc đóng. Tin nhắn chỉ đặt bằng textContent (không HTML).

import { CHAT_MAX } from '@shared/monkey/config';
import { h, playerColor } from './dom';

const KEEP = 40; // số tin giữ lại
const FADE_MS = 9000; // tin cũ mờ đi khi không mở chat

export class Chat {
  readonly root = h('div', { class: 'chat hidden' });
  private log = h('div', { class: 'chatlog' });
  private input = h('input', { class: 'chatin', maxlength: String(CHAT_MAX), placeholder: 'Nhập tin nhắn… (Enter gửi · Esc đóng)', autocomplete: 'off' }) as HTMLInputElement;
  isOpen = false;
  /** gửi tin lên server */
  onSend: (m: string) => void = () => {};
  /** mở / đóng (để main tạm tắt điều khiển) */
  onToggle: (open: boolean) => void = () => {};

  constructor() {
    this.input.classList.add('hidden');
    this.root.append(this.log, this.input);
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
      }
    });
    this.input.addEventListener('blur', () => { if (this.isOpen) this.close(); });
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

  add(idx: number, name: string, msg: string) {
    const line = h('div', { class: 'cl' },
      h('b', { style: `color:${playerColor(idx)}` }, `${name}: `),
      h('span', null, msg));
    this.log.append(line);
    while (this.log.childElementCount > KEEP) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('old'), FADE_MS);
  }

  clear() {
    this.log.textContent = '';
  }
}
