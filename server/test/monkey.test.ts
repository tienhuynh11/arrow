// Kiểm thử xác định cho SINH TỒN BẦY KHỈ. Chạy: cd server && npx tsx test/monkey.test.ts [quick]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.MONKEY_DATA_DIR = mkdtempSync(join(tmpdir(), 'monkey-test-'));

import { GameModel } from '../../shared/monkey/client.js';
import { HIST, LAG_COMP_TICKS } from '../../shared/monkey/config.js';
import { CLASSES, HP_TIER_COST, MK_NAU, MONKEYS, TEAM_SHARE, ULT_KILLS, WEAPONS, waveSpec } from '../../shared/monkey/content.js';
import { ARENA, BOXES, CIRCLES, PLAYER_R } from '../../shared/monkey/map.js';
import { SnapData, Writer, decodeCmds, decodeSnap, encodeCmds, BIN_SNAP } from '../../shared/monkey/proto.js';
import { B_FIRE, B_USE, P_V, copyState, newState, pelletDirs, step, type Cmd } from '../../shared/monkey/sim.js';
import { MonkeyRoom, type MConn } from '../src/monkey/room.js';
import { MonkeyWorld, type WorldHost } from '../src/monkey/world.js';
import { runSim } from './monkeySim.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};
const quick = process.argv.includes('quick');
const mkCmd = (seq: number, o: Partial<Cmd> = {}): Cmd => ({ seq, mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0, vt: 0, ...o });
let rs = 12345;
const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);

/* ---------------- 1. mô phỏng xác định ---------------- */
console.log('\n[1] Mô phỏng người chơi xác định + va chạm');
{
  const a = newState(0, 0, -3);
  const b = newState(0, 0, -3);
  let same = true;
  let inside = false;
  for (let i = 1; i < 6000; i++) {
    const c = mkCmd(i, { mx: Math.round((rnd() - 0.5) * 254), mz: Math.round((rnd() - 0.3) * 254), yaw: Math.floor(rnd() * 65536), pitch: Math.round((rnd() - 0.5) * 20000), btn: rnd() < 0.3 ? B_FIRE : rnd() < 0.05 ? 8 : 0 });
    step(a, c);
    step(b, { ...c });
    if (a.x !== b.x || a.z !== b.z || a.ammo !== b.ammo || a.fireCd !== b.fireCd || a.y !== b.y) same = false;
    for (const cc of CIRCLES) if (Math.hypot(a.x - cc.x, a.z - cc.z) < cc.r + PLAYER_R - 1e-6) inside = true;
    for (const bx of BOXES) if (Math.abs(a.x - bx.x) < bx.hx + PLAYER_R - 0.05 && Math.abs(a.z - bx.z) < bx.hz + PLAYER_R - 0.05) inside = true;
    if (Math.abs(a.x) > ARENA || Math.abs(a.z) > ARENA) inside = true;
  }
  ok(same, '6000 bước ngẫu nhiên: hai bản sao ra cùng bit');
  ok(!inside, 'không bao giờ lọt vào vật cản hay ra ngoài sân');
  // tản đạn xác định + trong nón
  const s = newState(0, 0, 0);
  s.tier = 2;
  s.yaw = 12345;
  s.pitch = 1000;
  const d1 = new Float64Array(64), d2 = new Float64Array(64);
  const c = mkCmd(77, { yaw: 12345, pitch: 1000 });
  pelletDirs(s, c, 1, d1);
  pelletDirs(s, c, 1, d2);
  let eq = true, inCone = true;
  for (let i = 0; i < 30; i++) if (d1[i] !== d2[i]) eq = false;
  const fx = Math.sin((12345 / 65536) * Math.PI * 2) * Math.cos((1000 / 65536) * Math.PI * 2);
  for (let k = 0; k < WEAPONS[2].pellets; k++) {
    const dot = d1[k * 3] * fx + d1[k * 3 + 1] * Math.sin((1000 / 65536) * Math.PI * 2) + d1[k * 3 + 2] * Math.cos((12345 / 65536) * Math.PI * 2) * Math.cos((1000 / 65536) * Math.PI * 2);
    if (Math.acos(Math.min(1, dot)) > WEAPONS[2].spread * 1.05 + 0.01) inCone = false;
  }
  ok(eq && inCone, 'tản đạn súng săn: client/server cùng hướng, nằm trong nón tản');
  // nhịp bắn + nạp đạn
  const w = newState(0, 0, 0);
  let shots = 0;
  for (let i = 1; i <= 600; i++) if (step(w, mkCmd(i, { btn: B_FIRE })) & 1) shots++;
  const per = 6000 / WEAPONS[0].interval;
  const expect = (10 / ((WEAPONS[0].mag / per) + WEAPONS[0].reload / 60)) * WEAPONS[0].mag;
  ok(Math.abs(shots - expect) < 6, `súng lục 10 giây giữ cò: ${shots} phát (lý thuyết ≈${expect.toFixed(0)}, gồm thời gian nạp)`);
}

