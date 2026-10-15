/**
 * XÌ HƠI CÙNG NHAU (id fart) - vật lý bè XÁC ĐỊNH, dùng chung server + client.
 *
 * - Bước thời gian cố định 1/60s, số học thuần (không đọc đồng hồ thật), không cấp phát trong vòng bước.
 * - Bè là một vật cứng 2D: x, y, góc, vx, vy, ω (mảng Float64Array NS phần tử, tái dùng).
 * - Khóa học sinh từ seed (mulberry32): cùng seed -> cùng sông, chướng ngại, xoáy nước ở server lẫn client.
 * - Chướng ngại động là HÀM CỦA TICK (không có trạng thái riêng) nên tua lại (rollback) là miễn phí.
 * - RaftSim giữ vòng đệm trạng thái + nhật ký sự kiện xì: chèn sự kiện muộn -> tua về tick đó -> mô phỏng lại.
 */

export const TICK_HZ = 60;
export const STEP_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;
/** sự kiện xì được phép "cũ" tối đa chừng này tick (≈ 233ms) */
export const MAX_BACK = 14;

/* ---------------- trạng thái bè ---------------- */
/** 16 phần tử cho bè + 3 phần tử mỗi chỗ ngồi (giữ, hướng xì mrad, khí) */
export const NS = 28;
export const S_SEAT0 = 16;
export const sHold = (j: number) => S_SEAT0 + 3 * j;
export const sAim = (j: number) => S_SEAT0 + 3 * j + 1;
export const sGas = (j: number) => S_SEAT0 + 3 * j + 2;
export const S_X = 0;
export const S_Y = 1;
export const S_A = 2;
export const S_VX = 3;
export const S_VY = 4;
export const S_W = 5;
/** độ bền 0..100 */
export const S_HP = 6;
/** > 0: đang chìm, còn bao nhiêu tick thì hồi sinh */
export const S_SINK = 7;
/** > 0: bất tử (sau va chạm / sau hồi sinh) */
export const S_INV = 8;
/** checkpoint đã qua 0..3 */
export const S_CP = 9;
/** quãng đường xa nhất đã đi */
export const S_PROG = 10;
export const S_SEG = 11;
/** tick về đích + 1 (0 = chưa về) */
export const S_FIN = 12;
/** quãng đường hiện tại dọc đường tâm */
export const S_S = 13;
/** vận tốc va chạm gần nhất (để client làm âm thanh/hiệu ứng) */
export const S_HITV = 14;
/** số lần va chạm gây sát thương */
export const S_HITS = 15;

/* ---------------- hằng số vật lý ---------------- */
export const THRUST = 2.6; // gia tốc (m/s²) mỗi người khi đang GIỮ xì, khí còn đầy
export const TQ = 0.75; // hệ số mô-men xoắn: Δω = TQ * (r × Δv) mỗi tick
export const FLOW_DRAG = 0.85; // kéo của nước (1/s) - hướng về vận tốc dòng chảy
export const ANG_DRAG = 1.7; // ma sát quay (1/s)
export const RESTITUTION = 0.4;
export const INERTIA = 1.35; // I/m
export const HIT_V = 1.3; // dưới ngưỡng này va chạm không mất độ bền
export const DMG_K = 7;
export const DMG_B = 1.5;
export const HIT_INV = 18;
export const SINK_TICKS = 150;
export const RESPAWN_INV = 120;

const KD = 1 - Math.exp(-FLOW_DRAG * DT);
const KW = Math.exp(-ANG_DRAG * DT);

/** chỗ ngồi trong hệ toạ độ bè (+x = mũi bè) */
export const SEAT_X = [0.95, 0.95, -0.95, -0.95];
export const SEAT_Y = [-0.55, 0.55, -0.55, 0.55];
/** thứ tự chỗ ngồi theo số người trong bè (cho các chỗ ngồi cách xa nhau nhất có thể) */
export const SEAT_ORDER: number[][] = [[0], [0], [0, 3], [0, 3, 1], [0, 3, 1, 2]];
/** các vòng tròn va chạm của bè */
export const CIRC_X = [0.95, 0.95, -0.95, -0.95];
export const CIRC_Y = [-0.5, 0.5, -0.5, 0.5];
export const CIRC_R = 0.78;

/* ---------------- khí (gas): nằm trong trạng thái mô phỏng nên xác định ---------------- */
export const GAS_DRAIN = 0.28; // /s khi đang giữ xì
export const GAS_REGEN = 0.25; // /s khi buông
export const GAS_FADE = 0.3; // dưới mức này lực xì yếu dần
export const MIN_GAP_MS = 40; // giữa hai sự kiện giữ/thả/đổi hướng của một người (server)

