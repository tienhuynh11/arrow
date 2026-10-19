// Kiểm thử lớp lưu trữ Bầy Khỉ (tài khoản, kho đồ, ải, sự kiện, bảng xếp hạng) + vài route REST.
// Chạy: cd server && npx tsx test/monkeyStore.test.ts
// Luôn chạy với MemStore; nếu có DATABASE_URL (biến môi trường hoặc server/.env) chạy thêm với PgStore
// trên một schema tạm test_<ngẫu nhiên>, xoá khi xong. Không in chuỗi kết nối.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { MeResponse } from '../../shared/monkey/api.js';
import { BAG_CAP, ITEM_BY_ID, SHOP_STOCK, STAGE_BY_ID, STAGES, levelUpGold, rollDrops, rollKillLoot, rollKillLoots, sellPrice, upgradeCost, upgradeStones, weaponFromItem, xpToNext, type Reward } from '../../shared/monkey/progression.js';
import { MIGRATIONS } from '../src/monkey/db/migrations.js';
import { _resetRateLimits, hashPassword, login, logout, register, resolveAccount, resolveToken, verifyPassword } from '../src/monkey/accounts.js';
import { handleMonkeyApi } from '../src/monkey/api.js';
import { loadDotEnv, useStore } from '../src/monkey/db/index.js';
import { MemStore } from '../src/monkey/db/memStore.js';
import { PgStore } from '../src/monkey/db/pgStore.js';
import { StoreError, type ExtractRun, type RunResult, type Store } from '../src/monkey/db/store.js';

let fails = 0;
let passes = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (cond) passes++;
  else fails++;
};
async function rejects(p: Promise<unknown>, msg: string, part?: string) {
  try {
    await p;
    ok(false, `${msg} (không ném lỗi)`);
  } catch (e) {
    const good = e instanceof StoreError && (!part || e.message.includes(part));
    ok(good, `${msg}${good ? '' : ` — lỗi: ${(e as Error).message}`}`);
  }
}

const NOW = () => new Date();
const run = (accountId: number, o: Partial<RunResult> = {}): RunResult => ({
  accountId, stage: 'endless', won: false, stars: 0, wave: 1, kills: 0, secs: 60, score: 0, reward: {}, ...o,
});

