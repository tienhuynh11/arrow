// Sự kiện theo thời gian: xem, nhận thưởng, kiểm tra dữ liệu admin. Hàm THUẦN trên HState (store gọi trong giao dịch).

import type { EventClaimRes } from '../../../shared/heroes/api.js';
import {
  EVENT_KINDS, EVENT_MAX_OBJECTIVES, EVENT_NAME_MAX, EVENT_WALLET_CAP,
  type EventDef, type EventObjective, type EventReward, type EventView,
} from '../../../shared/heroes/events.js';
import { GEAR_BY_ID } from '../../../shared/heroes/gear.js';
import { HERO_BY_ID } from '../../../shared/heroes/heroes.js';
import type { Wallet } from '../../../shared/heroes/types.js';
import { SHARD_CAP, WALLET_KEYS, addDrops, addShards, eventActive, gain } from './rules.js';
import { StoreError, type HState } from './db/store.js';

/** các sự kiện đang diễn ra tại `ms` kèm tiến trình của tôi, mới nhất trước */
export function eventViews(s: Readonly<HState>, ms: number): EventView[] {
  return s.events
    .filter((e) => eventActive(e.def, ms))
    .sort((a, b) => b.def.startsAt - a.def.startsAt || b.def.id - a.def.id)
    .map((e) => {
      const progress: Record<string, number> = {};
      const claimed: string[] = [];
      for (const o of e.def.objectives) {
        const row = e.rows[o.id];
        progress[o.id] = Math.min(o.target, row?.progress ?? 0);
        if (row?.claimed) claimed.push(o.id);
      }
      return { event: structuredClone(e.def), progress, claimed };
    });
}

/**
 * Nhận thưởng một mục tiêu. Quy tắc tướng: đã sở hữu → cộng mảnh; CHƯA sở hữu → tặng luôn tướng (cấp 1, 1 sao) với
 * `shards = n` mảnh (chặn SHARD_CAP). Trang bị theo đường addDrops (đầy kho GEAR_CAP → đổi ra đá cường hoá).
 */
export function opEventClaim(s: HState, nowMs: number, eventId: unknown, objId: unknown): EventClaimRes['reward'] {
  const ev = typeof eventId === 'number' ? s.events.find((e) => e.def.id === eventId && eventActive(e.def, nowMs)) : undefined;
  if (!ev) throw new StoreError('Sự kiện không tồn tại hoặc đã kết thúc', 404);
  const obj = typeof objId === 'string' ? ev.def.objectives.find((o) => o.id === objId) : undefined;
  if (!obj) throw new StoreError('Mục tiêu sự kiện không tồn tại', 404);
  const row = ev.rows[obj.id];
  if (!row || row.progress < obj.target) throw new StoreError('Mục tiêu chưa hoàn thành', 400);
  if (row.claimed) throw new StoreError('Đã nhận thưởng mục tiêu này rồi', 400);
  row.claimed = true;
  return payReward(s, obj.reward);
}

/**
 * Trả một EventReward vào hồ sơ (dùng chung sự kiện + Tân thủ): ví (chặn MONEY_CAP), mảnh (tướng chưa có → tặng tướng cấp 1, 1 sao
 * với `n` mảnh), trang bị qua addDrops. Trả phần thực nhận (ví đã gồm đá từ món vượt kho).
 */
export function payReward(s: HState, r: EventReward): EventClaimRes['reward'] {
  const before = { ...s.wallet };
  if (r.wallet) gain(s, r.wallet);
  let shards: { hero: string; n: number } | undefined;
  if (r.shards && HERO_BY_ID[r.shards.hero]) {
    const { hero, n } = r.shards;
    const own = s.heroes[hero];
    if (own) addShards(own, n);
    else s.heroes[hero] = { id: hero, level: 1, star: 1, shards: Math.min(SHARD_CAP, n) };
    shards = { hero, n };
  }
  const gear = r.gear ? addDrops(s, r.gear.filter((id) => !!GEAR_BY_ID[id])) : [];
  const wallet: Partial<Wallet> = {};
  for (const k of WALLET_KEYS) if (s.wallet[k] !== before[k]) wallet[k] = s.wallet[k] - before[k];
  return shards ? { wallet, shards, gear } : { wallet, gear };
}

/* ------------------------------ ADMIN: KIỂM TRA DỮ LIỆU ------------------------------ */
const bad = (m: string) => new StoreError(m, 400);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const OBJ_ID = /^[a-z0-9_]{1,16}$/;
export const EVENT_DESC_MAX = 300;
export const OBJ_NAME_MAX = 60;
export const GEAR_PER_REWARD_MAX = 5;
export const SHARDS_PER_REWARD_MAX = 1000;
export const OBJ_TARGET_MAX = 100_000;