/** chia đội: 2-4 người/bè, không có bè 1 người (khi n ≥ 2) */
export function teamSizes(n: number): number[] {
  if (n <= 1) return [n];
  const teams = Math.ceil(n / 4);
  const base = Math.floor(n / teams);
  const rem = n - base * teams;
  const out: number[] = [];
  for (let i = 0; i < teams; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

/* ---------------- khóa học ---------------- */
export const OB_STRIDE = 12;
export const OB_ROCK = 0;
export const OB_SLIDER = 1;
export const OB_ARM = 2;
export const OB_GATE = 3;

export interface Zone {
  name: string;
  s0: number;
  s1: number;
}

export interface Course {
  seed: number;
  n: number;
  ds: number;
  /** tổng chiều dài đường tâm */
  len: number;
  /** vạch đích (quãng đường) */
  finishS: number;
  px: Float64Array;
  py: Float64Array;
  /** tiếp tuyến đơn vị của đoạn i -> i+1 */
  tx: Float64Array;
  ty: Float64Array;
  hw: Float64Array;
  /** tốc độ dòng chảy */
  flow: Float64Array;
  /** quãng đường tích luỹ */
  sa: Float64Array;
  nOb: number;
  obK: Uint8Array;
  ob: Float64Array;
  /** quãng đường đặt chướng ngại (để lọc nhanh) */
  obS: Float64Array;
  /** 1 = chướng ngại có GAI (chạm là mất độ bền) */
  obSp: Uint8Array;
  /** gai ở bờ trái / phải tại điểm i */
  spL: Uint8Array;
  spR: Uint8Array;
  nWh: number;
  /** x, y, R, độ mạnh (âm = ngược chiều kim đồng hồ) */
  wh: Float64Array;
  cpS: Float64Array;
  cpIdx: Int32Array;
  zones: Zone[];
}

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const DS = 3;

export function genCourse(seed: number): Course {
  const rng = mulberry32(seed >>> 0);
  const xs: number[] = [0];
  const ys: number[] = [0];
  const hwT: number[] = [];
  const flT: number[] = [];
  let h = Math.PI / 2;
  const zones: Zone[] = [];
  const first = () => {
    hwT.push(0);
    flT.push(0);
  };
  first();

  /** len = chiều dài, turn = tổng góc quay (rad), hw = nửa độ rộng, flow = tốc độ dòng */
  const piece = (len: number, turn: number, hw: number, flow: number) => {
    const k = Math.max(1, Math.round(len / DS));
    for (let i = 0; i < k; i++) {
      h += turn / k;
      xs.push(xs[xs.length - 1] + Math.cos(h) * DS);
      ys.push(ys[ys.length - 1] + Math.sin(h) * DS);
      hwT.push(hw);
      flT.push(flow);
    }
    hwT[0] = hwT[1];
    flT[0] = flT[1];
  };
  const zone = (name: string, build: () => void) => {
    const s0 = (xs.length - 1) * DS;
    build();
    zones.push({ name, s0, s1: (xs.length - 1) * DS });
  };
  const sgn = () => (rng() < 0.5 ? -1 : 1);
  const deg = (d: number) => (d * Math.PI) / 180;
  const j = (v: number, a: number) => v + (rng() - 0.5) * 2 * a;

  const s = sgn();
  zone('start', () => piece(j(45, 3), deg(10) * s, 6.0, 1.3));
  zone('turns', () => {
    piece(j(26, 2), deg(j(75, 6)) * s, 4.8, 1.6);
    piece(12, 0, 4.8, 1.6);
    piece(j(30, 2), -deg(j(95, 6)) * s, 4.8, 1.6);
    piece(10, 0, 4.8, 1.6);
    piece(j(26, 2), deg(j(80, 6)) * s, 4.8, 1.6);
    piece(8, 0, 4.8, 1.6);
  });
  zone('narrow', () => {
    piece(12, 0, 3.7, 2.1);
    piece(22, deg(32) * -s, 3.7, 2.2);
    piece(22, deg(32) * s, 3.7, 2.2);
    piece(6, 0, 4.5, 1.8);
  });
  const rockS0 = (xs.length - 1) * DS;
  zone('rocks', () => piece(72, deg(j(-14, 8)) * s, 6.9, 1.5));
  const movS0 = (xs.length - 1) * DS;
  zone('moving', () => {
    piece(48, deg(12) * s, 6.5, 1.5);
    piece(48, deg(-14) * s, 6.5, 1.5);
  });
  const whS0 = (xs.length - 1) * DS;
  zone('whirl', () => piece(51, deg(j(20, 6)) * s, 7.2, 1.4));
  const finS0 = (xs.length - 1) * DS;
  zone('finish', () => piece(30, 0, 6.0, 1.2));
  piece(42, 0, 6.0, 0.8);

  const n = xs.length;
  const c: Course = {
    seed,
    n,
    ds: DS,
    len: (n - 1) * DS,
    finishS: finS0 + 24,
    px: Float64Array.from(xs),
    py: Float64Array.from(ys),
    tx: new Float64Array(n),
    ty: new Float64Array(n),
    hw: new Float64Array(n),
    flow: new Float64Array(n),
    sa: new Float64Array(n),
    nOb: 0,
    obK: new Uint8Array(48),
    ob: new Float64Array(48 * OB_STRIDE),
    obS: new Float64Array(48),
    obSp: new Uint8Array(48),
    spL: new Uint8Array(n),
    spR: new Uint8Array(n),
    nWh: 0,
    wh: new Float64Array(4 * 4),
    cpS: new Float64Array(4),
    cpIdx: new Int32Array(4),
    zones,
  };
  // làm mượt độ rộng + dòng chảy giữa các đoạn
  for (let i = 0; i < n; i++) {
    let sh = 0;
    let sf = 0;
    let cnt = 0;
    for (let d = -3; d <= 3; d++) {
      const q = Math.max(0, Math.min(n - 1, i + d));
      sh += hwT[q];
      sf += flT[q];
      cnt++;
    }
    c.hw[i] = sh / cnt;
    c.flow[i] = sf / cnt;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.min(i, n - 2);
    const dx = c.px[a + 1] - c.px[a];
    const dy = c.py[a + 1] - c.py[a];
    const l = Math.hypot(dx, dy) || 1;
    c.tx[i] = dx / l;
    c.ty[i] = dy / l;
    c.sa[i] = i * DS;
  }

  const at = (sPos: number) => Math.max(0, Math.min(n - 2, Math.round(sPos / DS)));
  const place = (sPos: number, lat: number): [number, number] => {
    const i = at(sPos);
    return [c.px[i] - c.ty[i] * lat, c.py[i] + c.tx[i] * lat];
  };
  const addOb = (kind: number, sPos: number, f: number[], spiky = kind !== OB_ROCK) => {
    const i = c.nOb++;
    c.obSp[i] = spiky ? 1 : 0;
    c.obK[i] = kind;
    c.obS[i] = sPos;
    for (let q = 0; q < f.length; q++) c.ob[i * OB_STRIDE + q] = f[q];
  };

  // chướng ngại tĩnh: đá
  {
    const zr = zones.find((z) => z.name === 'rocks')!;
    const cnt = 7;
    for (let i = 0; i < cnt; i++) {
      const sPos = rockS0 + 6 + (i * (zr.s1 - zr.s0 - 12)) / (cnt - 1);
      const hwHere = c.hw[at(sPos)];
      const side = i % 2 ? 1 : -1;
      const lat = side * (0.15 + rng() * 0.5) * hwHere;
      const [x, y] = place(sPos, lat);
      addOb(OB_ROCK, sPos, [x, y, 0.9 + rng() * 0.4], i % 2 === 0); // chẵn: MÌN GAI, lẻ: đá trơn
    }
  }
  // chướng ngại động
  {
    const sl = (sPos: number, P: number, ph: number, A: number) => {
      const i = at(sPos);
      const [x, y] = place(sPos, 0);
      addOb(OB_SLIDER, sPos, [x, y, -c.ty[i], c.tx[i], c.tx[i], c.ty[i], 1.5, A, P, ph, 0.7]);
    };
    const hw1 = c.hw[at(movS0 + 12)];
    sl(movS0 + 12, 480, 0, hw1 - 1.7);
    // cánh tay quay
    {
      const sPos = movS0 + 32;
      const [x, y] = place(sPos, 0);
      addOb(OB_ARM, sPos, [x, y, c.hw[at(sPos)] * 0.72, (0.011 * (rng() < 0.5 ? 1 : -1)), rng() * TAU, 0.7]);
    }
    // hai cổng đóng mở xen kẽ
    const gate = (sPos: number, side: number, ph: number) => {
      const i = at(sPos);
      const hwH = c.hw[i];
      const [x, y] = place(sPos, side * hwH);
      // dir = chỉ ngang qua sông, từ bờ vào
      addOb(OB_GATE, sPos, [x, y, c.ty[i] * side, -c.tx[i] * side, hwH * 1.35, 280, 0.5, ph, 0.7]);
    };
    gate(movS0 + 52, 1, 0);
    gate(movS0 + 60, -1, 140);
    sl(movS0 + 78, 420, 60, c.hw[at(movS0 + 78)] - 1.7);
    sl(movS0 + 88, 420, 270, c.hw[at(movS0 + 88)] - 1.7);
  }
  // xoáy nước
  {
    const w1 = place(whS0 + 14, 0.8);
    const w2 = place(whS0 + 36, -1.0);
    const dir = rng() < 0.5 ? 1 : -1;
    c.nWh = 2;
    c.wh.set([w1[0], w1[1], 7.5, 2.4 * dir, w2[0], w2[1], 7.5, -2.4 * dir]);
    const [rx, ry] = place(whS0 + 25, 0);
    addOb(OB_ROCK, whS0 + 25, [rx, ry, 1.3], true);
  }
  // gai ở bờ
  {
    const zn = (name: string) => zones.find((z) => z.name === name)!;
    const mark = (z: Zone, pad: number, f: (i: number) => void) => {
      for (let i = Math.max(1, Math.round((z.s0 + pad) / DS)); i < Math.min(n - 1, Math.round((z.s1 - pad) / DS)); i++) f(i);
    };
    // khúc cua gắt: gai ở bờ NGOÀI của mỗi khúc cua
    mark(zn('turns'), 3, (i) => {
      const cr = c.tx[i - 1] * c.ty[i] - c.ty[i - 1] * c.tx[i];
      if (cr > 0.012) c.spR[i] = 1;
      else if (cr < -0.012) c.spL[i] = 1;
    });
    // lối hẹp: gai hai bên
    mark(zn('narrow'), 6, (i) => {
      c.spL[i] = 1;
      c.spR[i] = 1;
    });
    // vùng đá: gai xen kẽ từng đoạn 15m
    mark(zn('rocks'), 4, (i) => {
      const blk = Math.floor((i * DS) / 15);
      if (blk % 2) c.spL[i] = 1;
      else c.spR[i] = 1;
    });
    // xoáy nước kéo bè vào bờ gai
    mark(zn('whirl'), 6, (i) => {
      c.spL[i] = 1;
      c.spR[i] = 1;
    });
  }
  // checkpoint ở 0%, 25%, 50%, 75% đường đua
  for (let k = 0; k < 4; k++) {
    const sPos = (c.finishS * k) / 4 + (k === 0 ? 6 : 0);
    c.cpS[k] = sPos;
    c.cpIdx[k] = at(sPos);
  }
  return c;
}

/** tính 2 đầu mút + bán kính (capsule) của chướng ngại i tại tick */
export function obEval(c: Course, i: number, tick: number, out: Float64Array): void {
  const f = c.ob;
  const o = i * OB_STRIDE;
  switch (c.obK[i]) {
    case OB_ROCK:
      out[0] = out[2] = f[o];
      out[1] = out[3] = f[o + 1];
      out[4] = f[o + 2];
      break;
    case OB_SLIDER: {
      const off = f[o + 7] * Math.sin((TAU * (tick + f[o + 9])) / f[o + 8]);
      const cx = f[o] + f[o + 2] * off;
      const cy = f[o + 1] + f[o + 3] * off;
      const hl = f[o + 6];
      out[0] = cx - f[o + 4] * hl;
      out[1] = cy - f[o + 5] * hl;
      out[2] = cx + f[o + 4] * hl;
      out[3] = cy + f[o + 5] * hl;
      out[4] = f[o + 10];
      break;
    }
    case OB_ARM: {
      const a = f[o + 4] + f[o + 3] * tick;
      const dx = Math.cos(a) * f[o + 2];
      const dy = Math.sin(a) * f[o + 2];
      out[0] = f[o] - dx;
      out[1] = f[o + 1] - dy;
      out[2] = f[o] + dx;
      out[3] = f[o + 1] + dy;
      out[4] = f[o + 5];
      break;
    }
    default: {
      const e = gateExt(f[o + 5], f[o + 6], f[o + 7], tick);
      out[0] = f[o];
      out[1] = f[o + 1];
      out[2] = f[o] + f[o + 2] * f[o + 4] * e;
      out[3] = f[o + 1] + f[o + 3] * f[o + 4] * e;
      out[4] = f[o + 8];
    }
  }
}

/** độ vươn của cổng 0..1 */
export function gateExt(P: number, duty: number, ph: number, tick: number): number {
  const u = (((tick + ph) % P) + P) % P / P;
  if (u >= duty) return 0;
  return Math.min(1, u / 0.1, (duty - u) / 0.1);
}

/** cảnh báo 0..1 của chướng ngại động: cổng sắp đóng nhấp nháy trước ~0.75s */
export function obWarn(c: Course, i: number, tick: number): number {
  if (c.obK[i] !== OB_GATE) return 0;
  const o = i * OB_STRIDE;
  const P = c.ob[o + 5];
  const ph = c.ob[o + 7];
  const u = ((((tick + ph) % P) + P) % P) / P;
  const duty = c.ob[o + 6];
  if (u < duty) return 0;
  const toClose = (1 - u) * P; // tick còn lại tới lúc bắt đầu đóng (u quay về 0)
  return toClose < 45 ? 1 - toClose / 45 : 0;
}

/* ---------------- tìm đoạn gần nhất ---------------- */
let lo_i = 0;
let lo_u = 0;
let lo_lat = 0;
let lo_s = 0;

/** gần nhất trên đường tâm quanh gợi ý hint; kết quả ở các biến lo_* (không cấp phát) */
function locate(c: Course, x: number, y: number, hint: number): void {
  const a0 = Math.max(0, hint - 3);
  const a1 = Math.min(c.n - 2, hint + 4);
  let best = 1e18;
  for (let i = a0; i <= a1; i++) {
    const ax = c.px[i];
    const ay = c.py[i];
    const dx = c.px[i + 1] - ax;
    const dy = c.py[i + 1] - ay;
    const l2 = dx * dx + dy * dy;
    let u = ((x - ax) * dx + (y - ay) * dy) / l2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + dx * u - x;
    const qy = ay + dy * u - y;
    const d2 = qx * qx + qy * qy;
    if (d2 < best) {
      best = d2;
      lo_i = i;
      lo_u = u;
    }
  }
  const i = lo_i;
  const qx = c.px[i] + (c.px[i + 1] - c.px[i]) * lo_u;
  const qy = c.py[i] + (c.py[i + 1] - c.py[i]) * lo_u;
  lo_lat = (x - qx) * -c.ty[i] + (y - qy) * c.tx[i];
  lo_s = c.sa[i] + lo_u * c.ds;
}

/* ---------------- khởi tạo / xì ---------------- */
export function initState(c: Course, S: Float64Array): void {
  setAtCheckpoint(c, S, 0);
  S[S_HP] = 100;
  S[S_SINK] = 0;
  S[S_INV] = 0;
  S[S_CP] = 0;
  S[S_PROG] = c.cpS[0];
  S[S_FIN] = 0;
  S[S_HITV] = 0;
  S[S_HITS] = 0;
  for (let j = 0; j < 4; j++) {
    S[sHold(j)] = 0;
    S[sAim(j)] = Math.round(wrapPi(S[S_A] + Math.PI) * 1000);
    S[sGas(j)] = 1;
  }
}

function setAtCheckpoint(c: Course, S: Float64Array, k: number): void {
  const i = c.cpIdx[k];
  S[S_X] = c.px[i];
  S[S_Y] = c.py[i];
  S[S_A] = Math.atan2(c.ty[i], c.tx[i]);
  S[S_VX] = S[S_VY] = S[S_W] = 0;
  S[S_SEG] = i;
  S[S_S] = c.sa[i];
}

/** sự kiện của một chỗ ngồi: pi > 0 = GIỮ xì theo hướng ai/1000 rad (thế giới); pi = 0 = thả */
export function applyHold(S: Float64Array, seat: number, ai: number, pi: number): void {
  S[sHold(seat)] = pi > 0 ? 1 : 0;
  S[sAim(seat)] = ai;
}

/**
 * Mỗi tick: người đang giữ đẩy bè NGƯỢC hướng xì, ngay tại chỗ ngồi (Δv + mô-men xoắn) và hao khí;
 * hết khí thì lực yếu dần rồi tắt. Buông thì khí hồi.
 */
export function thrustStep(S: Float64Array, slots: ArrayLike<number>, n: number): void {
  const sink = S[S_SINK] > 0;
  const cs = Math.cos(S[S_A]);
  const sn = Math.sin(S[S_A]);
  for (let j = 0; j < n; j++) {
    const gi = sGas(j);
    let g = S[gi];
    if (S[sHold(j)] > 0 && !sink) {
      if (g > 0) {
        const f = g >= GAS_FADE ? 1 : g / GAS_FADE;
        const a = S[sAim(j)] / 1000;
        const k = THRUST * DT * f;
        const dvx = -Math.cos(a) * k;
        const dvy = -Math.sin(a) * k;
        const slot = slots[j];
        const rx = cs * SEAT_X[slot] - sn * SEAT_Y[slot];
        const ry = sn * SEAT_X[slot] + cs * SEAT_Y[slot];
        S[S_VX] += dvx;
        S[S_VY] += dvy;
        S[S_W] += (rx * dvy - ry * dvx) * TQ;
        g -= GAS_DRAIN * DT;
        S[gi] = g < 0 ? 0 : g;
      }
    } else if (g < 1) {
      g += GAS_REGEN * DT;
      S[gi] = g > 1 ? 1 : g;
    }
  }
}

/** vị trí thế giới của chỗ ngồi (ghi vào out[0..1]) */
export function seatWorld(S: Float64Array, slot: number, out: Float64Array): void {
  const cs = Math.cos(S[S_A]);
  const sn = Math.sin(S[S_A]);
  out[0] = S[S_X] + cs * SEAT_X[slot] - sn * SEAT_Y[slot];
  out[1] = S[S_Y] + sn * SEAT_X[slot] + cs * SEAT_Y[slot];
}

/* ---------------- va chạm ---------------- */
export const SPIKE_DMG = 12;
export const SPIKE_INV = 30;
export const SPIKE_DEPTH = 0.8; // gai nhô vào lòng sông

function contact(S: Float64Array, cx: number, cy: number, nx: number, ny: number, vox: number, voy: number, spike: boolean): void {
  const rx = cx - S[S_X];
  const ry = cy - S[S_Y];
  const vpx = S[S_VX] - S[S_W] * ry;
  const vpy = S[S_VY] + S[S_W] * rx;
  const rel = (vpx - vox) * nx + (vpy - voy) * ny;
  let hit = 0;
  if (rel < 0) {
    const rn = rx * ny - ry * nx;
    const j = (-(1 + RESTITUTION) * rel) / (1 + (rn * rn) / INERTIA);
    S[S_VX] += j * nx;
    S[S_VY] += j * ny;
    S[S_W] += (rn * j) / INERTIA;
    hit = -rel;
  }
  if (S[S_INV] > 0 || S[S_FIN] !== 0 || S[S_SINK] > 0) return;
  let dmg = 0;
  if (spike) {
    // chạm gai là mất độ bền, kể cả cọ nhẹ
    dmg = SPIKE_DMG + hit * 2;
    S[S_INV] = SPIKE_INV;
  } else if (hit > HIT_V) {
    dmg = (hit - HIT_V) * DMG_K + DMG_B;
    S[S_INV] = HIT_INV;
  } else return;
  S[S_HP] -= dmg;
  S[S_HITV] = hit + (spike ? 3 : 0);
  S[S_HITS] += 1;
  if (S[S_HP] <= 0) {
    S[S_HP] = 0;
    S[S_SINK] = SINK_TICKS;
  }
}

const ev0 = new Float64Array(5);
const ev1 = new Float64Array(5);

/** một bước 1/60s: trạng thái ở đầu tick `tick` -> đầu tick tick+1 (sự kiện xì của tick này đã được áp trước đó) */
export function stepRaft(c: Course, S: Float64Array, tick: number): void {
  if (S[S_INV] > 0) S[S_INV] -= 1;
  if (S[S_SINK] > 0) {
    S[S_SINK] -= 1;
    S[S_VX] *= 0.93;
    S[S_VY] *= 0.93;
    S[S_W] *= 0.93;
    S[S_X] += S[S_VX] * DT;
    S[S_Y] += S[S_VY] * DT;
    S[S_A] += S[S_W] * DT;
    if (S[S_SINK] <= 0) {
      setAtCheckpoint(c, S, S[S_CP]);
      S[S_HP] = 100;
      S[S_INV] = RESPAWN_INV;
    }
    return;
  }

  // dòng chảy tại vị trí hiện tại
  locate(c, S[S_X], S[S_Y], S[S_SEG] | 0);
  {
    const i = lo_i;
    const hwH = c.hw[i] + (c.hw[i + 1] - c.hw[i]) * lo_u;
    const fl = (c.flow[i] + (c.flow[i + 1] - c.flow[i]) * lo_u) * (1 - 0.45 * Math.min(1, (lo_lat / hwH) * (lo_lat / hwH)));
    const fx = c.tx[i] * fl;
    const fy = c.ty[i] * fl;
    S[S_VX] += (fx - S[S_VX]) * KD;
    S[S_VY] += (fy - S[S_VY]) * KD;
    // sóng làm bè lắc nhẹ, hơi khó đoán (xác định theo tick + vị trí)
    S[S_W] += 0.32 * Math.sin(tick * 0.047 + lo_s * 0.23) * DT;
    S[S_W] *= KW;
  }
  // xoáy nước
  for (let q = 0; q < c.nWh; q++) {
    const wx = c.wh[q * 4];
    const wy = c.wh[q * 4 + 1];
    const R = c.wh[q * 4 + 2];
    const str = c.wh[q * 4 + 3];
    const dx = S[S_X] - wx;
    const dy = S[S_Y] - wy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R && d > 1e-3) {
      const f = 1 - d / R;
      const tx = -dy / d;
      const ty = dx / d;
      const sg = str > 0 ? 1 : -1;
      S[S_VX] += (tx * str * f - (dx / d) * Math.abs(str) * 0.3 * f) * DT;
      S[S_VY] += (ty * str * f - (dy / d) * Math.abs(str) * 0.3 * f) * DT;
      S[S_W] += sg * 1.8 * f * DT;
    }
  }
  S[S_X] += S[S_VX] * DT;
  S[S_Y] += S[S_VY] * DT;
  S[S_A] += S[S_W] * DT;

  const cs = Math.cos(S[S_A]);
  const sn = Math.sin(S[S_A]);
  // bờ sông
  for (let q = 0; q < 4; q++) {
    const cx = S[S_X] + cs * CIRC_X[q] - sn * CIRC_Y[q];
    const cy = S[S_Y] + sn * CIRC_X[q] + cs * CIRC_Y[q];
    locate(c, cx, cy, S[S_SEG] | 0);
    const i = lo_i;
    const hwH = c.hw[i] + (c.hw[i + 1] - c.hw[i]) * lo_u;
    const spk = (lo_lat >= 0 ? c.spL[i] | c.spL[i + 1] : c.spR[i] | c.spR[i + 1]) === 1;
    const over = Math.abs(lo_lat) + CIRC_R - hwH + (spk ? SPIKE_DEPTH : 0);
    if (over > 0) {
      // pháp tuyến hướng vào lòng sông
      const sgl = lo_lat >= 0 ? 1 : -1;
      const nx = c.ty[i] * sgl;
      const ny = -c.tx[i] * sgl;
      S[S_X] += nx * over;
      S[S_Y] += ny * over;
      contact(S, cx - nx * CIRC_R, cy - ny * CIRC_R, nx, ny, 0, 0, spk);
    }
  }
  // chướng ngại
  const sNow = S[S_S];
  for (let i = 0; i < c.nOb; i++) {
    if (Math.abs(c.obS[i] - sNow) > 14) continue;
    obEval(c, i, tick, ev0);
    obEval(c, i, tick + 1, ev1);
    const abx = ev0[2] - ev0[0];
    const aby = ev0[3] - ev0[1];
    const l2 = abx * abx + aby * aby;
    const rr = CIRC_R + ev0[4];
    for (let q = 0; q < 4; q++) {
      const cx = S[S_X] + cs * CIRC_X[q] - sn * CIRC_Y[q];
      const cy = S[S_Y] + sn * CIRC_X[q] + cs * CIRC_Y[q];
      let u = l2 > 1e-9 ? ((cx - ev0[0]) * abx + (cy - ev0[1]) * aby) / l2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ev0[0] + abx * u;
      const qy = ev0[1] + aby * u;
      const dx = cx - qx;
      const dy = cy - qy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      let nx = 1;
      let ny = 0;
      if (d > 1e-6) {
        nx = dx / d;
        ny = dy / d;
      }
      const pen = rr - d;
      S[S_X] += nx * pen;
      S[S_Y] += ny * pen;
      const vax = (ev1[0] - ev0[0]) * TICK_HZ;
      const vay = (ev1[1] - ev0[1]) * TICK_HZ;
      const vbx = (ev1[2] - ev0[2]) * TICK_HZ;
      const vby = (ev1[3] - ev0[3]) * TICK_HZ;
      contact(S, qx + nx * ev0[4], qy + ny * ev0[4], nx, ny, vax + (vbx - vax) * u, vay + (vby - vay) * u, c.obSp[i] === 1);
    }
  }

  // tiến độ + checkpoint + đích
  locate(c, S[S_X], S[S_Y], S[S_SEG] | 0);
  S[S_SEG] = lo_i;
  S[S_S] = lo_s;
  if (lo_s > S[S_PROG]) S[S_PROG] = lo_s;
  while (S[S_CP] < 3 && S[S_PROG] >= c.cpS[(S[S_CP] | 0) + 1]) S[S_CP] += 1;
  if (S[S_FIN] === 0 && lo_s >= c.finishS) S[S_FIN] = tick + 1;
  // hết sông: chặn lại cho khỏi trôi ra ngoài
  if (lo_i >= c.n - 3) {
    S[S_VX] *= 0.9;
    S[S_VY] *= 0.9;
  }
}

/* ---------------- RaftSim: vòng đệm + nhật ký + rollback ---------------- */
export class RaftSim {
  readonly S = new Float64Array(NS);
  readonly base = new Float64Array(NS);
  baseTick = 0;
  cur = 0;
  private ringLo = 0;
  private readonly ring: Float64Array;
  ne = 0;
  readonly eT: Int32Array;
  readonly eSeat: Uint8Array;
  readonly eA: Int32Array;
  readonly eP: Int32Array;
  readonly eN: Int32Array;
  readonly slots: Uint8Array;

  constructor(
    readonly c: Course,
    slots: ArrayLike<number>,
    readonly R = 16,
    readonly E = 40,
  ) {
    this.slots = Uint8Array.from(slots as ArrayLike<number>);
    this.ring = new Float64Array(R * NS);
    this.eT = new Int32Array(E);
    this.eSeat = new Uint8Array(E);
    this.eA = new Int32Array(E);
    this.eP = new Int32Array(E);
    this.eN = new Int32Array(E);
    initState(c, this.S);
    this.base.set(this.S);
  }

  private stepOne(): void {
    const S = this.S;
    const cur = this.cur;
    const off = (cur % this.R) * NS;
    for (let j = 0; j < NS; j++) this.ring[off + j] = S[j];
    for (let i = 0; i < this.ne; i++) {
      const t = this.eT[i];
      if (t > cur) break;
      if (t === cur) applyHold(S, this.eSeat[i], this.eA[i], this.eP[i]);
    }
    thrustStep(S, this.slots, this.slots.length);
    stepRaft(this.c, S, cur);
    this.cur = cur + 1;
  }

  advanceTo(t: number): void {
    while (this.cur < t) this.stepOne();
  }

  /** trạng thái ở đầu tick k (k trong vòng đệm) chép vào out; trả về false nếu đã bị ghi đè */
  stateAt(k: number, out: Float64Array): boolean {
    if (k === this.cur) {
      out.set(this.S);
      return true;
    }
    if (k > this.cur || k < this.ringLo || k < this.cur - this.R) return false;
    const off = (k % this.R) * NS;
    for (let j = 0; j < NS; j++) out[j] = this.ring[off + j];
    return true;
  }

  private rollback(k: number): void {
    const target = this.cur;
    if (k >= target) return;
    if (k >= this.ringLo && k >= target - this.R) {
      const off = (k % this.R) * NS;
      for (let j = 0; j < NS; j++) this.S[j] = this.ring[off + j];
      this.cur = k;
    } else {
      this.S.set(this.base);
      this.cur = this.baseTick;
      this.ringLo = this.baseTick;
    }
    this.advanceTo(target);
  }

  private findEvent(seat: number, n: number): number {
    for (let i = 0; i < this.ne; i++) if (this.eSeat[i] === seat && this.eN[i] === n) return i;
    return -1;
  }

  private removeAt(i: number): void {
    for (let q = i; q < this.ne - 1; q++) {
      this.eT[q] = this.eT[q + 1];
      this.eSeat[q] = this.eSeat[q + 1];
      this.eA[q] = this.eA[q + 1];
      this.eP[q] = this.eP[q + 1];
      this.eN[q] = this.eN[q + 1];
    }
    this.ne--;
  }

  private insertSorted(tick: number, seat: number, a: number, p: number, n: number): void {
    if (this.ne >= this.E) this.removeAt(0);
    let i = this.ne;
    while (
      i > 0 &&
      (this.eT[i - 1] > tick || (this.eT[i - 1] === tick && (this.eSeat[i - 1] > seat || (this.eSeat[i - 1] === seat && this.eN[i - 1] > n))))
    )
      i--;
    for (let q = this.ne; q > i; q--) {
      this.eT[q] = this.eT[q - 1];
      this.eSeat[q] = this.eSeat[q - 1];
      this.eA[q] = this.eA[q - 1];
      this.eP[q] = this.eP[q - 1];
      this.eN[q] = this.eN[q - 1];
    }
    this.eT[i] = tick;
    this.eSeat[i] = seat;
    this.eA[i] = a;
    this.eP[i] = p;
    this.eN[i] = n;
    this.ne++;
  }

  /** chèn (hoặc cập nhật) sự kiện xì; tick cũ hơn hiện tại -> rollback + mô phỏng lại. Trả về true nếu có đổi */
  setEvent(tick: number, seat: number, a: number, p: number, n: number): boolean {
    const f = this.findEvent(seat, n);
    let from = tick;
    if (f >= 0) {
      if (this.eT[f] === tick && this.eA[f] === a && this.eP[f] === p) return false;
      from = Math.min(from, this.eT[f]);
      this.removeAt(f);
    }
    this.insertSorted(tick, seat, a, p, n);
    if (from < this.cur) this.rollback(from);
    return true;
  }

  removeEvent(seat: number, n: number): boolean {
    const f = this.findEvent(seat, n);
    if (f < 0) return false;
    const t = this.eT[f];
    this.removeAt(f);
    if (t < this.cur) this.rollback(t);
    return true;
  }

  hasEvent(seat: number, n: number): boolean {
    return this.findEvent(seat, n) >= 0;
  }

  /** bỏ sự kiện cũ hơn tick (đã nằm trong trạng thái cuối cùng) */
  prune(tick: number): void {
    let k = 0;
    while (k < this.ne && this.eT[k] < tick) k++;
    if (k > 0) {
      for (let q = 0; q < this.ne - k; q++) {
        this.eT[q] = this.eT[q + k];
        this.eSeat[q] = this.eSeat[q + k];
        this.eA[q] = this.eA[q + k];
        this.eP[q] = this.eP[q + k];
        this.eN[q] = this.eN[q + k];
      }
      this.ne -= k;
    }
  }

  /**
   * (client) nhận trạng thái CUỐI CÙNG của server ở đầu tick `tick`.
   * Nếu khớp với dự đoán trong vòng đệm (trong sai số) thì giữ nguyên; lệch thì thay + mô phỏng lại. Trả về true nếu có sửa.
   */
  setBase(tick: number, st: ArrayLike<number>): boolean {
    for (let j = 0; j < NS; j++) this.base[j] = st[j];
    this.baseTick = tick;
    this.prune(tick);
    if (tick >= this.cur) {
      this.S.set(this.base);
      this.cur = tick;
      this.ringLo = tick;
      return true;
    }
    if (tick < this.ringLo || tick < this.cur - this.R) return false;
    const off = (tick % this.R) * NS;
    let same = true;
    for (let j = 0; j < NS && same; j++) {
      const d = Math.abs(this.ring[off + j] - this.base[j]);
      if (j === S_PROG || j === S_S || j === S_HITV) continue;
      if (j >= S_SEAT0) {
        // giữ/thả + hướng phải khớp; khí cho sai số nhỏ
        const kind = (j - S_SEAT0) % 3;
        if (kind === 2 ? d > 0.02 : d > 0.5) same = false;
      } else if (j === S_HP || j === S_INV) {
        if (d > 0.6) same = false;
      } else if (d > (j <= S_A ? 4e-3 : j <= S_W ? 8e-3 : 0.5)) same = false;
    }
    if (same) return false;
    for (let j = 0; j < NS; j++) this.ring[off + j] = this.base[j];
    this.rollback(tick);
    return true;
  }
}

/** băm trạng thái (làm tròn) để so sánh trong test */
export function stateHash(S: ArrayLike<number>): number {
  let h = 2166136261 >>> 0;
  for (let j = 0; j < NS; j++) {
    const v = Math.round(S[j] * 1e4);
    h ^= v & 0xffffffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (v / 4294967296) | 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const wrapPi = (a: number) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
