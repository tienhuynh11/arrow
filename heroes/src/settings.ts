// Cài đặt người chơi (lưu localStorage, bọc try/catch vì có thể bị chặn).
import { signal } from '@preact/signals';

export type Quality = 'auto' | 'high' | 'medium' | 'low';

/** lưu/đọc vặt */
export function store(key: string, val?: string | null): string | null {
  try {
    if (val === null) localStorage.removeItem(key);
    else if (val !== undefined) localStorage.setItem(key, val);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const KEY = 'heroes-settings-v1';
interface Saved {
  quality: Quality;
  sound: boolean;
  auto: boolean;
  speed: 1 | 2 | 3;
  /** âm lượng nhạc / hiệu ứng 0..1 (khoá `sound` cũ vẫn là công tắc tắt tiếng tổng) */
  musicVol: number;
  sfxVol: number;
}
function load(): Saved {
  const d: Saved = { quality: 'auto', sound: true, auto: false, speed: 1, musicVol: 0.7, sfxVol: 0.9 };
  try {
    const o = JSON.parse(store(KEY) || '{}');
    if (['auto', 'high', 'medium', 'low'].includes(o.quality)) d.quality = o.quality;
    if (typeof o.sound === 'boolean') d.sound = o.sound;
    if (typeof o.auto === 'boolean') d.auto = o.auto;
    if (typeof o.musicVol === 'number') d.musicVol = Math.min(1, Math.max(0, o.musicVol));
    if (typeof o.sfxVol === 'number') d.sfxVol = Math.min(1, Math.max(0, o.sfxVol));
    if (o.speed === 1 || o.speed === 2 || o.speed === 3) d.speed = o.speed;
  } catch {
    /* dùng mặc định */
  }
  return d;
}
const init = load();
export const quality = signal<Quality>(init.quality);
export const sound = signal<boolean>(init.sound);
export const autoPref = signal<boolean>(init.auto);
export const speedPref = signal<1 | 2 | 3>(init.speed);
export const musicVol = signal<number>(init.musicVol);
export const sfxVol = signal<number>(init.sfxVol);

export function saveSettings() {
  store(KEY, JSON.stringify({ quality: quality.value, sound: sound.value, auto: autoPref.value, speed: speedPref.value, musicVol: musicVol.value, sfxVol: sfxVol.value }));
}
