// chạy: cd server && npx tsx --expose-gc test/fart.test.ts
import assert from 'node:assert/strict';
import * as R from '../../shared/raft.js';
import { FartCore } from '../../shared/raftClient.js';
import { fartGame } from '../src/games/fart.js';
import { botAim } from './fartBot.js';
import { botDriver, makeHarness, type NetProfile } from './fartHarness.js';

let ok = 0;
const t = (name: string, f: () => void) => {
  f();
  ok++;
  console.log('ok -', name);
};

/* ---------- (i) tính xác định ---------- */
type Ev = { t: number; seat: number; a: number; p: number; n: number };
function makeEvents(c: R.Course, seats: number, ticks: number, seed: number): Ev[] {
  // sinh sự kiện bằng bot chạy một lần để chúng có ý nghĩa (va chạm thật), rồi dùng lại cho mọi biến thể
  const rng = R.mulberry32(seed);
  const sim = new R.RaftSim(c, R.SEAT_ORDER[seats], 16, 4000);
  const evs: Ev[] = [];
  const last = new Array(seats).fill(-99);
  const gas = new Array(seats).fill(1);
  let n = 0;
  for (let k = 0; k < ticks; k++) {
    for (let s = 0; s < seats; s++) {
      if (k - last[s] < 16 + Math.floor(rng() * 20)) continue;
      const g = R.gasRegen(gas[s], k - last[s]);
      const pi = Math.min(Math.round((0.3 + rng() * 0.6) * 100), R.gasLimitP(g));
      if (pi < R.P_MIN) continue;
      sim.advanceTo(k);
      const a = rng() < 0.7 ? botAim(c, sim.S, k) : (rng() - 0.5) * 6.28;
      const ai = Math.round(R.wrapPi(a) * 1000);
      gas[s] = g - R.gasCost(pi);
      last[s] = k;
      evs.push({ t: k, seat: s, a: ai, p: pi, n: ++n });
      sim.setEvent(k, s, ai, pi, n);
    }
  }
  return evs;
}

const course = R.genCourse(12345);
const TICKS = 60 * 100;

t('khóa học: cùng seed cùng kết quả, khác seed khác', () => {
  const a = R.genCourse(99);
  const b = R.genCourse(99);
  assert.deepEqual(Array.from(a.px), Array.from(b.px));
  assert.deepEqual(Array.from(a.ob.subarray(0, a.nOb * R.OB_STRIDE)), Array.from(b.ob.subarray(0, b.nOb * R.OB_STRIDE)));
  assert.notDeepEqual(Array.from(a.py), Array.from(R.genCourse(100).py));
  console.log(`   khóa học: ${a.n} điểm, dài ${a.len.toFixed(0)}m, ${a.nOb} chướng ngại, ${a.nWh} xoáy, đích ở ${a.finishS.toFixed(0)}m`);
});

const evs = makeEvents(course, 3, TICKS, 5);
function runReference(): { h: number; S: Float64Array } {
  const sim = new R.RaftSim(course, R.SEAT_ORDER[3], 16, 4000);
  for (const e of evs) sim.setEvent(e.t, e.seat, e.a, e.p, e.n);
  sim.advanceTo(TICKS);
  return { h: R.stateHash(sim.S), S: Float64Array.from(sim.S) };
}
const ref = runReference();

t('xác định: chạy lại cùng chuỗi input -> trùng khít', () => {
  assert.equal(runReference().h, ref.h);
  console.log(`   ${evs.length} cú xì / ${TICKS} tick, va chạm ${ref.S[R.S_HITS]}, hash ${ref.h}`);
});

function lateRun(maxLate: number, ring: number, seed: number): { h: number; S: Float64Array; rollbacks: number } {
  const rng = R.mulberry32(seed);
  const sim = new R.RaftSim(course, R.SEAT_ORDER[3], ring, 64);
  // mỗi sự kiện "đến" muộn 0..maxLate tick so với tick của nó
  const arrive = evs.map((e) => ({ e, at: e.t + Math.floor(rng() * (maxLate + 1)) })).sort((x, y) => x.at - y.at);
  let i = 0;
  let rollbacks = 0;
  for (let k = 0; k <= TICKS; k++) {
    sim.advanceTo(k);
    while (i < arrive.length && arrive[i].at <= k) {
      const e = arrive[i++].e;
      if (e.t < sim.cur) rollbacks++;
      sim.setEvent(e.t, e.seat, e.a, e.p, e.n);
      sim.prune(k - ring - 2);
    }
  }
  // sự kiện đến sau tick cuối vẫn phải được áp (rollback)
  while (i < arrive.length) {
    const e = arrive[i++].e;
    rollbacks++;
    sim.setEvent(e.t, e.seat, e.a, e.p, e.n);
  }
  sim.advanceTo(TICKS);
  return { h: R.stateHash(sim.S), S: Float64Array.from(sim.S), rollbacks };
}

