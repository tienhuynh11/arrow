// Chạy: cd server && npx tsx test/tank.test.ts [quick]
import {
  ANG_N, B_DEAD, BSPEED, CELL, COS, SIN, MAXT, Maze, RING, TICK_HZ, TankWorld, mazeDims, mulberry32, splitArenas, traceRay, MUZZLE,
} from '../../shared/tank.js';
import { TankClient } from '../../shared/tankClient.js';
import { Arena, DEFAULT_OPTS } from '../src/games/tankArena.js';
import { tanksGame, tankTestOpts } from '../src/games/tankTrouble.js';
import { runSim, type SimCfg, type SimResult } from './tankSim.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};
const quick = process.argv.includes('quick');

/* ---------------- 1. mê cung ---------------- */
console.log('\n[1] Mê cung seed chung');
{
  let allConn = true;
  let det = true;
  let loops = 0;
  let cnt = 0;
  for (const n of [2, 3, 4, 5, 6]) {
    const [w, h] = mazeDims(n);
    for (let seed = 1; seed <= 200; seed++) {
      const a = new Maze();
      const b = new Maze();
      a.gen(seed, w, h, mulberry32(seed));
      b.gen(seed, w, h, mulberry32(seed));
      if (a.hw.join() !== b.hw.join() || a.vw.join() !== b.vw.join()) det = false;
      // liên thông
      const seen = new Uint8Array(w * h);
      const st = [0];
      seen[0] = 1;
      let open = 0;
      while (st.length) {
        const c = st.pop()!;
        const cx = c % w;
        const cy = (c / w) | 0;
        if (cx > 0 && !a.vw[cy * (w + 1) + cx] && !seen[c - 1]) { seen[c - 1] = 1; st.push(c - 1); }
        if (cx < w - 1 && !a.vw[cy * (w + 1) + cx + 1] && !seen[c + 1]) { seen[c + 1] = 1; st.push(c + 1); }
        if (cy > 0 && !a.hw[cy * w + cx] && !seen[c - w]) { seen[c - w] = 1; st.push(c - w); }
        if (cy < h - 1 && !a.hw[(cy + 1) * w + cx] && !seen[c + w]) { seen[c + w] = 1; st.push(c + w); }
      }
      if (seen.some((v) => !v)) allConn = false;
      let o = 0;
      for (const v of a.hw) if (!v) o++;
      for (const v of a.vw) if (!v) o++;
      loops += o - (w * h - 1);
      cnt++;
    }
  }
  ok(det, 'cùng seed → cùng mê cung (1000 mê cung)');
  ok(allConn, 'mọi ô đều liên thông');
  console.log(`  · trung bình ${(loops / cnt).toFixed(1)} lối thông phụ/mê cung`);
}

console.log('\n[2] Chia đấu trường');
for (const [n, want] of [[2, [2]], [3, [3]], [5, [5]], [6, [6]], [7, [4, 3]], [10, [5, 5]], [13, [5, 4, 4]], [16, [6, 5, 5]]] as [number, number[]][]) {
  const got = splitArenas(n);
  ok(got.join() === want.join() && got.reduce((a, b) => a + b, 0) === n && got.every((x) => x >= 2 && x <= 6), `${n} người → ${got.join('+')}`);
}

