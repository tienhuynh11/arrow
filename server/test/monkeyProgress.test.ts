// Kiểm thử gameplay vượt ải + chỉ số đồ của Bầy Khỉ (dùng MemStore, không cần DB).
// Chạy: cd server && npx tsx test/monkeyProgress.test.ts
import { GameModel } from '../../shared/monkey/client.js';
import { CLASSES, MK_NAU, MK_NO, MK_VUA, MONKEYS, maxHpOf, waveSpec, weaponOf, type WeaponDef } from '../../shared/monkey/content.js';
import type { ConsumableEffect } from '../../shared/monkey/gear.js';
import {
  BASE_KNIFE_DMG, NO_MODS, STAGE_BY_ID, STAGES, capStats, loadoutOf2, simModsOf, weaponFromItem, type Loadout2, type SimMods,
} from '../../shared/monkey/progression.js';
import { PJ_GRENADE, SnapData, decodeSnap } from '../../shared/monkey/proto.js';
import {
  B_FIRE, B_RELOAD, P_C, P_G, P_K, P_U1, P_U2, P_V, P_W1, P_W2, SWAP_TICKS, curWeapon, newState, step, type Cmd,
} from '../../shared/monkey/sim.js';
import { MemStore } from '../src/monkey/db/memStore.js';
import type { ExtractRun, RunResult } from '../src/monkey/db/store.js';
import { BAG_CAP, LOOT_CAP, LOOT_PICK_R, MonkeyRoom, type MConn, type MPlayer } from '../src/monkey/room.js';
import { inst, runStage, starterLoadout } from './monkeyStageBalance.js';
import { runSim } from './monkeySim.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};
const mkCmd = (seq: number, o: Partial<Cmd> = {}): Cmd => ({ seq, mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0, vt: 0, ...o });
const tickOut = () => new Promise((r) => setTimeout(r, 0));

