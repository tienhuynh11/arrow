// Nhân vật người chơi kiểu "hạt đậu" (giống nhân vật minigame / Fall Guys): thân tròn mũm mĩm liền đầu,
// mặt dán phía trước, tay "sợi mì" hai khúc (vai nhô ra ngoài thân, tay áo + găng tương phản) bám đúng báng/ốp súng.
// Thân trên xoay theo hướng NGẮM; chân xoay mượt theo hướng CHẠY (chạy lùi, đi ngang đúng chiều), ngẩng theo pitch.
// MƯỢT: mọi thông số tư thế đều đi qua giảm chấn độc lập khung hình (1 - e^(-k·dt)); vận tốc lấy từ vị trí hiển thị
// rồi lọc; pha bước chân cộng dồn liên tục; mọi chuyển trạng thái (trên không, đáp, gồng, gục, chết, chạy lùi) đều trộn dần.
// Mỗi lớp một bộ đồ riêng (7 lớp); màu thắt lưng + giày theo người chơi. Súng dựng theo họ mô hình của vũ khí.
// Cao ~1.5 m (không tính mũ). Hình khối + vật liệu dùng chung giữa các nhân vật.

import * as THREE from 'three';
import { CLASSES, weaponOf, type WeaponModel } from '@shared/monkey/content';
import { PLAYER_COLORS } from '../ui/dom';

/** màu da theo idx người chơi (10 tông, đủ MAX_PLAYERS) */
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd1a17a, 0xa86b3c, 0x6b3e1f, 0xf3d2b3, 0xb98060];
/** màu riêng của từng người chơi (thắt lưng, giày) */
const PCOL = PLAYER_COLORS;
const DOWN = new THREE.Vector3(0, -1, 0);

/* ---------- kích thước khung (m) ---------- */
const HIP_Y = 0.37; // khớp hông
const TH = 0.15; // đùi
const SH = 0.13; // cẳng chân
const BODY_R = 0.34;
const BODY_LEN = 0.27;
const BODY_Y = 0.36; // tâm thân so với hông
const HEAD_R = 0.35;
const NECK_Y = 0.6;
const HEAD_Y = 0.18; // đỉnh đầu = HIP_Y + NECK_Y + HEAD_Y + HEAD_R = 1.50
const AIM_Y = 0.52;
const SHO_X = 0.385; // vai nằm NGOÀI mặt thân (BODY_R) để tay luôn nhô ra
const SHO_Z = 0.1;
const UA = 0.22; // cánh tay trên
const FA = 0.22; // cẳng tay
const ARM_STRETCH = 1.45; // tay sợi mì giãn tối đa
const GUN_S = 0.85;

export interface AvatarPose {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  dt: number; t: number;
  down: number;
  ads: boolean; sprint: boolean; brace: boolean; rage: boolean; reviving: boolean;
  /** tiến độ nạp đạn 0..1, âm = không nạp */
  reload: number;
}

type Skill = 'throw' | 'build' | 'stomp' | 'brace' | 'ult';

/* ---------- lớp nhân vật (chịu được khi CLASSES đang được mở rộng) ---------- */
const IDS = ['chienbinh', 'ysi', 'kysu', 'dausi', 'xathu', 'phaothu', 'caoboi'];
const FALLBACK_COL: Record<string, number> = {
  chienbinh: 0x3b82f6, ysi: 0x22c55e, kysu: 0xf97316, dausi: 0xdc2626, xathu: 0x8b5cf6, phaothu: 0xeab308, caoboi: 0x14b8a6,
};
/** [tay áo, găng tay] — luôn khác màu thân để tay dễ thấy */
const ARMS: Record<string, [number, number]> = {
  chienbinh: [0x4d6b2f, 0x2a2a2e],
  ysi: [0xf4f6f2, 0x60a5fa],
  kysu: [0x374151, 0xfacc15],
  dausi: [0x8a919c, 0x1f2937],
  xathu: [0x5b6b3a, 0x2a2a2e],
  phaothu: [0x6b4423, 0x1c1917],
  caoboi: [0xf1e4c3, 0x7c4a1e],
};
function classLook(cls: number): { id: string; color: number } {
  const c = CLASSES[cls] as { id?: string; color?: number } | undefined;
  const id = c?.id ?? IDS[cls] ?? IDS[Math.abs(cls | 0) % IDS.length];
  return { id, color: c?.color ?? FALLBACK_COL[id] ?? 0x3b82f6 };
}

/* ---------- vũ khí theo lớp + bậc ---------- */
type GunModelId = WeaponModel;
const MODELS: GunModelId[] = ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'launcher'];
function weaponLook(cls: number, tier: number): { model: GunModelId; color: number } {
  try {
    const w = weaponOf(cls, tier) as { model?: string; color?: number } | undefined;
    if (w) return { model: (MODELS as string[]).includes(w.model ?? '') ? (w.model as GunModelId) : 'pistol', color: w.color ?? 0x6b7280 };
  } catch { /* dữ liệu lớp đang thay đổi: dùng súng lục mặc định */ }
  return { model: 'pistol', color: 0x6b7280 };
}

/* ---------- vật liệu + hình khối dùng chung ---------- */
const matCache = new Map<string, THREE.Material>();
function mat(color: number, opts: { rough?: number; metal?: number; emissive?: number; basic?: boolean } = {}): THREE.Material {
  const key = `${color}|${opts.rough ?? 0.75}|${opts.metal ?? 0}|${opts.emissive ?? 0}|${opts.basic ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = opts.basic
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.75, metalness: opts.metal ?? 0, emissive: opts.emissive ?? 0 });
    matCache.set(key, m);
  }
  return m;
}
const geoCache = new Map<string, THREE.BufferGeometry>();
function G<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const box = (sx: number, sy: number, sz: number) => G(`b${sx},${sy},${sz}`, () => new THREE.BoxGeometry(sx, sy, sz));
const sph = (r: number, w = 12, h = 10) => G(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const cylZ = (r: number, len: number, seg = 10) => G(`c${r},${len},${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2));
const cylY = (r0: number, r1: number, len: number, seg = 12) => G(`y${r0},${r1},${len},${seg}`, () => new THREE.CylinderGeometry(r0, r1, len, seg));
/** khối tròn treo từ khớp xuống theo -Y */
const limbGeo = (r: number, len: number) => G(`l${r},${len}`, () => new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 12).translate(0, -len / 2, 0));
/** đoạn tay: trụ dài 1 từ khớp xuống -Y, co giãn bằng scale.y (đầu khớp có quả cầu che mối nối) */
const segGeo = (r0: number, r1: number) => G(`seg${r0},${r1}`, () => new THREE.CylinderGeometry(r0, r1, 1, 12, 1, true).translate(0, -0.5, 0));

function shade(hex: number, k: number) {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}
function colDist(a: number, b: number) {
  const A = new THREE.Color(a), B = new THREE.Color(b);
  return Math.abs(A.r - B.r) + Math.abs(A.g - B.g) + Math.abs(A.b - B.b);
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  parent.add(o);
  return o;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};
/** chỉnh lưu mềm: ≈ max(0, x) nhưng không gãy khúc (tránh khớp gối "bật") */
const softPos = (x: number) => (x + Math.sqrt(x * x + 0.04)) * 0.5 - 0.1;
const wrapPi = (a: number) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

let shieldMat: THREE.Material | null = null;
let rageMat: THREE.Material | null = null;
const blobMats = new Map<THREE.Texture, THREE.Material>();