t('rollback server (≤14 tick muộn, vòng đệm 16) cho kết quả y hệt chạy một mạch', () => {
  const r = lateRun(14, 16, 1);
  assert.equal(r.h, ref.h);
  assert.ok(r.rollbacks > 50);
  console.log(`   ${r.rollbacks} lần rollback, hash trùng ${r.h}`);
});
t('rollback client (≤40 tick muộn, vòng đệm 64) cũng trùng khít', () => {
  const r = lateRun(40, 64, 2);
  assert.equal(r.h, ref.h);
  console.log(`   ${r.rollbacks} lần rollback, hash trùng`);
});
t('sai số tuyệt đối giữa các biến thể < 1e-9 (từng phần tử trạng thái)', () => {
  const r = lateRun(25, 64, 3);
  for (let j = 0; j < R.NS; j++) assert.ok(Math.abs(r.S[j] - ref.S[j]) < 1e-9, `phần tử ${j}`);
});
t('setBase: mốc server làm tròn 1e-4 -> client hội tụ về server (lệch < 0.01)', () => {
  const server = new R.RaftSim(course, R.SEAT_ORDER[3], 16, 64);
  const client = new R.RaftSim(course, R.SEAT_ORDER[3], 64, 96);
  let n = 0;
  const tmp = new Float64Array(R.NS);
  let worst = 0;
  const byTick = new Map<number, Ev[]>();
  for (const e of evs) byTick.set(e.t, [...(byTick.get(e.t) ?? []), e]);
  for (let k = 0; k <= TICKS; k++) {
    server.advanceTo(k);
    client.advanceTo(k);
    for (const e of byTick.get(k) ?? []) {
      server.setEvent(e.t, e.seat, e.a, e.p, e.n);
      client.setEvent(e.t, e.seat, e.a, e.p, e.n);
      n++;
    }
    server.prune(k - 20);
    if (k % 6 === 0 && k > 20 && server.stateAt(k - 14, tmp)) {
      const rounded = Array.from(tmp, (v) => Math.round(v * 1e4) / 1e4);
      client.setBase(k - 14, rounded);
    }
    if (k > 100) worst = Math.max(worst, Math.hypot(server.S[R.S_X] - client.S[R.S_X], server.S[R.S_Y] - client.S[R.S_Y]));
  }
  assert.ok(worst < 0.01, `lệch ${worst}`);
  console.log(`   ${n} sự kiện, lệch vị trí tối đa client-server ${worst.toExponential(2)}`);
});

t('chia bè: không có bè 1 người, 2-4 người/bè', () => {
  for (let n = 2; n <= 16; n++) {
    const s = R.teamSizes(n);
    assert.equal(s.reduce((a, b) => a + b, 0), n);
    assert.ok(s.every((x) => x >= 2 && x <= 4), `n=${n} -> ${s}`);
  }
  assert.deepEqual(R.teamSizes(5), [3, 2]);
  assert.deepEqual(R.teamSizes(6), [3, 3]);
  assert.deepEqual(R.teamSizes(7), [4, 3]);
  assert.deepEqual(R.teamSizes(16), [4, 4, 4, 4]);
});

/* ---------- (iii) độ trễ cảm nhận = 0 ---------- */
t('độ trễ cảm nhận: xì -> khung hình kế tiếp bè đã đổi vận tốc (không chờ mạng)', () => {
  const sent: any[] = [];
  const core = new FartCore({ seed: 12345, teams: [['a', 'b', 'c']], cap: 1 }, 'a', 1000, (i) => sent.push(i));
  let mono = 1000 + 500;
  for (let i = 0; i < 40; i++, mono += 1000 / 60) core.frame(mono, mono);
  const v0x = core.sim.S[R.S_VX];
  const x0 = core.px;
  const pi = core.fire(0.8, 0.0);
  assert.equal(pi, 80);
  core.frame(mono + 1000 / 60, mono + 1000 / 60);
  const dvx = core.sim.S[R.S_VX] - v0x;
  const expected = -R.DV_MAX * 0.8;
  assert.ok(Math.abs(dvx - expected) < 0.12, `dvx ${dvx} vs ${expected}`);
  console.log(`   xì ở khung N -> khung N+1: Δv = ${dvx.toFixed(3)} (xung lực ${expected.toFixed(3)} + kéo nước), gói gửi: ${JSON.stringify(sent.find((s) => s.type === 'fart'))}`);
  console.log(`   => độ trễ cảm nhận của chính mình = 0ms chờ mạng (áp cục bộ trước khi server biết); Δx hiển thị khung kế = ${(core.px - x0).toFixed(4)}m`);
});