/* ---------------- 2. mã hoá ---------------- */
console.log('\n[2] Mã hoá lệnh + snapshot delta');
{
  const cmds: Cmd[] = [];
  for (let i = 0; i < 5; i++) cmds.push(mkCmd(1000 + i, { mx: -127 + i * 50, mz: 127 - i, yaw: 65535 - i, pitch: -13000 + i, btn: 0xffff >> i, vt: 123456 + i }));
  const buf = encodeCmds(cmds, 0, 5);
  const out: Cmd[] = Array.from({ length: 12 }, () => mkCmd(0));
  const n = decodeCmds(new DataView(buf), out);
  ok(n === 5 && out.slice(0, 5).every((c, i) => JSON.stringify(c) === JSON.stringify(cmds[i])), 'lệnh: mã hoá ↔ giải mã khớp hoàn toàn');
  ok(decodeCmds(new DataView(new ArrayBuffer(7)), out) === -1, 'gói lệnh hỏng bị từ chối');

  // thế giới thật + client: sau 400 tick delta, vị trí khỉ client khớp server (sai số lượng tử)
  const host: WorldHost = { hurt() {}, killed() {}, heal() {}, pickup() {} };
  const w = new MonkeyWorld(host, 7);
  const st = newState(0, 0, 0);
  w.players = [{ idx: 0, st, tauntUntil: 0 }];
  const model = new GameModel(0, 0, 0, 0);
  const sd = new SnapData();
  const wr = new Writer();
  let maxErr = 0;
  let bytes = 0;
  for (let t = 0; t < 400; t++) {
    if (t % 3 === 0 && w.count < 120) w.spawn(Math.floor(rnd() * 6), (rnd() - 0.5) * 60, (rnd() - 0.5) * 60, 1, 1, 1);
    if (t % 7 === 0) for (let i = 0; i < 160; i++) if (w.alive[i] && rnd() < 0.05) w.damage(i, 9999, 0, 0, 0);
    w.update();
    wr.reset();
    wr.u8(BIN_SNAP); wr.u32(w.tick); wr.u8(0); wr.u8(1); wr.u16(1); wr.u16(0); wr.u16(0); wr.u8(0);
    w.encodeMonkeys(wr, false);
    w.clearEvents();
    const b = wr.bytes();
    bytes += b.byteLength;
    if (!decodeSnap(new DataView(b.buffer), sd)) { ok(false, 'giải snapshot'); break; }
    model.onSnap(sd, t * 50);
    for (let i = 0; i < 160; i++) {
      if (!w.alive[i]) continue;
      const o = new Float64Array(2);
      model.monkeyLatest(i, o);
      maxErr = Math.max(maxErr, Math.hypot(o[0] - w.x[i], o[1] - w.z[i]));
    }
  }
  ok(maxErr < 0.004, `khỉ phía client khớp server sau 400 snapshot delta (sai số tối đa ${(maxErr * 1000).toFixed(1)} mm)`);
  ok(bytes / 400 < 1400, `kích thước snapshot TB ${(bytes / 400).toFixed(0)} byte với ~100+ khỉ (${((bytes / 400) * 20 / 1024).toFixed(1)} KB/s)`);
  // khung hình đầy đủ cho người vào giữa trận
  wr.reset();
  wr.u8(BIN_SNAP); wr.u32(w.tick); wr.u8(1); wr.u8(1); wr.u16(1); wr.u16(0); wr.u16(0); wr.u8(0);
  w.encodeMonkeys(wr, true);
  const b = wr.bytes();
  const m2 = new GameModel(0, 0, 0, 0);
  decodeSnap(new DataView(b.buffer), sd);
  m2.onSnap(sd, 0);
  let alive = 0, match = 0;
  for (let i = 0; i < 160; i++) if (w.alive[i]) { alive++; const o = new Float64Array(2); m2.monkeyLatest(i, o); if (m2.mAlive[i] && Math.hypot(o[0] - w.x[i], o[1] - w.z[i]) < 0.004) match++; }
  ok(alive > 0 && alive === match, `keyframe: người vào sau nhận đủ ${match}/${alive} khỉ`);
}

