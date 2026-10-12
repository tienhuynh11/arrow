/**
 * ĐẤU VẬT TRÊN NÓC NHÀ (rooftop) — hằng số + vật lý dùng chung giữa server (chốt) và client (dự đoán bản thân).
 * Hệ toạ độ: x ngang xe (phải = +x), y dọc xe (đầu xe = +y), z độ cao (mặt nóc xe z = 0).
 * yaw: hướng (sin yaw, cos yaw) trong mặt phẳng (x, y); yaw = 0 nhìn về đầu xe, yaw tăng = quay phải.
 * Nóc xe được bao kín bằng tường vô hình: không ai rơi khỏi xe; thua khi hết máu.
 */
export const SPEED = 4.8;
export const ACCEL = 20;
export const AIR_ACCEL = 3.2;
export const GRAVITY = 17;
export const JUMP_V = 6.4;
export const WALL_M = 0.35; // tường vô hình cách mép nóc

export interface RtConfig {
  /** chiều dài nóc xe */
  L: number;
  /** nửa bề ngang nóc xe */
  hw: number;
  /** id -> [x, y, yaw] */
  spawns: Record<string, [number, number, number]>;
  /** id người chơi -> chỉ số nhân vật trong RT_CHARS */
  chars: Record<string, number>;
  endsAt: number;
  /** ms kể từ lúc bắt đầu: từ đây "áp lực cuối trận" làm mọi người mất máu dần */
  pressureAt: number;
}

export interface RtBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** tốc độ va tường mạnh nhất trong bước vừa rồi (server đọc rồi đặt lại 0) */
  wall?: number;
}

export const newBody = (x = 0, y = 0): RtBody => ({ x, y, z: 0, vx: 0, vy: 0, vz: 0, wall: 0 });

/* cờ trạng thái gửi trong gói vị trí */
export const F_GROUND = 1;
export const F_STUN = 2; // loạng choạng: điều khiển yếu
export const F_DOWN = 4; // ngã sõng soài
export const F_HOLD = 8; // đang túm người
export const F_HELD = 16; // đang bị túm
export const F_LIFT = 32; // đang bị nhấc bổng
export const F_PUNCH = 128; // đang tung đấm
export const F_OUT = 512; // đã KO
export const F_THROWN = 1024; // đang bay vì bị quăng
export const F_LIFTING = 2048; // đang giơ người khác lên cao
export const F_REACH = 4096; // đang giơ tay tìm chỗ túm
export const F_WHIFF = 8192; // vừa đấm hụt
export const F_DODGE = 16384; // đang lăn né
export const F_CHARGE = 32768; // đang tích lực đấm mạnh
/** cờ hiệu ứng kỹ năng (phần tử cuối của gói vị trí) */
export const SB_ARMOR = 1;
export const SB_SHIELD = 2;
export const SB_RAGE = 4;
export const SB_HASTE = 8;
export const SB_SPIN = 16;
export const SB_BLEED = 32;
export const SB_DASH = 64;
export const SB_PECK = 128;

/** tường vô hình bao kín nóc xe */
export function constrain(cfg: RtConfig, b: RtBody) {
  const mx = cfg.hw - WALL_M;
  const my = cfg.L / 2 - WALL_M;
  if (b.x > mx) {
    b.wall = Math.max(b.wall ?? 0, b.vx);
    b.x = mx;
    if (b.vx > 0) b.vx *= -0.3;
  } else if (b.x < -mx) {
    b.wall = Math.max(b.wall ?? 0, -b.vx);
    b.x = -mx;
    if (b.vx < 0) b.vx *= -0.3;
  }
  if (b.y > my) {
    b.wall = Math.max(b.wall ?? 0, b.vy);
    b.y = my;
    if (b.vy > 0) b.vy *= -0.3;
  } else if (b.y < -my) {
    b.wall = Math.max(b.wall ?? 0, -b.vy);
    b.y = -my;
    if (b.vy < 0) b.vy *= -0.3;
  }
}

export interface StepOpts {
  /** nhân tốc độ tối đa (nhân vật, đang túm, buff…) */
  speedMul?: number;
  /** nhân gia tốc */
  accelMul?: number;
  /** không điều khiển được (ngã, bị túm, lao) */
  noControl?: boolean;
  jump?: boolean;
}

