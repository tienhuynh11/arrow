// Mô hình chibi PROCEDURAL: đầu to ~45% chiều cao, thân nhỏ, hình khối dùng chung (cache),
// MeshToonMaterial, viền bằng vỏ phóng to quay mặt trong, hoạt hình squash & stretch tự tính (không cần skeleton).
// Mặt = một lớp vỏ cầu mỏng dán texture atlas biểu cảm (face-atlas.ts), đổi ô khi đổi trạng thái / chớp mắt.
import * as THREE from 'three';
import { FACE, faceTexture, setFaceCell } from './face-atlas';
import type { HeroAnim, HeroModel, HeroPalette } from './hero-model';

export interface ProcLook {
  body: string;
  accent: string;
  skin: string;
  props: string[];
  scale: number;
  monkey: boolean;
  /** màu tóc (mặc định = màu nhấn tối đi) */
  hair?: string;
  /** phụ kiện riêng của tướng / mô tả riêng cho quái */
  extra?: string[];
}

/* ------------------------------ THAM SỐ CHỈNH ĐƯỢC (giây / đơn vị thế giới) ------------------------------ */
export const ANIM = {
  idleSpeed: 3.2, // tốc độ nhún thở
  idleBob: 0.03, // độ nảy lên
  idleSquash: 0.04,
  swayZ: 0.035, // lắc thân nhẹ
  blinkMin: 1.6, // khoảng cách giữa hai lần chớp
  blinkMax: 4.6,
  blinkTime: 0.13,
  winkChance: 0.16,
  // tấn công: gồng (anticipation) -> vung (overshoot) -> lắc tắt dần
  atkWind: 0.18,
  atkStrike: 0.1,
  atkSettle: 0.32,
  // niệm phép: ngồi thụt -> bật lên -> giơ tay rung -> hạ
  castCrouch: 0.2,
  castSpring: 0.25,
  castHold: 0.25,
  castSettle: 0.22,
  hitTime: 0.42,
  winHop: 5.5, // tần số nhảy mừng
  dieStretch: 0.12,
  dieTumble: 0.48,
  dieBounce: 0.35,
  dieFadeStart: 0.95,
  dieFadeEnd: 1.4,
};

/* ------------------------------ HÌNH KHỐI + VẬT LIỆU DÙNG CHUNG ------------------------------ */
const G = {
  sphere: new THREE.SphereGeometry(1, 18, 14),
  dome: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 14),
  torus: new THREE.TorusGeometry(1, 0.12, 8, 24),
  arc: new THREE.TorusGeometry(1, 0.09, 6, 16, Math.PI),
  // mảnh cầu phía trước đầu để dán mặt (u chạy theo +x, v theo +y)
  face: new THREE.SphereGeometry(1, 14, 10, Math.PI / 2 - 0.8, 1.6, 1.05, 1.1),
};

let gradTex: THREE.DataTexture | null = null;
/** dải 3 bậc dùng chung cho mọi vật liệu toon (cả mô hình glTF) */
export function gradient(): THREE.DataTexture {
  if (!gradTex) {
    gradTex = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
    gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter;
    gradTex.needsUpdate = true;
  }
  return gradTex;
}
function toon(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient() });
}
const shared = new Map<string, THREE.Material>();
function sharedToon(color: string): THREE.Material {
  let m = shared.get(color);
  if (!m) {
    m = toon(color);
    shared.set(color, m);
  }
  return m;
}
function sharedBasic(color: string): THREE.Material {
  const k = `b${color}`;
  let m = shared.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    shared.set(k, m);
  }
  return m;
}
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1a2140, side: THREE.BackSide });

/* ------------------------------ DỰNG HÌNH ------------------------------ */
type V3 = [number, number, number];
interface Ctx {
  outlines: boolean;
  body: THREE.MeshToonMaterial;
  accent: THREE.MeshToonMaterial;
  skin: THREE.MeshToonMaterial;
  hair: THREE.MeshToonMaterial;
}

function part(
  c: Ctx, parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  pos: V3, scale: V3, outline = 1.08, rot?: V3,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  if (c.outlines && outline > 0) {
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.setScalar(outline);
    m.add(o);
  }
  parent.add(m);
  return m;
}

const darker = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);
/** mũ/tóc nghiêng ra sau để chừa trán cho lông mày / mặt biểu cảm */
const TILT: V3 = [-0.3, 0, 0];
const HEADGEAR = new Set(['hat', 'hood', 'helm', 'leafcap', 'huntercap', 'healcap']);

interface Rig {
  root: THREE.Group;
  rig: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  extras: Extras;
  faceMat: THREE.MeshBasicMaterial;
  faceTex: THREE.Texture;
}
interface Extras {
  cape?: THREE.Object3D;
  halo?: THREE.Object3D;
  tail?: THREE.Object3D;
  /** cặp cánh [trái, phải] */
  wings?: THREE.Object3D[];
  /** nhóm xoay quanh trục y (nốt nhạc, tia nắng) */
  spin: THREE.Object3D[];
  /** nhóm đung đưa quanh trục x (khăn, đuôi tóc) / z (lông trĩ) */
  swayX: THREE.Object3D[];
  swayZ: THREE.Object3D[];
  /** hạt nhấp nháy phát sáng (ngọc trượng) */
  pulse: THREE.Object3D[];
}

