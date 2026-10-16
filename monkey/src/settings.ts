// Cài đặt người chơi: chuột, camera, âm thanh, đồ hoạ, phím, cảm ứng. Lưu localStorage (bọc try/catch).

export type Quality = 'auto' | 'high' | 'medium' | 'low';

export const ACTIONS = [
  ['forward', 'Đi tới'],
  ['back', 'Đi lùi'],
  ['left', 'Sang trái'],
  ['right', 'Sang phải'],
  ['jump', 'Nhảy (né sóng xung kích)'],
  ['sprint', 'Chạy nhanh'],
  ['reload', 'Nạp đạn'],
  ['use', 'Đỡ đồng đội dậy (giữ)'],
  ['skillG', 'Kỹ năng 1'],
  ['skillX', 'Kỹ năng 2'],
  ['ult', 'Tuyệt chiêu'],
  ['buyWeapon', 'Nâng bậc súng'],
  ['buyHp', 'Nâng máu'],
  ['shop', 'Mở cửa hàng'],
  ['scores', 'Bảng điểm (giữ)'],
] as const;
export type Action = (typeof ACTIONS)[number][0];

export interface Settings {
  sens: number;
  adsSens: number;
  invertY: boolean;
  fov: number;
  camDist: number;
  adsToggle: boolean;
  master: number;
  sfx: number;
  ambient: number;
  quality: Quality;
  dmgNumbers: boolean;
  shake: number;
  showFps: boolean;
  crossColor: string;
  touchSens: number;
  aimAssist: boolean;
  touchScale: number;
  keys: Record<Action, string>;
}

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  reload: 'KeyR',
  use: 'KeyE',
  skillG: 'KeyG',
  skillX: 'KeyX',
  ult: 'KeyQ',
  buyWeapon: 'KeyV',
  buyHp: 'KeyC',
  shop: 'KeyB',
  scores: 'Tab',
};

export const DEFAULTS: Settings = {
  sens: 1,
  adsSens: 0.7,
  invertY: false,
  fov: 78,
  camDist: 3.6,
  adsToggle: false,
  master: 0.8,
  sfx: 0.9,
  ambient: 0.5,
  quality: 'auto',
  dmgNumbers: true,
  shake: 0.8,
  showFps: false,
  crossColor: '#ffffff',
  touchSens: 1,
  aimAssist: true,
  touchScale: 1,
  keys: { ...DEFAULT_KEYS },
};

const KEY = 'monkey-settings-v1';
type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

function load(): Settings {
  const s: Settings = { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        if (k === 'keys') continue;
        if (o && typeof o[k] === typeof DEFAULTS[k]) (s as any)[k] = o[k];
      }
      if (o?.keys && typeof o.keys === 'object') {
        for (const a of Object.keys(DEFAULT_KEYS) as Action[]) if (typeof o.keys[a] === 'string') s.keys[a] = o.keys[a];
      }
    }
  } catch {
    /* localStorage bị chặn: dùng mặc định */
  }
  s.sens = clampN(s.sens, 0.05, 6);
  s.adsSens = clampN(s.adsSens, 0.2, 1.5);
  s.fov = clampN(s.fov, 55, 110);
  s.camDist = clampN(s.camDist, 2.2, 6);
  s.master = clampN(s.master, 0, 1);
  s.sfx = clampN(s.sfx, 0, 1);
  s.ambient = clampN(s.ambient, 0, 1);
  s.shake = clampN(s.shake, 0, 1.5);
  s.touchSens = clampN(s.touchSens, 0.2, 3);
  s.touchScale = clampN(s.touchScale, 0.7, 1.4);
  if (!['auto', 'high', 'medium', 'low'].includes(s.quality)) s.quality = 'auto';
  return s;
}

function clampN(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* bỏ qua */
  }
  for (const fn of listeners) fn(settings);
}

export function resetSettings() {
  Object.assign(settings, { ...DEFAULTS, keys: { ...DEFAULT_KEYS } });
  saveSettings();
}

export function onSettings(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** tên phím dễ đọc */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift phải', ControlLeft: 'Ctrl', ControlRight: 'Ctrl phải',
    AltLeft: 'Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Enter: 'Enter',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse3: 'Chuột 4', Mouse4: 'Chuột 5', Mouse1: 'Chuột giữa',
  };
  return map[code] ?? code;
}

/** lưu/đọc vặt (tên, lớp) */
export function store(key: string, val?: string): string | null {
  try {
    if (val !== undefined) localStorage.setItem(key, val);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function sessionSet(key: string, val: string | null) {
  try {
    if (val === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, val);
  } catch {
    /* bỏ qua */
  }
}