/* ---------------- 2. đạn nảy ---------------- */
console.log('\n[3] Đạn nảy gương (hộp 1x1 kín)');
{
  const w = new TankWorld();
  w.maze.w = 1;
  w.maze.h = 1;
  w.maze.hw = new Uint8Array([1, 1]);
  w.maze.vw = new Uint8Array([1, 1]);
  let escaped = 0;
  let speedBad = 0;
  let revBad = 0;
  const rng = mulberry32(7);
  const runs = quick ? 800 : 4000;
  for (let r = 0; r < runs; r++) {
    const ang = Math.floor(rng() * ANG_N);
    const x0 = 12 + rng() * 36;
    const y0 = 12 + rng() * 36;
    w.bAct.fill(0);
    w.bn = 0;
    const b = w.spawnBullet(0, 0, x0, y0, ang, 1);
    if (b < 0) continue;
    const sp = BSPEED[0];
    const x1 = w.bx[b];
    const y1 = w.by[b];
    let bounces = 0;
    const N = 400;
    for (let t = 0; t < N; t++) {
      const f = w.advanceBullet(b, 1);
      if (f & 1) bounces++;
      if (w.bx[b] < 3.4 || w.bx[b] > 56.6 || w.by[b] < 3.4 || w.by[b] > 56.6) escaped++;
      if (Math.abs(Math.hypot(w.bvx[b], w.bvy[b]) - sp) > 1e-9) speedBad++;
    }
    // đảo vận tốc rồi chạy lại N tick: phản xạ gương thuận nghịch → về chỗ cũ
    w.bvx[b] = -w.bvx[b];
    w.bvy[b] = -w.bvy[b];
    for (let t = 0; t < N; t++) w.advanceBullet(b, 1);
    if (Math.hypot(w.bx[b] - x1, w.by[b] - y1) > 1e-5) revBad++;
    void bounces;
  }
  ok(escaped === 0, `${runs} đạn × 400 tick: không viên nào xuyên tường`);
  ok(speedBad === 0, 'tốc độ không đổi sau mọi lần nảy');
  ok(revBad === 0, `thuận nghịch: đảo vận tốc → quay về đúng điểm cũ (${runs} lần, sai số < 1e-5)`);

  // góc vào = góc ra; đúng góc 45° vào góc tường → bật ngược
  w.bAct.fill(0);
  w.bn = 0;
  const b = w.spawnBullet(0, 0, 40, 40, 128, 2); // 45° hướng xuống-phải, sẽ đập góc dưới phải đúng đường chéo
  let backs = 0;
  for (let t = 0; t < 200; t++) {
    const px = w.bvx[b];
    const py = w.bvy[b];
    w.advanceBullet(b, 1);
    if (Math.abs(w.bvx[b] + px) < 1e-9 && Math.abs(w.bvy[b] + py) < 1e-9) backs++;
  }
  ok(backs >= 1, `đập đúng góc: phản xạ ngược cả hai trục (${backs} lần trong 200 tick)`);

  // tia laze: các đoạn gãy phản xạ đúng
  const out = new Float64Array(24);
  const np = traceRay(w.maze, 30, 30, 100, 700, 4, out);
  let cont = true;
  for (let i = 1; i < np; i++) if (out[i * 2] < -0.01 || out[i * 2] > 60.01 || out[i * 2 + 1] < -0.01 || out[i * 2 + 1] > 60.01) cont = false;
  ok(np >= 4 && cont, `tia laze phản xạ ${np - 1} đoạn trong hộp`);
}

/* ---------------- 3. xác định: server rewind ≡ client dự đoán ---------------- */
console.log('\n[4] TÍNH XÁC ĐỊNH (server tua lại ≡ client dự đoán)');
{
  const base: SimCfg = {
    n: 2, oneWayMs: 120, jitterMs: 40, stallRate: 0, stallMs: 0, dropSnap: 0, lagComp: true, viewDelay: 6,
    seconds: quick ? 30 : 60, seed: 11, hunters: 0, clockErrMs: 6, noPush: true, noKill: true, noItems: true, rapidFire: true,
  };
  const r = runSim(base);
  ok(r.exactTankMaxDiff === 0, `quỹ đạo xe: client dự đoán vs server (trễ 120±40ms, ${r.ownErrSamples} mẫu) sai lệch tối đa = ${r.exactTankMaxDiff} (phải = 0, bit-exact)`);
  ok(r.exactBulletMatch === true, `trạng thái toàn bộ đạn (nảy nhiều lần) server vs mọi client trùng khít bit (hash)`);
  console.log(`  · số lần client phải hoà giải: ${r.corrections}; số phát bắn: ${r.shots}`);
}