/* ---------------- 3. bù trễ ---------------- */
console.log('\n[3] Bù trễ khi bắn (tua lịch sử)');
{
  const host: WorldHost = { hurt() {}, killed() {}, heal() {}, pickup() {} };
  const w = new MonkeyWorld(host, 3);
  const st = newState(0, 0, 0);
  w.players = [];
  const s = w.spawn(MK_NAU, -1, 20, 1, 1, 1);
  w.update();
  // khỉ chạy ngang 0.25m mỗi tick; người bắn đứng ở (0, 4) — ngoài bàn thờ, nhìn qua khe tường
  const xs: number[] = [];
  for (let t = 0; t < 12; t++) {
    w.x[s] = -1 + t * 0.25;
    w.z[s] = 20;
    (w as any).recordHistory();
    w.tick++;
    xs.push(w.x[s]);
  }
  w.tick--;
  const now = w.tick;
  const vt = now - 5;
  const aim = (x: number) => { const dx = x, dz = 16; const d = Math.hypot(dx, dz); return [dx / d, 0, dz / d]; };
  let [dx, dy, dz] = aim(xs[xs.length - 1 - 5]);
  const hitOld = w.traceRewind(0, 0.62, 4, dx, dy, dz, 60, vt, 1);
  [dx, dy, dz] = aim(w.x[s]);
  const hitNowWithOldVt = w.traceRewind(0, 0.62, 4, dx, dy, dz, 60, vt, 1);
  const hitNowNow = w.traceRewind(0, 0.62, 4, dx, dy, dz, 60, now, 1);
  ok(hitOld === 1 && hitNowWithOldVt === 0 && hitNowNow === 1, 'tua về đúng vị trí khỉ ở thời điểm người bắn nhìn thấy');
  const mid = (xs[xs.length - 1 - 5] + xs[xs.length - 1 - 4]) / 2;
  [dx, dy, dz] = aim(mid);
  ok(w.traceRewind(0, 0.62, 4, dx, dy, dz, 60, vt + 0.5, 1) === 1, 'nội suy giữa hai tick lịch sử');
  ok(LAG_COMP_TICKS < HIST - 1, `lịch sử ${HIST} tick đủ cho bù trễ tối đa ${LAG_COMP_TICKS} tick (${LAG_COMP_TICKS * 50}ms)`);
  void st;
}

/* ---------------- 4. dự đoán + hoà giải qua mạng ảo ---------------- */
console.log('\n[4] Dự đoán + hoà giải, bù trễ end-to-end (mạng ảo, bot thật)');
for (const rtt of quick ? [0, 150] : [0, 80, 150, 250]) {
  const pred = new Map<string, number>();
  const srv = new Map<string, number>();
  const dead = new Map<string, Uint8Array>();
  let roomRef: MonkeyRoom | null = null;
  const r = runSim({
    players: 2, rtt, jitter: rtt * 0.15, seconds: quick ? 60 : 120, seed: 21, skill: 0.6,
    onRoom: (room) => { roomRef = room; room.onPellet = (i, seq, k, slot) => { const key = `${i}:${seq}:${k}`; srv.set(key, slot); dead.set(key, roomRef!.world!.alive.slice()); }; },
    onModel: (cl) => { cl.model!.onPredPellet = (seq, k, slot) => pred.set(`${cl.idx}:${seq}:${k}`, slot); },
  });
  let agree = 0, live = 0;
  for (const [key, ps] of pred) {
    const ss = srv.get(key);
    if (ss === undefined || ps < 0) continue;
    // khỉ mình thấy trúng đã bị hạ ở server trước khi phát này tới (bắn thừa) → không tính
    if (ss !== ps && dead.get(key) && !dead.get(key)![ps]) continue;
    live++;
    if (ss === ps) agree++;
  }
  const pct = (agree / Math.max(1, live)) * 100;
  ok(pct >= (rtt >= 250 ? 93 : 97) && live > 30, `RTT ${rtt}ms: ${agree}/${live} viên "thấy trúng" được server xác nhận (${pct.toFixed(1)}%)`);
  ok(r.maxCorrection < 0.35, `RTT ${rtt}ms: sửa vị trí ${r.corrections} lần, lệch tối đa ${(r.maxCorrection * 100).toFixed(1)} cm`);
}

