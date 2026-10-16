// Client REST cho tài khoản / kho đồ / ải / sự kiện (`${BASE}api/*`).
// Token phiên lưu localStorage 'monkey-token'; hồ sơ `me` được cache + báo cho người đăng ký.

import { API, type AuthRes, type LeaderRow, type MeResponse, type MutateRes } from '@shared/monkey/api';
import type { Reward, SkillKey, Slot } from '@shared/monkey/progression';
import { store } from './settings';

const BASE = import.meta.env.BASE_URL;
const TOKEN_KEY = 'monkey-token';

export class ApiError extends Error {
  constructor(msg: string, readonly status: number) {
    super(msg);
  }
}

let token: string | null = store(TOKEN_KEY) || null;
let me: MeResponse | null = null;
/** phần thưởng vừa được cấp ở thao tác gần nhất (nhận sự kiện…) */
let lastGranted: Reward | undefined;
type Listener = (me: MeResponse | null) => void;
const subs = new Set<Listener>();

function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bị chặn: chỉ giữ trong phiên */
  }
}

function emit() {
  for (const fn of subs) {
    try {
      fn(me);
    } catch (e) {
      console.error(e);
    }
  }
}

/** đăng ký nhận hồ sơ mới; trả hàm huỷ */
export function onMe(fn: Listener) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** gọi khi token hết hạn / bị thu hồi */
export let onLoggedOut: () => void = () => {};
export function setLoggedOutHandler(fn: () => void) {
  onLoggedOut = fn;
}

async function req<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Không kết nối được máy chủ', 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* không phải JSON */
  }
  if (!res.ok || (data && typeof data.error === 'string')) {
    const msg = (data && typeof data.error === 'string' && data.error) || `Lỗi máy chủ (${res.status})`;
    if (res.status === 401 && auth && token) {
      setToken(null);
      me = null;
      emit();
      onLoggedOut();
    }
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

function applyMe(m: MeResponse) {
  me = m;
  emit();
  return m;
}

async function mutate(path: string, body: unknown): Promise<MeResponse> {
  const r = await req<MutateRes>(path, 'POST', body);
  lastGranted = r.granted;
  return applyMe(r.me);
}

export const api = {
  get token() {
    return token;
  },
  get me() {
    return me;
  },
  get loggedIn() {
    return !!token;
  },
  get lastGranted() {
    return lastGranted;
  },

  async register(username: string, password: string) {
    const r = await req<AuthRes>(API.register, 'POST', { username, password }, false);
    setToken(r.token);
    return applyMe(r.me);
  },
  async login(username: string, password: string) {
    const r = await req<AuthRes>(API.login, 'POST', { username, password }, false);
    setToken(r.token);
    return applyMe(r.me);
  },
  async logout() {
    try {
      if (token) await req(API.logout, 'POST', {});
    } catch {
      /* vẫn đăng xuất cục bộ */
    }
    setToken(null);
    me = null;
    emit();
  },
  async refresh() {
    if (!token) return null;
    return applyMe(await req<MeResponse>(API.me));
  },

  equip: (uid: number) => mutate(API.equip, { uid }),
  unequip: (slot: Slot) => mutate(API.unequip, { slot }),
  upgradeItem: (uid: number) => mutate(API.upgradeItem, { uid }),
  salvage: (uids: number[]) => mutate(API.salvage, { uids }),
  unlockChar: (cls: number) => mutate(API.unlockChar, { cls }),
  selectChar: (cls: number) => mutate(API.selectChar, { cls }),
  upgradeSkill: (cls: number, skill: SkillKey) => mutate(API.upgradeSkill, { cls, skill }),
  claimEvent: (eventId: number, objective: string) => mutate(API.claimEvent, { eventId, objective }),

  async leaderboard(stage: string, solo: boolean): Promise<LeaderRow[]> {
    const q = `?stage=${encodeURIComponent(stage)}${solo ? '&solo=1' : ''}`;
    const r = await req<LeaderRow[] | { rows?: LeaderRow[]; board?: LeaderRow[] }>(`${API.leaderboard}${q}`, 'GET', undefined, !!token);
    if (Array.isArray(r)) return r;
    return r?.rows ?? r?.board ?? [];
  },
};