/* ---------- súng: mô hình theo họ + điểm cầm ---------- */
interface Gun {
  g: THREE.Group;
  /** điểm cầm (toạ độ gunPose, đã nhân GUN_S) */
  grip: THREE.Vector3;
  fore: THREE.Vector3;
  /** nòng (toạ độ riêng của g) */
  muzzle: THREE.Vector3;
  mag: THREE.Object3D | null;
  /** vị trí cầm súng (toạ độ aim) */
  hold: THREE.Vector3;
}
function gunModel(model: GunModelId, color: number): Gun {
  const g = new THREE.Group();
  const metal = mat(0x2b2f36, { rough: 0.45, metal: 0.6 });
  const dark = mat(0x16181c, { rough: 0.5, metal: 0.4 });
  const accent = mat(color, { rough: 0.5, metal: 0.2 });
  const wood = mat(0x8a5a2b, { rough: 0.8 });
  const glass = mat(0x88ccff, { basic: true });
  const b = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => mesh(box(sx, sy, sz), m, g, x, y, z);
  const c = (r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 10) => mesh(cylZ(r, len, seg), m, g, x, y, z);
  let grip = new THREE.Vector3(0, -0.1, 0);
  let fore = new THREE.Vector3(0, -0.07, 0.3);
  let len = 0.64;
  let muzY = 0.02;
  let mag: THREE.Object3D | null = null;
  const hold = new THREE.Vector3(0.17, -0.08, 0.38);
  switch (model) {
    case 'pistol': // súng lục: hai tay ôm báng, đưa ra trước
      b(0.06, 0.09, 0.26, 0, 0.02, 0.09, accent);
      b(0.056, 0.03, 0.22, 0, 0.075, 0.08, dark);
      mag = b(0.05, 0.15, 0.07, 0, -0.08, 0, dark);
      mag.rotation.x = -0.15;
      c(0.016, 0.06, 0, 0.03, 0.24, dark);
      grip = new THREE.Vector3(0, -0.07, 0);
      fore = new THREE.Vector3(0.03, -0.1, 0.03);
      len = 0.27;
      hold.set(0.13, -0.02, 0.5);
      break;
    case 'revolver': { // súng ổ quay: ổ đạn tròn, nòng dài, báng gỗ cong
      c(0.024, 0.3, 0, 0.035, 0.22, metal);
      b(0.05, 0.03, 0.26, 0, 0.065, 0.16, accent); // gân trên nòng
      const drum = c(0.058, 0.1, 0, 0.02, 0.04, accent, 8);
      drum.rotation.z = Math.PI / 8;
      b(0.05, 0.08, 0.12, 0, -0.005, -0.04, metal); // khung
      const gr = b(0.05, 0.14, 0.07, 0, -0.09, -0.08, wood);
      gr.rotation.x = 0.35;
      b(0.02, 0.04, 0.02, 0, 0.07, -0.08, dark); // búa
      mag = drum;
      grip = new THREE.Vector3(0, -0.08, -0.07);
      fore = new THREE.Vector3(0.03, -0.11, -0.04);
      len = 0.37;
      muzY = 0.035;
      hold.set(0.13, -0.02, 0.5);
      break;
    }
    case 'smg':
      b(0.08, 0.11, 0.38, 0, 0, 0.1, metal);
      b(0.06, 0.07, 0.2, 0, -0.01, -0.17, dark);
      mag = b(0.05, 0.2, 0.06, 0, -0.14, 0.13, accent);
      b(0.05, 0.12, 0.06, 0, -0.1, -0.03, dark);
      c(0.02, 0.14, 0, 0.02, 0.35, dark);
      grip = new THREE.Vector3(0, -0.1, -0.03);
      fore = new THREE.Vector3(0, -0.07, 0.25);
      len = 0.43;
      hold.set(0.17, -0.07, 0.4);
      break;
    case 'shotgun': // hai nòng, ốp gỗ
      c(0.03, 0.75, 0, 0.02, 0.27, metal);
      c(0.026, 0.55, 0, -0.04, 0.22, dark);
      b(0.08, 0.075, 0.24, 0, -0.04, 0.3, wood);
      b(0.07, 0.12, 0.3, 0, -0.04, -0.2, wood);
      b(0.072, 0.05, 0.16, 0, 0.0, -0.02, accent);
      grip = new THREE.Vector3(0, -0.09, -0.08);
      fore = new THREE.Vector3(0, -0.07, 0.3);
      len = 0.65;
      hold.set(0.18, -0.08, 0.34);
      break;
    case 'rifle':
      b(0.075, 0.12, 0.62, 0, 0, 0.14, accent);
      b(0.06, 0.06, 0.22, 0, 0.1, 0.08, dark);
      c(0.03, 0.06, 0, 0.1, 0.21, glass);
      mag = b(0.05, 0.2, 0.08, 0, -0.15, 0.14, metal);
      mag.rotation.x = 0.25;
      b(0.06, 0.12, 0.24, 0, -0.03, -0.27, metal);
      c(0.018, 0.2, 0, 0.02, 0.53, dark);
      grip = new THREE.Vector3(0, -0.1, 0.0);
      fore = new THREE.Vector3(0, -0.07, 0.34);
      len = 0.64;
      hold.set(0.18, -0.08, 0.34);
      break;
    case 'lmg': { // súng máy: thân to, hộp đạn vuông bên hông, ống tản nhiệt, chân chống
      b(0.1, 0.14, 0.5, 0, 0, 0.08, metal);
      b(0.07, 0.12, 0.24, 0, -0.02, -0.28, accent); // báng
      c(0.042, 0.36, 0, 0.02, 0.5, accent, 8); // ống tản nhiệt
      c(0.02, 0.18, 0, 0.02, 0.76, dark);
      mag = b(0.15, 0.15, 0.13, -0.07, -0.13, 0.06, mat(0x4d5b2c, { rough: 0.8 })); // hộp đạn
      b(0.03, 0.05, 0.2, 0, 0.1, 0.06, dark); // quai xách
      for (const sx of [-1, 1]) {
        const leg = mesh(cylY(0.012, 0.012, 0.26, 6), dark, g, 0.04 * sx, -0.11, 0.6);
        leg.rotation.set(-0.5, 0, 0.25 * sx);
      }
      b(0.05, 0.12, 0.06, 0, -0.11, -0.06, dark); // tay cầm
      grip = new THREE.Vector3(0, -0.12, -0.06);
      fore = new THREE.Vector3(0, -0.06, 0.32);
      len = 0.86;
      hold.set(0.18, -0.12, 0.3);
      break;
    }
    case 'sniper': { // bắn tỉa: nòng rất dài, ống ngắm to, báng dài
      b(0.07, 0.1, 0.4, 0, 0, 0.05, accent);
      c(0.02, 0.62, 0, 0.02, 0.56, metal);
      c(0.03, 0.08, 0, 0.02, 0.9, dark); // giảm giật đầu nòng
      c(0.04, 0.3, 0, 0.12, 0.06, dark); // ống ngắm
      c(0.05, 0.05, 0, 0.12, 0.22, dark);
      c(0.042, 0.012, 0, 0.12, 0.25, glass);
      b(0.02, 0.05, 0.03, 0, 0.07, 0.06, dark); // chân ống ngắm
      b(0.065, 0.14, 0.26, 0, -0.04, -0.27, accent); // báng
      mag = b(0.045, 0.1, 0.07, 0, -0.09, 0.08, metal);
      const bolt = mesh(sph(0.02, 6, 5), metal, g, 0.06, 0.03, -0.06);
      bolt.scale.set(1.3, 1, 1);
      grip = new THREE.Vector3(0, -0.1, -0.08);
      fore = new THREE.Vector3(0, -0.06, 0.3);
      len = 0.96;
      hold.set(0.17, -0.07, 0.3);
      break;
    }
    case 'launcher':
    default: { // ống phóng: ống lớn vác cao ngang vai, đầu đạn nhô ra
      c(0.1, 0.95, 0, 0.04, 0.16, accent, 12);
      c(0.115, 0.08, 0, 0.04, 0.6, dark, 12);
      c(0.115, 0.08, 0, 0.04, -0.28, dark, 12);
      const tip = mesh(G('warhead', () => new THREE.ConeGeometry(0.075, 0.14, 10).rotateX(Math.PI / 2)), mat(0xe5e7eb, { rough: 0.5 }), g, 0, 0.04, 0.7);
      tip.castShadow = false;
      b(0.06, 0.16, 0.08, 0, -0.12, 0.0, metal);
      b(0.05, 0.12, 0.06, 0, -0.1, 0.28, metal);
      b(0.04, 0.08, 0.1, -0.11, 0.1, 0.18, dark); // ống ngắm bên
      mag = tip;
      grip = new THREE.Vector3(0, -0.16, 0);
      fore = new THREE.Vector3(0, -0.13, 0.28);
      len = 0.66;
      muzY = 0.04;
      hold.set(0.2, 0.0, 0.3);
    }
  }
  g.scale.setScalar(GUN_S);
  return { g, grip: grip.multiplyScalar(GUN_S), fore: fore.multiplyScalar(GUN_S), muzzle: new THREE.Vector3(0, muzY, len), mag, hold };
}