/* ---------------- 4. mạng ---------------- */
console.log('\n[5] MÔ PHỎNG MẠNG (4 xe: 2 thợ săn + 2 lang thang, 60s/ca, đồng hồ client lệch ±6ms)');
const fmt = (v: number, d = 2) => v.toFixed(d);
const rows: { label: string; r: SimResult }[] = [];
const mk = (rtt: number, jit: number, lc: boolean, vd: number, drop = 0, seconds = quick ? 40 : 90, stall = 0.02): SimCfg => ({
  n: 4, oneWayMs: rtt / 2, jitterMs: jit, stallRate: stall, stallMs: Math.max(100, rtt), dropSnap: drop, lagComp: lc, viewDelay: vd,
  seconds, seed: 100 + rtt, hunters: 2, clockErrMs: 6,
});
for (const rtt of [0, 80, 150, 250]) {
  const jit = Math.round(rtt * 0.12);
  const r = runSim(mk(rtt, jit, true, 6));
  rows.push({ label: `RTT ${rtt}ms ±${jit}`, r });
}
rows.push({ label: 'RTT 150 + mất 5% snapshot', r: runSim(mk(150, 18, true, 6, 0.05)) });
const noRewind = runSim(mk(150, 18, false, 0));
console.log('  cấu hình                       | xe MÌNH: tối đa/TB/p99 (đv) | dự đoán thô | xe KHÁC: tối đa/TB | tụt hiển thị | hoà giải | snap/s ↓B/s ↑msg/s ↑B/s | CPU srv ms/s');
for (const { label, r } of rows) {
  console.log(
    `  ${label.padEnd(30)} | ${fmt(r.ownErrMax)} / ${fmt(r.ownErrMean)} / ${fmt(r.ownErrP99)}`.padEnd(62) +
      `| ${fmt(r.predErrMax)}`.padEnd(14) +
      `| ${fmt(r.otherErrMax)} / ${fmt(r.otherErrMean)}`.padEnd(22) +
      `| ${fmt(r.otherLagMs, 0)}ms`.padEnd(15) +
      `| ${r.corrections}`.padEnd(11) +
      `| ${fmt(r.snapsPerSec, 1)} ${fmt(r.downBytesPerSecPerClient, 0)} ${fmt(r.upMsgsPerSecPerClient, 1)} ${fmt(r.upBytesPerSecPerClient, 0)}`.padEnd(32) +
      `| ${fmt(r.serverMsPerSec, 2)}`,
  );
}
console.log('  (1 ô = 60 đv; xe rộng 22 đv; đv = đơn vị thế giới. "xe MÌNH" = sai khác giữa vị trí HIỂN THỊ và vị trí server cuối cùng, bỏ mẫu khi hai xe chạm nhau)');
console.log(`  [đối chứng] RTT 150 KHÔNG tua lại/bù trễ trên server: xe mình lệch tối đa ${fmt(noRewind.ownErrMax)} / TB ${fmt(noRewind.ownErrMean)} / p99 ${fmt(noRewind.ownErrP99)} đv; hoà giải ${noRewind.corrections} lần`);
for (const { label, r } of rows) {
  ok(r.ownErrP99 < 8 && r.ownErrMean < 1.5, `${label}: xe mình lệch tối đa ${fmt(r.ownErrMax)} / p99 ${fmt(r.ownErrP99)} / TB ${fmt(r.ownErrMean)} đv`);
}