async function suite(label: string, store: Store) {
  console.log(`\n========== ${label} ==========`);
  useStore(store);
  _resetRateLimits();
  const ph = await hashPassword('matkhau123');

  console.log('\n[1] Tài khoản + phiên');
  {
    ok(await verifyPassword('matkhau123', ph), 'scrypt: đúng mật khẩu');
    ok(!(await verifyPassword('matkhau124', ph)), 'scrypt: sai mật khẩu');
    const r = await register('1.1.1.1', 'Khỉ_Vàng', 'banana99');
    ok(typeof r.token === 'string' && r.token.length >= 40, 'đăng ký trả token');
    ok((await resolveToken(r.token)) === r.accountId, 'token → accountId');
    const acc = await resolveAccount(r.token);
    ok(acc?.username === 'Khỉ_Vàng', 'resolveAccount trả tên hiển thị');
    await rejects(register('1.1.1.1', 'khỈ_vàng', 'banana99'), 'trùng tên (không phân biệt hoa thường)', 'đã có');
    await rejects(register('1.1.1.1', 'ab', 'banana99'), 'tên quá ngắn bị chặn');
    await rejects(register('1.1.1.1', 'xin chao', 'banana99'), 'tên có khoảng trắng bị chặn');
    await rejects(register('1.1.1.1', 'hopLe', '123'), 'mật khẩu quá ngắn bị chặn');
    await rejects(login('1.1.1.1', 'Khỉ_Vàng', 'sai-mat-khau'), 'sai mật khẩu', 'Sai tên');
    await rejects(login('1.1.1.1', 'khong-ton-tai', 'banana99'), 'tên không tồn tại', 'Sai tên');
    const l = await login('1.1.1.1', 'KHỈ_VÀNG', 'banana99');
    ok(l.accountId === r.accountId, 'đăng nhập không phân biệt hoa thường');
    await logout(l.token);
    ok((await resolveToken(l.token)) === null, 'đăng xuất huỷ token');
    ok((await resolveToken(r.token)) === r.accountId, 'token khác vẫn còn');
    for (let i = 0; i < 10; i++) await login('2.2.2.2', 'Khỉ_Vàng', 'x').catch(() => {});
    await rejects(login('2.2.2.2', 'Khỉ_Vàng', 'banana99'), 'IP thử sai nhiều lần bị chặn tạm', 'quá nhiều');
    _resetRateLimits();
    await store.createSession(r.accountId, 'expired-hash', new Date(Date.now() - 1000));
    ok((await store.sessionAccount('expired-hash')) === null, 'phiên hết hạn không dùng được');
    ok((await store.findAccount('KHỈ_vàng'))?.id === r.accountId, 'findAccount không phân biệt hoa thường');
    ok((await store.createAccount('khỉ_VÀNG', ph)) === null, 'createAccount trùng → null');
  }

  const A = (await store.createAccount('alice', ph))!;
  const B = (await store.createAccount('bob', ph))!;

  console.log('\n[2] Bộ tân binh + mặc đồ');
  let me: MeResponse = await store.me(A, NOW());
  {
    ok(me.profile.level === 1 && me.profile.gold === 0, 'hồ sơ mới: cấp 1, 0 vàng');
    ok(JSON.stringify(me.profile.chars) === '[0,1,2]', 'nhân vật mặc định 0,1,2');
    ok(me.profile.skills[0]?.g === 1 && me.profile.skills[6]?.q === 1, 'kỹ năng mặc định cấp 1');
    const gun = me.items.find((i) => i.itemId === 'g_tanbinh');
    const knife = me.items.find((i) => i.itemId === 'k_gam');
    const med = me.items.find((i) => i.itemId === 'q_maunho');
    ok(me.items.length === 3 && gun?.slot === 'weapon1' && knife?.slot === 'knife' && med?.slot === 'quick1' && med.count === 2, 'bộ tân binh: súng (weapon1) + dao + 2 bình máu (quick1)');
    ok(gun?.grade === 0 && gun.level === 1 && !gun.stash, 'đồ khởi đầu phẩm Trắng, cấp 1, trong túi/ô');
    await rejects(store.claimStarter(A), 'còn súng thì không nhận lại bộ tân binh', 'còn súng');
    const lo = await store.loadout(A, 0);
    ok(lo.look.knife === 'k_gam' && lo.knifeDmg === 60 && lo.weapons.length === 1 && lo.weapons[0].name === 'Súng Lục Tân Binh', 'loadout: dao + súng tân binh');
    ok(lo.quick.length === 1 && lo.quick[0].count === 2 && lo.quick[0].effect.kind === 'heal', 'loadout: tiêu hao ô quick1');
    ok(JSON.stringify([...lo.carried].sort()) === JSON.stringify([gun!.uid, knife!.uid, med!.uid].sort()), 'loadout.carried = uid đồ mang vào');
    const made = await store.grant(A, { items: [{ itemId: 'h_sat', grade: 1 }, { itemId: 'h_tre', grade: 0 }, { itemId: 'g_ongvo', grade: 0 }] });
    ok(made.length === 3 && made.every((m) => m.uid > 0 && m.slot === null && !m.stash), 'grant tạo đồ có uid, vào túi');
    const helm = made.find((m) => m.itemId === 'h_sat')!;
    const hat = made.find((m) => m.itemId === 'h_tre')!;
    const smg = made.find((m) => m.itemId === 'g_ongvo')!;
    ok(Object.keys(helm.affixes).length === 1, 'đồ Xanh có 1 dòng phụ');
    await rejects(store.equip(A, helm.uid, 'helmet'), 'mũ Xanh cần cấp 4', 'cấp 4');
    await rejects(store.equip(A, hat.uid, 'armor'), 'mũ không mặc vào ô giáp', 'không mặc được');
    await rejects(store.equip(A, hat.uid, 'hat' as any), 'ô lạ', 'không hợp lệ');
    await store.equip(A, hat.uid, 'helmet');
    await store.equip(A, smg.uid, 'weapon2');
    me = await store.me(A, NOW());
    ok(me.items.find((i) => i.uid === hat.uid)!.slot === 'helmet' && me.items.find((i) => i.uid === smg.uid)!.slot === 'weapon2', 'mặc mũ + súng phụ');
    ok((await store.loadout(A, 0)).weapons.map((w) => w.model).join() === 'pistol,smg', 'loadout 2 khẩu (weapon1, weapon2)');
    await store.equip(A, smg.uid, 'weapon1');
    me = await store.me(A, NOW());
    ok(me.items.find((i) => i.uid === smg.uid)!.slot === 'weapon1' && me.items.find((i) => i.uid === gun!.uid)!.slot === 'weapon2', 'đổi chỗ súng chính ↔ súng phụ');
    await store.equip(A, gun!.uid, 'secure');
    me = await store.me(A, NOW());
    ok(me.items.find((i) => i.uid === gun!.uid)!.slot === 'secure' && !me.items.some((i) => i.slot === 'weapon2'), 'cất súng vào túi an toàn');
    ok(!(await store.loadout(A, 0)).carried.includes(gun!.uid), 'túi an toàn không tính là đồ mang vào');
    await store.unequip(A, 'helmet');
    me = await store.me(A, NOW());
    ok(!me.items.some((i) => i.slot === 'helmet') && me.items.find((i) => i.uid === hat.uid)!.slot === null, 'tháo mũ về túi');
    ok(me.items.find((i) => i.itemId === 'k_gam')!.slot === 'knife', 'tháo mũ không ảnh hưởng dao');
    await store.moveToStash(A, hat.uid);
    me = await store.me(A, NOW());
    ok(me.items.find((i) => i.uid === hat.uid)!.stash, 'chuyển vào kho');
    await store.equip(A, hat.uid, 'helmet');
    me = await store.me(A, NOW());
    ok(me.items.find((i) => i.uid === hat.uid)!.slot === 'helmet' && !me.items.find((i) => i.uid === hat.uid)!.stash, 'mặc thẳng từ kho');
    await store.moveToBag(A, hat.uid);
    me = await store.me(A, NOW());
    ok(me.items.find((i) => i.uid === hat.uid)!.slot === null && !me.items.find((i) => i.uid === hat.uid)!.stash, 'về túi (tự tháo)');
  }

  console.log('\n[3] Thương nhân + cường hoá');
  {
    const knife = me.items.find((i) => i.itemId === 'k_gam')!;
    await rejects(store.upgradeItem(A, knife.uid), 'cường hoá khi thiếu vàng', 'Không đủ vàng');
    await store.grant(A, { gold: 1000 });
    await rejects(store.upgradeItem(A, knife.uid), 'cường hoá khi thiếu đá', 'Đá Cường Hoá');
    const stoneIdx = SHOP_STOCK.findIndex((e) => e.itemId === 'm_da');
    await store.buy(A, stoneIdx, 3);
    me = await store.me(A, NOW());
    const st = me.items.filter((i) => i.itemId === 'm_da');
    ok(st.length === 1 && st[0].count === 3 && me.profile.gold === 1000 - SHOP_STOCK[stoneIdx].price * 3, 'mua 3 đá → 1 chồng, trừ vàng');
    await store.buy(A, stoneIdx, 1);
    me = await store.me(A, NOW());
    ok(me.items.filter((i) => i.itemId === 'm_da').length === 1 && me.items.find((i) => i.itemId === 'm_da')!.count === 4, 'mua thêm gộp chồng');
    const g0 = me.profile.gold;
    await store.upgradeItem(A, knife.uid);
    me = await store.me(A, NOW());
    ok(me.items.find((i) => i.uid === knife.uid)!.level === 2, 'đồ lên cấp 2');
    ok(me.profile.gold === g0 - upgradeCost(0, 1) && me.items.find((i) => i.itemId === 'm_da')!.count === 4 - upgradeStones(1), 'trừ đúng vàng + đá');
    await rejects(store.sell(A, [knife.uid]), 'không bán đồ đang mặc', 'đang mặc');
    const hat = me.items.find((i) => i.itemId === 'h_tre')!;
    const g1 = me.profile.gold;
    const got = await store.sell(A, [hat.uid, hat.uid]);
    me = await store.me(A, NOW());
    ok(got === sellPrice(hat) && me.profile.gold === g1 + got, 'bán nhận vàng (uid trùng chỉ tính 1 lần)');
    ok(!me.items.some((i) => i.uid === hat.uid), 'món đã bán biến mất');
    await rejects(store.sell(A, [hat.uid]), 'bán món không còn', 'Không tìm thấy');
    await rejects(store.buy(A, 9999, 1), 'món hàng không có', 'Không có món');
    await rejects(store.buy(A, 0, 0), 'số lượng 0', 'Số lượng');
    await rejects(store.buy(A, SHOP_STOCK.findIndex((e) => e.itemId === 'g_mangxa'), 10), 'mua thiếu vàng', 'Không đủ vàng');
  }

  console.log('\n[4] Quyền sở hữu chéo');
  {
    const aItem = me.items[0];
    await rejects(store.equip(B, aItem.uid, 'weapon1'), 'B không mặc được đồ của A', 'Không tìm thấy');
    await store.grant(B, { gold: 5000 });
    await rejects(store.upgradeItem(B, aItem.uid), 'B không nâng được đồ của A', 'Không tìm thấy');
    await rejects(store.sell(B, [aItem.uid]), 'B không bán được đồ của A', 'Không tìm thấy');
    await rejects(store.moveToStash(B, aItem.uid), 'B không chuyển kho đồ của A', 'Không tìm thấy');
    ok((await store.me(A, NOW())).items.find((i) => i.uid === aItem.uid)?.level === aItem.level, 'đồ của A không đổi');
  }

  console.log('\n[5] Mở nhân vật');
  {
    await rejects(store.unlockChar(A, 3), 'Đấu sĩ cần cấp 5', 'cấp 5');
    await rejects(store.unlockChar(A, 4), 'Xạ thủ cần qua 1-10', '1-10');
    await rejects(store.unlockChar(A, 5), 'Pháo thủ cần 30 mảnh', '30');
    await rejects(store.unlockChar(A, 0), 'nhân vật đã mở', 'đã mở');
    await rejects(store.unlockChar(A, 99), 'nhân vật không tồn tại', 'không hợp lệ');
    await rejects(store.selectChar(A, 3), 'chọn nhân vật chưa mở', 'Chưa mở');
    let xp = 0;
    for (let l = 1; l < 5; l++) xp += xpToNext(l);
    await store.grant(A, { xp });
    me = await store.me(A, NOW());
    ok(me.profile.level === 5, `đủ XP → cấp 5 (đang ${me.profile.level})`);
    await store.unlockChar(A, 3);
    await store.recordRun(run(A, { stage: '1-10', won: true, stars: 1, wave: 10, secs: 500 }), NOW());
    await store.unlockChar(A, 4);
    await store.grant(A, { shards: 30 });
    await store.unlockChar(A, 5);
    await rejects(store.unlockChar(A, 6), 'Cao bồi cần cấp 15', 'cấp 15');
    await store.selectChar(A, 5);
    me = await store.me(A, NOW());
    ok(JSON.stringify(me.profile.chars) === '[0,1,2,3,4,5]' && me.profile.shards === 0 && me.profile.cls === 5, 'mở theo cấp/ải/mảnh + chọn nhân vật');
  }

  console.log('\n[6] Nâng kỹ năng');
  {
    const C = (await store.createAccount('carol', ph))!;
    await store.grant(C, { gold: 300 });
    await rejects(store.upgradeSkill(C, 0, 'g'), 'thiếu sách kỹ năng', 'sách');
    await store.grant(C, { books: 1 });
    await rejects(store.upgradeSkill(C, 6, 'g'), 'kỹ năng nhân vật chưa mở', 'Chưa mở');
    await store.upgradeSkill(C, 0, 'g');
    let m = await store.me(C, NOW());
    ok(m.profile.skills[0].g === 2 && m.profile.gold === 0 && m.profile.books === 0, 'kỹ năng G lên 2, trừ 300 vàng + 1 sách');
    await rejects(store.upgradeSkill(C, 0, 'g'), 'lần 2 thiếu vàng', 'Không đủ vàng');
    ok((await store.loadout(C, 0)).skills.g === 2 && (await store.loadout(C, 1)).skills.g === 1, 'loadout theo nhân vật');
    await store.grant(C, { gold: 99999, books: 99 });
    for (let i = 0; i < 3; i++) await store.upgradeSkill(C, 0, 'g');
    await rejects(store.upgradeSkill(C, 0, 'g'), 'kỹ năng tối đa cấp 5', 'tối đa');
    m = await store.me(C, NOW());
    ok(m.profile.skills[0].g === 5, 'kỹ năng cấp 5');
  }

  console.log('\n[7] Ghi kết quả trận');
  {
    const D = (await store.createAccount('dave', ph))!;
    const xpGain = xpToNext(1) + xpToNext(2) + 5; // lên 2 cấp
    const reward: Reward = { gold: 50, xp: xpGain, books: 1, shards: 2, items: [{ itemId: 'g_ranlua', grade: 1, subs: { dmg: 0.03 } }] };
    const res = await store.recordRun(run(D, { stage: '1-1', won: true, stars: 2, wave: 5, kills: 40, secs: 100, score: 900, reward }), NOW());
    ok(res.firstClear, 'lần đầu qua 1-1');
    ok(res.levelUps === 2 && res.newLevel === 3, `lên 2 cấp → cấp 3 (${res.levelUps}, ${res.newLevel})`);
    ok(res.items.length === 1 && res.items[0].uid > 0 && res.items[0].affixes.dmg === 0.03, 'đồ rớt có uid + giữ chỉ số phụ');
    let m = await store.me(D, NOW());
    const first = STAGE_BY_ID['1-1'].first.gold ?? 0;
    ok(m.profile.gold === 50 + first + levelUpGold(2) + levelUpGold(3), `vàng = rớt + thưởng lần đầu + thưởng lên cấp (${m.profile.gold})`);
    ok(m.profile.xp === 5 && m.profile.books === 1 && m.profile.shards === 2 && m.profile.kills === 40, 'xp dư, sách, mảnh, số khỉ hạ');
    let sp = m.stages.find((s) => s.stage === '1-1');
    ok(sp?.stars === 2 && sp.bestSecs === 100 && sp.clears === 1, 'tiến trình ải lần 1');
    const r2 = await store.recordRun(run(D, { stage: '1-1', won: true, stars: 3, secs: 80, kills: 10 }), NOW());
    const r3 = await store.recordRun(run(D, { stage: '1-1', won: true, stars: 1, secs: 120 }), NOW());
    ok(!r2.firstClear && !r3.firstClear, 'lần sau không phải lần đầu');
    await store.recordRun(run(D, { stage: '1-2', won: false, secs: 30 }), NOW());
    m = await store.me(D, NOW());
    sp = m.stages.find((s) => s.stage === '1-1');
    ok(sp?.stars === 3 && sp.bestSecs === 80 && sp.clears === 3, 'sao lấy max, thời gian lấy min, đếm số lần qua');
    ok(!m.stages.some((s) => s.stage === '1-2') && !(await store.clearedStages(D)).has('1-2'), 'thua không tính qua ải');
    ok((await store.clearedStages(D)).has('1-1'), 'clearedStages');
    const boss = await store.recordRun(run(D, { stage: '1-10', won: true, stars: 1 }), NOW());
    ok(boss.firstClear && boss.items.some((i) => i.itemId === 'h_ky' && i.grade === 2), 'qua boss lần đầu nhận Mũ Kỵ Sĩ (Tím)');
  }

  console.log('\n[7b] Ải mang đồ (recordExtract)');
  {
    const X = (await store.createAccount('xena', ph))!;
    await store.grant(X, { xp: xpToNext(1) + xpToNext(2) + xpToNext(3) + 10 }); // cấp 4
    const g = await store.grant(X, { items: [{ itemId: 'a_da', grade: 1 }, { itemId: 'r_bac', grade: 0 }, { itemId: 'q_bangac', grade: 0, count: 5 }] });
    const armor = g.find((i) => i.itemId === 'a_da')!;
    const ring = g.find((i) => i.itemId === 'r_bac')!;
    const band = g.find((i) => i.itemId === 'q_bangac')!;
    ok(band.count === 5, 'tiêu hao vào 1 chồng');
    await store.equip(X, armor.uid, 'armor');
    await store.equip(X, ring.uid, 'secure');
    await store.equip(X, band.uid, 'quick2');
    let m = await store.me(X, NOW());
    const gun = m.items.find((i) => i.slot === 'weapon1')!;
    const med = m.items.find((i) => i.slot === 'quick1')!;
    const lo = await store.loadout(X, 0);
    ok(lo.carried.length === 5 && !lo.carried.includes(ring.uid), 'mang vào 5 món (trừ túi an toàn)');
    const ex = (o: Partial<ExtractRun> & { extract: ExtractRun['extract'] }): ExtractRun => ({ accountId: X, stage: '1-1', won: false, stars: 0, wave: 3, kills: 20, secs: 90, score: 100, chest: {}, ...o });
    // thua: mất hết đồ mang vào, đồ nhặt mất, túi an toàn còn
    const chest = rollDrops(STAGE_BY_ID['1-1'].drops, 0, 1, Math.random);
    const lose = await store.recordExtract(ex({ chest, extract: { survived: false, kept: [], lost: lo.carried, looted: [{ itemId: 'g_mangxa', grade: 2, subs: {} }], usedConsumables: { q_maunho: 1 } } }), NOW());
    m = await store.me(X, NOW());
    ok(lose.lost.length === 5 && !m.items.some((i) => lo.carried.includes(i.uid)), 'chết: mất mọi đồ mang vào');
    ok(m.items.some((i) => i.uid === ring.uid && i.slot === 'secure'), 'chết: túi an toàn giữ lại');
    ok(!m.items.some((i) => i.itemId === 'g_mangxa') && lose.items.length === 0, 'chết: đồ nhặt mất, không nhận rương');
    ok(lose.granted.xp === Math.round((chest.xp ?? 0) * 0.3) && !lose.granted.gold, 'chết: chỉ 30% xp');
    ok(!m.stages.some((s) => s.stage === '1-1'), 'thua không tính qua ải');
    // nhận lại bộ tân binh
    await store.claimStarter(X);
    m = await store.me(X, NOW());
    ok(m.items.some((i) => i.itemId === 'g_tanbinh' && i.slot === 'weapon1') && m.items.some((i) => i.slot === 'quick1'), 'hết súng → nhận lại bộ tân binh (mặc thẳng)');
    await rejects(store.claimStarter(X), 'nhận bộ tân binh lần 2', 'còn súng');
    // thắng: giữ đồ, trừ tiêu hao, nhận đồ nhặt + rương + thưởng lần đầu
    const lo2 = await store.loadout(X, 0);
    const med2 = m.items.find((i) => i.slot === 'quick1')!;
    const gold0 = m.profile.gold;
    const win = await store.recordExtract(ex({
      won: true, stars: 3, secs: 300,
      chest: { gold: 120, xp: 50, items: [{ itemId: 'h_sat', grade: 0, subs: {} }, { itemId: 'm_da', grade: 0, subs: {}, count: 3 }] },
      extract: {
        survived: true, kept: lo2.carried, lost: [],
        looted: [{ itemId: 'g_mangxa', grade: 2, subs: { crit: 0.03 } }, { itemId: 'c_vang', grade: 0, subs: {}, count: 77 }, { itemId: 'c_sach', grade: 2, subs: {}, count: 2 }, { itemId: 'm_da', grade: 0, subs: {}, count: 2 }],
        usedConsumables: { q_maunho: 1 },
      },
    }), NOW());
    m = await store.me(X, NOW());
    ok(win.firstClear && win.lost.length === 0 && m.stages.some((s) => s.stage === '1-1' && s.clears === 1), 'thắng: qua ải lần đầu, không mất gì');
    ok(m.items.find((i) => i.uid === med2.uid)?.count === 1, 'trừ 1 bình máu đã dùng');
    ok(m.items.some((i) => i.itemId === 'g_mangxa' && i.grade === 2 && i.affixes.crit === 0.03 && i.slot === null), 'đồ nhặt vào túi (giữ dòng phụ)');
    ok(m.items.filter((i) => i.itemId === 'm_da').reduce((n, i) => n + i.count, 0) === 5, 'đá cường hoá gộp chồng (nhặt 2 + rương 3)');
    ok(m.profile.books === 2, 'Sách Kỹ Năng nhặt được → tiền tệ hồ sơ');
    ok(m.profile.gold >= gold0 + 77 + 120 + (STAGE_BY_ID['1-1'].first.gold ?? 0), `vàng: túi vàng + rương + lần đầu (${m.profile.gold - gold0})`);
    ok(win.items.some((i) => i.itemId === 'g_mangxa' && i.uid > 0) && win.items.some((i) => i.itemId === 'h_sat'), 'kết quả trả đồ mới có uid');
    // dùng hết bình máu → xoá món
    const lo3 = await store.loadout(X, 0);
    await store.recordExtract(ex({ extract: { survived: true, kept: lo3.carried, lost: [], looted: [], usedConsumables: { q_maunho: 5 } } }), NOW());
    m = await store.me(X, NOW());
    ok(!m.items.some((i) => i.uid === med2.uid), 'dùng hết chồng tiêu hao → món biến mất');
    // uid mất không còn mặc (đã tháo về túi) → KHÔNG xoá; uid của người khác → không xoá
    const sat = m.items.find((i) => i.itemId === 'h_sat')!;
    const other = (await store.me(A, NOW())).items[0];
    const r3 = await store.recordExtract(ex({ extract: { survived: false, kept: [], lost: [sat.uid, other.uid], looted: [], usedConsumables: {} } }), NOW());
    ok(r3.lost.length === 0 && (await store.me(X, NOW())).items.some((i) => i.uid === sat.uid), 'chỉ xoá đồ còn đang mặc');
    ok((await store.me(A, NOW())).items.some((i) => i.uid === other.uid), 'không xoá được đồ của người khác');
    // túi đầy → kho; cả hai đầy → vàng
    const Y = (await store.createAccount('yuri', ph))!;
    const many = Array.from({ length: BAG_CAP + 5 }, () => ({ itemId: 'r_dong', grade: 0 as const }));
    await store.grant(Y, { items: many.slice(0, 20) });
    await store.grant(Y, { items: many.slice(20, 40) });
    await store.grant(Y, { items: many.slice(40) });
    let my = await store.me(Y, NOW());
    ok(my.items.filter((i) => !i.slot && !i.stash).length === BAG_CAP && my.items.filter((i) => i.stash).length === 5, `túi đầy (${BAG_CAP}) → tràn sang kho`);
    await rejects(store.unequip(Y, 'knife'), 'túi đầy không tháo được', 'đầy');
    await store.grant(Y, { gold: 1000 });
    await rejects(store.buy(Y, 0, 1), 'túi đầy không mua được', 'đầy');
    const n0 = my.items.length;
    const gy = my.profile.gold;
    const big = await store.recordExtract({ accountId: Y, stage: '1-1', won: true, stars: 1, wave: 3, kills: 1, secs: 60, score: 1, chest: {}, extract: { survived: true, kept: [], lost: [], looted: Array.from({ length: 3 }, () => ({ itemId: 'r_bac', grade: 0 as const, subs: {} })), usedConsumables: {} } }, NOW());
    my = await store.me(Y, NOW());
    ok(my.items.length === n0 + 3 && my.items.filter((i) => i.itemId === 'r_bac').every((i) => i.stash), 'đồ nhặt khi túi đầy vào kho');
    ok(big.overflowGold === 0 && my.profile.gold >= gy, 'chưa tràn kho → không đổi vàng');
  }

  console.log('\n[7c] Danh mục + súng + rớt đồ');
  {
    const g = (id: string, grade: 0 | 1 | 2 | 3 | 4, level = 1) => weaponFromItem({ uid: 1, itemId: id, grade, level, affixes: {}, count: 1, slot: 'weapon1', stash: false }, 0);
    const w0 = g('g_chimung', 0);
    const w2 = g('g_chimung', 2);
    ok(w0.model === 'sniper' && w2.dmg > w0.dmg && w0.name === ITEM_BY_ID.g_chimung.name, 'súng tím mạnh hơn súng trắng cùng loại');
    ok(g('g_xanhat', 4).dmg > g('g_chimung', 2).dmg * 2, 'súng huyền thoại bậc cao vượt trội');
    ok(weaponFromItem(null, 4).model === 'revolver', 'không có súng → súng bậc 0 của nhân vật');
    const fr = weaponFromItem({ uid: 1, itemId: 'g_ongvo', grade: 0, level: 1, affixes: { fireRate: 0.2, mag: 0.5 }, count: 1, slot: 'weapon1', stash: false }, 0);
    ok(fr.interval < g('g_ongvo', 0).interval && fr.mag > g('g_ongvo', 0).mag, 'dòng phụ tốc bắn / băng đạn nướng vào súng');
    let hits = 0;
    let bossN = 0;
    let rng = 12345;
    const R = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 4000; i++) if (rollKillLoot(0, STAGES[0], 0, R)) hits++;
    for (let i = 0; i < 50; i++) bossN += rollKillLoots(6, STAGES[9], 0, R).length;
    ok(hits > 80 && hits < 260, `khỉ thường rơi ~4% (${hits}/4000)`);
    ok(bossN >= 100 && bossN <= 200, `boss rơi 2–4 món (${bossN}/50 con)`);
  }

  console.log('\n[8] Sự kiện');
  {
    const evs = await store.activeEvents(NOW());
    const ev = evs.find((e) => e.name === 'Tuần Lễ Chuối Vàng');
    ok(!!ev && ev.icon === '🍌' && ev.stage === 'ev-vuonchuoi' && ev.objectives.length === 3, 'sự kiện đầu tiên được tạo sẵn');
    ok(!!ev && Math.abs(Date.parse(ev.endsAt) - Date.parse(ev.startsAt) - 7 * 86400_000) < 1000, 'sự kiện kéo dài 7 ngày');
    const E = (await store.createAccount('eve', ph))!;
    const id = ev!.id;
    await rejects(store.claimEvent(E, id, 'play', NOW()), 'chưa đủ 3 trận', 'Chưa hoàn thành');
    await store.recordRun(run(E, { kills: 120, wave: 4 }), NOW());
    await store.recordRun(run(E, { kills: 150, wave: 7 }), NOW());
    let st = (await store.eventStates(E, NOW())).find((s) => s.event.id === id)!;
    ok(st.progress.kills === 270 && st.progress.play === 2 && (st.progress.clear ?? 0) === 0, 'cộng dồn khỉ hạ + số trận');
    await store.recordRun(run(E, { stage: 'ev-vuonchuoi', won: true, stars: 3, kills: 60, wave: 5 }), NOW());
    st = (await store.eventStates(E, NOW())).find((s) => s.event.id === id)!;
    ok(st.progress.kills === 300 && st.progress.play === 3 && st.progress.clear === 1, 'đủ mục tiêu (khỉ hạ chặn ở chỉ tiêu)');
    const g0 = (await store.me(E, NOW())).profile.gold;
    const rw = await store.claimEvent(E, id, 'play', NOW());
    ok(rw.gold === 200 && (await store.me(E, NOW())).profile.gold === g0 + 200, 'nhận thưởng 200 vàng');
    await rejects(store.claimEvent(E, id, 'play', NOW()), 'không nhận hai lần', 'Đã nhận');
    await store.claimEvent(E, id, 'kills', NOW());
    const m = await store.me(E, NOW());
    ok(m.items.some((i) => i.itemId === 'h_chuoi' && i.grade === 2), 'nhận Mũ Chuối Vàng (Tím)');
    const books0 = m.profile.books;
    await store.claimEvent(E, id, 'clear', NOW());
    ok((await store.me(E, NOW())).profile.books === books0 + 1, 'qua Vườn Chuối nhận sách kỹ năng');
    ok(JSON.stringify([...m.events.find((s) => s.event.id === id)!.claimed].sort()) === '["kills","play"]', 'me.events có danh sách đã nhận');
    await rejects(store.claimEvent(E, id, 'khong-co', NOW()), 'mục tiêu không tồn tại', 'Không có');
    await rejects(store.claimEvent(E, 99999, 'play', NOW()), 'sự kiện không tồn tại', 'Không tìm thấy');
    // admin: tạo / tắt / xoá
    const later = new Date(Date.now() + 86400_000 * 30);
    const ne = await store.saveEvent({ id: 0, name: 'Thử', icon: '🎯', desc: '', startsAt: NOW().toISOString(), endsAt: later.toISOString(), enabled: true, objectives: [{ id: 'w', kind: 'reachWave', target: 10, label: 'Tới đợt 10', reward: { gold: 1 } }] });
    ok(ne.id > 0 && (await store.activeEvents(NOW())).some((e) => e.id === ne.id), 'tạo sự kiện mới');
    await store.recordRun(run(E, { wave: 6 }), NOW());
    await store.recordRun(run(E, { wave: 4 }), NOW());
    ok((await store.eventStates(E, NOW())).find((s) => s.event.id === ne.id)!.progress.w === 6, 'reachWave lấy đợt cao nhất');
    await store.saveEvent({ ...ne, enabled: false });
    ok(!(await store.activeEvents(NOW())).some((e) => e.id === ne.id), 'tắt sự kiện');
    await rejects(store.claimEvent(E, ne.id, 'w', NOW()), 'không nhận thưởng sự kiện đã tắt', 'không còn mở');
    await store.deleteEvent(ne.id);
    ok(!(await store.listEvents()).some((e) => e.id === ne.id), 'xoá sự kiện');
    await rejects(store.saveEvent({ ...ne, id: 987654 }), 'sửa sự kiện không tồn tại', 'Không tìm thấy');
    const past = await store.saveEvent({ ...ne, id: 0, startsAt: new Date(Date.now() - 3 * 86400_000).toISOString(), endsAt: new Date(Date.now() - 86400_000).toISOString(), enabled: true });
    ok(!(await store.activeEvents(NOW())).some((e) => e.id === past.id), 'sự kiện đã hết hạn không mở');
    await store.deleteEvent(past.id);
  }

  console.log('\n[9] Bảng xếp hạng');
  {
    const t0 = Date.now();
    const tr = (wave: number, score: number, secs: number, names: string[], solo = false, stage = 'endless', dt = 0) =>
      store.recordTeamRun({ stage, solo, names, cls: names.map(() => 0), wave, score, kills: score / 10, secs }, new Date(t0 + dt));
    await tr(10, 500, 300, ['a', 'b']);
    await tr(12, 100, 300, ['c', 'd']);
    await tr(10, 900, 300, ['e']);
    await tr(10, 500, 200, ['f']);
    await tr(10, 500, 200, ['g'], false, 'endless', 5000);
    await tr(99, 9999, 1, ['solo'], true);
    await tr(99, 9999, 1, ['khac'], false, '1-1');
    const lb = await store.leaderboard('endless', false, 10);
    ok(JSON.stringify(lb.map((r) => r.names[0])) === '["c","e","f","g","a"]', `thứ tự: đợt ↓, điểm ↓, thời gian ↑, sớm hơn trước (${lb.map((r) => r.names[0])})`);
    ok(lb.length === 5 && typeof lb[0].at === 'number', 'lọc theo ải + chế độ đội');
    ok((await store.leaderboard('endless', true, 10)).length === 1 && (await store.leaderboard('endless', false, 2)).length === 2, 'solo riêng + giới hạn');
    const s = await store.stats();
    ok(s.accounts >= 6 && s.runs24h >= 7, `thống kê (${s.accounts} tk, ${s.runs24h} trận)`);
  }

  console.log('\n[10] REST qua http.Server thật (cổng ngẫu nhiên)');
  {
    _resetRateLimits();
    const srv: Server = createServer((req, res) => {
      if (handleMonkeyApi(req, res)) return;
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/monkey/`;
    const call = async (path: string, o: { body?: unknown; token?: string; admin?: string; method?: string } = {}) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (o.token) headers.authorization = `Bearer ${o.token}`;
      if (o.admin !== undefined) headers['x-admin-key'] = o.admin;
      const res = await fetch(base + path, { method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
      return { status: res.status, data: (await res.json()) as any };
    };
    const savedKey = process.env.MONKEY_ADMIN_KEY;
    try {
      const reg = await call('api/register', { body: { username: 'HttpKhỉ', password: 'secret77' } });
      ok(reg.status === 200 && typeof reg.data.token === 'string' && reg.data.me.profile.username === 'HttpKhỉ', 'POST register → token + me');
      const tok = reg.data.token as string;
      const dup = await call('api/register', { body: { username: 'httpkhỉ', password: 'secret77' } });
      ok(dup.status === 409 && typeof dup.data.error === 'string', 'trùng tên → 409 + thông báo');
      ok((await call('api/me')).status === 401, 'GET me không token → 401');
      ok((await call('api/me', { token: 'x'.repeat(43) })).status === 401, 'token sai → 401');
      const me1 = await call('api/me', { token: tok });
      ok(me1.status === 200 && me1.data.items.length === 3, 'GET me có token (bộ tân binh)');
      const gun = me1.data.items.find((i: any) => i.itemId === 'g_tanbinh');
      const eq = await call('api/equip', { token: tok, body: { uid: gun.uid, slot: 'weapon2' } });
      ok(eq.status === 200 && eq.data.me.items.find((i: any) => i.uid === gun.uid).slot === 'weapon2', 'POST equip {uid, slot} → MutateRes.me');
      ok((await call('api/equip', { token: tok, body: { uid: 'abc', slot: 'weapon1' } })).status === 400, 'uid sai kiểu → 400');
      ok((await call('api/equip', { token: tok, body: { uid: gun.uid } })).status === 400, 'thiếu slot → 400');
      ok((await call('api/unequip', { token: tok, body: { slot: 'hat' } })).status === 400, 'slot sai → 400');
      const up = await call('api/upgrade-item', { token: tok, body: { uid: gun.uid } });
      ok(up.status === 400 && /vàng/.test(up.data.error), 'nâng cấp thiếu vàng → 400 tiếng Việt');
      const sv = await call('api/sell', { token: tok, body: { uids: [gun.uid] } });
      ok(sv.status === 400, 'bán đồ đang mặc → 400');
      const ss = await call('api/shop-stock');
      ok(ss.status === 200 && ss.data.stock.length === SHOP_STOCK.length, 'GET shop-stock');
      const stq = await call('api/stash', { token: tok, body: { uid: gun.uid } });
      ok(stq.status === 200 && stq.data.me.items.find((i: any) => i.uid === gun.uid).stash, 'POST stash');
      const bg = await call('api/bag', { token: tok, body: { uid: gun.uid } });
      ok(bg.status === 200 && !bg.data.me.items.find((i: any) => i.uid === gun.uid).stash, 'POST bag');
      const sl = await call('api/sell', { token: tok, body: { uids: [gun.uid] } });
      ok(sl.status === 200 && sl.data.granted.gold > 0 && !sl.data.me.items.some((i: any) => i.uid === gun.uid), 'POST sell → granted.gold');
      const cs = await call('api/claim-starter', { token: tok, body: {} });
      ok(cs.status === 200 && cs.data.me.items.some((i: any) => i.itemId === 'g_tanbinh' && i.slot === 'weapon1'), 'POST claim-starter');
      const by = await call('api/buy', { token: tok, body: { idx: 0, qty: 1 } });
      ok(by.status === 400 || by.status === 200, 'POST buy');
      ok((await call('api/upgrade-skill', { token: tok, body: { cls: 0, skill: 'z' } })).status === 400, 'kỹ năng sai → 400');
      ok((await call('api/khong-co', { token: tok, body: {} })).status === 404, 'route lạ → 404');
      const bad = await fetch(base + 'api/login', { method: 'POST', body: '{không phải json' });
      ok(bad.status === 400, 'JSON hỏng → 400');
      const lg = await call('api/login', { body: { username: 'httpKHỈ', password: 'secret77' } });
      ok(lg.status === 200 && lg.data.token !== tok, 'POST login');
      ok((await call('api/login', { body: { username: 'httpKHỈ', password: 'sai' } })).status === 401, 'login sai → 401');
      const lb = await call('api/leaderboard?stage=endless');
      ok(lb.status === 200 && Array.isArray(lb.data.rows), 'GET leaderboard');
      ok((await call('api/leaderboard?stage=../../x')).status === 400, 'leaderboard ải lạ → 400');
      delete process.env.MONKEY_ADMIN_KEY;
      ok((await call('api/admin/stats', { admin: 'gi-cung-duoc' })).status === 403, 'admin tắt khi không có MONKEY_ADMIN_KEY');
      process.env.MONKEY_ADMIN_KEY = 'khoa-test-' + randomBytes(4).toString('hex');
      ok((await call('api/admin/stats', { admin: 'sai' })).status === 403, 'admin sai khoá → 403');
      const st = await call('api/admin/stats', { admin: process.env.MONKEY_ADMIN_KEY });
      ok(st.status === 200 && st.data.accounts >= 1 && typeof st.data.online === 'number', 'admin stats');
      const gr = await call('api/admin/grant', { admin: process.env.MONKEY_ADMIN_KEY, body: { username: 'HTTPKHỈ', reward: { gold: 777, items: [{ itemId: 'g_vang', grade: 3 }] } } });
      ok(gr.status === 200 && gr.data.items.length === 1, 'admin tặng đồ');
      ok((await call('api/admin/grant', { admin: process.env.MONKEY_ADMIN_KEY, body: { username: 'HTTPKHỈ', reward: { items: [{ itemId: 'k_gam', grade: 3 }] } } })).status === 400, 'admin tặng độ hiếm sai → 400');
      const evBody = { id: 0, name: 'Sự kiện HTTP', icon: '⭐', desc: 'x', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString(), enabled: true, objectives: [{ id: 'k', kind: 'kills', target: 5, label: 'Hạ 5 khỉ', reward: { gold: 5 } }] };
      const ce = await call('api/admin/events', { admin: process.env.MONKEY_ADMIN_KEY, body: evBody });
      ok(ce.status === 200 && ce.data.event.id > 0, 'admin tạo sự kiện');
      ok((await call('api/admin/events', { admin: process.env.MONKEY_ADMIN_KEY, body: { ...evBody, endsAt: evBody.startsAt } })).status === 400, 'admin sự kiện ngày sai → 400');
      const le = await call('api/admin/events', { admin: process.env.MONKEY_ADMIN_KEY });
      ok(le.status === 200 && le.data.events.some((e: any) => e.id === ce.data.event.id), 'admin liệt kê sự kiện');
      const del = await call('api/admin/events/delete', { admin: process.env.MONKEY_ADMIN_KEY, body: { id: ce.data.event.id } });
      ok(del.status === 200, 'admin xoá sự kiện');
      const me2 = await call('api/me', { token: tok });
      ok(me2.data.profile.gold >= 777, 'vàng admin tặng hiện trong me');
      const ce2 = await call('api/claim-event', { token: tok, body: { eventId: me2.data.events[0]?.event.id ?? 1, objective: 'play' } });
      ok(ce2.status === 400 && /Chưa hoàn thành/.test(ce2.data.error), 'claim chưa đủ → 400');
      await call('api/logout', { token: tok, body: {} });
      ok((await call('api/me', { token: tok })).status === 401, 'logout huỷ token');
    } finally {
      if (savedKey === undefined) delete process.env.MONKEY_ADMIN_KEY;
      else process.env.MONKEY_ADMIN_KEY = savedKey;
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }
}

/** một kết nối quản trị tạm */
async function admin2(url: string, fn: (q: (sql: string) => Promise<unknown>) => Promise<unknown>) {
  const p = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await fn((sql) => p.query(sql));
  } finally {
    await p.end();
  }
}

/* ---------------- chạy ---------------- */
const mem = new MemStore();
await mem.init();
await suite('MemStore', mem);

loadDotEnv();
const url = process.env.DATABASE_URL;
if (url) {
  const schema = 'test_' + randomBytes(5).toString('hex');
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  let pgs: PgStore | null = null;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pgs = new PgStore({ connectionString: url, schema });
    const t = Date.now();
    await pgs.init();
    console.log(`\n(PgStore: schema tạm ${schema}, migrate ${Date.now() - t} ms)`);
    await pgs.init(); // chạy lại không lỗi (idempotent)
    ok((await pgs.listEvents()).length === 1, 'migrate lần 2 không tạo trùng sự kiện');
    await suite('PgStore (Neon)', pgs);
    // giao dịch song song: hai lần nâng cấp cùng lúc chỉ đủ tiền cho một
    const id = (await pgs.createAccount('race', await hashPassword('matkhau123')))!;
    const knife = (await pgs.me(id, NOW())).items.find((i) => i.itemId === 'k_gam')!;
    await pgs.grant(id, { gold: upgradeCost(0, 1), items: [{ itemId: 'm_da', grade: 0, count: 5 }] } as Reward);
    const rs = await Promise.allSettled([pgs.upgradeItem(id, knife.uid), pgs.upgradeItem(id, knife.uid)]);
    ok(rs.filter((r) => r.status === 'fulfilled').length === 1 && (await pgs.me(id, NOW())).profile.gold === 0, 'FOR UPDATE: 2 yêu cầu song song không tiêu trùng vàng');
  } catch (e) {
    ok(false, `PgStore lỗi: ${(e as Error).message.replace(/postgres(?:ql)?:\/\/\S+/gi, '<url>')}`);
  } finally {
    await pgs?.close().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch((e) => console.warn('không xoá được schema tạm', schema, e.message));
    await admin.end();
  }
  // nâng cấp một DB v1 có dữ liệu thật lên v2
  const schema2 = 'test_' + randomBytes(5).toString('hex');
  const S2 = `"${schema2}".`;
  let up: PgStore | null = null;
  try {
    await admin2(url, async (q) => {
      await q(`CREATE SCHEMA "${schema2}"`);
      await q(`CREATE TABLE ${S2}schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      await q(MIGRATIONS[0](S2));
      await q(`INSERT INTO ${S2}schema_version (version) VALUES (1)`);
      await q(`INSERT INTO ${S2}accounts (username, ukey, pass_hash, gold) VALUES ('old','old','x', 50)`);
      await q(`INSERT INTO ${S2}items (account_id, item_id, slot, rarity, subs, equipped) VALUES
        (1,'k_gam','knife',0,'{}',true), (1,'g_ranlua','gun',3,'{"dmg":0.05,"cashGain":0.1}',true), (1,'h_tre','helmet',1,'{"luck":0.02}',false)`);
      for (let i = 0; i < 65; i++) await q(`INSERT INTO ${S2}items (account_id, item_id, slot, rarity, subs, equipped) VALUES (1,'s_rung','skin',0,'{}',false)`);
    });
    up = new PgStore({ connectionString: url, schema: schema2 });
    await up.init();
    const m = await up.me(1, NOW());
    const gun = m.items.find((i) => i.itemId === 'g_ranlua')!;
    ok(m.items.find((i) => i.itemId === 'k_gam')?.slot === 'knife' && gun.slot === 'weapon1' && gun.grade === 3, 'v1→v2: đồ đang mặc vào đúng ô (súng → weapon1), độ hiếm → phẩm');
    ok(gun.affixes.dmg === 0.05 && Math.abs((gun.affixes.luck ?? 0) - 0.1) < 1e-9 && !('cashGain' in gun.affixes), 'v1→v2: dòng phụ cashGain → luck');
    const hat = m.items.find((i) => i.itemId === 'h_tre')!;
    ok(hat.slot === null && Math.abs((hat.affixes.luck ?? 0) - 0.02) < 1e-9 && hat.count === 1, 'v1→v2: đồ trong kho → túi, count 1');
    ok(m.items.filter((i) => !i.slot && !i.stash).length === 60 && m.items.filter((i) => i.stash).length === 6, 'v1→v2: túi vượt 60 → phần dư vào kho');
    ok((await up.loadout(1, 0)).weapons[0].name === 'Súng Trường Rắn Lửa', 'v1→v2: loadout dùng súng cũ');
    await rejects(up.equip(1, hat.uid, 'helmet'), 'v1→v2: mũ Xanh vẫn cần cấp 4', 'cấp 4');
    const skin = m.items.find((i) => i.itemId === 's_rung' && i.stash)!;
    await up.equip(1, skin.uid, 'skin');
    ok((await up.me(1, NOW())).items.find((i) => i.uid === skin.uid)?.slot === 'skin', 'v1→v2: thao tác bình thường sau nâng cấp (mặc từ kho)');
  } catch (e) {
    ok(false, `nâng cấp v1→v2 lỗi: ${(e as Error).message.replace(/postgres(?:ql)?:\/\/\S+/gi, '<url>')}`);
  } finally {
    await up?.close().catch(() => {});
    await admin2(url, (q) => q(`DROP SCHEMA IF EXISTS "${schema2}" CASCADE`)).catch((e) => console.warn('không xoá được schema tạm', schema2, e.message));
  }
} else {
  console.log('\n(không có DATABASE_URL — bỏ qua PgStore)');
}

console.log(`\n${fails ? '✘' : '✔'} ${passes} đạt, ${fails} lỗi`);
process.exit(fails ? 1 : 0);