function build(look: ProcLook, c: Ctx): Rig {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  root.add(rig);
  const mk = look.monkey;
  const ex = look.extra ?? [];
  const big = ex.includes('gorilla');
  const headgear = look.props.some((p) => HEADGEAR.has(p)) || ex.some((p) => HEADGEAR.has(p));

  // chân
  const legL = part(c, rig, G.sphere, c.body, [-0.14, 0.15, 0], [0.12, 0.15, 0.14]);
  const legR = part(c, rig, G.sphere, c.body, [0.14, 0.15, 0], [0.12, 0.15, 0.14]);
  // thân
  const tw = big ? 0.36 : 0.28;
  part(c, rig, G.sphere, c.body, [0, 0.5, 0], [tw, 0.33, 0.25]);
  // bụng / áo nhấn
  part(c, rig, G.sphere, mk ? c.skin : c.accent, [0, 0.44, 0.13], [tw * 0.62, 0.2, 0.15], 0);
  // đai lưng
  if (!mk) part(c, rig, G.cyl, c.accent, [0, 0.33, 0], [0.285, 0.035, 0.255], 0, undefined);

  // đầu
  const head = new THREE.Group();
  head.position.set(0, 1.07, 0);
  rig.add(head);
  part(c, head, G.sphere, c.skin, [0, 0, 0], [0.45, 0.38, 0.42], 1.07);

  // mặt biểu cảm: vỏ cầu mỏng, phần lớn trong suốt (alphaTest) nên không cần sắp thứ tự vẽ
  const faceTex = faceTexture(!mk);
  setFaceCell(faceTex, FACE.idle);
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, alphaTest: 0.04, depthWrite: false });
  const face = new THREE.Mesh(G.face, faceMat);
  // khỉ có mõm nhô ra nên vỏ mặt to hơn một chút
  if (mk) face.scale.set(0.47, 0.4, 0.46);
  else face.scale.set(0.45 * 1.025, 0.38 * 1.025, 0.42 * 1.025);
  face.renderOrder = 2;
  head.add(face);

  if (mk) {
    // mặt khỉ: mảng da sáng + tai tròn
    part(c, head, G.sphere, c.accent, [0, -0.06, 0.25], [0.3, 0.24, 0.2], 0);
    for (const sx of [-1, 1]) {
      part(c, head, G.sphere, c.body, [sx * 0.46, 0.02, -0.02], [0.14, 0.14, 0.08]);
      part(c, head, G.sphere, c.accent, [sx * 0.47, 0.02, 0.03], [0.09, 0.09, 0.04], 0);
    }
    part(c, head, G.dome, c.body, [0, 0.07, -0.05], [0.46, 0.4, 0.43], 1.0, TILT);
  } else if (!headgear) {
    // tóc: mũ nửa cầu nghiêng ra sau + mái
    part(c, head, G.dome, c.hair, [0, 0.06, -0.05], [0.47, 0.4, 0.44], 1.05, TILT);
    part(c, head, G.sphere, c.hair, [0, 0.27, 0.28], [0.3, 0.1, 0.14], 0);
  }

  // tay
  const mkArm = (sx: number) => {
    const g = new THREE.Group();
    g.position.set(sx * (big ? 0.42 : 0.33), 0.65, 0);
    rig.add(g);
    part(c, g, G.sphere, mk ? c.body : c.skin, [0, -0.17, 0], [big ? 0.12 : 0.09, big ? 0.24 : 0.19, big ? 0.12 : 0.09]);
    if (!mk) part(c, g, G.sphere, c.body, [0, -0.04, 0], [0.11, 0.1, 0.11], 0);
    return g;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  const extras: Extras = { spin: [], swayX: [], swayZ: [], pulse: [] };

  // đuôi khỉ
  if (mk) mkTail(c, rig, extras);

  // phụ kiện
  for (const p of [...look.props, ...ex]) addProp(p, c, { rig, head, armL, armR, extras, mk });

  root.scale.setScalar(look.scale);
  return { root, rig, head, armL, armR, legL, legR, extras, faceMat, faceTex };
}

function mkTail(c: Ctx, rig: THREE.Object3D, extras: Extras) {
  const tail = new THREE.Group();
  tail.position.set(0, 0.28, -0.24);
  rig.add(tail);
  for (let i = 0; i < 4; i++) {
    const s = 0.06 - i * 0.006;
    part(c, tail, G.sphere, c.body, [0, 0.08 * i + i * i * 0.012, -0.08 * i], [s, s, s], 1.1);
  }
  extras.tail = tail;
}

interface PropCtx {
  rig: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  extras: Extras;
  mk: boolean;
}
const STEEL = '#dfe6ee';
const GOLD = '#ffd24d';
const WOOD = '#8a5a2b';
const WHITE = '#ffffff';
const RED = '#e5484d';

function holder(x: PropCtx, arm: THREE.Group, pos: V3, rot?: V3): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...pos);
  if (rot) g.rotation.set(...rot);
  arm.add(g);
  return g;
}
/** nhóm đứng yên trong rig, đặt vào danh sách đung đưa */
function swayGroup(parent: THREE.Object3D, pos: V3, list: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...pos);
  parent.add(g);
  list.push(g);
  return g;
}

