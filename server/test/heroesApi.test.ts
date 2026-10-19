// Kiểm thử REST + lớp lưu trữ game Thẻ Tướng (tài khoản dùng chung với Bầy Khỉ).
// Chạy: cd server && npx tsx test/heroesApi.test.ts
// Luôn chạy với MemStore; nếu có DATABASE_URL (biến môi trường hoặc server/.env) chạy thêm một đoạn tích hợp với
// HeroPgStore trên schema tạm test_h_<ngẫu nhiên>, xoá khi xong. Không in chuỗi kết nối.

import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import type { BattleRes, MeResponse, SummonRes, SweepRes, AfkClaimRes, LeaderRow, QuestClaimRes, ShopBuyRes, TowerBattleRes } from '../../shared/heroes/api.js';
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
import { bumpQuest, newState, opBattle, opQuestClaim, opShopBuy, opSummon, opTowerBattle, rollDay } from '../src/heroes/rules.js';
import { QUEST_BONUS, QUEST_DEFS, dayKey } from '../../shared/heroes/quests.js';
import { SHOP_ITEMS } from '../../shared/heroes/shop.js';
import { TOWER_MAX_FLOOR, TOWER_TRIES, towerReward } from '../../shared/heroes/tower.js';
import { GEAR_BY_ID, GEAR_CAP, MAX_GEAR_LEVEL, STARTER_GEAR, enhanceCost, salvageStones, sumGear } from '../../shared/heroes/gear.js';

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
