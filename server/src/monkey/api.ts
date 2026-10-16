// REST của Bầy Khỉ dưới `${MONKEY_BASE}api/*` (xem API trong shared/monkey/api.ts).
// Đăng nhập: header `Authorization: Bearer <token>`. Admin: header `x-admin-key` = MONKEY_ADMIN_KEY
// (không đặt biến này → admin tắt, 403). Mọi route thay đổi trả MutateRes { me }.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { MONKEY_BASE } from '../../../shared/monkey/config.js';
import { API, type EventDef, type EventObjective, type MutateRes } from '../../../shared/monkey/api.js';
import { EVENT_STAGES, ITEM_BY_ID, STAGE_BY_ID, type Rarity, type Reward } from '../../../shared/monkey/progression.js';
import { HttpError, clientIp, createAdminCheck, json, parseJson, readBody } from '../http/util.js';
import { login, logout, register, resolveToken } from './accounts.js';
import { StoreError, storeReady, type Store } from './db/index.js';
import { isCls, isSkill, isSlot } from './db/rules.js';

const PREFIX = `${MONKEY_BASE}api/`;
const MAX_BODY = 16 * 1024;
const MAX_ADMIN_BODY = 64 * 1024;

const checkAdmin = createAdminCheck(() => process.env.MONKEY_ADMIN_KEY || null);

let onlineCounter: () => number = () => 0;
/** index.ts báo số người đang online cho admin/stats */
export function setOnlineCounter(fn: () => number) {
  onlineCounter = fn;
}

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

/** phần thưởng do admin nhập */
export function parseReward(raw: unknown): Reward {
  const r = body(raw);
  const out: Reward = {};
  for (const k of ['gold', 'xp', 'shards', 'books'] as const) if (r[k] !== undefined) out[k] = int(r[k], k, 0, 1_000_000);
  if (r.items !== undefined) {
    if (!Array.isArray(r.items) || r.items.length > 20) throw new HttpError(400, 'Danh sách đồ không hợp lệ');
    out.items = r.items.map((it: unknown) => {
      const o = body(it);
      const def = ITEM_BY_ID[o.itemId];
      if (!def) throw new HttpError(400, `Không có món đồ ${String(o.itemId).slice(0, 30)}`);
      const rarity = int(o.rarity, 'Độ hiếm', 0, 3) as Rarity;
      if (rarity < def.minR || rarity > def.maxR) throw new HttpError(400, `${def.name} chỉ có độ hiếm ${def.minR}–${def.maxR}`);
      return { itemId: def.id, rarity };
    });
  }
  if (r.unlockChar !== undefined) {
    if (!isCls(r.unlockChar)) throw new HttpError(400, 'Nhân vật không hợp lệ');
    out.unlockChar = r.unlockChar;
  }
  return out;
}

