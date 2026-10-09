/**
 * ĐẤU VẬT TRÊN NÓC NHÀ (rooftop) — hằng số + vật lý dùng chung giữa server (chốt) và client (dự đoán bản thân).
 * Hệ toạ độ: x ngang xe (phải = +x), y dọc xe (đầu xe = +y, đuôi xe mở = -y), z độ cao (mặt nóc xe z = 0).
 * yaw: hướng (sin yaw, cos yaw) trong mặt phẳng (x, y); yaw = 0 nhìn về đầu xe, yaw tăng = quay phải.
 */
export const HALF_W = 3.5; // nửa bề ngang nóc xe
export const RAIL_H = 0.85; // lan can thấp: nhảy qua được
export const SPEED = 4.8;
export const ACCEL = 20;
export const AIR_ACCEL = 3.2;
export const GRAVITY = 17;
export const JUMP_V = 6.4;
export const KILL_Z = -3.6; // rơi sâu hơn mức này = bị loại
export const TRUCK_V = 14; // tốc độ cảnh trôi (hình ảnh) — cũng là tốc độ tương đối của cầu thấp

export interface RtRail {
  /** -1 = mép trái, 1 = mép phải */
  s: -1 | 1;
  y0: number;
  y1: number;
}

export interface RtConfig {
  /** chiều dài nóc xe */
  L: number;
  rails: RtRail[];
  /** id -> [x, y, yaw] */
  spawns: Record<string, [number, number, number]>;
  endsAt: number;
  /** ms kể từ lúc bắt đầu: từ đây xe nghiêng/xóc mạnh dần */
  tiltAt: number;
}

export interface RtBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export const newBody = (x = 0, y = 0): RtBody => ({ x, y, z: 0, vx: 0, vy: 0, vz: 0 });

/* cờ trạng thái gửi trong gói vị trí */
export const F_GROUND = 1;
export const F_STUN = 2; // loạng choạng: điều khiển yếu
export const F_DOWN = 4; // ngã sõng soài
export const F_HOLD = 8; // đang túm người
export const F_HELD = 16; // đang bị túm
export const F_LIFT = 32; // đang bị nhấc bổng (bị người khác giơ lên đầu)
export const F_ANCHOR = 64; // đang bám lan can/mép xe
export const F_PUNCH = 128; // đang tung đấm
export const F_FALL = 256; // đang rơi khỏi xe
export const F_OUT = 512; // đã bị loại
export const F_THROWN = 1024; // đang bay vì bị quăng
export const F_LIFTING = 2048; // đang giơ người khác lên cao
export const F_REACH = 4096; // đang giơ tay tìm chỗ túm
export const F_WHIFF = 8192; // vừa đấm hụt

/** gia tốc ngang của xe (đung đưa) theo thời gian; 0 trước khi xe bắt đầu xóc mạnh */
export function swayAccel(cfg: { endsAt: number; tiltAt: number }, tMs: number): number {
  if (tMs < cfg.tiltAt) return 0;
  const k = Math.min(1, (tMs - cfg.tiltAt) / Math.max(1, cfg.endsAt - cfg.tiltAt));
  const amp = 2.2 + 7.3 * k;
  return amp * Math.sin((tMs / 1000) * ((Math.PI * 2) / 4.6));
}

/** vị trí (x,y) có nền xe đỡ không */
export function supported(cfg: { L: number }, x: number, y: number): boolean {
  return Math.abs(x) <= HALF_W && y >= -cfg.L / 2 && y <= cfg.L / 2;
}

/** lan can + tường buồng lái: chặn người đang ở thấp */
export function constrain(cfg: RtConfig, b: RtBody) {
  if (b.z < RAIL_H && b.z >= -0.01) {
    if (b.y > cfg.L / 2 - 0.35 && b.y < cfg.L / 2 + 1 && Math.abs(b.x) <= HALF_W + 0.3) {
      b.y = cfg.L / 2 - 0.35;
      if (b.vy > 0) b.vy *= -0.25;
    }
    for (const r of cfg.rails) {
      if (b.y < r.y0 - 0.2 || b.y > r.y1 + 0.2) continue;
      const edge = HALF_W - 0.2;
      if (r.s > 0 && b.x > edge && b.x < HALF_W + 0.8) {
        b.x = edge;
        if (b.vx > 0) b.vx *= -0.2;
      } else if (r.s < 0 && b.x < -edge && b.x > -HALF_W - 0.8) {
        b.x = -edge;
        if (b.vx < 0) b.vx *= -0.2;
      }
    }
  }
}