/** một bước vật lý "mềm" của một người; trả true nếu vừa nhảy */
export function stepBody(cfg: RtConfig, b: RtBody, mx: number, my: number, dt: number, o: StepOpts = {}): boolean {
  const ground = b.z <= 0.001 && b.vz <= 0;
  let jumped = false;
  const m = Math.hypot(mx, my);
  if (m > 1) {
    mx /= m;
    my /= m;
  }
  const sp = SPEED * (o.speedMul ?? 1);
  const tx = o.noControl ? 0 : mx * sp;
  const ty = o.noControl ? 0 : my * sp;
  let a = ground ? ACCEL * (o.accelMul ?? 1) : AIR_ACCEL;
  if (o.noControl) a = ground ? 14 : 0.4; // ngã: trượt chậm dần; đang bay thì giữ đà
  const dvx = tx - b.vx;
  const dvy = ty - b.vy;
  const dl = Math.hypot(dvx, dvy);
  if (dl > 1e-6) {
    const k = Math.min(1, (a * dt) / dl);
    b.vx += dvx * k;
    b.vy += dvy * k;
  }
  if (o.jump && ground && !o.noControl) {
    b.vz = JUMP_V;
    jumped = true;
  }
  if (!ground || b.vz > 0) b.vz -= GRAVITY * dt;
  const sp2 = Math.hypot(b.vx, b.vy);
  if (sp2 > 16) {
    b.vx *= 16 / sp2;
    b.vy *= 16 / sp2;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.z <= 0) {
    b.z = 0;
    if (b.vz < 0) b.vz = 0;
  }
  constrain(cfg, b);
  return jumped;
}

/* ======================= NHÂN VẬT THÚ + KỸ NĂNG ======================= */
export interface RtSkill {
  name: string;
  icon: string;
  /** hồi chiêu (ms) */
  cd: number;
  desc: string;
}
export interface RtChar {
  id: string;
  emoji: string;
  name: string;
  hp: number;
  /** nhân tốc độ chạy */
  speed: number;
  /** khối lượng: càng nặng càng khó bị hất văng */
  mass: number;
  /** kích thước hiển thị */
  scale: number;
  skills: [RtSkill, RtSkill];
  blurb: string;
}

export const RT_CHARS: RtChar[] = [
  {
    id: 'bull', emoji: '🐂', name: 'BÒ TÓT', hp: 115, speed: 0.97, mass: 1.15, scale: 1.08,
    blurb: 'Húc thẳng hất văng, gầm làm choáng cả đám',
    skills: [
      { name: 'Húc', icon: '💨', cd: 6000, desc: 'Lao thẳng về phía trước, đâm trúng ai là hất văng + sát thương' },
      { name: 'Gầm', icon: '📢', cd: 18000, desc: 'Gầm vang: choáng mọi người xung quanh' },
    ],
  },
  {
    id: 'bear', emoji: '🐻', name: 'GẤU', hp: 125, speed: 0.88, mass: 1.3, scale: 1.14,
    blurb: 'To xác, đập đất sóng hất ngã, da dày chịu đòn',
    skills: [
      { name: 'Đập đất', icon: '💥', cd: 7000, desc: 'Đập xuống: sóng hất ngã mọi người trong vòng tròn' },
      { name: 'Da dày', icon: '🛡️', cd: 17000, desc: 'Giảm một nửa sát thương và kháng văng trong 3 giây' },
    ],
  },
  {
    id: 'fox', emoji: '🦊', name: 'CÁO', hp: 90, speed: 1.14, mass: 0.85, scale: 0.96,
    blurb: 'Nhanh nhẹn, lướt ra sau lưng đối thủ, ảo ảnh né đòn',
    skills: [
      { name: 'Lướt chớp', icon: '⚡', cd: 5000, desc: 'Dịch chuyển ra sau lưng đối thủ phía trước (hoặc mục tiêu khoá) và chém' },
      { name: 'Ảo ảnh', icon: '👤', cd: 16000, desc: 'Chạy nhanh 4 giây và tự né 1 đòn' },
    ],
  },
  {
    id: 'turtle', emoji: '🐢', name: 'RÙA', hp: 120, speed: 0.8, mass: 1.25, scale: 1.02,
    blurb: 'Chậm nhưng cứng: mai khiên phản đòn, xoáy đẩy mọi người ra',
    skills: [
      { name: 'Mai khiên', icon: '🛡️', cd: 6500, desc: 'Chặn mọi đòn 2,5 giây và phản lại một nửa sát thương' },
      { name: 'Xoáy', icon: '🌀', cd: 19000, desc: 'Quay tròn đẩy và đánh mọi người xung quanh' },
    ],
  },
  {
    id: 'monkey', emoji: '🐒', name: 'KHỈ', hp: 95, speed: 1.1, mass: 0.9, scale: 0.98,
    blurb: 'Nhảy đá từ trên cao, ném vỏ chuối làm người ta trượt ngã',
    skills: [
      { name: 'Nhảy đá', icon: '🦵', cd: 6000, desc: 'Bật lên rồi đá xuống: sát thương + hất văng vùng quanh chỗ rơi' },
      { name: 'Ném chuối', icon: '🍌', cd: 17000, desc: 'Đặt vỏ chuối phía trước: ai dẫm phải sẽ trượt ngã' },
    ],
  },
  {
    id: 'tiger', emoji: '🐯', name: 'HỔ', hp: 100, speed: 1.05, mass: 1.0, scale: 1.04,
    blurb: 'Vồ nhanh gây chảy máu, gầm tăng sức mạnh',
    skills: [
      { name: 'Vồ', icon: '🐾', cd: 6000, desc: 'Vồ nhanh về phía trước, gây chảy máu 3 giây' },
      { name: 'Gầm hổ', icon: '🔥', cd: 17000, desc: 'Chạy nhanh hơn và đánh đau hơn trong 5 giây' },
    ],
  },
  {
    id: 'rooster', emoji: '🐓', name: 'GÀ CHỌI', hp: 90, speed: 1.1, mass: 0.85, scale: 0.94,
    blurb: 'Mổ liên hoàn, đập cánh thành luồng gió đẩy lùi',
    skills: [
      { name: 'Mổ liên hoàn', icon: '🪶', cd: 5000, desc: 'Mổ liên tiếp 5 cú vào người phía trước' },
      { name: 'Đập cánh', icon: '🌬️', cd: 16000, desc: 'Luồng gió mạnh đẩy lùi mọi người phía trước' },
    ],
  },
];