/* ---------- kênh giảm chấn (mọi thông số tư thế) ---------- */
const C_HY = 0, C_HRX = 1, C_CRX = 2, C_CRZ = 3, C_CY = 4, C_SQ = 5, C_NRX = 6, C_HDX = 7;
const C_THL = 8, C_THR = 9, C_KNL = 10, C_KNR = 11, C_AKL = 12, C_AKR = 13;
const C_GPX = 14, C_GPY = 15, C_GPZ = 16, C_GRX = 17, C_GRY = 18, C_GRZ = 19;
const C_TR = 20, C_TL = 23, C_AIM = 26, C_GS = 27, C_HDZ = 28;
const NCH = 29;

interface Arm {
  sh: THREE.Group;
  el: THREE.Group;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  hand: THREE.Mesh;
  pole: THREE.Vector3;
}

export class Avatar {
  root = new THREE.Group();
  blob: THREE.Mesh;
  readonly cls: number;
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chestG = new THREE.Group();
  private neck = new THREE.Group();
  private headG = new THREE.Group();
  private aim = new THREE.Group();
  private gunPose = new THREE.Group();
  private armL: Arm;
  private armR: Arm;
  private thL = new THREE.Group();
  private thR = new THREE.Group();
  private knL = new THREE.Group();
  private knR = new THREE.Group();
  private ankL = new THREE.Group();
  private ankR = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private gun: Gun | null = null;
  private tier = -1;
  private shield: THREE.Mesh;
  private rageM: THREE.Mesh;
  private blinkOff: number;
  private look: { id: string; color: number };
  /* trạng thái hoạt cảnh */
  private ch = new Float32Array(NCH);
  private chInit = false;
  private phase = 0;
  private recoil = 0;
  private hitT = 0;
  private hitDir = 0;
  private skillT = 0;
  private skillDur = 0;
  private skillKind: Skill = 'throw';
  private lastX = NaN;
  private lastZ = NaN;
  private vx = 0;
  private vz = 0;
  private speedS = 0;
  private legYawW = NaN;
  private backK = 0;
  private backward = false;
  private airK = 0;
  private wasAir = false;
  private landT = 0;
  private landS = 0;
  private sprintK = 0;
  private adsK = 0;
  private crawlK = 0;
  private deadK = 0;
  private kneelK = 0;
  private braceK = 0;
  private tR = new THREE.Vector3();
  private tL = new THREE.Vector3();
  private tG = new THREE.Vector3();
  private tF = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpE = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  /** chi tiết nhỏ ẩn được khi ở xa (LOD rẻ) */
  private small: THREE.Object3D[] = [];
  private detail = true;

