// chạy: cd server && npx tsx test/disaster.test.ts
// Kiểm tra: thế giới xác định theo seed, tua lại input trễ cho ra đúng trạng thái như khi input tới đúng giờ,
// client-dự-đoán ≡ server qua mạng giả lập có trễ/jitter, chia arena, điểm công bằng, và cân bằng (bot đứng yên vs bot né).
import assert from 'node:assert/strict';
import {
  F_DEAD,
  F_DTICK,
  F_X,
  F_Y,
  F_Z,
  INTRO,
  K_COLLAPSE,
  K_FLOOD,
  K_METEOR,
  K_QUAKE,
  K_TORNADO,
  NF,
  PSim,
  STEP_MS,
  World,
  stepPlayer,
  GRID,
  HALF,
} from '../../shared/disaster.js';
import { DisasterClient } from '../../shared/disasterClient.js';
import { arenaSizes, disasterGame as g } from '../src/games/disaster.js';

const spawn = new Float64Array(2);
const mkSim = (w: World, seat = 0, n = 4) => {
  w.spawn(seat, n, spawn);
  const s = new PSim();
  s.reset(w.base, spawn[0], spawn[1], w.groundZ(0, spawn[0], spawn[1]));
  return s;
};

/* 1) thế giới: cùng seed → cùng thế giới; mỗi vòng có đủ thứ cần có */
{
  for (let seed = 1; seed <= 300; seed++) {
    for (let r = 0; r < 3; r++) {
      const a = new World(seed * 7919, r, 0);
      const b = new World(seed * 7919, r, 0);
      assert.deepEqual(a.heights, b.heights);
      assert.deepEqual(a.fallTick, b.fallTick);
      assert.equal(a.endTick, b.endTick);
      assert.equal(a.nPhases, r === 0 ? 3 : 4);
      assert.ok(a.heights.some((h) => h === 3), 'luôn có đất cao nhất để trú lũ');
      const kinds = new Set<number>();
      for (let i = 0; i < a.nPhases; i++) kinds.add(a.pKind[i]);
      assert.equal(kinds.size, a.nPhases, 'mỗi thảm họa chỉ một lần trong vòng');
      for (let i = 1; i < a.nMet; i++) assert.ok(a.mTick[i] >= a.mTick[i - 1], 'thiên thạch xếp theo thời gian');
      for (let s = 0; s < 8; s++) {
        a.spawn(s, 8, spawn);
        assert.ok(a.groundZ(0, spawn[0], spawn[1]) >= 0, 'điểm xuất phát nằm trên sàn');
        assert.ok(a.groundZ(INTRO - 1, spawn[0], spawn[1]) >= 0, 'sàn không sập trong lúc giới thiệu');
      }
    }
  }
  console.log('world: 900 vòng OK');
}