console.log('\n[6] BÙ TRỄ (lag compensation): đạn "nhìn thấy trúng" nhưng server chốt trượt (2 thợ săn ngắm đón đầu + 2 mục tiêu đi thẳng, xe không chết để lấy mẫu dài, gộp nhiều ván)');
const lcRows: { label: string; r: SimResult }[] = [];
const seeds = quick ? 2 : 5;
const merge = (label: string, rs: SimResult[]) => {
  const r = { ...rs[0] } as SimResult;
  for (const k of ['shots', 'visHits', 'visHitsServerMiss', 'serverHitsNotVisible', 'kills', 'corrections'] as const) r[k] = rs.reduce((s, x) => s + x[k], 0);
  r.ownErrMax = Math.max(...rs.map((x) => x.ownErrMax));
  r.ownErrMean = rs.reduce((s, x) => s + x.ownErrMean, 0) / rs.length;
  return { label, r };
};
for (const rtt of [80, 150, 250]) {
  const jit = Math.round(rtt * 0.12);
  for (const [label, lc, vd] of [['TẮT', false, 0], ['BẬT (thường)', true, 0], ['BẬT + theo màn hình người bắn', true, 6]] as [string, boolean, number][]) {
    const rs: SimResult[] = [];
    for (let s = 0; s < seeds; s++) rs.push(runSim({ ...mk(rtt, jit, lc, vd, 0, 100), hunters: 2, immortal: true, noItems: true, seed: 700 + rtt + s * 13 }));
    lcRows.push(merge(`RTT ${rtt}ms · LC ${label}`, rs));
  }
}
for (const { label, r } of lcRows) {
  const pct = r.visHits ? (100 * r.visHitsServerMiss) / r.visHits : 0;
  const hitBoth = r.visHits - r.visHitsServerMiss;
  const pct2 = r.serverHitsNotVisible + hitBoth ? (100 * r.serverHitsNotVisible) / (r.serverHitsNotVisible + hitBoth) : 0;
  console.log(`  ${label.padEnd(46)} bắn ${String(r.shots).padStart(4)} · thấy trúng ${String(r.visHits).padStart(3)} → server bảo TRƯỢT ${String(r.visHitsServerMiss).padStart(3)} (${fmt(pct, 1)}%) · server hạ mà người bắn không thấy trúng ${String(r.serverHitsNotVisible).padStart(3)} (${fmt(pct2, 1)}% số phát server hạ) `);
}
{
  const agg = (lc: boolean, vd: number) => {
    const sel = lcRows.filter((x) => x.r.cfg.lagComp === lc && x.r.cfg.viewDelay === vd);
    const v = sel.reduce((s, x) => s + x.r.visHits, 0);
    const m = sel.reduce((s, x) => s + x.r.visHitsServerMiss, 0);
    return { v, m, p: v ? (100 * m) / v : 0 };
  };
  const off = agg(false, 0);
  const on0 = agg(true, 0);
  const on6 = agg(true, 6);
  console.log(`  TỔNG "thấy trúng mà server trượt": LC tắt ${off.m}/${off.v} (${fmt(off.p, 1)}%) · LC bật ${on0.m}/${on0.v} (${fmt(on0.p, 1)}%) · LC bật + màn hình người bắn ${on6.m}/${on6.v} (${fmt(on6.p, 1)}%)`);
  ok(on6.p <= off.p, 'bù trễ làm giảm tỉ lệ "thấy trúng mà server bảo trượt"');
}

/* ---------------- 5. độ trễ cảm nhận của chính mình ---------------- */
console.log('\n[7] ĐỘ TRỄ CẢM NHẬN của xe mình (input → khung hình kế tiếp)');
{
  const cl = new TankClient(0, 0, ['a', 'b'], 0, 9, 7);
  cl.onMessage({ type: 'R', a: 0, r: 0, seed: 5, w: 9, h: 7, t0: 0, fs: 10, ph: 0, sd: 0, sc: [0, 0], kl: [0, 0], wn: [0, 0], it: [] }, 0);
  let worst = 0;
  let allOk = true;
  const rng = mulberry32(3);
  for (let trial = 0; trial < 300; trial++) {
    // chạy tới giữa vòng, pha ngẫu nhiên trong tick
    let now = 1000 + trial * 400 + rng() * 16;
    cl.setKeys(0, 0, false, now);
    cl.frame(now);
    now += 16.667;
    cl.frame(now);
    const a0 = cl.world.ang[0];
    const x0 = cl.world.x[0];
    const y0 = cl.world.y[0];
    const kind = trial % 3;
    const t = now + rng() * 16; // phím bấm giữa hai khung hình
    const bullets0 = cl.world.bn;
    cl.setKeys(kind === 0 ? 1 : 0, kind === 1 ? 1 : 0, kind === 2, t);
    cl.frame(t + (16.667 - (t - now)) + 0.01); // khung hình kế tiếp (60Hz)
    const changed = kind === 0 ? cl.world.ang[0] !== a0 : kind === 1 ? cl.world.x[0] !== x0 || cl.world.y[0] !== y0 : cl.world.bn > bullets0;
    if (!changed) allOk = false;
    worst = Math.max(worst, 1);
    cl.setKeys(0, 0, false, t + 40);
    cl.frame(t + 60);
    cl.world.bAct.fill(0);
    cl.world.bn = 0;
    void worst;
  }
  ok(allOk, '300/300 lần: xoay / tiến / bắn đều đổi trạng thái ở khung hình KẾ TIẾP (độ trễ mạng = 0, ≤ 1 tick = 16.7ms do bước vật lý)');
}