/* ---------- (ii) mạng có trễ ---------- */
interface Stats {
  max: number;
  mean: number;
  p99: number;
  jumpMax: number;
  jumpP99: number;
  n: number;
  bad: number;
  teleports: number;
}

function truthTable(h: ReturnType<typeof makeHarness>, ti: number, maxTick: number) {
  const n = h.config.teams[ti].length;
  const sim = new R.RaftSim(h.state.course, R.SEAT_ORDER[Math.min(4, n)], 16, 4000);
  for (const e of h.fartLog) if (e.ti === ti) sim.setEvent(e.t, e.s, e.a, e.p, e.n);
  const X = new Float64Array(maxTick + 2);
  const Y = new Float64Array(maxTick + 2);
  for (let k = 0; k <= maxTick + 1; k++) {
    sim.advanceTo(k);
    X[k] = sim.S[R.S_X];
    Y[k] = sim.S[R.S_Y];
  }
  return { X, Y };
}

let respawns = 0;
function measure(h: ReturnType<typeof makeHarness>): Stats {
  respawns = 0;
  const errs: number[] = [];
  const jumps: number[] = [];
  const tabs = h.config.teams.map((ids: string[], ti: number) => truthTable(h, ti, h.samples[ids[0]][h.samples[ids[0]].length - 1].tick + 5));
  for (let ti = 0; ti < h.config.teams.length; ti++) {
    for (const id of h.config.teams[ti] as string[]) {
      const T = tabs[ti];
      let prev: { x: number; y: number; tx: number; ty: number } | null = null;
      // thời điểm hồi sinh (dịch chuyển tức thời) của bè này: bỏ ±4 tick quanh đó vì lệch 1-2 tick là bình thường
      const hops = new Set<number>();
      for (let q = 1; q < T.X.length - 1; q++) if (Math.hypot(T.X[q + 1] - T.X[q], T.Y[q + 1] - T.Y[q]) > 4) for (let d = -4; d <= 4; d++) hops.add(q + d);
      if (id === (h.config.teams[ti] as string[])[0]) respawns += Math.round(hops.size / 9);
      for (const s of h.samples[id]) {
        if (s.tick < 60 || hops.has(s.tick)) {
          prev = null;
          continue;
        }
        // cùng quy tắc với client: không nội suy xuyên qua cú dịch chuyển hồi sinh
        const fr = Math.hypot(T.X[s.tick + 1] - T.X[s.tick], T.Y[s.tick + 1] - T.Y[s.tick]) > 4 ? 1 : s.frac;
        const tx = T.X[s.tick] + (T.X[s.tick + 1] - T.X[s.tick]) * fr;
        const ty = T.Y[s.tick] + (T.Y[s.tick + 1] - T.Y[s.tick]) * fr;
        errs.push(Math.hypot(s.x - tx, s.y - ty));
        // bước nhảy hiển thị = chuyển động hiển thị trừ chuyển động thật của cùng khoảng thời gian
        if (prev) jumps.push(Math.hypot(s.x - prev.x - (tx - prev.tx), s.y - prev.y - (ty - prev.ty)));
        prev = { x: s.x, y: s.y, tx, ty };
      }
    }
  }
  errs.sort((a, b) => a - b);
  jumps.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return {
    max: errs[errs.length - 1],
    mean: errs.reduce((a, b) => a + b, 0) / errs.length,
    p99: q(errs, 0.99),
    jumpMax: jumps[jumps.length - 1],
    jumpP99: q(jumps, 0.99),
    n: errs.length,
    bad: errs.filter((e) => e > 1).length,
    teleports: jumps.filter((e) => e > 2).length,
  };
}

const profiles: NetProfile[] = [
  { name: '0ms', rtt: 0, jitter: 0, loss: 0 },
  { name: '80ms', rtt: 80, jitter: 12, loss: 0.01 },
  { name: '150ms', rtt: 150, jitter: 25, loss: 0.01 },
  { name: '250ms', rtt: 250, jitter: 40, loss: 0.02 },
];

console.log('\n== SAI SỐ HIỂN THỊ so với trạng thái server THẬT (đơn vị mét; bè dài ~3.4m), 7 người / 2 bè, 100s ==');
console.log('mạng      | lệch TB | lệch p99 | lệch tối đa | nhảy/khung tối đa | nhảy p99 | số mẫu | khung lệch>1m | dịch chuyển>2m');
for (const prof of profiles) {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const h = makeHarness(ids, prof, { seed: 11 });
  const drive = botDriver(3);
  h.run(100, (id, core) => drive(id, core));
  const st = measure(h);
  // server vs tham chiếu: trạng thái server cuối ván trùng với chạy lại từ nhật ký sự kiện đã chốt
  for (let ti = 0; ti < h.state.teams.length; ti++) {
    const team = h.state.teams[ti];
    const tab = truthTable(h, ti, team.sim.cur);
    const dx = Math.hypot(team.sim.S[R.S_X] - tab.X[team.sim.cur], team.sim.S[R.S_Y] - tab.Y[team.sim.cur]);
    assert.ok(dx < 1e-6, `server lệch tham chiếu ${dx}`);
  }
  console.log(
    `${prof.name.padEnd(9)} | ${st.mean.toFixed(3).padStart(7)} | ${st.p99.toFixed(3).padStart(8)} | ${st.max.toFixed(3).padStart(11)} | ${st.jumpMax.toFixed(3).padStart(17)} | ${st.jumpP99.toFixed(3).padStart(8)} | ${st.n} | ${st.bad} | ${st.teleports} (hồi sinh bỏ qua: ${respawns})`,
  );
  assert.ok(st.jumpP99 < 0.2, `nhảy p99 quá lớn ở ${prof.name}: ${st.jumpP99}`);
}

