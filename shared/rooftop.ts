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
  /** ms kể từ lúc bắt đầu: từ đây nóc xe thu hẹp dần từ mép vào, lan can biến mất */
  shrinkAt: number;
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
export const F_DODGE = 16384; // đang lăn né
export const F_CHARGE = 32768; // đang tích lực đấm mạnh

/** hệ số kích thước nóc xe còn lại: 1 → 0.28, thu từ mép vào giữa theo lịch cố định (client tự tính theo giờ server) */
export function roofScale(cfg: { endsAt: number; shrinkAt: number }, tMs: number): number {
  if (tMs <= cfg.shrinkAt) return 1;
  const k = Math.min(1, (tMs - cfg.shrinkAt) / Math.max(1, cfg.endsAt - 8000 - cfg.shrinkAt));
  return 1 - 0.72 * k;
}

/** vị trí (x,y) có nền xe đỡ không */
export function supported(cfg: RtConfig, x: number, y: number, t = 0): boolean {
  const f = roofScale(cfg, t);
  return Math.abs(x) <= HALF_W * f && Math.abs(y) <= (cfg.L / 2) * f;
}

/** lan can + tường buồng lái: chặn người đang ở thấp */
export function constrain(cfg: RtConfig, b: RtBody, t = 0) {
  if (t > cfg.shrinkAt) return; // lan can đã sập cùng mép nóc
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
  /** thời gian (ms từ lúc bắt đầu) để tính nóc xe đã thu hẹp */
  t?: number;
  /** không điều khiển được (ngã, bị túm, rơi) */
  noControl?: boolean;
  jump?: boolean;
}

/** một bước vật lý "mềm" của một người; trả true nếu vừa nhảy */
export function stepBody(cfg: RtConfig, b: RtBody, mx: number, my: number, dt: number, o: StepOpts = {}): boolean {
  const t = o.t ?? 0;
  const sup = supported(cfg, b.x, b.y, t);
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
  if (falling) a = 0;
  if (o.noControl) a = ground ? 14 : 0.4; // ngã: trượt chậm dần; đang bay thì giữ đà
  const dvx = tx - b.vx;
  const dvy = ty - b.vy;
  const dl = Math.hypot(dvx, dvy);
  const maxd = a * dt;
  if (dl > 1e-6) {
    const k = Math.min(1, maxd / dl);
    b.vx += dvx * k;
    b.vy += dvy * k;
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
  if (b.z <= 0 && supported(cfg, b.x, b.y, t)) {
    b.z = 0;
    if (b.vz < 0) b.vz = 0;
  }
  constrain(cfg, b, t);
  return jumped;
}

/* ======================= CÂN BẰNG COMBAT (mọi thông số tinh chỉnh nằm ở đây) ======================= */
/** đấm nhanh (nhấn chuột trái) */
export const QUICK_CD = 380; // hồi chiêu khi trúng (ms)
export const QUICK_WHIFF_CD = 620; // hồi chiêu khi đấm hụt
export const QUICK_RANGE = 1.7;
export const QUICK_ARC = 1.05; // nửa góc quạt (rad)
export const COMBO_FORCE = [5.2, 6.2, 8]; // lực đẩy từng đòn trong chuỗi (đòn 3 = kết)
export const COMBO_STUN = [380, 430, 760];
export const COMBO_WOBBLE = [0.28, 0.34, 0.6];
export const COMBO_WINDOW = 900; // ms từ đòn trước tới khi còn nối được chuỗi (và đòn trước phải trúng)
export const COMBO_FINISH_CD = 820;
/** đấm mạnh (giữ chuột trái rồi thả) */
export const CHARGE_LEAD = 180; // client chỉ báo "đang tích" sau khi giữ chừng này ms; server cộng bù
export const HEAVY_MIN = 420; // giữ tối thiểu để thành đòn mạnh
export const CHARGE_MAX = 1100; // tới đây tự tung
export const HEAVY_FORCE_MIN = 6.5;
export const HEAVY_FORCE_MAX = 10;
export const HEAVY_RANGE = 2.0;
export const HEAVY_ARC = 0.7;
export const HEAVY_STUN = 850;
export const HEAVY_WOBBLE = 1.0; // đòn mạnh trúng là ngã ngay (đổi lại rất dễ bị né/hụt, hồi chiêu dài)
export const HEAVY_CD = 900;
export const CHARGE_SPEED_MUL = 0.45; // đang tích lực thì đi chậm
/** đấm hụt: không trượt dài, nhưng lộ sơ hở cho đòn phản công */
export const QUICK_LURCH = 1.8;
export const HEAVY_LURCH = 3.2;
export const WHIFF_STUN = 250;
export const HEAVY_WHIFF_STUN = 600;
export const WHIFF_WOBBLE = 0.25;
export const HEAVY_WHIFF_WOBBLE = 0.5;
export const WHIFF_VULN_MS = 450; // trong lúc này bị đánh trúng = phản công
export const COUNTER_MULT = 1.35;
export const COUNTER_EXTRA_STUN = 250;
export const COUNTER_EXTRA_WOBBLE = 0.2;
export const SPEED_FORCE_K = 0.35; // lao tới đấm thì thêm lực
export const KNOCK_WOBBLE_BOOST = 0.5; // đối thủ càng loạng choạng càng dễ văng
export const ANCHOR_KNOCK_MUL = 0.28;
export const HOLDING_KNOCK_MUL = 0.6;
/** né (Ctrl / Q) */
export const DODGE_SPEED = 9.5;
export const DODGE_MS = 230;
export const DODGE_IFRAME = 150; // cửa sổ tránh ĐẤM (không tránh được túm)
export const DODGE_CD = 1100;
export const DODGE_WOBBLE = 0.08;
/** thăng bằng */
export const WOBBLE_DECAY = 0.45; // /s
export const WOBBLE_STEER_BONUS = 0.35; // /s thêm khi bẻ lái ngược hướng đang trượt
export const DOWN_MS = 1250;
export const DOWN_WOBBLE_RESET = 0.3;
export const GETUP_REDUCE = 150; // mỗi lần bấm Space/né khi nằm ngã rút ngắn thời gian
/** túm / quăng */
export const GRAB_RANGE = 1.6;
export const GRAB_ARC = 1.3;
export const STRUGGLE_NEED = 2.0;
export const STRUGGLE_NEED_LIFT = 3.2;
export const THROW_V = 11.5;
export const LOB_V = 7;
export const THROW_VZ_LIFT = 5.6;
export const THROW_VZ = 3.4;
export const GRAB_TIE_EPS = 1e-3;
