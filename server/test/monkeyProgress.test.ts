// Kiểm thử gameplay vượt ải + chỉ số đồ của Bầy Khỉ (dùng MemStore, không cần DB).
// Chạy: cd server && npx tsx test/monkeyProgress.test.ts
import { GameModel } from '../../shared/monkey/client.js';
import { CLASSES, MK_NAU, MK_NO, MONKEYS, maxHpOf, waveSpec, weaponOf } from '../../shared/monkey/content.js';
import { BASE_KNIFE_DMG, NO_MODS, STAGE_BY_ID, STAGES, capStats, loadoutOf, simModsOf, type Loadout, type SimMods } from '../../shared/monkey/progression.js';
import { B_FIRE, B_RELOAD, P_C, P_G, P_K, P_V, newState, step, type Cmd } from '../../shared/monkey/sim.js';
import { MemStore } from '../src/monkey/db/memStore.js';
import type { RunResult } from '../src/monkey/db/store.js';
import { MonkeyRoom, type MConn, type MPlayer } from '../src/monkey/room.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};
const mkCmd = (seq: number, o: Partial<Cmd> = {}): Cmd => ({ seq, mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0, vt: 0, ...o });
const tickOut = () => new Promise((r) => setTimeout(r, 0));

/** MemStore + ghi đè loadout (đặt chỉ số tuỳ ý) + nhật ký recordRun */
class TestStore extends MemStore {
  lo = new Map<number, Loadout>();
  runLog: RunResult[] = [];
  async loadout(id: number, cls: number) {
    return this.lo.get(id) ?? super.loadout(id, cls);
  }
  async recordRun(r: RunResult, now: Date) {
    this.runLog.push(r);
    return super.recordRun(r, now);
  }
}

interface Rig { room: MonkeyRoom; msgs: any[]; now: { t: number }; conn: () => MConn }
function rig(store: TestStore, solo = false): Rig {
  const msgs: any[] = [];
  const now = { t: 1000 };
  const room = new MonkeyRoom('T' + Math.floor(Math.random() * 1e6), solo, store);
  room.manual = true;
  room.clock = () => now.t;
  room.rng = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const conn = (): MConn => ({ sent: 0, send: (d) => { if (typeof d === 'string') msgs.push(JSON.parse(d)); }, close() {} });
  return { room, msgs, now, conn };
}
const last = (msgs: any[], t: string) => [...msgs].reverse().find((m) => m.t === t);
const clear = (store: TestStore, id: number, stage: string) =>
  store.recordRun({ accountId: id, stage, won: true, stars: 1, wave: 5, kills: 0, secs: 100, score: 0, reward: {} }, new Date());