  constructor(cls: number, blobTexture: THREE.Texture, idx = 0) {
    this.cls = cls;
    this.look = classLook(cls);
    const { id, color } = this.look;
    this.blinkOff = idx * 0.31 + cls * 0.17;
    const skin = mat(SKINS[idx % SKINS.length], { rough: 0.6 });
    const body = mat(color, { rough: 0.55 });
    const legM = mat(shade(color, 0.78), { rough: 0.6 });
    const pcol = mat(PCOL[idx % PCOL.length], { rough: 0.5 });
    const shoeM = mat(PCOL[idx % PCOL.length], { rough: 0.45 });
    const ink = mat(0x1d1728, { basic: true });
    const white = mat(0xffffff, { basic: true });
    const red = mat(0xe11d48, { basic: true });
    const bulk = id === 'dausi';
    let [sleeveC, gloveC] = ARMS[id] ?? [shade(color, 0.5), 0x2a2a2e];
    if (colDist(sleeveC, color) < 0.35) sleeveC = shade(color, 0.5);
    if (colDist(gloveC, sleeveC) < 0.35) gloveC = colDist(sleeveC, 0xffffff) > 1.2 ? 0xf5f5f4 : 0x1f2937;

    this.root.add(this.hips);
    this.hips.position.y = HIP_Y;
    // ---- chân ngắn ----
    for (const [th, kn, ank, sx] of [[this.thL, this.knL, this.ankL, -1], [this.thR, this.knR, this.ankR, 1]] as const) {
      th.position.set(0.15 * sx, 0, 0);
      this.hips.add(th);
      mesh(limbGeo(0.11, TH + 0.05), legM, th);
      kn.position.y = -TH;
      th.add(kn);
      mesh(limbGeo(0.1, SH + 0.04), legM, kn);
      ank.position.y = -SH;
      kn.add(ank);
      mesh(sph(0.115, 14, 10), shoeM, ank, 0, -0.012, 0.04).scale.set(1, 0.62, 1.4);
    }
    // ---- thân hạt đậu ----
    this.hips.add(this.spine);
    this.spine.add(this.chestG);
    const torso = mesh(G('torso', () => new THREE.CapsuleGeometry(BODY_R, BODY_LEN, 8, 20)), body, this.chestG, 0, BODY_Y, 0);
    const belt = mesh(G('belt', () => new THREE.TorusGeometry(0.33, 0.04, 8, 28)), pcol, this.chestG, 0, BODY_Y - 0.17, 0);
    belt.rotation.x = Math.PI / 2;
    if (bulk) {
      torso.scale.set(1.08, 1, 1.05);
      belt.scale.set(1.08, 1.05, 1);
    }
    const front = bulk ? 0.36 : 0.335;
    // ---- đồ theo lớp ----
    let packCol: number | null = 0x5b4a33;
    if (id === 'chienbinh') {
      // túi đạn trên thắt lưng + ba lô quân đội
      for (const x of [-0.12, 0, 0.12]) mesh(box(0.09, 0.1, 0.06), mat(0x445530), this.chestG, x, BODY_Y - 0.13, front + 0.01);
      packCol = 0x55663a;
    } else if (id === 'ysi') {
      // chữ thập đỏ trên ngực, ba lô trắng có chữ thập
      mesh(box(0.12, 0.035, 0.02), red, this.chestG, 0.12, BODY_Y + 0.07, 0.318, false);
      mesh(box(0.035, 0.12, 0.02), red, this.chestG, 0.12, BODY_Y + 0.07, 0.318, false);
      mesh(box(0.13, 0.04, 0.02), red, this.chestG, 0, BODY_Y + 0.1, -0.455, false);
      mesh(box(0.04, 0.13, 0.02), red, this.chestG, 0, BODY_Y + 0.1, -0.455, false);
      packCol = 0xf4f6f2;
    } else if (id === 'kysu') {
      // quai yếm + túi yếm + cờ lê bên hông
      const strap = mat(0x1f2937, { rough: 0.8 });
      for (const x of [-0.12, 0.12]) mesh(box(0.055, 0.26, 0.03), strap, this.chestG, x, BODY_Y + 0.02, 0.318);
      mesh(box(0.2, 0.12, 0.03), strap, this.chestG, 0, BODY_Y - 0.06, 0.33);
      const wr = mesh(box(0.035, 0.2, 0.025), mat(0xb0b6bf, { metal: 0.8, rough: 0.3 }), this.chestG, 0.345, BODY_Y - 0.2, 0.06);
      wr.rotation.z = 0.3;
      packCol = 0x6b7280;
    } else if (id === 'dausi') {
      // đấu sĩ: giáp vai to + khoá thắt lưng
      const armor = mat(0x8a919c, { metal: 0.35, rough: 0.45 });
      for (const sx of [-1, 1]) {
        const p = mesh(G('pad', () => new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), armor, this.chestG, 0.32 * sx, BODY_Y + 0.21, 0.03);
        p.scale.set(1.15, 0.8, 1.1);
        p.rotation.z = -0.35 * sx;
      }
      mesh(box(0.13, 0.1, 0.03), mat(0xd4a017, { metal: 0.7, rough: 0.35 }), this.chestG, 0, BODY_Y - 0.17, 0.375);
      packCol = 0x2a2d33;
    } else if (id === 'xathu') {
      // xạ thủ: khăn ngụy trang ghillie quấn cổ + tua lá rủ sau lưng
      const ghA = mat(0x5b6b3a, { rough: 0.95 });
      const ghB = mat(0x3f4a26, { rough: 0.95 });
      const scarf = mesh(G('scarf', () => new THREE.TorusGeometry(0.33, 0.075, 8, 22)), ghA, this.chestG, 0, NECK_Y - 0.1, 0.0);
      scarf.rotation.x = Math.PI / 2;
      scarf.scale.set(1.04, 1.04, 0.9);
      const tufts: [number, number, number, number, THREE.Material][] = [
        [-0.2, NECK_Y - 0.22, -0.27, 0.3, ghB], [0.02, NECK_Y - 0.26, -0.33, -0.1, ghA], [0.22, NECK_Y - 0.2, -0.25, -0.35, ghB],
        [0.3, NECK_Y - 0.17, 0.16, 0.2, ghB],
      ];
      for (const [x, y, z, rz, m] of tufts) {
        const tf = mesh(box(0.09, 0.2, 0.03), m, this.chestG, x, y, z);
        tf.rotation.set(0.25 * Math.sign(z), Math.atan2(x, z), rz);
      }
      packCol = 0x4a5530;
    } else if (id === 'phaothu') {
      // pháo thủ: đai bom trước bụng + ba lô to cắm tên lửa
      const strap = mat(0x5a3a1e, { rough: 0.8 });
      const bb = mesh(G('bombbelt', () => new THREE.TorusGeometry(0.345, 0.032, 6, 24)), strap, this.chestG, 0, BODY_Y + 0.04, 0);
      bb.rotation.x = Math.PI / 2;
      const bomb = mat(0x22262c, { rough: 0.4, metal: 0.3 });
      const fuse = mat(0xf97316, { emissive: 0x7c2d12 });
      for (const a of [-0.55, 0, 0.55]) {
        const x = Math.sin(a) * 0.39, z = Math.cos(a) * 0.39;
        mesh(sph(0.062, 10, 8), bomb, this.chestG, x, BODY_Y + 0.04, z);
        mesh(cylY(0.012, 0.012, 0.06, 5), fuse, this.chestG, x, BODY_Y + 0.12, z, false);
      }
      packCol = null;
      const bp = mesh(box(0.44, 0.46, 0.22), mat(0x4b5320, { rough: 0.9 }), this.chestG, 0, BODY_Y + 0.08, -0.42);
      bp.rotation.x = 0.06;
      const rk = mat(0xdc2626, { rough: 0.5 });
      const nose = mat(0xe5e7eb, { rough: 0.5 });
      for (const sx of [-1, 1]) {
        mesh(cylY(0.055, 0.055, 0.46, 10), rk, this.chestG, 0.13 * sx, BODY_Y + 0.38, -0.45);
        mesh(G('rnose', () => new THREE.ConeGeometry(0.055, 0.13, 10)), nose, this.chestG, 0.13 * sx, BODY_Y + 0.675, -0.45);
      }
    } else if (id === 'caoboi') {
      // cao bồi: áo gi-lê da hở trước + ngôi sao + khăn rằn cổ + bao súng bên hông
      const leather = mat(0x5b3a1e, { rough: 0.8 });
      leather.side = THREE.DoubleSide;
      mesh(G('vest', () => new THREE.CylinderGeometry(0.352, 0.352, 0.34, 20, 1, true, 0.55, Math.PI * 2 - 1.1)), leather, this.chestG, 0, BODY_Y + 0.02, 0);
      const star = mesh(G('star', () => new THREE.CylinderGeometry(0.05, 0.05, 0.015, 5).rotateX(Math.PI / 2)), mat(0xfacc15, { metal: 0.7, rough: 0.3 }), this.chestG, Math.sin(-0.75) * 0.36, BODY_Y + 0.08, Math.cos(-0.75) * 0.36, false);
      star.rotation.y = -0.75;
      const scarfM = mat(0xb91c1c, { rough: 0.7 });
      const sc = mesh(G('neckerchief', () => new THREE.TorusGeometry(0.3, 0.05, 8, 20)), scarfM, this.chestG, 0, NECK_Y - 0.08, 0.02);
      sc.rotation.x = Math.PI / 2;
      const tri = mesh(G('kerchief', () => new THREE.ConeGeometry(0.15, 0.2, 3)), scarfM, this.chestG, 0, NECK_Y - 0.2, 0.3);
      tri.rotation.set(Math.PI - 0.35, Math.PI / 6, 0);
      tri.scale.set(1, 1, 0.35);
      mesh(box(0.1, 0.17, 0.09), leather, this.chestG, 0.37, BODY_Y - 0.25, 0.04); // bao súng
      const hg = mesh(box(0.05, 0.1, 0.05), mat(0x8a5a2b, { rough: 0.8 }), this.chestG, 0.38, BODY_Y - 0.13, 0.0);
      hg.rotation.x = -0.35;
      packCol = null;
      const roll = mesh(cylY(0.09, 0.09, 0.44, 12), mat(0xd6c7a1, { rough: 0.95 }), this.chestG, 0, BODY_Y + 0.22, -0.37);
      roll.rotation.z = Math.PI / 2;
    }
    if (packCol !== null) {
      const pack = mesh(box(0.32, 0.34, 0.15), mat(packCol, { rough: 0.9 }), this.chestG, 0, BODY_Y + 0.1, -0.37);
      pack.rotation.x = 0.06;
    }

    // ---- đầu (liền thân) + mặt ----
    this.neck.position.set(0, NECK_Y, 0);
    this.chestG.add(this.neck);
    this.headG.position.y = HEAD_Y;
    this.neck.add(this.headG);
    mesh(G('head', () => new THREE.SphereGeometry(HEAD_R, 28, 20)), body, this.headG);
    mesh(G('face', () => new THREE.SphereGeometry(0.31, 22, 14)), skin, this.headG, 0, -0.015, 0.21, false).scale.set(0.95, 0.82, 0.55);
    for (const sx of [-1, 1]) {
      const eye = mesh(sph(0.062, 14, 10), ink, this.headG, 0.118 * sx, 0.03, 0.36, false);
      eye.scale.set(1.1, 1.35, 0.6);
      mesh(sph(0.02, 6, 5), white, eye, 0.022, 0.03, 0.05, false);
      this.eyes.push(eye);
      mesh(sph(0.05, 10, 6), mat(0xff8fa3, { basic: true }), this.headG, 0.19 * sx, -0.075, 0.322, false).scale.set(1.3, 0.7, 0.4);
      if (bulk || id === 'xathu') mesh(box(0.12, 0.028, 0.02), ink, this.headG, 0.11 * sx, 0.125, 0.338, false).rotation.z = sx * (bulk ? 0.45 : 0.15);
    }
    const mouth = mesh(G('smile', () => new THREE.TorusGeometry(0.05, 0.012, 6, 14, Math.PI)), ink, this.headG, 0, -0.085, 0.368, false);
    mouth.rotation.z = Math.PI;
    this.headG.add(this.hat(id));

    // ---- tay "sợi mì" hai khúc + súng ----
    this.aim.position.set(0, AIM_Y, 0);
    this.chestG.add(this.aim);
    const sleeve = mat(sleeveC, { rough: 0.7 });
    const sleeve2 = mat(shade(sleeveC, 0.88), { rough: 0.7 });
    const glove = mat(gloveC, { rough: 0.6 });
    const mkArm = (sx: number): Arm => {
      const sh = new THREE.Group();
      sh.position.set(SHO_X * sx * (bulk ? 1.06 : 1), 0, SHO_Z);
      this.aim.add(sh);
      mesh(sph(0.112, 12, 10), sleeve, sh); // vai tròn nhô ra
      const upper = mesh(segGeo(0.095, 0.085), sleeve, sh);
      const el = new THREE.Group();
      sh.add(el);
      mesh(sph(0.086, 10, 8), sleeve2, el); // khuỷu
      const fore = mesh(segGeo(0.084, 0.076), sleeve2, el);
      const hand = mesh(sph(0.1, 12, 10), glove, el);
      hand.scale.set(1, 0.9, 1.1);
      return { sh, el, upper, fore, hand, pole: new THREE.Vector3(sx * 1, -0.55, -0.55) };
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    this.setArm(this.armL, UA, FA);
    this.setArm(this.armR, UA, FA);
    this.aim.add(this.gunPose);

    // khiên gồng mình / cuồng nộ
    const shellGeo = G('shell', () => new THREE.SphereGeometry(1, 20, 14));
    shieldMat ??= new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
    rageMat ??= new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    this.shield = new THREE.Mesh(shellGeo, shieldMat);
    this.shield.scale.set(0.72, 0.86, 0.72);
    this.shield.position.y = 0.78;
    this.shield.visible = false;
    this.root.add(this.shield);
    this.rageM = new THREE.Mesh(shellGeo, rageMat);
    this.rageM.scale.set(0.8, 0.9, 0.8);
    this.rageM.position.y = 0.78;
    this.rageM.visible = false;
    this.root.add(this.rageM);
    let bm = blobMats.get(blobTexture);
    if (!bm) {
      bm = new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false });
      blobMats.set(blobTexture, bm);
    }
    this.blob = new THREE.Mesh(G('blob', () => new THREE.PlaneGeometry(1.1, 1.1)), bm);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.035;
    if (bulk) this.root.scale.setScalar(1.04);
    this.collectSmall();
  }

  /** gom các chi tiết nhỏ (mắt, má, kính, nút, chữ thập…) để ẩn khi ở xa — bớt draw call khi đông người */
  private collectSmall() {
    this.hips.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh || o === this.shield || o === this.rageM) return;
      const g = me.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const r = (g.boundingSphere?.radius ?? 1) * Math.max(o.scale.x, o.scale.y, o.scale.z);
      if (r < 0.075) this.small.push(o);
    });
  }

  /** near = false: ẩn chi tiết nhỏ (gọi mỗi khung, chỉ đổi khi chuyển trạng thái) */
  setDetail(near: boolean) {
    if (near === this.detail) return;
    this.detail = near;
    for (const o of this.small) o.visible = near;
  }

  /** mũ theo lớp, gốc = tâm đầu (bán kính HEAD_R) */
  private hat(id: string): THREE.Object3D {
    const g = new THREE.Group();
    const dome = (r: number, arc: number) => G(`dome${r},${arc}`, () => new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, arc));
    if (id === 'chienbinh') {
      // mũ sắt + kính bảo hộ đẩy lên trán
      mesh(dome(0.37, Math.PI / 2), mat(0x4d6b2f, { rough: 0.8 }), g, 0, 0.04, -0.01).scale.set(1.04, 0.86, 1.08);
      mesh(G('rim', () => new THREE.TorusGeometry(0.375, 0.022, 6, 24)), mat(0x2f4020), g, 0, 0.045, -0.01).rotation.x = Math.PI / 2;
      mesh(box(0.3, 0.07, 0.06), mat(0x222222, { metal: 0.3, rough: 0.3 }), g, 0, 0.22, 0.31).rotation.x = -0.5;
      for (const sx of [-1, 1]) mesh(G('lens', () => new THREE.CylinderGeometry(0.045, 0.045, 0.025, 12)), mat(0x7dd3fc, { basic: true }), g, 0.075 * sx, 0.225, 0.338, false).rotation.x = Math.PI / 2 - 0.5;
    } else if (id === 'ysi') {
      // mũ y tá trắng có chữ thập đỏ
      const cap = mesh(G('ncap', () => new THREE.CylinderGeometry(0.2, 0.23, 0.13, 18)), mat(0xffffff, { rough: 0.9 }), g, 0, 0.36, -0.02);
      cap.rotation.x = -0.15;
      const red = mat(0xe11d48, { basic: true });
      mesh(box(0.08, 0.025, 0.01), red, cap, 0, 0.005, 0.218, false);
      mesh(box(0.025, 0.08, 0.01), red, cap, 0, 0.005, 0.218, false);
    } else if (id === 'kysu') {
      // mũ bảo hộ vàng + vành + gờ + đèn đội đầu
      const yel = mat(0xfacc15, { rough: 0.45 });
      mesh(dome(0.37, Math.PI / 2), yel, g, 0, 0.05, 0).scale.set(1, 0.9, 1.05);
      mesh(G('brim', () => new THREE.CylinderGeometry(0.43, 0.43, 0.02, 24)), mat(0xeab308, { rough: 0.45 }), g, 0, 0.055, 0.04);
      const ridge = mesh(G('ridge', () => new THREE.TorusGeometry(0.335, 0.025, 6, 16, Math.PI)), mat(0xeab308, { rough: 0.45 }), g, 0, 0.05, 0);
      ridge.rotation.y = Math.PI / 2;
      ridge.scale.set(1.05, 0.9, 1);
      mesh(G('lamp', () => new THREE.CylinderGeometry(0.04, 0.045, 0.05, 10).rotateX(Math.PI / 2)), mat(0x333333), g, 0, 0.2, 0.36);
      mesh(G('lampL', () => new THREE.CircleGeometry(0.035, 10)), mat(0xfff7b0, { basic: true }), g, 0, 0.2, 0.387, false);
    } else if (id === 'dausi') {
      // mũ giáp + sừng + mào màu lớp
      const steel = mat(0x8a919c, { metal: 0.35, rough: 0.45 });
      mesh(dome(0.37, Math.PI / 2.5), steel, g, 0, 0.02, 0).scale.set(1.05, 1, 1.05);
      mesh(G('hband', () => new THREE.TorusGeometry(0.37, 0.028, 6, 24)), mat(0x3f444d, { metal: 0.6, rough: 0.4 }), g, 0, 0.135, 0).rotation.x = Math.PI / 2;
      for (const sx of [-1, 1]) {
        const horn = mesh(G('horn', () => new THREE.ConeGeometry(0.06, 0.3, 10)), mat(0xf5f0e0, { rough: 0.5 }), g, 0.33 * sx, 0.27, 0);
        horn.rotation.z = -1.0 * sx;
      }
      mesh(G('crest', () => new THREE.ConeGeometry(0.045, 0.16, 6)), mat(this.look.color), g, 0, 0.43, -0.03);
    } else if (id === 'xathu') {
      // mũ len ngụy trang + kính ngắm (một mắt ống dài) đẩy lên trán
      const wool = mat(0x3f4a26, { rough: 0.95 });
      mesh(dome(0.372, Math.PI / 2.1), wool, g, 0, 0.03, -0.01).scale.set(1.03, 0.98, 1.06);
      mesh(G('fold', () => new THREE.TorusGeometry(0.37, 0.045, 6, 24)), mat(0x55623a, { rough: 0.95 }), g, 0, 0.07, -0.01).rotation.x = Math.PI / 2;
      mesh(G('pom', () => new THREE.SphereGeometry(0.07, 8, 6)), mat(0x55623a, { rough: 0.95 }), g, 0, 0.42, -0.02);
      const gog = new THREE.Group();
      gog.position.set(0, 0.17, 0.3);
      gog.rotation.x = -0.45;
      g.add(gog);
      const blk = mat(0x1a1c20, { metal: 0.3, rough: 0.35 });
      mesh(box(0.3, 0.07, 0.07), blk, gog, 0, 0, 0);
      mesh(cylZ(0.048, 0.1), blk, gog, -0.075, 0, 0.06);
      mesh(cylZ(0.05, 0.2), blk, gog, 0.075, 0, 0.11); // ống ngắm
      const lensM = mat(0x4ade80, { basic: true });
      mesh(cylZ(0.036, 0.012), lensM, gog, -0.075, 0, 0.112, false);
      mesh(cylZ(0.038, 0.012), lensM, gog, 0.075, 0, 0.212, false);
    } else if (id === 'phaothu') {
      // mũ phi công da + vạt che tai + kính phi công
      const lea = mat(0x7a4a26, { rough: 0.75 });
      mesh(dome(0.373, Math.PI / 1.85), lea, g, 0, 0.02, -0.01).scale.set(1.03, 0.97, 1.05);
      for (const sx of [-1, 1]) mesh(sph(0.11, 10, 8), lea, g, 0.335 * sx, -0.06, 0.0).scale.set(0.42, 1, 0.85);
      const band = mesh(G('gband', () => new THREE.TorusGeometry(0.376, 0.024, 6, 24)), mat(0x2b2118, { rough: 0.7 }), g, 0, 0.16, 0);
      band.rotation.x = Math.PI / 2 - 0.25;
      const brass = mat(0xb08d57, { metal: 0.7, rough: 0.35 });
      const lensM = mat(0x93c5fd, { basic: true });
      for (const sx of [-1, 1]) {
        const ring = mesh(cylZ(0.07, 0.05, 12), brass, g, 0.1 * sx, 0.24, 0.29);
        ring.rotation.x = -0.6;
        const ln = mesh(cylZ(0.055, 0.056, 12), lensM, g, 0.1 * sx, 0.244, 0.297, false);
        ln.rotation.x = -0.6;
      }
    } else if (id === 'caoboi') {
      // mũ cao bồi: vành rộng cong mép, chóp lõm, dải mũ
      const felt = mat(0x8b5a2b, { rough: 0.85 });
      const hg = new THREE.Group();
      hg.position.set(0, 0.2, -0.01);
      hg.rotation.x = -0.12;
      g.add(hg);
      mesh(cylY(0.5, 0.5, 0.028, 26), felt, hg, 0, 0, 0);
      const lip = mesh(G('hlip', () => new THREE.TorusGeometry(0.49, 0.032, 6, 26)), felt, hg, 0, 0.02, 0);
      lip.rotation.x = Math.PI / 2;
      lip.scale.set(1, 0.82, 1);
      const crown = mesh(cylY(0.235, 0.285, 0.27, 16), felt, hg, 0, 0.145, 0);
      crown.scale.set(1, 1, 0.88);
      mesh(cylY(0.289, 0.289, 0.055, 16), mat(0x3b2414, { rough: 0.7 }), hg, 0, 0.04, 0).scale.set(1, 1, 0.88);
      const dent = mesh(box(0.05, 0.03, 0.36), mat(0x6f4421, { rough: 0.85 }), hg, 0, 0.285, 0);
      dent.castShadow = false;
    }
    return g;
  }

  setTier(tier: number) {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.gun) this.gunPose.remove(this.gun.g);
    const w = weaponLook(this.cls, tier);
    this.gun = gunModel(w.model, w.color);
    this.gunPose.add(this.gun.g);
  }

  kick() {
    this.recoil = 1;
  }

  /** trúng đòn từ hướng (sx, sz) */
  hit(sx: number, sz: number) {
    this.hitT = 1;
    this.hitDir = Math.atan2(sx - this.root.position.x, sz - this.root.position.z) - this.root.rotation.y;
  }

  skill(kind: Skill) {
    this.skillKind = kind;
    this.skillDur = kind === 'throw' ? 0.55 : kind === 'build' ? 0.8 : kind === 'stomp' ? 0.6 : kind === 'ult' ? 0.9 : 0.5;
    this.skillT = this.skillDur;
  }

  private setArm(arm: Arm, A: number, B: number) {
    arm.upper.scale.y = A;
    arm.el.position.y = -A;
    arm.fore.scale.y = B;
    arm.hand.position.y = -B;
  }

  /** IK hai khúc co giãn: vai + khuỷu để bàn tay chạm T (toạ độ `aim`); quá tầm thì tay sợi mì giãn ra */
  private ik(arm: Arm, T: THREE.Vector3) {
    const S = arm.sh.position;
    const d = this.tmpA.copy(T).sub(S);
    let L = d.length();
    if (L < 1e-4) {
      d.copy(DOWN);
      L = 1e-4;
    } else d.multiplyScalar(1 / L);
    const reach = (UA + FA) * 0.97;
    const s = clamp(L / reach, 1, ARM_STRETCH);
    const A = UA * s, B = FA * s;
    const Lc = clamp(L, Math.abs(A - B) + 0.02, A + B - 1e-3);
    const cosA = clamp((A * A + Lc * Lc - B * B) / (2 * A * Lc), -1, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const p = this.tmpP.copy(arm.pole).addScaledVector(d, -arm.pole.dot(d)).normalize();
    const E = this.tmpE.copy(S).addScaledVector(d, A * cosA).addScaledVector(p, A * sinA);
    this.q1.setFromUnitVectors(DOWN, this.tmpB.copy(E).sub(S).normalize());
    arm.sh.quaternion.copy(this.q1);
    const tgt = this.tmpB.copy(S).addScaledVector(d, Lc).sub(E).normalize();
    this.q2.setFromUnitVectors(DOWN, tgt);
    arm.el.quaternion.copy(this.q1.invert()).multiply(this.q2);
    this.setArm(arm, A, B);
  }

  update(P: AvatarPose) {
    const dt = clamp(P.dt, 0, 0.1);
    const t = P.t;
    const kk = (r: number) => 1 - Math.exp(-dt * r);
    this.root.position.set(P.x, P.y, P.z);
    this.root.rotation.set(0, P.yaw, 0);
    this.blob.position.set(P.x, 0.035, P.z);
    const bs = Math.max(0.35, 1 - P.y * 0.25);
    this.blob.scale.set(bs, bs, bs);
    this.shield.visible = P.brace;
    this.rageM.visible = P.rage;
    if (P.rage) this.rageM.scale.set(0.8, 0.9, 0.8).multiplyScalar(0.95 + Math.sin(t * 10) * 0.05);

    // ---- vận tốc từ chuyển động hiển thị (lọc: bỏ cú nhảy do hiệu chỉnh/dịch chuyển) ----
    if (Number.isNaN(this.lastX)) {
      this.lastX = P.x;
      this.lastZ = P.z;
    }
    if (dt > 1e-4) {
      let rvx = (P.x - this.lastX) / dt, rvz = (P.z - this.lastZ) / dt;
      const rs = Math.hypot(rvx, rvz);
      if (rs > 30) {
        rvx = this.vx;
        rvz = this.vz;
      } else if (rs > 13) {
        rvx *= 13 / rs;
        rvz *= 13 / rs;
      }
      const kv = kk(9);
      this.vx += (rvx - this.vx) * kv;
      this.vz += (rvz - this.vz) * kv;
    }
    this.lastX = P.x;
    this.lastZ = P.z;
    const speed = Math.hypot(this.vx, this.vz);
    this.speedS += (speed - this.speedS) * kk(6);
    const spd = this.speedS;

    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.hitT = Math.max(0, this.hitT - dt * 3.5);
    if (this.skillT > 0) this.skillT = Math.max(0, this.skillT - dt);
    // ---- trên không / đáp đất (trộn dần, không bật) ----
    const air = P.y > 0.04 && !P.down;
    if (this.wasAir && !air) this.landT = 1;
    this.wasAir = air;
    this.airK += ((air ? 1 : 0) - this.airK) * kk(air ? 10 : 18);
    this.landT = Math.max(0, this.landT - dt * 4);
    this.landS += (this.landT - this.landS) * kk(28);
    const land = this.landS;
    this.sprintK += ((P.sprint && !P.down ? 1 : 0) - this.sprintK) * kk(8);
    this.adsK += ((P.ads && !P.down ? 1 : 0) - this.adsK) * kk(14);
    this.crawlK += ((P.down ? 1 : 0) - this.crawlK) * kk(7);
    this.deadK += ((P.down === 2 ? 1 : 0) - this.deadK) * kk(5);
    this.kneelK += ((P.reviving || (this.skillT > 0 && this.skillKind === 'build') ? 1 : 0) - this.kneelK) * kk(9);
    this.braceK += ((P.brace ? 1 : 0) - this.braceK) * kk(10);
    const crawl = smooth01(this.crawlK);
    const deadK = this.deadK;

    // ---- hướng chân (toạ độ thế giới, xoay mượt theo góc ngắn nhất) ----
    const mv = smooth01((spd - 0.25) / 0.9); // trọng số "đang di chuyển"
    let rel = 0;
    if (speed > 0.35) {
      rel = wrapPi(Math.atan2(this.vx, this.vz) - P.yaw);
      // chạy lùi: có trễ để không lật qua lại ở góc chéo
      const ar = Math.abs(rel);
      if (!this.backward && ar > 2.0) this.backward = true;
      else if (this.backward && ar < 1.65) this.backward = false;
      if (this.backward) rel = wrapPi(rel + Math.PI);
      rel = clamp(rel, -1.25, 1.25);
    }
    this.backK += ((this.backward && mv > 0.2 ? 1 : 0) - this.backK) * kk(6);
    const legTarget = P.yaw + rel * mv * (1 - crawl);
    if (Number.isNaN(this.legYawW)) this.legYawW = legTarget;
    this.legYawW += wrapPi(legTarget - this.legYawW) * kk(mv > 0.3 ? 9 : 5);
    let hipYaw = wrapPi(this.legYawW - P.yaw);
    if (Math.abs(hipYaw) > 1.4) {
      // xoay camera quá nhanh: chân bị kéo theo (vẫn liên tục)
      hipYaw = clamp(hipYaw, -1.4, 1.4);
      this.legYawW = P.yaw + hipYaw;
    }

    // ---- pha bước chân: cộng dồn liên tục từ tốc độ đã lọc ----
    const run = clamp(spd / 5.5, 0, 1);
    const stride = 1.0 + this.sprintK * 0.35; // m mỗi nửa chu kỳ
    const dir = 1 - 2 * this.backK;
    this.phase += dir * Math.min(spd / stride, 7.5) * dt * Math.PI;
    if (this.phase > 1e4 || this.phase < -1e4) this.phase %= Math.PI * 2;
    const sw = Math.sin(this.phase);
    const cw = Math.cos(this.phase);

    // ---- mục tiêu tư thế ----
    const gait = run * mv * (1 - this.airK);
    const amp = gait * (0.85 + this.sprintK * 0.3);
    let thL = sw * amp, thR = -sw * amp;
    let knL = 0.06 + softPos(-cw) * 1.1 * gait;
    let knR = 0.06 + softPos(cw) * 1.1 * gait;
    // trên không: co một chân, duỗi một chân
    const ak = this.airK;
    thL = lerp(thL, -0.85, ak);
    knL = lerp(knL, 1.15, ak);
    thR = lerp(thR, -0.2, ak);
    knR = lerp(knR, 0.5, ak);
    // đáp đất: khuỵu gối
    knL += land * 0.5;
    knR += land * 0.5;
    thL -= land * 0.25;
    thR -= land * 0.25;
    // nảy theo bước: hàm trơn (cos²) thay cho |cos| gãy khúc
    let bob = gait * (0.045 * cw * cw - 0.02) - land * 0.06;
    const breath = Math.sin(t * 2.1) * (1 - run);
    const chestY = breath * 0.008;
    let sq = 1 + breath * 0.012 + Math.sin(this.phase * 2 - 0.6) * 0.03 * gait - land * 0.12 + ak * 0.05;
    // lắc lư sang bên theo bước chạy (dáng đi lạch bạch) + nghiêng khi chạy nhanh / lùi
    let crz = sw * 0.06 * gait - Math.sin(hipYaw) * 0.08 * run * mv;
    let crx = (0.1 * run + this.sprintK * 0.22 - this.backK * 0.2 * run) * mv;
    // quỳ (đỡ đồng đội / dựng đồ)
    const q = this.kneelK;
    if (q > 0.001) {
      bob -= 0.16 * q;
      thL = lerp(thL, -1.4, q);
      knL = lerp(knL, 1.5, q);
      thR = lerp(thR, 0.2, q);
      knR = lerp(knR, 1.9, q);
      crx += 0.3 * q;
    }
    // gồng: hạ trọng tâm, người dẹt lại
    const bk = this.braceK;
    bob -= 0.05 * bk;
    sq -= 0.05 * bk;
    knL += 0.4 * bk;
    knR += 0.4 * bk;
    thL -= 0.25 * bk;
    thR -= 0.25 * bk;

    // thân trên theo hướng ngắm
    const pitch = P.pitch;
    let aimX = -pitch * 0.75;
    let nrx = -pitch * 0.2;
    crx += -pitch * 0.12;
    let hdx = 0;
    let hdz = 0;
    // trúng đòn: giật ngược hướng đòn
    if (this.hitT > 0) {
      const h = Math.sin(this.hitT * Math.PI) * 0.35;
      crx -= Math.cos(this.hitDir) * h;
      crz += Math.sin(this.hitDir) * h;
      hdx -= h * 0.4;
      sq -= h * 0.15;
    }
    // dậm đất: nhảy lên rồi đập xuống
    if (this.skillT > 0 && this.skillKind === 'stomp') {
      const p = 1 - this.skillT / this.skillDur;
      const up = p < 0.5 ? Math.sin(p * Math.PI) : 0;
      const slam = p > 0.5 ? Math.sin((p - 0.5) * 2 * Math.PI) : 0;
      bob += up * 0.18 - slam * 0.12;
      crx += slam * 0.5 - 0.2 * up;
      sq += up * 0.08 - slam * 0.18;
      thL -= 0.9 * up;
      thR -= 0.9 * up;
      knL += 1.2 * up + slam * 0.5;
      knR += 1.2 * up + slam * 0.5;
    }
    if (this.skillT > 0 && this.skillKind === 'ult') {
      const u = Math.sin((1 - this.skillT / this.skillDur) * Math.PI);
      hdx -= 0.3 * u;
      sq += 0.08 * u;
    }
    // nghiêng đầu nhẹ khi đứng yên cho sinh động
    hdz += Math.sin(t * 0.9 + this.blinkOff * 7) * 0.04 * (1 - run);

    // ---- gục: nằm sấp bò lết / tử trận nằm ngửa (trộn theo crawl, deadK) ----
    let hy = HIP_Y + bob;
    let hrx = 0;
    const crawlW = Math.sin(t * 5) * Math.min(1, spd / 0.8) * (1 - deadK);
    if (crawl > 0.001) {
      hy = lerp(hy, 0.3, crawl);
      hrx = lerp(1.45, -1.5, deadK) * crawl;
      crx = lerp(crx, lerp(-0.2, 0, deadK), crawl);
      crz *= 1 - crawl;
      nrx = lerp(nrx, lerp(-0.45, 0.2, deadK), crawl);
      sq = lerp(sq, 1, crawl);
      thL = lerp(thL, 0.15 + crawlW * 0.35, crawl);
      thR = lerp(thR, 0.15 - crawlW * 0.35, crawl);
      knL = lerp(knL, 0.3 + Math.max(0, crawlW) * 0.6, crawl);
      knR = lerp(knR, 0.3 + Math.max(0, -crawlW) * 0.6, crawl);
      aimX *= 1 - crawl;
    }

    // ---- súng ----
    const gun = this.gun;
    const hold = gun ? gun.hold : this.tmpA.set(0.17, -0.08, 0.38);
    const r = this.recoil * this.recoil;
    let gpx = hold.x * (1 - this.adsK * 0.88);
    let gpy = hold.y + this.adsK * 0.12;
    let gpz = hold.z + this.adsK * 0.03 - r * 0.07;
    let grx = -r * 0.24;
    let gry = 0;
    let grz = 0;
    const s = this.sprintK;
    gpx += 0.03 * s;
    gpy -= 0.1 * s - sw * 0.025 * s * mv;
    gpz -= 0.08 * s;
    grx += 0.75 * s;
    gry += 0.65 * s;
    let reloadOut = 0;
    if (P.reload >= 0 && !P.down) {
      // nạp đạn: nghiêng súng, tay trái rút băng xuống hông rồi lắp lại
      const rp = P.reload;
      const tilt = Math.sin(Math.min(1, rp * 1.15) * Math.PI);
      grz += 0.55 * tilt;
      grx += 0.25 * tilt;
      gpy -= 0.03 * tilt;
      reloadOut = Math.sin(Math.min(1, rp * 1.4) * Math.PI);
    }
    // nhịp súng nhún theo bước
    gpy += Math.sin(this.phase * 2) * 0.012 * gait * (1 - s);

    // ---- giảm chấn tất cả kênh (độc lập khung hình) ----
    const ch = this.ch;
    const first = !this.chInit;
    const K = kk(22);
    const KG = kk(38);
    const d = (i: number, v: number, k = K) => (first ? (ch[i] = v) : (ch[i] += (v - ch[i]) * k));
    this.hips.position.set(0, d(C_HY, hy), 0);
    this.hips.rotation.set(d(C_HRX, hrx, kk(12)), hipYaw, 0);
    this.spine.rotation.set(0, -hipYaw * (1 - crawl), 0);
    this.chestG.position.set(0, d(C_CY, chestY), 0);
    this.chestG.rotation.set(d(C_CRX, crx), 0, d(C_CRZ, crz));
    const sqv = d(C_SQ, sq);
    const sxz = 1 / Math.sqrt(sqv);
    this.chestG.scale.set(sxz, sqv, sxz);
    this.neck.rotation.set(d(C_NRX, nrx), 0, 0);
    this.headG.rotation.set(d(C_HDX, hdx), 0, d(C_HDZ, hdz));
    this.thL.rotation.set(d(C_THL, thL), 0, 0);
    this.thR.rotation.set(d(C_THR, thR), 0, 0);
    this.knL.rotation.set(d(C_KNL, knL), 0, 0);
    this.knR.rotation.set(d(C_KNR, knR), 0, 0);
    this.ankL.rotation.set(d(C_AKL, -thL * 0.3), 0, 0);
    this.ankR.rotation.set(d(C_AKR, -thR * 0.3), 0, 0);
    this.aim.rotation.set(d(C_AIM, aimX, kk(40)), 0, 0);
    const gp = this.gunPose;
    gp.position.set(d(C_GPX, gpx, KG), d(C_GPY, gpy, KG), d(C_GPZ, gpz, KG));
    gp.rotation.set(d(C_GRX, grx, KG), d(C_GRY, gry, KG), d(C_GRZ, grz, KG));
    // gục: súng thu nhỏ dần rồi ẩn (không bật tắt đột ngột)
    const gs = d(C_GS, 1 - smooth01((crawl - 0.25) / 0.35), kk(12));
    gp.visible = gs > 0.04;
    if (gun) {
      gun.g.scale.setScalar(GUN_S * Math.max(0.04, gs));
      if (gun.mag) gun.mag.visible = reloadOut < 0.6;
    }
    gp.updateMatrix();

    // ---- tay ----
    const Tr = this.tR;
    const Tl = this.tL;
    if (gun) {
      // tay phải: báng
      Tr.copy(gun.grip).applyMatrix4(gp.matrix);
      if (this.skillT > 0 && (this.skillKind === 'throw' || this.skillKind === 'ult')) {
        const p = 1 - this.skillT / this.skillDur;
        const throwK = Math.sin(p * Math.PI);
        if (this.skillKind === 'throw') {
          // vung tay qua vai ra trước
          const ang = -2.6 + p * 3.6;
          Tr.lerp(this.tmpB.set(0.36, -Math.cos(ang) * 0.42 + 0.05, SHO_Z + Math.sin(ang) * 0.42), throwK);
        } else {
          // giơ tay lên trời (pháo sáng / gầm)
          Tr.lerp(this.tmpB.set(0.42, 0.5, 0.1), throwK);
        }
      }
      // tay trái: ốp trước; với không tới thì trượt dần về phía báng
      Tl.copy(gun.fore).applyMatrix4(gp.matrix);
      const Tf = this.tF.copy(Tl);
      const Tg = this.tG.copy(gun.grip).applyMatrix4(gp.matrix);
      const maxL = (UA + FA) * ARM_STRETCH * 0.95;
      const shL = this.armL.sh.position;
      if (Tf.distanceTo(shL) > maxL) {
        // tìm điểm trên đoạn ốp→báng vừa tầm (liên tục theo vị trí súng, không nhảy bậc)
        let lo = 0, hi = 1;
        for (let i = 0; i < 6; i++) {
          const m = (lo + hi) / 2;
          if (this.tmpB.lerpVectors(Tf, Tg, m).distanceTo(shL) > maxL) lo = m;
          else hi = m;
        }
        Tl.lerpVectors(Tf, Tg, hi);
      }
      if (reloadOut > 0) Tl.lerp(this.tmpB.set(-0.36, -0.32, 0.2), reloadOut);
      if (this.skillT > 0 && this.skillKind === 'build') {
        const p = 1 - this.skillT / this.skillDur;
        const bw = Math.sin(p * Math.PI);
        Tl.lerp(this.tmpB.set(-0.05, -0.42 + Math.abs(Math.sin(p * Math.PI * 4)) * 0.15, 0.48), bw);
      }
    } else {
      Tr.set(0.42, -0.36, 0.14);
      Tl.set(-0.42, -0.36, 0.14);
    }
    // gục: tay với ra trước (bò) / dang ra (chết) / vẫy cầu cứu khi nằm yên
    if (crawl > 0.001) {
      const wave = !P.down || P.down === 2 ? 0 : (1 - Math.min(1, spd / 0.3)) * (1 - deadK);
      const cr = this.tmpB.set(0.3, 0.42 + crawlW * 0.12, 0.12 - crawlW * 0.1);
      cr.lerp(this.tmpE.set(0.62, 0.0, 0.05), deadK);
      cr.lerp(this.tmpE.set(0.4, 0.5 + Math.sin(t * 6) * 0.1, 0.3 + Math.sin(t * 3) * 0.12), wave);
      Tr.lerp(cr, crawl);
      const cl = this.tmpB.set(-0.3, 0.42 - crawlW * 0.12, 0.12 + crawlW * 0.1);
      cl.lerp(this.tmpE.set(-0.62, 0.0, 0.05), deadK);
      Tl.lerp(cl, crawl);
    }
    const KA = kk(30);
    Tr.set(d(C_TR, Tr.x, KA), d(C_TR + 1, Tr.y, KA), d(C_TR + 2, Tr.z, KA));
    Tl.set(d(C_TL, Tl.x, KA), d(C_TL + 1, Tl.y, KA), d(C_TL + 2, Tl.z, KA));
    this.ik(this.armR, Tr);
    this.ik(this.armL, Tl);
    this.chInit = true;

    // ---- chớp mắt (đường cong trơn; tử trận thì nhắm hẳn) ----
    const bl = (t * 0.27 + this.blinkOff) % 1;
    const blink = bl < 0.045 ? Math.sin((bl / 0.045) * Math.PI) : 0;
    const ey = lerp(1.35 - blink * 1.15, 0.15, deadK);
    for (const e of this.eyes) e.scale.y = ey;
  }

  muzzleWorld(out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    if (!this.gun) return out.copy(this.root.position);
    return this.gun.g.localToWorld(out.copy(this.gun.muzzle));
  }

  setVisible(v: boolean) {
    this.hips.visible = v;
  }
}