/* 2) tua lại: input tới trễ (qua rewind) ≡ input tới đúng giờ */
{
  let seedN = 12345;
  const rnd = () => ((seedN = (Math.imul(seedN, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let trial = 0; trial < 200; trial++) {
    const w = new World(trial * 31 + 5, trial % 3, 0);
    const ref = mkSim(w);
    const late = mkSim(w);
    // kịch bản input: (tick, dx, dy, jump)
    const evs: [number, number, number, number][] = [];
    let t = 1;
    while (t < 1500) {
      evs.push([t, Math.floor(rnd() * 3) - 1, Math.floor(rnd() * 3) - 1, rnd() < 0.2 ? 1 : 0]);
      t += 5 + Math.floor(rnd() * 60);
    }
    // ref: biết trước mọi input → đưa vào đúng tick
    let ei = 0;
    for (let tick = 0; tick < 1600; tick++) {
      while (ei < evs.length && evs[ei][0] <= tick) {
        const e = evs[ei++];
        ref.input(w, e[0], e[1], e[2], e[3]);
      }
      ref.advance(w, tick);
    }
    // late: input chỉ tới sau `delay` tick (<= REWIND_MAX)
    ei = 0;
    const pend: [number, number, number, number, number][] = [];
    let prevArr = 0;
    for (const e of evs) {
      prevArr = Math.max(prevArr, e[0] + Math.floor(rnd() * 25)); // TCP: tới đúng thứ tự
      pend.push([prevArr, e[0], e[1], e[2], e[3]]);
    }
    pend.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let pi = 0;
    for (let tick = 0; tick < 1600; tick++) {
      late.advance(w, tick);
      while (pi < pend.length && pend[pi][0] <= tick) {
        const e = pend[pi++];
        late.input(w, e[1], e[2], e[3], e[4]);
      }
    }
    late.advance(w, 1599);
    ref.advance(w, 1599);
    for (let i = 0; i < NF; i++) assert.equal(late.s[i], ref.s[i], `trial ${trial} trường ${i}`);
  }
  console.log('rewind: 200 kịch bản khớp bit');
}

/* 3) client dự đoán ≡ server qua mạng trễ + jitter */
{
  let seedN = 777;
  const rnd = () => ((seedN = (Math.imul(seedN, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cfg = { arenas: [['a', 'b']], seeds: [4242, 99, 7], rounds: 3 };
  let totalCorr = 0;
  for (const [lat, skew] of [[20, 0], [60, 0], [120, 0], [250, 0], [60, 40], [60, -40], [120, 60]]) {
    const startAt = 1_000_000;
    const cl = new DisasterClient(startAt, cfg, 0, 0);
    const w = new World(cfg.seeds[0], 0, 0);
    const server = mkSim(w, 0, 2);
    const up: { at: number; m: any }[] = [];
    const down: { at: number; m: any }[] = [];
    let keyDx = 0;
    let keyDy = 0;
    let nextKey = 0;
    let q = 0;
    let maxErr = 0;
    for (let ms = 0; ms < 25_000; ms += 4) {
      const now = startAt + ms;
      const cnow = now + skew; // đồng hồ client lệch so với server
      // người chơi đổi hướng / nhảy ngẫu nhiên
      if (ms >= nextKey) {
        keyDx = Math.floor(rnd() * 3) - 1;
        keyDy = Math.floor(rnd() * 3) - 1;
        nextKey = ms + 150 + rnd() * 700;
        const m = cl.setDir(keyDx, keyDy, cnow);
        if (m) up.push({ at: now + lat + rnd() * lat * 0.4, m });
        if (rnd() < 0.3) {
          const j = cl.jump(cnow);
          if (j) up.push({ at: now + lat + rnd() * lat * 0.4, m: j });
        }
      }
      cl.frame(cnow);
      // server nhận input
      up.sort((a, b) => a.at - b.at);
      while (up.length && up[0].at <= now) {
        const { m } = up.shift()!;
        const gtick = Math.floor((now - startAt) / STEP_MS);
        q = Math.max(q, m.q);
        server.advance(w, gtick);
        server.input(w, m.t, m.dx, m.dy, m.j ?? 0);
      }
      // server gửi snapshot mỗi 50ms
      if (ms % 52 === 0) {
        const gtick = Math.floor((now - startAt) / STEP_MS);
        server.advance(w, gtick);
        down.push({
          at: now + lat + rnd() * lat * 0.4,
          m: { y: 's', T: gtick, r: 0, b: 0, q, m: Array.from(server.s).map((v) => Math.round(v * 1000) / 1000), o: [[0, 0, 0, 0, 0], [1, 0, 0, 0, 0]] },
        });
      }
      down.sort((a, b) => a.at - b.at);
      while (down.length && down[0].at <= now) cl.onMessage(down.shift()!.m, cnow);
      if (cl.sim.s[F_DEAD] === 0) {
        // sai lệch giữa client (đã dự đoán) và server ở cùng tick, khi không còn input nào đang bay
        if (up.length === 0 && ms > 2000) {
          const T = Math.min(cl.sim.tick, server.tick);
          const e = Math.abs(cl.sim.at(T, F_X) - server.at(T, F_X)) + Math.abs(cl.sim.at(T, F_Y) - server.at(T, F_Y));
          if (e > maxErr) maxErr = e;
        }
      }
    }
    totalCorr += cl.corrections;
    console.log(`mạng ${lat}ms lệch giờ ${skew}ms: sửa dự đoán ${cl.corrections} lần, sai lệch tối đa khi yên ${maxErr.toFixed(3)}`);
    assert.ok(maxErr < 0.6, 'dự đoán client phải bám server');
  }
  void totalCorr;
}

/* 4) chia arena + điểm công bằng */
{
  assert.deepEqual(arenaSizes(2), [2]);
  assert.deepEqual(arenaSizes(8), [8]);
  assert.deepEqual(arenaSizes(9), [5, 4]);
  assert.deepEqual(arenaSizes(16), [8, 8]);
  let clock = 5_000_000;
  const sent: Record<string, any[]> = {};
  const run = (n: number, policy: (id: string, i: number) => 'idle' | 'center') => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    ids.forEach((id) => (sent[id] = []));
    const ctx = { playerIds: ids, startAt: clock + 1000, endAt: 0, now: () => clock, broadcast() {}, send: (id: string, p: any) => sent[id].push(p) };
    ctx.endAt = ctx.startAt + g.duration;
    const cfg = g.createConfig(ctx);
    const st = g.createState(ctx, cfg);
    clock = ctx.startAt;
    g.onStart?.(ctx, st, cfg);
    let steps = 0;
    while (steps++ < 4000) {
      clock += 50;
      g.update(ctx, st, cfg);
      if (g.isFinished(ctx, st, cfg) || clock >= ctx.endAt) break;
    }
    const sc = g.calculateScore(ctx, st, cfg);
    return { ctx, cfg, sc, secs: (clock - ctx.startAt) / 1000, bytes: JSON.stringify(sent).length };
  };
  for (const n of [2, 3, 7, 8, 9, 16]) {
    const r = run(n, () => 'idle');
    const raws = Object.values(r.sc).map((x) => x.raw);
    console.log(`${n} người đứng yên: ${r.secs.toFixed(0)}s, điểm ${Math.min(...raws)}..${Math.max(...raws)} (arena ${r.cfg.arenas.map((a: string[]) => a.length).join('+')})`);
    assert.ok(Math.max(...raws) <= 3000 && Math.min(...raws) >= 0);
    assert.ok(r.secs < g.duration / 1000 + 1);
  }
  console.log('arena + điểm OK');
}

/* 5) cân bằng: bot đứng yên vs bot "người" vs bot tiên tri, mô phỏng thuần (không mạng) */
{
  type Policy = (w: World, s: Float64Array, tick: number, st: { dx: number; dy: number; wake: number }) => [number, number, number];
  const tmp = new Float64Array(NF);
  const dirs: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const lookahead = (w: World, s: Float64Array, tick: number, dx: number, dy: number, jump: number, H: number, hold: [number, number]) => {
    tmp.set(s);
    stepPlayer(w, tmp, tick + 1, dx, dy, jump);
    for (let h = 2; h <= H; h++) {
      if (tmp[F_DEAD] > 0) return -1000 + h;
      stepPlayer(w, tmp, tick + h, dx, dy, 0);
    }
    if (tmp[F_DEAD] > 0) return -1000 + H;
    // ưu tiên cao hơn khi nước dâng, gần tâm khi sàn sập
    const tl = tick + H - w.base;
    let sc = tmp[F_Z] * 8 - (Math.abs(tmp[F_X]) + Math.abs(tmp[F_Y])) * 0.4;
    const k = w.tileAt(tmp[F_X], tmp[F_Y]);
    if (k >= 0 && w.fallTick[k] < tl + 100) sc -= 40;
    void hold;
    return sc;
  };
  const makeBot = (H: number, every: number): Policy => (w, s, tick, st) => {
    if (tick < st.wake) return [st.dx, st.dy, 0];
    st.wake = tick + every;
    let best = -1e9;
    let bd = dirs[0];
    for (const d of dirs) {
      const v = lookahead(w, s, tick, d[0], d[1], 0, H, [st.dx, st.dy]);
      if (v > best + 1e-9) {
        best = v;
        bd = d;
      }
    }
    // nhảy nếu đứng yên cũng chết mà nhảy thì sống (sóng động đất)
    const jv = lookahead(w, s, tick, bd[0], bd[1], 1, H, [st.dx, st.dy]);
    st.dx = bd[0];
    st.dy = bd[1];
    return [bd[0], bd[1], jv > best + 50 ? 1 : 0];
  };
  const policies: Record<string, Policy> = {
    'đứng yên': () => [0, 0, 0],
    'bot người (nhìn 0.4s, phản xạ 0.25s)': makeBot(24, 15),
    'bot tiên tri (nhìn 1.2s)': makeBot(72, 4),
  };
  for (const [name, pol] of Object.entries(policies)) {
    const causes = [0, 0, 0, 0, 0];
    let alive = 0;
    const N = name === 'đứng yên' ? 90 : 30;
    const perKind: Record<number, [number, number]> = {};
    for (let i = 0; i < N; i++) {
      const w = new World(i * 104729 + 17, i % 3, 0);
      const sim = mkSim(w, i % 8, 8);
      const st = { dx: 0, dy: 0, wake: 0 };
      for (let tick = 0; tick < w.endTick; tick++) {
        const [dx, dy, j] = pol(w, sim.s, tick, st);
        sim.input(w, tick + 1, dx, dy, j);
        sim.advance(w, tick + 1);
        if (sim.s[F_DEAD] > 0) break;
      }
      const c = sim.s[F_DEAD];
      causes[c]++;
      if (c === 0) alive++;
      else {
        const tl = sim.s[F_DTICK];
        const p = w.phaseAt(tl);
        const kind = p >= 0 ? w.pKind[p] : 0;
        perKind[kind] = perKind[kind] ?? [0, 0];
        perKind[kind][0]++;
      }
      void perKind;
    }
    console.log(`${name}: sống hết vòng ${alive}/${N} (${Math.round((alive / N) * 100)}%) · chết do thiên thạch ${causes[1]}, lốc ${causes[2]}, đuối ${causes[3]}, rơi ${causes[4]}`);
    if (name === 'đứng yên') assert.ok(alive / N < 0.5, 'đứng yên không được sống sót dễ dàng');
  }
}
void K_METEOR; void K_QUAKE; void K_FLOOD; void K_TORNADO; void K_COLLAPSE; void GRID; void HALF; void F_Z; void F_Y;
console.log('disaster.test OK');
