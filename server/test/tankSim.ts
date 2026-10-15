// Bộ mô phỏng mạng cho XE TĂNG: chạy ĐÚNG code server (tanksGame) + ĐÚNG mô hình client (TankClient)
// trên đồng hồ ảo 1ms, có trễ/jitter/nghẽn gói. Dùng cho tank.test.ts.
import { tanksGame, tankTestOpts } from '../src/games/tankTrouble.js';
import { TankClient } from '../../shared/tankClient.js';
import { ANG_N, STEP_MS, TANK_R, angDiff, mulberry32, traceRay, MOVE_REWIND_MAX, RING, type TankWorld } from '../../shared/tank.js';

export interface SimCfg {
  n: number;
  oneWayMs: number;
  jitterMs: number;
  /** tỉ lệ gói bị nghẽn (TCP phải gửi lại): trễ thêm stallMs và chặn các gói sau nó */
  stallRate: number;
  stallMs: number;
  /** tỉ lệ snapshot bị MẤT hẳn (mô phỏng UDP, kiểm tra độ bền) */
  dropSnap: number;
  lagComp: boolean;
  viewDelay: number;
  seconds: number;
  seed: number;
  hunters: number;
  /** sai lệch đồng hồ client so với server (ms) */
  clockErrMs: number;
  noPush?: boolean;
  noKill?: boolean;
  noItems?: boolean;
  immortal?: boolean;
  /** bot bắn dày (kiểm thử đạn nảy) */
  rapidFire?: boolean;
}

interface Msg {
  at: number;
  seq: number;
  to: number;
  payload: any;
}

export interface SimResult {
  cfg: SimCfg;
  ownErrMax: number;
  ownErrMean: number;
  ownErrP99: number;
  ownErrSamples: number;
  predErrMax: number;
  otherErrMax: number;
  otherErrMean: number;
  otherLagMs: number;
  shots: number;
  visHits: number;
  visHitsServerMiss: number;
  serverHitsNotVisible: number;
  corrections: number;
  maxCorrection: number;
  snapsPerSec: number;
  downBytesPerSecPerClient: number;
  upMsgsPerSecPerClient: number;
  upBytesPerSecPerClient: number;
  serverMsPerSec: number;
  kills: number;
  selfKills: number;
  rounds: number;
  exactBulletMatch: boolean | null;
  exactTankMaxDiff: number;
}

const EOF_HASH = 0;

/** băm riêng đạn (không phụ thuộc thứ tự slot) */
export function bulletHash(w: TankWorld): number {
  const f = new Float64Array(1);
  const u = new Uint32Array(f.buffer);
  let acc = 0;
  for (let b = 0; b < w.bAct.length; b++) {
    if (!w.bAct[b]) continue;
    let h = 2166136261 >>> 0;
    for (const v of [w.bx[b], w.by[b], w.bvx[b], w.bvy[b], w.blife[b]]) {
      f[0] = v;
      h = Math.imul(h ^ u[0], 16777619) >>> 0;
      h = Math.imul(h ^ u[1], 16777619) >>> 0;
    }
    acc = (acc + h) >>> 0;
  }
  return acc ^ EOF_HASH;
}

export function runSim(cfg: SimCfg): SimResult {
  const realRandom = Math.random;
  const prng = mulberry32(cfg.seed);
  Math.random = prng;
  try {
    return runSimInner(cfg, prng);
  } finally {
    Math.random = realRandom;
  }
}

