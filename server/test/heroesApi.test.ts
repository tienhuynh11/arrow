// Kiểm thử REST + lớp lưu trữ game Thẻ Tướng (tài khoản dùng chung với Bầy Khỉ).
// Chạy: cd server && npx tsx test/heroesApi.test.ts
// Luôn chạy với MemStore; nếu có DATABASE_URL (biến môi trường hoặc server/.env) chạy thêm một đoạn tích hợp với
// HeroPgStore trên schema tạm test_h_<ngẫu nhiên>, xoá khi xong. Không in chuỗi kết nối.

import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import type { ArenaBattleRes, ArenaRes, ArenaTopRes, BattleRes, MeResponse, SummonRes, SweepRes, AfkClaimRes, LeaderRow, QuestClaimRes, ShopBuyRes, TowerBattleRes } from '../../shared/heroes/api.js';
import { AFK_CAP_MS, SQUAD_SIZE, STAMINA_MAX } from '../../shared/heroes/config.js';
import { DUPE_SHARDS, accountXpToNext, levelCapOf, levelUpCost, levelUpPlan } from '../../shared/heroes/formulas.js';
import { HERO_BY_ID, STARTER_HEROES } from '../../shared/heroes/heroes.js';
import { afkReward } from '../../shared/heroes/stages.js';
import { _resetRateLimits } from '../src/monkey/accounts.js';
import { loadDotEnv, useStore } from '../src/monkey/db/index.js';
import { MemStore } from '../src/monkey/db/memStore.js';
import { PgStore } from '../src/monkey/db/pgStore.js';
import { handleHeroesApi, _resetHeroesApi, _setHeroesClock } from '../src/heroes/api.js';
import { HeroMemStore } from '../src/heroes/db/memStore.js';
import { HeroPgStore } from '../src/heroes/db/pgStore.js';
import { useHeroStore } from '../src/heroes/db/index.js';
import { StoreError } from '../src/heroes/db/store.js';
import { ARENA_OPPONENTS, ARENA_TRIES, arenaReward, ratingDelta } from '../../shared/heroes/arena.js';
import { BOT_COUNT, botOffset, botTarget, bumpQuest, newState, opBattle, opQuestClaim, opShopBuy, opSummon, opTowerBattle, rollDay } from '../src/heroes/rules.js';
import { QUEST_BONUS, QUEST_DEFS, dayKey } from '../../shared/heroes/quests.js';
import { SHOP_ITEMS } from '../../shared/heroes/shop.js';
import { TOWER_MAX_FLOOR, TOWER_TRIES, towerReward } from '../../shared/heroes/tower.js';
import { GEAR_BY_ID, GEAR_CAP, MAX_GEAR_LEVEL, STARTER_GEAR, enhanceCost, salvageStones, sumGear } from '../../shared/heroes/gear.js';
import type { AdminEventsRes, EventClaimRes, EventsRes, GuildBossRes, GuildChatRes, GuildRes, GuildSearchRes } from '../../shared/heroes/api.js';
import { heroUnit, simulate } from '../../shared/heroes/battle.js';
import { EVENT_KINDS, EVENT_MAX_OBJECTIVES, EVENT_NAME_MAX, EVENT_WALLET_CAP, SEED_EVENT, type EventDef } from '../../shared/heroes/events.js';
import {
  BOSS_ATTACKS_PER_DAY, BOSS_CYCLE_DAYS, BOSS_KILL_REWARD, GUILD_CHAT_KEEP, GUILD_CHAT_MAX, GUILD_CREATE_COST, GUILD_DONATE_PER_DAY, GUILD_DONATIONS, GUILD_MAX_LEVEL, GUILD_MAX_MEMBERS,
  GUILD_MIN_ACCOUNT_LEVEL, GUILD_NAME_MAX, GUILD_NOTICE_MAX, GUILD_REJOIN_COOLDOWN_MS, bossAttackReward, bossCycle, bossDamage, bossHpMax, bossLevel, bossName, bossSetup, guildCheckinReward, guildXpToNext,
} from '../../shared/heroes/guild.js';
import { bumpEvents } from '../src/heroes/rules.js';
import { opEventClaim } from '../src/heroes/events.js';
import { opGuildBoss, opGuildCheckin, opGuildCreate, opGuildDonate, opGuildJoin, opGuildLeave, opGuildTransfer } from '../src/heroes/guilds.js';

let fails = 0;
let passes = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (cond) passes++;
  else fails++;
};

const ADMIN_KEY = 'test-admin-key-' + randomBytes(4).toString('hex');
process.env.MONKEY_ADMIN_KEY = ADMIN_KEY;

const mem = new HeroMemStore();
useStore(new MemStore());
useHeroStore(mem);
_resetRateLimits();
_resetHeroesApi();