/* ---------------- 6. RAM / CPU server, 16 người ---------------- */
console.log('\n[8] RAM / CPU server: ván 16 người (3 đấu trường), bot lái ngẫu nhiên, 90s mô phỏng');
{
  Object.assign(tankTestOpts, { ...DEFAULT_OPTS });
  const ids = Array.from({ length: 16 }, (_, i) => `b${i}`);
  global.gc?.();
  const before = process.memoryUsage();
  const cpu0 = process.cpuUsage();
  let now = 5_000_000;
  const startAt = now;
  let sentMsgs = 0;
  let sentBytes = 0;
  const ctx: any = {
    playerIds: ids, startAt, endAt: startAt + 1e9, now: () => now, broadcast() {},
    send: (_id: string, p: any) => { sentMsgs++; sentBytes += JSON.stringify(p).length; },
  };
  const def = tanksGame;
  const config = def.createConfig(ctx);
  const state = def.createState(ctx, config);
  def.onStart!(ctx, state, config);
  const rng = mulberry32(99);
  const held = ids.map(() => ({ turn: 0, move: 0, f: 0, q: 0 }));
  const secs = quick ? 40 : 90;
  let peakRss = before.rss;
  let peakHeap = before.heapUsed;
  for (let ms = 0; ms < secs * 1000; ms += 5) {
    now = startAt + ms;
    if (ms % 50 === 0) {
      for (let i = 0; i < 16; i++) {
        if (rng() < 0.25) {
          const h = held[i];
          h.turn = Math.floor(rng() * 3) - 1;
          h.move = rng() < 0.75 ? 1 : -1;
          if (rng() < 0.4) h.f++;
          h.q++;
          def.handleInput(ctx, state, config, ids[i], { type: 'tank', t: Math.floor((now - 80 - startAt) / (1000 / TICK_HZ)), q: h.q, turn: h.turn, move: h.move, f: h.f });
        }
      }
      def.update(ctx, state, config);
    }
    if (ms % 5000 === 0) {
      const m = process.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peakHeap = Math.max(peakHeap, m.heapUsed);
    }
  }
  const mid = process.memoryUsage();
  const cpu = process.cpuUsage(cpu0);
  const res = def.calculateScore(ctx, state, config);
  void res;
  global.gc?.();
  const after = process.memoryUsage();
  const mb = (v: number) => (v / 1048576).toFixed(1);
  console.log(`  · RSS trước ${mb(before.rss)}MB → giữa ván ${mb(mid.rss)}MB (đỉnh ${mb(peakRss)}MB) → sau ván+dọn ${mb(after.rss)}MB; heap ${mb(before.heapUsed)} → ${mb(mid.heapUsed)} → ${mb(after.heapUsed)}MB`);
  console.log(`  · RSS tăng giữa ván: +${mb(peakRss - before.rss)}MB (mục tiêu < 30MB) ; heap tăng +${mb(peakHeap - before.heapUsed)}MB (có thể do rác chưa GC)`);
  console.log(`  · CPU: ${((cpu.user + cpu.system) / 1000).toFixed(0)}ms cho ${secs}s mô phỏng 16 người = ${(((cpu.user + cpu.system) / 1000 / (secs * 1000)) * 100).toFixed(2)}% của 1 lõi`);
  console.log(`  · mạng ra: ${(sentMsgs / secs).toFixed(0)} gói/s toàn phòng, ${(sentBytes / secs / 1024).toFixed(1)} KB/s toàn phòng (${(sentBytes / secs / 16 / 1024).toFixed(2)} KB/s/người)`);
  ok(peakRss - before.rss < 30 * 1048576, 'RSS tăng < 30MB');
  ok(state.arenas.length === 0, 'dữ liệu ván được giải phóng sau calculateScore');
}