export interface StepOpts {
  /** nhân tốc độ tối đa (đang túm người = chậm) */
  speedMul?: number;
  /** nhân gia tốc */
  accelMul?: number;
  /** gia tốc ngoại lực (xe xóc, gió, phanh) */
  ax?: number;
  ay?: number;
  /** sàn trơn (phanh gấp) */
  slick?: boolean;
  /** không điều khiển được (ngã, bị túm, rơi) */
  noControl?: boolean;
  jump?: boolean;
}

/** một bước vật lý "mềm" của một người; trả true nếu vừa nhảy */
export function stepBody(cfg: RtConfig, b: RtBody, mx: number, my: number, dt: number, o: StepOpts = {}): boolean {
  const sup = supported(cfg, b.x, b.y);
  const ground = b.z <= 0.001 && sup && b.vz <= 0;
  const falling = !sup && b.z <= 0.05;
  let jumped = false;
  const m = Math.hypot(mx, my);
  if (m > 1) {
    mx /= m;
    my /= m;
  }
  const sp = SPEED * (o.speedMul ?? 1);
  const tx = o.noControl || falling ? 0 : mx * sp;
  const ty = o.noControl || falling ? 0 : my * sp;
  let a = ground ? ACCEL * (o.accelMul ?? 1) : AIR_ACCEL;
  if (o.slick && ground) a = 2.2;
  if (falling) a = 0;
  if (o.noControl) a = ground ? 6 : 0.4; // ngã: trượt chậm dần; đang bay thì giữ đà
  const dvx = tx - b.vx;
  const dvy = ty - b.vy;
  const dl = Math.hypot(dvx, dvy);
  const maxd = a * dt;
  if (dl > 1e-6) {
    const k = Math.min(1, maxd / dl);
    b.vx += dvx * k;
    b.vy += dvy * k;
  }
  if (ground || b.z > 0) {
    b.vx += (o.ax ?? 0) * dt;
    b.vy += (o.ay ?? 0) * dt;
  }
  if (o.jump && ground && !o.noControl) {
    b.vz = JUMP_V;
    jumped = true;
  }
  if (!ground || b.vz > 0) b.vz -= GRAVITY * dt;
  if (falling) {
    b.vy = Math.max(-13, b.vy - 25 * dt);
  }
  const sp2 = Math.hypot(b.vx, b.vy);
  if (sp2 > 16) {
    b.vx *= 16 / sp2;
    b.vy *= 16 / sp2;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.z <= 0 && supported(cfg, b.x, b.y)) {
    b.z = 0;
    if (b.vz < 0) b.vz = 0;
  }
  constrain(cfg, b);
  return jumped;
}

/** hình học các chướng ngại (client + server dùng chung để khớp nhau) */
export const BRIDGE_GAP_W = (n: number) => Math.min(3.6, 2.2 + n * 0.1);
export const BRIDGE_H = 1.25;
export const SIGN_DUR = 1800;
export const SIGN_REACH = HALF_W + 1.7;
export const bridgeY = (cfg: { L: number }, hitAt: number, tMs: number) => cfg.L / 2 - (TRUCK_V * (tMs - hitAt)) / 1000;
export const signX = (s: number, hitAt: number, tMs: number) =>
  s * SIGN_REACH - s * 2 * SIGN_REACH * Math.max(0, Math.min(1, (tMs - hitAt) / SIGN_DUR));

export type RtHazard = 'bridge' | 'sign' | 'pothole' | 'brake' | 'gust';
export interface RtWarn {
  id: number;
  kind: RtHazard;
  /** ms kể từ lúc bắt đầu ván: thời điểm chạm */
  hitAt: number;
  dur: number;
  /** bridge: x của khe an toàn · sign: cạnh xuất phát (±1) · gust: hướng gió (±1) */
  a: number;
  /** sign: y của biển · bridge: bề rộng khe */
  b: number;
}