function addProp(name: string, c: Ctx, x: PropCtx): void {
  switch (name) {
    case 'sword': {
      const g = holder(x, x.armR, [0, -0.36, 0.05], [-1.25, 0, 0]);
      part(c, g, G.box, sharedToon(STEEL), [0, 0.42, 0], [0.08, 0.72, 0.03], 1.2);
      part(c, g, G.box, c.accent, [0, 0.06, 0], [0.26, 0.05, 0.06], 1.15);
      part(c, g, G.cyl, c.accent, [0, -0.03, 0], [0.03, 0.09, 0.03], 1.2);
      break;
    }
    case 'greatsword': {
      // kiếm khổng lồ có rãnh sóng + mũi nhọn: nhận ra từ xa
      const g = holder(x, x.armR, [0, -0.36, 0.05], [-1.25, 0, 0]);
      part(c, g, G.box, sharedToon('#bfe6ff'), [0, 0.6, 0], [0.17, 0.95, 0.045], 1.18);
      part(c, g, G.cone, sharedToon('#bfe6ff'), [0, 1.17, 0], [0.12, 0.22, 0.03], 1.18);
      part(c, g, G.box, sharedToon('#6fb8ff'), [0, 0.6, 0.02], [0.05, 0.9, 0.02], 0);
      part(c, g, G.box, sharedToon(GOLD), [0, 0.1, 0], [0.4, 0.07, 0.08], 1.15);
      part(c, g, G.sphere, sharedToon(GOLD), [0.2, 0.1, 0], [0.06, 0.06, 0.06], 1.15);
      part(c, g, G.sphere, sharedToon(GOLD), [-0.2, 0.1, 0], [0.06, 0.06, 0.06], 1.15);
      part(c, g, G.cyl, c.accent, [0, -0.03, 0], [0.035, 0.1, 0.035], 1.2);
      break;
    }
    case 'dagger': {
      for (const arm of [x.armR, x.armL]) {
        const g = holder(x, arm, [0, -0.36, 0.05], [-1.3, 0, 0]);
        part(c, g, G.box, sharedToon('#cfd6ff'), [0, 0.24, 0], [0.07, 0.42, 0.025], 1.25);
        part(c, g, G.cone, sharedToon('#cfd6ff'), [0, 0.5, 0], [0.05, 0.1, 0.02], 1.25);
        part(c, g, G.box, c.accent, [0, 0.02, 0], [0.18, 0.045, 0.05], 1.2);
      }
      break;
    }
    case 'bow':
    case 'bigbow': {
      const k = name === 'bigbow' ? 1.4 : 1;
      const g = holder(x, x.armL, [0, -0.3, 0.12]);
      const inner = new THREE.Group();
      inner.rotation.z = Math.PI / 2;
      const outer = new THREE.Group();
      outer.rotation.y = Math.PI / 2;
      g.add(outer);
      outer.add(inner);
      inner.scale.setScalar(0.42 * k);
      part(c, inner, G.arc, sharedToon(WOOD), [0, 0, 0], [1, 1, 1], 1.18);
      part(c, g, G.box, sharedBasic('#f4f4f4'), [0, 0, 0], [0.012, 0.84 * k, 0.012], 0);
      break;
    }
    case 'shield': {
      const g = holder(x, x.armL, [-0.04, -0.22, 0.14]);
      part(c, g, G.cyl, c.body, [0, 0, 0], [0.27, 0.04, 0.27], 1.1, [Math.PI / 2, 0, 0]);
      part(c, g, G.torus, c.accent, [0, 0, 0.03], [0.27, 0.27, 0.5], 1.1);
      part(c, g, G.sphere, c.accent, [0, 0, 0.05], [0.08, 0.08, 0.05], 1.1);
      break;
    }
    case 'bigshield': {
      // khiên tháp to bản, che gần hết thân
      const g = holder(x, x.armL, [-0.1, -0.12, 0.17]);
      part(c, g, G.box, c.body, [0, 0, 0], [0.4, 0.6, 0.06], 1.08);
      part(c, g, G.box, c.accent, [0, 0, 0.035], [0.1, 0.52, 0.03], 0);
      part(c, g, G.box, c.accent, [0, 0.08, 0.036], [0.34, 0.1, 0.03], 0);
      part(c, g, G.cone, c.body, [0, -0.36, 0], [0.2, 0.16, 0.06], 1.08, [Math.PI, 0, 0]);
      for (const [sx, sy] of [[-0.14, 0.24], [0.14, 0.24], [-0.14, -0.2], [0.14, -0.2]]) {
        part(c, g, G.sphere, sharedToon(GOLD), [sx, sy, 0.04], [0.032, 0.032, 0.025], 0);
      }
      break;
    }
    case 'staff': {
      const g = holder(x, x.armR, [0.02, -0.36, 0.06]);
      part(c, g, G.cyl, sharedToon(WOOD), [0, 0.1, 0], [0.035, 0.85, 0.035], 1.3);
      const orb = part(c, g, G.sphere, sharedBasic(c.accent.color.getStyle()), [0, 1.0, 0], [0.12, 0.12, 0.12], 1.15);
      orb.userData.s = 0.12;
      x.extras.pulse.push(orb);
      part(c, g, G.torus, sharedToon(GOLD), [0, 0.92, 0], [0.11, 0.11, 0.11], 1.2, [Math.PI / 2, 0, 0]);
      break;
    }
    case 'ruyi': {
      // Gậy Như Ý: cây gậy vàng DÀI vượt đầu, hai đầu đỏ
      const g = holder(x, x.armR, [0.02, -0.36, 0.06]);
      part(c, g, G.cyl, sharedToon(GOLD), [0, 0.3, 0], [0.05, 1.5, 0.05], 1.3);
      part(c, g, G.cyl, sharedToon(RED), [0, 1.0, 0], [0.075, 0.18, 0.075], 1.2);
      part(c, g, G.cyl, sharedToon(RED), [0, -0.4, 0], [0.075, 0.18, 0.075], 1.2);
      const gem = part(c, g, G.sphere, sharedBasic('#fff1a0'), [0, 1.1, 0], [0.05, 0.05, 0.05], 0);
      gem.userData.s = 0.05;
      x.extras.pulse.push(gem);
      break;
    }
    case 'sunstar': {
      // vòng tia nắng quanh ngọc trượng
      const g = holder(x, x.armR, [0.02, -0.36, 0.06]);
      const ring = new THREE.Group();
      ring.position.set(0, 1.0, 0);
      g.add(ring);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part(c, ring, G.cone, sharedBasic('#ffd24d'), [Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0], [0.04, 0.13, 0.04], 0, [0, 0, a - Math.PI / 2]);
      }
      // quay quanh trục z: dùng nhóm riêng trong spin nhưng xoay theo z
      ring.userData.axis = 'z';
      x.extras.spin.push(ring);
      break;
    }
    case 'flute': {
      const g = holder(x, x.armR, [0.04, -0.4, 0.12], [0, 0.4, Math.PI / 2 - 0.3]);
      part(c, g, G.cyl, c.accent, [0, 0, 0], [0.028, 0.24, 0.028], 1.4);
      break;
    }
    case 'hat': {
      const hg = new THREE.Group();
      hg.position.set(0, 0.28, -0.02);
      hg.rotation.x = -0.12;
      x.head.add(hg);
      part(c, hg, G.cyl, c.body, [0, 0, 0], [0.62, 0.035, 0.62], 1.1);
      part(c, hg, G.cone, c.body, [0, 0.3, 0], [0.38, 0.6, 0.38], 1.06);
      part(c, hg, G.cyl, c.accent, [0, 0.05, 0], [0.385, 0.06, 0.385], 1.06);
      break;
    }
    case 'hatleaf': {
      // lá non mọc trên chóp mũ, đung đưa
      const sw = swayGroup(x.head, [0, 0.86, -0.06], x.extras.swayZ);
      for (const s of [-1, 1]) part(c, sw, G.sphere, sharedToon('#6fd45a'), [s * 0.09, 0.02, 0], [0.13, 0.045, 0.07], 1.1, [0, 0, s * 0.5]);
      part(c, sw, G.sphere, sharedToon('#ff8fb0'), [0, 0.08, 0], [0.05, 0.05, 0.05], 1.1);
      break;
    }
    case 'hood': {
      part(c, x.head, G.dome, c.body, [0, 0.1, -0.1], [0.54, 0.47, 0.5], 1.05, [-0.45, 0, 0]);
      part(c, x.head, G.cone, c.body, [0, 0.0, -0.45], [0.2, 0.35, 0.2], 1.1, [-Math.PI / 2 - 0.3, 0, 0]);
      break;
    }
    case 'demonhorns': {
      for (const s of [-1, 1]) part(c, x.head, G.cone, c.accent, [s * 0.24, 0.5, 0.0], [0.075, 0.26, 0.075], 1.2, [0.15, 0, -s * 0.45]);
      break;
    }
    case 'scarftail':
    case 'scarf': {
      const long = name === 'scarftail';
      part(c, x.rig, G.torus, c.accent, [0, 0.77, 0], [0.27, 0.27, 0.5], 1.1, [Math.PI / 2, 0, 0]);
      const sw = swayGroup(x.rig, [0.14, 0.72, -0.2], x.extras.swayX);
      part(c, sw, G.box, c.accent, [0, long ? -0.3 : -0.15, 0], [0.11, long ? 0.62 : 0.32, 0.035], 1.15);
      break;
    }
    case 'helm': {
      part(c, x.head, G.dome, sharedToon('#b9c0cc'), [0, 0.07, -0.05], [0.49, 0.42, 0.46], 1.06, TILT);
      part(c, x.head, G.box, c.accent, [0, 0.43, -0.02], [0.05, 0.12, 0.3], 1.1);
      break;
    }
    case 'horns': {
      for (const s of [-1, 1]) {
        part(c, x.head, G.cone, sharedToon('#f5ecd0'), [s * 0.45, 0.3, 0], [0.09, 0.3, 0.09], 1.15, [0, 0, -s * 1.05]);
      }
      break;
    }
    case 'beard': {
      part(c, x.head, G.sphere, x.mk ? c.hair : sharedToon('#6b4220'), [0, -0.37, 0.27], [0.27, 0.13, 0.11], 1.1);
      break;
    }
    case 'longbeard': {
      const sw = swayGroup(x.head, [0, -0.28, 0.25], x.extras.swayX);
      part(c, sw, G.sphere, sharedToon('#f4f4f0'), [0, -0.12, 0.02], [0.21, 0.28, 0.1], 1.1);
      break;
    }
    case 'leafcap': {
      part(c, x.head, G.dome, sharedToon('#4fae3c'), [0, 0.07, -0.05], [0.49, 0.4, 0.46], 1.06, TILT);
      const sw = swayGroup(x.head, [0.08, 0.44, 0.0], x.extras.swayZ);
      part(c, sw, G.sphere, sharedToon('#7be05a'), [0.07, 0.07, 0], [0.18, 0.05, 0.09], 1.12, [0, 0, 0.7]);
      part(c, sw, G.sphere, sharedToon('#4fae3c'), [-0.05, 0.05, 0], [0.13, 0.04, 0.07], 1.12, [0, 0, -0.6]);
      break;
    }
    case 'huntercap': {
      part(c, x.head, G.dome, sharedToon('#3f8f3a'), [0, 0.07, -0.05], [0.49, 0.4, 0.46], 1.06, TILT);
      part(c, x.head, G.cone, sharedToon('#3f8f3a'), [0, 0.42, -0.2], [0.2, 0.38, 0.2], 1.1, [-0.9, 0, 0]);
      const sw = swayGroup(x.head, [0.28, 0.35, -0.02], x.extras.swayZ);
      part(c, sw, G.sphere, sharedToon(RED), [0.07, 0.12, 0], [0.05, 0.22, 0.04], 1.15, [0, 0, -0.5]);
      break;
    }
    case 'healcap': {
      part(c, x.head, G.dome, sharedToon(WHITE), [0, 0.07, -0.05], [0.49, 0.4, 0.46], 1.06, TILT);
      part(c, x.head, G.box, sharedToon(RED), [0, 0.3, 0.31], [0.15, 0.045, 0.03], 0, [-0.55, 0, 0]);
      part(c, x.head, G.box, sharedToon(RED), [0, 0.3, 0.31], [0.045, 0.15, 0.03], 0, [-0.55, 0, 0]);
      break;
    }
    case 'glasses': {
      for (const s of [-1, 1]) part(c, x.head, G.torus, sharedBasic('#2a2f4a'), [s * 0.15, 0.0, 0.425], [0.1, 0.1, 0.1], 0);
      part(c, x.head, G.box, sharedBasic('#2a2f4a'), [0, 0.01, 0.43], [0.06, 0.012, 0.01], 0);
      break;
    }
    case 'headband': {
      part(c, x.head, G.torus, c.accent, [0, 0.12, -0.02], [0.47, 0.47, 0.5], 0, [Math.PI / 2 - 0.3, 0, 0]);
      const sw = swayGroup(x.head, [0, 0.14, -0.46], x.extras.swayX);
      part(c, sw, G.box, c.accent, [0, -0.1, 0], [0.08, 0.24, 0.02], 1.1);
      break;
    }
    case 'beret': {
      part(c, x.head, G.cyl, c.accent, [0.06, 0.36, -0.02], [0.4, 0.07, 0.36], 1.1, [0, 0, -0.18]);
      part(c, x.head, G.sphere, c.accent, [0.07, 0.43, -0.02], [0.045, 0.045, 0.045], 1.1);
      break;
    }
    case 'spiky': {
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        part(c, x.head, G.cone, c.hair, [Math.sin(a) * 0.34, 0.33 + Math.cos(a) * 0.08, -0.12], [0.1, 0.3, 0.1], 1.12, [-0.3, 0, -a * 0.9]);
      }
      break;
    }
    case 'twintails': {
      for (const s of [-1, 1]) {
        const sw = swayGroup(x.head, [s * 0.45, 0.04, -0.1], x.extras.swayZ);
        part(c, sw, G.sphere, c.accent, [0, 0.0, 0], [0.07, 0.07, 0.07], 1.1);
        part(c, sw, G.sphere, c.hair, [s * 0.05, -0.2, 0], [0.13, 0.22, 0.12], 1.08);
      }
      break;
    }
    case 'longhair': {
      part(c, x.head, G.sphere, c.hair, [0, -0.14, -0.3], [0.47, 0.52, 0.2], 1.06);
      break;
    }
    case 'cape': {
      const cape = new THREE.Group();
      cape.position.set(0, 0.78, -0.22);
      x.rig.add(cape);
      part(c, cape, G.box, c.accent, [0, -0.3, -0.03], [0.5, 0.62, 0.04], 1.1);
      x.extras.cape = cape;
      break;
    }
    case 'backpack': {
      part(c, x.rig, G.box, sharedToon(WOOD), [0, 0.5, -0.3], [0.2, 0.22, 0.1], 1.1);
      part(c, x.rig, G.cyl, c.accent, [0, 0.73, -0.3], [0.2, 0.08, 0.09], 1.1, [0, 0, Math.PI / 2]);
      break;
    }
    case 'satchel': {
      part(c, x.rig, G.box, sharedToon(WOOD), [-0.27, 0.34, 0.06], [0.14, 0.15, 0.1], 1.1);
      part(c, x.rig, G.box, sharedToon('#5a3a1a'), [0, 0.52, 0.15], [0.05, 0.6, 0.03], 0, [0, 0, 0.7]);
      part(c, x.rig, G.sphere, sharedToon('#6fd45a'), [-0.27, 0.45, 0.06], [0.07, 0.04, 0.04], 1.1);
      break;
    }
    case 'quiver': {
      const g = new THREE.Group();
      g.position.set(0.12, 0.6, -0.28);
      g.rotation.z = 0.4;
      x.rig.add(g);
      part(c, g, G.cyl, sharedToon(WOOD), [0, 0, 0], [0.075, 0.32, 0.075], 1.15);
      for (const s of [-0.03, 0, 0.03]) part(c, g, G.cone, sharedToon(RED), [s, 0.22, 0], [0.025, 0.07, 0.025], 1.2);
      break;
    }
    case 'halo': {
      const h = new THREE.Group();
      h.position.set(0, 0.62, -0.02);
      x.head.add(h);
      part(c, h, G.torus, sharedBasic('#ffe27a'), [0, 0, 0], [0.26, 0.26, 0.5], 0, [Math.PI / 2, 0, 0]);
      x.extras.halo = h;
      break;
    }
    case 'wings': {
      const wl: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(s * 0.12, 0.62, -0.26);
        x.rig.add(w);
        for (let i = 0; i < 3; i++) {
          const a = 0.95 - i * 0.5;
          part(c, w, G.sphere, sharedToon(WHITE), [s * Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0], [0.26 - i * 0.02, 0.075, 0.03], 1.1, [0, 0, s * a]);
        }
        wl.push(w);
      }
      x.extras.wings = wl;
      break;
    }
    case 'crown': {
      const g = new THREE.Group();
      g.position.set(0, 0.4, 0);
      x.head.add(g);
      part(c, g, G.cyl, sharedToon(GOLD), [0, 0, 0], [0.22, 0.08, 0.22], 1.1);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        part(c, g, G.cone, sharedToon(GOLD), [Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2], [0.05, 0.14, 0.05], 1.2);
      }
      break;
    }
    case 'pheasant': {
      // hai lông trĩ dài cong trên mão
      for (const s of [-1, 1]) {
        const sw = swayGroup(x.head, [s * 0.1, 0.52, -0.06], x.extras.swayZ);
        part(c, sw, G.cyl, sharedToon(RED), [s * 0.14, 0.26, 0], [0.022, 0.55, 0.022], 1.3, [0, 0, -s * 0.5]);
        part(c, sw, G.sphere, sharedToon(GOLD), [s * 0.3, 0.52, 0], [0.06, 0.09, 0.04], 1.2, [0, 0, -s * 0.5]);
      }
      break;
    }
    case 'monkeyears': {
      for (const s of [-1, 1]) {
        part(c, x.head, G.sphere, c.body, [s * 0.47, 0.02, -0.02], [0.14, 0.14, 0.08]);
        part(c, x.head, G.sphere, c.skin, [s * 0.48, 0.02, 0.03], [0.09, 0.09, 0.04], 0);
      }
      break;
    }
    case 'monkeytail':
      mkTail(c, x.rig, x.extras);
      break;
    case 'goldarmor': {
      part(c, x.rig, G.sphere, sharedToon(GOLD), [0, 0.6, 0.02], [0.295, 0.17, 0.26], 1.05);
      for (const s of [-1, 1]) part(c, x.rig, G.sphere, sharedToon(GOLD), [s * 0.31, 0.74, 0], [0.13, 0.1, 0.13], 1.1);
      break;
    }
    case 'floatnotes': {
      // ba nốt nhạc bay vòng quanh người
      const ring = new THREE.Group();
      ring.position.set(0, 0.95, 0);
      x.rig.add(ring);
      const cols = ['#ff7fa0', '#ffe14d', '#7fd9ff'];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const n = new THREE.Group();
        n.position.set(Math.cos(a) * 0.62, Math.sin(i * 2.1) * 0.18, Math.sin(a) * 0.62);
        ring.add(n);
        part(c, n, G.sphere, sharedBasic(cols[i]), [0, 0, 0], [0.075, 0.058, 0.04], 1.2);
        part(c, n, G.box, sharedBasic(cols[i]), [0.07, 0.11, 0], [0.018, 0.22, 0.018], 0);
        part(c, n, G.box, sharedBasic(cols[i]), [0.1, 0.2, 0], [0.07, 0.03, 0.018], 0, [0, 0, -0.4]);
      }
      x.extras.spin.push(ring);
      break;
    }
    case 'rock': {
      const g = holder(x, x.armR, [0, -0.3, 0.05]);
      part(c, g, G.sphere, sharedToon('#8b8f99'), [0, 0, 0.05], [0.14, 0.12, 0.14], 1.12);
      break;
    }
    case 'stone':
      // giáp đá trên vai
      part(c, x.rig, G.sphere, sharedToon('#8b8f99'), [0, 0.72, 0], [0.36, 0.13, 0.27], 1.1);
      break;
    default:
      break;
  }
}

