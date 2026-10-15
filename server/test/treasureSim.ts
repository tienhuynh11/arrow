// Bộ mô phỏng mạng cho CƯỚP KHO BÁU: chạy ĐÚNG code server (treasureGame) + ĐÚNG mô hình client (TreasureClient)
// trên đồng hồ ảo 1ms, có trễ/jitter/nghẽn gói. Dùng cho treasure.test.ts và đo độ lệch.
import { treasureGame, treasureTestOpts } from '../src/games/treasure.js';
import { TreasureClient } from '../../shared/treasureClient.js';
import { ACT_R, MAXC, MAXI, MOVE_REWIND_MAX, RING, STEP_MS, PR, SPEED_MUL, V0 } from '../../shared/treasure.js';
import { mulberry32 } from '../../shared/tank.js';

export interface TSimCfg {
  n: number;
  oneWayMs: number;
  jitterMs: number;
  stallRate: number;
  stallMs: number;
  lagComp: boolean;
  viewDelay: number;
  /** số giây mô phỏng tính từ lúc bắt đầu (đếm ngược 2s + 100s chơi); mặc định hết ván */
  seconds: number;
  seed: number;
  thieves: number;
  clockErrMs: number;
}

interface Msg {
  at: number;
  seq: number;
  to: number;
  payload: any;
}

export interface TSimResult {
  cfg: TSimCfg;
  ownErrMax: number;
  ownErrMean: number;
  ownErrP99: number;
  ownErrSamples: number;
  otherErrMax: number;
  otherErrMean: number;
  /** khoảng chênh hiển thị người khác so với vị trí server cùng thời điểm (px): mean/max */
  otherLagPxMean: number;
  otherLagMsMean: number;
  /** số lần bấm cướp mà màn hình người bấm thấy có nạn nhân trong tầm (đang mang, không miễn nhiễm) */
  stealAttemptsVisible: number;
  stealVisibleOk: number;
  stealVisibleShoved: number;
  stealInvisible: number;
  stealInvisibleHit: number;
  stealTotal: number;
  shoves: number;
  whiffs: number;
  pickups: number;
  deposits: number;
  corrections: number;
  maxCorrection: number;
  snapsPerSec: number;
  downBytesPerSecPerClient: number;
  upMsgsPerSecPerClient: number;
  upBytesPerSecPerClient: number;
  serverMsPerSec: number;
  invariantOk: boolean;
  syncOk: boolean;
  syncWhy: string;
  rawScores: number[];
  deps: number[];
  /** phản hồi bàn phím: số ms từ lúc bấm tới khung hình đầu tiên hiện chuyển động (trung bình/tối đa) */
  inputLatMsMean: number;
  inputLatMsMax: number;
}

export function runTSim(cfg: TSimCfg): TSimResult {
  const realRandom = Math.random;
  const prng = mulberry32(cfg.seed);
  Math.random = prng;
  try {
    return inner(cfg, prng);
  } finally {
    Math.random = realRandom;
  }
}