/** MemStore + ghi đè loadout (đặt chỉ số tuỳ ý) + nhật ký recordRun */
class TestStore extends MemStore {
  lo = new Map<number, Loadout2>();
  runLog: RunResult[] = [];
  extLog: ExtractRun[] = [];
  async loadout(id: number, cls: number) {
    return this.lo.get(id) ?? super.loadout(id, cls);
  }
  async recordRun(r: RunResult, now: Date) {
    this.runLog.push(r);
    return super.recordRun(r, now);
  }
  async recordExtract(r: ExtractRun, now: Date) {
    this.extLog.push(r);
    return super.recordExtract(r, now);
  }
}
const SK = { g: 1, x: 1, q: 1 };
/** Loadout2 dựng tay (khách / ghi đè) */
const kitLo = (weapons: WeaponDef[], quick: { itemId: string; count: number; effect: ConsumableEffect }[] = [], stats: Loadout2['stats'] = {}, carried: number[] = []): Loadout2 =>
  ({ stats, weapons, knifeDmg: BASE_KNIFE_DMG, quick, skills: SK, look: {}, carried });

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
    const lr = store.extLog[store.extLog.length - 1];
    ok(lr.accountId === C && lr.won && lr.stage === '1-1' && lr.stars === 3 && lr.extract.survived, 'recordExtract({won:true, stars:3, survived})');
    ok(!!rw.extract && rw.extract.survived && (lr.chest.gold ?? 0) > 0, 'RunReward.extract có mặt, rương ải đã tung');
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
    const ex = store.extLog.slice(-2);
    ok(ex.length === 2 && ex.every((r) => !r.won && r.stage === '1-2' && !r.extract.survived && r.chest.xp === 40 && !r.chest.gold), 'cả đội gục: recordExtract({won:false, survived:false}), chỉ XP an ủi (20×2)');
    ok(o.rewards.every((r: any) => r.extract && r.extract.survived === false && !r.reward.gold), 'over.rewards[i].extract: mất đồ, không vàng');
    ok(store.runLog.length === n0, 'ải không gọi recordRun nữa');
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

  /* ---------------- 6. ải không có xu / cửa hàng ---------------- */
  console.log('\n[6] Ải: không xu, không cửa hàng, kỹ năng miễn phí; vô tận giữ nguyên');
  {
    const { room, msgs, conn, now } = rig(store);
    room.mode = 'stage';
    const a = room.add('alice', 0, conn(), A);
    await room.whenLoaded();
    room.start(a);
    ok(last(msgs, 'start').economy === false && a.cash === 0, "start.economy=false, xu = 0");
    a.cash = 99999;
    room.buy(a, 'weapon');
    ok(a.st.tier === 0 && last(msgs, 'ev')?.k === 'noshop', 'V: không nâng súng (ev noshop)');
    room.buy(a, 'hp');
    ok(a.hpTier === 0, 'C: không mua máu');
    a.cash = 0;
    room.killed(0, MK_NAU, a.idx, 0, 0, 0);
    ok(a.cash === 0, 'hạ khỉ không được xu');
    now.t += 20;
    room.onCmds(a, [mkCmd(1, { yaw: a.st.yaw, btn: P_G })], 1);
    ok(room.skillCost(a, 'g') === 0 && a.cdG > room.world!.tick && last(msgs, 'ev')?.k === 'skill', 'G không tốn xu (vẫn hồi chiêu)');
    room.dispose();
    const r2 = rig(store);
    const h = r2.room.add('alice', 0, r2.conn(), A);
    await r2.room.whenLoaded();
    r2.room.start(h);
    ok(last(r2.msgs, 'start').economy === true && h.cash > 0, 'vô tận: economy=true, có xu khởi đầu');
    h.cash = 99999;
    r2.room.buy(h, 'weapon');
    r2.room.buy(h, 'hp');
    ok(h.st.tier === 1 && h.hpTier === 1 && !last(r2.msgs, 'start').players[0].weapons, 'vô tận: V/C vẫn mua được, không có weapons trong start');
    r2.room.dispose();
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
    store.lo.set(D, kitLo([weaponOf(0, 0)], [], capStats({ speed: 0.5 })));
    const { room, msgs, conn, now } = rig(store);
    const p = room.add('dave', 0, conn(), D);
    await room.whenLoaded();
    room.start(p);
    const sp = last(msgs, 'start').players[0];
    ok(sp.mods.speed === 0.15 && sp.mods.fireRate === 0, `start.players[0].mods đã chặn trần (speed ${sp.mods.speed}; v2: tốc bắn nướng vào súng)`);
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
    ok(big.hp === 300 && big.armor === 0.5 && big.dmg === 0.8 && big.speed === 0.15 && big.luck === 0.6 && big.knifeDmg === 600, 'capStats chặn đúng trần');
    const lo = loadoutOf2([inst('k_lua', 'knife', 3, 10, 1, { knifeDmg: 9999, speed: 9 })], 0, SK);
    ok(lo.stats.knifeDmg === 600 && lo.stats.speed === 0.15, 'loadoutOf2 cộng dồn rồi chặn trần');
    const E = (await store.createAccount('erin', 'x'))!;
    store.lo.set(E, { ...kitLo([weaponOf(0, 0)], [], { hp: 40, armor: 0.2, dmg: 0.1, knifeDmg: 120 }), skills: { g: 5, x: 1, q: 3 }, look: { knife: 'k_lua' } });
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
    ok(p.cash - c0 === MONKEYS[MK_NAU].reward, `vô tận: hạ khỉ nâu được ${p.cash - c0} xu`);
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

  /* ======================= CHẾ ĐỘ MANG ĐỒ (ải) ======================= */
  const W1 = weaponFromItem(inst('g_mangxa', 'weapon1', 2, 5), 0);
  const W2 = weaponFromItem(inst('g_k9', 'weapon2', 1, 1), 0);
  const MEDKIT = { itemId: 'q_maunho', count: 2, effect: { kind: 'heal', amount: 50 } as ConsumableEffect };
  /** phòng ải toàn khách (bỏ qua kiểm tra đăng nhập) với Loadout2 cho từng người */
  const stageRig = (los: Loadout2[], stage = '1-1') => {
    const r = rig(store, los.length === 1);
    r.room.mode = 'stage';
    r.room.stageId = stage;
    const ps = los.map((lo, i) => {
      const p = r.room.add('p' + i, 0, r.conn());
      p.loadout = lo;
      p.loadoutCls = 0;
      return p;
    });
    r.room.begin();
    r.room.wPhase = 1; // đang đánh (hurt chỉ có hiệu lực khi đánh)
    return { ...r, ps };
  };
  /** chạy 1 tick, bắt snapshot gửi cho người idx rồi giải */
  const snapOf = (room: MonkeyRoom, idx: number) => {
    const sent: Uint8Array[] = [];
    const p = room.players[idx]!;
    const old = p.conn!;
    p.conn = { sent: 0, send: (d) => { if (typeof d !== 'string') sent.push(d); else old.send(d); }, close() {} };
    room.step();
    p.conn = old;
    const sd = new SnapData();
    const b = sent[sent.length - 1];
    decodeSnap(new DataView(b.buffer, b.byteOffset, b.byteLength), sd);
    return sd.players.slice(0, sd.np).find((q) => q.idx === idx)!;
  };

  /* ---------------- 10. súng từ trang bị ---------------- */
  console.log('\n[10] Súng từ trang bị: server + client dùng đúng WeaponDef trong tin start');
  {
    const { room, msgs, now, ps: [p] } = stageRig([kitLo([W1, W2], [MEDKIT])]);
    const sp = last(msgs, 'start').players[0];
    ok(JSON.stringify(sp.weapons) === JSON.stringify([W1, W2]) && sp.quick[0].itemId === 'q_maunho' && sp.quick[0].count === 2, `start.players[0]: weapons [${W1.name}, ${W2.name}] + quick`);
    ok(curWeapon(p.st).name === W1.name && p.st.ammo === W1.mag && p.st.ammoAlt === W2.mag, `cầm khẩu 1 (băng ${W1.mag}), khẩu 2 để dành (${W2.mag})`);
    const gm = new GameModel(p.idx, p.cls, p.st.x, p.st.z, sp.mods, STAGE_BY_ID['1-1'], sp.weapons);
    const cl = gm.pred;
    cl.yaw = p.st.yaw;
    let same = true;
    let seq = 1;
    let fired = 0;
    for (let k = 0; k < 80; k++) {
      const batch: Cmd[] = [];
      for (let i = 0; i < 5; i++) {
        let btn = k % 4 ? B_FIRE : 0;
        if (k === 20 && i === 0) btn |= P_W2;
        if (k === 30 && i === 2) btn = B_RELOAD;
        if (k === 31 && i === 0) btn |= P_W1; // đổi súng huỷ nạp đạn
        if (k === 55 && i === 1) btn |= P_W2;
        batch.push(mkCmd(seq++, { mz: k % 9 < 4 ? 127 : -60, mx: k % 7 === 0 ? 60 : 0, yaw: (p.st.yaw + k * 200) & 0xffff, btn }));
      }
      now.t += 100;
      room.onCmds(p, batch, batch.length);
      for (const c of batch) if (step(cl, c) & 1) fired++;
      if (cl.x !== p.st.x || cl.z !== p.st.z || cl.ammo !== p.st.ammo || cl.ammoAlt !== p.st.ammoAlt || cl.wslot !== p.st.wslot || cl.swapT !== p.st.swapT || cl.fireCd !== p.st.fireCd || cl.reloadT !== p.st.reloadT) same = false;
    }
    ok(same && fired > 20, `400 lệnh (bắn, nạp, đổi súng ×3): client trùng bit với server (${fired} phát)`);
    const s0 = snapOf(room, p.idx);
    ok(s0.wslot === p.st.wslot && s0.ammoAlt === p.st.ammoAlt && s0.q1 === 2 && s0.bag === 0, 'snapshot mang wslot/ammoAlt/q1/bag');
    room.dispose();
  }
  {
    // dự đoán qua mạng ảo: 2 bot ải với 2 khẩu (bot đổi súng định kỳ), RTT 80ms
    const pred = new Map<string, number>();
    const srv = new Map<string, number>();
    const dead = new Map<string, Uint8Array>();
    let roomRef: MonkeyRoom | null = null;
    let swaps = 0;
    const lo = kitLo([W1, W2], [MEDKIT], { hp: 150, armor: 0.3 });
    const r = runSim({
      players: 2, classes: [0, 0], rtt: 80, jitter: 12, seconds: 90, seed: 33, skill: 0.6, stage: '1-1', loadout: () => lo,
      onRoom: (room) => { roomRef = room; room.onPellet = (i, sq, k, slot) => { const key = `${i}:${sq}:${k}`; srv.set(key, slot); dead.set(key, roomRef!.world!.alive.slice()); }; },
      onModel: (cl) => { cl.brain.swapEvery = 5000; cl.model!.onPredPellet = (sq, k, slot) => pred.set(`${cl.idx}:${sq}:${k}`, slot); },
      onTick: (room) => { for (const q of room.players) if (q && q.st.swapT === SWAP_TICKS - 1) swaps++; },
    });
    let agree = 0, live = 0;
    for (const [key, psl] of pred) {
      const ss = srv.get(key);
      if (ss === undefined || psl < 0) continue;
      if (ss !== psl && dead.get(key) && !dead.get(key)![psl]) continue;
      live++;
      if (ss === psl) agree++;
    }
    const pct = (agree / Math.max(1, live)) * 100;
    ok(pct >= 97 && live > 30, `ải, RTT 80ms, súng từ đồ: ${agree}/${live} viên dự đoán trúng được server xác nhận (${pct.toFixed(1)}%)`);
    ok(r.maxCorrection < 0.35, `ải: sửa vị trí ${r.corrections} lần, lệch tối đa ${(r.maxCorrection * 100).toFixed(1)} cm (bot đổi súng giữa trận)`);
    void swaps;
  }

  /* ---------------- 11. đổi súng ---------------- */
  console.log('\n[11] Đổi súng (phím 1/2): 0,4 giây, huỷ nạp đạn');
  {
    const s = newState(0, 0, 0, NO_MODS, [W1, W2]);
    s.ammo = 3;
    step(s, mkCmd(1, { btn: B_RELOAD }));
    ok(s.reloadT > 0, 'đang nạp đạn khẩu 1');
    step(s, mkCmd(2, { btn: P_W2 }));
    ok(s.wslot === 1 && s.reloadT === 0 && s.ammo === W2.mag && s.ammoAlt === 3 && s.swapT === SWAP_TICKS - 1, `P_W2: cầm khẩu 2, huỷ nạp, đổi băng (${SWAP_TICKS} tick)`);
    let firstShot = -1;
    for (let i = 3; i < 60 && firstShot < 0; i++) if (step(s, mkCmd(i, { btn: B_FIRE })) & 1) firstShot = i;
    ok(firstShot === 1 + SWAP_TICKS, `không bắn được khi đang đổi: phát đầu sau ${firstShot - 2} tick (~0,4 giây)`);
    step(s, mkCmd(100, { btn: P_W2 }));
    ok(s.wslot === 1 && s.swapT === 0, 'bấm lại súng đang cầm: không làm gì');
    step(s, mkCmd(101, { btn: P_W1 }));
    ok(s.wslot === 0 && s.ammo === 3, 'P_W1: về khẩu 1, còn đúng 3 viên');
    const one = newState(0, 0, 0, NO_MODS, [W1]);
    step(one, mkCmd(1, { btn: P_W2 }));
    ok(one.wslot === 0 && one.swapT === 0, 'chỉ một khẩu: không đổi');
    const endless = newState(0, 0, 0);
    step(endless, mkCmd(1, { btn: P_W2 }));
    ok(endless.weapons === null && endless.wslot === 0 && curWeapon(endless) === weaponOf(0, 0), 'vô tận: dòng súng theo bậc, phím 1/2 không tác dụng');
    ok((P_W1 | P_W2 | P_U1 | P_U2) <= 0xffff, 'bit mới vừa trường btn 16 bit');
  }

  /* ---------------- 12. vật phẩm ---------------- */
  console.log('\n[12] Vật phẩm ô nhanh (phím 3/4)');
  {
    const quick = [MEDKIT, { itemId: 'q_khientam', count: 1, effect: { kind: 'shield', amount: 60, secs: 8 } as ConsumableEffect }];
    const { room, msgs, now, ps: [p] } = stageRig([kitLo([W1], quick)]);
    let seq = 1;
    const press = (btn: number) => { now.t += 20; room.onCmds(p, [mkCmd(seq++, { yaw: p.st.yaw, btn })], 1); };
    press(P_U1);
    ok(p.quickLeft[0] === 2 && !msgs.some((m) => m.k === 'use'), 'đầy máu: không phí bình máu');
    p.hp = 20;
    press(P_U1);
    const ev = last(msgs, 'ev');
    ok(p.hp === 70 && p.quickLeft[0] === 1 && ev.k === 'use' && ev.i === p.idx && ev.s === 'q_maunho' && ev.v === 1 && ev.j === 0, `hồi 50 máu → ${p.hp}, còn 1 (ev use)`);
    p.hp = 20;
    press(P_U1);
    ok(p.quickLeft[0] === 1, 'giãn cách 0,8 giây giữa 2 lần dùng');
    for (let i = 0; i < 17; i++) room.step();
    press(P_U1);
    ok(p.quickLeft[0] === 0 && p.used.q_maunho === 2, 'dùng tiếp sau giãn cách; used = 2');
    for (let i = 0; i < 17; i++) room.step();
    p.hp = 20;
    press(P_U1);
    ok(p.hp === 20, 'hết hàng: không dùng được');
    press(P_U2);
    ok(p.shield === 60 && p.quickLeft[1] === 0, 'khiên 60');
    room.hurt(p.idx, 40, 0, 0, 0);
    ok(p.shield === 20 && p.hp === 20, 'khiên đỡ đòn trước');
    for (let i = 0; i < 8 * 20 + 2; i++) room.step();
    ok(p.shield === 0, 'khiên hết sau 8 giây');
    const sn = snapOf(room, p.idx);
    ok(sn.q1 === 0 && sn.q2 === 0, 'snapshot: q1/q2 = 0');
    room.dispose();
  }
  {
    const quick = [
      { itemId: 'q_tochanh', count: 1, effect: { kind: 'speed', mul: 1.3, secs: 8 } as ConsumableEffect },
      { itemId: 'q_luudan', count: 2, effect: { kind: 'grenade', dmg: 160, radius: 4 } as ConsumableEffect },
    ];
    const { room, msgs, now, ps: [p] } = stageRig([kitLo([W1], quick)]);
    const w = room.world!;
    let seq = 1;
    const press = (btn: number, o: Partial<Cmd> = {}) => { now.t += 20; room.onCmds(p, [mkCmd(seq++, { yaw: p.st.yaw, btn, ...o })], 1); };
    press(P_U1);
    ok(p.st.spdT === 8 * 60 && p.st.spdMul === 1.3, 'tốc hành: spdT 8 giây, ×1,3 (lượng tử 1/50)');
    const base = newState(0, 0, 0, NO_MODS, [W1]);
    const fast = newState(0, 0, 0, NO_MODS, [W1]);
    fast.spdT = 100;
    fast.spdMul = 1.3;
    for (let i = 0; i < 30; i++) { step(base, mkCmd(i, { mz: 127 })); step(fast, mkCmd(i, { mz: 127 })); }
    ok(Math.abs(Math.hypot(fast.vx, fast.vz) / Math.hypot(base.vx, base.vz) - 1.3) < 0.01, 'sim: chạy nhanh ×1,3 (client dự đoán được qua snapshot spdT/spdMul)');
    const sn = snapOf(room, p.idx);
    ok(sn.spdT > 0 && Math.abs(sn.spdMul - 1.3) < 1e-9, `snapshot spdT=${sn.spdT}, spdMul=${sn.spdMul}`);
    for (let i = 0; i < 17; i++) room.step();
    press(P_U2, { pitch: -2000 });
    let s = -1;
    for (let i = 0; i < 64; i++) if (w.pAlive[i] && w.pKind[i] === PJ_GRENADE && w.pOwner[i] === p.idx) s = i;
    ok(s >= 0 && w.pDmg[s] === 160 && w.pRad[s] === 4, 'lựu đạn: ném ra 1 quả (160 sát thương, 4m)');
    for (let i = 0; i < 40 && w.pAlive[s] && w.pT[s] > 0.12; i++) room.step();
    const m = w.spawn(MK_NAU, w.pX[s] + 1, w.pZ[s], 50, 1, 1);
    const hp0 = w.hp[m];
    for (let i = 0; i < 10 && w.pAlive[s]; i++) room.step();
    ok(!w.alive[m] || w.hp[m] < hp0 - 50, 'lựu đạn nổ trúng khỉ gần đó');
    ok(msgs.filter((x) => x.k === 'use').length === 2 && p.quickLeft[1] === 1, 'ev use ×2, còn 1 lựu đạn');
    room.dispose();
  }
  {
    const quick = [{ itemId: 'q_hoisinh', count: 1, effect: { kind: 'revive' } as ConsumableEffect }];
    const { room, msgs, ps: [p] } = stageRig([kitLo([W1], quick), kitLo([W1])]);
    room.hurt(p.idx, 9999, 0, 0, 0);
    ok(p.st.down === 1, 'gục');
    for (let i = 0; i < 31; i++) room.step();
    ok(p.st.down === 0 && p.quickLeft[0] === 0 && p.hp === Math.round(p.maxHp * 0.5) && msgs.some((m) => m.k === 'use' && m.s === 'q_hoisinh'), 'bình hồi sinh tự dùng sau 1,5 giây: đứng dậy với 50% máu');
    room.dispose();
  }

  /* ---------------- 13. túi đồ trên đất ---------------- */
  console.log('\n[13] Túi đồ rơi: sinh, nhặt, trần, hết hạn');
  {
    const { room, msgs, ps: [p] } = stageRig([kitLo([W1])]);
    const drop = { itemId: 'h_sat', grade: 1 as const, subs: {} };
    const g = room.dropLoot(drop, p.st.x + 5, p.st.z)!;
    const ev = last(msgs, 'ev');
    ok(ev.k === 'loot' && ev.id === g.id && ev.itemId === 'h_sat' && ev.grade === 1 && typeof ev.x === 'number', "ev {k:'loot', id, x, z, grade, itemId}");
    room.step();
    ok(p.bag.length === 0 && room.loot.length === 1, 'xa 5m: chưa nhặt');
    p.st.x = g.x + LOOT_PICK_R * 0.8;
    p.st.z = g.z;
    room.step();
    ok(p.bag.length === 1 && room.loot.length === 0 && msgs.some((m) => m.k === 'picked' && m.v === g.id && m.i === p.idx && m.s === 'h_sat' && m.j === 1) && msgs.some((m) => m.k === 'unloot' && m.v === g.id), 'đi tới gần: tự nhặt vào ba lô (ev picked + unloot)');
    const n0 = msgs.filter((m) => m.k === 'unloot').length;
    for (let i = 0; i < LOOT_CAP + 5; i++) room.dropLoot(drop, 30, 30);
    ok(room.loot.length === LOOT_CAP && msgs.filter((m) => m.k === 'unloot').length - n0 === 5, `tối đa ${LOOT_CAP} túi: túi cũ nhất biến mất`);
    room.loot[0].until = room.world!.tick + 1;
    room.step();
    ok(room.loot.length === LOOT_CAP - 1, 'quá 60 giây: túi biến mất');
    while (p.bag.length < BAG_CAP) p.bag.push(drop);
    const near = room.dropLoot(drop, p.st.x, p.st.z)!;
    room.step();
    ok(p.bag.length === BAG_CAP && room.loot.some((b) => b.id === near.id) && msgs.some((m) => m.k === 'bagfull'), `ba lô ${BAG_CAP} món: không nhặt thêm (ev bagfull)`);
    room.loot.length = 0;
    room.killed(0, MK_VUA, p.idx, 0, 0, 0);
    ok(room.loot.length >= 2, `boss rơi ${room.loot.length} túi`);
    const sl = (room as unknown as { startMsg(): { loot: object[] } }).startMsg().loot;
    ok(sl.length === room.loot.length && JSON.stringify(Object.keys(sl[0]).sort()) === JSON.stringify(['grade', 'id', 'itemId', 'x', 'z']), 'start.loot (vào lại giữa trận) = GroundLoot[]');
    room.loot.length = 0;
    let drops = 0;
    for (let i = 0; i < 400; i++) {
      const n = room.loot.length;
      room.killed(0, MK_NAU, p.idx, 0, 0, 0);
      if (room.loot.length !== n) drops++;
    }
    ok(drops > 2 && drops < 60, `khỉ nâu: ${drops}/400 lần rơi đồ (~4%)`);
    room.dispose();
    const e = rig(store);
    const h = e.room.add('khach', 0, e.conn());
    e.room.start(h);
    e.room.killed(0, MK_VUA, h.idx, 0, 0, 0);
    ok(e.room.loot.length === 0 && !e.msgs.some((m) => m.k === 'loot'), 'vô tận: không rơi túi đồ');
    e.room.dispose();
  }

  /* ---------------- 14. chết là mất đồ ---------------- */
  console.log('\n[14] Chết là mất: giữ túi an toàn; thắng giữ hết + rương');
  {
    const F = (await store.createAccount('frank', 'x'))!;
    const G = (await store.createAccount('gina', 'x'))!;
    for (const id of [F, G]) for (const st of ['1-1', '1-2']) await clear(store, id, st);
    // trang bị thật trong kho: súng + mũ mang vào, 1 món trong túi an toàn
    const gear = async (id: number) => {
      const its = await store.grant(id, { items: [{ itemId: 'g_k9', grade: 0 }, { itemId: 'h_mutre', grade: 0 }, { itemId: 'a_da', grade: 0 }] });
      await store.equip(id, its[0].uid, 'weapon1');
      await store.equip(id, its[1].uid, 'helmet');
      await store.equip(id, its[2].uid, 'secure');
      return its.map((i) => i.uid);
    };
    const [fGun, fHelm, fSec] = await gear(F);
    const [gGun, gHelm, gSec] = await gear(G);
    const { room, msgs, now, conn } = rig(store);
    room.mode = 'stage';
    room.stageId = '1-2';
    const f = room.add('frank', 0, conn(), F);
    const g = room.add('gina', 0, conn(), G);
    await room.whenLoaded();
    room.setReady(g, true);
    ok(room.start(f) === null, 'vào ải 1-2');
    ok(f.kit!.carried.includes(fGun) && f.kit!.carried.includes(fHelm) && !f.kit!.carried.includes(fSec), 'carried = đồ đang mặc trừ túi an toàn');
    ok(curWeapon(f.st).name === 'Súng Lục K-9' && f.st.weapons!.length === 1, `cầm đúng khẩu từ kho: ${curWeapon(f.st).name}`);
    room.wPhase = 1;
    f.bag.push({ itemId: 'r_bac', grade: 2, subs: {} });
    g.bag.push({ itemId: 'am_go', grade: 1, subs: {} });
    room.hurt(f.idx, 9999, 0, 0, 0);
    f.bleedUntil = room.world!.tick + 1;
    room.step();
    room.step();
    ok(f.st.down === 2 && f.out && msgs.some((m) => m.k === 'out' && m.i === f.idx), 'chết hẳn trong ải: bị loại (ev out)');
    room.wave = room.lastWave - 1;
    room.wPhase = 1;
    room.spec = waveSpec(room.wave, 2, STAGE_BY_ID['1-2']);
    room.toSpawn = 0;
    room.step();
    ok(f.st.down === 2 && !msgs.some((m) => m.k === 'respawn' && m.i === f.idx), 'qua đợt: người bị loại không được hồi sinh');
    room.wPhase = 1;
    room.wave = room.lastWave;
    room.spec = waveSpec(room.wave, 2, STAGE_BY_ID['1-2']);
    room.toSpawn = 0;
    now.t += 30_000;
    room.step();
    await room.settling;
    const v = last(msgs, 'victory');
    const rf = v?.rewards.find((r: any) => r.idx === f.idx), rg = v?.rewards.find((r: any) => r.idx === g.idx);
    ok(!!v && rf.extract.survived === false && rg.extract.survived === true, 'đội thắng: gina sống (survived), frank đã chết (không)');
    ok(rf.extract.lost.includes(fGun) && rf.extract.lost.includes(fHelm) && !rf.extract.lost.includes(fSec) && rf.extract.looted.length === 0, 'frank: mất súng + mũ + ba lô, túi an toàn còn');
    ok(rg.extract.kept.includes(gGun) && rg.extract.kept.includes(gHelm) && rg.extract.lost.length === 0 && rg.extract.looted.length === 1, 'gina: giữ đồ mang vào + đồ nhặt');
    const fi = (await store.me(F, new Date())).items.map((i) => i.uid);
    const gi = (await store.me(G, new Date())).items;
    ok(!fi.includes(fGun) && !fi.includes(fHelm) && fi.includes(fSec), 'DB frank: súng + mũ đã xoá, túi an toàn còn');
    ok([gGun, gHelm, gSec].every((u) => gi.some((i) => i.uid === u)) && gi.some((i) => i.itemId === 'am_go'), 'DB gina: còn đủ đồ + món nhặt (Bùa Gỗ Đào)');
    ok((rg.reward.gold ?? 0) > 0 && !(rf.reward.gold ?? 0), `rương ải: gina ${rg.reward.gold} vàng; frank 0 vàng (XP an ủi ${rf.reward.xp ?? 0})`);
    ok(store.extLog.slice(-2).every((r) => r.won && r.stage === '1-2'), 'recordExtract({won:true}) cho cả hai');
    room.dispose();
    // cả đội gục: mọi người mất đồ (trừ túi an toàn)
    const r2 = rig(store);
    r2.room.mode = 'stage';
    r2.room.stageId = '1-1';
    const g2 = r2.room.add('gina', 0, r2.conn(), G);
    await r2.room.whenLoaded();
    r2.room.start(g2);
    ok(g2.kit!.carried.includes(gGun), 'gina mang súng vào ải 1-1');
    r2.room.wPhase = 1;
    g2.st.down = 2;
    r2.room.step();
    await r2.room.settling;
    const o = last(r2.msgs, 'over');
    const gi2 = (await store.me(G, new Date())).items.map((i) => i.uid);
    ok(!!o && o.rewards[0].extract.survived === false && o.rewards[0].extract.lost.includes(gGun), 'cả đội gục: tin over báo mất đồ');
    ok(!gi2.includes(gGun) && !gi2.includes(gHelm) && gi2.includes(gSec), 'DB: mất súng + mũ, còn túi an toàn');
    r2.room.dispose();
  }

  /* ---------------- 15. cân bằng ---------------- */
  console.log('\n[15] Cân bằng ải với bộ tân binh (bot một mình)');
  {
    const lo = starterLoadout(0);
    ok(lo.weapons.length === 1 && lo.quick.length === 1 && lo.quick[0].count === 2, `bộ tân binh: ${lo.weapons[0].name} + dao + ${lo.quick[0].count} ${lo.quick[0].itemId}`);
    const r11 = [1, 2, 3].map((seed) => runStage('1-1', seed));
    ok(r11.filter((r) => r.won).length >= 2, `1-1: thắng ${r11.filter((r) => r.won).length}/3 ván (${r11.map((r) => `${r.wave}/${r.lastWave}`).join(', ')})`);
    const r18 = [1, 2, 3].map((seed) => runStage('1-8', seed));
    ok(r18.filter((r) => !r.won).length >= 2, `1-8: thua ${r18.filter((r) => !r.won).length}/3 ván (${r18.map((r) => `${r.wave}/${r.lastWave}`).join(', ')}) → cần đồ tốt hơn`);
  }

  console.log(fails ? `\n✘ ${fails} kiểm thử thất bại` : '\n✔ Tất cả kiểm thử đạt');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
