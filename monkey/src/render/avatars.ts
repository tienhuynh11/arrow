// Nhân vật người chơi kiểu "hạt đậu" (giống nhân vật minigame / Fall Guys): thân tròn mũm mĩm liền đầu,
// mặt dán phía trước, tay "sợi mì" co giãn bám đúng báng/ốp súng, chân ngắn hai khúc.
// Thân trên xoay theo hướng NGẮM, chân theo hướng CHẠY (chạy lùi, đi ngang đúng chiều), ngẩng theo pitch.
// Hoạt cảnh: thở, chạy, chạy nhanh hạ súng, nhảy/đáp (bóp dẹt), giật súng, ngắm, nạp đạn, trúng đòn, gục bò, chết,
// đỡ đồng đội, ném, dựng, dậm đất, gồng, tuyệt chiêu, chớp mắt. Mỗi lớp một bộ đồ riêng; màu thắt lưng + giày theo người chơi.
// Cao ~1.5 m (không tính mũ). Hình khối + vật liệu dùng chung giữa các nhân vật.

import * as THREE from 'three';
import { CLASSES, WEAPONS } from '@shared/monkey/content';

const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
/** màu riêng của từng người chơi (thắt lưng, giày) */
const PCOL = [0xffd23f, 0x38bdf8, 0xf472b6, 0xa3e635];
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
const SHO_X = 0.27;
const SHO_Z = 0.12;
const ARM_MIN = 0.16;
const ARM_MAX = 0.56;
const ARM_REST = 0.3;
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
const cylZ = (r: number, len: number) => G(`c${r},${len}`, () => new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2));
/** khối tròn treo từ khớp xuống theo -Y */
const limbGeo = (r: number, len: number) => G(`l${r},${len}`, () => new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 12).translate(0, -len / 2, 0));
/** cánh tay "sợi mì": trụ dài 1 từ vai xuống -Y, co giãn bằng scale.y */
const armGeo = () => G('arm', () => new THREE.CylinderGeometry(0.072, 0.06, 1, 10, 1, true).translate(0, -0.5, 0));

function shade(hex: number, k: number) {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  parent.add(o);
  return o;
}

let shieldMat: THREE.Material | null = null;
let rageMat: THREE.Material | null = null;
const blobMats = new Map<THREE.Texture, THREE.Material>();

