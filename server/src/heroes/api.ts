// REST của Thẻ Tướng dưới `${HEROES_API}*` (hợp đồng ở shared/heroes/api.ts).
// Tài khoản/phiên DÙNG CHUNG với Bầy Khỉ (monkey/accounts.ts): cùng người dùng, cùng token.
// Đăng nhập: header `Authorization: Bearer <token>`. Admin: header `x-admin-key` = MONKEY_ADMIN_KEY (không đặt → 403).
// Mọi route thay đổi = MỘT giao dịch có khoá hồ sơ và trả về hồ sơ mới (MutateRes).

import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ROUTES, type AuthRes, type LeaderRow, type MeResponse } from '../../../shared/heroes/api.js';
import type { BattleInput } from '../../../shared/heroes/battle.js';
import { MAX_GEAR_LEVEL } from '../../../shared/heroes/gear.js';
import { BATTLE_MAX_TICKS, HEROES_API, MAX_LEVEL, SQUAD_SIZE } from '../../../shared/heroes/config.js';
import { HttpError, clientIp, createAdminCheck, json, parseJson, readBody } from '../http/util.js';
import { login, logout, register, resolveToken } from '../monkey/accounts.js';
import { storeReady } from '../monkey/db/index.js';
import { StoreError, heroStoreReady, type HState, type HeroStore } from './db/index.js';
import {
  MAX_BATTLE_INPUTS, MAX_SWEEP, buildMe, opAfkClaim, opBattle, opGearEquip, opGearSalvage, opGearUnequip, opGearUpgrade, opGrant, opLevelUp, opQuestClaim, opSetSquad, opShopBuy, opStarUp, opSummon, opSweep, opTowerBattle,
} from './rules.js';

const MAX_BODY = 16 * 1024;
/** seed trận có hiệu lực 10 phút */
export const SEED_TTL_MS = 10 * 60_000;
const SEED_MAX = 2 ** 32;

/** đồng hồ server; test thay bằng giờ giả để thử qua ngày (reset 00:00 giờ VN) */
let clock: () => number = Date.now;
export function _setHeroesClock(fn: (() => number) | null) {
  clock = fn ?? Date.now;
}
const nowDate = () => new Date(clock());

const checkAdmin = createAdminCheck(() => process.env.MONKEY_ADMIN_KEY || null);

