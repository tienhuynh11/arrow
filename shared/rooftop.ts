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
export const F_PUNCH = 128; // đang tung đòn
export const F_OUT = 512; // đã KO
export const F_WHIFF = 8192; // vừa đánh hụt
export const F_CAST = 65536; // đang niệm chiêu (đứng im chờ chiêu nổ)
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
/** đánh thường: chuột trái, nối combo 3 đòn (đòn 3 là đòn kết đẩy + làm ngã) */
export const DMG_QUICK = [5, 6, 12];
export const COUNTER_DMG_MULT = 1.5;
export const WALL_DMG_MIN_SPEED = 7; // va tường mạnh hơn mức này mới mất máu
export const WALL_DMG_K = 1.1;
export const WALL_DMG_MAX = 8;
export const WHIFF_WALL_DMG = 3; // đánh hụt vào tường: "TỰ ĐẬP!"
export const KILL_CREDIT_MS = 4000; // người gây sát thương trong 4s gần nhất được tính "hạ"
/** áp lực cuối trận: mọi người mất máu dần */
export const PRESSURE_AT = 70000;
export const PRESSURE_DPS0 = 1.5;
export const PRESSURE_DPS1 = 6;
export const MATCH_MS = 150000;
/** kỹ năng (delay = thời gian niệm chiêu có chỉ báo trên sàn trước khi nổ) */
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
export const SK_BULL_DASH = { speed: 14, ms: 450, dmg: 20, force: 10, stun: 700, wob: 0.8 };
export const SK_BULL_ROAR = { radius: 3.4, dmg: 8, force: 3, stun: 1200, wob: 0.5, delay: 450 };
export const SK_BEAR_SLAM = { radius: 2.8, dmg: 15, force: 7, stun: 900, wob: 1.0, delay: 500 };
export const SK_FOX_BLINK = { range: 8, arc: 0.6, dmg: 9, force: 2, stun: 350, wob: 0.3, behind: 1.1 };
export const SK_TURTLE_SPIN = { ms: 1600, every: 200, radius: 1.9, dmg: 4, force: 5.5, stun: 300, wob: 0.15, speedMul: 0.6 };
export const SK_MONKEY_LEAP = { vz: 7.5, v: 4.5, radius: 1.9, dmg: 20, force: 8, stun: 700, wob: 0.8 };
export const SK_BANANA = { ahead: 1.8, life: 12000, max: 3, radius: 0.6, dmg: 8, wob: 1.2, slide: 4, immuneMs: 1500 };
export const SK_TIGER_POUNCE = { speed: 12, ms: 350, dmg: 12, force: 5, stun: 450, wob: 0.4, bleedMs: 3000, bleedDps: 2.5 };
export const SK_ROOSTER_PECK = { count: 5, every: 110, range: 1.8, arc: 0.9, dmg: 4, force: 1.2, stun: 150, wob: 0.1 };
export const SK_ROOSTER_WING = { range: 3.4, arc: 0.9, dmg: 7, force: 9, stun: 500, wob: 0.5, delay: 350 };
export const CAST_MOVE_MUL = 0.7; // đang niệm chiêu vẫn chạy được (vừa chạy vừa tung)
/** skill linh hoạt: buffer input, huỷ/nối chiêu, lái hướng lúc lao */
export const INPUT_BUFFER_MS = 200; // bấm sớm tối đa chừng này vẫn ra đòn
export const SKILL_CANCEL_MS = 150; // lao/vồ sau chừng này ms có thể huỷ sang đánh thường / skill kia
export const SKILL_LINK_MS = 700; // đánh thường ngay sau skill trong cửa sổ này được thưởng
export const SKILL_LINK_BONUS = 1.25;
export const DASH_STEER_MS = 220; // lúc đầu pha lao có thể bẻ hướng theo hướng chạy / mục tiêu khoá
export const DASH_STEER_RATE = 9; // rad/s
/** đòn thường */
export const QUICK_CD = 380; // hồi chiêu khi trúng (ms)
export const QUICK_WHIFF_CD = 620; // hồi chiêu khi đánh hụt
export const QUICK_RANGE = 1.8;
export const QUICK_ARC = 1.05; // nửa góc quạt (rad)
export const COMBO_FORCE = [4.6, 5.6, 8.5]; // lực đẩy từng đòn trong chuỗi (đòn 3 = kết)
export const COMBO_STUN = [380, 430, 800];
export const COMBO_WOBBLE = [0.25, 0.3, 0.85];
export const COMBO_WINDOW = 900; // ms từ đòn trước tới khi còn nối được chuỗi (và đòn trước phải trúng)
export const COMBO_FINISH_CD = 820;
/** đánh hụt: không trượt dài, nhưng lộ sơ hở cho đòn phản công */
export const QUICK_LURCH = 1.8;
export const WHIFF_STUN = 250;
export const WHIFF_WOBBLE = 0.25;
export const WHIFF_VULN_MS = 450; // trong lúc này bị đánh trúng = phản công
export const COUNTER_MULT = 1.35;
export const COUNTER_EXTRA_STUN = 250;
export const COUNTER_EXTRA_WOBBLE = 0.2;
export const SPEED_FORCE_K = 0.35; // lao tới đánh thì thêm lực
export const KNOCK_WOBBLE_BOOST = 0.5; // đối thủ càng loạng choạng càng dễ văng
/** thăng bằng */
export const WOBBLE_DECAY = 0.45; // /s
export const DOWN_MS = 1250;
export const DOWN_WOBBLE_RESET = 0.3;
export const GETUP_REDUCE = 150; // mỗi lần bấm Space khi nằm ngã rút ngắn thời gian
