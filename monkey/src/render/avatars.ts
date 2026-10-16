// Nhân vật người chơi: khung xương có khớp + IK hai khúc cho tay (bàn tay luôn bám đúng báng/ốp súng),
// thân trên xoay theo hướng NGẮM, hông + chân theo hướng CHẠY (chạy lùi, đi ngang đúng chiều), ngẩng theo pitch.
// Hoạt cảnh: thở, chạy, chạy nhanh hạ súng, nhảy/đáp, giật súng, ngắm, nạp đạn, trúng đòn, gục bò, chết, đỡ đồng đội,
// ném (lựu đạn/hộp cứu thương), dựng (rào/trụ/trạm), dậm đất, gồng, tuyệt chiêu. Mỗi lớp một bộ trang phục riêng.

import * as THREE from 'three';
import { CLASSES, WEAPONS } from '@shared/monkey/content';

const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
const DOWN = new THREE.Vector3(0, -1, 0);

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

/* ---------- vật liệu dùng chung ---------- */
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

/** khối capsule treo từ khớp xuống theo -Y */
function limb(r: number, len: number, m: THREE.Material) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10);
  g.translate(0, -len / 2, 0);
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  return o;
}
function mesh(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  parent.add(o);
  return o;
}

/* ---------- súng: mô hình + điểm cầm ---------- */
interface Gun { g: THREE.Group; grip: THREE.Vector3; fore: THREE.Vector3; muzzle: THREE.Vector3; mag: THREE.Object3D | null }
function gunModel(tier: number): Gun {
  const g = new THREE.Group();
  const w = WEAPONS[tier];
  const metal = mat(0x2b2f36, { rough: 0.45, metal: 0.6 });
  const dark = mat(0x16181c, { rough: 0.5, metal: 0.4 });
  const accent = mat(w.color, { rough: 0.5, metal: 0.2 });
  const wood = mat(0x8a5a2b, { rough: 0.8 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => mesh(new THREE.BoxGeometry(sx, sy, sz), m, g, x, y, z);
  const cyl = (r: number, len: number, x: number, y: number, z: number, m: THREE.Material) => {
    const c = mesh(new THREE.CylinderGeometry(r, r, len, 10), m, g, x, y, z);
    c.rotation.x = Math.PI / 2;
    return c;
  };
  let grip = new THREE.Vector3(0, -0.1, 0);
  let fore = new THREE.Vector3(0, -0.12, 0.05);
  let len = 0.3;
  let mag: THREE.Object3D | null = null;
  switch (tier) {
    case 0: // súng lục: hai tay ôm báng
      box(0.06, 0.09, 0.26, 0, 0.02, 0.09, metal);
      box(0.055, 0.03, 0.2, 0, 0.075, 0.08, dark);
      mag = box(0.05, 0.15, 0.07, 0, -0.08, 0, accent);
      mag.rotation.x = -0.15;
      cyl(0.016, 0.06, 0, 0.03, 0.24, dark);
      grip = new THREE.Vector3(0, -0.07, 0);
      fore = new THREE.Vector3(0.03, -0.1, 0.03);
      len = 0.27;
      break;
    case 1: // tiểu liên
      box(0.08, 0.11, 0.38, 0, 0, 0.1, metal);
      box(0.06, 0.07, 0.2, 0, -0.01, -0.17, dark);
      mag = box(0.05, 0.2, 0.06, 0, -0.14, 0.13, accent);
      box(0.05, 0.12, 0.06, 0, -0.1, -0.03, dark);
      cyl(0.02, 0.14, 0, 0.02, 0.35, dark);
      grip = new THREE.Vector3(0, -0.1, -0.03);
      fore = new THREE.Vector3(0, -0.07, 0.25);
      len = 0.43;
      break;
    case 2: // súng săn
      cyl(0.03, 0.75, 0, 0.02, 0.27, metal);
      cyl(0.026, 0.55, 0, -0.04, 0.22, dark);
      box(0.08, 0.075, 0.24, 0, -0.04, 0.3, wood);
      box(0.07, 0.12, 0.3, 0, -0.04, -0.2, wood);
      mag = null;
      grip = new THREE.Vector3(0, -0.09, -0.08);
      fore = new THREE.Vector3(0, -0.07, 0.3);
      len = 0.65;
      break;
    case 3: // súng trường
      box(0.075, 0.12, 0.62, 0, 0, 0.14, accent);
      box(0.06, 0.06, 0.22, 0, 0.1, 0.08, dark);
      cyl(0.03, 0.06, 0, 0.1, 0.21, mat(0x88ccff, { basic: true }));
      mag = box(0.05, 0.2, 0.08, 0, -0.15, 0.14, metal);
      mag.rotation.x = 0.25;
      box(0.06, 0.12, 0.24, 0, -0.03, -0.27, metal);
      cyl(0.018, 0.2, 0, 0.02, 0.53, dark);
      grip = new THREE.Vector3(0, -0.1, 0.0);
      fore = new THREE.Vector3(0, -0.07, 0.34);
      len = 0.64;
      break;
    default: { // pháo chuối
      const tube = cyl(0.11, 0.9, 0, 0.04, 0.18, accent);
      tube.scale.set(1, 1, 1);
      cyl(0.125, 0.08, 0, 0.04, 0.6, dark);
      box(0.06, 0.16, 0.08, 0, -0.12, 0.0, metal);
      box(0.05, 0.12, 0.06, 0, -0.1, 0.28, metal);
      const b = mesh(new THREE.TorusGeometry(0.09, 0.03, 6, 10, Math.PI * 0.9), mat(0xffe14a, { emissive: 0x3a2a00 }), g, 0, 0.18, 0.1);
      b.rotation.set(0, Math.PI / 2, 0.5);
      grip = new THREE.Vector3(0, -0.15, 0);
      fore = new THREE.Vector3(0, -0.12, 0.28);
      len = 0.64;
    }
  }
  return { g, grip, fore, muzzle: new THREE.Vector3(0, 0.02, len), mag };
}

/* ---------- trang phục theo lớp ---------- */
function outfit(cls: number) {
  const c = CLASSES[cls];
  const id = c.id;
  return {
    id,
    shirt: id === 'ysi' ? 0xf4f6f2 : id === 'kysu' ? 0x6b7280 : c.color,
    pants: id === 'chienbinh' ? 0x4b5a35 : id === 'ysi' ? 0x2f6f4f : id === 'kysu' ? c.color : 0x3a3a40,
    vest: id === 'chienbinh' ? 0x55663a : id === 'ysi' ? c.color : id === 'kysu' ? c.color : 0x8b929c,
    boots: id === 'dausi' ? 0x2a2d33 : 0x3b2a1a,
    accent: c.color,
    bulk: id === 'dausi' ? 1.13 : 1,
  };
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
  private elL = new THREE.Group();
  private elR = new THREE.Group();
  private thL = new THREE.Group();
  private thR = new THREE.Group();
  private knL = new THREE.Group();
  private knR = new THREE.Group();
  private ankL = new THREE.Group();
  private ankR = new THREE.Group();
  private gun: Gun | null = null;
  private tier = -1;
  private shield: THREE.Mesh;
  private rageM: THREE.Mesh;
  private UA = 0.29;
  private FA = 0.28;
  private TH = 0.43;
  private SH = 0.42;
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
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpE = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();

  constructor(cls: number, blobTexture: THREE.Texture, idx = 0) {
    this.cls = cls;
    const o = outfit(cls);
    const skin = mat(SKINS[idx & 3], { rough: 0.6 });
    const shirt = mat(o.shirt, { rough: 0.85 });
    const pants = mat(o.pants, { rough: 0.9 });
    const vest = mat(o.vest, { rough: 0.7, metal: o.id === 'dausi' ? 0.55 : 0 });
    const boots = mat(o.boots, { rough: 0.6 });
    const glove = mat(0x2a2a2e, { rough: 0.7 });
    const accent = mat(o.accent, { rough: 0.6 });
    const B = o.bulk;
    this.root.add(this.hips);
    this.hips.position.y = 0.95;
    // ---- hông + chân ----
    mesh(new THREE.CapsuleGeometry(0.16 * B, 0.12, 4, 10), pants, this.hips, 0, 0.02, 0).rotation.z = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.4 * B, 0.07, 0.25), mat(0x2b2118, { rough: 0.6 }), this.hips, 0, 0.1, 0); // thắt lưng
    for (const [th, kn, ank, sx] of [[this.thL, this.knL, this.ankL, -1], [this.thR, this.knR, this.ankR, 1]] as const) {
      th.position.set(0.11 * sx * B, -0.02, 0);
      this.hips.add(th);
      th.add(limb(0.085 * B, this.TH, pants));
      kn.position.y = -this.TH;
      th.add(kn);
      kn.add(limb(0.072 * B, this.SH, pants));
      mesh(new THREE.CylinderGeometry(0.08 * B, 0.085 * B, 0.16, 10), boots, kn, 0, -this.SH + 0.05, 0);
      ank.position.y = -this.SH;
      kn.add(ank);
      mesh(new THREE.BoxGeometry(0.13 * B, 0.09, 0.26), boots, ank, 0, -0.02, 0.05);
    }
    // ---- thân trên ----
    this.spine.position.y = 0.1;
    this.hips.add(this.spine);
    this.spine.add(this.chestG);
    const torso = mesh(new THREE.CapsuleGeometry(0.2 * B, 0.26, 6, 12), shirt, this.chestG, 0, 0.27, 0);
    torso.scale.set(1.1, 1, 0.78);
    // áo khoác/giáp ngực theo lớp
    const vestM = mesh(new THREE.CapsuleGeometry(0.205 * B, 0.18, 6, 12), vest, this.chestG, 0, 0.3, 0.01);
    vestM.scale.set(1.12, 0.95, 0.82);
    if (o.id === 'chienbinh') {
      for (const x of [-0.1, 0, 0.1]) mesh(new THREE.BoxGeometry(0.08, 0.09, 0.05), mat(0x445530), this.chestG, x, 0.22, 0.17);
    } else if (o.id === 'ysi') {
      // chữ thập đỏ trên ngực + băng tay
      mesh(new THREE.BoxGeometry(0.12, 0.035, 0.02), mat(0xe11d48, { basic: true }), this.chestG, 0.08, 0.36, 0.175, false);
      mesh(new THREE.BoxGeometry(0.035, 0.12, 0.02), mat(0xe11d48, { basic: true }), this.chestG, 0.08, 0.36, 0.175, false);
    } else if (o.id === 'kysu') {
      // quai yếm + túi đồ nghề
      for (const x of [-0.09, 0.09]) mesh(new THREE.BoxGeometry(0.05, 0.3, 0.03), accent, this.chestG, x, 0.38, 0.165);
      const wr = mesh(new THREE.BoxGeometry(0.03, 0.18, 0.02), mat(0xb0b6bf, { metal: 0.8, rough: 0.3 }), this.hips, 0.2, 0.0, 0.1);
      wr.rotation.z = 0.3;
    } else {
      // đấu sĩ: giáp vai to + đai bụng
      for (const sx of [-1, 1]) {
        const p = mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), vest, this.chestG, 0.27 * sx, 0.47, 0);
        p.scale.set(1.15, 0.8, 1.1);
        p.rotation.z = -0.35 * sx;
      }
      mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16), mat(0x8b5a2b), this.chestG, 0, 0.12, 0).rotation.x = Math.PI / 2;
    }
    // ba lô
    const pack = mesh(new THREE.BoxGeometry(0.3, 0.36, 0.15), mat(o.id === 'ysi' ? 0x2f855a : 0x5b4a33, { rough: 0.9 }), this.chestG, 0, 0.32, -0.21);
    pack.rotation.x = -0.05;
    if (o.id === 'ysi') {
      mesh(new THREE.BoxGeometry(0.12, 0.035, 0.02), mat(0xffffff, { basic: true }), this.chestG, 0, 0.34, -0.29, false);
      mesh(new THREE.BoxGeometry(0.035, 0.12, 0.02), mat(0xffffff, { basic: true }), this.chestG, 0, 0.34, -0.29, false);
    }
    // ---- cổ + đầu ----
    this.neck.position.set(0, 0.5, 0.01);
    this.chestG.add(this.neck);
    mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin, this.neck, 0, 0.03, 0);
    this.headG.position.y = 0.17;
    this.neck.add(this.headG);
    const headM = mesh(new THREE.SphereGeometry(0.15, 16, 12), skin, this.headG);
    headM.scale.set(1, 1.08, 1.02);
    mesh(new THREE.SphereGeometry(0.04, 8, 6), skin, this.headG, 0, -0.01, 0.15); // mũi
    for (const sx of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.03, 8, 6), mat(0xffffff, { basic: true }), this.headG, 0.055 * sx, 0.03, 0.128, false).scale.set(1, 1.1, 0.6);
      mesh(new THREE.SphereGeometry(0.017, 6, 5), mat(0x1a1410, { basic: true }), this.headG, 0.057 * sx, 0.028, 0.145, false);
      const brow = mesh(new THREE.BoxGeometry(0.055, 0.012, 0.015), mat(0x2b1d14), this.headG, 0.058 * sx, 0.075, 0.135, false);
      brow.rotation.z = -0.15 * sx;
      mesh(new THREE.SphereGeometry(0.035, 8, 6), skin, this.headG, 0.148 * sx, 0.0, 0).scale.set(0.5, 1, 0.8); // tai
    }
    mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), mat(0x7a2a2a), this.headG, 0, -0.07, 0.14, false);
    this.headG.add(this.hat(o.id, o.accent));
    // ---- tay + súng (IK) ----
    this.aim.position.set(0, 0.42, 0);
    this.chestG.add(this.aim);
    for (const [sh, el, sx] of [[this.shL, this.elL, -1], [this.shR, this.elR, 1]] as const) {
      sh.position.set(0.24 * sx * B, 0, 0);
      this.aim.add(sh);
      mesh(new THREE.SphereGeometry(0.085 * B, 10, 8), o.id === 'dausi' ? vest : shirt, sh);
      sh.add(limb(0.07 * B, this.UA, shirt));
      el.position.y = -this.UA;
      sh.add(el);
      el.add(limb(0.06 * B, this.FA, o.id === 'dausi' ? vest : skin));
      mesh(new THREE.SphereGeometry(0.06, 10, 8), glove, el, 0, -this.FA, 0);
    }
    this.aim.add(this.gunPose);
    // khiên gồng mình / cuồng nộ
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shield.scale.set(0.8, 1.1, 0.8);
    this.shield.position.y = 0.95;
    this.shield.visible = false;
    this.root.add(this.shield);
    this.rageM = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.rageM.scale.set(0.9, 1.15, 0.9);
    this.rageM.position.y = 0.95;
    this.rageM.visible = false;
    this.root.add(this.rageM);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.035;
    if (B !== 1) this.root.scale.setScalar(1.04);
  }

  private hat(id: string, accent: number): THREE.Object3D {
    const g = new THREE.Group();
    if (id === 'chienbinh') {
      const h = mesh(new THREE.SphereGeometry(0.175, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x4d6b2f, { rough: 0.8 }), g, 0, 0.03, -0.01);
      h.scale.set(1.05, 0.9, 1.1);
      mesh(new THREE.TorusGeometry(0.168, 0.016, 6, 20), mat(0x2f4020), g, 0, 0.04, -0.01).rotation.x = Math.PI / 2;
      // kính bảo hộ đẩy lên mũ
      const gg = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), mat(0x222222, { metal: 0.3, rough: 0.3 }), g, 0, 0.1, 0.13);
      gg.rotation.x = -0.4;
      for (const sx of [-1, 1]) mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), mat(0x7dd3fc, { basic: true }), g, 0.05 * sx, 0.1, 0.156, false).rotation.x = Math.PI / 2 - 0.4;
    } else if (id === 'ysi') {
      mesh(new THREE.CylinderGeometry(0.15, 0.162, 0.09, 16), mat(0xffffff, { rough: 0.9 }), g, 0, 0.11, 0);
      mesh(new THREE.BoxGeometry(0.07, 0.022, 0.01), mat(0xe11d48, { basic: true }), g, 0, 0.115, 0.158, false);
      mesh(new THREE.BoxGeometry(0.022, 0.07, 0.01), mat(0xe11d48, { basic: true }), g, 0, 0.115, 0.158, false);
      // khẩu trang kéo xuống cằm
      mesh(new THREE.BoxGeometry(0.17, 0.05, 0.05), mat(0x9ad7c0), g, 0, -0.1, 0.11);
    } else if (id === 'kysu') {
      const h = mesh(new THREE.SphereGeometry(0.178, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfacc15, { rough: 0.45 }), g, 0, 0.04, 0);
      h.scale.set(1, 0.92, 1.05);
      mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.018, 20), mat(0xeab308, { rough: 0.45 }), g, 0, 0.045, 0.02);
      mesh(new THREE.BoxGeometry(0.02, 0.05, 0.3), mat(0xeab308), g, 0, 0.18, 0);
      // đèn đội đầu
      mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.04, 10), mat(0x333333), g, 0, 0.1, 0.17).rotation.x = Math.PI / 2;
      mesh(new THREE.CircleGeometry(0.028, 10), mat(0xfff7b0, { basic: true }), g, 0, 0.1, 0.192, false);
    } else {
      const h = mesh(new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.6), mat(0x6b7280, { metal: 0.7, rough: 0.35 }), g, 0, 0.02, 0);
      h.scale.set(1.05, 1, 1.05);
      // kính che mặt + sừng
      mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), mat(0x111111), g, 0, 0.035, 0.15);
      mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), mat(0x6b7280, { metal: 0.7, rough: 0.35 }), g, 0, -0.01, 0.165);
      for (const sx of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.035, 0.2, 10), mat(0xf5f0e0, { rough: 0.5 }), g, 0.17 * sx, 0.12, 0);
        horn.rotation.z = -1.0 * sx;
      }
      mesh(new THREE.ConeGeometry(0.03, 0.1, 6), mat(accent), g, 0, 0.2, -0.03);
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

  /** IK hai khúc: đặt vai + khuỷu để bàn tay chạm T (toạ độ của `aim`) */
  private ik(sh: THREE.Object3D, el: THREE.Object3D, T: THREE.Vector3, pole: THREE.Vector3) {
    const a = this.UA, b = this.FA;
    const S = sh.position;
    const d = this.tmpA.copy(T).sub(S);
    let L = d.length();
    L = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, L));
    d.normalize();
    const cosA = (a * a + L * L - b * b) / (2 * a * L);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const p = this.tmpP.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
    const E = this.tmpE.copy(S).addScaledVector(d, a * cosA).addScaledVector(p, a * sinA);
    this.q1.setFromUnitVectors(DOWN, this.tmpB.copy(E).sub(S).normalize());
    sh.quaternion.copy(this.q1);
    const tgt = this.tmpB.copy(S).addScaledVector(d, L).sub(E).normalize();
    this.q2.setFromUnitVectors(DOWN, tgt);
    el.quaternion.copy(this.q1.invert()).multiply(this.q2);
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
    if (P.rage) this.rageM.scale.setScalar(0.95 + Math.sin(t * 10) * 0.05);
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
    const stride = 1.15 + this.sprintK * 0.5;
    this.phase += (backward ? -1 : 1) * (speed / stride) * dt * Math.PI;
    const sw = Math.sin(this.phase);
    const cw = Math.cos(this.phase);

    // ---- đặt lại ----
    this.hips.position.set(0, 0.95, 0);
    this.hips.rotation.set(0, this.hipYaw, 0);
    this.spine.rotation.set(0, -this.hipYaw, 0);
    this.chestG.rotation.set(0, 0, 0);
    this.chestG.position.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.headG.rotation.set(0, 0, 0);
    this.gunPose.visible = true;

    // ---- chân ----
    const amp = run * (0.75 + this.sprintK * 0.35);
    this.thL.rotation.set(sw * amp, 0, 0);
    this.thR.rotation.set(-sw * amp, 0, 0);
    this.knL.rotation.set(Math.max(0, -cw) * 1.2 * run + 0.05, 0, 0);
    this.knR.rotation.set(Math.max(0, cw) * 1.2 * run + 0.05, 0, 0);
    this.ankL.rotation.set(-this.thL.rotation.x * 0.3, 0, 0);
    this.ankR.rotation.set(-this.thR.rotation.x * 0.3, 0, 0);
    let bob = Math.abs(cw) * 0.06 * run - run * 0.03;
    if (air) {
      // trên không: co một chân, duỗi một chân
      this.thL.rotation.x = -0.9;
      this.knL.rotation.x = 1.3;
      this.thR.rotation.x = -0.2;
      this.knR.rotation.x = 0.5;
    }
    bob -= this.landT * 0.12;
    this.knL.rotation.x += this.landT * 0.5;
    this.knR.rotation.x += this.landT * 0.5;
    this.thL.rotation.x -= this.landT * 0.25;
    this.thR.rotation.x -= this.landT * 0.25;
    // thở khi đứng
    const breath = Math.sin(t * 2.1) * 0.012 * (1 - run);
    this.chestG.position.y = breath;
    // nghiêng người khi chạy nhanh / lùi
    this.chestG.rotation.x = 0.08 * run + this.sprintK * 0.22 - (backward ? 0.1 * run : 0);
    this.chestG.rotation.z = -Math.sin(this.hipYaw) * 0.08 * run;
    // quỳ (đỡ đồng đội / dựng đồ)
    if (this.kneelK > 0.01) {
      const q = this.kneelK;
      bob -= 0.35 * q;
      this.thL.rotation.x = -1.4 * q + this.thL.rotation.x * (1 - q);
      this.knL.rotation.x = 1.5 * q + this.knL.rotation.x * (1 - q);
      this.thR.rotation.x = 0.2 * q + this.thR.rotation.x * (1 - q);
      this.knR.rotation.x = 1.9 * q + this.knR.rotation.x * (1 - q);
      this.chestG.rotation.x += 0.35 * q;
    }
    // gồng: hạ trọng tâm
    if (P.brace) {
      bob -= 0.08;
      this.knL.rotation.x += 0.35;
      this.knR.rotation.x += 0.35;
      this.thL.rotation.x -= 0.2;
      this.thR.rotation.x -= 0.2;
    }
    this.hips.position.y += bob;

    // ---- thân trên theo hướng ngắm ----
    const pitch = P.pitch;
    this.aim.rotation.set(-pitch * 0.75, 0, 0);
    this.neck.rotation.x = -pitch * 0.3;
    this.chestG.rotation.x += -pitch * 0.15;
    // trúng đòn: giật ngược hướng đòn
    if (this.hitT > 0) {
      const h = Math.sin(this.hitT * Math.PI) * 0.35;
      this.chestG.rotation.x -= Math.cos(this.hitDir) * h;
      this.chestG.rotation.z += Math.sin(this.hitDir) * h;
      this.headG.rotation.x -= h * 0.8;
    }

    // ---- súng + tay (IK) ----
    const gp = this.gunPose;
    const r = this.recoil;
    gp.position.set(0.15 - this.adsK * 0.13, -0.17 + this.adsK * 0.1, 0.3 + this.adsK * 0.04 - r * 0.07);
    gp.rotation.set(-r * 0.22, 0, 0);
    if (this.sprintK > 0.01) {
      const s = this.sprintK;
      gp.position.x += 0.02 * s;
      gp.position.y -= 0.14 * s - Math.sin(this.phase) * 0.03 * s;
      gp.position.z -= 0.12 * s;
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
      const Tr = new THREE.Vector3().copy(gun.grip).applyMatrix4(gp.matrix);
      if (this.skillT > 0 && (this.skillKind === 'throw' || this.skillKind === 'ult')) {
        const p = 1 - this.skillT / this.skillDur;
        const throwK = Math.sin(p * Math.PI);
        if (this.skillKind === 'throw') {
          // vung tay qua vai ra trước
          const ang = -2.6 + p * 3.6;
          Tr.lerp(this.tmpB.set(0.3, -Math.cos(ang) * 0.5 + 0.05, Math.sin(ang) * 0.5), throwK);
        } else {
          // giơ tay lên trời (pháo sáng / gầm)
          Tr.lerp(this.tmpB.set(0.2, 0.5, 0.12), throwK);
        }
      }
      const TrC = Tr.clone();
      this.ik(this.shR, this.elR, TrC, this.tmpP.set(0.6, -0.6, -0.5));
      // tay trái: ốp trước (hoặc băng đạn khi nạp)
      const Tl = this.tmpA.copy(gun.fore).applyMatrix4(gp.matrix);
      if (reloadOut > 0) Tl.lerp(this.tmpB.set(-0.2, -0.42, 0.12), reloadOut);
      if (this.skillT > 0 && this.skillKind === 'build') {
        const p = 1 - this.skillT / this.skillDur;
        Tl.set(-0.05, -0.55 + Math.abs(Math.sin(p * Math.PI * 4)) * 0.18, 0.42);
      }
      this.ik(this.shL, this.elL, Tl.clone(), this.tmpP.set(-0.7, -0.6, -0.4));
    }
    // dậm đất: nhảy lên rồi đập xuống
    if (this.skillT > 0 && this.skillKind === 'stomp') {
      const p = 1 - this.skillT / this.skillDur;
      const up = p < 0.5 ? Math.sin(p * Math.PI) : 0;
      this.hips.position.y += up * 0.25 - (p > 0.5 ? (1 - p) * 0.4 : 0);
      this.chestG.rotation.x += p > 0.5 ? 0.6 * (1 - p) * 2 : -0.2 * up;
      this.thL.rotation.x -= 0.9 * up;
      this.thR.rotation.x -= 0.9 * up;
      this.knL.rotation.x += 1.2 * up;
      this.knR.rotation.x += 1.2 * up;
    }
    if (this.skillT > 0 && this.skillKind === 'ult') this.headG.rotation.x -= 0.4 * Math.sin((1 - this.skillT / this.skillDur) * Math.PI);

    // ---- gục: nằm sấp bò lết / tử trận nằm ngửa ----
    if (this.crawlK > 0.02) {
      const c = this.crawlK;
      const dead = P.down === 2;
      this.hips.position.y = this.hips.position.y * (1 - c) + 0.2 * c;
      this.hips.rotation.x = (dead ? -1.5 : 1.45) * c;
      this.spine.rotation.y *= 1 - c;
      this.chestG.rotation.x = this.chestG.rotation.x * (1 - c) + (dead ? 0 : -0.25) * c;
      this.neck.rotation.x = (dead ? 0.3 : -0.9) * c;
      const crawl = Math.sin(t * 5) * Math.min(1, speed / 0.8);
      this.thL.rotation.x = 0.15 + crawl * 0.3;
      this.thR.rotation.x = 0.15 - crawl * 0.3;
      this.knL.rotation.x = 0.3 + Math.max(0, crawl) * 0.6;
      this.knR.rotation.x = 0.3 + Math.max(0, -crawl) * 0.6;
      this.gunPose.visible = c < 0.5;
      // tay với ra trước (bò) / giơ lên cầu cứu
      this.aim.rotation.set(0, 0, 0);
      this.shR.quaternion.setFromEuler(new THREE.Euler(dead ? -0.3 : -2.6 + crawl * 0.5, 0, dead ? 1.2 : 0.2));
      this.elR.quaternion.setFromEuler(new THREE.Euler(dead ? 0 : -0.3, 0, 0));
      this.shL.quaternion.setFromEuler(new THREE.Euler(dead ? -0.2 : -2.6 - crawl * 0.5, 0, dead ? -1.2 : -0.2));
      this.elL.quaternion.setFromEuler(new THREE.Euler(dead ? 0 : -0.3, 0, 0));
      if (!dead && speed < 0.3) this.shR.quaternion.setFromEuler(new THREE.Euler(-2.9 + Math.sin(t * 3) * 0.25, 0, 0.3));
    }
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