function inner(cfg: TSimCfg, rnd: () => number): TSimResult {
  const startAt = 1_000_000;
  const ids = Array.from({ length: cfg.n }, (_, i) => `p${i}`);
  const queue: Msg[] = [];
  let seq = 0;
  let vt = startAt;
  const lastArrDown = new Float64Array(cfg.n).fill(0);
  const lastArrUp = new Float64Array(cfg.n).fill(0);
  Object.assign(treasureTestOpts, { lagComp: cfg.lagComp, viewDelay: cfg.viewDelay });

  let serverNs = 0n;
  let downBytes = 0;
  let upMsgs = 0;
  let upBytes = 0;
  let snapCount = 0;
  let pickups = 0;
  let deposits = 0;
  let shoves = 0;
  let whiffs = 0;
  let stealTotal = 0;
  const outcome = new Map<number, string>();
  const shoveLog: { v: number; k: number }[] = [];
  const presses: { seat: number; n: number; vis: boolean }[] = [];

  const jit = () => (rnd() * 2 - 1) * cfg.jitterMs;
  const delayFor = (last: Float64Array, who: number) => {
    let d = cfg.oneWayMs + jit();
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
      if (payload.type === 's') snapCount++;
      if (to === 0) {
        if (payload.type === 'p') pickups += payload.ids.length;
        else if (payload.type === 'd') deposits++;
        else if (payload.type === 'h') stealTotal++;
        else if (payload.type === 'b') payload.v >= 0 ? shoves++ : whiffs++;
        if (payload.type === 'h') outcome.set(payload.by * 1e6 + payload.n, 'h');
        else if (payload.type === 'b') outcome.set(payload.by * 1e6 + payload.n, payload.v >= 0 ? 'b' : 'm');
        if (payload.type === 'b' && payload.v >= 0) shoveLog.push({ v: payload.v, k: payload.k });
      }
      downBytes += JSON.stringify(payload).length + 40;
      const at = delayFor(lastArrDown, to);
      queue.push({ at, seq: seq++, to, payload: JSON.parse(JSON.stringify(payload)) });
    },
  };
  const def = treasureGame;
  const config = def.createConfig(ctx);
  const state = def.createState(ctx, config);
  def.onStart!(ctx as any, state, config);
  const arenaCfg = config.arenas[0];
  const order = arenaCfg.ids;
  const seatOf = (id: string) => order.indexOf(id);
  const arena = () => state.arenas[0];

  interface Bot {
    id: string;
    seat: number;
    cl: TreasureClient;
    thief: boolean;
    phase: number;
    clockErr: number;
    cap: number;
    nextThink: number;
    wDx: number;
    wDy: number;
    nextAct: number;
    lastX: number;
    lastY: number;
    stuck: number;
    detour: number;
    detDx: number;
    detDy: number;
    ownRec: { tf: number; x: number; y: number; ph: number }[];
    otherRec: { rt: number; tf: number; j: number; x: number; y: number }[];
    prevRx: number;
    prevRy: number;
    wantKeyAt: number;
    keyAtMs: number;
    lats: number[];
  }
  const bots: Bot[] = ids.map((id, k) => {
    const seat = seatOf(id);
    const cl = new TreasureClient(startAt, 0, order, seat, arenaCfg.w, arenaCfg.h);
    return {
      id, seat, cl, thief: k < cfg.thieves,
      phase: Math.floor(rnd() * STEP_MS * 100) / 100,
      clockErr: (rnd() * 2 - 1) * cfg.clockErrMs,
      cap: 3 + Math.floor(rnd() * 6),
      nextThink: 0, wDx: 0, wDy: 0, nextAct: 0, lastX: 0, lastY: 0, stuck: 0, detour: 0, detDx: 0, detDy: 0,
      ownRec: [], otherRec: [], prevRx: 0, prevRy: 0, wantKeyAt: 0, keyAtMs: -1, lats: [],
    };
  });
  const botNextFrame = bots.map((b) => startAt + b.phase);

  const sendUp = (bot: Bot, input: any) => {
    upMsgs++;
    upBytes += JSON.stringify(input).length + 60;
    const at = delayFor(lastArrUp, bot.seat);
    queue.push({ at, seq: seq++, to: -1 - bot.seat, payload: input });
  };

  // sự thật phía server (đã ổn định)
  const maxTicks = Math.ceil((cfg.seconds * 1000) / STEP_MS) + 400;
  const tx: Float64Array[] = order.map(() => new Float64Array(maxTicks));
  const ty: Float64Array[] = order.map(() => new Float64Array(maxTicks));
  const tcalm: Uint8Array[] = order.map(() => new Uint8Array(maxTicks));
  let truthDone = -1;
  const settle = MOVE_REWIND_MAX + 8;
  /** tick gần nhất có sự kiện cướp/đẩy (loại mẫu quanh đó vì vị trí bị server tác động) */
  const eventTicks: number[] = [];
  let invariantOk = true;
  const logTruth = () => {
    const a = arena();
    if (!a) return;
    const S = a.w.tick;
    for (let k = Math.max(truthDone + 1, a.t0); k <= S - settle; k++) {
      if (k >= maxTicks) break;
      for (let i = 0; i < a.n; i++) {
        const o = i * RING + (k & (RING - 1));
        tx[i][k] = a.w.hx[o];
        ty[i][k] = a.w.hy[o];
        tcalm[i][k] = k >= a.fs + 5 ? 1 : 0;
      }
      truthDone = k;
    }
    // bảo toàn: nộp + đang mang + trên sân = tổng nguồn cung
    let sum = a.iCount;
    for (let i = 0; i < a.n; i++) sum += a.dep[i] + a.w.load[i];
    if (a.phase !== 2 && sum !== a.supply) invariantOk = false;
    if (a.phase === 2) {
      let d = 0;
      for (let i = 0; i < a.n; i++) d += a.dep[i];
      void d;
    }
  };

  const think = (bot: Bot, now: number) => {
    const cl = bot.cl;
    const w = cl.world;
    const me = bot.seat;
    const T = Math.floor((now - startAt) / STEP_MS);
    if (T < cl.fs || cl.over || T >= cl.endT) return { dx: 0, dy: 0, act: false };
    const mx = cl.rx[me];
    const my = cl.ry[me];
    let tgx = cl.W / 2;
    let tgy = cl.H / 2;
    let act = false;
    const load = w.load[me];
    // kẻ cướp: đuổi người đang mang (theo màn hình của mình)
    let chase = -1;
    if (bot.thief) {
      let bd = 1e18;
      for (let j = 0; j < cl.n; j++) {
        if (j === me || cl.sload[j] <= 0 || cl.immune[j]) continue;
        const dx = cl.rx[j] - mx;
        const dy = cl.ry[j] - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; chase = j; }
      }
      if (chase >= 0 && bd < 330 * 330 && load < 6) {
        tgx = cl.rx[chase];
        tgy = cl.ry[chase];
        if (bd < (ACT_R - 6) * (ACT_R - 6) && now >= bot.nextAct) {
          act = true;
          bot.nextAct = now + 600;
        }
      } else chase = -1;
    }
    if (chase < 0) {
      const late = T > cl.endT - 700;
      let anyItem = -1;
      let bd = 1e18;
      for (let s = 0; s < MAXI; s++) {
        if (!cl.iAct[s] || cl.ihide[s]) continue;
        const dx = cl.ix[s] - mx;
        const dy = cl.iy[s] - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; anyItem = s; }
      }
      const goHome = load >= bot.cap || (load > 0 && (anyItem < 0 || late));
      if (goHome) {
        tgx = w.bx[me];
        tgy = w.by[me];
      } else if (anyItem >= 0 && !(late && load === 0 && bd > 200 * 200)) {
        tgx = cl.ix[anyItem];
        tgy = cl.iy[anyItem];
      }
    }
    const dz = 5;
    let dx = tgx - mx > dz ? 1 : tgx - mx < -dz ? -1 : 0;
    let dy = tgy - my > dz ? 1 : tgy - my < -dz ? -1 : 0;
    // thoát kẹt cột đá: đứng im dù đang muốn đi → tạt ngang một lúc
    if ((dx !== 0 || dy !== 0) && Math.hypot(mx - bot.lastX, my - bot.lastY) < 0.4) bot.stuck++;
    else bot.stuck = Math.max(0, bot.stuck - 1);
    bot.lastX = mx;
    bot.lastY = my;
    if (bot.stuck > 12 && bot.detour <= 0) {
      bot.detour = 40;
      bot.detDx = rnd() < 0.5 ? -dy : dy;
      bot.detDy = rnd() < 0.5 ? dx : -dx;
      bot.stuck = 0;
    }
    if (bot.detour > 0) {
      bot.detour--;
      dx = bot.detDx;
      dy = bot.detDy;
    }
    // thỉnh thoảng bấm cướp "mù" (đẩy / trượt)
    if (!act && now >= bot.nextAct && rnd() < 0.004) {
      act = true;
      bot.nextAct = now + 800;
    }
    return { dx, dy, act };
  };

  // đo độ trễ phản hồi: thời điểm phím đổi (có thể giữa hai khung hình) → khung hình đầu tiên hiện thay đổi
  let driving = true;
  const clientFrame = (bot: Bot, now: number) => {
    const cl = bot.cl;
    const cn = now + bot.clockErr;
    if (!driving) {
      cl.frame(cn);
      cl.fx.length = 0;
      return;
    }
    const k = think(bot, cn);
    const msg = cl.setKeys(k.dx, k.dy, k.act, cn);
    if (msg && k.act) {
      // nhìn trên MÀN HÌNH người bấm: có nạn nhân (đang mang, không miễn nhiễm) trong tầm không?
      let vis = false;
      for (let j = 0; j < cl.n; j++) {
        if (j === bot.seat || cl.sload[j] <= 0 || cl.immune[j]) continue;
        if (Math.hypot(cl.rx[j] - cl.rx[bot.seat], cl.ry[j] - cl.ry[bot.seat]) < ACT_R - 4) vis = true;
      }
      presses.push({ seat: bot.seat, n: msg.a, vis });
    }
    if (msg) sendUp(bot, msg);
    const rep = cl.poll(cn);
    if (rep) sendUp(bot, rep);
    // trước khi vẽ: nếu vừa đổi hướng, ghi lại để đo xem khung này đã chạy theo hướng mới chưa
    const wasMoving = bot.prevRx !== cl.rx[bot.seat] || bot.prevRy !== cl.ry[bot.seat];
    const changed = !!msg;
    cl.frame(cn);
    cl.fx.length = 0;
    const nowMoved = cl.rx[bot.seat] !== bot.prevRx || cl.ry[bot.seat] !== bot.prevRy;
    if (changed && k.dx === 0 && k.dy === 0 && wasMoving) bot.lats.push(nowMoved ? 16.7 : 0);
    else if (changed && (k.dx !== 0 || k.dy !== 0) && !wasMoving && cl.world.tick >= cl.fs) bot.lats.push(nowMoved ? 0 : 16.7);
    bot.prevRx = cl.rx[bot.seat];
    bot.prevRy = cl.ry[bot.seat];

    if (cl.synced && cl.phase() === 1) {
      const tf = cl.tickF;
      bot.ownRec.push({ tf, x: cl.rx[bot.seat], y: cl.ry[bot.seat], ph: cl.phase() });
      for (let j = 0; j < cl.n; j++) {
        if (j === bot.seat) continue;
        bot.otherRec.push({ rt: tf - cl.delayTicks, tf, j, x: cl.rx[j], y: cl.ry[j] });
      }
    }
  };

  // thống kê cướp nhìn thấy
  let stealAttemptsVisible = 0;
  let stealVisibleOk = 0;
  void stealAttemptsVisible;
  void stealVisibleOk;

  const total = cfg.seconds * 1000;
  let lastUpdate = startAt;
  const t0 = startAt;
  const drainMs = 1500;
  for (let ms = 0; ms < total + drainMs; ms++) {
    driving = ms < total;
    vt = t0 + ms;
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
    if (vt - lastUpdate >= 50) {
      lastUpdate = vt;
      const s0 = process.hrtime.bigint();
      def.update(ctx as any, state, config);
      serverNs += process.hrtime.bigint() - s0;
      logTruth();
    }
    for (let b = 0; b < bots.length; b++) {
      if (vt >= botNextFrame[b]) {
        botNextFrame[b] += STEP_MS;
        clientFrame(bots[b], vt);
      }
    }
  }
  void eventTicks;

  /* ---------- thống kê ---------- */
  const a = arena();
  const interp = (arr: Float64Array, f: number) => {
    const k0 = Math.floor(f);
    const u = f - k0;
    return arr[k0] + (arr[k0 + 1] - arr[k0]) * u;
  };
  const nearShove = (j: number, k: number) => {
    const win = 36 + Math.ceil((cfg.oneWayMs * 4) / STEP_MS);
    for (const e of shoveLog) if (e.v === j && k >= e.k - 2 && k <= e.k + win) return true;
    return false;
  };
  const ownErrs: number[] = [];
  const otherErrs: number[] = [];
  const otherLagPx: number[] = [];
  const spd = V0 * 60; // px/s ở tay không
  void spd;
  for (const bot of bots) {
    const me = bot.seat;
    for (const r of bot.ownRec) {
      const k0 = Math.floor(r.tf);
      if (k0 + 1 > truthDone || k0 < 1) continue;
      if (!tcalm[me][k0] || !tcalm[me][k0 + 1] || nearShove(me, k0)) continue;
      const eh = Math.hypot(r.x - interp(tx[me], r.tf), r.y - interp(ty[me], r.tf));
      ownErrs.push(eh);
      if (process.env.TDBG && eh > 10) console.log('big', me, k0, eh.toFixed(1), 'shoves', JSON.stringify(shoveLog.filter((e) => e.v === me)));
    }
    for (const r of bot.otherRec) {
      const k0 = Math.floor(r.rt);
      if (k0 + 1 > truthDone || k0 < 1 || !tcalm[r.j][k0] || nearShove(r.j, Math.floor(r.tf))) continue;
      otherErrs.push(Math.hypot(r.x - interp(tx[r.j], r.rt), r.y - interp(ty[r.j], r.rt)));
      const k1 = Math.floor(r.tf);
      if (k1 + 1 <= truthDone && tcalm[r.j][k1]) otherLagPx.push(Math.hypot(r.x - interp(tx[r.j], r.tf), r.y - interp(ty[r.j], r.tf)));
    }
  }
  const sorted = ownErrs.slice().sort((p, q) => p - q);
  const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
  const secsTotal = (total + drainMs) / 1000;
  const playSecs = Math.max(1, cfg.seconds - 2);

  /* ---------- đồng bộ client ↔ server sau khi hết ván ---------- */
  let syncOk = true;
  let syncWhy = '';
  const over = a.phase === 2;
  if (over) {
    for (const bot of bots) {
      const c = bot.cl;
      for (let i = 0; i < a.n; i++) {
        if (c.score[i] !== a.dep[i]) { syncOk = false; syncWhy += `score(${bot.seat},${i}) ${c.score[i]}≠${a.dep[i]} `; }
        if (c.steals[i] !== a.steals[i]) { syncOk = false; syncWhy += `steals(${bot.seat},${i}) ${c.steals[i]}≠${a.steals[i]} `; }
      }
    }
  }

  let visN = 0, visH = 0, visB = 0, invN = 0, invH = 0;
  for (const pr of presses) {
    const o = outcome.get(pr.seat * 1e6 + pr.n);
    if (pr.vis) { visN++; if (o === 'h') visH++; else if (o === 'b') visB++; }
    else { invN++; if (o === 'h') invH++; }
  }
  const result: TSimResult = {
    cfg,
    ownErrMax: sorted.length ? sorted[sorted.length - 1] : 0,
    ownErrMean: mean(ownErrs),
    ownErrP99: sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0,
    ownErrSamples: ownErrs.length,
    otherErrMax: otherErrs.reduce((m, x) => Math.max(m, x), 0),
    otherErrMean: mean(otherErrs),
    otherLagPxMean: mean(otherLagPx),
    otherLagMsMean: 0,
    stealAttemptsVisible: visN,
    stealVisibleOk: visH,
    stealVisibleShoved: visB,
    stealInvisible: invN,
    stealInvisibleHit: invH,
    stealTotal,
    shoves,
    whiffs,
    pickups,
    deposits,
    corrections: bots.reduce((s, b) => s + b.cl.corrections, 0),
    maxCorrection: bots.reduce((m, b) => Math.max(m, b.cl.lastCorrection), 0),
    snapsPerSec: snapCount / cfg.n / playSecs,
    downBytesPerSecPerClient: downBytes / cfg.n / secsTotal,
    upMsgsPerSecPerClient: upMsgs / cfg.n / secsTotal,
    upBytesPerSecPerClient: upBytes / cfg.n / secsTotal,
    serverMsPerSec: Number(serverNs) / 1e6 / secsTotal,
    invariantOk,
    syncOk,
    syncWhy,
    rawScores: ids.map((_, i) => (a.supply > 0 ? Math.round((1000 * a.dep[i]) / (a.supply / a.n)) : 0)),
    deps: Array.from(a.dep.subarray(0, a.n)),
    inputLatMsMean: mean(bots.flatMap((b) => b.lats)),
    inputLatMsMax: bots.flatMap((b) => b.lats).reduce((m, x) => Math.max(m, x), 0),
  };
  // tốc độ trung bình khi mang đồ → quy đổi độ trễ hiển thị người khác ra ms (xấp xỉ theo tốc độ tay không)
  result.otherLagMsMean = result.otherLagPxMean / (V0 * 60) * 1000;
  if (process.env.TDBG) for (const b of bots) console.log("bot", b.seat, "cap", b.cap, "pos", b.cl.world.x[b.seat].toFixed(0), b.cl.world.y[b.seat].toFixed(0), "load", b.cl.world.load[b.seat], "base", a.w.bx[b.seat].toFixed(0), a.w.by[b.seat].toFixed(0), "srv", a.w.x[b.seat].toFixed(0), a.w.y[b.seat].toFixed(0));
  void SPEED_MUL;
  void MAXC;
  void PR;
  return result;
}