/* ---------------- 7. vật phẩm / vũ khí ---------------- */
console.log('\n[9] VẬT PHẨM & VŨ KHÍ (đấu trường 2 xe, mê cung trống)');
{
  const mkArena = () => {
    const ev: any[] = [];
    const a = new Arena(0, ['a', 'b'], (p) => ev.push(p), { ...DEFAULT_OPTS, noItems: false });
    a.startRound();
    a.nextItemAt = 1e9; // không tự sinh hộp, chỉ hộp do test đặt
    const w = a.w;
    // mê cung trống: chỉ còn tường biên
    for (let j = 0; j <= w.maze.h; j++) for (let i = 0; i < w.maze.w; i++) w.maze.hw[j * w.maze.w + i] = j === 0 || j === w.maze.h ? 1 : 0;
    for (let j = 0; j < w.maze.h; j++) for (let i = 0; i <= w.maze.w; i++) w.maze.vw[j * (w.maze.w + 1) + i] = i === 0 || i === w.maze.w ? 1 : 0;
    const place = (i: number, x: number, y: number, ang: number) => {
      w.x[i] = x; w.y[i] = y; w.ang[i] = ang;
      for (let k = 0; k < RING; k++) w.recordAt(i, k);
    };
    place(0, 100, 270, 0);
    place(1, 400, 270, 0);
    a.advance(w.tick + 190);
    return { a, w, ev, place };
  };
  let q = 0;
  let f = 0;
  const shoot = (a: Arena) => a.applyInput(0, a.w.tick, ++q, 0, 0, ++f);

  { // nhặt hộp
    const { a, w, ev, place } = mkArena();
    a.iKind[0] = 3; a.iCell[0] = 0; a.iId[0] = 99;
    place(0, 30, 30, 0);
    a.advance(w.tick + 2);
    ok(ev.some((e) => e.type === 'p' && e.kd === 3 && e.v === 0) && a.wKind[0] === 3, 'nhặt hộp: sự kiện p + tia laze vào tay xe');
  }
  { // laze giết xe đối diện, 1 phát rồi hết
    const { a, w, ev } = mkArena();
    a.wKind[0] = 3; a.wLeft[0] = 1;
    shoot(a);
    ok(ev.some((e) => e.type === 'l') && ev.some((e) => e.type === 'x' && e.v === 1 && e.kd === 4) && a.wKind[0] === 0, 'laze: tia thẳng hạ xe đích ngay, dùng 1 lần');
    void w;
  }
  { // đạn chùm
    const { a, w, ev } = mkArena();
    a.wKind[0] = 2; a.wLeft[0] = 4;
    shoot(a);
    let own = 0;
    for (let b = 0; b < w.bAct.length; b++) if (w.bAct[b] && w.bown[b] === 0) own++;
    ok(ev.some((e) => e.type === 'f' && e.kd === 2) && own === 3, 'đạn chùm: 1 phát → 3 viên xoè (±12°)');
  }
  { // liên thanh: 3 phát trong 15 tick (thường chỉ 1 phát/15 tick)
    const { a, w, ev } = mkArena();
    a.wKind[0] = 1; a.wLeft[0] = 360;
    for (let i = 0; i < 3; i++) {
      shoot(a);
      a.advance(w.tick + 5);
    }
    ok(ev.filter((e) => e.type === 'f').length === 3, 'liên thanh: cooldown 5 tick (3 phát/15 tick, thường chỉ 1)');
  }
  { // tên lửa tự dẫn: đích lệch trục 90 đơn vị, vẫn trúng
    const { a, w, ev, place } = mkArena();
    place(1, 400, 360, 0);
    a.wKind[0] = 4; a.wLeft[0] = 2;
    shoot(a);
    for (let i = 0; i < 160; i++) a.advance(w.tick + 1);
    ok(ev.some((e) => e.type === 'x' && e.v === 1 && e.kd === 3), 'tên lửa: bẻ lái bám xe đích lệch 90 đv và hạ nó');
  }
  { // khiên
    const { a, w, ev } = mkArena();
    a.shield[1] = w.tick + 900;
    shoot(a);
    a.advance(w.tick + 120);
    const popped = ev.some((e) => e.type === 'z' && e.v === 1) && w.alive[1] === 1;
    a.nextFire[0] = 0;
    shoot(a);
    a.advance(w.tick + 120);
    ok(popped && w.alive[1] === 0, 'khiên: chịu đúng 1 đòn rồi hết, phát sau hạ xe');
  }
}

console.log(fails ? `\n${fails} KIỂM TRA HỎNG` : '\nTẤT CẢ ĐẠT');
process.exit(fails ? 1 : 0);