/* ---------- tài nguyên server: ván 16 người ---------- */
console.log('\n== TÀI NGUYÊN SERVER: ván 16 người, 4 bè, 150s (bot phía server, không dựng client) ==');
{
  const gc = (globalThis as any).gc as (() => void) | undefined;
  gc?.();
  const mem0 = process.memoryUsage();
  const ids = Array.from({ length: 16 }, (_, i) => 'q' + i);
  const h = makeHarness(ids, { name: 'srv', rtt: 80, jitter: 10, loss: 0 }, { clients: false });
  const nextAt: Record<string, number> = {};
  const nSent: Record<string, number> = {};
  let peakRss = 0;
  const cpu0 = process.cpuUsage();
  const secs = 150;
  const wall0 = performance.now();
  let inputs = 0;
  for (let s = 0; s < secs * 20; s++) {
    const nowMs = h.startAt + s * 50;
    h.ctx.now = () => nowMs;
    const tick = Math.floor((nowMs - h.startAt) / R.STEP_MS);
    for (const id of ids) {
      const me = h.state.of[id];
      if (!me) continue;
      const team = h.state.teams[me.ti];
      if ((nextAt[id] ?? 0) > tick) continue;
      nextAt[id] = tick + 22 + ((s + me.seat * 7) % 11);
      nSent[id] = (nSent[id] ?? 0) + 1;
      const a = botAim(h.state.course, team.sim.S, tick);
      fartGame.handleInput(h.ctx, h.state, h.config, id, { type: 'fart', t: tick - 5, a: Math.round(R.wrapPi(a) * 1000), p: 55, n: nSent[id] });
      inputs++;
      if (s % 3 === 0) {
        fartGame.handleInput(h.ctx, h.state, h.config, id, { type: 'faim', a: 1000, c: 30 });
        inputs++;
      }
    }
    fartGame.update(h.ctx, h.state, h.config);
    if (s % 40 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const wall = performance.now() - wall0;
  const cpu = process.cpuUsage(cpu0);
  const mid = process.memoryUsage();
  gc?.();
  const mem1 = process.memoryUsage();
  const mb = (b: number) => (b / 1048576).toFixed(1);
  const bytesDown = Object.values(h.bytesDown).reduce((a, b) => a + b, 0);
  const msgsDown = Object.values(h.msgsDown).reduce((a, b) => a + b, 0);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  console.log(`RSS trước ${mb(mem0.rss)}MB -> cuối ván ${mb(mid.rss)}MB (đỉnh ${mb(peakRss)}MB) -> sau gc ${mb(mem1.rss)}MB; heap ${mb(mem0.heapUsed)} -> ${mb(mem1.heapUsed)}MB`);
  console.log(`CPU: ${cpuMs.toFixed(0)}ms cho ${secs}s ván (${secs * 20} update + ${inputs} input) = ${((cpuMs / (secs * 1000)) * 100).toFixed(2)}% của 1 lõi (wall ${wall.toFixed(0)}ms, gồm JSON)`);
  console.log(`gói xuống: ${msgsDown} gói, ${(bytesDown / 1024).toFixed(0)}KB / ${secs}s = ${(msgsDown / secs / 16).toFixed(1)} gói/s/người, ${(bytesDown / secs / 16 / 1024).toFixed(2)}KB/s/người`);
  console.log('chi tiết (loại: gói/byte tổng):', Object.entries(h.bytesDown).map(([k, v]) => `${k}:${h.msgsDown[k]}/${v}`).join('  '));
  const res = fartGame.calculateScore(h.ctx, h.state, h.config);
  console.log('điểm mẫu:', JSON.stringify(res.q0), '·', Object.keys(res).length, 'người');
  assert.equal(h.state.teams.length, 0, 'dữ liệu bè phải được xoá sau ván');
  assert.ok(mem1.rss - mem0.rss < 30 * 1048576, 'RSS tăng quá 30MB');
}

console.log(`\n${ok} nhóm kiểm tra đạt.`);