/* ---------------- kiểm tra dữ liệu vào ---------------- */
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
function body(v: unknown): Record<string, any> {
  if (!isObj(v)) throw new HttpError(400, 'Dữ liệu không hợp lệ');
  return v;
}
function int(v: unknown, what: string, min = 0, max = 2 ** 31 - 1): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${what} không hợp lệ`);
  return v;
}
function str(v: unknown, what: string, max: number, min = 0): string {
  if (typeof v !== 'string' || v.length > max || v.trim().length < min) throw new HttpError(400, `${what} không hợp lệ`);
  return v.trim();
}
function parseInputs(v: unknown): BattleInput[] {
  if (!Array.isArray(v) || v.length > MAX_BATTLE_INPUTS) throw new HttpError(400, 'Danh sách hành động không hợp lệ');
  return v.map((raw) => {
    const o = body(raw);
    const inp: BattleInput = { tick: int(o.tick, 'Thời điểm', 0, BATTLE_MAX_TICKS) };
    if (o.ult !== undefined) inp.ult = int(o.ult, 'Tướng tung tuyệt kỹ', 0, SQUAD_SIZE - 1);
    if (o.auto !== undefined) {
      if (typeof o.auto !== 'boolean') throw new HttpError(400, 'Auto không hợp lệ');
      inp.auto = o.auto;
    }
    return inp;
  });
}

/* ---------------- seed trận (RAM, một tiến trình) ---------------- */
const seeds = new Map<number, { seed: number; expires: number }>();
function issueSeed(accountId: number, nowMs: number) {
  if (seeds.size > 10_000) for (const [k, v] of seeds) if (v.expires < nowMs) seeds.delete(k);
  const e = { seed: randomInt(0, SEED_MAX), expires: nowMs + SEED_TTL_MS };
  seeds.set(accountId, e);
  return e;
}
/** dùng một lần: khớp seed đã cấp, chưa hết hạn → xoá và trả true */
function takeSeed(accountId: number, seed: number, nowMs: number): boolean {
  const e = seeds.get(accountId);
  if (!e || e.seed !== seed) return false;
  seeds.delete(accountId);
  return e.expires >= nowMs;
}
/** chỉ dùng cho test */
export function _resetHeroesApi() {
  seeds.clear();
  names.clear();
}

/* ---------------- xác thực ---------------- */
function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  const m = typeof h === 'string' ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  return m ? m[1] : null;
}
async function auth(req: IncomingMessage): Promise<number> {
  const id = await resolveToken(bearer(req));
  if (id === null) throw new HttpError(401, 'Chưa đăng nhập hoặc phiên đã hết hạn');
  return id;
}
const names = new Map<number, string>();
async function usernameOf(id: number): Promise<string> {
  const hit = names.get(id);
  if (hit) return hit;
  const acc = await (await storeReady()).accountById(id);
  if (!acc) throw new HttpError(404, 'Không tìm thấy tài khoản');
  if (names.size > 5000) names.clear();
  names.set(id, acc.username);
  return acc.username;
}

async function meOf(store: HeroStore, id: number, now = nowDate()): Promise<MeResponse> {
  const name = await usernameOf(id);
  return store.view(id, now, (s) => buildMe(s, name, now));
}
/** chạy một thao tác thay đổi + dựng hồ sơ mới trong cùng giao dịch */
async function act<T extends object>(store: HeroStore, id: number, kind: string, op: (s: HState, nowMs: number) => T) {
  const now = nowDate();
  const name = await usernameOf(id);
  // hồ sơ dựng SAU giao dịch: món trang bị mới chỉ có uid khi store đã ghi (xem HState.newGear)
  const r = await store.mutate(id, now, kind, (s) => op(s, now.getTime()));
  return { ...r, me: await store.view(id, now, (s) => buildMe(s, name, now)) };
}

/* ---------------- định tuyến ---------------- */
async function route(req: IncomingMessage, res: ServerResponse, r: string, method: string) {
  const store = await heroStoreReady();
  const post = method === 'POST';
  const read = async () => body(parseJson(await readBody(req, MAX_BODY)));

  // ---- admin ----
  if (r.startsWith('admin/')) {
    const denied = checkAdmin(req);
    if (denied) return json(res, denied.status, { error: denied.message });
    if (r === 'admin/grant' && post) {
      const b = await read();
      const acc = await (await storeReady()).findAccount(str(b.username, 'Tên tài khoản', 40, 1).normalize('NFC'));
      if (!acc) throw new HttpError(404, 'Không tìm thấy tài khoản');
      const g: Record<string, number> = {};
      for (const k of ['gold', 'gems', 'tickets', 'exp', 'stones']) if (b[k] !== undefined) g[k] = int(b[k], k, 0, 1_000_000_000);
      const hero = b.hero === undefined ? undefined : str(b.hero, 'Tướng', 40, 1);
      names.set(acc.id, acc.username);
      return json(res, 200, await act(store, acc.id, 'admin', (s) => (opGrant(s, g, hero), {})));
    }
    throw new HttpError(404, 'Không có API này');
  }

  // ---- công khai ----
  if (r === ROUTES.register && post) {
    const b = await read();
    const { token, accountId } = await register(clientIp(req), b.username, b.password);
    return json(res, 200, { token, me: await meOf(store, accountId) } satisfies AuthRes);
  }
  if (r === ROUTES.login && post) {
    const b = await read();
    const { token, accountId } = await login(clientIp(req), b.username, b.password);
    return json(res, 200, { token, me: await meOf(store, accountId) } satisfies AuthRes);
  }
  if (r === ROUTES.leaderboard && method === 'GET') {
    const base = await storeReady();
    const rows: LeaderRow[] = [];
    for (const e of await store.leaderboard(20)) {
      const acc = await base.accountById(e.accountId);
      if (acc) rows.push({ username: acc.username, stage: e.stage, stars: e.stars });
    }
    return json(res, 200, { rows });
  }

  // ---- cần đăng nhập ----
  if (r === ROUTES.logout && post) {
    const t = bearer(req);
    if (t) await logout(t);
    return json(res, 200, { ok: true });
  }
  if (r === ROUTES.me && method === 'GET') {
    const id = await auth(req);
    return json(res, 200, await meOf(store, id));
  }
  if (!post) throw new HttpError(404, 'Không có API này');

  switch (r) {
    case ROUTES.summon: {
      const id = await auth(req);
      const b = await read();
      const banner = str(b.banner, 'Banner', 40, 1);
      if (b.count !== 1 && b.count !== 10) throw new HttpError(400, 'Số lượt phải là 1 hoặc 10');
      if (b.pay !== 'tickets' && b.pay !== 'gems') throw new HttpError(400, 'Cách thanh toán không hợp lệ');
      const key = str(b.key, 'Khoá yêu cầu', 64, 8);
      if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new HttpError(400, 'Khoá yêu cầu không hợp lệ');
      const count: 1 | 10 = b.count;
      const pay: 'tickets' | 'gems' = b.pay;
      const pulls = await store.mutate(id, nowDate(), 'summon', (s) => opSummon(s, banner, count, pay, (n) => randomInt(n)), {
        idem: { key, tag: `${banner}|${count}|${pay}` },
      });
      return json(res, 200, { me: await meOf(store, id), pulls });
    }
    case ROUTES.levelUp: {
      const id = await auth(req);
      const b = await read();
      const hero = str(b.hero, 'Tướng', 40, 1);
      const times = b.times === undefined ? 1 : int(b.times, 'Số cấp', 1, MAX_LEVEL);
      let gained = 0;
      const r = await act(store, id, 'level-up', (s) => ((gained = opLevelUp(s, hero, times)), {}));
      return json(res, 200, { me: r.me, gained });
    }
    case ROUTES.starUp: {
      const id = await auth(req);
      const hero = str((await read()).hero, 'Tướng', 40, 1);
      return json(res, 200, await act(store, id, 'star-up', (s) => (opStarUp(s, hero), {})).then(({ me }) => ({ me })));
    }
    case ROUTES.setSquad: {
      const id = await auth(req);
      const b = await read();
      const squad = int(b.squad, 'Đội', 0, 100);
      if (!Array.isArray(b.slots) || b.slots.length !== SQUAD_SIZE) throw new HttpError(400, `Đội hình gồm ${SQUAD_SIZE} ô`);
      const slots = b.slots.map((v: unknown) => str(v, 'Ô đội hình', 40));
      const active = b.active === undefined ? false : b.active === true;
      return json(res, 200, await act(store, id, 'set-squad', (s) => (opSetSquad(s, squad, slots, active), {})).then(({ me }) => ({ me })));
    }
    case ROUTES.battleStart: {
      const id = await auth(req);
      const e = issueSeed(id, clock());
      return json(res, 200, { seed: e.seed, expires: e.expires });
    }
    case ROUTES.battle: {
      const id = await auth(req);
      const b = await read();
      const stage = str(b.stage, 'Ải', 20, 1);
      const squad = int(b.squad, 'Đội', 0, 100);
      const seed = int(b.seed, 'Hạt giống', 0, SEED_MAX - 1);
      const inputs = parseInputs(b.inputs);
      const auto = b.auto === true;
      // seed phải do server cấp cho CHÍNH tài khoản này và dùng đúng một lần (kiểm tra + xoá đồng bộ, trước mọi await kế tiếp)
      if (!takeSeed(id, seed, clock())) throw new HttpError(400, 'Hạt giống trận không hợp lệ hoặc đã hết hạn — hãy bắt đầu trận mới');
      return json(res, 200, await act(store, id, 'battle', (s) => opBattle(s, stage, squad, seed, inputs, auto, (n) => randomInt(n))));
    }
    case ROUTES.towerBattle: {
      const id = await auth(req);
      const b = await read();
      const squad = int(b.squad, 'Đội', 0, 100);
      const seed = int(b.seed, 'Hạt giống', 0, SEED_MAX - 1);
      const inputs = parseInputs(b.inputs);
      const auto = b.auto === true;
      // cùng cơ chế seed với /battle (battle-start cấp, dùng một lần)
      if (!takeSeed(id, seed, clock())) throw new HttpError(400, 'Hạt giống trận không hợp lệ hoặc đã hết hạn — hãy bắt đầu trận mới');
      return json(res, 200, await act(store, id, 'tower', (s) => opTowerBattle(s, squad, seed, inputs, auto, (n) => randomInt(n))));
    }
    case ROUTES.questClaim: {
      const id = await auth(req);
      const qid = str((await read()).id, 'Nhiệm vụ', 40, 1);
      return json(res, 200, await act(store, id, 'quest', (s) => ({ reward: opQuestClaim(s, qid) })));
    }
    case ROUTES.shopBuy: {
      const id = await auth(req);
      const b = await read();
      const item = str(b.item, 'Mặt hàng', 40, 1);
      const times = b.times === undefined ? 1 : int(b.times, 'Số lần mua', 1, 100);
      const hero = b.hero === undefined ? undefined : str(b.hero, 'Tướng', 40, 1);
      return json(res, 200, await act(store, id, 'shop', (s, now) => opShopBuy(s, now, item, times, hero, (n) => randomInt(n))));
    }
    case ROUTES.sweep: {
      const id = await auth(req);
      const b = await read();
      const stage = str(b.stage, 'Ải', 20, 1);
      const times = int(b.times, 'Số lần quét', 1, MAX_SWEEP);
      return json(res, 200, await act(store, id, 'sweep', (s, now) => opSweep(s, now, stage, times, (n) => randomInt(n))));
    }
    case ROUTES.gearEquip: {
      const id = await auth(req);
      const b = await read();
      const uid = int(b.uid, 'Trang bị');
      const hero = str(b.hero, 'Tướng', 40, 1);
      return json(res, 200, await act(store, id, 'gear-equip', (s) => (opGearEquip(s, uid, hero), {})));
    }
    case ROUTES.gearUnequip: {
      const id = await auth(req);
      const uid = int((await read()).uid, 'Trang bị');
      return json(res, 200, await act(store, id, 'gear-unequip', (s) => (opGearUnequip(s, uid), {})));
    }
    case ROUTES.gearUpgrade: {
      const id = await auth(req);
      const b = await read();
      const uid = int(b.uid, 'Trang bị');
      const times = b.times === undefined ? 1 : int(b.times, 'Số cấp', 1, MAX_GEAR_LEVEL);
      return json(res, 200, await act(store, id, 'gear-upgrade', (s) => ({ gained: opGearUpgrade(s, uid, times) })));
    }
    case ROUTES.gearSalvage: {
      const id = await auth(req);
      const b = await read();
      if (!Array.isArray(b.uids) || b.uids.length < 1 || b.uids.length > 50) throw new HttpError(400, 'Chọn từ 1 đến 50 món');
      const uids: number[] = b.uids.map((u: unknown) => int(u, 'Trang bị'));
      return json(res, 200, await act(store, id, 'gear-salvage', (s) => ({ stones: opGearSalvage(s, uids) })));
    }
    case ROUTES.afkClaim: {
      const id = await auth(req);
      await read();
      return json(res, 200, await act(store, id, 'afk-claim', (s, now) => ({ reward: opAfkClaim(s, now) })));
    }
  }
  throw new HttpError(404, 'Không có API này');
}

/** gắn trong network/server.ts TRƯỚC handler Bầy Khỉ; trả true nếu là route của nó */
export function handleHeroesApi(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  const path = q >= 0 ? url.slice(0, q) : url;
  if (!path.startsWith(HEROES_API)) return false;
  const method = req.method ?? 'GET';
  const r = path.slice(HEROES_API.length).replace(/\/+$/, '');
  route(req, res, r, method).catch((e) => {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError || e instanceof StoreError) return json(res, e.status, { error: e.message });
    console.error('[heroes-api] lỗi', r, e instanceof Error ? e.message : e);
    json(res, 500, { error: 'Lỗi máy chủ, thử lại sau' });
  });
  return true;
}