/* ------------------------------ QUÁI ------------------------------ */
const MONSTER_LOOKS: Record<string, ProcLook> = {
  mk_con: { body: '#9a6a3c', accent: '#f0cd9c', skin: '#f0cd9c', props: [], scale: 0.85, monkey: true },
  mk_da: { body: '#8a8d96', accent: '#d8cfb8', skin: '#d8cfb8', props: ['stone'], scale: 1.05, monkey: true, extra: [] },
  mk_nem: { body: '#b27a45', accent: '#f4d6a4', skin: '#f4d6a4', props: ['rock'], scale: 0.88, monkey: true },
  mk_phap: { body: '#7b5ab5', accent: '#f2d9ae', skin: '#f2d9ae', props: ['hat', 'staff'], scale: 0.92, monkey: true },
  mk_dot: { body: '#3d3544', accent: '#a8988a', skin: '#a8988a', props: [], scale: 1.25, monkey: true, extra: ['gorilla'] },
  mk_chua: { body: '#c98a2c', accent: '#f6dca4', skin: '#f6dca4', props: ['crown', 'cape'], scale: 1.7, monkey: true, extra: ['gorilla'] },
};
export function monsterLook(key: string): ProcLook {
  return MONSTER_LOOKS[key] ?? MONSTER_LOOKS.mk_con;
}