/* ---------------- 5. AI + đợt ---------------- */
console.log('\n[5] AI khỉ, tìm đường, đợt');
{
  let hurt = 0;
  const host: WorldHost = { hurt: (_i, d) => { hurt += d; }, killed() {}, heal() {}, pickup() {} };
  const w = new MonkeyWorld(host, 9);
  const st = newState(0, 0, -22);
  w.players = [{ idx: 0, st, tauntUntil: 0 }];
  // khỉ ở phía bên kia bức tường đổ (z=-14), phải vòng qua khe
  const s = w.spawn(MK_NAU, -5, -6, 1, 1, 1);
  let reached = -1;
  for (let t = 0; t < 400; t++) {
    w.update();
    if (reached < 0 && Math.hypot(w.x[s] - st.x, w.z[s] - st.z) < 1.5) reached = t;
  }
  ok(reached > 0 && reached < 300, `khỉ vòng qua tường tới người chơi sau ${(reached / 20).toFixed(1)} giây`);
  ok(hurt > 0, `khỉ áp sát rồi đánh (gây ${hurt.toFixed(0)} sát thương)`);
  // trần số khỉ + đợt tăng dần
  let mono = true;
  for (let n = 1; n < 40; n++) if (waveSpec(n + 1, 2).total < waveSpec(n, 2).total && (n + 1) % 5 !== 0 && n % 5 !== 0) mono = false;
  ok(mono, 'số khỉ mỗi đợt tăng dần (trừ đợt boss)');
  ok(waveSpec(60, 4).maxAlive <= 150, 'trần khỉ còn sống đồng thời ≤ 150');
  const s1 = waveSpec(1, 1), s3 = waveSpec(3, 1);
  ok(s1.weights[1] === 0 && s1.weights[2] === 0 && s1.total <= 12, `đợt 1 dễ: ${s1.total} khỉ nâu, không có loài đặc biệt`);
  ok(s3.total > s1.total, 'đợt 3 đông hơn đợt 1');
  // tick AI với 150 khỉ đủ rẻ
  const w2 = new MonkeyWorld(host, 1);
  w2.players = [0, 1, 2, 3].map((i) => ({ idx: i, st: newState(i, i * 2 - 3, 0), tauntUntil: 0 }));
  for (let i = 0; i < 150; i++) w2.spawn(i % 6, (rnd() - 0.5) * 64, (rnd() - 0.5) * 64, 1, 1, 1);
  for (let i = 0; i < 40; i++) w2.update();
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) w2.update();
  const per = (performance.now() - t0) / 200;
  ok(per < 3, `AI 150 khỉ + 4 người: ${per.toFixed(2)} ms/tick (ngân sách 50ms)`);
}

