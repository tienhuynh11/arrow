/**
 * SÀN LÀ DUNG NHAM: vật lý + lịch bục dùng chung cho server (chốt kết quả) và client (dự đoán vị trí của chính mình).
 * Toạ độ: x ngang, y = hướng tiến của khóa học, z = độ cao. Bục chỉ "đỡ" từ trên xuống (nhảy xuyên từ dưới lên được).
 * Mọi thứ động (bục di chuyển, biến mất, dung nham) là hàm của thời gian → client tự tính theo giờ server, không tốn băng thông.
 */

export const SPEED = 8.5;
export const GRAVITY = 34;
export const JUMP_V = 13;
/** bán kính chân khi đứng lên bục */
export const FOOT = 0.3;
export const COYOTE = 0.1;
/** dung sai "bước lên" khi bục cao hơn chân một chút */
const STEP_UP = 0.35;
/** bục SỤP: sau khi bị giẫm thì còn đứng được thêm … giây rồi biến mất … giây rồi hiện lại */
export const COLLAPSE_DELAY = 0.7;
export const COLLAPSE_GONE = 3.2;

/** 0 thường · 1 sụp · 2 trơn · 3 biến mất theo chu kỳ · 4 di chuyển */
export type LvKind = 0 | 1 | 2 | 3 | 4;

export interface LvPlat {
  /** tâm */
  x: number;
  y: number;
  /** độ cao mặt trên */
  z: number;
  w: number;
  d: number;
  k: LvKind;
  /** bục di chuyển: trục (0 = x, 1 = y), biên độ, tần số góc, pha */
  ax?: 0 | 1;
  amp?: number;
  f?: number;
  ph?: number;
  /** bục biến mất: chu kỳ và thời gian hiện (giây), pha dùng chung `ph` */
  per?: number;
  on?: number;
  /** điểm hồi sinh */
  cp?: boolean;
  goal?: boolean;
}

export interface LvLava {
  z0: number;
  /** tổng độ cao dung nham dâng được tới hết thời gian */
  span: number;
  /** giây */
  dur: number;
  pow: number;
}

export interface LvConfig {
  plats: LvPlat[];
  lava: LvLava;
  /** độ cao đích */
  top: number;
  endsAt: number;
  speed: number;
  spawns: Record<string, [number, number]>;
}

export interface LvBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** bục đang đứng (-1 = đang ở trên không) */
  on: number;
  /** giây kể từ lúc rời bục */
  air: number;
}

export const newBody = (x = 0, y = 0, z = 0): LvBody => ({ x, y, z, vx: 0, vy: 0, vz: 0, on: -1, air: 0 });

/** độ cao dung nham tại giây t (so với lúc bắt đầu): chậm lúc đầu, nhanh dần */
export const lavaZ = (l: LvLava, t: number) => l.z0 + l.span * Math.pow(Math.max(0, Math.min(1, t / l.dur)), l.pow);

/** tâm bục tại giây t */
export function platCenter(p: LvPlat, t: number, out: [number, number] = [0, 0]): [number, number] {
  if (p.k === 4) {
    const o = (p.amp ?? 0) * Math.sin((p.f ?? 1) * t + (p.ph ?? 0));
    out[0] = p.x + (p.ax ? 0 : o);
    out[1] = p.y + (p.ax ? o : 0);
  } else {
    out[0] = p.x;
    out[1] = p.y;
  }
  return out;
}

/** bục biến mất: đang hiện? */
export const vanishOn = (p: LvPlat, t: number) => (((t + (p.ph ?? 0)) % (p.per ?? 4)) + (p.per ?? 4)) % (p.per ?? 4) < (p.on ?? 2.5);

/** bục sụp: còn đỡ được không (trig = giây lúc bị giẫm, Infinity = chưa) */
export const collapseSolid = (trig: number, t: number) => t < trig + COLLAPSE_DELAY || t >= trig + COLLAPSE_DELAY + COLLAPSE_GONE;

export function platSolid(p: LvPlat, trig: number, t: number) {
  if (p.k === 1) return collapseSolid(trig, t);
  if (p.k === 3) return vanishOn(p, t);
  return true;
}

const tmp: [number, number] = [0, 0];

/**
 * Một bước vật lý. `t` = giây từ lúc ván bắt đầu. Trả về true nếu vừa nhảy.
 * Bục trơn: tăng/giảm tốc rất chậm → trượt.
 */
export function stepLava(
  plats: LvPlat[],
  trig: ArrayLike<number>,
  b: LvBody,
  dx: number,
  dy: number,
  jump: boolean,
  t: number,
  dt: number,
  speed = SPEED,
): boolean {
  if (dt <= 0) return false;
  const under = b.on >= 0 ? plats[b.on] : null;
  if (under && under.k === 4) {
    const a = platCenter(under, t, [0, 0]);
    const o = platCenter(under, t - dt, tmp);
    b.x += a[0] - o[0];
    b.y += a[1] - o[1];
  }

  const len = Math.hypot(dx, dy);
  const tx = len > 0 ? (dx / len) * speed : 0;
  const ty = len > 0 ? (dy / len) * speed : 0;
  const ice = !!under && under.k === 2;
  const accel = b.on >= 0 ? (ice ? (len > 0 ? 9 : 4.5) : 70) : 16;
  let ax = tx - b.vx;
  let ay = ty - b.vy;
  const m = Math.hypot(ax, ay);
  const cap = accel * dt;
  if (m > cap) {
    ax = (ax / m) * cap;
    ay = (ay / m) * cap;
  }
  b.vx += ax;
  b.vy += ay;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  let jumped = false;
  if (jump && (b.on >= 0 || b.air < COYOTE)) {
    b.vz = JUMP_V;
    b.on = -1;
    b.air = COYOTE;
    jumped = true;
  }

  const pz = b.z;
  b.vz = Math.max(-45, b.vz - GRAVITY * dt);
  b.z += b.vz * dt;

  let land = -1;
  let landTop = -1e9;
  if (b.vz <= 0) {
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.z > landTop && pz >= p.z - STEP_UP && b.z <= p.z) {
        const c = platCenter(p, t, tmp);
        if (Math.abs(b.x - c[0]) <= p.w / 2 + FOOT && Math.abs(b.y - c[1]) <= p.d / 2 + FOOT && platSolid(p, trig[i], t)) {
          land = i;
          landTop = p.z;
        }
      }
    }
  }
  if (land >= 0) {
    b.z = landTop;
    b.vz = 0;
    b.on = land;
    b.air = 0;
  } else {
    b.on = -1;
    b.air += dt;
  }
  return jumped;
}

/** trạng thái gói cờ trong gói vị trí */
export const F_STUN = 1;
export const F_OUT = 2;
export const F_FIN = 4;
export const F_GROUND = 8;