/* ------------------------------ MÔ HÌNH + HOẠT HÌNH ------------------------------ */
const ease = (k: number) => 1 - (1 - k) * (1 - k);
/** ra quá đà rồi về (overshoot) */
const back = (k: number) => {
  const s = 1.9;
  const t = k - 1;
  return 1 + t * t * ((s + 1) * t + s);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
/** dao động tắt dần, k: 0..1 */
const damp = (k: number, freq: number) => Math.cos(k * freq) * (1 - k) * (1 - k);

export function createProceduralModel(look: ProcLook, outlines: boolean): HeroModel {
  const mats = {
    body: toon(look.body),
    accent: toon(look.accent),
    skin: toon(look.skin),
    hair: toon(look.hair ?? darker(look.accent, 0.55)),
  };
  const ctx: Ctx = { outlines, ...mats };
  const r = build(look, ctx);
  const own = [mats.body, mats.accent, mats.skin, mats.hair];
  const phase = Math.random() * 6.28;
  const { rig, head, armL, armR, legL, legR, extras } = r;

  let time = Math.random() * 3; // lệch pha để cả đội không nhún cùng nhịp
  let base: 'idle' | 'win' | 'die' = 'idle';
  let act: { kind: 'attack' | 'cast'; t: number } | null = null;
  let hitT = -1;
  let dieT = 0;
  let flash = 0;
  let faceCell = -1;
  let blinkT = 1 + Math.random() * 3;
  let blinkCell = 0;

  function setFlash(v: number) {
    if (v === flash) return;
    flash = v;
    for (const m of own) m.emissive.setRGB(v, v, v);
  }
  function setFace(cell: number) {
    if (cell === faceCell) return;
    faceCell = cell;
    setFaceCell(r.faceTex, cell);
  }

  const model: HeroModel = {
    object3d: r.root,
    height: 1.55 * look.scale,
    play(a: HeroAnim) {
      if (a === 'die') {
        base = 'die';
        dieT = 0;
        act = null;
      } else if (a === 'win') {
        if (base !== 'die') base = 'win';
      } else if (a === 'idle') {
        if (base !== 'die') base = 'idle';
        act = null;
      } else if (a === 'hit') {
        if (base !== 'die') hitT = 0;
      } else if (base !== 'die') act = { kind: a, t: 0 };
    },
    update(dt: number) {
      time += dt;
      let y = 0, z = 0, sx = 1, sy = 1, rotX = 0, rotY = 0, rotZ = 0;
      let aL = 0.08, aR = 0.08, aLz = 0.12, aRz = -0.12, headX = 0, headZ = 0;
      let flap = 0.2 + Math.sin(time * 5 + phase) * 0.12;

      /* --- nhún thở: squash & stretch + lắc nhẹ, mỗi mô hình một pha --- */
      const sn = Math.sin(time * ANIM.idleSpeed + phase);
      if (base === 'idle' || base === 'win') {
        sy = 1 + sn * ANIM.idleSquash * 0.55;
        sx = 1 - sn * ANIM.idleSquash * 0.35;
        y = (sn * 0.5 + 0.5) * ANIM.idleBob;
        aLz = 0.14 + sn * 0.05;
        aRz = -0.14 - sn * 0.05;
        aL = 0.08 + sn * 0.04;
        aR = 0.08 - sn * 0.04;
        rotZ = Math.sin(time * 1.6 + phase) * ANIM.swayZ;
        headZ = Math.sin(time * 1.3 + phase * 2) * 0.07;
      }

      /* --- mừng chiến thắng: nhảy cẫng, đáp đất bẹp, vẫy tay --- */
      if (base === 'win') {
        const w = time * ANIM.winHop;
        const j = Math.abs(Math.sin(w));
        y = j * 0.32;
        const land = Math.pow(1 - j, 6);
        sy = 1 - land * 0.16 + j * 0.1;
        sx = 1 + land * 0.12 - j * 0.06;
        aL = -2.5 + Math.sin(w * 1.0) * 0.25;
        aLz = 0.35;
        aR = -2.8;
        aRz = -0.45 + Math.sin(time * 11) * 0.5; // vẫy tay
        rotY = Math.sin(w * 0.5) * 0.4;
        headZ = Math.sin(w) * 0.1;
        flap = 0.55 + Math.sin(time * 14) * 0.25;
      }

      /* --- đòn thường / phép --- */
      if (act) {
        act.t += dt;
        const t = act.t;
        if (act.kind === 'attack') {
          const W = ANIM.atkWind, S = ANIM.atkStrike, E = ANIM.atkSettle;
          if (t >= W + S + E) act = null;
          else if (t < W) {
            // gồng: ngả ra sau, ngồi thấp, giơ tay cao
            const k = ease(t / W);
            aR = lerp(0.08, -2.9, k);
            aL = lerp(0.08, -0.5, k);
            rotX = -0.22 * k;
            sy = 1 - 0.1 * k;
            sx = 1 + 0.07 * k;
            z = -0.05 * k;
          } else if (t < W + S) {
            // vung xuống mạnh, vọt quá đà, kéo giãn
            const k = (t - W) / S;
            aR = lerp(-2.9, 0.55, k);
            aL = lerp(-0.5, 0.2, k);
            rotX = lerp(-0.22, 0.4, k);
            z = lerp(-0.05, 0.18, k);
            y = Math.sin(k * Math.PI) * 0.12;
            sy = lerp(0.9, 1.14, k);
            sx = lerp(1.07, 0.92, k);
          } else {
            // lắc tắt dần
            const k = (t - W - S) / E;
            const d = damp(k, 11);
            aR = lerp(0.55, 0.08, ease(k)) + d * 0.18;
            rotX = 0.4 * (1 - ease(k)) + d * 0.08;
            z = 0.18 * (1 - ease(k));
            sy = 1 + d * 0.07;
            sx = 1 - d * 0.05;
          }
        } else {
          const C = ANIM.castCrouch, P = ANIM.castSpring, H = ANIM.castHold, E = ANIM.castSettle;
          if (t >= C + P + H + E) act = null;
          else if (t < C) {
            const k = ease(t / C);
            sy = 1 - 0.2 * k;
            sx = 1 + 0.12 * k;
            aL = aR = lerp(0.1, -0.5, k);
            headX = 0.15 * k;
          } else if (t < C + P) {
            const k = (t - C) / P;
            y = 0.42 * Math.sin(Math.min(1, k) * Math.PI * 0.9);
            sy = lerp(0.8, 1.18, ease(k));
            sx = lerp(1.12, 0.9, ease(k));
            aL = aR = lerp(-0.5, -3.0, back(k));
            headX = lerp(0.15, -0.3, ease(k));
            flap = 0.6;
          } else if (t < C + P + H) {
            const k = (t - C - P) / H;
            y = 0.1 + Math.sin(k * Math.PI) * 0.04;
            sy = 1.08 + Math.sin(t * 30) * 0.03;
            sx = 1 - Math.sin(t * 30) * 0.02;
            aL = -2.9 + Math.sin(t * 26) * 0.14;
            aR = -2.9 - Math.sin(t * 26) * 0.14;
            headX = -0.28;
            rotZ = Math.sin(t * 20) * 0.04;
            flap = 0.6 + Math.sin(t * 24) * 0.25;
          } else {
            const k = (t - C - P - H) / E;
            const d = damp(k, 10);
            y = 0.1 * (1 - ease(k));
            sy = lerp(1.08, 1, ease(k)) + d * 0.05;
            sx = lerp(0.98, 1, ease(k)) - d * 0.03;
            aL = aR = lerp(-2.9, 0.1, ease(k));
            headX = -0.28 * (1 - ease(k));
          }
        }
      }

      /* --- trúng đòn: bị hất lùi, lắc lư, nháy trắng --- */
      if (hitT >= 0) {
        hitT += dt;
        const p = hitT / ANIM.hitTime;
        if (p >= 1) {
          hitT = -1;
          setFlash(0);
        } else {
          const s = Math.sin(Math.min(1, p * 1.6) * Math.PI);
          z -= 0.18 * s;
          sy *= 1 - 0.16 * s + damp(p, 14) * 0.05;
          sx *= 1 + 0.12 * s - damp(p, 14) * 0.03;
          rotX -= 0.26 * s;
          rotZ += Math.sin(p * 22) * 0.2 * (1 - p);
          aL = lerp(aL, -1.0, s);
          aR = lerp(aR, -1.0, s);
          setFlash(p < 0.3 ? 0.75 : 0);
        }
      }

      /* --- chết: bật lên, lộn nhào, nằm sõng soài, nảy, rồi co lại biến mất --- */
      if (base === 'die') {
        dieT += dt;
        const A = ANIM.dieStretch, B = ANIM.dieTumble, C = ANIM.dieBounce;
        aLz = 0.5;
        aRz = -0.5;
        if (dieT < A) {
          const k = dieT / A;
          sy = 1 + 0.25 * k;
          sx = 1 - 0.15 * k;
          rotX = 0.1 * k;
          aL = aR = lerp(0.1, -1.6, k);
        } else if (dieT < A + B) {
          const k = ease((dieT - A) / B);
          rotX = -Math.PI / 2 * k;
          rotY = k * Math.PI * 2;
          y = 0.3 * k + 0.55 * Math.sin(k * Math.PI);
          aL = Math.sin(dieT * 28) * 0.9 - 1.0;
          aR = -Math.sin(dieT * 28) * 0.9 - 1.0;
          sy = lerp(1.25, 1, k);
          sx = lerp(0.85, 1, k);
        } else {
          rotX = -Math.PI / 2;
          const k = clamp01((dieT - A - B) / C);
          y = 0.3 + 0.14 * Math.abs(Math.sin(k * Math.PI * 1.6)) * (1 - k);
          sy = 1 - damp(k, 14) * 0.1;
          sx = 1 + damp(k, 14) * 0.08;
          aL = aR = -0.9 + Math.sin(k * 18) * 0.15 * (1 - k);
        }
        setFlash(dieT < 0.18 ? 0.6 : 0);
        const sh = clamp01((dieT - ANIM.dieFadeStart) / (ANIM.dieFadeEnd - ANIM.dieFadeStart));
        r.root.scale.setScalar(look.scale * Math.max(0.001, 1 - sh * sh));
        if (sh >= 1) r.root.visible = false;
      }

      rig.position.set(0, y, z);
      rig.scale.set(sx, sy, sx);
      rig.rotation.set(rotX, rotY, rotZ);
      head.rotation.set(headX + Math.sin(time * 2.2 + phase) * 0.02, 0, headZ);
      armL.rotation.set(aL, 0, aLz);
      armR.rotation.set(aR, 0, aRz);
      const hop = base === 'win' ? Math.max(0, Math.sin(time * ANIM.winHop)) * 0.04 : 0;
      legL.position.y = 0.15 + hop;
      legR.position.y = 0.15 + hop;

      /* --- phụ kiện sống động --- */
      if (extras.cape) extras.cape.rotation.x = 0.12 + Math.sin(time * 2.4 + phase) * 0.06 + (act ? 0.25 : 0) + (base === 'win' ? 0.2 : 0);
      if (extras.halo) {
        extras.halo.rotation.y = time * 1.5;
        extras.halo.position.y = 0.62 + Math.sin(time * 3) * 0.02;
      }
      if (extras.tail) extras.tail.rotation.z = Math.sin(time * 3.4 + phase) * 0.35;
      if (extras.wings) {
        extras.wings[0].rotation.y = flap;
        extras.wings[1].rotation.y = -flap;
      }
      const sp = extras.spin;
      for (let i = 0; i < sp.length; i++) {
        if (sp[i].userData.axis === 'z') sp[i].rotation.z = time * 2.2;
        else sp[i].rotation.y = time * 1.8;
      }
      const sX = extras.swayX;
      for (let i = 0; i < sX.length; i++) sX[i].rotation.x = 0.25 + Math.sin(time * 3 + phase + i) * 0.22 + (act ? 0.3 : 0);
      const sZ = extras.swayZ;
      for (let i = 0; i < sZ.length; i++) sZ[i].rotation.z = Math.sin(time * 3.4 + phase + i * 1.7) * 0.18;
      const pu = extras.pulse;
      for (let i = 0; i < pu.length; i++) pu[i].scale.setScalar((pu[i].userData.s as number) * (1 + Math.sin(time * 5 + i) * 0.12 + (act?.kind === 'cast' ? 0.25 : 0)));

      /* --- khuôn mặt: chỉ đổi texture offset khi trạng thái đổi --- */
      let want: number;
      if (base === 'die') want = FACE.die;
      else if (hitT >= 0) want = FACE.hit;
      else if (base === 'win') want = FACE.win;
      else if (act) want = act.kind === 'cast' ? FACE.cast : FACE.attack;
      else {
        blinkT -= dt;
        if (blinkT <= 0) {
          if (blinkCell === 0) {
            blinkCell = Math.random() < ANIM.winkChance ? FACE.wink : FACE.blink;
            blinkT = ANIM.blinkTime * (blinkCell === FACE.wink ? 2 : 1);
          } else {
            blinkCell = 0;
            blinkT = ANIM.blinkMin + Math.random() * (ANIM.blinkMax - ANIM.blinkMin);
          }
        }
        want = blinkCell;
      }
      setFace(want);
    },
    setPalette(p: Partial<HeroPalette>) {
      if (p.body) mats.body.color.set(p.body);
      if (p.accent) {
        mats.accent.color.set(p.accent);
        if (!look.hair) mats.hair.color.copy(darker(p.accent, 0.55));
      }
    },
    dispose() {
      for (const m of own) m.dispose();
      r.faceMat.dispose();
      r.faceTex.dispose();
    },
  };
  // vẽ mặt đúng ngay từ khung hình đầu (chân dung chụp sau 1 lần update)
  setFace(FACE.idle);
  return model;
}