/* ---------------- 6. kinh tế + đỡ dậy ---------------- */
console.log('\n[6] Kinh tế, tuyệt chiêu, đỡ dậy');
{
  const sent: string[] = [];
  const conn = (): MConn => ({ sent: 0, send: (d) => { if (typeof d === 'string') sent.push(d); }, close() {} });
  const room = new MonkeyRoom('TEST1', false);
  room.manual = true;
  let now = 1000;
  room.clock = () => now;
  const a = room.add('A', 0, conn());
  const b = room.add('B', 1, conn());
  room.setReady(b, true);
  ok(room.start(a) === null && room.phase === 'play', 'chủ phòng bắt đầu khi mọi người sẵn sàng');
  const w = room.world!;
  // mua súng
  a.cash = WEAPONS[1].cost - 1;
  room.buy(a, 'weapon');
  ok(a.st.tier === 0 && a.cash === WEAPONS[1].cost - 1, 'thiếu xu: không mua được');
  a.cash = WEAPONS[1].cost + 5;
  room.buy(a, 'weapon');
  ok(a.st.tier === 1 && a.cash === 5 && a.st.ammo === WEAPONS[1].mag, 'đủ xu: lên bậc súng, trừ đúng giá, đầy băng');
  a.cash = HP_TIER_COST[1];
  const mhp = a.maxHp;
  room.buy(a, 'hp');
  ok(a.hpTier === 1 && a.maxHp === mhp + 25 && a.cash === 0, 'nâng máu +25');
  // thưởng hạ khỉ: người hạ nhận đủ, đồng đội 30%
  const ca = a.cash, cb = b.cash;
  room.killed(0, MK_NAU, a.idx, 0, 0, 0);
  ok(a.cash - ca === MONKEYS[MK_NAU].reward && b.cash - cb === Math.round(MONKEYS[MK_NAU].reward * TEAM_SHARE), 'chia xu: người hạ 100%, đồng đội 30%');
  for (let i = 0; i < ULT_KILLS; i++) room.killed(0, MK_NAU, a.idx, 0, 0, 0);
  ok(a.ultKills >= ULT_KILLS, `tuyệt chiêu sạc đầy sau ${ULT_KILLS} con`);
  // gục → đỡ dậy bằng cách giữ E 3 giây
  room.wPhase = 1;
  b.st.x = a.st.x + 1; b.st.z = a.st.z;
  room.hurt(b.idx, 9999, 0, 0, 0);
  ok(b.st.down === 1, 'hết máu → gục');
  let seq = 1;
  const cmds: Cmd[] = [];
  const yaw = Math.round((Math.atan2(b.st.x - a.st.x, b.st.z - a.st.z) / (Math.PI * 2)) * 65536) & 0xffff;
  for (let t = 0; t < 3 * 60 + 5; t++) {
    now += 1000 / 60;
    cmds.length = 0;
    cmds.push(mkCmd(seq++, { btn: B_USE, yaw }));
    room.onCmds(a, cmds, 1);
    if (t % 3 === 0) { b.reviveTick = w.tick; }
  }
  ok(b.st.down === 0 && b.hp > 0 && a.revives === 1, `giữ phím đỡ 3 giây → đồng đội đứng dậy với ${b.hp} máu`);
  // nút mua qua lệnh (phím V)
  a.cash = 99999;
  const tier = a.st.tier;
  now += 20;
  room.onCmds(a, [mkCmd(seq++, { btn: P_V })], 1);
  ok(a.st.tier === tier + 1, 'phím V trong lệnh cũng nâng súng');
  // chống tăng tốc: gửi 600 lệnh trong 1 giây → server chỉ nhận ~62+40
  const before = a.cmdsRun;
  const burst: Cmd[] = [];
  for (let i = 0; i < 12; i++) burst.push(mkCmd(0));
  let acc = 0;
  for (let k = 0; k < 50; k++) {
    for (let i = 0; i < 12; i++) burst[i] = mkCmd(seq++, { mz: 127 });
    now += 20;
    room.onCmds(a, burst, 12);
    acc += 12;
  }
  ok(a.cmdsRun - before < 140, `gửi ${acc} lệnh trong 1 giây: server chỉ chạy ${a.cmdsRun - before} (chặn hack tốc độ)`);
  // hết ván → giải phóng thế giới
  a.st.down = 2;
  b.st.down = 2;
  room.wPhase = 1;
  room.step();
  ok(room.phase === 'over' && room.world === null, 'cả đội gục → tổng kết, thế giới được giải phóng');
  const over = sent.map((s) => JSON.parse(s)).find((m) => m.t === 'over');
  ok(!!over && Array.isArray(over.board), 'gửi bảng tổng kết + bảng xếp hạng');
  void copyState;
  void CLASSES;
}

/* ---------------- 7. đợt 1–3 dễ ---------------- */
console.log('\n[7] Độ khó đầu game (bot chơi một mình)');
{
  let pass = 0;
  const seeds = quick ? [1, 2] : [1, 2, 3, 4, 5];
  for (const seed of seeds) {
    const r = runSim({ players: 1, rtt: 80, seconds: 300, seed, skill: 0.5 });
    if (r.wave >= 4) pass++;
  }
  ok(pass === seeds.length, `bot một mình (ngắm kém) qua đủ đợt 1–3 ở ${pass}/${seeds.length} ván`);
}

console.log(fails ? `\n✘ ${fails} kiểm thử thất bại` : '\n✔ Tất cả kiểm thử đạt');
process.exit(fails ? 1 : 0);