/* ======================= CÂN BẰNG COMBAT (mọi thông số tinh chỉnh nằm ở đây) ======================= */
/** sát thương đòn đánh thường */
export const DMG_QUICK = [4, 5, 9]; // đòn 1, 2, đòn kết combo
export const DMG_HEAVY_MIN = 12;
export const DMG_HEAVY_MAX = 22;
export const COUNTER_DMG_MULT = 1.5;
export const DMG_THROW_LAND = 10; // người bị quăng chạm đất
export const DMG_BOWL = 10; // người bị quăng húc trúng người khác
export const DMG_BOWL_SELF = 5; // ... và chính người bị quăng cũng đau
export const WALL_DMG_MIN_SPEED = 7; // va tường mạnh hơn mức này mới mất máu
export const WALL_DMG_K = 1.1;
export const WALL_DMG_MAX = 8;
export const WHIFF_WALL_DMG = 3; // đấm hụt vào tường: "TỰ ĐẬP!"
export const KILL_CREDIT_MS = 4000; // người gây sát thương trong 4s gần nhất được tính "hạ"
export const SPLASH_MULT = 0.5; // túm nhầm: đòn của người thứ ba lan sang người đang dính nhau
/** áp lực cuối trận: mọi người mất máu dần */
export const PRESSURE_AT = 70000;
export const PRESSURE_DPS0 = 1.5;
export const PRESSURE_DPS1 = 6;
export const MATCH_MS = 150000;
/** kỹ năng */
export const SK_RAGE_SPEED = 1.25;
export const SK_RAGE_DMG = 1.3;
export const SK_HASTE_SPEED = 1.35;
export const SK_ARMOR_DMG = 0.5;
export const SK_ARMOR_KNOCK = 0.5;
export const SK_ARMOR_MS = 3000;
export const SK_SHIELD_MS = 2500;
export const SK_SHIELD_REFLECT = 0.5;
export const SK_HASTE_MS = 4000;
export const SK_RAGE_MS = 5000;
export const SK_BULL_DASH = { speed: 14, ms: 450, dmg: 16, force: 9, stun: 700, wob: 0.6 };
export const SK_BULL_ROAR = { radius: 3.2, dmg: 6, force: 3, stun: 1100, wob: 0.5 };
export const SK_BEAR_SLAM = { radius: 2.6, dmg: 12, force: 6.5, stun: 800, wob: 1.0 };
export const SK_FOX_BLINK = { range: 8, arc: 0.6, dmg: 7, force: 2, stun: 350, wob: 0.3, behind: 1.1 };
export const SK_TURTLE_SPIN = { ms: 1600, every: 200, radius: 1.9, dmg: 3, force: 5.5, stun: 300, wob: 0.15, speedMul: 0.6 };
export const SK_MONKEY_LEAP = { vz: 7.5, v: 4.5, radius: 1.8, dmg: 16, force: 8, stun: 600, wob: 0.6 };
export const SK_BANANA = { ahead: 1.6, life: 12000, max: 3, radius: 0.6, dmg: 6, wob: 1.2, slide: 4, immuneMs: 1500 };
export const SK_TIGER_POUNCE = { speed: 12, ms: 350, dmg: 9, force: 5, stun: 450, wob: 0.4, bleedMs: 3000, bleedDps: 2.5 };
export const SK_ROOSTER_PECK = { count: 5, every: 110, range: 1.8, arc: 0.9, dmg: 3, force: 1.2, stun: 150, wob: 0.1 };
export const SK_ROOSTER_WING = { range: 3.2, arc: 0.9, dmg: 5, force: 9, stun: 500, wob: 0.5 };
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
