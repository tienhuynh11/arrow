// REST của Thẻ Tướng dưới `${HEROES_API}*` (hợp đồng ở shared/heroes/api.ts).
// Tài khoản/phiên DÙNG CHUNG với Bầy Khỉ (monkey/accounts.ts): cùng người dùng, cùng token.
// Đăng nhập: header `Authorization: Bearer <token>`. Admin: header `x-admin-key` = MONKEY_ADMIN_KEY (không đặt → 403).
// Mọi route thay đổi = MỘT giao dịch có khoá hồ sơ và trả về hồ sơ mới (MutateRes).

import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ROUTES, type ArenaRes, type ArenaTopRes, type AuthRes, type EventsRes, type GuildBossRes, type GuildChatRes, type GuildRes, type GuildSearchRes, type LeaderRow, type MeResponse } from '../../../shared/heroes/api.js';
import { GUILD_CHAT_MAX } from '../../../shared/heroes/guild.js';
import { ARENA_OPPONENTS, ARENA_TOP_N, type ArenaOpponent } from '../../../shared/heroes/arena.js';
import { dayKey } from '../../../shared/heroes/quests.js';
import type { BattleInput } from '../../../shared/heroes/battle.js';
import { MAX_GEAR_LEVEL } from '../../../shared/heroes/gear.js';
import { BATTLE_MAX_TICKS, HEROES_API, MAX_LEVEL, SQUAD_SIZE } from '../../../shared/heroes/config.js';
import { HttpError, clientIp, createAdminCheck, json, parseJson, readBody } from '../http/util.js';
import { login, logout, register, resolveToken } from '../monkey/accounts.js';
import { storeReady } from '../monkey/db/index.js';
import { StoreError, heroStoreReady, type HState, type HeroStore } from './db/index.js';
import type { GuildCtx } from './db/store.js';
import { eventViews, opEventClaim, validateEventInput } from './events.js';
import {
  cleanText, foldName, guildInfoOf, briefOf, opGuildBoss, opGuildCheckin, opGuildCreate, opGuildDonate, opGuildJoin, opGuildKick, opGuildLeave, opGuildNotice, opGuildTransfer,
} from './guilds.js';
import {
  BOT_COUNT, MAX_BATTLE_INPUTS, MAX_SWEEP, arenaStateOf, botTarget, buildMe, defenseTarget, opAfkClaim, opArenaBattle, opArenaDefense, opBattle, opGearEquip, opGearSalvage, opGearUnequip, opGearUpgrade, opGrant, opLevelUp, opQuestClaim, opSetSquad, opShopBuy, opStarUp, opSummon, opSweep, opTowerBattle,
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
  chatLast.clear();
  arenaVer++;
  topCache = null;
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
/** giới hạn nhắn tin bang: mốc (ms) tin gần nhất của mỗi tài khoản (RAM, một tiến trình) */
const chatLast = new Map<number, number>();
export const CHAT_MIN_GAP_MS = 1500;
async function usernameOf(id: number): Promise<string> {
  const hit = names.get(id);
  if (hit) return hit;
  const acc = await (await storeReady()).accountById(id);
  if (!acc) throw new HttpError(404, 'Không tìm thấy tài khoản');
  if (names.size > 5000) names.clear();
  names.set(id, acc.username);
  return acc.username;
}

/** có thưởng hạ boss bang đang chờ → chạm hồ sơ một lần để nhận (cùng giao dịch nên đúng một lần) */
async function settle(store: HeroStore, id: number) {
  if ((await store.pendingKill(id)) > 0) await store.mutate(id, nowDate(), 'provision', () => 0);
}
async function meOf(store: HeroStore, id: number, now = nowDate()): Promise<MeResponse> {
  const name = await usernameOf(id);
  await settle(store, id);
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

/** như act() nhưng trong giao dịch có bang (khoá hàng bang); `target` = bang đích khi xin vào, null = bang của tôi */
async function actGuild<T extends object>(store: HeroStore, id: number, kind: string, target: number | null, op: (s: HState, g: GuildCtx, nowMs: number) => T) {
  const now = nowDate();
  const name = await usernameOf(id);
  const r = await store.mutateGuild(id, now, kind, target, (s, g) => op(s, g, now.getTime()));
  return { ...r, me: await store.view(id, now, (s) => buildMe(s, name, now)) };
}
async function guildInfo(store: HeroStore, id: number, now: Date) {
  const ctx = await store.viewGuild(id, now, (_s, g) => structuredClone(g) as GuildCtx);
  if (!ctx.guild) return null;
  const nm = new Map<number, string>();
  await Promise.all([...new Set([ctx.guild.leaderId, ...ctx.members.map((m) => m.accountId)])].map(async (i) => void nm.set(i, await usernameOf(i).catch(() => 'Vô danh'))));
  return guildInfoOf(ctx, id, now.getTime(), (i) => nm.get(i) ?? 'Vô danh');
}

/* ---------------- đấu trường ---------------- */
/** tăng mỗi khi dữ liệu đấu trường đổi trong tiến trình này → bỏ cache bảng xếp hạng */
let arenaVer = 0;
let topCache: { ver: number; at: number; res: ArenaTopRes } | null = null;
const TOP_TTL_MS = 10_000;
const NEAR_POOL = 15;

/** đội phòng thủ SỐNG của một tài khoản khác (đọc không khoá); null = không có hồ sơ; target null = chưa có đội phòng thủ */
async function realTarget(store: HeroStore, oppId: number): Promise<{ target: ReturnType<typeof defenseTarget> } | null> {
  const got = await store.peek(oppId, (s) => ({ target: defenseTarget(s, '') }));
  if (!got || !got.target) return got;
  got.target.opp.name = await usernameOf(oppId).catch(() => 'Vô danh');
  return got;
}
async function arenaView(store: HeroStore, id: number): Promise<ArenaRes> {
  const now = nowDate();
  // tạo hàng lười ở lần đầu chạm đấu trường (chỉ ghi lần đầu)
  if (!(await store.view(id, now, (s) => s.arenaOn))) {
    await store.mutate(id, now, 'arena-init', (s) => void (s.arenaOn = true));
    arenaVer++;
  }
  const state = await store.view(id, now, (s) => arenaStateOf(s, dayKey(now.getTime())));
  const rank = await store.arenaRank(id);
  // ứng viên thật gần điểm mình, xáo trộn rồi lấy tối đa ARENA_OPPONENTS
  const pool = await store.arenaNear(id, state.rating, NEAR_POOL);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const opponents: ArenaOpponent[] = [];
  for (const c of pool) {
    if (opponents.length >= ARENA_OPPONENTS) break;
    const t = (await realTarget(store, c.accountId))?.target;
    if (t) opponents.push(t.opp);
  }
  opponents.sort((a, b) => a.rating - b.rating);
  for (let n = 0; opponents.length < ARENA_OPPONENTS; n++) opponents.push(botTarget(n, state.rating).opp); // bot n=0.. theo điểm của mình
  return { state, rank, opponents };
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
    if (r === ROUTES.adminEvents && method === 'GET') return json(res, 200, { events: await store.adminEvents() });
    if (r === ROUTES.adminEventSave && post) {
      const ev = validateEventInput((await read()).event);
      return json(res, 200, { event: await store.adminEventSave(ev) });
    }
    if (r === ROUTES.adminEventDelete && post) {
      await store.adminEventDelete(int((await read()).id, 'Id sự kiện', 1));
      return json(res, 200, { ok: true });
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

  if (r === ROUTES.arenaTop && method === 'GET') {
    const nowMs = clock();
    if (topCache && topCache.ver === arenaVer && nowMs - topCache.at < TOP_TTL_MS) return json(res, 200, topCache.res);
    const ver = arenaVer;
    const rows: ArenaTopRes['rows'] = [];
    for (const e of await store.arenaTop(ARENA_TOP_N)) {
      const username = await usernameOf(e.accountId).catch(() => null);
      if (username !== null) rows.push({ rank: rows.length + 1, username, rating: e.rating, wins: e.wins });
    }
    topCache = { ver, at: nowMs, res: { rows } };
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
  if (r === ROUTES.arena && method === 'GET') {
    const id = await auth(req);
    return json(res, 200, await arenaView(store, id));
  }
  if (r === ROUTES.events && method === 'GET') {
    const id = await auth(req);
    const now = nowDate();
    return json(res, 200, { events: await store.view(id, now, (s) => eventViews(s, now.getTime())), now: now.getTime() } satisfies EventsRes);
  }
  if (r === ROUTES.guild && method === 'GET') {
    const id = await auth(req);
    await settle(store, id);
    return json(res, 200, { info: await guildInfo(store, id, nowDate()) } satisfies GuildRes);
  }
  if (r === ROUTES.guildSearch && method === 'GET') {
    await auth(req);
    const q = foldName(cleanText(new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? '').slice(0, 40));
    const rows = (await store.guildList(2000)).filter((x) => !q || foldName(x.guild.name).includes(q)).slice(0, 20);
    const guilds = await Promise.all(rows.map(async (x) => briefOf(x.guild, x.members, await usernameOf(x.guild.leaderId).catch(() => 'Vô danh'))));
    return json(res, 200, { guilds } satisfies GuildSearchRes);
  }
  if (r === ROUTES.guildChat && method === 'GET') {
    const id = await auth(req);
    const messages = await store.guildChat(id, 50);
    if (!messages) throw new HttpError(403, 'Bạn chưa vào bang nào');
    return json(res, 200, { messages } satisfies GuildChatRes);
  }
  if (!post) throw new HttpError(404, 'Không có API này');

  switch (r) {
    case ROUTES.eventClaim: {
      const id = await auth(req);
      const b = await read();
      const event = int(b.event, 'Sự kiện', 1);
      const objective = str(b.objective, 'Mục tiêu', 40, 1);
      return json(res, 200, await act(store, id, 'event', (s, now) => ({ reward: opEventClaim(s, now, event, objective) })));
    }
    case ROUTES.guildCreate: {
      const id = await auth(req);
      const b = await read();
      if (typeof b.name !== 'string' || b.name.length > 200) throw new HttpError(400, 'Tên bang không hợp lệ');
      if (b.notice !== undefined && (typeof b.notice !== 'string' || b.notice.length > 1000)) throw new HttpError(400, 'Thông báo không hợp lệ');
      return json(res, 200, await actGuild(store, id, 'guild', null, (s, g, now) => (opGuildCreate(s, g, now, b.name, b.notice), {})));
    }
    case ROUTES.guildJoin: {
      const id = await auth(req);
      const gid = int((await read()).id, 'Bang', 1);
      return json(res, 200, await actGuild(store, id, 'guild', gid, (s, g, now) => (opGuildJoin(s, g, now), {})));
    }
    case ROUTES.guildLeave: {
      const id = await auth(req);
      await read();
      return json(res, 200, await actGuild(store, id, 'guild', null, (s, g, now) => (opGuildLeave(s, g, now), {})));
    }
    case ROUTES.guildKick: {
      const id = await auth(req);
      const member = int((await read()).member, 'Thành viên', 1);
      return json(res, 200, await actGuild(store, id, 'guild', null, (s, g) => (opGuildKick(s, g, member), {})));
    }
    case ROUTES.guildTransfer: {
      const id = await auth(req);
      const member = int((await read()).member, 'Thành viên', 1);
      return json(res, 200, await actGuild(store, id, 'guild', null, (s, g) => (opGuildTransfer(s, g, member), {})));
    }
    case ROUTES.guildNotice: {
      const id = await auth(req);
      const b = await read();
      if (typeof b.notice !== 'string' || b.notice.length > 1000) throw new HttpError(400, 'Thông báo không hợp lệ');
      return json(res, 200, await actGuild(store, id, 'guild', null, (s, g) => (opGuildNotice(s, g, b.notice), {})));
    }
    case ROUTES.guildDonate: {
      const id = await auth(req);
      const option = str((await read()).option, 'Mức quyên góp', 20, 1);
      return json(res, 200, await actGuild(store, id, 'guild', null, (s, g, now) => (opGuildDonate(s, g, now, option), {})));
    }
    case ROUTES.guildCheckin: {
      const id = await auth(req);
      await read();
      return json(res, 200, await actGuild(store, id, 'guild', null, (s, g, now) => ({ reward: opGuildCheckin(s, g, now) })));
    }
    case ROUTES.guildBoss: {
      const id = await auth(req);
      const b = await read();
      const squad = int(b.squad, 'Đội', 0, 100);
      const seed = int(b.seed, 'Hạt giống', 0, SEED_MAX - 1);
      const inputs = parseInputs(b.inputs);
      const auto = b.auto === true;
      if (!takeSeed(id, seed, clock())) throw new HttpError(400, 'Hạt giống trận không hợp lệ hoặc đã hết hạn — hãy bắt đầu trận mới');
      return json(res, 200, (await actGuild(store, id, 'guild-boss', null, (s, g, now) => opGuildBoss(s, g, now, squad, seed, inputs, auto))) satisfies GuildBossRes);
    }
    case ROUTES.guildChat: {
      const id = await auth(req);
      const b = await read();
      if (typeof b.text !== 'string' || b.text.length > GUILD_CHAT_MAX * 4) throw new HttpError(400, 'Tin nhắn không hợp lệ');
      const text = cleanText(b.text);
      if (text.length < 1 || text.length > GUILD_CHAT_MAX) throw new HttpError(400, `Tin nhắn từ 1 đến ${GUILD_CHAT_MAX} ký tự`);
      const nowMs = clock();
      const last = chatLast.get(id);
      if (last !== undefined && nowMs - last < CHAT_MIN_GAP_MS) throw new HttpError(429, 'Bạn nhắn quá nhanh, hãy chậm lại');
      if (chatLast.size > 10_000) chatLast.clear();
      chatLast.set(id, nowMs);
      await store.guildChatPost(id, await usernameOf(id), text, nowMs);
      return json(res, 200, { messages: (await store.guildChat(id, 50)) ?? [] } satisfies GuildChatRes);
    }
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
    case ROUTES.arenaDefense: {
      const id = await auth(req);
      const squad = int((await read()).squad, 'Đội', 0, 100);
      const r = await act(store, id, 'arena-defense', (s) => (opArenaDefense(s, squad), {}));
      arenaVer++;
      return json(res, 200, { me: r.me });
    }
    case ROUTES.arenaBattle: {
      const id = await auth(req);
      const b = await read();
      const oppId = str(b.opponent, 'Đối thủ', 24, 1);
      const squad = int(b.squad, 'Đội', 0, 100);
      const seed = int(b.seed, 'Hạt giống', 0, SEED_MAX - 1);
      const inputs = parseInputs(b.inputs);
      const auto = b.auto === true; // mọi trường khác (vd "win") bị bỏ qua: server tự chạy lại trận
      const bm = /^bot:(\d{1,3})$/.exec(oppId);
      let resolve: Parameters<typeof opArenaBattle>[5];
      if (bm) {
        const n = Number(bm[1]);
        if (String(n) !== bm[1] || n >= BOT_COUNT) throw new HttpError(400, 'Đối thủ không hợp lệ');
        resolve = (rating) => botTarget(n, rating); // dựng lại đúng như danh sách, theo điểm hiện tại của người tấn công
      } else {
        if (!/^[1-9]\d{0,9}$/.test(oppId) || Number(oppId) > 2 ** 31 - 1) throw new HttpError(400, 'Đối thủ không hợp lệ');
        const oid = Number(oppId);
        if (oid === id) throw new HttpError(400, 'Không thể tự đánh chính mình');
        const got = await realTarget(store, oid);
        if (!got) throw new HttpError(404, 'Không tìm thấy đối thủ');
        const target = got.target;
        if (!target) throw new HttpError(400, 'Đối thủ chưa có đội phòng thủ');
        resolve = () => target;
      }
      if (!takeSeed(id, seed, clock())) throw new HttpError(400, 'Hạt giống trận không hợp lệ hoặc đã hết hạn — hãy bắt đầu trận mới');
      const out = await act(store, id, 'arena', (s) => opArenaBattle(s, squad, seed, inputs, auto, resolve));
      arenaVer++;
      return json(res, 200, out);
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