const OBJ_KINDS: EventObjective['kind'][] = ['kills', 'clearStage', 'reachWave', 'playRuns'];
/** sự kiện do admin gửi lên */
export function parseEvent(raw: unknown): EventDef {
  const e = body(raw);
  const startsAt = Date.parse(str(e.startsAt, 'Ngày bắt đầu', 40, 1));
  const endsAt = Date.parse(str(e.endsAt, 'Ngày kết thúc', 40, 1));
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw new HttpError(400, 'Ngày giờ không hợp lệ');
  if (endsAt <= startsAt) throw new HttpError(400, 'Ngày kết thúc phải sau ngày bắt đầu');
  let stage: string | undefined;
  if (e.stage !== undefined && e.stage !== null && e.stage !== '') {
    stage = str(e.stage, 'Ải sự kiện', 40);
    if (!EVENT_STAGES.some((s) => s.id === stage)) throw new HttpError(400, 'Ải sự kiện không tồn tại');
  }
  if (!Array.isArray(e.objectives) || e.objectives.length > 12) throw new HttpError(400, 'Danh sách mục tiêu không hợp lệ');
  const ids = new Set<string>();
  const objectives: EventObjective[] = e.objectives.map((raw: unknown) => {
    const o = body(raw);
    const id = str(o.id, 'Mã mục tiêu', 24, 1);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new HttpError(400, 'Mã mục tiêu không hợp lệ hoặc bị trùng');
    ids.add(id);
    if (!OBJ_KINDS.includes(o.kind)) throw new HttpError(400, 'Loại mục tiêu không hợp lệ');
    const obj: EventObjective = { id, kind: o.kind, target: int(o.target, 'Chỉ tiêu', 1, 1_000_000), label: str(o.label, 'Mô tả mục tiêu', 80, 1), reward: parseReward(o.reward) };
    if (o.kind === 'clearStage') {
      const st = str(o.stage, 'Ải của mục tiêu', 40, 1);
      if (!STAGE_BY_ID[st]) throw new HttpError(400, `Không có ải ${st}`);
      obj.stage = st;
    }
    return obj;
  });
  const ev: EventDef = {
    id: e.id === undefined ? 0 : int(e.id, 'id'),
    name: str(e.name, 'Tên sự kiện', 60, 1),
    icon: e.icon === undefined ? '' : str(e.icon, 'Biểu tượng', 16),
    desc: e.desc === undefined ? '' : str(e.desc, 'Mô tả', 500),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    enabled: e.enabled === undefined ? true : !!e.enabled,
    objectives,
  };
  if (stage) ev.stage = stage;
  return ev;
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

async function mutate(store: Store, id: number, granted?: Reward): Promise<MutateRes> {
  const me = await store.me(id, new Date());
  return granted ? { me, granted } : { me };
}

/* ---------------- định tuyến ---------------- */
async function route(req: IncomingMessage, res: ServerResponse, r: string, method: string, query: URLSearchParams) {
  const store = await storeReady();
  const now = () => new Date();
  const post = method === 'POST';
  const read = async (limit = MAX_BODY) => body(parseJson(await readBody(req, limit)));

  // ---- admin ----
  if (r.startsWith('api/admin/')) {
    const denied = checkAdmin(req);
    if (denied) return json(res, denied.status, { error: denied.message });
    if (r === API.adminEvents && method === 'GET') return json(res, 200, { events: await store.listEvents() });
    if (r === API.adminEvents && post) return json(res, 200, { event: await store.saveEvent(parseEvent(await read(MAX_ADMIN_BODY))) });
    if (r === API.adminEventDelete && post) {
      await store.deleteEvent(int((await read()).id, 'id', 1));
      return json(res, 200, { ok: true });
    }
    if (r === API.adminGrant && post) {
      const b = await read();
      const acc = await store.findAccount(str(b.username, 'Tên tài khoản', 40, 1).normalize('NFC'));
      if (!acc) throw new HttpError(404, 'Không tìm thấy tài khoản');
      return json(res, 200, { items: await store.grant(acc.id, parseReward(b.reward)) });
    }
    if (r === API.adminStats && method === 'GET') return json(res, 200, { ...(await store.stats()), online: onlineCounter() });
    throw new HttpError(404, 'Không có API này');
  }

  // ---- công khai ----
  if (r === API.register && post) {
    const b = await read();
    const { token, accountId } = await register(clientIp(req), b.username, b.password);
    return json(res, 200, { token, me: await store.me(accountId, now()) });
  }
  if (r === API.login && post) {
    const b = await read();
    const { token, accountId } = await login(clientIp(req), b.username, b.password);
    return json(res, 200, { token, me: await store.me(accountId, now()) });
  }
  if (r === API.leaderboard && method === 'GET') {
    const stage = query.get('stage') || 'endless';
    if (stage !== 'endless' && !STAGE_BY_ID[stage]) throw new HttpError(400, 'Ải không hợp lệ');
    const solo = query.get('solo') === '1';
    return json(res, 200, { rows: await store.leaderboard(stage, solo, 20) });
  }

  // ---- cần đăng nhập ----
  if (r === API.logout && post) {
    const t = bearer(req);
    if (t) await logout(t);
    return json(res, 200, { ok: true });
  }
  if (r === API.me && method === 'GET') {
    const id = await auth(req);
    return json(res, 200, await store.me(id, now()));
  }
  if (!post) throw new HttpError(404, 'Không có API này');
  const handlers: Record<string, (id: number, b: Record<string, any>) => Promise<Reward | void>> = {
    [API.equip]: (id, b) => store.equip(id, int(b.uid, 'Món đồ', 1)),
    [API.unequip]: (id, b) => {
      if (!isSlot(b.slot)) throw new HttpError(400, 'Ô trang bị không hợp lệ');
      return store.unequip(id, b.slot);
    },
    [API.upgradeItem]: (id, b) => store.upgradeItem(id, int(b.uid, 'Món đồ', 1)),
    [API.salvage]: async (id, b) => {
      if (!Array.isArray(b.uids) || !b.uids.length || b.uids.length > 200) throw new HttpError(400, 'Danh sách đồ không hợp lệ');
      return { gold: await store.salvage(id, b.uids.map((u: unknown) => int(u, 'Món đồ', 1))) };
    },
    [API.unlockChar]: (id, b) => {
      if (!isCls(b.cls)) throw new HttpError(400, 'Nhân vật không hợp lệ');
      return store.unlockChar(id, b.cls);
    },
    [API.selectChar]: (id, b) => {
      if (!isCls(b.cls)) throw new HttpError(400, 'Nhân vật không hợp lệ');
      return store.selectChar(id, b.cls);
    },
    [API.upgradeSkill]: (id, b) => {
      if (!isCls(b.cls) || !isSkill(b.skill)) throw new HttpError(400, 'Kỹ năng không hợp lệ');
      return store.upgradeSkill(id, b.cls, b.skill);
    },
    [API.claimEvent]: (id, b) => store.claimEvent(id, int(b.eventId, 'Sự kiện', 1), str(b.objective, 'Mục tiêu', 24, 1), now()),
  };
  const h = handlers[r];
  if (!h) throw new HttpError(404, 'Không có API này');
  const id = await auth(req);
  const granted = await h(id, await read());
  return json(res, 200, await mutate(store, id, granted || undefined));
}

/** gắn trong network/server.ts TRƯỚC serveMonkey; trả true nếu là route của nó */
export function handleMonkeyApi(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  const path = q >= 0 ? url.slice(0, q) : url;
  if (!path.startsWith(PREFIX)) return false;
  const method = req.method ?? 'GET';
  const r = path.slice(MONKEY_BASE.length).replace(/\/+$/, '');
  const query = new URLSearchParams(q >= 0 ? url.slice(q + 1) : '');
  route(req, res, r, method, query).catch((e) => {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError || e instanceof StoreError) return json(res, e.status, { error: e.message });
    console.error('[monkey-api] lỗi', r, e instanceof Error ? e.message : e);
    json(res, 500, { error: 'Lỗi máy chủ, thử lại sau' });
  });
  return true;
}