function validReward(raw: unknown, at: string): EventReward {
  if (!isObj(raw)) throw bad(`${at}: thưởng không hợp lệ`);
  const out: EventReward = {};
  if (raw.wallet !== undefined) {
    if (!isObj(raw.wallet)) throw bad(`${at}: ví thưởng không hợp lệ`);
    const w: Partial<Wallet> = {};
    for (const [k, v] of Object.entries(raw.wallet)) {
      if (!(WALLET_KEYS as readonly string[]).includes(k)) throw bad(`${at}: loại tiền "${k}" không tồn tại`);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > EVENT_WALLET_CAP) throw bad(`${at}: số tiền ${k} phải là số nguyên 0..${EVENT_WALLET_CAP}`);
      if (v > 0) w[k as keyof Wallet] = v;
    }
    if (Object.keys(w).length) out.wallet = w;
  }
  if (raw.shards !== undefined) {
    const sh = raw.shards;
    if (!isObj(sh) || typeof sh.hero !== 'string' || !HERO_BY_ID[sh.hero]) throw bad(`${at}: tướng nhận mảnh không tồn tại`);
    if (typeof sh.n !== 'number' || !Number.isInteger(sh.n) || sh.n < 1 || sh.n > SHARDS_PER_REWARD_MAX) throw bad(`${at}: số mảnh phải từ 1 đến ${SHARDS_PER_REWARD_MAX}`);
    out.shards = { hero: sh.hero, n: sh.n };
  }
  if (raw.gear !== undefined) {
    if (!Array.isArray(raw.gear) || raw.gear.length > GEAR_PER_REWARD_MAX) throw bad(`${at}: tối đa ${GEAR_PER_REWARD_MAX} trang bị`);
    for (const g of raw.gear) if (typeof g !== 'string' || !GEAR_BY_ID[g]) throw bad(`${at}: trang bị "${String(g).slice(0, 40)}" không tồn tại`);
    if (raw.gear.length) out.gear = [...(raw.gear as string[])];
  }
  return out;
}

/** kiểm tra + chuẩn hoá một sự kiện admin gửi lên (ném StoreError 400 nếu sai) */
export function validateEventInput(raw: unknown): Omit<EventDef, 'id'> & { id?: number } {
  if (!isObj(raw)) throw bad('Sự kiện không hợp lệ');
  let id: number | undefined;
  if (raw.id !== undefined && raw.id !== null) {
    if (typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 1 || raw.id > 2 ** 31 - 1) throw bad('Id sự kiện không hợp lệ');
    id = raw.id;
  }
  if (typeof raw.name !== 'string') throw bad('Tên sự kiện không hợp lệ');
  const name = raw.name.trim();
  if (name.length < 1 || name.length > EVENT_NAME_MAX) throw bad(`Tên sự kiện từ 1 đến ${EVENT_NAME_MAX} ký tự`);
  const desc = raw.desc === undefined ? '' : raw.desc;
  if (typeof desc !== 'string' || desc.length > EVENT_DESC_MAX) throw bad(`Mô tả tối đa ${EVENT_DESC_MAX} ký tự`);
  const { startsAt, endsAt } = raw;
  if (typeof startsAt !== 'number' || typeof endsAt !== 'number' || !Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || startsAt < 0 || endsAt < 0) {
    throw bad('Thời gian bắt đầu/kết thúc không hợp lệ');
  }
  if (startsAt >= endsAt) throw bad('Thời gian bắt đầu phải trước thời gian kết thúc');
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw bad('Trạng thái bật/tắt không hợp lệ');
  let banner: string | undefined;
  if (raw.banner !== undefined && raw.banner !== null && raw.banner !== '') {
    if (typeof raw.banner !== 'string' || !HERO_BY_ID[raw.banner]) throw bad('Tướng làm hình đại diện không tồn tại');
    banner = raw.banner;
  }
  if (!Array.isArray(raw.objectives)) throw bad('Danh sách mục tiêu không hợp lệ');
  if (raw.objectives.length > EVENT_MAX_OBJECTIVES) throw bad(`Tối đa ${EVENT_MAX_OBJECTIVES} mục tiêu`);
  const seen = new Set<string>();
  const objectives: EventObjective[] = raw.objectives.map((o, i): EventObjective => {
    const at = `Mục tiêu ${i + 1}`;
    if (!isObj(o)) throw bad(`${at} không hợp lệ`);
    if (typeof o.id !== 'string' || !OBJ_ID.test(o.id)) throw bad(`${at}: id phải khớp ^[a-z0-9_]{1,16}$`);
    if (seen.has(o.id)) throw bad(`${at}: id "${o.id}" bị trùng`);
    seen.add(o.id);
    if (typeof o.kind !== 'string' || !(EVENT_KINDS as readonly string[]).includes(o.kind)) throw bad(`${at}: loại tiến trình không hợp lệ`);
    if (typeof o.name !== 'string' || o.name.trim().length < 1 || o.name.trim().length > OBJ_NAME_MAX) throw bad(`${at}: tên từ 1 đến ${OBJ_NAME_MAX} ký tự`);
    if (typeof o.target !== 'number' || !Number.isInteger(o.target) || o.target < 1 || o.target > OBJ_TARGET_MAX) throw bad(`${at}: mục tiêu phải từ 1 đến ${OBJ_TARGET_MAX}`);
    return { id: o.id, kind: o.kind as EventObjective['kind'], name: o.name.trim(), target: o.target, reward: validReward(o.reward, at) };
  });
  const out: Omit<EventDef, 'id'> & { id?: number } = { name, desc, startsAt, endsAt, enabled: raw.enabled !== false, objectives };
  if (banner) out.banner = banner;
  if (id !== undefined) out.id = id;
  return out;
}