function runSimInner(cfg: SimCfg, rnd: () => number): SimResult {
  const startAt = 1_000_000;
  const ids = Array.from({ length: cfg.n }, (_, i) => `p${i}`);
  const queue: Msg[] = [];
  let seq = 0;
  let vt = startAt;
  const lastArrDown = new Float64Array(cfg.n).fill(0);
  let lastArrUp = new Float64Array(cfg.n).fill(0);

  Object.assign(tankTestOpts, {
    lagComp: cfg.lagComp,
    viewDelay: cfg.viewDelay,
    noPush: !!cfg.noPush,
    noKill: !!cfg.noKill,
    noItems: !!cfg.noItems,
    immortal: !!cfg.immortal,
  });

  // thống kê server
  let serverNs = 0n;
  let downBytes = 0;
  let upMsgs = 0;
  let upBytes = 0;
  let snapCount = 0;
  let lastSnapVt = 0;
  const srvEvents: any[] = [];

  const jit = () => (rnd() * 2 - 1) * cfg.jitterMs;
  const delayFor = (last: Float64Array, who: number, extra = 0) => {
    let d = cfg.oneWayMs + jit() + extra;
    if (rnd() < cfg.stallRate) d += cfg.stallMs;
    const at = Math.max(vt + Math.max(0, d), last[who]);
    last[who] = at;
    return at;
  };

  const ctx = {
    playerIds: ids,
    startAt,
    endAt: startAt + 1e9,
    now: () => vt,
    broadcast: () => {},
    send: (id: string, payload: any) => {
      const to = Number(id.slice(1));
      if (payload.type === 's') {
        snapCount++;
        lastSnapVt = vt;
        if (cfg.dropSnap > 0 && rnd() < cfg.dropSnap) return;
      }
      if (to === 0 && payload.type !== 's' && payload.type !== 'R') srvEvents.push(payload);
      downBytes += JSON.stringify(payload).length + 40;
      const at = delayFor(lastArrDown, to);
      queue.push({ at, seq: seq++, to, payload: JSON.parse(JSON.stringify(payload)) });
    },
  };
  const def = tanksGame;
  const config = def.createConfig(ctx);
  const state = def.createState(ctx, config);
  def.onStart!(ctx as any, state, config);
  const arenaCfg = config.arenas[0];
  const order = arenaCfg.ids; // thứ tự ghế
  const seatOf = (id: string) => order.indexOf(id);

  /* ---- client ---- */
  interface Bot {
    id: string;
    seat: number;
    cl: TankClient;
    hunter: boolean;
    phase: number;
    nextThink: number;
    wTurn: number;
    wMove: number;
    nextFire: number;
    clockErr: number;
    // đo
    ownRec: { tf: number; x: number; y: number; a: number; predX: number; predY: number }[];
    otherRec: { rt: number; tf: number; j: number; x: number; y: number; nt: number }[];
    shotsFired: Set<number>;
    visHit: Set<number>;
    lastFireN: number;
    lockUntil: number;
    vx: Float64Array;
    vy: Float64Array;
    px: Float64Array;
    py: Float64Array;
  }
  const ray = new Float64Array(8);
  const bots: Bot[] = ids.map((id, k) => {
    const seat = seatOf(id);
    const cl = new TankClient(startAt, 0, order, seat, arenaCfg.w, arenaCfg.h);
    cl.noPush = !!cfg.noPush;
    const bot: Bot = {
      id,
      seat,
      cl,
      hunter: k < cfg.hunters,
      phase: Math.floor(rnd() * STEP_MS * 100) / 100,
      nextThink: 0,
      wTurn: 0,
      wMove: 0,
      nextFire: 0,
      clockErr: (rnd() * 2 - 1) * cfg.clockErrMs,
      ownRec: [],
      otherRec: [],
      shotsFired: new Set(),
      visHit: new Set(),
      lastFireN: 0,
      lockUntil: 0,
      vx: new Float64Array(8),
      vy: new Float64Array(8),
      px: new Float64Array(8),
      py: new Float64Array(8),
    };
    cl.onPredictedHit = (n) => {
      if (n > 0) bot.visHit.add(n);
    };
    return bot;
  });
  const botNextFrame = bots.map((b) => startAt + b.phase);

  const sendUp = (bot: Bot, input: any) => {
    upMsgs++;
    upBytes += JSON.stringify(input).length + 60;
    const at = delayFor(lastArrUp, bot.seat);
    queue.push({ at, seq: seq++, to: -1 - bot.seat, payload: input });
  };

  // sự thật phía server (đã ổn định, sau MOVE_REWIND_MAX+8 tick)
  const maxTicks = Math.ceil((cfg.seconds * 1000) / STEP_MS) + 400;
  const tx: Float64Array[] = order.map(() => new Float64Array(maxTicks));
  const ty: Float64Array[] = order.map(() => new Float64Array(maxTicks));
  const ta: Int32Array[] = order.map(() => new Int32Array(maxTicks));
  const tvalidAll: Uint8Array[] = order.map(() => new Uint8Array(maxTicks));
  let truthDone = -1;
  const settle = MOVE_REWIND_MAX + 8;
  const arena = () => state.arenas[0];
  const logTruth = () => {
    const a = arena();
    if (!a) return;
    const S = a.w.tick;
    for (let k = Math.max(truthDone + 1, a.t0); k <= S - settle; k++) {
      if (k >= maxTicks) break;
      const base = a.phase !== 0 && k >= a.fs + 30 ? 1 : 0;
      const okI: number[] = [];
      for (let i = 0; i < a.n; i++) {
        okI[i] = base;
        const o = i * RING + (k & (RING - 1));
        tx[i][k] = a.w.hx[o];
        ty[i][k] = a.w.hy[o];
        ta[i][k] = a.w.ha[o];
        // xe sắp chết: server đặt xác về chỗ người bắn thấy (bù trễ) nên quỹ đạo vài tick cuối không so được
        if (a.deathTick[i] >= 0 && k > a.deathTick[i] - 14) okI[i] = 0;
      }
      // xe chạm nhau → không xác định được → bỏ mẫu
      for (let i = 0; i < a.n; i++)
        for (let j = i + 1; j < a.n; j++) {
          const dx = tx[i][k] - tx[j][k];
          const dy = ty[i][k] - ty[j][k];
          if (dx * dx + dy * dy < (2 * TANK_R + 10) * (2 * TANK_R + 10)) {
            okI[i] = 0;
            okI[j] = 0;
          }
        }
      for (let i = 0; i < a.n; i++) tvalidAll[i][k] = okI[i];
      truthDone = k;
    }
  };

  const think = (bot: Bot, now: number) => {
    const cl = bot.cl;
    const w = cl.world;
    const T = Math.floor((now - startAt) / STEP_MS);
    let turn = bot.wTurn;
    let move = bot.wMove;
    let fire = false;
    if (cl.round < 0 || T < cl.fs || !cl.alive[bot.seat] || cl.over) return { turn: 0, move: 0, fire: false };
    if (bot.hunter) {
      let best = -1;
      let bd = 1e18;
      for (let j = 0; j < cl.n; j++) {
        if (j === bot.seat || !cl.alive[j]) continue;
        const dx = cl.rx[j] - cl.rx[bot.seat];
        const dy = cl.ry[j] - cl.ry[bot.seat];
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) {
        const dist0 = Math.sqrt(bd);
        const lead = Math.min(40, dist0 / 3.33);
        const dx = cl.rx[best] + bot.vx[best] * lead - w.x[bot.seat];
        const dy = cl.ry[best] + bot.vy[best] * lead - w.y[bot.seat];
        const aim = Math.round((Math.atan2(dy, dx) * ANG_N) / (Math.PI * 2)) & (ANG_N - 1);
        const diff = angDiff(w.ang[bot.seat], aim);
        turn = diff > 10 ? 1 : diff < -10 ? -1 : 0;
        const dist = Math.sqrt(bd);
        // tầm nhìn thẳng?
        const np = traceRay(w.maze, w.x[bot.seat], w.y[bot.seat], w.ang[bot.seat], dist, 0, ray);
        const clear = np === 2 && Math.hypot(ray[2] - w.x[bot.seat], ray[3] - w.y[bot.seat]) > dist - 2;
        if (now >= bot.nextThink) {
          bot.nextThink = now + 300 + rnd() * 700;
          bot.wMove = rnd() < 0.6 ? 1 : rnd() < 0.5 ? 0 : -1;
        }
        move = Math.abs(diff) < 80 && dist > 70 ? bot.wMove || 1 : dist < 45 ? -1 : bot.wMove;
        if (now < bot.lockUntil) move = 1;
        if (clear && Math.abs(diff) <= 14 && now >= bot.nextFire) {
          fire = true;
          bot.nextFire = now + 250 + rnd() * 350;
          bot.lockUntil = now + 450; // bắn rồi chạy, đỡ bị đạn nảy về trúng mình
        }
      }
    }
    if (now >= bot.nextThink && !bot.hunter) {
      // mục tiêu: đi thẳng khá lâu rồi rẽ → bắn đón đầu có cơ hội trúng (đo bù trễ)
      bot.nextThink = now + 700 + rnd() * 1600;
      bot.wTurn = rnd() < 0.55 ? 0 : rnd() < 0.5 ? 1 : -1;
      bot.wMove = rnd() < 0.85 ? 1 : -1;
    }
    if (!bot.hunter) {
      turn = bot.nextThink - now > 1500 && bot.wTurn !== 0 ? bot.wTurn : bot.nextThink - now > 1000 ? 0 : bot.wTurn;
      move = bot.wMove;
    }
    if (!bot.hunter && now >= bot.nextFire && (cfg.rapidFire || rnd() < 0.2)) {
      fire = true;
      bot.nextFire = now + (cfg.rapidFire ? 260 + rnd() * 300 : 1500 + rnd() * 2500);
    }
    return { turn, move, fire };
  };

  let driving = true;
  const clientFrame = (bot: Bot, now: number) => {
    const cl = bot.cl;
    const cn = now + bot.clockErr; // đồng hồ client có sai lệch
    if (!driving) {
      cl.frame(cn);
      cl.fx.length = 0;
      return;
    }
    for (let j = 0; j < cl.n; j++) {
      // vận tốc hiển thị của xe khác (đơn vị/tick) để ngắm đón đầu
      bot.vx[j] = bot.vx[j] * 0.9 + 0.1 * (cl.rx[j] - bot.px[j]) * (60 / 60);
      bot.vy[j] = bot.vy[j] * 0.9 + 0.1 * (cl.ry[j] - bot.py[j]);
      bot.px[j] = cl.rx[j];
      bot.py[j] = cl.ry[j];
    }
    const k = think(bot, cn);
    const msg = cl.setKeys(k.turn, k.move, k.fire, cn);
    if (msg) {
      if (k.fire) bot.shotsFired.add(msg.f);
      sendUp(bot, msg);
    }
    const rep = cl.poll(cn);
    if (rep) sendUp(bot, rep);
    cl.frame(cn);
    cl.fx.length = 0;
    if (cl.round >= 0 && cl.alive[bot.seat]) {
      const tf = cl.tickF;
      bot.ownRec.push({ tf, x: cl.rx[bot.seat], y: cl.ry[bot.seat], a: cl.ra[bot.seat], predX: cl.world.x[bot.seat], predY: cl.world.y[bot.seat] });
      for (let j = 0; j < cl.n; j++) {
        if (j === bot.seat || !cl.alive[j]) continue;
        bot.otherRec.push({ rt: tf - cl.delayTicks, tf, j, x: cl.rx[j], y: cl.ry[j], nt: cl.newestTick(j) });
      }
    }
  };

  const total = cfg.seconds * 1000;
  let lastUpdate = startAt;
  const t0 = startAt;
  const exactCheck = !!cfg.noKill && !!cfg.noItems && !!cfg.noPush;
  // sau khi ngừng bot, chạy thêm để mọi gói đang bay (kể cả sự kiện do chúng sinh ra) tới nơi tự nhiên
  const drainMs = 1500;
  for (let ms = 0; ms < total + drainMs; ms++) {
    driving = ms < total;
    vt = t0 + ms;
    // 1) chuyển gói đã tới (đúng thứ tự)
    if (queue.length) {
      queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      while (queue.length && queue[0].at <= vt) {
        const m = queue.shift()!;
        if (m.to >= 0) {
          const bot = bots[m.to];
          bot.cl.onMessage(m.payload, vt + bot.clockErr);
        } else {
          const seat = -1 - m.to;
          const s0 = process.hrtime.bigint();
          def.handleInput(ctx as any, state, config, order[seat], m.payload);
          serverNs += process.hrtime.bigint() - s0;
        }
      }
    }
    // 2) server update 20Hz
    if (vt - lastUpdate >= 50) {
      lastUpdate = vt;
      const s0 = process.hrtime.bigint();
      def.update(ctx as any, state, config);
      serverNs += process.hrtime.bigint() - s0;
      logTruth();
    }
    // 3) khung hình client (60Hz, mỗi client lệch pha)
    for (let b = 0; b < bots.length; b++) {
      if (vt >= botNextFrame[b]) {
        botNextFrame[b] += STEP_MS;
        clientFrame(bots[b], vt);
      }
    }
  }

  /* ---------- kiểm tra khớp tuyệt đối (khi noKill/noItems/noPush) ---------- */
  let exactBulletMatch: boolean | null = null;
  let exactTankMaxDiff = 0;
  const a0 = arena();
  if (exactCheck && a0) {
    // đưa server và client về cùng một tick (mọi gói đã tới sau pha xả)
    const Tend = Math.max(a0.w.tick, ...bots.map((b) => b.cl.world.tick)) + 1;
    vt = startAt + Tend * STEP_MS + 0.5;
    a0.advance(Tend);
    let ok = true;
    for (const bot of bots) {
      bot.cl.frame(vt);
      if (bot.cl.world.tick !== a0.w.tick) ok = false;
      if (bulletHash(bot.cl.world) !== bulletHash(a0.w)) {
        ok = false;
        if (process.env.TANK_DBG) {
          const dump = (w: TankWorld) => {
            const o: string[] = [];
            for (let b = 0; b < w.bAct.length; b++) if (w.bAct[b]) o.push(`${w.bid[b]}:${w.bx[b].toFixed(4)},${w.by[b].toFixed(4)},L${w.blife[b]}`);
            return o.sort().join(' | ');
          };
          console.log('[dbg3] seat', bot.seat, 'tick', bot.cl.world.tick, 'vs', a0.w.tick, 'SERVER:', dump(a0.w), 'CLIENT:', dump(bot.cl.world));
        }
      }
    }
    exactBulletMatch = ok;
  }
  logTruth();

  /* ---------- tính sai số ---------- */
  const lerpTruth = (arr: Float64Array, tf: number) => {
    const k = Math.floor(tf);
    const u = tf - k;
    return arr[k] + (arr[k + 1] - arr[k]) * u;
  };
  const errs: number[] = [];
  const predErrs: number[] = [];
  for (const bot of bots) {
    for (const r of bot.ownRec) {
      const k = Math.floor(r.tf);
      if (k < 1 || k + 1 >= maxTicks || !tvalidAll[bot.seat][k] || !tvalidAll[bot.seat][k + 1]) continue;
      const ex = lerpTruth(tx[bot.seat], r.tf);
      const ey = lerpTruth(ty[bot.seat], r.tf);
      errs.push(Math.hypot(r.x - ex, r.y - ey));
      predErrs.push(Math.hypot(r.predX - tx[bot.seat][k], r.predY - ty[bot.seat][k]));
      if (process.env.TANK_DBG2) {
        const pe = Math.hypot(r.predX - tx[bot.seat][k], r.predY - ty[bot.seat][k]);
        if (pe > 5) {
          let md = 1e9;
          for (let j = 0; j < cfg.n; j++) if (j !== bot.seat) md = Math.min(md, Math.hypot(tx[j][k] - tx[bot.seat][k], ty[j][k] - ty[bot.seat][k]));
          console.log(`[dbg4] seat ${bot.seat} tick ${k} predErr ${pe.toFixed(2)} minDistOther ${md.toFixed(1)} fs ${arena()?.fs}`);
        }
      }
      if (exactCheck) {
        const dd = Math.hypot(r.predX - tx[bot.seat][k], r.predY - ty[bot.seat][k]);
        if (dd > 1e-9 && process.env.TANK_DBG && !(globalThis as any).__dbgOnce) {
          (globalThis as any).__dbgOnce = 1;
          console.log('[dbg] first mismatch seat', bot.seat, 'tick', k, 'diff', dd, 'pred', r.predX, r.predY, 'truth', tx[bot.seat][k], ty[bot.seat][k], 'round fs', arena()?.fs, 't0', arena()?.t0);
        }
        exactTankMaxDiff = Math.max(exactTankMaxDiff, dd);
      }
    }
  }
  if (process.env.TANK_DBG && exactCheck) {
    for (const bot of bots) {
      for (const r of bot.ownRec) {
        const k = Math.floor(r.tf);
        if (k < 200 || k >= maxTicks - 40 || k > truthDone) continue;
        const dd = Math.hypot(r.predX - tx[bot.seat][k], r.predY - ty[bot.seat][k]);
        if (dd > 1e-9) {
          console.log('[dbg2] first raw mismatch seat', bot.seat, 'tick', k, 'diff', dd, 'valid', tvalidAll[bot.seat][k]);
          break;
        }
      }
    }
  }
  errs.sort((a, b) => a - b);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

  let oMax = 0;
  let oSum = 0;
  let oN = 0;
  let lagSum = 0;
  for (const bot of bots) {
    for (const r of bot.otherRec) {
      const k = Math.floor(r.rt);
      if (k < 1 || k + 1 >= maxTicks || !tvalidAll[r.j][k] || !tvalidAll[r.j][k + 1]) continue;
      const ex = lerpTruth(tx[r.j], r.rt);
      const ey = lerpTruth(ty[r.j], r.rt);
      const e = Math.hypot(r.x - ex, r.y - ey);
      oMax = Math.max(oMax, e);
      if (process.env.TANK_DBG3 && e > 15) console.log(`[dbg5] other err ${e.toFixed(1)} tick ${k} bufferAhead ${(r.nt - r.rt).toFixed(1)} ticks delay ${(r.tf - r.rt).toFixed(1)}`);
      oSum += e;
      oN++;
      lagSum += r.tf - r.rt;
    }
  }

  /* ---------- đạn: nhìn thấy trúng vs server chốt ---------- */
  // ánh xạ id đạn server → (người bắn, n)
  const owner = new Map<number, string>();
  for (const e of srvEvents) {
    if (e.type === 'f') {
      const cnt = e.kd === 2 ? 3 : 1;
      for (let c = 0; c < cnt; c++) owner.set(e.b + c, `${e.i}:${e.n}`);
    }
  }
  const serverHit = new Set<string>();
  let kills = 0;
  let selfKills = 0;
  for (const e of srvEvents) {
    if (e.type === 'x') {
      kills++;
      if (e.by === e.v) selfKills++;
      const key = owner.get(e.b);
      if (key && e.by !== e.v) serverHit.add(key);
    }
    if (e.type === 'z') {
      const key = owner.get(e.b);
      if (key && Number(key.split(':')[0]) !== e.v) serverHit.add(key);
    }
  }
  let shots = 0;
  let vis = 0;
  let visMiss = 0;
  const visSet = new Set<string>();
  for (const bot of bots) {
    shots += bot.shotsFired.size;
    for (const n of bot.visHit) {
      vis++;
      visSet.add(`${bot.seat}:${n}`);
      if (!serverHit.has(`${bot.seat}:${n}`)) visMiss++;
    }
  }
  let srvNotVis = 0;
  for (const k of serverHit) if (!visSet.has(k)) srvNotVis++;

  // tốc độ gói tính theo thời gian ván thực sự diễn ra (ván có thể kết thúc sớm hơn thời gian mô phỏng)
  const sec = Math.max(1, Math.min(cfg.seconds, (lastSnapVt - startAt) / 1000));
  const corr = bots.reduce((s, b) => s + b.cl.corrections, 0);
  const result: SimResult = {
    cfg,
    ownErrMax: errs.length ? errs[errs.length - 1] : 0,
    ownErrMean: mean(errs),
    ownErrP99: errs.length ? errs[Math.floor(errs.length * 0.99)] : 0,
    ownErrSamples: errs.length,
    predErrMax: predErrs.reduce((m, v) => Math.max(m, v), 0),
    otherErrMax: oMax,
    otherErrMean: oN ? oSum / oN : 0,
    otherLagMs: oN ? (lagSum / oN) * STEP_MS : 0,
    shots,
    visHits: vis,
    visHitsServerMiss: visMiss,
    serverHitsNotVisible: srvNotVis,
    corrections: corr,
    maxCorrection: bots.reduce((m, b) => Math.max(m, b.cl.lastCorrection), 0),
    snapsPerSec: snapCount / sec / cfg.n,
    downBytesPerSecPerClient: downBytes / sec / cfg.n,
    upMsgsPerSecPerClient: upMsgs / sec / cfg.n,
    upBytesPerSecPerClient: upBytes / sec / cfg.n,
    serverMsPerSec: Number(serverNs) / 1e6 / sec,
    kills,
    selfKills,
    rounds: (arena()?.round ?? 0) + 1,
    exactBulletMatch,
    exactTankMaxDiff,
  };
  return result;
}