/* ---------- súng: mô hình + điểm cầm (điểm cầm đã nhân tỉ lệ GUN_S) ---------- */
interface Gun { g: THREE.Group; grip: THREE.Vector3; fore: THREE.Vector3; muzzle: THREE.Vector3; mag: THREE.Object3D | null }
function gunModel(tier: number): Gun {
  const g = new THREE.Group();
  const w = WEAPONS[tier];
  const metal = mat(0x2b2f36, { rough: 0.45, metal: 0.6 });
  const dark = mat(0x16181c, { rough: 0.5, metal: 0.4 });
  const accent = mat(w.color, { rough: 0.5, metal: 0.2 });
  const wood = mat(0x8a5a2b, { rough: 0.8 });
  const b = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => mesh(box(sx, sy, sz), m, g, x, y, z);
  const c = (r: number, len: number, x: number, y: number, z: number, m: THREE.Material) => mesh(cylZ(r, len), m, g, x, y, z);
  let grip = new THREE.Vector3(0, -0.1, 0);
  let fore = new THREE.Vector3(0, -0.12, 0.05);
  let len = 0.3;
  let mag: THREE.Object3D | null = null;
  switch (tier) {
    case 0: // súng lục: hai tay ôm báng
      b(0.06, 0.09, 0.26, 0, 0.02, 0.09, metal);
      b(0.055, 0.03, 0.2, 0, 0.075, 0.08, dark);
      mag = b(0.05, 0.15, 0.07, 0, -0.08, 0, accent);
      mag.rotation.x = -0.15;
      c(0.016, 0.06, 0, 0.03, 0.24, dark);
      grip = new THREE.Vector3(0, -0.07, 0);
      fore = new THREE.Vector3(0.03, -0.1, 0.03);
      len = 0.27;
      break;
    case 1: // tiểu liên
      b(0.08, 0.11, 0.38, 0, 0, 0.1, metal);
      b(0.06, 0.07, 0.2, 0, -0.01, -0.17, dark);
      mag = b(0.05, 0.2, 0.06, 0, -0.14, 0.13, accent);
      b(0.05, 0.12, 0.06, 0, -0.1, -0.03, dark);
      c(0.02, 0.14, 0, 0.02, 0.35, dark);
      grip = new THREE.Vector3(0, -0.1, -0.03);
      fore = new THREE.Vector3(0, -0.07, 0.25);
      len = 0.43;
      break;
    case 2: // súng săn
      c(0.03, 0.75, 0, 0.02, 0.27, metal);
      c(0.026, 0.55, 0, -0.04, 0.22, dark);
      b(0.08, 0.075, 0.24, 0, -0.04, 0.3, wood);
      b(0.07, 0.12, 0.3, 0, -0.04, -0.2, wood);
      grip = new THREE.Vector3(0, -0.09, -0.08);
      fore = new THREE.Vector3(0, -0.07, 0.3);
      len = 0.65;
      break;
    case 3: // súng trường
      b(0.075, 0.12, 0.62, 0, 0, 0.14, accent);
      b(0.06, 0.06, 0.22, 0, 0.1, 0.08, dark);
      c(0.03, 0.06, 0, 0.1, 0.21, mat(0x88ccff, { basic: true }));
      mag = b(0.05, 0.2, 0.08, 0, -0.15, 0.14, metal);
      mag.rotation.x = 0.25;
      b(0.06, 0.12, 0.24, 0, -0.03, -0.27, metal);
      c(0.018, 0.2, 0, 0.02, 0.53, dark);
      grip = new THREE.Vector3(0, -0.1, 0.0);
      fore = new THREE.Vector3(0, -0.07, 0.34);
      len = 0.64;
      break;
    default: { // pháo chuối
      c(0.11, 0.9, 0, 0.04, 0.18, accent);
      c(0.125, 0.08, 0, 0.04, 0.6, dark);
      b(0.06, 0.16, 0.08, 0, -0.12, 0.0, metal);
      b(0.05, 0.12, 0.06, 0, -0.1, 0.28, metal);
      const ban = mesh(G('banana', () => new THREE.TorusGeometry(0.09, 0.03, 6, 10, Math.PI * 0.9)), mat(0xffe14a, { emissive: 0x3a2a00 }), g, 0, 0.18, 0.1);
      ban.rotation.set(0, Math.PI / 2, 0.5);
      grip = new THREE.Vector3(0, -0.15, 0);
      fore = new THREE.Vector3(0, -0.12, 0.28);
      len = 0.64;
    }
  }
  g.scale.setScalar(GUN_S);
  // muzzle ở toạ độ riêng của g (localToWorld đã tính scale), grip/fore ở toạ độ gunPose
  return { g, grip: grip.multiplyScalar(GUN_S), fore: fore.multiplyScalar(GUN_S), muzzle: new THREE.Vector3(0, 0.02, len), mag };
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
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private handL: THREE.Mesh;
  private handR: THREE.Mesh;
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
  /* trạng thái hoạt cảnh */
  private phase = 0;
  private recoil = 0;
  private hitT = 0;
  private hitDir = 0;
  private skillT = 0;
  private skillDur = 0;
  private skillKind: Skill = 'throw';
  private lastX = NaN;
  private lastZ = NaN;
  private lastY = 0;
  private vx = 0;
  private vz = 0;
  private hipYaw = 0;
  private landT = 0;
  private air = 0;
  private sprintK = 0;
  private adsK = 0;
  private crawlK = 0;
  private kneelK = 0;
  private tR = new THREE.Vector3();
  private tL = new THREE.Vector3();
  private tG = new THREE.Vector3();
  private tF = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private eul = new THREE.Euler();

  constructor(cls: number, blobTexture: THREE.Texture, idx = 0) {
    this.cls = cls;
    const c = CLASSES[cls];
    const id = c.id;
    this.blinkOff = idx * 0.31 + cls * 0.17;
    const skin = mat(SKINS[idx & 3], { rough: 0.6 });
    const body = mat(c.color, { rough: 0.55 });
    const legM = mat(shade(c.color, 0.78), { rough: 0.6 });
    const pcol = mat(PCOL[idx & 3], { rough: 0.5 });
    const shoeM = mat(PCOL[idx & 3], { rough: 0.45 });
    const ink = mat(0x1d1728, { basic: true });
    const white = mat(0xffffff, { basic: true });
    const red = mat(0xe11d48, { basic: true });
    const bulk = id === 'dausi';

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
    let packCol = 0x5b4a33;
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
    } else {
      // đấu sĩ: giáp vai to + khoá thắt lưng
      const armor = mat(0x8a919c, { metal: 0.35, rough: 0.45 });
      for (const sx of [-1, 1]) {
        const p = mesh(G('pad', () => new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), armor, this.chestG, 0.3 * sx, BODY_Y + 0.21, 0.03);
        p.scale.set(1.15, 0.8, 1.1);
        p.rotation.z = -0.35 * sx;
      }
      mesh(box(0.13, 0.1, 0.03), mat(0xd4a017, { metal: 0.7, rough: 0.35 }), this.chestG, 0, BODY_Y - 0.17, 0.375);
      packCol = 0x2a2d33;
    }
    const pack = mesh(box(0.32, 0.34, 0.15), mat(packCol, { rough: 0.9 }), this.chestG, 0, BODY_Y + 0.1, -0.37);
    pack.rotation.x = 0.06;

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
      if (bulk) mesh(box(0.12, 0.028, 0.02), ink, this.headG, 0.11 * sx, 0.125, 0.338, false).rotation.z = sx * 0.45;
    }
    const mouth = mesh(G('smile', () => new THREE.TorusGeometry(0.05, 0.012, 6, 14, Math.PI)), ink, this.headG, 0, -0.085, 0.368, false);
    mouth.rotation.z = Math.PI;
    this.headG.add(this.hat(id));

    // ---- tay "sợi mì" + súng ----
    this.aim.position.set(0, AIM_Y, 0);
    this.chestG.add(this.aim);
    const arms: THREE.Mesh[] = [];
    const hands: THREE.Mesh[] = [];
    for (const [sh, sx] of [[this.shL, -1], [this.shR, 1]] as const) {
      sh.position.set(SHO_X * sx * (bulk ? 1.05 : 1), 0, SHO_Z);
      this.aim.add(sh);
      arms.push(mesh(armGeo(), body, sh));
      hands.push(mesh(sph(0.088, 12, 10), body, sh));
    }
    [this.armL, this.armR] = arms;
    [this.handL, this.handR] = hands;
    this.setArmLen(this.armL, this.handL, ARM_REST);
    this.setArmLen(this.armR, this.handR, ARM_REST);
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
    } else {
      // mũ giáp + sừng + mào màu lớp
      const steel = mat(0x8a919c, { metal: 0.35, rough: 0.45 });
      mesh(dome(0.37, Math.PI / 2.5), steel, g, 0, 0.02, 0).scale.set(1.05, 1, 1.05);
      mesh(G('hband', () => new THREE.TorusGeometry(0.37, 0.028, 6, 24)), mat(0x3f444d, { metal: 0.6, rough: 0.4 }), g, 0, 0.135, 0).rotation.x = Math.PI / 2;
      for (const sx of [-1, 1]) {
        const horn = mesh(G('horn', () => new THREE.ConeGeometry(0.06, 0.3, 10)), mat(0xf5f0e0, { rough: 0.5 }), g, 0.33 * sx, 0.27, 0);
        horn.rotation.z = -1.0 * sx;
      }
      mesh(G('crest', () => new THREE.ConeGeometry(0.045, 0.16, 6)), mat(CLASSES[this.cls].color), g, 0, 0.43, -0.03);
    }
    return g;
  }

  setTier(tier: number) {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.gun) this.gunPose.remove(this.gun.g);
    this.gun = gunModel(tier);
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

  private setArmLen(arm: THREE.Mesh, hand: THREE.Mesh, L: number) {
    arm.scale.y = Math.max(0.01, L - 0.04);
    hand.position.y = -L;
  }

  /** tay co giãn: xoay vai hướng về T (toạ độ của `aim`), kéo dài tay để bàn tay chạm T */
  private reach(sh: THREE.Object3D, arm: THREE.Mesh, hand: THREE.Mesh, T: THREE.Vector3) {
    const d = this.tmpD.copy(T).sub(sh.position);
    let L = d.length();
    if (L < 1e-4) d.copy(DOWN);
    else d.multiplyScalar(1 / L);
    L = Math.min(ARM_MAX, Math.max(ARM_MIN, L));
    sh.quaternion.setFromUnitVectors(DOWN, d);
    this.setArmLen(arm, hand, L);
  }

  private pose(sh: THREE.Object3D, arm: THREE.Mesh, hand: THREE.Mesh, x: number, z: number, L = ARM_REST) {
    sh.quaternion.setFromEuler(this.eul.set(x, 0, z));
    this.setArmLen(arm, hand, L);
  }

  update(P: AvatarPose) {
    const { dt, t } = P;
    this.root.position.set(P.x, P.y, P.z);
    this.root.rotation.set(0, P.yaw, 0);
    this.blob.position.set(P.x, 0.035, P.z);
    const bs = Math.max(0.35, 1 - P.y * 0.25);
    this.blob.scale.set(bs, bs, bs);
    this.shield.visible = P.brace;
    this.rageM.visible = P.rage;
    if (P.rage) this.rageM.scale.set(0.8, 0.9, 0.8).multiplyScalar(0.95 + Math.sin(t * 10) * 0.05);
    // vận tốc từ chuyển động hiển thị (dùng chung cho mình và đồng đội)
    if (Number.isNaN(this.lastX) || dt <= 0) { this.lastX = P.x; this.lastZ = P.z; }
    const k = 1 - Math.exp(-dt * 12);
    if (dt > 0) {
      this.vx += ((P.x - this.lastX) / dt - this.vx) * k;
      this.vz += ((P.z - this.lastZ) / dt - this.vz) * k;
    }
    this.lastX = P.x;
    this.lastZ = P.z;
    const speed = Math.min(12, Math.hypot(this.vx, this.vz));
    const kk = (r: number) => 1 - Math.exp(-dt * r);
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.hitT = Math.max(0, this.hitT - dt * 3.5);
    if (this.skillT > 0) this.skillT = Math.max(0, this.skillT - dt);
    // đáp đất
    const air = P.y > 0.04 ? 1 : 0;
    if (this.air && !air) this.landT = 1;
    this.air = air;
    this.landT = Math.max(0, this.landT - dt * 5);
    this.sprintK += ((P.sprint && !P.down ? 1 : 0) - this.sprintK) * kk(10);
    this.adsK += ((P.ads && !P.down ? 1 : 0) - this.adsK) * kk(14);
    this.crawlK += ((P.down ? 1 : 0) - this.crawlK) * kk(8);
    this.kneelK += ((P.reviving || (this.skillT > 0 && this.skillKind === 'build') ? 1 : 0) - this.kneelK) * kk(10);

    // ---- hướng chân: chạy tới/ngang theo hướng di chuyển, chạy lùi thì quay chân về trước ----
    const run = Math.min(1, speed / 5.5);
    let rel = 0;
    let backward = false;
    if (speed > 0.6) {
      rel = Math.atan2(this.vx, this.vz) - P.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      if (Math.abs(rel) > 1.9) {
        backward = true;
        rel = rel > 0 ? rel - Math.PI : rel + Math.PI;
      }
      rel = Math.max(-1.25, Math.min(1.25, rel));
    }
    this.hipYaw += (rel * (1 - this.crawlK) - this.hipYaw) * kk(9);
    // chân ngắn → bước ngắn, nhịp nhanh
    const stride = 0.72 + this.sprintK * 0.3;
    this.phase += (backward ? -1 : 1) * (speed / stride) * dt * Math.PI;
    const sw = Math.sin(this.phase);
    const cw = Math.cos(this.phase);

    // ---- đặt lại ----
    this.hips.position.set(0, HIP_Y, 0);
    this.hips.rotation.set(0, this.hipYaw, 0);
    this.spine.rotation.set(0, -this.hipYaw, 0);
    this.chestG.rotation.set(0, 0, 0);
    this.chestG.position.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.headG.rotation.set(0, 0, 0);
    this.gunPose.visible = true;

    // ---- chân ----
    const amp = run * (0.85 + this.sprintK * 0.3);
    this.thL.rotation.set(sw * amp, 0, 0);
    this.thR.rotation.set(-sw * amp, 0, 0);
    this.knL.rotation.set(Math.max(0, -cw) * 1.1 * run + 0.05, 0, 0);
    this.knR.rotation.set(Math.max(0, cw) * 1.1 * run + 0.05, 0, 0);
    this.ankL.rotation.set(-this.thL.rotation.x * 0.3, 0, 0);
    this.ankR.rotation.set(-this.thR.rotation.x * 0.3, 0, 0);
    let bob = Math.abs(cw) * 0.045 * run - run * 0.015;
    if (air) {
      // trên không: co một chân, duỗi một chân
      this.thL.rotation.x = -0.9;
      this.knL.rotation.x = 1.2;
      this.thR.rotation.x = -0.2;
      this.knR.rotation.x = 0.5;
    }
    bob -= this.landT * 0.06;
    this.knL.rotation.x += this.landT * 0.5;
    this.knR.rotation.x += this.landT * 0.5;
    this.thL.rotation.x -= this.landT * 0.25;
    this.thR.rotation.x -= this.landT * 0.25;
    // thở khi đứng + bóp/giãn kiểu hoạt hình (đáp đất dẹt, nảy theo bước)
    const breath = Math.sin(t * 2.1) * (1 - run);
    this.chestG.position.y = breath * 0.008;
    let sq = 1 + breath * 0.012 + Math.sin(this.phase * 2 - 0.6) * 0.035 * run - this.landT * 0.12 + (air ? 0.05 : 0);
    // lắc lư sang bên theo bước chạy (dáng đi lạch bạch)
    this.chestG.rotation.z = sw * 0.07 * run - Math.sin(this.hipYaw) * 0.08 * run;
    // nghiêng người khi chạy nhanh / lùi
    this.chestG.rotation.x = 0.1 * run + this.sprintK * 0.22 - (backward ? 0.12 * run : 0);
    // quỳ (đỡ đồng đội / dựng đồ)
    if (this.kneelK > 0.01) {
      const q = this.kneelK;
      bob -= 0.16 * q;
      this.thL.rotation.x = -1.4 * q + this.thL.rotation.x * (1 - q);
      this.knL.rotation.x = 1.5 * q + this.knL.rotation.x * (1 - q);
      this.thR.rotation.x = 0.2 * q + this.thR.rotation.x * (1 - q);
      this.knR.rotation.x = 1.9 * q + this.knR.rotation.x * (1 - q);
      this.chestG.rotation.x += 0.3 * q;
    }
    // gồng: hạ trọng tâm, người dẹt lại
    if (P.brace) {
      bob -= 0.05;
      sq -= 0.05;
      this.knL.rotation.x += 0.4;
      this.knR.rotation.x += 0.4;
      this.thL.rotation.x -= 0.25;
      this.thR.rotation.x -= 0.25;
    }
    this.hips.position.y += bob;

    // ---- thân trên theo hướng ngắm ----
    const pitch = P.pitch;
    this.aim.rotation.set(-pitch * 0.75, 0, 0);
    this.neck.rotation.x = -pitch * 0.2;
    this.chestG.rotation.x += -pitch * 0.12;
    // trúng đòn: giật ngược hướng đòn
    if (this.hitT > 0) {
      const h = Math.sin(this.hitT * Math.PI) * 0.35;
      this.chestG.rotation.x -= Math.cos(this.hitDir) * h;
      this.chestG.rotation.z += Math.sin(this.hitDir) * h;
      this.headG.rotation.x -= h * 0.4;
      sq -= h * 0.15;
    }

    // ---- súng + tay ----
    const gp = this.gunPose;
    const r = this.recoil;
    gp.position.set(0.12 - this.adsK * 0.12, -0.1 + this.adsK * 0.13, 0.42 + this.adsK * 0.03 - r * 0.06);
    gp.rotation.set(-r * 0.22, 0, 0);
    if (this.sprintK > 0.01) {
      const s = this.sprintK;
      gp.position.x += 0.03 * s;
      gp.position.y -= 0.1 * s - Math.sin(this.phase) * 0.025 * s;
      gp.position.z -= 0.08 * s;
      gp.rotation.x += 0.75 * s;
      gp.rotation.y += 0.65 * s;
    }
    let reloadOut = 0;
    if (P.reload >= 0 && !P.down) {
      // nạp đạn: nghiêng súng, tay trái rút băng xuống hông rồi lắp lại
      const rp = P.reload;
      const tilt = Math.sin(Math.min(1, rp * 1.15) * Math.PI);
      gp.rotation.z += 0.55 * tilt;
      gp.rotation.x += 0.25 * tilt;
      gp.position.y -= 0.03 * tilt;
      reloadOut = Math.sin(Math.min(1, rp * 1.4) * Math.PI);
    }
    if (this.gun?.mag) this.gun.mag.visible = reloadOut < 0.6;
    gp.updateMatrix();
    const gun = this.gun;
    if (gun) {
      // tay phải: báng
      const Tr = this.tR.copy(gun.grip).applyMatrix4(gp.matrix);
      if (this.skillT > 0 && (this.skillKind === 'throw' || this.skillKind === 'ult')) {
        const p = 1 - this.skillT / this.skillDur;
        const throwK = Math.sin(p * Math.PI);
        if (this.skillKind === 'throw') {
          // vung tay qua vai ra trước
          const ang = -2.6 + p * 3.6;
          Tr.lerp(this.tmpD.set(0.3, -Math.cos(ang) * 0.4 + 0.05, SHO_Z + Math.sin(ang) * 0.4), throwK);
        } else {
          // giơ tay lên trời (pháo sáng / gầm)
          Tr.lerp(this.tmpD.set(0.36, 0.5, 0.1), throwK);
        }
      }
      this.reach(this.shR, this.armR, this.handR, Tr);
      // tay trái: ốp trước; tay ngắn không với tới thì trượt dần về phía báng
      const Tl = this.tL.copy(gun.fore).applyMatrix4(gp.matrix);
      const Tf = this.tF.copy(Tl);
      const Tg = this.tG.copy(gun.grip).applyMatrix4(gp.matrix);
      for (let i = 1; i <= 4 && Tl.distanceTo(this.shL.position) > ARM_MAX - 0.04; i++) Tl.lerpVectors(Tf, Tg, i * 0.2);
      if (reloadOut > 0) Tl.lerp(this.tmpD.set(-0.3, -0.3, 0.2), reloadOut);
      if (this.skillT > 0 && this.skillKind === 'build') {
        const p = 1 - this.skillT / this.skillDur;
        Tl.set(-0.05, -0.42 + Math.abs(Math.sin(p * Math.PI * 4)) * 0.15, 0.45);
      }
      this.reach(this.shL, this.armL, this.handL, Tl);
    }
    // dậm đất: nhảy lên rồi đập xuống
    if (this.skillT > 0 && this.skillKind === 'stomp') {
      const p = 1 - this.skillT / this.skillDur;
      const up = p < 0.5 ? Math.sin(p * Math.PI) : 0;
      this.hips.position.y += up * 0.18 - (p > 0.5 ? (1 - p) * 0.2 : 0);
      this.chestG.rotation.x += p > 0.5 ? 0.5 * (1 - p) * 2 : -0.2 * up;
      sq += up * 0.08 - (p > 0.5 ? (1 - p) * 0.3 : 0);
      this.thL.rotation.x -= 0.9 * up;
      this.thR.rotation.x -= 0.9 * up;
      this.knL.rotation.x += 1.2 * up;
      this.knR.rotation.x += 1.2 * up;
    }
    if (this.skillT > 0 && this.skillKind === 'ult') {
      const u = Math.sin((1 - this.skillT / this.skillDur) * Math.PI);
      this.headG.rotation.x -= 0.3 * u;
      sq += 0.08 * u;
    }

    // ---- gục: nằm sấp bò lết / tử trận nằm ngửa ----
    const dead = P.down === 2;
    if (this.crawlK > 0.02) {
      const c = this.crawlK;
      this.hips.position.y = this.hips.position.y * (1 - c) + 0.3 * c;
      this.hips.rotation.x = (dead ? -1.5 : 1.45) * c;
      this.spine.rotation.y *= 1 - c;
      this.chestG.rotation.x = this.chestG.rotation.x * (1 - c) + (dead ? 0 : -0.2) * c;
      this.chestG.rotation.z *= 1 - c;
      this.neck.rotation.x = (dead ? 0.2 : -0.45) * c;
      sq = sq * (1 - c) + c;
      const crawl = Math.sin(t * 5) * Math.min(1, speed / 0.8);
      this.thL.rotation.x = 0.15 + crawl * 0.35;
      this.thR.rotation.x = 0.15 - crawl * 0.35;
      this.knL.rotation.x = 0.3 + Math.max(0, crawl) * 0.6;
      this.knR.rotation.x = 0.3 + Math.max(0, -crawl) * 0.6;
      this.gunPose.visible = c < 0.5;
      // tay với ra trước (bò) / giơ lên cầu cứu
      this.aim.rotation.set(0, 0, 0);
      this.pose(this.shR, this.armR, this.handR, dead ? -0.3 : -2.6 + crawl * 0.5, dead ? 1.2 : 0.2);
      this.pose(this.shL, this.armL, this.handL, dead ? -0.2 : -2.6 - crawl * 0.5, dead ? -1.2 : -0.2);
      if (!dead && speed < 0.3) this.pose(this.shR, this.armR, this.handR, -2.9 + Math.sin(t * 3) * 0.25, 0.3, 0.38);
    }
    const sxz = 1 / Math.sqrt(sq);
    this.chestG.scale.set(sxz, sq, sxz);

    // ---- chớp mắt (tử trận thì nhắm hẳn) ----
    const bl = (t * 0.27 + this.blinkOff) % 1;
    const ey = dead ? 0.15 : bl < 0.035 ? 0.2 : 1.35;
    for (const e of this.eyes) e.scale.y = ey;
    this.lastY = P.y;
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