async function main() {
  const store = new TestStore();
  await store.init();
  const A = (await store.createAccount('alice', 'x'))!;
  const B = (await store.createAccount('bob', 'x'))!;
  for (const st of ['1-1', '1-2', '1-3']) await clear(store, A, st);
  await clear(store, B, '1-1');

  /* ---------------- 1. giao các ải ---------------- */
  console.log('\n[1] Phòng ải: chỉ chọn được ải giao nhau');
  {
    const { room, msgs, conn } = rig(store);
    room.mode = 'stage';
    const a = room.add('alice', 0, conn(), A);
    await room.whenLoaded();
    ok(room.playableStages().includes('1-4') && !room.playableStages().includes('1-5'), 'một mình A: mở tới 1-4');
    ok(room.setStage(a, '1-4') === null && room.stageId === '1-4', 'chủ phòng chọn 1-4');
    const b = room.add('bob', 1, conn(), B);
    await room.whenLoaded();
    await tickOut();
    const pl = room.playableStages();
    ok(pl.includes('1-1') && pl.includes('1-2') && !pl.includes('1-3'), `A+B: giao = ${pl.filter((x) => !STAGE_BY_ID[x].event).join(',')}`);
    ok(pl.includes('ev-vuonchuoi'), 'ải sự kiện luôn có trong danh sách');
    ok(room.stageId === '1-2', `B chưa mở 1-4 → ải lùi về ${room.stageId}`);
    const rm = last(msgs, 'room');
    ok(rm.mode === 'stage' && rm.stage === '1-2' && JSON.stringify(rm.stages) === JSON.stringify(pl), 'tin room mang mode/stage/stages');
    ok(rm.players.every((p: any) => p.guest === false && p.level >= 1), 'LobbyPlayer có level + guest=false');
    ok(room.setStage(a, '1-3') !== null && room.stageId === '1-2', 'chọn ải B chưa mở → bị từ chối');
    ok(room.setStage(b, '1-1') !== null, 'không phải chủ phòng → không đổi được ải');
    ok(room.setStage(a, 'xx') !== null, 'ải không tồn tại → từ chối');
    room.setReady(b, true);
    b.cleared = new Set(); // mô phỏng: dữ liệu đổi trước lúc bắt đầu → kiểm tra lại khi start
    ok(room.start(a) !== null && room.phase === 'lobby', 'kiểm tra lại lúc bắt đầu: có người chưa mở ải → không vào trận');
    room.dispose();
  }

  /* ---------------- 2. khách ---------------- */
  console.log('\n[2] Khách không vào được chế độ ải');
  {
    const { room, msgs, conn } = rig(store);
    room.mode = 'stage';
    ok(room.canJoin(true) !== null, `khách xin vào phòng ải: "${room.canJoin(true)}"`);
    ok(room.canJoin(false) === null, 'người đăng nhập vào được');
    room.dispose();
    const r2 = rig(store);
    const h = r2.room.add('alice', 0, r2.conn(), A);
    r2.room.add('khach', 0, r2.conn());
    await r2.room.whenLoaded();
    ok(r2.room.setMode(h, 'stage') !== null && r2.room.mode === 'endless', 'có khách trong phòng → không đổi sang ải được');
    const lp = last(r2.msgs, 'room').players;
    ok(lp.some((p: any) => p.guest === true && p.level === undefined), 'khách: guest=true, không có level');
    const pl = r2.room.playableStages().filter((x) => !STAGE_BY_ID[x].event);
    ok(pl.length === 1 && pl[0] === STAGES[0].id, 'khách coi như chưa qua ải nào: chỉ ải đầu + ải sự kiện');
    r2.room.dispose();
    void msgs;
  }

  /* ---------------- 3. thắng ải ---------------- */
  console.log('\n[3] Thắng ải: đúng đợt cuối, sao, thưởng từng người');
  {
    const C = (await store.createAccount('carol', 'x'))!;
    const { room, msgs, conn, now } = rig(store, true);
    room.mode = 'stage';
    room.stageId = '1-1';
    room.add('carol', 0, conn(), C);
    let err = '';
    room.beginSolo((m) => { err = m; });
    ok(room.phase === 'lobby', 'chơi đơn có tài khoản: chờ tải trang bị rồi mới vào trận');
    await room.whenLoaded();
    await tickOut();
    ok(room.phase === 'play' && !err, 'vào trận sau khi tải xong');
    const sd = STAGE_BY_ID['1-1'];
    const start = last(msgs, 'start');
    ok(start.mode === 'stage' && start.stage === '1-1' && start.waves === sd.waves && start.map === sd.map, `tin start: mode/stage/waves=${start.waves}/map=${start.map}`);
    ok(start.players[0].mods && start.players[0].look, 'start.players có mods + look');
    // đợt áp chót: chưa thắng
    room.wave = room.lastWave - 1;
    room.wPhase = 1;
    room.spec = waveSpec(room.wave, 1, sd);
    room.toSpawn = 0;
    room.step();
    ok(room.phase === 'play' && !last(msgs, 'victory'), `xong đợt ${room.lastWave - 1}/${room.lastWave}: chưa thắng, nghỉ giữa đợt`);
    // đợt cuối
    room.wave = room.lastWave;
    room.wPhase = 1;
    room.spec = waveSpec(room.wave, 1, sd);
    room.toSpawn = 0;
    now.t += 60_000;
    room.step();
    ok(room.phase === 'over' && room.world === null, 'xong đợt cuối → kết thúc, giải phóng thế giới');
    await room.settling;
    const v = last(msgs, 'victory');
    ok(!!v && v.stage === '1-1' && v.stars === 3, `tin victory: ${v?.stars} sao`);
    ok(!last(msgs, 'over'), 'thắng không gửi thêm tin over');
    const rw = v.rewards[0];
    ok(rw.reward && rw.reward.gold > 0 && rw.reward.xp > 0 && rw.firstClear === true, `thưởng: ${rw.reward.gold} vàng, ${rw.reward.xp} XP, ${rw.reward.items.length} đồ, lần đầu qua`);
    ok(rw.reward.items.every((i: any) => typeof i.uid === 'number'), 'đồ thưởng đã có uid');
    const lr = store.runLog[store.runLog.length - 1];
    ok(lr.accountId === C && lr.won && lr.stage === '1-1' && lr.stars === 3, 'recordRun({won:true, stars:3})');
    ok((await store.clearedStages(C)).has('1-1'), 'DB: đã qua 1-1');
    room.again(room.players[0]!);
    ok(room.playableStages().includes('1-2'), 'chơi lại: mở được ải 1-2');
    // 1 sao: còn < 50% máu và có người gục
    const p = room.players[0]!;
    room.wave = room.lastWave;
    room.wPhase = 1;
    room.spec = waveSpec(room.wave, 1, sd);
    room.toSpawn = 0;
    p.hp = p.maxHp * 0.3;
    p.downs = 1;
    room.step();
    await room.settling;
    const v2 = last(msgs, 'victory');
    ok(v2.stars === 1 && v2.rewards[0].firstClear === false, `máu < 50% + có người gục → ${v2.stars} sao, không còn thưởng lần đầu`);
    room.dispose();
  }

  /* ---------------- 4. thua: thưởng an ủi ---------------- */
  console.log('\n[4] Thua: thưởng an ủi');
  {
    const { room, msgs, conn } = rig(store);
    room.mode = 'stage';
    room.stageId = '1-2';
    const a = room.add('alice', 0, conn(), A);
    room.add('bob', 1, conn(), B);
    await room.whenLoaded();
    room.setReady(room.players[1]!, true);
    ok(room.start(a) === null, 'bắt đầu ải 1-2 (cả hai đã mở)');
    room.wave = room.firstWave + 2; // đã qua 2 đợt, đang ở đợt thứ 3
    room.wPhase = 1;
    for (const q of room.players) if (q) q.st.down = 2;
    const n0 = store.runLog.length;
    room.step();
    ok(room.phase === 'over' && !last(msgs, 'over'), 'có người đăng nhập: chờ ghi DB rồi mới gửi over');
    await room.settling;
    const o = last(msgs, 'over');
    ok(!!o && o.stage === '1-2' && o.rewards.length === 2, 'tin over có stage + rewards cho 2 người');
    ok(o.rewards.every((r: any) => r.reward.gold === 30 && r.reward.xp === 40 && r.reward.items.length === 0), 'an ủi: 15×2 vàng, 20×2 XP, không đồ');
    ok(store.runLog.slice(n0).every((r) => !r.won && r.stage === '1-2'), 'recordRun({won:false})');
    room.dispose();
    // vô tận có tài khoản: vẫn ghi để sự kiện đếm khỉ
    const r2 = rig(store);
    const h = r2.room.add('alice', 0, r2.conn(), A);
    await r2.room.whenLoaded();
    r2.room.start(h);
    h.kills = 7;
    r2.room.wave = 4;
    r2.room.wPhase = 1;
    h.st.down = 2;
    const n1 = store.runLog.length;
    r2.room.step();
    await r2.room.settling;
    const lr = store.runLog[n1];
    ok(!!lr && lr.stage === 'endless' && lr.kills === 7 && lr.reward.gold === 45, 'vô tận: ghi trận "endless" (7 khỉ, 45 vàng an ủi)');
    ok(Array.isArray(last(r2.msgs, 'over').board), 'over vẫn có bảng xếp hạng');
    r2.room.dispose();
  }

  /* ---------------- 5. luật ải trong waveSpec ---------------- */
  console.log('\n[5] Luật đặc biệt + độ khó trong waveSpec');
  {
    const b = waveSpec(6, 2);
    const st = (mods: any[], diff = 1) => waveSpec(6, 2, { diff, mods });
    ok(Math.abs(st(['fast']).spdMul - b.spdMul * 1.25) < 1e-9, 'fast: khỉ nhanh +25%');
    ok(Math.abs(st(['tough']).hpMul - b.hpMul * 1.4) < 1e-9, 'tough: máu +40%');
    ok(Math.abs(st([], 1.5).hpMul - b.hpMul * 1.5) < 1e-9 && Math.abs(st([], 1.5).dmgMul - b.dmgMul * 1.5) < 1e-9, 'diff nhân máu + sát thương');
    ok(waveSpec(4, 1, { diff: 1, mods: ['bossRush'] }).boss && !waveSpec(3, 1, { diff: 1, mods: ['bossRush'] }).boss && !waveSpec(4, 1).boss, 'bossRush: boss mỗi 2 đợt');
    const ex = st(['explosiveOnly']).weights;
    ok(ex[MK_NO] > 0 && ex.every((w, i) => i === MK_NO || w === 0), 'explosiveOnly: chỉ khỉ nổ');
    ok(JSON.stringify(st(['night', 'pistolOnly', 'noShop'])) === JSON.stringify(st([])), 'night/pistolOnly/noShop không đổi đợt');
    ok(JSON.stringify(waveSpec(6, 2, undefined)) === JSON.stringify(b), 'vô tận: không đổi');
  }

  /* ---------------- 6. chặn mua ---------------- */
  console.log('\n[6] pistolOnly / noShop chặn mua');
  {
    const { room, msgs, conn } = rig(store);
    room.mode = 'stage';
    const a = room.add('alice', 0, conn(), A);
    await room.whenLoaded();
    room.start(a);
    room.stageDef = { ...STAGE_BY_ID['1-1'], mods: ['pistolOnly'] };
    a.cash = 99999;
    room.buy(a, 'weapon');
    ok(a.st.tier === 0 && last(msgs, 'ev')?.k === 'noshop', 'pistolOnly: không nâng súng (ev noshop)');
    room.buy(a, 'hp');
    ok(a.hpTier === 1, 'pistolOnly: vẫn mua máu được');
    room.stageDef = { ...STAGE_BY_ID['1-1'], mods: ['noShop'] };
    room.buy(a, 'hp');
    room.buy(a, 'weapon');
    ok(a.hpTier === 1 && a.st.tier === 0, 'noShop: chặn mọi thứ');
    ok(STAGE_BY_ID['1-8'].mods.includes('pistolOnly'), 'ải 1-8 là pistolOnly');
    room.dispose();
  }

  /* ---------------- 7. mods mô phỏng ---------------- */
  console.log('\n[7] Chỉ số đồ trong mô phỏng: client = server');
  {
    const mods: SimMods = { speed: 0.12, fireRate: 0.25, reload: 0.3 };
    const a = newState(0, 0, -3, mods), b = newState(0, 0, -3);
    let shotsA = 0, shotsB = 0, relA = 0, relB = 0;
    for (let i = 1; i <= 300; i++) {
      const c = mkCmd(i, { mz: 127, btn: B_FIRE });
      if (step(a, c) & 1) shotsA++;
      if (step(b, c) & 1) shotsB++;
    }
    const ma = newState(0, 0, -3, mods), mb = newState(0, 0, -3);
    for (let i = 1; i <= 8; i++) { step(ma, mkCmd(i, { mz: 127 })); step(mb, mkCmd(i, { mz: 127 })); }
    const da = Math.hypot(ma.vx, ma.vz), db = Math.hypot(mb.vx, mb.vz);
    ok(Math.abs(da / db - 1.12) < 1e-9, `speed +12%: vận tốc ${da.toFixed(3)} so với ${db.toFixed(3)} m/s`);
    ok(shotsA > shotsB, `fireRate: ${shotsA} phát so với ${shotsB}`);
    const r1 = newState(0, 0, 0, mods), r2 = newState(0, 0, 0);
    r1.ammo = r2.ammo = 1;
    step(r1, mkCmd(1, { btn: B_RELOAD }));
    step(r2, mkCmd(1, { btn: B_RELOAD }));
    relA = r1.reloadT; relB = r2.reloadT;
    ok(relA < relB && relA === Math.round(relB * 0.7), `reload: ${relA} tick so với ${relB}`);
    // server (loadout) và client (GameModel từ tin start) chạy cùng lệnh → cùng bit
    const D = (await store.createAccount('dave', 'x'))!;
    store.lo.set(D, { stats: capStats({ speed: 0.5, fireRate: 0.1, reload: 0.2 }), skills: { g: 1, x: 1, q: 1 }, look: {} });
    const { room, msgs, conn, now } = rig(store);
    const p = room.add('dave', 0, conn(), D);
    await room.whenLoaded();
    room.start(p);
    const sp = last(msgs, 'start').players[0];
    ok(sp.mods.speed === 0.12 && sp.mods.fireRate === 0.1, `start.players[0].mods đã chặn trần (speed ${sp.mods.speed})`);
    const gm = new GameModel(p.idx, p.cls, p.st.x, p.st.z, sp.mods);
    const cl = gm.pred;
    cl.yaw = p.st.yaw;
    let same = true;
    let seq = 1;
    for (let k = 0; k < 40; k++) {
      const batch: Cmd[] = [];
      for (let i = 0; i < 5; i++) batch.push(mkCmd(seq++, { mz: 127, mx: k % 7 === 0 ? 60 : 0, yaw: (p.st.yaw + k * 300) & 0xffff, btn: k % 3 ? B_FIRE : 0 }));
      now.t += 100;
      room.onCmds(p, batch, batch.length);
      for (const c of batch) step(cl, c);
      if (cl.x !== p.st.x || cl.z !== p.st.z || cl.ammo !== p.st.ammo || cl.fireCd !== p.st.fireCd) same = false;
    }
    ok(same && p.st.mods === p.st.mods && cl.mods.speed === p.st.mods.speed, '200 lệnh: client dự đoán trùng bit với server (có mods)');
    const noMods = newState(0, 0, 0);
    ok(noMods.mods === NO_MODS && simModsOf(null) === NO_MODS, 'khách: NO_MODS');
    room.dispose();
  }

  /* ---------------- 8. dao ---------------- */
  console.log('\n[8] Dao (phím F): trúng, hồi chiêu, đâm sau lưng');
  {
    const { room, msgs, conn, now } = rig(store);
    const p = room.add('khach', 0, conn());
    room.start(p);
    const w = room.world!;
    let seq = 1;
    const fx = Math.sin((p.st.yaw / 65536) * Math.PI * 2), fz = Math.cos((p.st.yaw / 65536) * Math.PI * 2);
    const put = (d: number, ang = 0) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      const dx = fx * c - fz * s, dz = fz * c + fx * s; // xoay hướng nhìn
      return w.spawn(MK_NAU, p.st.x + dx * d, p.st.z + dz * d, 20, 1, 1);
    };
    const slash = () => { now.t += 20; room.onCmds(p, [mkCmd(seq++, { yaw: p.st.yaw, btn: P_K, vt: (w.tick + 5) * 16 })], 1); };
    const m1 = put(1.5);
    // khỉ nhìn về phía người chém (mặt đối mặt)
    w.yaw[m1] = Math.atan2(p.st.x - w.x[m1], p.st.z - w.z[m1]);
    const hp0 = w.hp[m1];
    slash();
    ok(Math.abs(hp0 - w.hp[m1] - BASE_KNIFE_DMG) < 1e-6, `chém trước mặt: -${(hp0 - w.hp[m1]).toFixed(0)} máu (dao cơ bản ${BASE_KNIFE_DMG})`);
    ok(last(msgs, 'ev')?.k === 'knife' && last(msgs, 'ev').i === p.idx, "phát ev 'knife'");
    const hp1 = w.hp[m1];
    slash();
    ok(w.hp[m1] === hp1, 'chém lại ngay: đang hồi chiêu, không trúng');
    for (let i = 0; i < 12; i++) room.step();
    w.x[m1] = p.st.x + fx * 1.5; w.z[m1] = p.st.z + fz * 1.5;
    // quay lưng lại người chém
    w.yaw[m1] = Math.atan2(fx, fz);
    const hp2 = w.hp[m1];
    slash();
    ok(Math.abs(hp2 - w.hp[m1] - BASE_KNIFE_DMG * 2) < 1e-6, `hết hồi chiêu (0,6s) + sau lưng: ×2 = -${(hp2 - w.hp[m1]).toFixed(0)}`);
    w.damage(m1, 1e9, -1, 0, 4);
    for (let i = 0; i < 12; i++) room.step();
    const far = put(4), side = put(1.5, Math.PI * 0.6), behind = put(1.5, Math.PI);
    const hps = [far, side, behind].map((s) => w.hp[s]);
    slash();
    ok([far, side, behind].every((s, k) => w.hp[s] === hps[k]), 'ngoài tầm 2,2m / ngoài nón ±50° / sau lưng người chém: không trúng');
    for (const s of [far, side, behind]) w.damage(s, 1e9, -1, 0, 4);
    for (let i = 0; i < 12; i++) room.step();
    const m2 = put(1.2);
    w.yaw[m2] = Math.atan2(p.st.x - w.x[m2], p.st.z - w.z[m2]);
    p.st.down = 1;
    const hp3 = w.hp[m2];
    slash();
    ok(w.hp[m2] === hp3, 'đang gục: không chém được');
    room.dispose();
  }

  /* ---------------- 9. chỉ số đồ ở server ---------------- */
  console.log('\n[9] Chỉ số đồ: trần, máu, giáp, sát thương, xu, kỹ năng');
  {
    const big = capStats({ hp: 999, armor: 0.9, dmg: 5, speed: 1, luck: 3, knifeDmg: 9999 });
    ok(big.hp === 150 && big.armor === 0.4 && big.dmg === 0.6 && big.speed === 0.12 && big.luck === 0.5 && big.knifeDmg === 400, 'capStats chặn đúng trần');
    const lo = loadoutOf([{ uid: 1, itemId: 'k_lua', rarity: 3, level: 10, subs: { knifeDmg: 9999, speed: 9 }, equipped: true }], { g: 1, x: 1, q: 1 });
    ok(lo.stats.knifeDmg === 400 && lo.stats.speed === 0.12, 'loadoutOf cộng dồn rồi chặn trần');
    const E = (await store.createAccount('erin', 'x'))!;
    store.lo.set(E, { stats: { hp: 40, armor: 0.2, dmg: 0.1, cashGain: 0.5, knifeDmg: 120 }, skills: { g: 5, x: 1, q: 3 }, look: { knife: 'k_lua' } });
    const { room, msgs, conn, now } = rig(store);
    const p = room.add('erin', 0, conn(), E);
    await room.whenLoaded();
    room.start(p);
    ok(p.maxHp === maxHpOf(0, 0) + 40 && p.hp === p.maxHp, `máu tối đa ${p.maxHp} = ${maxHpOf(0, 0)} + 40`);
    ok(last(msgs, 'start').players[0].look.knife === 'k_lua', 'start.players[0].look = đồ đang mặc');
    room.wPhase = 1;
    const h0 = p.hp;
    room.hurt(p.idx, 100, 0, 0, 0);
    ok(Math.abs(h0 - p.hp - 80) < 1e-6, `giáp 20%: nhận ${(h0 - p.hp).toFixed(0)}/100`);
    room.wPhase = 2;
    const c0 = p.cash;
    room.killed(0, MK_NAU, p.idx, 0, 0, 0);
    ok(p.cash - c0 === Math.round(MONKEYS[MK_NAU].reward * 1.5), `cashGain +50%: hạ khỉ nâu được ${p.cash - c0} xu`);
    const w = room.world!;
    const fx = Math.sin((p.st.yaw / 65536) * Math.PI * 2), fz = Math.cos((p.st.yaw / 65536) * Math.PI * 2);
    const m = w.spawn(MK_NAU, p.st.x + fx * 1.4, p.st.z + fz * 1.4, 20, 1, 1);
    w.yaw[m] = Math.atan2(-fx, -fz);
    const hm = w.hp[m];
    now.t += 20;
    room.onCmds(p, [mkCmd(1, { yaw: p.st.yaw, btn: P_K, vt: w.tick * 16 })], 1);
    ok(Math.abs(hm - w.hp[m] - 120 * 1.1) < 1e-6, `dao Lửa 120 × (1+10% sát thương) = -${(hm - w.hp[m]).toFixed(0)}`);
    // kỹ năng G cấp 5: giá ×0,8
    p.cash = 1000;
    const gCost = room.skillCost(p, 'g');
    now.t += 20;
    room.onCmds(p, [mkCmd(2, { yaw: p.st.yaw, btn: P_G })], 1);
    ok(gCost === Math.round(CLASSES[0].g.cost * 0.8) && p.cash === 1000 - gCost, `G cấp 5: giá ${gCost} xu (gốc ${CLASSES[0].g.cost})`);
    ok(room.ultNeed(p) === Math.round(45 * 0.9), `Q cấp 3: cần ${room.ultNeed(p)} khỉ để sạc`);
    // mua máu vẫn cộng chỉ số đồ
    p.cash = 99999;
    now.t += 20;
    room.onCmds(p, [mkCmd(3, { yaw: p.st.yaw, btn: P_C })], 1);
    ok(p.maxHp === maxHpOf(0, 1) + 40, 'nâng máu giữ +40 của đồ');
    void P_V; void weaponOf;
    room.dispose();
  }

  console.log(fails ? `\n✘ ${fails} kiểm thử thất bại` : '\n✔ Tất cả kiểm thử đạt');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
