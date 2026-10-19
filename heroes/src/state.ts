// Trạng thái toàn cục của UI: màn hình hiện tại, thông báo (toast), tiện ích dùng chung.
import { signal } from '@preact/signals';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ArenaBattleRes, BattleRes, GuildBossRes, TowerBattleRes } from '@shared/heroes/api';
import type { ArenaOpponent } from '@shared/heroes/arena';
import { ApiError } from './api';

export type Screen =
  | { n: 'hub' }
  | { n: 'heroes'; id?: string }
  | { n: 'squad' }
  | { n: 'summon' }
  | { n: 'campaign'; stage?: string }
  | { n: 'battle'; stage: string; opp?: ArenaOpponent }
  | { n: 'result'; stage: string; res: BattleRes }
  | { n: 'tower' }
  | { n: 'towerResult'; res: TowerBattleRes }
  | { n: 'arena' }
  | { n: 'arenaResult'; res: ArenaBattleRes }
  | { n: 'quests' }
  | { n: 'shop' }
  | { n: 'events' }
  | { n: 'newbie' }
  | { n: 'profile'; tab?: 'info' | 'level' | 'ach' | 'collect' }
  | { n: 'guild'; tab?: 'members' | 'boss' | 'acts' | 'chat' }
  | { n: 'guildBossResult'; res: GuildBossRes };

export const screen = signal<Screen>({ n: 'hub' });
/** ải đang định đánh khi người chơi rẽ sang màn Đội hình: Đội hình hiện nút "Chiến tiếp" quay lại đúng ải đó */
export const returnTo = signal<string | null>(null);
export function go(s: Screen) {
  screen.value = s;
}

/* ------------------------------ TOAST ------------------------------ */
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
  /** số lần lặp liền nhau của cùng một nội dung (hiện "x2", "x3"...) */
  n: number;
}
export const toasts = signal<Toast[]>([]);
let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const cur = toasts.value;
  const last = cur[cur.length - 1];
  // cùng nội dung liền nhau: gộp thành một viên thuốc có đếm "xN" và chạy lại hoạt ảnh (đổi id)
  const t: Toast = { id: toastId++, text, kind, n: last && last.text === text && last.kind === kind ? last.n + 1 : 1 };
  toasts.value = [...(t.n > 1 ? cur.slice(0, -1) : cur).slice(-2), t];
  setTimeout(() => {
    toasts.value = toasts.value.filter((x) => x.id !== t.id);
  }, 2600);
}
export function errToast(e: unknown) {
  if (e instanceof ApiError) toast(e.message, 'error');
  else {
    console.error(e);
    toast('Có lỗi xảy ra', 'error');
  }
}

/* ------------------------------ TIỆN ÍCH ------------------------------ */
/** khoá chống gửi trùng cho mỗi lần bấm (crypto.randomUUID chỉ có ở ngữ cảnh an toàn nên có đường lùi) */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** chạy thao tác bất đồng bộ có trạng thái "đang xử lý" + chống bấm đôi + toast lỗi */
export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      errToast(e);
      return undefined;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  return [busy, run];
}

/** theo dõi media query */
export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

/** đồng hồ nhịp (ms) để đếm ngược / tích luỹ trực tiếp */
export function useTicker(ms = 1000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

export const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : String(Math.floor(n)));
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}g ${String(m).padStart(2, '0')}p ${String(ss).padStart(2, '0')}s` : `${m}p ${String(ss).padStart(2, '0')}s`;
}