const server: Server = createServer((req, res) => {
  if (!handleHeroesApi(req, res)) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/heroes/api/`;

interface Resp<T = any> {
  status: number;
  j: T;
}
async function call<T = any>(method: string, route: string, body?: unknown, token?: string, headers: Record<string, string> = {}): Promise<Resp<T>> {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(BASE + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as T };
}
const post = <T = any>(route: string, body: unknown, token?: string, headers?: Record<string, string>) => call<T>('POST', route, body, token, headers);
const getMe = async (token: string) => (await call<MeResponse>('GET', 'me', undefined, token)).j;

async function newUser(name: string) {
  _resetRateLimits(); // giới hạn tạo tài khoản theo IP: test tạo nhiều tài khoản
  const r = await post<{ token: string; me: MeResponse }>('register', { username: name, password: 'matkhau123' });
  return { token: r.j.token, id: r.j.me.profile.id, me: r.j.me, status: r.status };
}
const nowDate = () => new Date();
const edit = <T>(id: number, fn: (s: import('../src/heroes/db/store.js').HState) => T) => mem.mutate(id, nowDate(), 'test', fn);
const walletSum = (m: MeResponse) => Object.values(m.wallet).every((v) => v >= 0);

async function fight(token: string, stage: string, squad = 0, extra: Partial<{ inputs: any[]; auto: boolean }> = {}) {
  const st = await post<{ seed: number; expires: number }>('battle-start', {}, token);
  const r = await post<BattleRes>('battle', { stage, squad, seed: st.j.seed, inputs: extra.inputs ?? [], auto: extra.auto ?? true }, token);
  return { seed: st.j.seed, r };
}

/* ------------------------------------------------------------------ */
console.log('— tài khoản + hồ sơ khởi đầu —');
const unauth = await call('GET', 'me');
ok(unauth.status === 401, 'me không token → 401');
const A = await newUser('nguoiA');
ok(A.status === 200 && A.token.length > 20, 'đăng ký (dùng chung tài khoản Bầy Khỉ) trả token');
ok(A.me.wallet.gold === 5000 && A.me.wallet.gems === 3000 && A.me.wallet.tickets === 10 && A.me.wallet.exp === 500 && A.me.wallet.stones === 0, 'ví khởi đầu 5000/3000/10/500/0');
ok(A.me.heroes.length === STARTER_HEROES.length && A.me.heroes.every((h) => h.level === 1 && h.star === 1 && h.shards === 0), 'tướng khởi đầu cấp 1, 1 sao');
ok(JSON.stringify(A.me.squads[0].filter(Boolean)) === JSON.stringify(STARTER_HEROES) && A.me.squads[0].length === SQUAD_SIZE && A.me.squads.length === 3, 'đội 0 = tướng khởi đầu theo thứ tự ô');
ok(A.me.profile.stamina === STAMINA_MAX && A.me.profile.level === 1 && A.me.activeSquad === 0, 'thể lực đầy, cấp 1, đội 0');
const me2 = await getMe(A.token);
ok(me2.heroes.length === A.me.heroes.length && me2.wallet.gold === 5000, 'gọi me lần nữa không cấp thêm');
const lg = await post<{ token: string; me: MeResponse }>('login', { username: 'nguoiA', password: 'matkhau123' });
ok(lg.status === 200 && lg.j.me.profile.id === A.id && (await call('GET', 'me', undefined, lg.j.token)).status === 200, 'đăng nhập cùng tài khoản, token dùng được');
ok((await post('login', { username: 'nguoiA', password: 'sai-mat-khau' })).status === 401, 'sai mật khẩu → 401');
ok(mem.ledger.some((l) => l.accountId === A.id && l.kind === 'starter'), 'ledger ghi dòng starter');

/* ------------------------------------------------------------------ */
console.log('— triệu hồi —');
const S = (token: string, o: Partial<{ banner: string; count: number; pay: string; key: string }> = {}) =>
  post<SummonRes>('summon', { banner: 'standard', count: 1, pay: 'tickets', key: 'k-' + randomBytes(6).toString('hex'), ...o }, token);

let r = await S(A.token);
ok(r.status === 200 && r.j.pulls.length === 1 && r.j.me.wallet.tickets === 9, 'x1 vé: trừ 1 vé');
r = await S(A.token, { count: 10 });
ok(r.status === 400 && (await getMe(A.token)).wallet.tickets === 9, 'còn 9 vé: x10 vé bị từ chối, vé giữ nguyên');

const B = await newUser('nguoiB');
let rb = await S(B.token, { count: 10 });
ok(rb.status === 200 && rb.j.me.wallet.tickets === 0 && rb.j.pulls.length === 10, 'B: x10 bằng đúng 10 vé còn 0');
ok(rb.j.pulls.some((p) => p.rarity !== 'R'), 'x10 luôn có ít nhất SR');
rb = await S(B.token, { count: 10 });
ok(rb.status === 400 && (await getMe(B.token)).wallet.tickets === 0, 'B: thiếu vé → 400, vé không âm');
rb = await S(B.token, { count: 10, pay: 'gems' });
ok(rb.status === 200 && rb.j.me.wallet.gems === 300, 'B: x10 kim cương 2700 → còn 300');
rb = await S(B.token, { pay: 'gems' });
ok(rb.status === 200 && rb.j.me.wallet.gems === 0, 'B: x1 kim cương 300 → còn 0');
rb = await S(B.token, { pay: 'gems' });
ok(rb.status === 400 && walletSum(await getMe(B.token)), 'B: hết kim cương → 400, ví không âm');
ok((await S(B.token, { banner: 'khong-co' })).status === 404, 'banner lạ → 404');
ok((await S(B.token, { count: 5 })).status === 400, 'count lạ → 400');
ok((await S(B.token, { key: 'ab' })).status === 400, 'key quá ngắn → 400');

const C = await newUser('nguoiC');
const beforeC = (await getMe(C.token)).wallet.tickets;
const key = 'idem-' + randomBytes(6).toString('hex');
const c1 = await S(C.token, { key });
const c2 = await S(C.token, { key });
ok(c1.status === 200 && c2.status === 200 && JSON.stringify(c1.j.pulls) === JSON.stringify(c2.j.pulls), 'gửi trùng key → cùng kết quả');
ok((await getMe(C.token)).wallet.tickets === beforeC - 1, 'gửi trùng key chỉ trừ vé một lần');
ok((await S(C.token, { key, count: 10 })).status === 409, 'cùng key khác tham số → 409');
const key2 = 'idem-' + randomBytes(6).toString('hex');
const [p1, p2] = await Promise.all([S(C.token, { key: key2 }), S(C.token, { key: key2 })]);
ok(p1.status === 200 && p2.status === 200 && JSON.stringify(p1.j.pulls) === JSON.stringify(p2.j.pulls) && (await getMe(C.token)).wallet.tickets === beforeC - 2, 'hai yêu cầu song song cùng key chỉ trừ một lần');
ok(mem.ledger.some((l) => l.accountId === C.id && l.kind === 'summon' && l.delta.tickets === -1), 'ledger ghi dòng summon với delta vé');

// trùng tướng → mảnh, pity
await post('admin/grant', { username: 'nguoiC', gems: 100000, gold: 10_000_000, exp: 1_000_000 }, undefined, { 'x-admin-key': ADMIN_KEY });
let dupOk = true;
const base = await getMe(C.token);
let dupShards = base.heroes.reduce((a, h) => a + h.shards, 0);
let sawUR = false;
const owned = new Set(base.heroes.map((h) => h.id));
for (let i = 0; i < 10; i++) {
  const x = await S(C.token, { count: 10, pay: 'gems' });
  if (x.status !== 200) {
    dupOk = false;
    break;
  }
  for (const p of x.j.pulls) {
    if (p.rarity === 'UR') sawUR = true;
    const had = owned.has(p.heroId);
    owned.add(p.heroId);
    if (p.isNew === had) dupOk = false;
    if (!p.isNew) {
      if (p.shards !== DUPE_SHARDS[p.rarity]) dupOk = false;
      dupShards += p.shards;
    } else if (p.shards !== 0) dupOk = false;
  }
}
const meC = await getMe(C.token);
ok(dupOk, 'mỗi lượt: isNew khớp việc đã sở hữu, trùng → đúng DUPE_SHARDS');
ok(meC.heroes.reduce((a, h) => a + h.shards, 0) === dupShards && meC.heroes.length === owned.size, 'tổng mảnh và số tướng khớp các lượt quay');
ok(sawUR && (meC.pity.standard?.sinceUR ?? 99) < 90, '100 lượt có UR (pity 90), pity theo banner được lưu');
ok(walletSum(meC), 'ví không âm sau 100 lượt');

/* ------------------------------------------------------------------ */
console.log('— nâng cấp cấp / sao —');
const LV = (token: string, hero: string) => post<{ me: MeResponse }>('level-up', { hero }, token);
const ST = (token: string, hero: string) => post<{ me: MeResponse }>('star-up', { hero }, token);
const hero0 = STARTER_HEROES[0];
await edit(C.id, (s) => (s.heroes[hero0].shards = 0)); // quay trùng có thể đã cho mảnh
const meC2 = await getMe(C.token);
let lv = await LV(C.token, hero0);
ok(lv.status === 200 && lv.j.me.heroes.find((h) => h.id === hero0)!.level === 2 && lv.j.me.wallet.gold === meC2.wallet.gold - 160 && lv.j.me.wallet.exp === meC2.wallet.exp - 30, 'lên cấp 1→2 tốn 160 vàng, 30 EXP');
let last = lv;
for (let i = 0; i < 40 && last.status === 200; i++) last = await LV(C.token, hero0);
const capNow = (await getMe(C.token)).heroes.find((h) => h.id === hero0)!;
ok(capNow.level === levelCapOf(1) && last.status === 400, `dừng ở trần cấp theo sao (${levelCapOf(1)}) → 400`);
ok((await ST(C.token, hero0)).status === 400, 'thiếu mảnh → không lên sao được');
await edit(C.id, (s) => (s.heroes[hero0].shards = 19));
ok((await ST(C.token, hero0)).status === 400 && (await getMe(C.token)).heroes.find((h) => h.id === hero0)!.star === 1, '19/20 mảnh vẫn bị từ chối');
await edit(C.id, (s) => (s.heroes[hero0].shards = 25));
const su = await ST(C.token, hero0);
const h2 = su.j.me.heroes.find((h) => h.id === hero0)!;
ok(su.status === 200 && h2.star === 2 && h2.shards === 5, 'đủ mảnh: lên 2 sao, trừ 20 mảnh');
ok((await LV(C.token, hero0)).status === 200, 'lên sao mở thêm trần cấp');
ok((await LV(C.token, 'khong-co-tuong')).status === 400, 'tướng lạ → 400');
const missing = Object.keys(HERO_BY_ID).find((id) => !STARTER_HEROES.includes(id))!;
const Z = await newUser('nguoiZ'); // chỉ có tướng khởi đầu
ok((await LV(Z.token, missing)).status === 400 && (await ST(Z.token, missing)).status === 400, 'tướng chưa sở hữu (của người khác) → 400');
await edit(C.id, (s) => (s.wallet.gold = 0));
const gBefore = (await getMe(C.token)).heroes.find((h) => h.id === hero0)!.level;
const broke = await LV(C.token, hero0);
const mBroke = await getMe(C.token);
ok(broke.status === 400 && mBroke.wallet.gold === 0 && mBroke.heroes.find((h) => h.id === hero0)!.level === gBefore, 'thiếu vàng → 400, không đổi cấp, ví không âm');
// nâng nhiều cấp một lần
{
  const LVn = (times: unknown) => post<{ me: MeResponse; gained: number }>('level-up', { hero: hero0, times }, C.token);
  await edit(C.id, (s) => ((s.heroes[hero0].level = 1), (s.heroes[hero0].star = 3), (s.wallet.gold = 100000), (s.wallet.exp = 100000)));
  const b0 = await getMe(C.token);
  const r5 = await LVn(5);
  let gold5 = 0, exp5 = 0;
  for (let l = 1; l < 6; l++) (gold5 += levelUpCost(l).gold), (exp5 += levelUpCost(l).exp);
  ok(r5.status === 200 && r5.j.gained === 5 && r5.j.me.heroes.find((h) => h.id === hero0)!.level === 6, 'times=5: nâng đúng 5 cấp trong một lần gọi');
  ok(r5.j.me.wallet.gold === b0.wallet.gold - gold5 && r5.j.me.wallet.exp === b0.wallet.exp - exp5, 'times=5: trừ đúng tổng chi phí 5 cấp');
  // hết tiền giữa chừng: dừng êm, nâng được bao nhiêu hay bấy nhiêu
  await edit(C.id, (s) => ((s.heroes[hero0].level = 1), (s.wallet.gold = levelUpCost(1).gold + levelUpCost(2).gold + 5), (s.wallet.exp = 100000)));
  const rp = await LVn(10);
  ok(rp.status === 200 && rp.j.gained === 2 && rp.j.me.wallet.gold === 5, 'hết vàng giữa chừng: nâng 2 cấp rồi dừng, ví không âm');
  // chạm trần cấp theo sao
  await edit(C.id, (s) => ((s.heroes[hero0].level = 1), (s.heroes[hero0].star = 1), (s.wallet.gold = 1_000_000), (s.wallet.exp = 1_000_000)));
  const rc = await LVn(60);
  ok(rc.status === 200 && rc.j.me.heroes.find((h) => h.id === hero0)!.level === levelCapOf(1), 'times=60: dừng ở trần cấp của sao');
  ok((await LVn(0)).status === 400 && (await LVn(61)).status === 400 && (await LVn('3')).status === 400, 'times ngoài 1..60 hoặc sai kiểu → 400');
  ok((await LVn(1)).status === 400, 'đã chạm trần → 400');
  const plan = levelUpPlan(1, 1, 1_000_000, 1_000_000);
  ok(plan.n === levelCapOf(1) - 1, 'levelUpPlan khớp trần cấp');
}
await edit(C.id, (s) => (s.wallet.gold = 1_000_000));
for (let i = 0; i < 5; i++) await ST(C.token, hero0);
ok(walletSum(await getMe(C.token)), 'ví không âm');
const hMax = (await getMe(C.token)).heroes.find((h) => h.id === hero0)!;
ok(hMax.star <= 5, 'sao không vượt 5');

/* ------------------------------------------------------------------ */
console.log('— đội hình —');
const SQ = (token: string, body: any) => post<{ me: MeResponse }>('set-squad', body, token);
const [h0, h1] = STARTER_HEROES;
let q = await SQ(Z.token, { squad: 1, slots: [h1, '', h0, '', ''], active: true });
ok(q.status === 200 && q.j.me.squads[1][0] === h1 && q.j.me.squads[1][2] === h0 && q.j.me.activeSquad === 1, 'đặt đội 1 và đặt làm đội đang dùng');
ok((await SQ(Z.token, { squad: 1, slots: [missing, '', '', '', ''] })).status === 400, 'tướng chưa sở hữu → từ chối');
ok((await SQ(Z.token, { squad: 1, slots: [h0, h0, '', '', ''] })).status === 400, 'trùng tướng → từ chối');
ok((await SQ(Z.token, { squad: 1, slots: [h0, '', ''] })).status === 400, 'sai số ô → từ chối');
ok((await SQ(Z.token, { squad: 3, slots: ['', '', '', '', ''] })).status === 400, 'đội ngoài phạm vi → từ chối');
ok((await SQ(Z.token, { squad: 1, slots: ['', '', '', '', ''], active: true })).status === 400, 'đội đang dùng không được rỗng');
ok((await SQ(Z.token, { squad: 2, slots: ['', '', '', '', ''] })).status === 200, 'đội dự phòng được để trống');
const mB = await getMe(Z.token);
ok(mB.squads[1][0] === h1 && mB.activeSquad === 1, 'lỗi không làm thay đổi đội cũ');

/* ------------------------------------------------------------------ */
console.log('— trận đánh —');
const D = await newUser('nguoiD');
const E = await newUser('nguoiE');
ok((await post('battle', { stage: '1-1', squad: 0, seed: 123456, inputs: [], auto: true }, D.token)).status === 400, 'seed chưa được cấp → từ chối');
const sd = await post<{ seed: number; expires: number }>('battle-start', {}, D.token);
ok(sd.status === 200 && Number.isInteger(sd.j.seed) && sd.j.expires > Date.now() + 9 * 60_000 && sd.j.expires <= Date.now() + 10 * 60_000 + 1000, 'battle-start cấp seed hạn ~10 phút');
ok((await post('battle', { stage: '1-1', squad: 0, seed: (sd.j.seed + 1) % 2 ** 32, inputs: [], auto: true }, D.token)).status === 400, 'seed khác seed đã cấp → từ chối');
const se = await post<{ seed: number }>('battle-start', {}, E.token);
// E xin seed thì D cũng không dùng được seed của E (map theo tài khoản)
ok((await post('battle', { stage: '1-1', squad: 0, seed: se.j.seed, inputs: [], auto: true }, D.token)).status === 400 || se.j.seed === sd.j.seed, 'seed của người khác → từ chối');
// đầu vào giả
const sdT = await post<{ seed: number }>('battle-start', {}, D.token);
const badIn = [
  [{ tick: -1 }], [{ tick: 5, ult: 99 }], [{ tick: 5, ult: 1.5 }], [{ tick: 99999999 }], [{ tick: 5, auto: 'yes' }],
  Array.from({ length: 300 }, (_, i) => ({ tick: i })), 'chuoi', [null],
];
let allBad = true;
for (const inputs of badIn) {
  const x = await post('battle', { stage: '1-1', squad: 0, seed: sdT.j.seed, inputs, auto: true }, D.token);
  if (x.status !== 400) allBad = false;
}
ok(allBad, 'input giả (tick âm, tuyệt kỹ ô 99, quá nhiều hành động, sai kiểu) → 400');
// seed vẫn còn nguyên sau khi bị từ chối vì dữ liệu sai → dùng được đúng một lần
const walletD0 = (await getMe(D.token)).wallet;
const w1 = await post<BattleRes>('battle', { stage: '1-1', squad: 0, seed: sdT.j.seed, inputs: [{ tick: 40, ult: 0 }, { tick: 60, auto: true }], auto: false }, D.token);
ok(w1.status === 200 && typeof w1.j.win === 'boolean', 'seed hợp lệ dùng được');
ok((await post('battle', { stage: '1-1', squad: 0, seed: sdT.j.seed, inputs: [], auto: true }, D.token)).status === 400, 'seed dùng lại lần hai → từ chối (dùng một lần)');
ok((await post('battle', { stage: '1-1', squad: 0, seed: sdT.j.seed, inputs: [], auto: true })).status === 401, 'không token → 401');

// kết quả do server tính; client không gửi được "thắng"
const sForge = await post<{ seed: number }>('battle-start', {}, D.token);
const forged = await post<BattleRes>('battle', { stage: '1-1', squad: 0, seed: sForge.j.seed, inputs: [], auto: true, win: true, stars: 3, reward: { gold: 999999 } }, D.token);
const mAfterForge = await getMe(D.token);
ok(forged.status === 200 && mAfterForge.wallet.gold - (w1.j.me.wallet.gold) <= 100 && forged.j.reward.gold <= 100, 'trường win/stars/reward do client gửi bị bỏ qua');

// ổ khoá ải
const fresh = await newUser('nguoiF');
const locked = await fight(fresh.token, '1-2');
ok(locked.r.status === 403, 'ải 1-2 bị khoá khi chưa qua 1-1 → 403');
ok((await fight(fresh.token, '3-10')).r.status === 403, 'nhảy cóc tới ải cuối → 403');
ok((await fight(fresh.token, '9-9')).r.status === 404, 'ải không tồn tại → 404');
ok((await fight(fresh.token, '1-1', 2)).r.status === 400, 'đội rỗng → 400 (server dựng đội từ DB)');

// thắng 1-1: thưởng + sao + lên cấp
const G = await newUser('nguoiG');
const g0 = (await getMe(G.token)).wallet;
await edit(G.id, (s) => (s.xp = accountXpToNext(1) - 1));
let win = await fight(G.token, '1-1');
for (let i = 0; i < 4 && win.r.status === 200 && !win.r.j.win; i++) win = await fight(G.token, '1-1'); // đội cấp 1 hầu như luôn thắng; thử lại phòng khi thua
ok(win.r.status === 200 && win.r.j.win, 'đội tân binh thắng ải 1-1');
if (win.r.j.win) {
  const m = win.r.j.me;
  ok(win.r.j.reward.firstClear && win.r.j.reward.gold === 100 && win.r.j.reward.gems === 30 && m.wallet.gems === g0.gems + 30, 'lần đầu: thưởng vàng + 30 kim cương');
  ok(win.r.j.levelUp && m.profile.level === 2, 'đủ XP → lên cấp tài khoản');
  const p = m.progress.find((x) => x.stage === '1-1')!;
  ok(p.stars === win.r.j.stars && p.clears >= 1 && win.r.j.stars >= 1, 'ghi sao + lượt qua ải');
  ok(mem.runs.some((x) => x.accountId === G.id && x.stage === '1-1' && x.win), 'ghi h_runs');
  const gemsBefore = m.wallet.gems;
  const again = await fight(G.token, '1-1');
  if (again.r.j.win) ok(!again.r.j.reward.firstClear && again.r.j.reward.gems === 0 && again.r.j.me.wallet.gems === gemsBefore, 'lần sau: không thưởng kim cương nữa');
  const unlocked = await fight(G.token, '1-2');
  ok(unlocked.r.status === 200, 'qua 1-1 → mở ải 1-2');
}
// sao chỉ tăng, không giảm
await edit(G.id, (s) => (s.progress['1-1'].stars = 3));
const keep = await fight(G.token, '1-1');
ok(keep.r.status === 200 && keep.r.j.me.progress.find((x) => x.stage === '1-1')!.stars === 3, 'đã 3 sao thì thắng lại không bị hạ sao');
await edit(G.id, (s) => (s.progress['1-1'].stars = 1));
const up = await fight(G.token, '1-1');
const sNow = up.r.j.me.progress.find((x) => x.stage === '1-1')!.stars;
ok(up.r.status === 200 && sNow === Math.max(1, up.r.j.win ? up.r.j.stars : 0), 'sao chỉ cập nhật khi tốt hơn (max)');
// thua không có thưởng
await edit(G.id, (s) => {
  for (const h of Object.values(s.heroes)) h.level = 1;
});
// đội yếu thua ải cao: mở khoá giả lập rồi cho đội chỉ 1 tướng đánh ải 3-10
await edit(G.id, (s) => {
  for (let i = 0; i < 29; i++) s.progress[`${Math.floor(i / 10) + 1}-${(i % 10) + 1}`] = { stage: `${Math.floor(i / 10) + 1}-${(i % 10) + 1}`, stars: 1, clears: 1 };
  s.squads[1] = [STARTER_HEROES[0], '', '', '', ''];
});
const gw = (await getMe(G.token)).wallet;
const lose = await fight(G.token, '3-10', 1);
ok(lose.r.status === 200 && !lose.r.j.win && lose.r.j.stars === 0 && lose.r.j.reward.gold === 0 && lose.r.j.me.wallet.gold === gw.gold, 'thua: không thưởng, 0 sao');
ok(mem.runs.some((x) => x.accountId === G.id && x.stage === '3-10' && !x.win), 'trận thua vẫn ghi h_runs');

/* ------------------------------------------------------------------ */
console.log('— quét ải —');
const H = await newUser('nguoiH');
const SW = (token: string, stage: string, times: number) => post<SweepRes>('sweep', { stage, times }, token);
ok((await SW(H.token, '1-1', 1)).status === 400, 'chưa qua ải → không quét');
await edit(H.id, (s) => (s.progress['1-1'] = { stage: '1-1', stars: 2, clears: 1 }));
ok((await SW(H.token, '1-1', 1)).status === 400, 'ải mới 2 sao → không quét');
await edit(H.id, (s) => (s.progress['1-1'].stars = 3));
const hg = (await getMe(H.token)).wallet;
const sw = await SW(H.token, '1-1', 2);
ok(sw.status === 200 && sw.j.reward.gold === 200 && sw.j.me.wallet.gold === hg.gold + 200 && sw.j.me.wallet.exp === hg.exp + 30, 'quét x2: thưởng nhân đôi');
ok(sw.j.me.profile.stamina === STAMINA_MAX - 12, 'quét x2 tốn 12 thể lực');
ok((await SW(H.token, '1-1', 0)).status === 400 && (await SW(H.token, '1-1', 11)).status === 400, 'số lần quét ngoài 1..10 → 400');
ok((await SW(H.token, '9-9', 1)).status === 404, 'ải lạ → 404');
await edit(H.id, (s) => {
  s.stamina = 5;
  s.staminaAt = Date.now();
});
const poor = await SW(H.token, '1-1', 1);
ok(poor.status === 400 && (await getMe(H.token)).profile.stamina === 5, 'thiếu thể lực → 400, thể lực không đổi');
await edit(H.id, (s) => {
  s.stamina = 5;
  s.staminaAt = Date.now() - 6 * 60_000 * 3; // 3 điểm hồi
});
ok((await getMe(H.token)).profile.stamina === 8, 'thể lực hồi theo thời gian (tính lười)');
await edit(H.id, (s) => {
  s.stamina = STAMINA_MAX - 1;
  s.staminaAt = Date.now() - 100 * 60 * 60_000;
});
ok((await getMe(H.token)).profile.stamina === STAMINA_MAX, 'thể lực không vượt trần');
const full = await SW(H.token, '1-1', 10);
ok(full.status === 200 && full.j.me.profile.stamina === STAMINA_MAX - 60, 'quét x10 tốn 60 thể lực');

/* ------------------------------------------------------------------ */
console.log('— AFK —');
const I = await newUser('nguoiI');
const fresh0 = await getMe(I.token);
ok(fresh0.afk.pending.gold < 5 && Math.abs(fresh0.afk.since - Date.now()) < 5000, 'AFK vừa tạo: gần như 0');
await edit(I.id, (s) => (s.afkSince = Date.now() - 30 * 3_600_000));
const capped = await getMe(I.token);
const want = afkReward(-1, AFK_CAP_MS);
ok(capped.afk.pending.gold === want.gold && capped.afk.pending.exp === want.exp && want.gold > 0, 'AFK 30 giờ chỉ tính tối đa 12 giờ');
const g1 = capped.wallet.gold;
const cl = await post<AfkClaimRes>('afk-claim', {}, I.token);
ok(cl.status === 200 && cl.j.reward.gold === want.gold && cl.j.me.wallet.gold === g1 + want.gold && cl.j.me.wallet.exp === capped.wallet.exp + want.exp, 'nhận AFK cộng đúng vàng + EXP');
ok(Math.abs(cl.j.me.afk.since - Date.now()) < 5000 && cl.j.me.afk.pending.gold < 5, 'nhận xong mốc AFK được đặt lại');
const cl2 = await post<AfkClaimRes>('afk-claim', {}, I.token);
ok(cl2.status === 200 && cl2.j.reward.gold < 5, 'nhận ngay lần nữa gần như không có gì (không nhận kép)');
await edit(I.id, (s) => {
  s.progress['1-1'] = { stage: '1-1', stars: 1, clears: 1 };
  s.progress['1-5'] = { stage: '1-5', stars: 1, clears: 1 };
  s.afkSince = Date.now() - 2 * 3_600_000;
});
const hi = await getMe(I.token);
const want2 = afkReward(4, 2 * 3_600_000);
ok(Math.abs(hi.afk.pending.gold - want2.gold) <= 2, 'AFK tỉ lệ theo ải cao nhất đã qua');

/* ------------------------------------------------------------------ */
console.log('— bảng xếp hạng —');
const lb = await call<{ rows: LeaderRow[] }>('GET', 'leaderboard');
ok(lb.status === 200 && lb.j.rows.length >= 2, 'leaderboard công khai, có dòng');
ok(lb.j.rows[0].username === 'nguoiG' && lb.j.rows[0].stage === 28, 'xếp theo ải cao nhất (G đã qua tới 3-9 = index 28)');
ok(lb.j.rows.every((x, i, a) => i === 0 || a[i - 1].stage > x.stage || (a[i - 1].stage === x.stage && a[i - 1].stars >= x.stars)), 'thứ tự: ải rồi sao');

/* ------------------------------------------------------------------ */
console.log('— admin grant —');
const GR = (body: unknown, key?: string) => post<{ me: MeResponse }>('admin/grant', body, undefined, key === undefined ? {} : { 'x-admin-key': key });
const j0 = await newUser('nguoiJ');
ok((await GR({ username: 'nguoiJ', gold: 5 })).status === 403, 'thiếu khoá admin → 403');
ok((await GR({ username: 'nguoiJ', gold: 5 }, 'sai-khoa')).status === 403, 'sai khoá admin → 403');
ok((await getMe(j0.token)).wallet.gold === 5000, 'bị từ chối thì không cộng gì');
const gr = await GR({ username: 'nguoiJ', gold: 100, gems: 7, tickets: 3, exp: 11, stones: 2, hero: 'hau_vuong' }, ADMIN_KEY);
ok(gr.status === 200 && gr.j.me.wallet.gold === 5100 && gr.j.me.wallet.gems === 3007 && gr.j.me.wallet.tickets === 13 && gr.j.me.wallet.exp === 511 && gr.j.me.wallet.stones === 2, 'đúng khoá: cộng tiền');
ok(gr.j.me.heroes.some((h) => h.id === 'hau_vuong'), 'tặng được tướng');
const gr2 = await GR({ username: 'nguoiJ', hero: 'hau_vuong' }, ADMIN_KEY);
ok(gr2.j.me.heroes.find((h) => h.id === 'hau_vuong')!.shards === DUPE_SHARDS[HERO_BY_ID['hau_vuong'].rarity], 'tặng tướng đã có → đổi ra mảnh');
ok((await GR({ username: 'khong-ai', gold: 1 }, ADMIN_KEY)).status === 404, 'tài khoản lạ → 404');
ok((await GR({ username: 'nguoiJ', gold: -5 }, ADMIN_KEY)).status === 400, 'số âm → 400');
ok((await GR({ username: 'nguoiJ', hero: 'tuong-la' }, ADMIN_KEY)).status === 400, 'tướng lạ → 400');
ok(mem.ledger.some((l) => l.accountId === j0.id && l.kind === 'admin'), 'ledger ghi dòng admin');
delete process.env.MONKEY_ADMIN_KEY;
ok((await GR({ username: 'nguoiJ', gold: 1 }, ADMIN_KEY)).status === 403, 'không đặt MONKEY_ADMIN_KEY → admin tắt');
process.env.MONKEY_ADMIN_KEY = ADMIN_KEY;

/* ------------------------------------------------------------------ */
console.log('— trang bị —');
{
  const GE = (token: string, uid: number, hero: string) => post<{ me: MeResponse }>('gear-equip', { uid, hero }, token);
  const GU = (token: string, uid: number) => post<{ me: MeResponse }>('gear-unequip', { uid }, token);
  const GP = (token: string, uid: number, times?: number) => post<{ me: MeResponse; gained: number }>('gear-upgrade', times === undefined ? { uid } : { uid, times }, token);
  const GS = (token: string, uids: unknown) => post<{ me: MeResponse; stones: number }>('gear-salvage', { uids }, token);
  const giveGear = (id: number, defs: string[]) => edit(id, (s) => void s.newGear.push(...defs));
  const [hA, hB] = STARTER_HEROES;

  const K = await newUser('nguoiK');
  const gk = K.me.gear;
  ok(gk.length === STARTER_GEAR.length && gk.every((g) => g.level === 0 && g.hero === null) && JSON.stringify(gk.map((g) => g.def)) === JSON.stringify(STARTER_GEAR), 'tài khoản mới có đúng quà khởi đầu, chưa mặc, cấp 0');
  ok(gk.every((g, i, a) => i === 0 || a[i - 1].uid < g.uid) && new Set(gk.map((g) => g.uid)).size === gk.length, 'uid tăng dần, không trùng');
  ok((await getMe(K.token)).gear.length === gk.length, 'gọi me lại không cấp thêm quà');
  const [wpn, arm, hel] = gk;
  const U = await newUser('nguoiU');
  ok(U.me.gear.every((g) => !gk.some((x) => x.uid === g.uid)), 'uid khác tài khoản không đụng nhau');

  // mặc / tháo / thay ô / chuyển tướng
  let r = await GE(K.token, wpn.uid, hA);
  ok(r.status === 200 && r.j.me.gear.find((g) => g.uid === wpn.uid)!.hero === hA, 'mặc vũ khí cho tướng');
  await giveGear(K.id, ['weapon_water_SR', 'weapon_earth_SSR']);
  const gk2 = (await getMe(K.token)).gear;
  const w2 = gk2.find((g) => g.def === 'weapon_water_SR')!;
  const w3 = gk2.find((g) => g.def === 'weapon_earth_SSR')!;
  ok(gk2.length === 6 && w2.uid > wpn.uid, 'món mới được cấp uid sau món cũ');
  r = await GE(K.token, w2.uid, hA);
  ok(r.status === 200 && r.j.me.gear.find((g) => g.uid === w2.uid)!.hero === hA && r.j.me.gear.find((g) => g.uid === wpn.uid)!.hero === null, 'mặc món cùng ô: món cũ về kho');
  await GE(K.token, arm.uid, hA);
  await GE(K.token, hel.uid, hA);
  ok((await getMe(K.token)).gear.filter((g) => g.hero === hA).length === 3, 'một tướng mặc được nhiều ô khác nhau');
  r = await GE(K.token, w2.uid, hB);
  ok(r.status === 200 && r.j.me.gear.find((g) => g.uid === w2.uid)!.hero === hB && r.j.me.gear.filter((g) => g.hero === hA && g.def.startsWith('weapon')).length === 0, 'món đang ở tướng khác: chuyển sang tướng mới, tướng cũ mất');
  r = await GE(K.token, w3.uid, hB);
  ok(r.j.me.gear.filter((g) => g.hero === hB).length === 1 && r.j.me.gear.find((g) => g.uid === w2.uid)!.hero === null, 'thay món cùng ô ở tướng đích');
  r = await GU(K.token, w3.uid);
  ok(r.status === 200 && r.j.me.gear.find((g) => g.uid === w3.uid)!.hero === null, 'tháo món về kho');
  ok((await GU(K.token, w3.uid)).status === 200, 'tháo món đã trong kho: không lỗi');

  // quyền sở hữu
  const gu = U.me.gear[0];
  ok((await GE(K.token, gu.uid, hA)).status === 404, 'mặc đồ của người khác → 404');
  ok((await GU(K.token, gu.uid)).status === 404 && (await getMe(U.token)).gear.find((g) => g.uid === gu.uid)!.hero === null, 'tháo đồ người khác → 404, không đổi gì');
  ok((await GP(K.token, gu.uid)).status === 404 && (await GS(K.token, [gu.uid])).status === 404, 'cường hoá / phân rã đồ người khác → 404');
  ok((await GE(K.token, wpn.uid, missing)).status === 400, 'mặc cho tướng chưa sở hữu → 400');
  ok((await GE(K.token, 987654, hA)).status === 404, 'uid không tồn tại → 404');
  ok((await post('gear-equip', { uid: 'x', hero: hA }, K.token)).status === 400 && (await post('gear-equip', { uid: 1.5, hero: hA }, K.token)).status === 400 && (await post('gear-equip', { hero: hA }, K.token)).status === 400, 'uid sai kiểu → 400');
  ok((await post('gear-equip', { uid: wpn.uid, hero: hA })).status === 401, 'không token → 401');

  // cường hoá (arm: giáp R đang mặc, cấp 0)
  const rar = 'R' as const;
  await edit(K.id, (s) => ((s.wallet.gold = 100000), (s.wallet.stones = 100)));
  let up = await GP(K.token, arm.uid);
  const c0 = enhanceCost(rar, 0)!;
  ok(up.status === 200 && up.j.gained === 1 && up.j.me.gear.find((g) => g.uid === arm.uid)!.level === 1 && up.j.me.wallet.gold === 100000 - c0.gold && up.j.me.wallet.stones === 100 - c0.stones, 'nâng 1 cấp: trừ đúng vàng + đá');
  const before = up.j.me.wallet;
  up = await GP(K.token, arm.uid, 4);
  let g4 = 0, s4 = 0;
  for (let l = 1; l < 5; l++) (g4 += enhanceCost(rar, l)!.gold), (s4 += enhanceCost(rar, l)!.stones);
  ok(up.j.gained === 4 && up.j.me.gear.find((g) => g.uid === arm.uid)!.level === 5 && up.j.me.wallet.gold === before.gold - g4 && up.j.me.wallet.stones === before.stones - s4, 'times=4: trừ đúng tổng chi phí 4 cấp');
  // hết tiền giữa chừng
  await edit(K.id, (s) => ((s.wallet.gold = enhanceCost(rar, 5)!.gold + enhanceCost(rar, 6)!.gold + 3), (s.wallet.stones = enhanceCost(rar, 5)!.stones + enhanceCost(rar, 6)!.stones + 1)));
  up = await GP(K.token, arm.uid, 10);
  ok(up.status === 200 && up.j.gained === 2 && up.j.me.gear.find((g) => g.uid === arm.uid)!.level === 7 && up.j.me.wallet.gold === 3 && up.j.me.wallet.stones === 1 && walletSum(up.j.me), 'hết tiền giữa chừng: dừng êm, ví không âm');
  up = await GP(K.token, arm.uid);
  const mPoor = await getMe(K.token);
  ok(up.status === 400 && mPoor.gear.find((g) => g.uid === arm.uid)!.level === 7 && mPoor.wallet.gold === 3 && mPoor.wallet.stones === 1, 'không đủ cho cấp đầu → 400, không đổi gì');
  await edit(K.id, (s) => ((s.wallet.gold = 1_000_000), (s.wallet.stones = 1000)));
  up = await GP(K.token, arm.uid, 10);
  ok(up.status === 200 && up.j.gained === 3 && up.j.me.gear.find((g) => g.uid === arm.uid)!.level === MAX_GEAR_LEVEL, 'times lớn: dừng ở cấp tối đa');
  const wMax = up.j.me.wallet;
  ok((await GP(K.token, arm.uid)).status === 400 && (await getMe(K.token)).wallet.gold === wMax.gold, 'cấp tối đa → 400, không trừ tiền');
  ok((await GP(K.token, wpn.uid, 0)).status === 400 && (await GP(K.token, wpn.uid, 11)).status === 400 && (await post('gear-upgrade', { uid: wpn.uid, times: '2' }, K.token)).status === 400, 'times ngoài 1..10 hoặc sai kiểu → 400');
  ok(mem.ledger.some((l) => l.accountId === K.id && l.kind === 'gear-upgrade' && (l.delta.gold ?? 0) < 0 && (l.delta.stones ?? 0) < 0), 'ledger ghi gear-upgrade');

  // phân rã (arm đang mặc, cấp 10)
  await giveGear(K.id, ['accessory_forest_R', 'helmet_water_SR', 'armor_earth_UR']);
  const gk3 = (await getMe(K.token)).gear;
  const acc = gk3.find((g) => g.def === 'accessory_forest_R')!;
  const hs = gk3.find((g) => g.def === 'helmet_water_SR')!;
  const ur = gk3.find((g) => g.def === 'armor_earth_UR')!;
  await edit(K.id, (s) => void (s.gear.find((g) => g.uid === hs.uid)!.level = 4));
  const cnt0 = (await getMe(K.token)).gear.length;
  const bad = await GS(K.token, [hs.uid, arm.uid]);
  ok(bad.status === 400 && (await getMe(K.token)).gear.length === cnt0 && (await getMe(K.token)).gear.some((g) => g.uid === hs.uid), 'có món đang mặc → 400, không phân rã món nào');
  ok((await GS(K.token, [])).status === 400 && (await GS(K.token, [hs.uid, hs.uid])).status === 400 && (await GS(K.token, 'x')).status === 400 && (await GS(K.token, Array.from({ length: 51 }, (_, i) => i + 1))).status === 400 && (await GS(K.token, [-1])).status === 400, 'danh sách rỗng / trùng / quá 50 / sai kiểu → 400');
  const mS = await getMe(K.token);
  const picks = [hs.uid, acc.uid, ur.uid, wpn.uid];
  const want = picks.reduce((a, u) => {
    const g = mS.gear.find((x) => x.uid === u)!;
    return a + salvageStones(GEAR_BY_ID[g.def].rarity, g.level);
  }, 0);
  const sal = await GS(K.token, picks);
  ok(sal.status === 200 && sal.j.stones === want && sal.j.me.wallet.stones === mS.wallet.stones + want, `phân rã 4 món: nhận đúng ${want} đá theo salvageStones (có tính cấp)`);
  ok(picks.every((u) => !sal.j.me.gear.some((x) => x.uid === u)) && sal.j.me.gear.length === cnt0 - 4, 'món đã phân rã biến mất khỏi kho');
  ok((await GS(K.token, [hs.uid])).status === 404, 'phân rã lần hai cùng món → 404');
  ok(mem.ledger.some((l) => l.accountId === K.id && l.kind === 'gear-salvage' && (l.delta.stones ?? 0) > 0), 'ledger ghi gear-salvage');
  ok(walletSum(await getMe(K.token)), 'ví không âm sau chuỗi thao tác trang bị');
}

/* trang bị đổi kết quả trận: cùng seed, cùng đội, chỉ khác đồ */
{
  const seed = 987654321;
  const mk = (withGear: boolean) => {
    const s = newState(1, Date.now());
    s.gear = STARTER_GEAR.map((def, i) => ({ uid: i + 1, def, level: 0, hero: null as string | null }));
    s.newGear = [];
    if (withGear) s.gear = (['weapon', 'armor', 'helmet', 'accessory'] as const).map((sl, i) => ({ uid: i + 1, def: `${sl}_earth_UR`, level: 10, hero: STARTER_HEROES[0] as string | null }));
    return s;
  };
  const a = mk(false);
  const b = mk(true);
  const ra = opBattle(a, '1-1', 0, seed, [], true, () => 0);
  const rb = opBattle(b, '1-1', 0, seed, [], true, () => 0);
  ok(a.runs[0].ticks !== b.runs[0].ticks, `đồ UR cấp 10 làm đổi diễn biến trận (ticks ${a.runs[0].ticks} → ${b.runs[0].ticks})`);
  ok(ra.win && rb.win, 'cả hai đều thắng ải 1-1');
  const sumB = sumGear(b.gear);
  ok(sumB.atk > 0 && sumB.hp > 0 && sumB.def > 0, 'sumGear của bộ đồ đang mặc > 0');
  const c = mk(false);
  c.gear = b.gear.map((g) => ({ ...g, hero: 'tuong-khong-trong-doi' }));
  opBattle(c, '1-1', 0, seed, [], true, () => 0);
  ok(c.runs[0].ticks === a.runs[0].ticks, 'đồ mặc ở tướng không ra trận không đổi kết quả');
}

/* rớt đồ */
{
  const L = await newUser('nguoiL');
  await edit(L.id, (s) => void (s.progress['1-1'] = { stage: '1-1', stars: 3, clears: 1 }));
  const n0 = (await getMe(L.token)).gear.length;
  let w = await fight(L.token, '1-1');
  for (let i = 0; i < 4 && !w.r.j.win; i++) w = await fight(L.token, '1-1');
  ok(w.r.status === 200 && w.r.j.win && w.r.j.drops.length >= 1 && w.r.j.drops.length <= 2, 'thắng ải thường: rớt 1–2 món');
  const gA = w.r.j.me.gear;
  ok(gA.length === n0 + w.r.j.drops.length && w.r.j.drops.every((d) => !!GEAR_BY_ID[d]) && JSON.stringify(gA.slice(n0).map((g) => g.def)) === JSON.stringify(w.r.j.drops) && gA.slice(n0).every((g) => g.level === 0 && g.hero === null), 'món rớt vào kho đúng như drops, cấp 0, chưa mặc');
  ok(w.r.j.drops.every((d) => GEAR_BY_ID[d].rarity !== 'UR'), 'chương 1 không rớt UR');
  const sw = await post<SweepRes>('sweep', { stage: '1-1', times: 3 }, L.token);
  ok(sw.status === 200 && sw.j.drops.length >= 3 && sw.j.drops.length <= 6 && sw.j.me.gear.length === gA.length + sw.j.drops.length, 'quét x3: rớt 3–6 món, vào kho đúng số lượng');
  // thua: không rớt
  const M = await newUser('nguoiM');
  await edit(M.id, (s) => {
    for (let i = 0; i < 29; i++) s.progress[`${Math.floor(i / 10) + 1}-${(i % 10) + 1}`] = { stage: `${Math.floor(i / 10) + 1}-${(i % 10) + 1}`, stars: 1, clears: 1 };
    s.squads[1] = [STARTER_HEROES[0], '', '', '', ''];
  });
  const lo = await fight(M.token, '3-10', 1);
  ok(lo.r.status === 200 && !lo.r.j.win && lo.r.j.drops.length === 0 && lo.r.j.me.gear.length === STARTER_GEAR.length, 'thua: drops rỗng, kho không đổi');
  // kho đầy: phần dư đổi thành đá, không vào drops
  await edit(L.id, (s) => {
    while (s.gear.length + s.newGear.length < GEAR_CAP - 1) s.newGear.push('helmet_forest_R');
  });
  const full1 = (await getMe(L.token)).gear.length;
  ok(full1 === GEAR_CAP - 1, `chuẩn bị kho còn đúng 1 chỗ (${full1}/${GEAR_CAP})`);
  const stBase = (await getMe(L.token)).wallet.stones;
  const sw2 = await post<SweepRes>('sweep', { stage: '1-1', times: 2 }, L.token);
  ok(sw2.status === 200 && sw2.j.me.gear.length === GEAR_CAP && sw2.j.drops.length === 1, 'kho gần đầy: chỉ nhận vừa đủ tới GEAR_CAP, drops chỉ liệt kê món đã vào kho');
  ok(sw2.j.me.wallet.stones > stBase, 'món dư được đổi thành đá cường hoá');
  const stFull = sw2.j.me.wallet.stones;
  const sw3 = await post<SweepRes>('sweep', { stage: '1-1', times: 1 }, L.token);
  ok(sw3.status === 200 && sw3.j.drops.length === 0 && sw3.j.me.gear.length === GEAR_CAP && sw3.j.me.wallet.stones >= stFull + 2, 'kho đầy: không món nào vào kho, toàn bộ đổi ra đá (>= 2 đá/món)');
  ok(walletSum(sw3.j.me), 'ví không âm');
}

/* ------------------------------------------------------------------ */
// Nhiệm vụ / Tháp / Cửa hàng: dùng đồng hồ giả (_setHeroesClock) để thử qua ngày (reset 00:00 giờ VN = 17:00 UTC)
const DAY = 86_400_000;
const D0 = Date.UTC(2030, 0, 15, 17, 0, 0); // đầu một ngày VN
let T = D0 + 3_600_000;
_setHeroesClock(() => T);
const ed = <U>(id: number, fn: (s: import('../src/heroes/db/store.js').HState) => U) => mem.mutate(id, new Date(T), 'test', fn);
const claim = (tok: string, id: string) => post<QuestClaimRes>('quest-claim', { id }, tok);
const buy = (tok: string, body: unknown) => post<ShopBuyRes>('shop-buy', body, tok);
const qp = (m: MeResponse, id: string) => m.quests.list.find((x) => x.id === id)!;
const strong = (id: number) => ed(id, (s) => void Object.values(s.heroes).forEach((h) => ((h.level = 60), (h.star = 5))));
async function tfight(tok: string, extra: Record<string, unknown> = {}, squad = 0) {
  const st = await post<{ seed: number }>('battle-start', {}, tok);
  const r = await post<TowerBattleRes>('tower-battle', { squad, seed: st.j.seed, inputs: [], auto: true, ...extra }, tok);
  return { seed: st.j.seed, r };
}
const sumW = (xs: Partial<Record<string, number>>[]) => xs.reduce((a, x) => { for (const [k, v] of Object.entries(x)) a[k] = (a[k] ?? 0) + (v ?? 0); return a; }, {} as Record<string, number>);

console.log('— nhiệm vụ hằng ngày —');
{
  const QA = await newUser('nguoiQA');
  const m0 = QA.me;
  ok(m0.quests.day === dayKey(T) && m0.quests.list.length === QUEST_DEFS.length && QUEST_DEFS.every((d, i) => m0.quests.list[i].id === d.id), 'me: đủ mọi QUEST_DEFS theo thứ tự, day = dayKey(now)');
  ok(qp(m0, 'q_login').progress === 1 && QUEST_DEFS.filter((d) => d.kind !== 'login').every((d) => qp(m0, d.id).progress === 0 && !qp(m0, d.id).claimed) && !m0.quests.bonusClaimed, 'đăng nhập tự tính 1, nhiệm vụ khác 0, chưa nhận');
  ok(m0.tower.floor === 0 && m0.tower.tries === TOWER_TRIES && SHOP_ITEMS.every((i) => m0.shop[i.id] === 0), 'me: tháp tầng 0 đủ lượt, cửa hàng đã mua 0');
  ok((await claim(QA.token, 'q_win')).status === 400, 'chưa đủ tiến trình → không nhận được');
  ok((await claim(QA.token, 'bonus')).status === 400, 'chưa nhận hết → không nhận thưởng thêm');
  ok((await claim(QA.token, 'q_khong_co')).status === 404 && (await post('quest-claim', {}, QA.token)).status === 400 && (await post('quest-claim', { id: 'q_login' })).status === 401, 'id lạ → 404, thiếu id → 400, không token → 401');
  const w0 = (await getMe(QA.token)).wallet;
  const c1 = await claim(QA.token, 'q_login');
  ok(c1.status === 200 && c1.j.reward.gold === 500 && c1.j.reward.tickets === 1 && c1.j.me.wallet.gold === w0.gold + 500 && c1.j.me.wallet.tickets === w0.tickets + 1 && qp(c1.j.me, 'q_login').claimed, 'nhận Điểm danh: trả đúng thưởng, đánh dấu đã nhận');
  const c2 = await claim(QA.token, 'q_login');
  ok(c2.status === 400 && (await getMe(QA.token)).wallet.gold === w0.gold + 500, 'nhận lần hai → 400, không trả thêm');
  ok(mem.ledger.some((l) => l.accountId === QA.id && l.kind === 'quest' && l.delta.gold === 500), 'ledger ghi kind quest');

  // hooks
  const QH = await newUser('nguoiQH');
  await ed(QH.id, (s) => void (s.progress['1-1'] = { stage: '1-1', stars: 3, clears: 1 }));
  let r: any = await post<SweepRes>('sweep', { stage: '1-1', times: 2 }, QH.token);
  ok(qp(r.j.me, 'q_win').progress === 2, 'quét x2 → win +2');
  r = await post<SweepRes>('sweep', { stage: '1-1', times: 5 }, QH.token);
  ok(qp(r.j.me, 'q_win').progress === 3, 'quét thêm x5 → chặn ở target (3)');
  const QC = await newUser('nguoiQC');
  let wf = await fight(QC.token, '1-1');
  for (let i = 0; i < 4 && wf.r.status === 200 && !wf.r.j.win; i++) wf = await fight(QC.token, '1-1');
  ok(wf.r.j.win && qp(wf.r.j.me, 'q_win').progress === 1, 'thắng 1 trận chiến dịch → win +1 đúng 1');
  const QL = await newUser('nguoiQL');
  await ed(QL.id, (s) => {
    for (let i = 0; i < 29; i++) s.progress[`${Math.floor(i / 10) + 1}-${(i % 10) + 1}`] = { stage: `${Math.floor(i / 10) + 1}-${(i % 10) + 1}`, stars: 1, clears: 1 };
    s.squads[1] = [STARTER_HEROES[0], '', '', '', ''];
  });
  const lost = await fight(QL.token, '3-10', 1);
  ok(lost.r.status === 200 && !lost.r.j.win && qp(lost.r.j.me, 'q_win').progress === 0, 'thua trận → không tính win');
  // triệu hồi: x1 qua API, x10 bằng op (chặn target)
  const sm = await S(QH.token, { count: 1 });
  ok(qp(sm.j.me, 'q_summon').progress === 1, 'triệu hồi x1 → summon 1 (= target)');
  {
    const st = newState(1, T);
    st.wallet.tickets = 50;
    rollDay(st, T);
    opSummon(st, 'standard', 10, 'tickets', (n) => Math.floor(Math.random() * n));
    ok(st.quests.q_summon.progress === 1, 'x10 cộng 10 nhưng chặn ở target 1');
    bumpQuest(st, 'win', 2);
    bumpQuest(st, 'win', 5);
    ok(st.quests.q_win.progress === 3, 'bumpQuest chặn ở target');
    bumpQuest(st, 'levelup', 0);
    ok(st.quests.q_level === undefined, 'bumpQuest n=0 không tạo hàng');
  }
  // lên cấp: đếm số cấp THỰC SỰ nâng
  const QV = await newUser('nguoiQV');
  await ed(QV.id, (s) => ((s.wallet.gold = 1_000_000), (s.wallet.exp = 1_000_000), (s.heroes[STARTER_HEROES[0]].star = 3)));
  const l2 = await post<{ me: MeResponse; gained: number }>('level-up', { hero: STARTER_HEROES[0], times: 2 }, QV.token);
  ok(l2.j.gained === 2 && qp(l2.j.me, 'q_level').progress === 2, 'lên 2 cấp → levelup +2');
  const l3 = await post<{ me: MeResponse; gained: number }>('level-up', { hero: STARTER_HEROES[0], times: 4 }, QV.token);
  ok(l3.j.gained === 4 && qp(l3.j.me, 'q_level').progress === 3, 'lên thêm 4 cấp → chặn ở target 3');
  const QP = await newUser('nguoiQP');
  await ed(QP.id, (s) => (s.wallet.gold = 0));
  ok((await post('level-up', { hero: STARTER_HEROES[0] }, QP.token)).status === 400 && qp(await getMe(QP.token), 'q_level').progress === 0, 'lên cấp thất bại (hết vàng) → không cộng tiến trình');
  // trang bị: đếm số cấp thực sự
  const QG = await newUser('nguoiQG');
  await ed(QG.id, (s) => ((s.wallet.gold = 1_000_000), (s.wallet.stones = 1000)));
  const gu = QG.me.gear[0].uid;
  const g1 = await post<{ me: MeResponse; gained: number }>('gear-upgrade', { uid: gu }, QG.token);
  ok(g1.j.gained === 1 && qp(g1.j.me, 'q_gear').progress === 1, 'cường hoá 1 cấp → gear +1');
  const g2 = await post<{ me: MeResponse; gained: number }>('gear-upgrade', { uid: gu, times: 3 }, QG.token);
  ok(g2.j.gained === 3 && qp(g2.j.me, 'q_gear').progress === 2, 'cường hoá thêm 3 cấp → chặn ở target 2');

  // nhận đủ mọi nhiệm vụ + thưởng thêm
  const QB = await newUser('nguoiQB');
  await ed(QB.id, (s) => void QUEST_DEFS.forEach((d) => (s.quests[d.id] = { progress: d.target, claimed: false })));
  const wb = (await getMe(QB.token)).wallet;
  const first = await claim(QB.token, 'q_win');
  ok(first.status === 200 && first.j.me.wallet.gold === wb.gold + 800 && first.j.me.wallet.exp === wb.exp + 100, 'nhận q_win: +800 vàng +100 EXP đúng');
  ok((await claim(QB.token, 'bonus')).status === 400, 'còn nhiệm vụ chưa nhận → bonus bị từ chối');
  let last: any = first;
  for (const d of QUEST_DEFS) if (d.id !== 'q_win') last = await claim(QB.token, d.id);
  const sumRewards = sumW(QUEST_DEFS.map((d) => d.reward));
  ok(QUEST_DEFS.every((d) => qp(last.j.me, d.id).claimed) && Object.entries(sumRewards).every(([k, v]) => last.j.me.wallet[k as 'gold'] === wb[k as 'gold'] + v), 'nhận hết: ví tăng đúng tổng thưởng mọi nhiệm vụ');
  const bw = last.j.me.wallet;
  const bo = await claim(QB.token, 'bonus');
  ok(bo.status === 200 && bo.j.me.wallet.gems === bw.gems + QUEST_BONUS.gems! && bo.j.me.wallet.tickets === bw.tickets + QUEST_BONUS.tickets! && bo.j.me.quests.bonusClaimed, 'thưởng thêm sau khi nhận hết: đúng QUEST_BONUS');
  ok((await claim(QB.token, 'bonus')).status === 400 && (await getMe(QB.token)).wallet.gems === bo.j.me.wallet.gems, 'thưởng thêm không nhận kép');
  ok(walletSum(bo.j.me), 'ví không âm');

  // qua ngày: lười, không timer
  T += DAY;
  const nd = await getMe(QB.token);
  ok(nd.quests.day === dayKey(T) && nd.quests.list.every((q) => !q.claimed && q.progress === (q.id === 'q_login' ? 1 : 0)) && !nd.quests.bonusClaimed, 'qua ngày: nhiệm vụ reset (chỉ đăng nhập = 1), bonus reset — ngay cả khi mới chỉ xem');
  ok(nd.tower.tries === TOWER_TRIES && SHOP_ITEMS.every((i) => nd.shop[i.id] === 0), 'qua ngày: lượt tháp + cửa hàng reset');
  const again = await claim(QB.token, 'q_login');
  ok(again.status === 200 && again.j.me.wallet.gold === nd.wallet.gold + 500, 'ngày mới nhận Điểm danh được lại');
  const row = await mem.view(QB.id, new Date(T), (s) => s);
  ok(row.day === dayKey(T) && Object.keys(row.quests).length <= QUEST_DEFS.length && !row.questBonus, 'trạng thái ngày cũ đã bị dọn khi ghi');
  // nhảy xa nhiều ngày vẫn ổn
  T += 5 * DAY;
  const far = qp(await getMe(QB.token), 'q_login');
  ok(far.progress === 1 && !far.claimed, 'nhảy 5 ngày: vẫn reset đúng');
  T -= 5 * DAY;
}

console.log('— Tháp —');
{
  const TW = await newUser('nguoiTW');
  await strong(TW.id);
  ok((await post('tower-battle', { squad: 0, seed: 123, inputs: [], auto: true }, TW.token)).status === 400 && (await getMe(TW.token)).tower.tries === TOWER_TRIES, 'chưa có seed → 400, không tốn lượt');
  ok((await post('tower-battle', { squad: 0, seed: 123, inputs: [], auto: true })).status === 401, 'không token → 401');
  const m0 = await getMe(TW.token);
  const f1 = await tfight(TW.token);
  const r1 = towerReward(1);
  ok(f1.r.status === 200 && f1.r.j.win && f1.r.j.floor === 1, 'đội mạnh thắng tầng 1');
  ok(f1.r.j.reward.gold === r1.gold && f1.r.j.reward.exp === r1.exp && f1.r.j.reward.xp === r1.xp && f1.r.j.reward.gems === 0 && f1.r.j.reward.stones === 0, 'thưởng đúng towerReward(1)');
  ok(f1.r.j.me.wallet.gold === m0.wallet.gold + r1.gold && f1.r.j.me.wallet.exp === m0.wallet.exp + r1.exp, 'ví cộng đúng vàng + EXP bình');
  ok(f1.r.j.levelUp || f1.r.j.me.profile.xp === m0.profile.xp + r1.xp, 'XP tài khoản cộng đúng');
  ok(f1.r.j.me.tower.floor === 1 && f1.r.j.me.tower.tries === TOWER_TRIES - 1 && f1.r.j.drops.length === 0 && f1.r.j.me.gear.length === m0.gear.length, 'thắng: lên tầng 1, còn 4 lượt, tầng thường không rớt đồ');
  ok(mem.runs.some((x) => x.accountId === TW.id && x.stage === 't-1' && x.win), 'ghi h_runs stage t-1');
  ok(mem.ledger.some((l) => l.accountId === TW.id && l.kind === 'tower' && l.delta.gold === r1.gold), 'ledger kind tower');
  const reuse = await post('tower-battle', { squad: 0, seed: f1.seed, inputs: [], auto: true }, TW.token);
  ok(reuse.status === 400 && (await getMe(TW.token)).tower.tries === TOWER_TRIES - 1, 'seed dùng lại → 400, không tốn lượt');
  const f2 = await tfight(TW.token, { floor: 50, stage: 't-99' });
  ok(f2.r.j.floor === 2 && f2.r.j.me.tower.floor === 2, 'client gửi floor/stage giả bị bỏ qua: chỉ đánh tầng kế tiếp');
  await tfight(TW.token);
  await tfight(TW.token);
  const gBefore = (await getMe(TW.token)).gear.length;
  const w4 = (await getMe(TW.token)).wallet;
  const f5 = await tfight(TW.token);
  const r5 = towerReward(5);
  ok(f5.r.j.win && f5.r.j.floor === 5 && f5.r.j.reward.gems === r5.gems && f5.r.j.me.wallet.gems === w4.gems + r5.gems && f5.r.j.me.wallet.gold === w4.gold + r5.gold, 'tầng 5: +50 kim cương + vàng đúng');
  ok(f5.r.j.drops.length >= 1 && f5.r.j.drops.length <= 2 && f5.r.j.me.gear.length === gBefore + f5.r.j.drops.length && f5.r.j.drops.every((d) => !!GEAR_BY_ID[d]), 'tầng 5: rớt 1–2 món, vào kho đúng số');
  ok(f5.r.j.me.tower.tries === 0 && qp(f5.r.j.me, 'q_tower').progress === 1, 'hết 5 lượt; nhiệm vụ Tháp = 1 (chặn target)');
  const f6 = await tfight(TW.token);
  ok(f6.r.status === 400 && /lượt/.test((f6.r.j as any).error ?? '') && (await getMe(TW.token)).tower.floor === 5, 'hết lượt → 400, tầng không đổi');
  T += DAY;
  const nm = await getMe(TW.token);
  ok(nm.tower.tries === TOWER_TRIES && nm.tower.floor === 5, 'qua ngày: lượt về 5, tầng giữ nguyên');
  const f6b = await tfight(TW.token);
  ok(f6b.r.j.win && f6b.r.j.floor === 6 && f6b.r.j.me.tower.tries === TOWER_TRIES - 1, 'ngày mới đánh tiếp tầng 6, tốn 1 lượt');
  // thua vẫn tốn lượt
  const TL = await newUser('nguoiTL');
  await ed(TL.id, (s) => void (s.towerFloor = 59));
  const lw = (await getMe(TL.token)).wallet;
  const lf = await tfight(TL.token);
  ok(lf.r.status === 200 && !lf.r.j.win && lf.r.j.floor === 60 && lf.r.j.me.tower.floor === 59 && lf.r.j.me.tower.tries === TOWER_TRIES - 1, 'thua: vẫn tốn 1 lượt, không lên tầng');
  ok(lf.r.j.reward.gold === 0 && lf.r.j.drops.length === 0 && JSON.stringify(lf.r.j.me.wallet) === JSON.stringify(lw) && qp(lf.r.j.me, 'q_tower').progress === 1, 'thua: không thưởng, nhưng nhiệm vụ Tháp vẫn tính');
  ok(mem.runs.some((x) => x.accountId === TL.id && x.stage === 't-60' && !x.win), 'ghi h_runs thua t-60');
  for (let i = 0; i < 4; i++) await tfight(TL.token);
  const lz = await tfight(TL.token);
  ok(lz.r.status === 400 && (await getMe(TL.token)).tower.tries === 0, 'thua đủ 5 lần → hết lượt');
  // tầng boss (10): 2 lần rớt đồ + đá
  const TB = await newUser('nguoiTB');
  await strong(TB.id);
  await ed(TB.id, (s) => void (s.towerFloor = 9));
  const bw = await getMe(TB.token);
  const fb = await tfight(TB.token);
  const rb = towerReward(10);
  ok(fb.r.j.win && fb.r.j.floor === 10 && fb.r.j.reward.gems === 100 && fb.r.j.reward.stones === 10 && fb.r.j.me.wallet.stones === bw.wallet.stones + 10 && fb.r.j.me.wallet.gems === bw.wallet.gems + 100, 'tầng 10: +100 kim cương +10 đá');
  ok(rb.gearRolls === 2 && fb.r.j.drops.length >= 4 && fb.r.j.drops.length <= 6 && fb.r.j.me.gear.length === bw.gear.length + fb.r.j.drops.length, 'tầng 10: 2 lần rớt (boss) → 4–6 món vào kho');
  // kho đầy: dư đổi ra đá, drops chỉ liệt kê món đã vào
  await ed(TB.id, (s) => {
    s.towerFloor = 4;
    while (s.gear.length + s.newGear.length < GEAR_CAP) s.newGear.push('helmet_forest_R');
  });
  const cw = await getMe(TB.token);
  const fc = await tfight(TB.token);
  ok(fc.r.j.win && fc.r.j.drops.length === 0 && fc.r.j.me.gear.length === GEAR_CAP && fc.r.j.me.wallet.stones >= cw.wallet.stones + 2, 'kho đầy: không món nào vào kho, đổi ra đá');
  // tầng tối đa
  await ed(TB.id, (s) => void (s.towerFloor = TOWER_MAX_FLOOR));
  const t0 = (await getMe(TB.token)).tower.tries;
  const mx = await tfight(TB.token);
  ok(mx.r.status === 400 && /chinh phục/.test((mx.r.j as any).error ?? '') && (await getMe(TB.token)).tower.tries === t0, 'đã hết tháp → 400, không tốn lượt');
  ok(walletSum(await getMe(TB.token)), 'ví không âm');
  // đội rỗng
  const TE = await newUser('nguoiTE');
  const em = await tfight(TE.token, {}, 2);
  ok(em.r.status === 400 && (await getMe(TE.token)).tower.tries === TOWER_TRIES, 'đội rỗng → 400, không tốn lượt');
}

console.log('— cửa hàng —');
{
  const SH = await newUser('nguoiSH');
  const rich = () => ed(SH.id, (s) => ((s.wallet.gold = 1_000_000), (s.wallet.gems = 100_000), (s.wallet.tickets = 0)));
  await rich();
  const b0 = await getMe(SH.token);
  const p1 = await buy(SH.token, { item: 'exp_pack', times: 3 });
  ok(p1.status === 200 && p1.j.bought === 3 && p1.j.me.wallet.gold === b0.wallet.gold - 1800 && p1.j.me.wallet.exp === b0.wallet.exp + 600 && p1.j.me.shop.exp_pack === 3, 'mua Bình EXP x3: trừ 1800 vàng, +600 EXP, đếm 3');
  const p2 = await buy(SH.token, { item: 'exp_pack' });
  ok(p2.j.bought === 1 && p2.j.me.shop.exp_pack === 4, 'times mặc định 1');
  const p3 = await buy(SH.token, { item: 'exp_pack', times: 100 });
  ok(p3.status === 200 && p3.j.bought === 6 && p3.j.me.shop.exp_pack === 10, 'vượt giới hạn ngày: chỉ mua phần còn lại (6), tổng 10');
  const p4 = await buy(SH.token, { item: 'exp_pack' });
  ok(p4.status === 400 && (await getMe(SH.token)).shop.exp_pack === 10, 'hết giới hạn ngày → 400');
  ok((await buy(SH.token, { item: 'khong_co' })).status === 404 && (await buy(SH.token, { item: 'exp_pack', times: 0 })).status === 400 && (await buy(SH.token, { item: 'exp_pack', times: 101 })).status === 400 && (await buy(SH.token, { item: 'exp_pack', times: 1.5 })).status === 400 && (await buy(SH.token, {})).status === 400 && (await buy('x', { item: 'exp_pack' })).status === 401, 'mặt hàng lạ 404; times sai / thiếu item 400; token sai 401');
  // mua một phần khi thiếu tiền
  await ed(SH.id, (s) => ((s.wallet.gold = 7000), (s.wallet.stones = 0), (s.shop = {})));
  const pp = await buy(SH.token, { item: 'stone_pack', times: 10 });
  ok(pp.status === 200 && pp.j.bought === 4 && pp.j.me.wallet.gold === 1000 && pp.j.me.wallet.stones === 40 && pp.j.me.shop.stone_pack === 4, 'thiếu tiền: mua 4/10 (1500 vàng/gói), ví còn 1000, +40 đá');
  await ed(SH.id, (s) => (s.wallet.gold = 100));
  const zero = await buy(SH.token, { item: 'stone_pack' });
  const wz = await getMe(SH.token);
  ok(zero.status === 400 && wz.wallet.gold === 100 && wz.shop.stone_pack === 4 && walletSum(wz), 'không đủ tiền cho 1 lần → 400, ví giữ nguyên, không âm');
  ok(mem.ledger.some((l) => l.accountId === SH.id && l.kind === 'shop' && (l.delta.gold ?? 0) < 0), 'ledger kind shop');
  // mảnh tướng: cần tướng đã sở hữu
  await rich();
  const sh0 = (await getMe(SH.token)).heroes.find((h) => h.id === STARTER_HEROES[0])!.shards;
  const g0 = (await getMe(SH.token)).wallet.gold;
  ok((await buy(SH.token, { item: 'shard_pack' })).status === 400 && (await buy(SH.token, { item: 'shard_pack', hero: missing })).status === 400 && (await getMe(SH.token)).wallet.gold === g0, 'mảnh tướng: thiếu hero / hero chưa sở hữu → 400, không trừ tiền');
  const sp = await buy(SH.token, { item: 'shard_pack', hero: STARTER_HEROES[0], times: 2 });
  ok(sp.status === 200 && sp.j.bought === 2 && sp.j.me.heroes.find((h) => h.id === STARTER_HEROES[0])!.shards === sh0 + 20 && sp.j.me.wallet.gold === g0 - 5000, 'mảnh tướng x2: +20 mảnh, -5000 vàng');
  // vé: item ví khác
  const tk = await buy(SH.token, { item: 'ticket_pack', times: 3 });
  ok(tk.j.me.wallet.tickets === 3 && tk.j.bought === 3, 'vé triệu hồi x3');
  // thể lực: vượt trần được, không hồi/decay
  await rich();
  const st1 = await buy(SH.token, { item: 'stamina_pack' });
  ok(st1.status === 200 && st1.j.me.profile.stamina === STAMINA_MAX + 60, `thể lực đầy ${STAMINA_MAX} + 60 = ${STAMINA_MAX + 60} (vượt trần)`);
  T += 3 * 3_600_000;
  ok((await getMe(SH.token)).profile.stamina === STAMINA_MAX + 60, 'phần vượt trần giữ nguyên theo thời gian');
  const st2 = await buy(SH.token, { item: 'stamina_pack', times: 5 });
  ok(st2.j.bought === 2 && st2.j.me.profile.stamina === STAMINA_MAX + 180, 'giới hạn 3/ngày: mua thêm 2 → +120, tổng +180');
  await ed(SH.id, (s) => ((s.progress['1-1'] = { stage: '1-1', stars: 3, clears: 1 }), (s.wallet.gold = 1000)));
  const swp = await post<SweepRes>('sweep', { stage: '1-1', times: 2 }, SH.token);
  ok(swp.status === 200 && swp.j.me.profile.stamina === STAMINA_MAX + 180 - 12, 'quét tiêu từ phần vượt trần đúng');
  const SL = await newUser('nguoiSL');
  await ed(SL.id, (s) => ((s.stamina = 50), (s.staminaAt = T), (s.wallet.gems = 1000)));
  const sl = await buy(SL.token, { item: 'stamina_pack' });
  ok(sl.j.me.profile.stamina === 110, 'thể lực 50 + 60 = 110');
  T += 6 * 60_000;
  ok((await getMe(SL.token)).profile.stamina === 111, 'dưới trần vẫn tiếp tục hồi (1 điểm / 6 phút)');
  T += 3_600_000;
  ok((await getMe(SL.token)).profile.stamina === STAMINA_MAX, 'rồi dừng ở trần, không vượt');
  // rương trang bị
  await rich();
  const cg0 = await getMe(SH.token);
  const ch = await buy(SH.token, { item: 'gear_chest' });
  ok(ch.status === 200 && ch.j.bought === 1 && ch.j.drops.length === 1 && !!GEAR_BY_ID[ch.j.drops[0]] && ch.j.me.gear.length === cg0.gear.length + 1 && ch.j.me.gear[ch.j.me.gear.length - 1].def === ch.j.drops[0] && ch.j.me.wallet.gems === cg0.wallet.gems - 200, 'rương trang bị: +1 món vào kho, -200 kim cương');
  const ch3 = await buy(SH.token, { item: 'gear_chest', times: 3 });
  ok(ch3.j.bought === 3 && ch3.j.drops.length === 3 && ch3.j.me.gear.length === cg0.gear.length + 4, 'rương x3: 3 món');
  await ed(SH.id, (s) => {
    s.shop = {};
    while (s.gear.length + s.newGear.length < GEAR_CAP) s.newGear.push('helmet_forest_R');
  });
  const capW = (await getMe(SH.token)).wallet;
  const cc = await buy(SH.token, { item: 'gear_chest', times: 2 });
  ok(cc.status === 200 && cc.j.bought === 2 && cc.j.drops.length === 0 && cc.j.me.gear.length === GEAR_CAP && cc.j.me.wallet.stones >= capW.stones + 4 && cc.j.me.wallet.gems === capW.gems - 400, 'kho đầy: rương vẫn bán, món đổi ra đá, drops rỗng');
  // sang ngày mới → mua lại được
  await ed(SH.id, (s) => (s.shop = { exp_pack: 10 }));
  ok((await buy(SH.token, { item: 'exp_pack' })).status === 400, 'đang đạt giới hạn');
  T += DAY;
  const nd = await getMe(SH.token);
  ok(nd.shop.exp_pack === 0, 'qua ngày: bộ đếm mua reset');
  await rich();
  ok((await buy(SH.token, { item: 'exp_pack', times: 2 })).j.bought === 2, 'qua ngày mua lại được');
  ok(walletSum(await getMe(SH.token)), 'ví không âm sau chuỗi mua');
  // song song: không vượt giới hạn
  await ed(SH.id, (s) => ((s.shop = {}), (s.wallet.gold = 1_000_000)));
  const par = await Promise.all(Array.from({ length: 4 }, () => buy(SH.token, { item: 'ticket_pack', times: 2 })));
  const bs = par.filter((x) => x.status === 200).reduce((a, x) => a + x.j.bought, 0);
  ok(bs === 3 && (await getMe(SH.token)).shop.ticket_pack === 3, 'mua song song: tổng đúng bằng giới hạn ngày (3)');
}
console.log('— Đấu trường —');
{
  const arena = (tok: string) => call<ArenaRes>('GET', 'arena', undefined, tok);
  const top = () => call<ArenaTopRes>('GET', 'arena-top');
  const AROW = (id: number) => mem.view(id, new Date(T), (s) => s);
  const touch = (id: number) => ed(id, (s) => void (s.arenaOn = true));
  async function afight(tok: string, opponent: string, extra: Record<string, unknown> = {}, squad = 0) {
    const st = await post<{ seed: number }>('battle-start', { stage: 'arena' }, tok);
    const r = await post<ArenaBattleRes>('arena-battle', { opponent, squad, seed: st.j.seed, inputs: [], auto: true, ...extra }, tok);
    return { seed: st.j.seed, r };
  }
  const rating = async (id: number) => (await AROW(id)).arenaRating;

  // ---- tạo hàng lười + buildMe.arena ----
  const AR = await newUser('arenaR');
  ok(JSON.stringify(AR.me.arena) === JSON.stringify({ rating: 1000, tries: ARENA_TRIES, defense: 0, wins: 0, losses: 0 }), 'buildMe.arena mặc định khi chưa có hàng: 1000 / 5 lượt / đội 0 / 0-0');
  ok(!(await AROW(AR.id)).arenaOn && (await getMe(AR.token)).arena.tries === ARENA_TRIES, 'xem hồ sơ không tạo hàng đấu trường');
  ok((await call('GET', 'arena')).status === 401, 'arena không token → 401');
  const a0 = await arena(AR.token);
  ok(a0.status === 200 && (await AROW(AR.id)).arenaOn, 'GET arena tạo hàng lười');
  ok(a0.j.state.rating === 1000 && a0.j.state.tries === ARENA_TRIES && a0.j.rank === 1, 'state mặc định, hạng 1 (một mình)');
  ok(a0.j.opponents.length === ARENA_OPPONENTS && a0.j.opponents.every((o, i) => o.bot && o.id === `bot:${i}`), 'chỉ một tài khoản → toàn bot bot:0..4');
  ok(new Set(a0.j.opponents.map((o) => o.id)).size === ARENA_OPPONENTS && a0.j.opponents.every((o) => o.power > 0 && o.heroes.length === SQUAD_SIZE && o.heroes.some((h) => h.id) && o.name), 'bot không trùng, có lực chiến / tướng / tên');
  ok(JSON.stringify((await arena(AR.token)).j.opponents) === JSON.stringify(a0.j.opponents), 'bot deterministic: gọi lại cùng danh sách');

  // ---- đội phòng thủ ----
  const dfn = (tok: string, squad: unknown) => post<{ me: MeResponse }>('arena-defense', { squad }, tok);
  ok((await dfn(AR.token, 1)).status === 400, 'phòng thủ: đội rỗng → 400');
  ok((await dfn(AR.token, 3)).status === 400 && (await dfn(AR.token, -1)).status === 400 && (await dfn(AR.token, 'x')).status === 400 && (await dfn(AR.token, 0.5)).status === 400, 'phòng thủ: chỉ số đội sai → 400');
  await ed(AR.id, (s) => (s.squads[2] = ['khong-co-tuong', '', '', '', '']));
  ok((await dfn(AR.token, 2)).status === 400, 'phòng thủ: đội chỉ có tướng chưa sở hữu → 400');
  ok((await post('arena-defense', { squad: 0 })).status === 401, 'phòng thủ: không token → 401');
  const d0 = await dfn(AR.token, 0);
  ok(d0.status === 200 && d0.j.me.arena.defense === 0, 'đặt đội 0 làm phòng thủ');
  await ed(AR.id, (s) => (s.squads[1] = [STARTER_HEROES[1], '', '', '', '']));
  ok((await dfn(AR.token, 1)).j.me.arena.defense === 1 && (await dfn(AR.token, 0)).j.me.arena.defense === 0, 'đổi đội phòng thủ qua lại');

  // ---- danh sách đối thủ ----
  const D1 = await newUser('arenaD1');
  const D2 = await newUser('arenaD2');
  const NX = await newUser('arenaNoDef');
  const NT = await newUser('arenaUntouched');
  await dfn(D1.token, 0);
  await dfn(D2.token, 0);
  await touch(NX.id);
  await ed(NX.id, (s) => (s.squads[0] = ['', '', '', '', ''])); // có hàng nhưng đội phòng thủ rỗng
  const ls = await arena(AR.token);
  const ids = ls.j.opponents.map((o) => o.id);
  ok(ids.includes(String(D1.id)) && ids.includes(String(D2.id)), 'danh sách có hai người thật có đội phòng thủ');
  ok(!ids.includes(String(AR.id)) && !ids.includes(String(NX.id)) && !ids.includes(String(NT.id)), 'không có bản thân / đội phòng thủ rỗng / chưa vào đấu trường');
  ok(ls.j.opponents.length === ARENA_OPPONENTS && new Set(ids).size === ARENA_OPPONENTS, 'đủ 5 đối thủ, không trùng');
  ok(ls.j.opponents.filter((o) => o.bot).map((o) => o.id).join() === 'bot:0,bot:1,bot:2' && ls.j.opponents.filter((o) => !o.bot).every((o) => o.name.startsWith('arenaD')), '3 bot lấp chỗ trống (bot:0..2), người thật có tên tài khoản');
  const realD1 = ls.j.opponents.find((o) => o.id === String(D1.id))!;
  ok(realD1.rating === 1000 && realD1.heroes.filter((h) => h.id).length === STARTER_HEROES.length && realD1.power > 0, 'đối thủ thật: điểm, tướng theo ô, lực chiến');

  // ---- lỗi đầu vào của arena-battle ----
  const t0 = (await getMe(AR.token)).arena.tries;
  ok((await post('arena-battle', { opponent: 'bot:0', squad: 0, seed: 1, inputs: [], auto: true }, AR.token)).status === 400, 'chưa có seed → 400');
  ok((await post('arena-battle', { opponent: 'bot:0', squad: 0, seed: 1, inputs: [], auto: true })).status === 401, 'không token → 401');
  ok((await afight(AR.token, String(AR.id))).r.status === 400, 'đánh chính mình → 400');
  ok((await afight(AR.token, '99999999')).r.status === 404, 'tài khoản lạ → 404');
  ok((await afight(AR.token, String(NX.id))).r.status === 400, 'đối thủ chưa có đội phòng thủ → 400');
  ok((await afight(AR.token, `bot:${BOT_COUNT}`)).r.status === 400 && (await afight(AR.token, 'bot:007')).r.status === 400 && (await afight(AR.token, 'bot:-1')).r.status === 400, 'bot ngoài 0..99 / sai định dạng → 400');
  ok((await afight(AR.token, 'khong-hop-le')).r.status === 400 && (await afight(AR.token, '')).r.status === 400, 'id lạ / rỗng → 400');
  ok((await afight(AR.token, 'bot:0', {}, 9)).r.status === 400, 'chỉ số đội sai → 400');
  ok((await getMe(AR.token)).arena.tries === t0 && (await rating(AR.id)) === 1000, 'các lỗi trên không tốn lượt, không đổi điểm');

  // ---- trận thật: người mạnh thắng bot, thưởng + điểm đúng công thức ----
  await strong(AR.id);
  const wb = (await getMe(AR.token)).wallet;
  const botEntry = ls.j.opponents.find((o) => o.id === 'bot:2')!;
  const f1 = await afight(AR.token, 'bot:2');
  const dl = ratingDelta(true, 1000, botEntry.rating);
  ok(f1.r.status === 200 && f1.r.j.win, 'đội mạnh thắng bot:2');
  ok(JSON.stringify(f1.r.j.opponent) === JSON.stringify(botEntry), 'bot dựng lại khi đánh = đúng bot đã thấy trong danh sách');
  ok(f1.r.j.ratingDelta === dl && f1.r.j.rating === 1000 + dl && f1.r.j.me.arena.rating === 1000 + dl, 'điểm đổi đúng ratingDelta(win, 1000, điểm bot)');
  const rw = arenaReward(true);
  ok(f1.r.j.reward.gold === rw.gold && f1.r.j.reward.gems === rw.gems && f1.r.j.me.wallet.gold === wb.gold + rw.gold && f1.r.j.me.wallet.gems === wb.gems + rw.gems, 'thưởng thắng đúng arenaReward(true)');
  ok(f1.r.j.me.arena.tries === ARENA_TRIES - 1 && f1.r.j.me.arena.wins === 1 && f1.r.j.me.arena.losses === 0, 'còn 4 lượt, thắng 1');
  ok(f1.r.j.me.quests.list.find((q) => q.id === 'q_win')!.progress === 0, 'trận đấu trường không tính nhiệm vụ thắng');
  ok(mem.ledger.some((l) => l.accountId === AR.id && l.kind === 'arena' && l.delta.gold === rw.gold && l.delta.gems === rw.gems), 'ledger kind arena');
  ok(mem.runs.some((x) => x.accountId === AR.id && x.stage === 'arena' && x.win && x.stars === 0 && x.ticks > 0), 'ghi h_runs stage arena');
  const reuse = await post('arena-battle', { opponent: 'bot:2', squad: 0, seed: f1.seed, inputs: [], auto: true }, AR.token);
  ok(reuse.status === 400 && (await getMe(AR.token)).arena.tries === ARENA_TRIES - 1, 'seed dùng lại → 400, không tốn lượt');
  const other = await newUser('arenaSeedX');
  const stA = await post<{ seed: number }>('battle-start', {}, AR.token);
  ok((await post('arena-battle', { opponent: 'bot:0', squad: 0, seed: stA.j.seed, inputs: [], auto: true }, other.token)).status === 400, 'seed của người khác không dùng được');
  ok((await post('arena-battle', { opponent: 'bot:0', squad: 0, seed: stA.j.seed, inputs: [], auto: true }, AR.token)).status === 200, '... nhưng chủ seed vẫn dùng được (không bị người khác đốt)');

  // ---- hết lượt, qua ngày ----
  let last: ArenaBattleRes = f1.r.j;
  let bad = 0;
  for (let i = 0; i < 3; i++) {
    const prev = await rating(AR.id);
    const f = await afight(AR.token, `bot:${i}`);
    if (f.r.status !== 200) {
      bad++;
      continue;
    }
    if (f.r.j.rating !== Math.max(0, prev + ratingDelta(f.r.j.win, prev, f.r.j.opponent.rating))) bad++;
    last = f.r.j;
  }
  ok(bad === 0 && last.me.arena.tries === 0, 'trận 3..5: điểm luôn khớp ratingDelta (floor 0), dùng hết 5 lượt');
  const none = await afight(AR.token, 'bot:0');
  ok(none.r.status === 400 && /lượt/.test((none.r.j as any).error ?? '') && (await getMe(AR.token)).arena.tries === 0, 'hết lượt → 400');
  ok(walletSum(await getMe(AR.token)), 'ví không âm');
  const wl = (await getMe(AR.token)).arena;
  ok(wl.wins + wl.losses === ARENA_TRIES && wl.rating === last.rating, 'thắng + thua = 5, điểm khớp trận cuối');
  T += DAY;
  ok((await getMe(AR.token)).arena.tries === ARENA_TRIES, 'qua ngày: me.arena.tries về 5 (khi chỉ xem)');
  ok((await arena(AR.token)).j.state.tries === ARENA_TRIES, 'qua ngày: GET arena cũng báo 5 lượt');
  const nd = await afight(AR.token, 'bot:0');
  ok(nd.r.status === 200 && nd.r.j.me.arena.tries === ARENA_TRIES - 1, 'qua ngày đánh lại được, còn 4');

  // ---- body giả mạo bị bỏ qua ----
  const W = await newUser('arenaWeak');
  await dfn(W.token, 0);
  // đội CHẮC CHẮN thua: 1 tướng thầy thuốc cấp 1 (bot điểm khởi đầu có 4 tướng R) — không để kết quả phụ thuộc seed ngẫu nhiên
  await ed(W.id, (s) => void (s.squads[0] = ['thay_thuoc', '', '', '', '']));
  const wmem = (await getMe(W.token)).wallet;
  const fw = await afight(W.token, 'bot:0', { win: true, rating: 9999, delta: 500, reward: { gold: 1e9, gems: 1e9 }, ticks: 1 });
  ok(fw.r.status === 200 && !fw.r.j.win, 'đội yếu thua bot dù body gửi win:true');
  ok(fw.r.j.rating === 1000 + ratingDelta(false, 1000, fw.r.j.opponent.rating) && fw.r.j.rating < 1000, 'điểm theo kết quả server (thua → giảm), bỏ qua rating giả');
  const lr = arenaReward(false);
  ok(fw.r.j.reward.gold === lr.gold && fw.r.j.reward.gems === 0 && fw.r.j.me.wallet.gold === wmem.gold + lr.gold && fw.r.j.me.wallet.gems === wmem.gems, 'thưởng thua đúng arenaReward(false): +100 vàng, 0 kim cương');
  ok(fw.r.j.me.arena.losses === 1 && fw.r.j.me.arena.wins === 0, 'ghi 1 thua');

  // ---- dữ liệu SỐNG của đội phòng thủ + điểm sàn 0 + không đổi điểm người phòng thủ ----
  const ATK = await newUser('arenaAtk');
  await ed(ATK.id, (s) => void Object.values(s.heroes).forEach((h) => ((h.level = 40), (h.star = 3))));
  await ed(D1.id, (s) => void Object.values(s.heroes).forEach((h) => ((h.level = 5), (h.star = 1))));
  const pw1 = (await arena(ATK.token)).j.opponents.find((o) => o.id === String(D1.id))!;
  const x1 = await afight(ATK.token, String(D1.id));
  ok(x1.r.status === 200 && x1.r.j.win && JSON.stringify(x1.r.j.opponent) === JSON.stringify(pw1), 'đánh người thật yếu → thắng, tóm tắt đối thủ khớp danh sách');
  await ed(D1.id, (s) => void Object.values(s.heroes).forEach((h) => ((h.level = 60), (h.star = 5))));
  const pw2 = (await arena(ATK.token)).j.opponents.find((o) => o.id === String(D1.id))!;
  const x2 = await afight(ATK.token, String(D1.id));
  ok(pw2.power > pw1.power && pw2.heroes[0].level === 60, 'nâng cấp tướng phòng thủ → lực chiến + cấp trong danh sách đổi theo (dữ liệu sống)');
  ok(x2.r.status === 200 && !x2.r.j.win, 'cùng đối thủ sau khi nâng cấp → kết quả đổi (thua)');
  const dst = await AROW(D1.id);
  ok(dst.arenaRating === 1000 && dst.arenaWins === 0 && dst.arenaLosses === 0 && dst.arenaTries === ARENA_TRIES, 'điểm / thắng thua / lượt của người phòng thủ không đổi');
  await ed(D1.id, (s) => (s.squads[0] = [STARTER_HEROES[0], '', '', '', '']));
  const pw3 = (await arena(ATK.token)).j.opponents.find((o) => o.id === String(D1.id))!;
  ok(pw3.heroes.filter((h) => h.id).length === 1 && pw3.power < pw2.power, 'đổi đội hình phòng thủ: danh sách phản ánh ngay');
  await ed(D1.id, (s) => (s.squads[0] = [...STARTER_HEROES.slice(0, SQUAD_SIZE)]));

  // điểm sàn: người tấn công yếu ở 3 điểm đánh đội mạnh
  await ed(W.id, (s) => (s.arenaRating = 3));
  const fl = await afight(W.token, String(D1.id));
  ok(fl.r.status === 200 && !fl.r.j.win && fl.r.j.rating === 0 && fl.r.j.ratingDelta === -3 && (await rating(W.id)) === 0, 'điểm sàn 0: thua ở 3 điểm → 0, delta báo -3');
  const lowList = await arena(W.token);
  ok(lowList.j.opponents.length === ARENA_OPPONENTS && lowList.j.opponents.filter((o) => o.bot).every((o) => o.power > 0 && o.heroes.some((h) => h.id)), 'điểm 0: bot vẫn có đội hợp lệ');
  const fb0 = await afight(W.token, 'bot:1');
  ok(fb0.r.status === 200 && fb0.r.j.rating >= 0 && walletSum(fb0.r.j.me), 'đánh bot ở điểm 0 ổn, điểm không âm');

  // ---- bảng xếp hạng + hạng ----
  const Q1 = await newUser('arenaQ1');
  const Q2 = await newUser('arenaQ2');
  const Q3 = await newUser('arenaQ3');
  await ed(Q1.id, (s) => ((s.arenaOn = true), (s.arenaRating = 5000), (s.arenaWins = 1)));
  await ed(Q2.id, (s) => ((s.arenaOn = true), (s.arenaRating = 5000), (s.arenaWins = 3)));
  await ed(Q3.id, (s) => ((s.arenaOn = true), (s.arenaRating = 5000), (s.arenaWins = 3)));
  const t1 = await top();
  const names3 = t1.j.rows.slice(0, 3).map((r) => r.username).join();
  ok(t1.status === 200 && names3 === 'arenaQ2,arenaQ3,arenaQ1', 'top: điểm ↓, thắng ↓, id ↑ khi hoà');
  ok(t1.j.rows.every((r, i) => r.rank === i + 1 && (i === 0 || t1.j.rows[i - 1].rating >= r.rating)) && t1.j.rows.length <= 50, 'top: rank 1..n, điểm không tăng');
  ok((await arena(Q2.token)).j.rank === 1 && (await arena(Q3.token)).j.rank === 2 && (await arena(Q1.token)).j.rank === 3, 'rank trong GET arena khớp thứ tự');
  const t2 = await top();
  ok(JSON.stringify(t2.j) === JSON.stringify(t1.j), 'top lần hai (cache) giống nhau');
  const q1f = await afight(Q1.token, 'bot:0');
  const t3 = await top();
  const q1row = t3.j.rows.find((r) => r.username === 'arenaQ1')!;
  ok(q1f.r.status === 200 && q1row.rating === q1f.r.j.rating && q1row.wins === (q1f.r.j.win ? 2 : 1), 'sau trận: top lấy dữ liệu mới (cache bị vô hiệu)');
  ok(!t3.j.rows.some((r) => r.username === 'arenaUntouched' || r.username === 'nguoiA'), 'top chỉ gồm tài khoản đã vào đấu trường');
  ok(botTarget(3, 1234).opp.rating === 1234 + botOffset(3) && JSON.stringify(botTarget(3, 1234)) === JSON.stringify(botTarget(3, 1234)), 'botTarget deterministic theo (n, điểm)');
}
_setHeroesClock(null);

/* ------------------------------------------------------------------ */
// Sự kiện + Bang hội: đồng hồ giả, bắt đầu ở đầu một chu kỳ boss để các ngày trong test không vô tình sang chu kỳ khác
_setHeroesClock(() => T);
process.env.MONKEY_ADMIN_KEY = ADMIN_KEY;
T = Date.UTC(2031, 2, 3, 17, 0, 0) + 3_600_000;
while (dayKey(T) % BOSS_CYCLE_DAYS !== 0) T += DAY; // ngày 0 của một chu kỳ boss, lúc 00:00+1h giờ VN
const CYC0 = T;
const AH = { 'x-admin-key': ADMIN_KEY };
const evSave = (event: unknown, headers: Record<string, string> | undefined = AH) => post<{ event: EventDef; error?: string }>('admin/event-save', { event }, undefined, headers);
const evDel = (id: unknown, headers: Record<string, string> | undefined = AH) => post('admin/event-delete', { id }, undefined, headers);
const evAll = async () => (await call<AdminEventsRes>('GET', 'admin/events', undefined, undefined, AH)).j.events;
const evList = async (tok: string) => (await call<EventsRes>('GET', 'events', undefined, tok)).j.events;
const evOf = async (tok: string, id: number) => (await evList(tok)).find((e) => e.event.id === id);
const evClaim = (tok: string, event: number, objective: string) => post<EventClaimRes & { error?: string }>('event-claim', { event, objective }, tok);
const obj = (id: string, kind: string, target: number, reward: unknown = { wallet: { gold: 1 } }, name = id) => ({ id, kind, name, target, reward });
const baseEv = (o: Record<string, unknown> = {}) => ({ name: 'Thử', desc: 'mô tả', startsAt: T - DAY, endsAt: T + 10 * DAY, enabled: true, objectives: [obj('o1', 'win', 2)], ...o });
const walletOf = (id: number) => mem.view(id, new Date(T), (s) => ({ ...s.wallet }));
const stateOf = (id: number) => mem.view(id, new Date(T), (s) => s);

console.log('— sự kiện: sự kiện mẫu + admin —');
{
  // sự kiện mẫu gieo một lần khi khởi tạo store; còn hiệu lực tại giờ thật
  const seedList = (await evAll()).filter((e) => e.name === SEED_EVENT.name);
  ok(seedList.length === 1, 'sự kiện mẫu có đúng một bản trong store');
  const sv = seedList[0];
  ok(sv.enabled && sv.endsAt - sv.startsAt === SEED_EVENT.days * DAY && JSON.stringify(sv.objectives) === JSON.stringify(SEED_EVENT.objectives) && sv.banner === SEED_EVENT.banner, 'sự kiện mẫu: bật, kéo dài đúng số ngày, mục tiêu khớp SEED_EVENT');
  _setHeroesClock(null);
  const realU = await newUser('evSeedU');
  const rv = await evOf(realU.token, sv.id);
  ok(!!rv && Object.values(rv.progress).every((v) => v === 0) && rv.claimed.length === 0 && Object.keys(rv.progress).length === SEED_EVENT.objectives.length, 'GET events (giờ thật): sự kiện mẫu đang diễn ra, tiến trình 0');
  ok(((await getMe(realU.token)) as MeResponse).eventsClaimable === 0 && (await getMe(realU.token)).guildId === null, 'me: eventsClaimable 0, guildId null cho tài khoản mới');
  _setHeroesClock(() => T);
  ok(!(await evOf(realU.token, sv.id)), 'đồng hồ giả (2031) sau khi sự kiện mẫu hết hạn → không còn trong GET events');
  for (const e of await evAll()) await evDel(e.id); // dọn sạch: các phần dưới tự tạo sự kiện riêng
  ok((await evAll()).length === 0 && (await evDel(99999)).status === 404, 'xoá sự kiện: dọn sạch, xoá id lạ → 404');

  // chặn truy cập admin (mỗi lần sai khoá tính vào bộ giới hạn 10 lần/phút → chỉ thử 3 lần)
  const U0 = await newUser('evPlain');
  ok((await call('GET', 'admin/events')).status === 403, 'admin/events không khoá → 403');
  ok((await evSave(baseEv(), { 'x-admin-key': 'sai-khoa' })).status === 403, 'admin/event-save sai khoá → 403');
  ok((await post('admin/event-delete', { id: 1 }, U0.token)).status === 403 && (await evAll()).length === 0, 'người chơi thường (chỉ có token) không dùng được admin, không tạo/xoá gì');

  // tạo / sửa hợp lệ
  const c1 = await evSave(baseEv({ banner: 'hau_vuong' }));
  ok(c1.status === 200 && c1.j.event.id > 0 && c1.j.event.name === 'Thử' && c1.j.event.banner === 'hau_vuong', 'tạo sự kiện hợp lệ → có id, banner');
  const id1 = c1.j.event.id;
  ok((await evAll()).some((e) => e.id === id1), 'admin/events liệt kê sự kiện vừa tạo');
  const up = await evSave({ ...baseEv({ name: 'Đổi tên' }), id: id1 });
  ok(up.status === 200 && up.j.event.id === id1 && (await evAll()).find((e) => e.id === id1)!.name === 'Đổi tên' && (await evAll()).length === 1, 'sửa theo id: cùng id, không tạo thêm');
  ok((await evSave({ ...baseEv(), id: 424242 })).status === 404, 'sửa id không tồn tại → 404');
  const longName = 'x'.repeat(EVENT_NAME_MAX);
  ok((await evSave(baseEv({ name: longName }))).status === 200 && (await evSave(baseEv({ desc: 'd'.repeat(300) }))).status === 200, 'ranh giới hợp lệ: tên đúng tối đa, mô tả 300 ký tự');

  // ma trận kiểm tra dữ liệu: mỗi luật phải từ chối
  const count0 = (await evAll()).length;
  const bad = async (why: string, ev: unknown) => ok((await evSave(ev)).status === 400, `từ chối: ${why}`);
  await bad('tên rỗng', baseEv({ name: '   ' }));
  await bad(`tên quá ${EVENT_NAME_MAX} ký tự`, baseEv({ name: 'x'.repeat(EVENT_NAME_MAX + 1) }));
  await bad('mô tả > 300', baseEv({ desc: 'd'.repeat(301) }));
  await bad('startsAt = endsAt', baseEv({ startsAt: T, endsAt: T }));
  await bad('startsAt > endsAt', baseEv({ startsAt: T + 5, endsAt: T }));
  await bad('thời gian không phải số', baseEv({ startsAt: 'x' }));
  await bad('enabled không phải boolean', baseEv({ enabled: 'yes' }));
  await bad(`> ${EVENT_MAX_OBJECTIVES} mục tiêu`, baseEv({ objectives: Array.from({ length: EVENT_MAX_OBJECTIVES + 1 }, (_, i) => obj('m' + i, 'win', 1)) }));
  await bad('mục tiêu không phải mảng', baseEv({ objectives: 'x' }));
  await bad('id mục tiêu trùng', baseEv({ objectives: [obj('a', 'win', 1), obj('a', 'summon', 1)] }));
  await bad('id mục tiêu có chữ hoa/khoảng trắng', baseEv({ objectives: [obj('Bad Id', 'win', 1)] }));
  await bad('id mục tiêu 17 ký tự', baseEv({ objectives: [obj('a'.repeat(17), 'win', 1)] }));
  await bad('id mục tiêu rỗng', baseEv({ objectives: [obj('', 'win', 1)] }));
  await bad('loại tiến trình lạ', baseEv({ objectives: [obj('a', 'bay', 1)] }));
  await bad('target 0', baseEv({ objectives: [obj('a', 'win', 0)] }));
  await bad('target > 100000', baseEv({ objectives: [obj('a', 'win', 100_001)] }));
  await bad('target không nguyên', baseEv({ objectives: [obj('a', 'win', 1.5)] }));
  await bad('thưởng vàng âm', baseEv({ objectives: [obj('a', 'win', 1, { wallet: { gold: -1 } })] }));
  await bad('thưởng vàng vượt trần', baseEv({ objectives: [obj('a', 'win', 1, { wallet: { gold: EVENT_WALLET_CAP + 1 } })] }));
  await bad('thưởng vàng không nguyên', baseEv({ objectives: [obj('a', 'win', 1, { wallet: { gold: 1.5 } })] }));
  await bad('loại tiền lạ', baseEv({ objectives: [obj('a', 'win', 1, { wallet: { kimcuong: 5 } })] }));
  await bad('tướng nhận mảnh không tồn tại', baseEv({ objectives: [obj('a', 'win', 1, { shards: { hero: 'tuong-la', n: 5 } })] }));
  await bad('số mảnh 0', baseEv({ objectives: [obj('a', 'win', 1, { shards: { hero: 'hau_vuong', n: 0 } })] }));
  await bad('số mảnh > 1000', baseEv({ objectives: [obj('a', 'win', 1, { shards: { hero: 'hau_vuong', n: 1001 } })] }));
  await bad('trang bị không tồn tại', baseEv({ objectives: [obj('a', 'win', 1, { gear: ['khong_co'] })] }));
  await bad('> 5 trang bị', baseEv({ objectives: [obj('a', 'win', 1, { gear: Array(6).fill('weapon_forest_SR') })] }));
  await bad('banner là tướng không tồn tại', baseEv({ banner: 'tuong-la' }));
  await bad('sự kiện không phải object', 'abc');
  await bad('thiếu mục tiêu', { name: 'x', startsAt: 1, endsAt: 2 });
  ok((await evAll()).length === count0, 'các yêu cầu sai không tạo thêm sự kiện nào');
  ok((await evSave(baseEv({ objectives: [obj('a', 'win', 100_000, { wallet: { gold: EVENT_WALLET_CAP, gems: 0 }, shards: { hero: 'hau_vuong', n: 1000 }, gear: Array(5).fill('weapon_forest_SR') })] }))).status === 200, 'ranh giới hợp lệ: target 100000, thưởng đúng trần, 1000 mảnh, 5 trang bị');
  for (const e of await evAll()) await evDel(e.id);
  ok((await evAll()).length === 0, 'dọn sự kiện thử');
}

console.log('— sự kiện: hook tiến trình —');
{
  const caps = (await evSave(baseEv({ name: 'CAP', objectives: [obj('lv', 'levelup', 2), obj('sm', 'summon', 2), obj('wn', 'win', 1)] }))).j.event;
  const HK = (await evSave(baseEv({ name: 'HK', endsAt: T + 20 * DAY, objectives: EVENT_KINDS.map((k) => obj(k, k, k === 'login' ? 9 : 100, {})) }))).j.event;
  // sự kiện KHÔNG hiệu lực: tương lai, đã hết hạn, đang tắt — tiến trình không được ghi
  const fut = (await evSave(baseEv({ name: 'FUT', startsAt: T + 2 * DAY, endsAt: T + 5 * DAY, objectives: [obj('sm', 'summon', 50)] }))).j.event;
  const past = (await evSave(baseEv({ name: 'PAST', startsAt: T - 5 * DAY, endsAt: T - 1, objectives: [obj('sm', 'summon', 50)] }))).j.event;
  const dis = (await evSave(baseEv({ name: 'DIS', enabled: false, objectives: [obj('sm', 'summon', 50)] }))).j.event;
  const HU = await newUser('evHook'); // đăng ký SAU khi tạo sự kiện → lần chạm đầu tiên tính "đăng nhập"
  const hk = async () => (await evOf(HU.token, HK.id))!.progress;
  const capsP = async () => (await evOf(HU.token, caps.id))!.progress;
  const list0 = await evList(HU.token);
  ok(list0.length === 2 && list0.every((e) => [caps.id, HK.id].includes(e.event.id)), 'GET events chỉ gồm sự kiện đang diễn ra (loại tương lai / hết hạn / tắt)');
  ok((await hk()).login === 1 && Object.keys(await hk()).length === EVENT_KINDS.length, 'login: +1 ở lần chạm đầu tiên (đăng ký), có đủ 8 mục tiêu');
  await ed(HU.id, (s) => void (s.wallet.gold += 1)); // thao tác khác cùng ngày
  ok((await hk()).login === 1, 'login: chạm nhiều lần trong ngày vẫn là 1');
  T += DAY; // từ đây ở lại ngày 1 (không lùi giờ để rollDay không reset lại)
  await ed(HU.id, () => 0);
  ok((await hk()).login === 2, 'login: sang ngày mới +1');

  await strong(HU.id);
  const f1 = await fight(HU.token, '1-1');
  ok(f1.r.j.win && (await hk()).win === 1 && (await capsP()).wn === 1, 'win: thắng ải chiến dịch +1 (HK và CAP)');
  await fight(HU.token, '1-1');
  ok((await capsP()).wn === 1 && (await hk()).win === 2, 'chặn target: CAP (target 1) vẫn 1, HK tăng 2');
  await ed(HU.id, (s) => void (s.progress['1-1'] = { stage: '1-1', stars: 3, clears: 1 }));
  const sw = await post<SweepRes>('sweep', { stage: '1-1', times: 3 }, HU.token);
  ok(sw.status === 200 && (await hk()).win === 5, 'win: quét 3 lần +3');

  const sm = await S(HU.token, { count: 10 });
  ok(sm.status === 200 && (await hk()).summon === 10 && (await capsP()).sm === 2, 'summon: x10 cộng 10 lượt (CAP chặn ở 2)');
  const sm1 = await S(HU.token, { pay: 'gems' });
  ok(sm1.status === 200 && (await hk()).summon === 11, 'summon: x1 cộng 1');

  await ed(HU.id, (s) => void Object.values(s.heroes).forEach((h) => ((h.level = 1), (h.star = 1))));
  const lu = await post<{ gained: number }>('level-up', { hero: 'khien_da', times: 3 }, HU.token);
  ok(lu.status === 200 && lu.j.gained === 3 && (await hk()).levelup === 3 && (await capsP()).lv === 2, 'levelup: +số cấp thực nâng (3), CAP chặn ở 2');

  await ed(HU.id, (s) => void ((s.wallet.gold += 100000), (s.wallet.stones += 500)));
  const g0 = (await getMe(HU.token)).gear[0];
  const gu = await post<{ gained: number }>('gear-upgrade', { uid: g0.uid, times: 2 }, HU.token);
  ok(gu.status === 200 && gu.j.gained === 2 && (await hk()).gear === 2, 'gear: +số cấp cường hoá thực tế (2)');

  await strong(HU.id);
  const tf = await tfight(HU.token);
  ok(tf.r.status === 200 && (await hk()).tower === 1, 'tower: +1 mỗi trận Tháp');
  const af = await post<{ seed: number }>('battle-start', { stage: 'arena' }, HU.token);
  const ar = await post<ArenaBattleRes>('arena-battle', { opponent: 'bot:0', squad: 0, seed: af.j.seed, inputs: [], auto: true }, HU.token);
  ok(ar.status === 200 && (await hk()).arena === (ar.j.win ? 1 : 0), `arena: +1 khi THẮNG (trận này ${ar.j.win ? 'thắng' : 'thua'})`);
  await ed(HU.id, (s) => void (Object.values(s.heroes).forEach((h) => ((h.level = 1), (h.star = 1))), (s.arenaTries = 5)));
  let lostChecked = false;
  for (let n = 99; n > 85 && !lostChecked; n--) {
    const before = (await hk()).arena;
    const st = await post<{ seed: number }>('battle-start', { stage: 'arena' }, HU.token);
    const r2 = await post<ArenaBattleRes>('arena-battle', { opponent: `bot:${n}`, squad: 0, seed: st.j.seed, inputs: [], auto: true }, HU.token);
    if (r2.status === 200 && !r2.j.win) {
      lostChecked = true;
      ok((await hk()).arena === before, 'arena: THUA không cộng tiến trình');
    } else if (r2.status === 200) ok((await hk()).arena === before + 1, 'arena: thắng +1');
  }
  ok(lostChecked, 'arena: có một trận thua để kiểm tra');
  ok((await hk()).guildboss === 0, 'guildboss: chưa đánh boss = 0');
  ok((await getMe(HU.token)).eventsClaimable === 3, 'eventsClaimable: CAP có 3 mục đủ target chưa nhận (win, summon, levelup); HK chưa mục nào');

  // sự kiện không hiệu lực không ghi tiến trình
  const adminNow = await evAll();
  ok([fut, past, dis].every((x) => adminNow.some((e) => e.id === x.id)), 'admin/events vẫn liệt kê sự kiện tương lai / hết hạn / tắt');
  await evSave({ ...dis, enabled: true });
  ok((await evOf(HU.token, dis.id))?.progress.sm === 0, 'bật lại sự kiện từng bị tắt: tiến trình = 0 (không ghi lúc tắt)');
  T += 2 * DAY; // vào cửa sổ của FUT (CYC0+2d .. CYC0+5d)
  ok((await evOf(HU.token, fut.id))?.progress.sm === 0 && !(await evOf(HU.token, past.id)), 'sự kiện tương lai đến giờ: tiến trình 0; sự kiện hết hạn vẫn ẩn');
  const sm2 = await S(HU.token, { pay: 'gems' });
  ok(sm2.status === 200 && (await evOf(HU.token, fut.id))!.progress.sm === 1 && (await evOf(HU.token, dis.id))!.progress.sm === 1, 'đã vào cửa sổ: summon tính cho cả hai');
  for (const e of [caps, HK, fut, past, dis]) await evDel(e.id);
}

console.log('— sự kiện: nhận thưởng —');
{
  const CLd = (await evSave(baseEv({
    name: 'CL', endsAt: T + 20 * DAY,
    objectives: [
      obj('c_w', 'levelup', 1, { wallet: { gold: 123, gems: 7 } }),
      obj('c_so', 'levelup', 1, { shards: { hero: 'khien_da', n: 30 } }),
      obj('c_sn', 'levelup', 1, { shards: { hero: 'hau_vuong', n: 40 } }),
      obj('c_g', 'levelup', 1, { gear: ['weapon_forest_SR', 'weapon_forest_SR'] }),
      obj('c_x', 'levelup', 99, { wallet: { gold: 5 } }),
    ],
  }))).j.event;
  const CU = await newUser('evClaim');
  const CU2 = await newUser('evClaim2');
  const lvl = (tok: string) => post('level-up', { hero: 'khien_da', times: 1 }, tok);
  ok((await evClaim(CU.token, CLd.id, 'c_w')).status === 400, 'chưa làm gì: nhận → 400');
  await lvl(CU.token);
  const me1 = await getMe(CU.token);
  ok(me1.eventsClaimable === 4, 'eventsClaimable = số mục đủ target chưa nhận (4; c_x mới 1/99)');
  const v1 = await evOf(CU.token, CLd.id);
  ok(!!v1 && v1.progress.c_x === 1 && v1.progress.c_w === 1 && v1.claimed.length === 0 && v1.event.objectives.length === 5, 'GET events: tiến trình + danh sách đã nhận');

  // ví
  const w0 = await walletOf(CU.id);
  const c1 = await evClaim(CU.token, CLd.id, 'c_w');
  ok(c1.status === 200 && c1.j.reward.wallet.gold === 123 && c1.j.reward.wallet.gems === 7 && c1.j.reward.gear.length === 0 && !c1.j.reward.shards, 'nhận thưởng ví → reward mô tả đúng');
  const w1 = await walletOf(CU.id);
  ok(w1.gold === w0.gold + 123 && w1.gems === w0.gems + 7 && c1.j.me.wallet.gold === w1.gold, 'ví cộng đúng, me trả về khớp');
  ok(mem.ledger.some((l) => l.accountId === CU.id && l.kind === 'event' && l.delta.gold === 123 && l.delta.gems === 7), 'ledger kind=event');
  ok((await evClaim(CU.token, CLd.id, 'c_w')).status === 400 && (await walletOf(CU.id)).gold === w1.gold, 'nhận lần hai → 400, ví không đổi');
  ok((await evOf(CU.token, CLd.id))!.claimed.join() === 'c_w' && (await getMe(CU.token)).eventsClaimable === 3, 'đã nhận hiện trong claimed, eventsClaimable giảm còn 3');
  // mảnh: đã sở hữu
  const sh0 = (await stateOf(CU.id)).heroes.khien_da.shards;
  const c2 = await evClaim(CU.token, CLd.id, 'c_so');
  ok(c2.status === 200 && (await stateOf(CU.id)).heroes.khien_da.shards === sh0 + 30 && c2.j.reward.shards?.n === 30, 'mảnh tướng ĐÃ có: cộng 30 mảnh');
  // mảnh: chưa sở hữu → tặng tướng cấp 1 sao 1 kèm n mảnh
  ok(!(await stateOf(CU.id)).heroes.hau_vuong, 'chưa có hau_vuong trước khi nhận');
  const c3 = await evClaim(CU.token, CLd.id, 'c_sn');
  const hv = (await stateOf(CU.id)).heroes.hau_vuong;
  ok(c3.status === 200 && !!hv && hv.level === 1 && hv.star === 1 && hv.shards === 40, 'mảnh tướng CHƯA có: tặng tướng cấp 1, 1 sao, shards = n');
  // trang bị
  const gear0 = (await stateOf(CU.id)).gear.length;
  const c4 = await evClaim(CU.token, CLd.id, 'c_g');
  const gs = (await stateOf(CU.id)).gear;
  ok(c4.status === 200 && c4.j.reward.gear.length === 2 && gs.length === gear0 + 2 && gs.slice(-2).every((g) => g.def === 'weapon_forest_SR' && g.level === 0 && g.hero === null), 'trang bị: 2 món vào kho (cấp 0, chưa mặc)');
  // lỗi
  ok((await evClaim(CU.token, CLd.id, 'c_x')).status === 400, 'mục chưa đủ tiến trình → 400');
  ok((await evClaim(CU.token, CLd.id, 'khong-co')).status === 404, 'mục tiêu lạ → 404');
  ok((await evClaim(CU.token, 99999, 'c_w')).status === 404, 'sự kiện lạ → 404');
  ok((await post('event-claim', { event: 'x', objective: 'c_w' }, CU.token)).status === 400 && (await post('event-claim', { event: CLd.id }, CU.token)).status === 400, 'tham số sai kiểu → 400');
  ok((await post('event-claim', { event: CLd.id, objective: 'c_w' })).status === 401, 'không token → 401');
  // tài khoản khác không nhận hộ
  ok((await evClaim(CU2.token, CLd.id, 'c_w')).status === 400, 'tài khoản khác chưa làm → 400 (tiến trình riêng từng người)');
  await lvl(CU2.token);
  const c5 = await evClaim(CU2.token, CLd.id, 'c_w');
  ok(c5.status === 200 && (await evOf(CU2.token, CLd.id))!.claimed.join() === 'c_w', 'tài khoản khác tự nhận được, trạng thái nhận tách riêng');

  // kho trang bị đầy → phần dư đổi ra đá
  const CU3 = await newUser('evClaim3');
  await lvl(CU3.token);
  await ed(CU3.id, (s) => {
    while (s.gear.length < GEAR_CAP - 1) s.gear.push({ uid: 900000 + s.gear.length, def: 'weapon_forest_SR', level: 0, hero: null });
  });
  const st0 = (await walletOf(CU3.id)).stones;
  const c6 = await evClaim(CU3.token, CLd.id, 'c_g');
  const stoneEach = salvageStones(GEAR_BY_ID['weapon_forest_SR'].rarity, 0);
  ok(c6.status === 200 && c6.j.reward.gear.length === 1 && (await stateOf(CU3.id)).gear.length === GEAR_CAP && (await walletOf(CU3.id)).stones === st0 + stoneEach && c6.j.reward.wallet.stones === stoneEach, 'kho còn 1 chỗ: 1 món vào kho, món vượt GEAR_CAP đổi ra đá');
  ok((await getMe(CU3.token)).eventsClaimable === 3, 'CU3 còn 3 mục chờ nhận (c_w, c_so, c_sn)');

  // sự kiện hết hạn / tắt: không nhận được, không tính chấm đỏ
  await evSave({ ...CLd, endsAt: T - 1 });
  ok((await evClaim(CU3.token, CLd.id, 'c_w')).status === 404 && (await getMe(CU3.token)).eventsClaimable === 0 && !(await evOf(CU3.token, CLd.id)), 'sự kiện hết hạn: nhận → 404, eventsClaimable 0, ẩn khỏi GET events');
  await evSave({ ...CLd, enabled: false });
  ok((await evClaim(CU3.token, CLd.id, 'c_w')).status === 404, 'sự kiện đang tắt: nhận → 404');
  await evSave({ ...CLd });
  ok((await getMe(CU3.token)).eventsClaimable === 3 && (await evClaim(CU3.token, CLd.id, 'c_w')).status === 200, 'khôi phục sự kiện: tiến trình còn nguyên, nhận được');

  // sửa sự kiện giữ tiến trình + trạng thái đã nhận; bỏ mục tiêu thì xoá tiến trình của nó
  const edited = { ...CLd, name: 'CL đổi tên', desc: 'mới', objectives: CLd.objectives.filter((o) => o.id !== 'c_x') };
  ok((await evSave(edited)).status === 200, 'sửa sự kiện (đổi tên, bỏ c_x)');
  const v2 = await evOf(CU.token, CLd.id);
  ok(!!v2 && v2.event.name === 'CL đổi tên' && v2.claimed.length === 4 && v2.progress.c_w === 1 && v2.progress.c_x === undefined, 'sau khi sửa: tiến trình + đã nhận của các mục còn lại giữ nguyên, c_x biến mất');
  ok((await evClaim(CU.token, CLd.id, 'c_w')).status === 400, 'đã nhận trước khi sửa vẫn là đã nhận');
  await evSave({ ...edited, objectives: [...edited.objectives, obj('c_x', 'levelup', 99, { wallet: { gold: 5 } })] });
  ok((await evOf(CU.token, CLd.id))!.progress.c_x === 0, 'thêm lại mục c_x: tiến trình về 0 (hàng cũ đã bị xoá)');
  // đổi target xuống: tiến trình hiển thị chặn theo target mới
  await evSave({ ...edited, objectives: edited.objectives.map((o) => (o.id === 'c_so' ? { ...o, target: 1 } : o)) });
  ok((await evOf(CU.token, CLd.id))!.progress.c_so === 1, 'đổi target: vẫn chặn theo target mới');

  // thứ tự mới nhất trước
  const oa = (await evSave(baseEv({ name: 'ORD_A', startsAt: T - 3 * DAY }))).j.event;
  const ob = (await evSave(baseEv({ name: 'ORD_B', startsAt: T - 1 * DAY }))).j.event;
  const ids = (await evList(CU.token)).map((e) => e.event.id);
  ok(ids.indexOf(ob.id) >= 0 && ids.indexOf(ob.id) < ids.indexOf(oa.id), 'GET events: sự kiện bắt đầu muộn hơn đứng trước');
  const nowRes = await call<EventsRes>('GET', 'events', undefined, CU.token);
  ok(nowRes.j.now === T && (await call('GET', 'events')).status === 401, 'GET events trả now của server; không token → 401');

  // xoá sự kiện
  ok((await evDel(CLd.id)).status === 200 && (await evClaim(CU2.token, CLd.id, 'c_so')).status === 404 && !(await evOf(CU.token, CLd.id)), 'xoá sự kiện: không còn xem/nhận được');
  ok((await evDel('x')).status === 400, 'xoá với id sai kiểu → 400');
  for (const e of await evAll()) await evDel(e.id);
}

console.log('— bang hội: lập / vào / rời / quyền —');
while (dayKey(T) % BOSS_CYCLE_DAYS !== 0) T += DAY; // đầu chu kỳ boss kế tiếp
const GC0 = T;
const gp = <R = any>(route: string, body: unknown, tok: string) => post<R & { error?: string }>(route, body, tok);
const ginfo = async (tok: string) => (await call<GuildRes>('GET', 'guild', undefined, tok)).j.info;
const gUser = async (name: string, lvl = 5, gold = 100_000) => {
  const u = await newUser(name);
  await ed(u.id, (s) => void ((s.level = lvl), (s.wallet.gold = gold), (s.wallet.gems = 5000)));
  return u;
};
const gtweak = (id: number, fn: (g: import('../src/heroes/db/store.js').GuildCtx) => void) => mem.mutateGuild(id, new Date(T), 'test', null, (_s, g) => fn(g));
const gsearch = async (tok: string, q = '') => (await call<GuildSearchRes>('GET', 'guild-search?q=' + encodeURIComponent(q), undefined, tok)).j.guilds;
const ledgerKinds = (id: number, kind: string) => mem.ledger.filter((l) => l.accountId === id && l.kind === kind);
let guildA = 0;
let guildB = 0;
const U: Record<string, Awaited<ReturnType<typeof gUser>>> = {};
{
  U.a1 = await gUser('gAlpha1');
  U.a2 = await gUser('gAlpha2');
  U.a3 = await gUser('gAlpha3');
  const low = await newUser('gLowLvl');
  ok((await gp('guild-create', { name: 'Rồng Việt' }, low.token)).status === 400 && (await getMe(low.token)).guildId === null && (await getMe(low.token)).wallet.gold === 5000, `cấp tài khoản < ${GUILD_MIN_ACCOUNT_LEVEL}: không lập được, không mất tiền`);
  ok((await call('GET', 'guild')).status === 401 && (await post('guild-create', { name: 'Abc' })).status === 401 && (await call('GET', 'guild-search')).status === 401, 'bang hội: không token → 401');
  ok((await ginfo(low.token)) === null, 'GET guild khi chưa có bang → info null');

  // luật tên
  const w0 = (await walletOf(U.a1.id)).gold;
  for (const [why, name] of [['quá ngắn', 'ab'], ['quá dài', 'x'.repeat(GUILD_NAME_MAX + 1)], ['hai khoảng trắng liền', 'Ab  cd'], ['có tab', 'Ab\tcd'], ['ký tự đặc biệt <', 'Ab<cd'], ['dấu gạch', 'Ab-cd'], ['toàn khoảng trắng', '     '], ['emoji', 'Bang 😀 vui'], ['kiểu số', 12345]] as const) {
    const r = await gp('guild-create', { name }, U.a1.token);
    ok(r.status === 400, `tên bang bị từ chối: ${why}`);
  }
  ok((await getMe(U.a1.token)).guildId === null && (await walletOf(U.a1.id)).gold === w0, 'tên sai không tạo bang, không trừ tiền');
  const tooPoor = await gUser('gPoor', 5, GUILD_CREATE_COST.gold! - 1);
  const rp = await gp('guild-create', { name: 'Bang Nghèo' }, tooPoor.token);
  ok(rp.status === 400 && /vàng/.test(rp.j.error ?? '') && (await getMe(tooPoor.token)).guildId === null && (await walletOf(tooPoor.id)).gold === GUILD_CREATE_COST.gold! - 1, 'thiếu vàng lập bang → 400, không đổi gì');

  const cr = await gp('guild-create', { name: 'Rồng Việt', notice: 'Chào\tmọi người' }, U.a1.token);
  ok(cr.status === 200 && cr.j.me.guildId! > 0 && cr.j.me.wallet.gold === w0 - GUILD_CREATE_COST.gold!, 'lập bang: trừ đúng phí, me.guildId có giá trị');
  guildA = cr.j.me.guildId!;
  ok(mem.ledger.some((l) => l.accountId === U.a1.id && l.kind === 'guild' && l.delta.gold === -GUILD_CREATE_COST.gold!), 'ledger kind=guild ghi phí lập bang');
  const ia = (await ginfo(U.a1.token))!;
  ok(ia.guild.id === guildA && ia.guild.name === 'Rồng Việt' && ia.guild.level === 1 && ia.guild.exp === 0 && ia.guild.expNext === guildXpToNext(1) && ia.guild.members === 1 && ia.guild.max === GUILD_MAX_MEMBERS && ia.guild.leader === 'gAlpha1' && ia.guild.notice === 'Chào mọi người', 'GuildInfo.guild: id/tên/cấp/exp/expNext/thành viên/bang chủ/thông báo (ký tự điều khiển bị thay)');
  ok(ia.members.length === 1 && ia.members[0].id === U.a1.id && ia.members[0].role === 'leader' && ia.members[0].username === 'gAlpha1' && ia.members[0].contribution === 0 && ia.members[0].bossDamage === 0 && ia.members[0].joinedAt === T, 'GuildInfo.members: bang chủ là thành viên duy nhất');
  ok(ia.mine.role === 'leader' && ia.mine.donated === 0 && !ia.mine.checkedIn && ia.mine.bossTries === BOSS_ATTACKS_PER_DAY, 'GuildInfo.mine: vai trò, đã quyên góp 0, chưa điểm danh, đủ lượt boss');
  ok(ia.boss.cycle === bossCycle(T) && ia.boss.hp === bossHpMax(1) && ia.boss.hpMax === bossHpMax(1) && !ia.boss.killed && ia.boss.level === bossLevel(1) && ia.boss.name === bossName(bossCycle(T)), 'GuildInfo.boss: đầy máu theo cấp bang 1');
  ok((await gp('guild-create', { name: 'Bang Khác' }, U.a1.token)).status === 400 && (await walletOf(U.a1.id)).gold === w0 - GUILD_CREATE_COST.gold!, 'đã ở trong bang: lập thêm → 400, không trừ tiền');
  const dup = await gp('guild-create', { name: 'RỒNG VIỆT' }, U.a2.token);
  ok(dup.status === 409 && (await getMe(U.a2.token)).guildId === null && (await walletOf(U.a2.id)).gold === 100_000, 'tên trùng không phân biệt hoa/thường (có dấu) → 409, không trừ tiền');

  // tìm kiếm
  ok((await gsearch(U.a2.token, 'rong viet')).some((g) => g.id === guildA) && (await gsearch(U.a2.token, 'RỒNG')).some((g) => g.id === guildA) && (await gsearch(U.a2.token, 'ệt')).some((g) => g.id === guildA), 'tìm kiếm không phân biệt hoa/thường và dấu tiếng Việt');
  const sr = (await gsearch(U.a2.token, 'rong viet')).find((g) => g.id === guildA)!;
  ok(sr.name === 'Rồng Việt' && sr.members === 1 && sr.max === GUILD_MAX_MEMBERS && sr.leader === 'gAlpha1' && sr.level === 1 && sr.notice === 'Chào mọi người', 'GuildBrief đủ trường');
  ok((await gsearch(U.a2.token, 'zzzzqq')).length === 0 && (await gsearch(U.a2.token, '')).length >= 1, 'tìm không thấy → rỗng; q rỗng → liệt kê');

  // vào bang
  ok((await gp('guild-join', { id: 99999 }, U.a2.token)).status === 404, 'vào bang không tồn tại → 404');
  ok((await gp('guild-join', { id: guildA }, low.token)).status === 400, 'cấp tài khoản thấp không vào được bang');
  const j2 = await gp('guild-join', { id: guildA }, U.a2.token);
  ok(j2.status === 200 && j2.j.me.guildId === guildA, 'vào bang → me.guildId');
  ok((await gp('guild-join', { id: guildA }, U.a2.token)).status === 400, 'đã ở trong bang → vào lại 400');
  const j3 = await gp('guild-join', { id: guildA }, U.a3.token);
  const ia2 = (await ginfo(U.a1.token))!;
  ok(j3.status === 200 && ia2.members.length === 3 && ia2.members[0].role === 'leader' && ia2.guild.members === 3 && ia2.members.every((m, i, a) => i < 2 || a[i - 1].contribution >= m.contribution), 'ba thành viên; bang chủ đứng đầu danh sách');
  ok((await gp('guild-join', {}, U.a3.token)).status === 400 && (await gp('guild-join', { id: 'x' }, U.a3.token)).status === 400, 'tham số id sai → 400');

  // sức chứa
  const late = await gUser('gLate');
  await gtweak(U.a1.id, (g) => {
    for (let i = 0; g.members.length < GUILD_MAX_MEMBERS; i++) g.members.push({ accountId: 900000 + i, guildId: guildA, role: 'member', contribution: 0, bossDamage: 0, joinedAt: T, donatedDay: 0, donatedN: 0, checkinDay: 0, bossDay: 0, bossTriesUsed: 0 });
  });
  const full = await gp('guild-join', { id: guildA }, late.token);
  ok(full.status === 409 && (await getMe(late.token)).guildId === null, `bang đủ ${GUILD_MAX_MEMBERS} người → 409`);
  await gtweak(U.a1.id, (g) => void (g.members = g.members.filter((m) => m.accountId < 900000)));
  ok((await gp('guild-join', { id: guildA }, late.token)).status === 200, 'còn chỗ → vào được');
  ok((await gp('guild-leave', {}, late.token)).status === 200, 'thành viên rời bang');
  // thời gian chờ sau khi rời
  const other = await gp('guild-create', { name: 'Bang Mới Lập' }, late.token);
  ok(other.status === 400 && /chờ/.test(other.j.error ?? ''), 'vừa rời: lập bang mới bị chặn bởi thời gian chờ');
  ok((await gp('guild-join', { id: guildA }, late.token)).status === 400, 'vừa rời: vào lại bị chặn');
  T += GUILD_REJOIN_COOLDOWN_MS - 60_000;
  ok((await gp('guild-join', { id: guildA }, late.token)).status === 400, 'còn thiếu 1 phút → vẫn chặn');
  T += 120_000;
  const re = await gp('guild-join', { id: guildA }, late.token);
  ok(re.status === 200 && re.j.me.guildId === guildA, 'hết thời gian chờ → vào được');
  ok((await gp('guild-leave', {}, late.token)).status === 200, 'rời bang lần nữa');
  T += GUILD_REJOIN_COOLDOWN_MS + 1000;

  // đuổi / chuyển quyền / thông báo
  ok((await gp('guild-kick', { member: U.a3.id }, U.a2.token)).status === 403, 'thành viên thường không đuổi được ai → 403');
  ok((await gp('guild-kick', { member: U.a1.id }, U.a1.token)).status === 400, 'bang chủ không tự đuổi mình → 400');
  ok((await gp('guild-kick', { member: late.id }, U.a1.token)).status === 404, 'đuổi người không ở bang → 404');
  ok((await gp('guild-notice', { notice: 'hack' }, U.a2.token)).status === 403, 'thành viên thường không sửa thông báo → 403');
  ok((await gp('guild-notice', { notice: 'x'.repeat(GUILD_NOTICE_MAX + 1) }, U.a1.token)).status === 400, `thông báo > ${GUILD_NOTICE_MAX} ký tự → 400`);
  ok((await gp('guild-notice', { notice: 5 }, U.a1.token)).status === 400, 'thông báo sai kiểu → 400');
  const nt = await gp('guild-notice', { notice: '  Họp\nlúc 8h  ' }, U.a1.token);
  ok(nt.status === 200 && (await ginfo(U.a2.token))!.guild.notice === 'Họp lúc 8h', 'bang chủ sửa thông báo (cắt khoảng trắng, bỏ ký tự điều khiển)');
  ok((await gp('guild-notice', { notice: 'x'.repeat(GUILD_NOTICE_MAX) }, U.a1.token)).status === 200 && (await gp('guild-notice', { notice: '' }, U.a1.token)).status === 200, 'thông báo đúng tối đa / rỗng đều hợp lệ');
  ok((await gp('guild-transfer', { member: U.a3.id }, U.a2.token)).status === 403, 'thành viên thường không chuyển quyền → 403');
  ok((await gp('guild-transfer', { member: U.a1.id }, U.a1.token)).status === 400, 'chuyển quyền cho chính mình → 400');
  ok((await gp('guild-transfer', { member: late.id }, U.a1.token)).status === 404, 'chuyển quyền cho người ngoài bang → 404');
  ok((await gp('guild-leave', {}, U.a1.token)).status === 400, 'bang chủ còn thành viên không rời được → 400');
  const kk = await gp('guild-kick', { member: U.a3.id }, U.a1.token);
  ok(kk.status === 200 && (await getMe(U.a3.token)).guildId === null && (await ginfo(U.a1.token))!.members.length === 2 && (await ginfo(U.a3.token)) === null, 'bang chủ đuổi thành viên: bị đuổi mất bang, danh sách còn 2');
  ok((await gp('guild-join', { id: guildA }, U.a3.token)).status === 200, 'người bị đuổi (không bị phạt thời gian chờ) vào lại được');
  const tr = await gp('guild-transfer', { member: U.a2.id }, U.a1.token);
  const ib = (await ginfo(U.a1.token))!;
  ok(tr.status === 200 && ib.mine.role === 'member' && ib.members[0].id === U.a2.id && ib.members[0].role === 'leader' && ib.guild.leader === 'gAlpha2', 'chuyển quyền: bang chủ mới đứng đầu, vai trò cũ thành thành viên');
  ok((await gp('guild-notice', { notice: 'cũ' }, U.a1.token)).status === 403 && (await gp('guild-kick', { member: U.a3.id }, U.a1.token)).status === 403, 'bang chủ cũ mất quyền');
  // bang chủ mới đuổi a3 rồi a3 vào lại, để còn dùng
  ok((await gp('guild-leave', {}, U.a1.token)).status === 200, 'bang chủ cũ giờ rời được');
  T += GUILD_REJOIN_COOLDOWN_MS + 1000;
  await gp('guild-join', { id: guildA }, U.a1.token);

  // giải tán khi chỉ còn bang chủ
  const solo = await gUser('gSolo');
  const sc = await gp('guild-create', { name: 'Bang Một Người' }, solo.token);
  const soloId = sc.j.me.guildId!;
  ok(sc.status === 200 && (await gsearch(solo.token, 'một người')).some((g) => g.id === soloId), 'bang một người xuất hiện khi tìm');
  const sl = await gp('guild-leave', {}, solo.token);
  ok(sl.status === 200 && sl.j.me.guildId === null && !(await gsearch(solo.token, 'một người')).some((g) => g.id === soloId) && (await gp('guild-join', { id: soloId }, U.a3.token)).status === 404, 'bang chủ rời khi chỉ còn một mình → bang bị giải tán');
  ok((await gp('guild-leave', {}, solo.token)).status === 400, 'rời khi không có bang → 400');
  ok((await gp('guild-donate', { option: 'd1' }, solo.token)).status === 400 && (await gp('guild-checkin', {}, solo.token)).status === 400 && (await gp('guild-notice', { notice: 'a' }, solo.token)).status === 400, 'chưa có bang: quyên góp / điểm danh / thông báo → 400');
}

console.log('— bang hội: quyên góp / điểm danh —');
{
  // bang A hiện: a2 (bang chủ), a3, a1
  const ldr = U.a2;
  const D1 = GUILD_DONATIONS[0];
  const D2 = GUILD_DONATIONS[1];
  const w = await walletOf(ldr.id);
  const d1 = await gp('guild-donate', { option: 'd1' }, ldr.token);
  const i1 = (await ginfo(ldr.token))!;
  ok(d1.status === 200 && d1.j.me.wallet.gold === w.gold - D1.cost.gold! && i1.guild.exp === D1.gexp && i1.members[0].contribution === D1.contribution && i1.mine.donated === 1, 'quyên góp d1: trừ vàng, +exp bang, +cống hiến, đếm lượt');
  ok(mem.ledger.some((l) => l.accountId === ldr.id && l.kind === 'guild' && l.delta.gold === -D1.cost.gold!), 'ledger kind=guild cho quyên góp');
  ok((await gp('guild-donate', { option: 'd2' }, ldr.token)).status === 200 && (await walletOf(ldr.id)).gems === w.gems - D2.cost.gems!, 'quyên góp d2 trừ kim cương');
  ok((await gp('guild-donate', { option: 'd1' }, ldr.token)).status === 200, 'lượt thứ 3 trong ngày hợp lệ');
  const wLim = await walletOf(ldr.id);
  const lim = await gp('guild-donate', { option: 'd1' }, ldr.token);
  ok(GUILD_DONATE_PER_DAY === 3 && lim.status === 400 && JSON.stringify(await walletOf(ldr.id)) === JSON.stringify(wLim) && (await ginfo(ldr.token))!.mine.donated === 3, 'quá giới hạn lượt/ngày → 400, không trừ tiền');
  ok((await gp('guild-donate', { option: 'zz' }, ldr.token)).status === 404 && (await gp('guild-donate', {}, ldr.token)).status === 400, 'mức quyên góp lạ → 404, thiếu → 400');
  T += DAY;
  ok((await ginfo(ldr.token))!.mine.donated === 0, 'sang ngày: lượt quyên góp reset (hiển thị)');
  // không đủ tiền: không đổi gì, ví không âm
  await ed(ldr.id, (s) => void (s.wallet.gold = 100));
  const exp0 = (await ginfo(ldr.token))!.guild.exp;
  const poor = await gp('guild-donate', { option: 'd1' }, ldr.token);
  ok(poor.status === 400 && (await walletOf(ldr.id)).gold === 100 && (await ginfo(ldr.token))!.guild.exp === exp0 && (await ginfo(ldr.token))!.mine.donated === 0, 'thiếu tiền: 400, không cộng exp/đếm lượt, ví không âm');
  await ed(ldr.id, (s) => void (s.wallet.gold = 100_000));
  // vòng lặp lên cấp: nhiều cấp liền
  await gtweak(ldr.id, (g) => void (g.guild!.exp = 1999));
  ok((await gp('guild-donate', { option: 'd1' }, ldr.token)).status === 200, 'quyên góp khi exp sát ngưỡng');
  let lvE = 1;
  let ex = 1999 + D1.gexp;
  while (ex >= guildXpToNext(lvE)) (ex -= guildXpToNext(lvE)), lvE++;
  const ij = (await ginfo(ldr.token))!;
  ok(lvE === 3 && ij.guild.level === lvE && ij.guild.exp === ex && ij.guild.expNext === guildXpToNext(lvE), `lên nhiều cấp liền một lần quyên góp (→ cấp ${lvE}, exp dư ${ex})`);
  // cấp tối đa: exp dư bị bỏ
  await gtweak(ldr.id, (g) => void ((g.guild!.level = GUILD_MAX_LEVEL), (g.guild!.exp = guildXpToNext(GUILD_MAX_LEVEL) - 5)));
  ok((await gp('guild-donate', { option: 'd2' }, ldr.token)).status === 200, 'quyên góp ở gần cấp tối đa');
  const imax = (await ginfo(ldr.token))!;
  ok(imax.guild.level === GUILD_MAX_LEVEL && imax.guild.exp === 0, 'cấp tối đa: không lên nữa, exp dư bị bỏ (0)');
  ok((await gp('guild-donate', { option: 'd2' }, ldr.token)).status === 200 && (await ginfo(ldr.token))!.guild.level === GUILD_MAX_LEVEL && (await ginfo(ldr.token))!.guild.exp === 0, 'ở cấp tối đa vẫn quyên góp được, exp giữ 0');
  await gtweak(ldr.id, (g) => void ((g.guild!.level = 1), (g.guild!.exp = 0)));
  // điểm danh
  const gB = await gUser('gBeta1');
  const b1c = await gp('guild-create', { name: 'Bang Beta' }, gB.token);
  const bId = b1c.j.me.guildId!;
  const wb = await walletOf(gB.id);
  const ck = await gp<{ reward: Record<string, number> }>('guild-checkin', {}, gB.token);
  const rw = guildCheckinReward(1);
  const wa = await walletOf(gB.id);
  ok(ck.status === 200 && JSON.stringify(ck.j.reward) === JSON.stringify(rw) && wa.gold === wb.gold + rw.gold! && wa.stones === wb.stones + (rw.stones ?? 0) && wa.tickets === wb.tickets + (rw.tickets ?? 0), 'điểm danh: trả đúng guildCheckinReward theo cấp bang');
  ok((await ginfo(gB.token))!.guild.exp === 5 && (await ginfo(gB.token))!.mine.checkedIn, 'điểm danh +5 exp bang, đánh dấu đã điểm danh');
  ok(mem.ledger.some((l) => l.accountId === gB.id && l.kind === 'guild' && l.delta.gold === rw.gold), 'ledger kind=guild cho điểm danh');
  const ck2 = await gp('guild-checkin', {}, gB.token);
  ok(ck2.status === 400 && (await walletOf(gB.id)).gold === wa.gold && (await ginfo(gB.token))!.guild.exp === 5, 'điểm danh lần hai trong ngày → 400, không cộng gì');
  T += DAY;
  ok(!(await ginfo(gB.token))!.mine.checkedIn && (await gp('guild-checkin', {}, gB.token)).status === 200 && (await ginfo(gB.token))!.guild.exp === 10, 'sang ngày mới điểm danh lại được');
  // thưởng điểm danh theo cấp bang: cấp 5 có vé + đá
  await gtweak(gB.id, (g) => void (g.guild!.level = 5));
  T += DAY;
  const wb5 = await walletOf(gB.id);
  const ck5 = await gp('guild-checkin', {}, gB.token);
  const r5 = guildCheckinReward(5);
  const wa5 = await walletOf(gB.id);
  ok(ck5.status === 200 && wa5.tickets === wb5.tickets + r5.tickets! && wa5.stones === wb5.stones + r5.stones! && r5.tickets === 1, 'bang cấp 5: điểm danh có thêm vé + đá');
  U.gB = gB;
  guildB = bId;
}
console.log('— bang hội: boss —');
{
  const gB = U.gB;
  const bId = guildB;
  while (dayKey(T) % BOSS_CYCLE_DAYS !== 0) T += DAY; // đầu một chu kỳ boss mới (bang Beta vẫn lưu boss của chu kỳ cũ)
  const cyc = bossCycle(T);
  const b2 = await gUser('gBeta2');
  const b3 = await gUser('gBeta3');
  const b4 = await gUser('gBeta4');
  for (const u of [b2, b3, b4]) await gp('guild-join', { id: bId }, u.token);
  Object.assign(U, { b2, b3, b4 });
  const GBev = (await evSave(baseEv({ name: 'GB', startsAt: T - DAY, endsAt: T + 40 * DAY, objectives: [obj('boss', 'guildboss', 3)] }))).j.event;

  // reset lười theo chu kỳ (chỉ hiển thị, chưa ghi) + hp theo cấp bang HIỆN TẠI (5)
  const hpMax5 = Math.round(bossHpMax(5));
  const i0 = (await ginfo(gB.token))!;
  ok(i0.guild.level === 5 && i0.boss.cycle === cyc && i0.boss.hpMax === hpMax5 && i0.boss.hp === hpMax5 && !i0.boss.killed && i0.boss.level === bossLevel(5), 'sang chu kỳ mới: boss đầy máu theo CẤP BANG hiện tại (hiển thị áp reset lười)');

  const bfight = async (tok: string, extra: Record<string, unknown> = {}, stage = 'guildboss') => {
    const st = await post<{ seed: number }>('battle-start', { stage }, tok);
    const r = await post<GuildBossRes & { error?: string }>('guild-boss', { squad: 0, seed: st.j.seed, inputs: [], auto: true, ...extra }, tok);
    return { seed: st.j.seed, r };
  };
  const expectDmg = async (id: number, guildLevel: number, seed: number) => {
    const s = await stateOf(id);
    const units = s.squads[0].flatMap((hid, slot) => (hid && s.heroes[hid] ? [heroUnit(s.heroes[hid], slot, sumGear(s.gear.filter((g) => g.hero === hid)))] : []));
    return bossDamage(simulate(bossSetup(guildLevel, bossCycle(T), seed, units), [], true).events);
  };

  // chỉ thành viên bang mới đánh được; seed bị tiêu dù lỗi
  const outsider = await gUser('gOutsider');
  const o1 = await bfight(outsider.token);
  ok(o1.r.status === 400 && /bang/.test(o1.r.j.error ?? ''), 'không thuộc bang: đánh boss → 400');
  const o2 = await post('guild-boss', { squad: 0, seed: o1.seed, inputs: [], auto: true }, outsider.token);
  ok(o2.status === 400, 'seed của lần bị từ chối đã bị tiêu (dùng lại → 400)');
  ok((await post('guild-boss', { squad: 0, seed: 12345, inputs: [], auto: true }, gB.token)).status === 400, 'seed chưa cấp → 400');
  ok((await post('guild-boss', { squad: 0, seed: 1, inputs: [], auto: true })).status === 401, 'không token → 401');

  // trang bị phải được tính vào đội đánh boss
  const gearU = (await getMe(gB.token)).gear[0];
  await gp('gear-equip', { uid: gearU.uid, hero: 'khien_da' }, gB.token);
  ok((await stateOf(gB.id)).gear.some((g) => g.hero === 'khien_da'), 'đã mặc trang bị cho tướng trước khi đánh boss');

  const wB0 = await walletOf(gB.id);
  const f1 = await bfight(gB.token);
  const e1 = Math.min(await expectDmg(gB.id, 5, f1.seed), hpMax5);
  ok(f1.r.status === 200 && f1.r.j.damage === e1 && e1 > 0, `sát thương = bossDamage(simulate(bossSetup(...))) = ${e1} (đã gồm trang bị)`);
  ok(f1.r.j.boss.hp === hpMax5 - e1 && f1.r.j.boss.hpMax === hpMax5 && !f1.r.j.killed && f1.r.j.boss.cycle === cyc, 'boss trừ máu đúng, chưa hạ');
  const rw1 = bossAttackReward(e1);
  const wB1 = await walletOf(gB.id);
  ok(JSON.stringify(f1.r.j.reward) === JSON.stringify(rw1) && wB1.gold === wB0.gold + rw1.gold! && wB1.stones === wB0.stones + (rw1.stones ?? 0), 'thưởng lượt đánh = bossAttackReward(sát thương) vào ví');
  const ib1 = (await ginfo(gB.token))!;
  ok(ib1.boss.hp === hpMax5 - e1 && ib1.members[0].bossDamage === e1 && ib1.mine.bossTries === BOSS_ATTACKS_PER_DAY - 1, 'GET guild: máu boss + sát thương cá nhân + lượt còn lại');
  ok(mem.runs.some((r) => r.accountId === gB.id && r.stage === 'guildboss') && mem.ledger.some((l) => l.accountId === gB.id && l.kind === 'guild-boss'), 'ghi h_runs stage guildboss + ledger kind guild-boss');
  ok((await post('guild-boss', { squad: 0, seed: f1.seed, inputs: [], auto: true }, gB.token)).status === 400, 'seed dùng một lần: dùng lại → 400');
  ok((await evOf(gB.token, GBev.id))!.progress.boss === 1, 'sự kiện guildboss +1 mỗi lượt đánh');

  const f2 = await bfight(gB.token);
  const f3 = await bfight(gB.token);
  ok(f2.r.status === 200 && f3.r.status === 200 && (await ginfo(gB.token))!.mine.bossTries === 0 && (await evOf(gB.token, GBev.id))!.progress.boss === 3, `${BOSS_ATTACKS_PER_DAY} lượt/ngày: dùng hết, sự kiện guildboss = 3`);
  const hpAfter3 = (await ginfo(gB.token))!.boss.hp;
  const f4 = await bfight(gB.token);
  ok(f4.r.status === 400 && /lượt/.test(f4.r.j.error ?? '') && (await ginfo(gB.token))!.boss.hp === hpAfter3, 'hết lượt trong ngày → 400, boss không mất máu');
  T += DAY;
  const f5 = await bfight(gB.token);
  ok(f5.r.status === 200 && (await ginfo(gB.token))!.mine.bossTries === BOSS_ATTACKS_PER_DAY - 1, 'sang ngày: lượt đánh boss reset');
  ok((await evOf(gB.token, GBev.id))!.progress.boss === 3, 'sự kiện guildboss chặn ở target 3');
  const dmgB1 = (await ginfo(gB.token))!.members.find((m) => m.id === gB.id)!.bossDamage;
  ok(dmgB1 === f1.r.j.damage + f2.r.j.damage + f3.r.j.damage + f5.r.j.damage, 'sát thương cá nhân cộng dồn qua các lượt/ngày trong chu kỳ');

  // b2 đánh một lượt; hóa đơn: input không hợp lệ bị bỏ qua, chỉ auto
  const fb2 = await bfight(b2.token, { auto: false, inputs: [{ tick: 5, ult: 0 }] });
  ok(fb2.r.status === 200 && fb2.r.j.damage > 0, 'đánh với inputs thủ công / auto=false: server chạy simulate với đúng inputs');

  // kẹp theo máu còn lại + hạ boss: thưởng phát cho MỌI người đã gây sát thương
  await gtweak(gB.id, (g) => void (g.guild!.bossHp = 100));
  const w3 = await walletOf(b3.id);
  const kill = await bfight(b3.token);
  const w3a = await walletOf(b3.id);
  ok(kill.r.status === 200 && kill.r.j.damage === 100 && kill.r.j.killed && kill.r.j.boss.hp === 0 && kill.r.j.boss.killed, 'đòn cuối: sát thương bị kẹp bằng máu còn lại (100), boss bị hạ');
  ok(w3a.gems === w3.gems + BOSS_KILL_REWARD.gems! && w3a.tickets === w3.tickets + BOSS_KILL_REWARD.tickets! && w3a.gold === w3.gold + bossAttackReward(100).gold!, 'người hạ boss nhận thưởng hạ boss ngay (+ thưởng lượt đánh)');
  ok((await mem.pendingKill(gB.id)) === 1 && (await mem.pendingKill(b2.id)) === 1 && (await mem.pendingKill(b3.id)) === 0 && (await mem.pendingKill(b4.id)) === 0, 'xếp hàng thưởng: b1 và b2 (đã đánh) có 1, người hạ boss và người chưa đánh không có');
  const w1k = await walletOf(gB.id);
  await getMe(gB.token); // chạm hồ sơ → nhận thưởng đang chờ
  const w1ka = await walletOf(gB.id);
  ok(w1ka.gems === w1k.gems + BOSS_KILL_REWARD.gems! && w1ka.tickets === w1k.tickets + BOSS_KILL_REWARD.tickets! && (await mem.pendingKill(gB.id)) === 0, 'người đóng góp nhận thưởng hạ boss ở lần chạm kế tiếp');
  await getMe(gB.token);
  await ginfo(gB.token);
  await gp('guild-checkin', {}, gB.token); // thao tác khác sau đó
  ok((await walletOf(gB.id)).gems === w1ka.gems, 'nhận đúng MỘT lần (chạm nhiều lần không cộng thêm)');
  const w2k = await walletOf(b2.id);
  await ginfo(b2.token); // GET guild cũng nhận thưởng
  ok((await walletOf(b2.id)).gems === w2k.gems + BOSS_KILL_REWARD.gems! && ledgerKinds(b2.id, 'guild-boss-kill').length === 1 && ledgerKinds(gB.id, 'guild-boss-kill').length === 1, 'GET guild cũng nhận thưởng; ledger kind=guild-boss-kill một dòng mỗi người');
  const w4 = await walletOf(b4.id);
  await getMe(b4.token);
  ok((await walletOf(b4.id)).gems === w4.gems && ledgerKinds(b4.id, 'guild-boss-kill').length === 0 && ledgerKinds(b3.id, 'guild-boss-kill').length === 0, 'người chưa đánh không nhận; người hạ boss không nhận hai lần');
  ok(Object.values((await walletOf(gB.id))).every((v) => v >= 0), 'ví không âm');

  const triesB2 = (await ginfo(b2.token))!.mine.bossTries;
  const afterKill = await bfight(b2.token);
  ok(afterKill.r.status === 400 && /hạ/.test(afterKill.r.j.error ?? '') && (await ginfo(b2.token))!.mine.bossTries === triesB2, 'boss đã bị hạ: đánh tiếp → 400, không tốn lượt');
  T += DAY;
  ok((await bfight(gB.token)).r.status === 400, 'qua ngày nhưng cùng chu kỳ: boss vẫn đã bị hạ');

  // chu kỳ mới: máu đầy theo cấp bang HIỆN TẠI, sát thương cá nhân về 0, đánh được lại
  await gtweak(gB.id, (g) => void (g.guild!.level = 6));
  while (bossCycle(T) === cyc) T += DAY;
  const hpMax6 = Math.round(bossHpMax(6));
  const inew = (await ginfo(b2.token))!;
  ok(inew.boss.cycle === cyc + 1 && inew.boss.hp === hpMax6 && inew.boss.hpMax === hpMax6 && !inew.boss.killed && inew.members.every((m) => m.bossDamage === 0) && inew.boss.name === bossName(cyc + 1), 'chu kỳ mới: hp = hpMax(cấp bang 6), hết bị hạ, sát thương mọi người về 0');
  const nb = await bfight(b2.token);
  const ei = (await ginfo(b3.token))!;
  ok(nb.r.status === 200 && nb.r.j.boss.cycle === cyc + 1 && ei.boss.hp === hpMax6 - nb.r.j.damage && ei.members.find((m) => m.id === b2.id)!.bossDamage === nb.r.j.damage && ei.members.filter((m) => m.bossDamage > 0).length === 1, 'đánh ở chu kỳ mới: reset đã được ghi, chỉ người vừa đánh có sát thương');
  ok((await mem.pendingKill(b2.id)) === 0 && (await mem.pendingKill(gB.id)) === 0, 'chu kỳ mới không phát lại thưởng hạ boss cũ');
  await evDel(GBev.id);
}

console.log('— bang hội: chat —');
{
  const gB = U.gB;
  const tokB2 = U.b2.token;
  const chat = async (tok: string) => call<GuildChatRes & { error?: string }>('GET', 'guild-chat', undefined, tok);
  const say = (tok: string, text: unknown) => post<GuildChatRes & { error?: string }>('guild-chat', { text }, tok);
  const out = await gUser('gChatOut');
  ok((await chat(out.token)).status === 403 && (await say(out.token, 'xin chào')).status === 400, 'không thuộc bang: đọc → 403, nhắn → 400');
  ok((await chat(U.a2.token).then((r) => r.status)) === 200 && (await call('GET', 'guild-chat')).status === 401 && (await post('guild-chat', { text: 'x' })).status === 401, 'thành viên đọc được; không token → 401');
  const m1 = await say(gB.token, '  Xin chào\t<b>mọi</b>\nngười\u0007!  ');
  const last = m1.j.messages[m1.j.messages.length - 1];
  ok(m1.status === 200 && last.text === 'Xin chào <b>mọi</b> người !' && last.username === 'gBeta1' && last.at === T && last.id > 0, 'tin nhắn được cắt khoảng trắng, ký tự điều khiển → khoảng trắng, không lọc HTML');
  const rl = await say(gB.token, 'nhắn nhanh quá');
  ok(rl.status === 429, 'nhắn liên tiếp < 1.5 giây → 429');
  T += 1400;
  ok((await say(gB.token, 'vẫn nhanh')).status === 429, '1.4 giây vẫn bị chặn');
  T += 200;
  const m2 = await say(gB.token, 'ổn rồi');
  ok(m2.status === 200 && m2.j.messages.length === 2 && m2.j.messages[0].id < m2.j.messages[1].id && m2.j.messages[1].text === 'ổn rồi', 'đủ 1.5 giây nhắn được; danh sách cũ → mới');
  T += 2000;
  ok((await say(gB.token, '   ')).status === 400 && (await say(gB.token, '\n\t')).status === 400 && (await say(gB.token, '')).status === 400 && (await say(gB.token, 42)).status === 400, 'tin rỗng / toàn khoảng trắng / sai kiểu → 400');
  ok((await say(gB.token, 'x'.repeat(GUILD_CHAT_MAX + 1))).status === 400, `tin > ${GUILD_CHAT_MAX} ký tự → 400`);
  T += 2000;
  const sur = await say(gB.token, 'a\ud800b');
  const surLast = sur.j.messages[sur.j.messages.length - 1].text;
  ok(sur.status === 200 && surLast === 'a b', 'ký tự thay thế UTF-16 lẻ bị thay → JSON/Postgres an toàn');
  T += 2000;
  ok((await say(gB.token, 'x'.repeat(GUILD_CHAT_MAX))).status === 200, `tin đúng ${GUILD_CHAT_MAX} ký tự hợp lệ`);
  // bang khác không thấy
  T += 2000;
  await say(U.a2.token, 'tin của bang Rồng Việt');
  ok(!(await chat(gB.token)).j.messages.some((m) => m.text.includes('Rồng Việt')) && (await chat(U.a2.token)).j.messages.length === 1, 'chat tách riêng từng bang');
  // giữ GUILD_CHAT_KEEP tin cuối; API trả 50 tin cuối cũ → mới
  for (let i = 0; i < GUILD_CHAT_KEEP + 5; i++) {
    T += 1600;
    const r = await say(tokB2, '#' + i);
    if (r.status !== 200) ok(false, 'nhắn #' + i + ' thất bại ' + r.status);
  }
  const all = await mem.guildChat(gB.id, 1000);
  ok(all!.length === GUILD_CHAT_KEEP && all![all!.length - 1].text === '#' + (GUILD_CHAT_KEEP + 4), `chỉ giữ ${GUILD_CHAT_KEEP} tin cuối trong bang`);
  const api50 = (await chat(gB.token)).j.messages;
  ok(api50.length === 50 && api50[0].text === '#' + (GUILD_CHAT_KEEP + 5 - 50) && api50[49].text === '#' + (GUILD_CHAT_KEEP + 4) && api50.every((m, i, a) => i === 0 || a[i - 1].id < m.id), 'GET guild-chat: đúng 50 tin cuối, cũ → mới');
  ok(JSON.stringify(api50).length > 0 && !/\ud800/.test(JSON.stringify(api50)), 'phản hồi JSON hợp lệ, không chứa ký tự thay thế lẻ');
}

console.log('— bang hội: tìm kiếm / thông tin —');
{
  for (let i = 1; i <= 21; i++) {
    const u = await gUser('gMau' + String(i).padStart(2, '0'));
    const c = await gp('guild-create', { name: 'Bang Mẫu ' + String(i).padStart(2, '0') }, u.token);
    if (c.status !== 200) ok(false, 'tạo bang mẫu ' + i);
  }
  const q = await gsearch(U.a2.token, 'bang mau');
  ok(q.length === 20 && q.every((g) => /^Bang Mẫu \d\d$/.test(g.name)), 'tìm "bang mau" (không dấu) → tối đa 20 kết quả');
  const all = await gsearch(U.a2.token, '');
  ok(all.length === 20 && all.every((g, i) => i === 0 || all[i - 1].members > g.members || (all[i - 1].members === g.members && all[i - 1].id < g.id)), 'q rỗng: sắp thành viên giảm dần rồi id tăng dần, tối đa 20');
  ok(all[0].name === 'Bang Beta' && all[0].members === 4 && all[1].name === 'Rồng Việt' && all[1].members === 3, 'đông nhất đứng đầu (Beta 4, Rồng Việt 3)');
  ok((await gsearch(U.a2.token, 'x'.repeat(100))).length === 0, 'chuỗi tìm quá dài được cắt, không lỗi');
  // thông tin bang: thứ tự thành viên bang chủ trước rồi cống hiến giảm dần
  const gB = U.gB;
  await gtweak(gB.id, (g) => {
    const ids: Record<string, number> = { gBeta2: U.b2.id, gBeta3: U.b3.id, gBeta4: U.b4.id };
    const by = (n: string) => g.members.find((m) => m.accountId === ids[n])!;
    by('gBeta2').contribution = 50;
    by('gBeta3').contribution = 70;
    by('gBeta4').contribution = 10;
  });
  const ib = (await ginfo(gB.token))!;
  ok(ib.members.length === 4 && ib.members[0].role === 'leader' && ib.members.slice(1).map((m) => m.username).join() === 'gBeta3,gBeta2,gBeta4', 'GuildInfo.members: bang chủ đầu, rồi cống hiến giảm dần');
  ok(typeof ib.guild.expNext === 'number' && ib.members.every((m) => typeof m.joinedAt === 'number' && m.joinedAt > 0) && Object.keys(ib.boss).sort().join() === 'cycle,hp,hpMax,killed,level,name', 'GuildInfo: kiểu dữ liệu + các trường boss đầy đủ');
}
_setHeroesClock(null);

ok(mem.ledger.every((l) => Object.values(l.delta).every((v) => Number.isInteger(v))), 'ledger toàn số nguyên');
server.close();

/* ------------------------------------------------------------------ */
// tích hợp Postgres (tuỳ chọn)
loadDotEnv();
if (process.env.DATABASE_URL) {
  console.log('— tích hợp Postgres (schema tạm) —');
  const schema = 'test_h_' + randomBytes(5).toString('hex');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pgs = new PgStore({ connectionString: process.env.DATABASE_URL, schema, max: 2 });
  try {
    await pgs.init();
    const hs = new HeroPgStore(pgs.pool, (pgs as unknown as { S: string }).S);
    await hs.init();
    await hs.init(); // migrate chạy lại an toàn
    const q = (sql: string, p: unknown[] = []) => pgs.pool.query(sql.replaceAll('$S', `"${schema}".`), p);
    const id = (await pgs.createAccount('pgtest', 'x'))!;
    const nowD = new Date();
    const prof = await hs.view(id, nowD, (s) => s);
    ok(prof.wallet.gold === 5000 && Object.keys(prof.heroes).length === STARTER_HEROES.length && prof.squads[0][0] === STARTER_HEROES[0], 'PG: hồ sơ khởi đầu');
    const starters = (await q(`SELECT count(*)::int AS n FROM $Sh_ledger WHERE account_id=$1 AND kind='starter'`, [id])).rows[0].n;
    ok(starters === 1, 'PG: ledger starter đúng một dòng');
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const idem = { key: 'pgkey-12345', tag: 'standard|10|tickets' };
    const x1 = await hs.mutate(id, nowD, 'summon', (s) => opSummon(s, 'standard', 10, 'tickets', rnd), { idem });
    const x2 = await hs.mutate(id, nowD, 'summon', (s) => opSummon(s, 'standard', 10, 'tickets', rnd), { idem });
    const ids = (x: typeof x1) => x.map((p) => `${p.heroId}:${p.isNew}:${p.shards}`).join();
    ok(ids(x1) === ids(x2), 'PG: idempotency trả lại kết quả cũ (jsonb đổi thứ tự khoá nên so theo trường)');
    const after = await hs.view(id, nowD, (s) => s);
    ok(after.wallet.tickets === 0 && Object.keys(after.heroes).length >= STARTER_HEROES.length && (after.pity.standard?.sinceSSR ?? -1) >= 0, 'PG: trừ vé một lần, tướng + pity được lưu');
    let neg = false;
    try {
      await hs.mutate(id, nowD, 'summon', (s) => opSummon(s, 'standard', 10, 'tickets', rnd), { idem: { key: 'pgkey-99999', tag: 'x' } });
    } catch {
      neg = true;
    }
    ok(neg && (await hs.view(id, nowD, (s) => s.wallet.tickets)) === 0, 'PG: thiếu vé → lỗi, rollback, không âm');
    const led = (await q(`SELECT count(*)::int AS n FROM $Sh_ledger WHERE account_id=$1 AND kind='summon'`, [id])).rows[0].n;
    ok(led === 1, 'PG: ledger summon một dòng');
    await hs.mutate(id, nowD, 'test', (s) => {
      s.progress['1-1'] = { stage: '1-1', stars: 3, clears: 2 };
      s.progress['1-3'] = { stage: '1-3', stars: 1, clears: 1 };
      s.runs.push({ stage: '1-3', win: true, stars: 1, ticks: 500 });
      s.squads[1] = [STARTER_HEROES[1], '', '', '', ''];
      s.activeSquad = 1;
    });
    const re = await hs.view(id, nowD, (s) => s);
    ok(re.progress['1-3']?.stars === 1 && re.squads[1][0] === STARTER_HEROES[1] && re.activeSquad === 1, 'PG: tiến trình ải + đội lưu và nạp lại đúng');
    ok((await q(`SELECT count(*)::int AS n FROM $Sh_runs WHERE account_id=$1`, [id])).rows[0].n === 1, 'PG: ghi h_runs');
    const lbp = await hs.leaderboard(10);
    ok(lbp.length === 1 && lbp[0].accountId === id && lbp[0].stage === 2 && lbp[0].stars === 1, 'PG: leaderboard lấy ải cao nhất (1-3 = index 2)');
    const par = await Promise.all([1, 2, 3].map((i) => hs.mutate(id, nowD, 'grant', (s) => { s.wallet.gold += 10; return i; })));
    ok(par.length === 3 && (await hs.view(id, nowD, (s) => s.wallet.gold)) === 5030, 'PG: 3 giao dịch song song được khoá tuần tự, không mất cập nhật');
    let fk = false;
    try {
      await hs.view(987654321, nowD, (s) => s);
    } catch (e: any) {
      fk = e?.status === 404;
    }
    ok(fk, 'PG: tài khoản không tồn tại → 404');
    // trang bị: quà khởi đầu, thêm món mới, đổi cấp/tướng, phân rã — cùng một giao dịch với phần còn lại
    const g0 = await hs.view(id, nowD, (s) => s.gear);
    ok(g0.length === STARTER_GEAR.length && g0.every((g, i) => g.def === STARTER_GEAR[i] && g.level === 0 && g.hero === null && g.uid > 0), 'PG: quà khởi đầu được ghi, uid do bigserial cấp');
    await hs.mutate(id, nowD, 'test', (s) => {
      s.newGear.push('weapon_water_UR', 'helmet_earth_SR');
      s.gear[0].level = 3;
      s.gear[0].hero = STARTER_HEROES[0];
    });
    const g1 = await hs.view(id, nowD, (s) => s.gear);
    ok(g1.length === 6 && g1[0].level === 3 && g1[0].hero === STARTER_HEROES[0] && g1[4].def === 'weapon_water_UR' && g1[5].def === 'helmet_earth_SR' && g1[4].uid > g1[3].uid, 'PG: thêm món mới + lưu cấp/tướng đang mặc, thứ tự uid');
    const dropped = g1[1].uid;
    await hs.mutate(id, nowD, 'test', (s) => {
      s.gear = s.gear.filter((g) => g.uid !== dropped);
    });
    const g2 = await hs.view(id, nowD, (s) => s.gear);
    ok(g2.length === 5 && !g2.some((g) => g.uid === dropped) && g2[0].level === 3, 'PG: món bị phân rã bị xoá khỏi h_gear');
    let rb = false;
    try {
      await hs.mutate(id, nowD, 'test', (s) => {
        s.newGear.push('armor_earth_UR');
        s.gear = [];
        throw new StoreError('huỷ', 400);
      });
    } catch {
      rb = true;
    }
    ok(rb && (await hs.view(id, nowD, (s) => s.gear.length)) === 5, 'PG: lỗi giữa chừng → rollback cả thao tác trang bị');
    const gl = (await q(`SELECT count(*)::int AS n FROM $Sh_gear WHERE account_id=$1`, [id])).rows[0].n;
    ok(gl === 5, 'PG: bảng h_gear có đúng 5 dòng của tài khoản');
    // v3: tháp + nhiệm vụ + cửa hàng, qua ngày (đồng hồ truyền thẳng vào store)
    {
      const d1 = new Date(Date.UTC(2031, 5, 1, 3, 0, 0));
      const d2 = new Date(d1.getTime() + 86_400_000);
      await hs.mutate(id, d1, 'test', (s) => {
        s.wallet.gold += 100000;
        s.towerFloor = 7;
        s.towerTries -= 2;
      });
      await hs.mutate(id, d1, 'shop', (s) => void opShopBuy(s, d1.getTime(), 'exp_pack', 3, undefined, rnd));
      const v1 = await hs.view(id, d1, (s) => s);
      ok(v1.towerFloor === 7 && v1.towerTries === TOWER_TRIES - 2 && v1.shop.exp_pack === 3 && v1.day === dayKey(d1.getTime()) && v1.quests.q_login?.progress === 1, 'PG: tháp / mua hàng / đăng nhập được lưu và nạp lại');
      await hs.mutate(id, d1, 'quest', (s) => void opQuestClaim(s, 'q_login'));
      const q1 = (await q(`SELECT quest_id, claimed FROM $Sh_quest WHERE account_id=$1`, [id])).rows;
      ok(q1.length === 1 && q1[0].quest_id === 'q_login' && q1[0].claimed, 'PG: h_quest ghi nhận thưởng đã nhận');
      await hs.mutate(id, d1, 'test', (s) => void QUEST_DEFS.forEach((d) => (s.quests[d.id] = { progress: d.target, claimed: true })));
      await hs.mutate(id, d1, 'quest', (s) => void opQuestClaim(s, 'bonus'));
      ok((await hs.view(id, d1, (s) => s.questBonus)) === true && (await q(`SELECT 1 FROM $Sh_quest WHERE account_id=$1 AND quest_id='bonus'`, [id])).rows.length === 1, 'PG: thưởng thêm lưu bằng hàng quest_id=bonus');
      const mid = await hs.view(id, d2, (s) => s);
      ok(mid.day !== dayKey(d2.getTime()), 'PG: view không ghi (ngày cũ vẫn nằm trong DB cho tới thao tác ghi kế)');
      await hs.mutate(id, d2, 'test', (s) => void (s.wallet.gold += 1));
      const v2 = await hs.view(id, d2, (s) => s);
      ok(v2.day === dayKey(d2.getTime()) && v2.towerFloor === 7 && v2.towerTries === TOWER_TRIES && v2.towerDay === dayKey(d2.getTime()) && !v2.questBonus && Object.keys(v2.shop).length === 0 && v2.quests.q_login?.progress === 1 && !v2.quests.q_login.claimed, 'PG: qua ngày reset lượt tháp / nhiệm vụ / bonus / cửa hàng, giữ tầng');
      const old = (await q(`SELECT (SELECT count(*)::int FROM $Sh_quest WHERE account_id=$1 AND day<>$2) AS a, (SELECT count(*)::int FROM $Sh_shop_buy WHERE account_id=$1 AND day<>$2) AS b`, [id, dayKey(d2.getTime())])).rows[0];
      ok(old.a === 0 && old.b === 0, 'PG: hàng của ngày cũ đã bị xoá');
      // thua tháp: đội yếu — tốn lượt, không lên tầng, ghi h_runs 't-N'
      await hs.mutate(id, d2, 'test', (s) => {
        for (const h of Object.values(s.heroes)) (h.level = 1), (h.star = 1);
        s.towerFloor = 59;
      });
      const to = await hs.mutate(id, d2, 'tower', (s) => opTowerBattle(s, 0, 4242, [], true, rnd));
      const v3 = await hs.view(id, d2, (s) => s);
      ok(!to.win && v3.towerFloor === 59 && v3.towerTries === TOWER_TRIES - 1 && v3.quests.q_tower?.progress === 1, 'PG: thua tháp vẫn tốn lượt + tính nhiệm vụ');
      ok((await q(`SELECT count(*)::int AS n FROM $Sh_runs WHERE account_id=$1 AND stage='t-60' AND win=false`, [id])).rows[0].n === 1, 'PG: ghi h_runs t-60');
      let sh = false;
      try {
        await hs.mutate(id, d2, 'shop', (s) => {
          s.wallet.gold = 0;
          opShopBuy(s, d2.getTime(), 'exp_pack', 1, undefined, rnd);
        });
      } catch {
        sh = true;
      }
      ok(sh && (await hs.view(id, d2, (s) => s.wallet.gold)) > 0, 'PG: mua thiếu tiền → lỗi, rollback');
    }
    // v4: đấu trường
    {
      const d = new Date(Date.UTC(2031, 6, 1, 3, 0, 0));
      ok((await q(`SELECT count(*)::int AS n FROM $Sh_arena WHERE account_id=$1`, [id])).rows[0].n === 0, 'PG: chưa chạm đấu trường → chưa có hàng h_arena');
      const id2 = (await pgs.createAccount('pgtest2', 'x'))!;
      const id3 = (await pgs.createAccount('pgtest3', 'x'))!;
      await hs.mutate(id, d, 'arena-init', (s) => void (s.arenaOn = true));
      await hs.mutate(id2, d, 'arena-init', (s) => void ((s.arenaOn = true), (s.arenaRating = 1100), (s.arenaWins = 2)));
      await hs.mutate(id3, d, 'arena-init', (s) => void ((s.arenaOn = true), (s.arenaRating = 1100), (s.arenaWins = 2), (s.squads[0] = ['', '', '', '', ''])));
      const a1 = await hs.view(id, d, (s) => s);
      ok(a1.arenaOn && a1.arenaRating === 1000 && a1.arenaTries === ARENA_TRIES && a1.arenaDay === dayKey(d.getTime()) && a1.arenaDefense === 0, 'PG: hàng h_arena tạo lười, lượt = 5 theo ngày');
      await hs.mutate(id, d, 'arena', (s) => void ((s.arenaTries -= 1), (s.arenaRating = 1234), (s.arenaWins = 1), (s.arenaLosses = 2), (s.arenaDefense = 1)));
      const a2 = await hs.view(id, d, (s) => s);
      ok(a2.arenaTries === ARENA_TRIES - 1 && a2.arenaRating === 1234 && a2.arenaWins === 1 && a2.arenaLosses === 2 && a2.arenaDefense === 1, 'PG: điểm / lượt / thắng thua / đội phòng thủ được lưu');
      await hs.mutate(id, new Date(d.getTime() + 86_400_000), 'test', () => 0);
      ok((await hs.view(id, d, (s) => s.arenaTries)) === ARENA_TRIES, 'PG: qua ngày reset lượt đấu trường khi ghi');
      const near = await hs.arenaNear(id, 1000, 10);
      ok(near.length === 1 && near[0].accountId === id2 && near[0].rating === 1100 && near[0].wins === 2, 'PG: arenaNear loại bản thân + tài khoản đội phòng thủ rỗng');
      const tp = await hs.arenaTop(10);
      ok(tp.length === 3 && tp[0].accountId === id && tp[0].rating === 1234 && tp[1].accountId === id2 && tp[2].accountId === id3, 'PG: arenaTop sắp điểm ↓, thắng ↓, id ↑');
      ok((await hs.arenaRank(id)) === 1 && (await hs.arenaRank(id2)) === 2 && (await hs.arenaRank(id3)) === 3, 'PG: arenaRank khớp arenaTop');
      ok((await hs.arenaRank(999999)) === 0, 'PG: arenaRank tài khoản không có hàng = 0');
      const pk = await hs.peek(id2, (s) => ({ r: s.arenaRating, h: Object.keys(s.heroes).length, g: s.gear.length }));
      ok(!!pk && pk.r === 1100 && pk.h === STARTER_HEROES.length && pk.g > 0 && (await hs.peek(999999, () => 1)) === null, 'PG: peek đọc hồ sơ người khác (tướng + trang bị), không có → null');
    }
    // v5: sự kiện + bang hội
    {
      const d = new Date(Date.UTC(2032, 3, 5, 3, 0, 0));
      const dm = d.getTime();
      ok((await q(`SELECT count(*)::int AS n FROM $Sh_event WHERE name=$1`, [SEED_EVENT.name])).rows[0].n === 1, 'PG v5: sự kiện mẫu gieo đúng một lần (init chạy lại không gieo thêm)');
      const e = await hs.adminEventSave({
        name: 'PG ev', desc: 'x', startsAt: dm - 1000, endsAt: dm + 10_000_000, enabled: true, banner: 'hau_vuong',
        objectives: [
          { id: 'a', kind: 'win', name: 'a', target: 3, reward: { wallet: { gold: 10 }, shards: { hero: 'hau_vuong', n: 25 }, gear: ['weapon_forest_SR'] } },
          { id: 'b', kind: 'summon', name: 'b', target: 5, reward: {} },
        ],
      });
      const listed = (await hs.adminEvents()).find((x) => x.id === e.id);
      ok(e.id > 0 && !!listed && listed.objectives.length === 2 && listed.banner === 'hau_vuong' && listed.startsAt === dm - 1000, 'PG: adminEventSave tạo + adminEvents đọc lại (bigint → số)');
      let nf = false;
      try {
        await hs.adminEventSave({ ...e, id: 987654 });
      } catch (err) {
        nf = err instanceof StoreError && err.status === 404;
      }
      ok(nf, 'PG: sửa sự kiện không tồn tại → 404');
      const u1 = (await pgs.createAccount('pgev1', 'x'))!;
      await hs.mutate(u1, d, 'test', (s) => {
        bumpEvents(s, 'win', 2);
        bumpEvents(s, 'summon', 9);
      });
      const pv = await hs.view(u1, d, (s) => s.events.find((x) => x.def.id === e.id)!);
      ok(pv.rows.a.progress === 2 && pv.rows.b.progress === 5, 'PG: tiến trình sự kiện được lưu, chặn ở target');
      await hs.mutate(u1, d, 'test', (s) => bumpEvents(s, 'win', 5));
      const gear0 = await hs.view(u1, d, (s) => s.gear.length);
      const rwd = await hs.mutate(u1, d, 'event', (s) => opEventClaim(s, dm, e.id, 'a'));
      const st1 = await hs.view(u1, d, (s) => ({ hv: s.heroes.hau_vuong, g: s.gear.length, gold: s.wallet.gold, claimed: s.events[0].rows.a.claimed }));
      ok(st1.hv?.shards === 25 && st1.hv.level === 1 && st1.hv.star === 1 && st1.claimed && st1.g === gear0 + 1 && rwd.wallet.gold === 10 && st1.gold === 5010, 'PG: nhận thưởng sự kiện (tướng mới + mảnh, trang bị, ví) và đánh dấu đã nhận');
      let dbl = false;
      try {
        await hs.mutate(u1, d, 'event', (s) => opEventClaim(s, dm, e.id, 'a'));
      } catch (err) {
        dbl = err instanceof StoreError && err.status === 400;
      }
      ok(dbl && (await q(`SELECT count(*)::int AS n FROM $Sh_ledger WHERE account_id=$1 AND kind='event'`, [u1])).rows[0].n === 1, 'PG: nhận hai lần bị từ chối, ledger event đúng một dòng');
      await hs.adminEventSave({ ...e, objectives: [e.objectives[0]] });
      const cnt = (await q(`SELECT count(*)::int AS n FROM $Sh_event_progress WHERE account_id=$1 AND event_id=$2`, [u1, e.id])).rows[0].n;
      ok(cnt === 1 && (await hs.view(u1, d, (s) => s.events[0].rows.a.claimed)), 'PG: sửa sự kiện bỏ mục tiêu → xoá hàng tiến trình của nó, giữ mục còn lại + trạng thái đã nhận');
      ok((await hs.view(u1, d, (s) => s.events.length)) === 1 && (await hs.view(u1, new Date(dm + 20_000_000), (s) => s.events.length)) === 0 && (await hs.view(u1, new Date(dm - 5000), (s) => s.events.length)) === 0, 'PG: chỉ nạp sự kiện đang diễn ra theo thời gian');
      await hs.adminEventSave({ ...e, enabled: false });
      ok((await hs.view(u1, d, (s) => s.events.length)) === 0, 'PG: sự kiện tắt không được nạp');
      await hs.adminEventDelete(e.id);
      ok((await q(`SELECT count(*)::int AS n FROM $Sh_event_progress WHERE event_id=$1`, [e.id])).rows[0].n === 0, 'PG: xoá sự kiện xoá luôn tiến trình (ON DELETE CASCADE)');
      let nf2 = false;
      try {
        await hs.adminEventDelete(e.id);
      } catch (err) {
        nf2 = err instanceof StoreError && err.status === 404;
      }
      ok(nf2, 'PG: xoá sự kiện không tồn tại → 404');

      // ---- bang hội ----
      const [g1, g2, g3] = [(await pgs.createAccount('pgg1', 'x'))!, (await pgs.createAccount('pgg2', 'x'))!, (await pgs.createAccount('pgg3', 'x'))!];
      for (const a of [g1, g2, g3]) await hs.mutate(a, d, 'test', (s) => void ((s.level = 5), (s.wallet.gold = 50_000), (s.wallet.gems = 1000)));
      await hs.mutateGuild(g1, d, 'guild', null, (s, g) => opGuildCreate(s, g, dm, 'PG Guild', 'hello'));
      const gid = (await hs.view(g1, d, (s) => s.guildId))!;
      ok(gid > 0 && (await hs.view(g1, d, (s) => s.wallet.gold)) === 45_000, 'PG: lập bang, trừ phí, guildId đọc từ bảng thành viên');
      let dupe: unknown = null;
      try {
        await hs.mutateGuild(g2, d, 'guild', null, (s, g) => opGuildCreate(s, g, dm, 'pg GUILD'));
      } catch (err) {
        dupe = err;
      }
      ok(dupe instanceof StoreError && dupe.status === 409 && (await hs.view(g2, d, (s) => s.wallet.gold)) === 50_000 && (await hs.view(g2, d, (s) => s.guildId)) === null, 'PG: tên trùng không phân biệt hoa/thường → 409 và rollback (không trừ tiền)');
      await hs.mutateGuild(g2, d, 'guild', gid, (s, g) => opGuildJoin(s, g, dm));
      await hs.mutateGuild(g3, d, 'guild', gid, (s, g) => opGuildJoin(s, g, dm));
      await hs.mutateGuild(g1, d, 'guild', null, (s, g) => opGuildDonate(s, g, dm, 'd1'));
      await hs.mutateGuild(g2, d, 'guild', null, (s, g) => opGuildCheckin(s, g, dm));
      const vg = await hs.viewGuild(g1, d, (_s, g) => structuredClone(g));
      ok(vg.members.length === 3 && vg.guild!.exp === 25 && vg.guild!.notice === 'hello' && vg.members.find((m) => m.accountId === g1)!.contribution === 20 && vg.members.find((m) => m.accountId === g1)!.role === 'leader', 'PG: tham gia / quyên góp / điểm danh được lưu (exp 20+5, cống hiến 20)');
      ok((await hs.guildList(10)).some((x) => x.guild.id === gid && x.members === 3), 'PG: guildList kèm số thành viên');
      // boss: g1 g2 đánh, hạ bằng g3 → thưởng xếp hàng cho g1 g2
      const atk = (acc: number, seed: number) => hs.mutateGuild(acc, d, 'guild-boss', null, (s, g) => opGuildBoss(s, g, dm, 0, seed, [], true));
      const a1 = await atk(g1, 11);
      const a2 = await atk(g2, 12);
      await hs.mutateGuild(g1, d, 'test', null, (_s, g) => void (g.guild!.bossHp = 50));
      const a3 = await atk(g3, 13);
      ok(a1.damage > 0 && a2.damage > 0 && a3.damage === 50 && a3.killed && a3.boss.hp === 0, 'PG: đòn cuối kẹp theo máu còn lại, boss bị hạ');
      const row = (await q(`SELECT boss_hp::int AS hp, boss_killed AS k FROM $Sh_guild WHERE id=$1`, [gid])).rows[0];
      const dmgRows = (await q(`SELECT account_id, boss_damage FROM $Sh_guild_member WHERE guild_id=$1`, [gid])).rows;
      ok(row.hp === 0 && row.k === true && dmgRows.find((r) => r.account_id === g1).boss_damage === a1.damage && dmgRows.find((r) => r.account_id === g3).boss_damage === 50, 'PG: máu boss + sát thương từng thành viên được lưu');
      ok((await hs.pendingKill(g1)) === 1 && (await hs.pendingKill(g2)) === 1 && (await hs.pendingKill(g3)) === 0, 'PG: thưởng hạ boss xếp hàng cho người đóng góp (trừ người hạ)');
      const gm0 = await hs.view(g1, d, (s) => ({ gems: s.wallet.gems, tickets: s.wallet.tickets }));
      await hs.mutate(g1, d, 'test', () => 0);
      await hs.mutate(g1, d, 'test', () => 0);
      const gm1 = await hs.view(g1, d, (s) => ({ gems: s.wallet.gems, tickets: s.wallet.tickets }));
      ok(gm1.gems === gm0.gems + 100 && gm1.tickets === gm0.tickets + 2 && (await hs.pendingKill(g1)) === 0 && (await q(`SELECT count(*)::int AS n FROM $Sh_ledger WHERE account_id=$1 AND kind='guild-boss-kill'`, [g1])).rows[0].n === 1, 'PG: nhận thưởng hạ boss đúng một lần + ledger guild-boss-kill');
      let again = false;
      try {
        await atk(g2, 14);
      } catch (err) {
        again = err instanceof StoreError && /hạ/.test(err.message);
      }
      ok(again && (await q(`SELECT count(*)::int AS n FROM $Sh_runs WHERE stage='guildboss'`)).rows[0].n === 3, 'PG: đánh sau khi boss bị hạ bị từ chối; h_runs guildboss ghi 3 lượt');
      // sang chu kỳ mới: reset lười được ghi
      const dNext = new Date(dm + 8 * 86_400_000);
      await hs.mutateGuild(g2, dNext, 'guild', null, (s, g) => opGuildCheckin(s, g, dNext.getTime()));
      const g2v = await hs.viewGuild(g2, dNext, (_s, g) => structuredClone(g));
      ok(!g2v.guild!.bossKilled && g2v.guild!.bossHp === g2v.guild!.bossHpMax && g2v.members.every((m) => m.bossDamage === 0), 'PG: chu kỳ mới reset boss + sát thương thành viên (ghi lúc chạm đầu tiên)');
      // chat
      ok((await hs.guildChat(u1, 50)) === null, 'PG: không thuộc bang → guildChat null');
      let nochat = false;
      try {
        await hs.guildChatPost(u1, 'pgev1', 'hi', dm);
      } catch (err) {
        nochat = err instanceof StoreError;
      }
      ok(nochat, 'PG: không thuộc bang → đăng chat bị từ chối');
      for (let i = 0; i < GUILD_CHAT_KEEP + 7; i++) await hs.guildChatPost(g1, 'pgg1', '#' + i, dm + i);
      const ch = (await hs.guildChat(g2, 1000))!;
      const total = (await q(`SELECT count(*)::int AS n FROM $Sh_guild_chat WHERE guild_id=$1`, [gid])).rows[0].n;
      ok(total === GUILD_CHAT_KEEP && ch.length === GUILD_CHAT_KEEP && ch[ch.length - 1].text === '#' + (GUILD_CHAT_KEEP + 6) && ch[0].text === '#7' && ch.every((m, i, a) => i === 0 || a[i - 1].id < m.id) && (await hs.guildChat(g2, 5))!.length === 5, 'PG: chat giữ đúng GUILD_CHAT_KEEP tin cuối, cũ → mới, giới hạn limit');
      // rời / chuyển quyền / giải tán
      await hs.mutateGuild(g2, dNext, 'guild', null, (s, g) => opGuildLeave(s, g, dNext.getTime()));
      ok((await hs.view(g2, dNext, (s) => ({ id: s.guildId, left: s.guildLeftAt }))).left === dNext.getTime() && (await hs.view(g2, dNext, (s) => s.guildId)) === null, 'PG: rời bang lưu mốc guild_left_at, guildId null');
      let leaderLeave = false;
      try {
        await hs.mutateGuild(g1, dNext, 'guild', null, (s, g) => opGuildLeave(s, g, dNext.getTime()));
      } catch (err) {
        leaderLeave = err instanceof StoreError && err.status === 400;
      }
      ok(leaderLeave, 'PG: bang chủ còn thành viên không rời được');
      await hs.mutateGuild(g1, dNext, 'guild', null, (s, g) => opGuildTransfer(s, g, g3));
      ok((await hs.viewGuild(g3, dNext, (_s, g) => g.guild!.leaderId)) === g3, 'PG: chuyển quyền lưu leader_id + vai trò');
      await hs.mutateGuild(g1, dNext, 'guild', null, (s, g) => opGuildLeave(s, g, dNext.getTime()));
      await hs.mutateGuild(g3, dNext, 'guild', null, (s, g) => opGuildLeave(s, g, dNext.getTime()));
      const left = (await q(`SELECT (SELECT count(*)::int FROM $Sh_guild WHERE id=$1) AS g, (SELECT count(*)::int FROM $Sh_guild_member WHERE guild_id=$1) AS m, (SELECT count(*)::int FROM $Sh_guild_chat WHERE guild_id=$1) AS c`, [gid])).rows[0];
      ok(left.g === 0 && left.m === 0 && left.c === 0, 'PG: bang chủ cuối cùng rời → bang + thành viên + chat bị xoá (CASCADE)');
    }
  } catch (e) {
    ok(false, 'PG: lỗi ' + (e instanceof Error ? e.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '<url>') : String(e)));
  } finally {
    await pgs.close().catch(() => {});
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
} else console.log('(bỏ qua phần Postgres — không có DATABASE_URL)');

console.log(`\n${fails ? '✘' : '✔'} ${passes} đạt, ${fails} lỗi`);
process.exit(fails ? 1 : 0);
