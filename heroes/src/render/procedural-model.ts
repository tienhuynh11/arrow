// Mô hình chibi PROCEDURAL: đầu to ~45% chiều cao, thân nhỏ, hình khối dùng chung (cache),
// MeshToonMaterial, viền bằng vỏ phóng to quay mặt trong, hoạt hình squash & stretch tự tính (không cần skeleton).
// Mặt = một lớp vỏ cầu mỏng dán texture atlas biểu cảm (face-atlas.ts), đổi ô khi đổi trạng thái / chớp mắt.
import * as THREE from 'three';
import { FACE, faceTexture, setFaceCell } from './face-atlas';
import { currentPreset } from './quality';
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

/* ------------------------------ THAM SỐ CHỈNH ĐƯỢC (giây / rad / đơn vị thế giới) ------------------------------ */
export const ANIM = {
  /* --- lò xo (semi-implicit Euler): k = độ cứng, c = giảm chấn; zeta = c / (2*sqrt(k)) < 1 thì rung quá đà --- */
  bodyK: 200, // thân mặc định (phục hồi sau đòn / hạ cánh): zeta ~0.42, rung 2-3 nhịp rồi tắt
  bodyC: 12,
  armK: 160, // tay/vũ khí mặc định
  armC: 9,
  maxDt: 0.05, // kẹp dt (dt đã nhân tốc độ trận) để lò xo không nổ
  /* --- nghỉ / thế sẵn sàng --- */
  idleSpeed: 3.2, // nhịp thở
  idleBob: 0.03,
  idleSquash: 0.04,
  swayZ: 0.035,
  readyBounce: 0.05, // nhún chân thế sẵn sàng (độ cao)
  readyRate: 6.5, // tần số nhún (rad/s)
  readyShuffle: 0.3, // biên độ đổi chân
  blinkMin: 1.6,
  blinkMax: 4.6,
  blinkTime: 0.13,
  winkChance: 0.16,
  /* --- chạy --- */
  runStepsMin: 7, // bước/giây khi chạy chậm
  runStepsMax: 9, // bước/giây khi nước rút (tỉ lệ tốc độ hiển thị)
  runHop: 0.15, // độ cao nảy mỗi bước
  runLean: 0.4, // ngả người ra trước (rad ~23 độ)
  runLegSwing: 0.28, // chân tiến/lùi
  legLift: 0.16, // chân nhấc
  runArm: 2.1, // biên độ vung tay
  landSquash: 2.4, // xung vận tốc bẹp khi chạm đất
  startCrouch: 0.1, // gồng lấy đà trước khi bứt
  skidTime: 0.3, // phanh trượt
  /* --- đòn thường: gồng -> vung -> hồi lò xo --- */
  atkWind: 0.1,
  atkStrike: 0.08,
  atkSettle: 0.2,
  bowDraw: 0.16, // thời gian kéo cung
  strikeK: 900, // lò xo lúc vung (nhanh, rung quá đà)
  strikeC: 24,
  recoverK: 170, // lò xo lúc hồi
  recoverC: 10,
  /* --- niệm phép: tụ lực -> bật nhảy giơ tay -> giữ rung -> hạ --- */
  castCrouch: 0.16,
  castSpring: 0.18,
  castHold: 0.2,
  castSettle: 0.24,
  castGlow: 0.22, // độ sáng toàn thân khi tụ phép (0 = tắt)
  /* --- trúng đòn --- */
  hitTime: 0.3, // thời gian mặt đau
  hitFlash: 0.07, // thời gian nháy trắng
  hitKick: 1, // nhân cường độ xung hất (z, ngả, bẹp, lắc)
  /* --- thắng / chết --- */
  winHop: 5.5,
  dieHit: 0.08,
  dieFly: 0.42,
  dieBounce1: 0.26,
  dieBounce2: 0.18,
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
/** lò xo 1 bậc tự do (x, v); ngủ khi đã yên */
class Spr {
  x: number;
  v = 0;
  constructor(x = 0) {
    this.x = x;
  }
}
/** semi-implicit Euler, chia nhỏ khi dt lớn; không cấp phát */
function spStep(s: Spr, t: number, k: number, c: number, dt: number) {
  if (Math.abs(t - s.x) < 1e-4 && Math.abs(s.v) < 2e-3) {
    s.x = t;
    s.v = 0;
    return;
  }
  const n = dt > 0.02 ? 2 : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (k * (t - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
}

const ease = (k: number) => 1 - (1 - k) * (1 - k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

/** móc chạy/đi bộ: 0 = đứng, 1 = chạy hết tốc (cảnh gọi mỗi khung; mô hình khác như glTF có thể bỏ qua) */
export interface MoveHook {
  setMove(k: number): void;
  /** thế sẵn sàng khi đứng ở tầm đánh giữa trận (nhún chân, tay giơ) */
  setReady(on: boolean): void;
  /** gọi mỗi khi chân chạm đất lúc chạy (strong = phanh/trượt) — cảnh dùng để nhả bụi */
  onStep: ((strong: boolean) => void) | null;
}

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
  const spd = 0.85 + (phase / 6.28) * 0.3; // mỗi mô hình một nhịp
  const { rig, head, armL, armR, legL, legR, extras } = r;
  /* chất lượng thấp: bỏ chuyển động phụ (đuôi/tóc/cape theo quán tính, lắc đầu, đổi chân, múa vũ khí) */
  const rich = currentPreset().level !== 'low';
  /* họ vũ khí quyết định kiểu đòn: chém / đâm gậy / thúc khiên / kéo cung */
  const has = (n: string) => look.props.includes(n);
  const fam: 'slash' | 'thrust' | 'bash' | 'bow' =
    has('bow') || has('bigbow') ? 'bow'
      : has('staff') || has('ruyi') || has('sunstar') ? 'thrust'
        : (has('shield') || has('bigshield')) && !has('sword') && !has('greatsword') && !has('dagger') ? 'bash'
          : 'slash';

  let time = Math.random() * 3; // lệch pha để cả đội không nhún cùng nhịp
  let base: 'idle' | 'win' | 'die' = 'idle';
  let act: { kind: 'attack' | 'cast'; t: number; ph: number } | null = null;
  let hitT = -1;
  let moveK = 0;
  let moveTo = 0;
  let readyTo = 0;
  let readyK = 0;
  let runPh = 0;
  let skidT = 0;
  let startT = 0;
  let stepIdx = 0;
  let winIdx = 0;
  let dieT = 0;
  let flash = 0;
  let faceCell = -1;
  let blinkT = 1 + Math.random() * 3;
  let blinkCell = 0;

  /* --- lớp lò xo: chỉ phản ứng (xung + đích), phần chu kỳ (thở, bước chạy) cộng trực tiếp lên trên --- */
  const sY = new Spr(), sZ = new Spr(), sSq = new Spr(), sLean = new Spr(), sRoll = new Spr(), sYaw = new Spr();
  const sHX = new Spr(), sHZ = new Spr(), sSec = new Spr(), sLeg = new Spr();
  const sAL = new Spr(0.08), sAR = new Spr(0.08);

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
  /** xung vận tốc vào lò xo thứ cấp (bỏ qua khi chất lượng thấp) */
  const kickSec = (v: number) => {
    if (rich) sSec.v += v;
  };

  const model: HeroModel & MoveHook = {
    object3d: r.root,
    onStep: null,
    setMove(k: number) {
      if (base === 'die') return;
      // bắt đầu chạy: ngồi gồng ngả ra sau rồi bứt; dừng: phanh trượt ngả ra sau, bụi, rồi lò xo lắc về
      if (k > 0 && moveTo === 0) {
        startT = ANIM.startCrouch;
        sSq.v -= 2;
        sLean.v -= 3;
      } else if (k === 0 && moveTo > 0.3) {
        skidT = ANIM.skidTime;
        sLean.v -= 6;
        sZ.v += 2.5;
        sSq.v -= 2;
        kickSec(-5);
        model.onStep?.(true);
      }
      moveTo = k;
    },
    setReady(on: boolean) {
      readyTo = on ? 1 : 0;
    },
    height: 1.55 * look.scale,
    play(a: HeroAnim) {
      if (a === 'die') {
        base = 'die';
        dieT = 0;
        act = null;
        hitT = -1;
      } else if (a === 'win') {
        if (base !== 'die') base = 'win';
      } else if (a === 'idle') {
        if (base !== 'die') base = 'idle';
        act = null;
      } else if (a === 'hit') {
        if (base === 'die') return;
        hitT = 0;
        // xung hất: lùi, ngả, bẹp, lắc nghiêng, đầu giật, tay văng — lò xo tự rung rồi tắt
        const q = ANIM.hitKick;
        sZ.v -= 3.2 * q;
        sLean.v -= 7 * q;
        sSq.v -= 4 * q;
        sRoll.v += (Math.random() < 0.5 ? -1 : 1) * 5 * q;
        sHX.v -= 6 * q;
        sAL.v -= 7 * q;
        sAR.v -= 7 * q;
        kickSec(6 * q);
      } else if (base !== 'die') act = { kind: a, t: 0, ph: 0 };
    },
    update(dtIn: number) {
      const dt = Math.min(dtIn, ANIM.maxDt);
      time += dt;
      /* đích lò xo (mặc định = đứng yên) */
      let tY = 0, tZ = 0, tSq = 0, tLean = 0, tRoll = 0, tHX = 0, tAL = 0.08, tAR = 0.08, tLeg = 0, tSec = 0;
      let bk = ANIM.bodyK, bc = ANIM.bodyC, ak = ANIM.armK, ac = ANIM.armC;
      /* phần cộng trực tiếp (chu kỳ) */
      let dY = 0, dZ = 0, dSq = 0, dLean = 0, dRoll = 0, dYaw = 0, dHX = 0, dHZ = 0, dAL = 0, dAR = 0;
      let aLz = 0.12, aRz = -0.12;
      let flap = 0.2 + Math.sin(time * 5 + phase) * 0.12;
      let legSw = 0;
      let glow = 0;
      const dead = base === 'die';

      /* --- nghỉ: thở squash & stretch + lắc nhẹ --- */
      if (base === 'idle') {
        const sn = Math.sin(time * ANIM.idleSpeed * spd + phase);
        dSq = sn * ANIM.idleSquash * 0.55;
        dY = (sn * 0.5 + 0.5) * ANIM.idleBob;
        aLz = 0.14 + sn * 0.05;
        aRz = -0.14 - sn * 0.05;
        tAL = 0.08 + sn * 0.04;
        tAR = 0.08 - sn * 0.04;
        dRoll = Math.sin(time * 1.6 * spd + phase) * ANIM.swayZ;
        dHZ = Math.sin(time * 1.3 * spd + phase * 2) * 0.07;
      }

      /* --- thế sẵn sàng giữa trận: luôn nhún, đổi trọng tâm, vũ khí đảo, đổi chân --- */
      readyK += (readyTo - readyK) * Math.min(1, dt * 9);
      if (readyK > 0.01 && base === 'idle') {
        const rk = readyK;
        const bn = Math.abs(Math.sin(time * ANIM.readyRate * spd + phase));
        const sh = Math.sin(time * 2.3 * spd + phase * 1.7);
        dY += bn * ANIM.readyBounce * rk;
        dSq += (bn - 0.5) * 0.09 * rk;
        tLean += 0.1 * rk;
        dRoll += sh * 0.07 * rk;
        dHZ += sh * 0.05 * rk;
        tAL = lerp(tAL, -0.75 + sh * 0.15, rk);
        tAR = lerp(tAR, -0.35 - sh * 0.15, rk);
        if (rich) {
          dAR += Math.sin(time * 5.1 + phase) * 0.12 * rk; // vũ khí đảo nhẹ
          dAL += Math.sin(time * 4.3 + phase * 2) * 0.08 * rk;
          dYaw += Math.sin(time * 1.9 * spd + phase) * 0.07 * rk;
          legSw += Math.sin(time * 3.4 * spd + phase) * ANIM.readyShuffle * rk; // đổi chân
          tSec += Math.sin(time * 3 + phase) * 0.15 * rk;
        }
      }

      /* --- mừng chiến thắng: nhảy cẫng, xoay vòng mỗi 3 nhịp, đấm tay lên trời --- */
      if (base === 'win') {
        const w = time * ANIM.winHop;
        const j = Math.abs(Math.sin(w));
        const n = Math.floor(w / Math.PI);
        const land = Math.pow(1 - j, 6);
        dY = j * 0.36;
        dSq = (j - 0.5) * 0.12 - land * 0.16;
        if (n !== winIdx) {
          winIdx = n;
          sSq.v -= 2.5;
          kickSec(3);
          model.onStep?.(false);
        }
        dYaw = n % 3 === 2 ? Math.PI * 2 * ease(w / Math.PI - n) : Math.sin(w * 0.5) * 0.4;
        const pump = Math.sin(time * 9);
        tAR = -2.8 + pump * 0.4;
        tAL = -2.5 - pump * 0.35;
        aLz = 0.35;
        aRz = -0.45;
        ak = 600;
        ac = 26;
        dHZ = Math.sin(w) * 0.1;
        flap = 0.55 + Math.sin(time * 14) * 0.25;
      }

      /* --- đòn thường / phép: gồng -> vung (lò xo cứng, rung quá đà) -> hồi lò xo --- */
      if (act) {
        act.t += dt;
        const t = act.t;
        if (act.kind === 'attack') {
          const W = fam === 'bow' ? ANIM.bowDraw : ANIM.atkWind, S = ANIM.atkStrike, E = ANIM.atkSettle;
          if (t >= W + S + E) act = null;
          else if (t < W) {
            // gồng: kéo ra sau + ngồi thấp
            bk = 420; bc = 28; ak = 500; ac = 30;
            tLeg = -0.6;
            if (fam === 'slash') { tAR = -3.0; tAL = -0.7; tLean = -0.32; tSq = -0.15; tZ = -0.09; }
            else if (fam === 'thrust') { tAR = 0.7; tAL = -0.9; tLean = -0.25; tSq = -0.12; tZ = -0.1; }
            else if (fam === 'bash') { tAR = 0.5; tAL = 0.5; tLean = -0.3; tSq = -0.18; tZ = -0.12; }
            else { tAL = -1.5; tAR = -0.5; tLean = -0.12; tSq = -0.1; tZ = -0.05; dAR = Math.sin(t * 70) * 0.03 * (t / W); }
          } else if (t < W + S) {
            if (act.ph < 1) {
              act.ph = 1;
              if (fam === 'bow') { sZ.v -= 2.5; sLean.v -= 3; kickSec(4); }
              else { sY.v += 1.8; kickSec(-5); }
            }
            // vung mạnh: bật tới, kéo giãn, tay vọt quá đà
            bk = ANIM.strikeK; bc = ANIM.strikeC; ak = 1000; ac = 22;
            tLeg = 0.8;
            if (fam === 'slash') { tAR = 0.9; tAL = 0.4; tLean = 0.55; tSq = 0.18; tZ = 0.16; tY = 0.1; }
            else if (fam === 'thrust') { tAR = -1.6; tAL = -1.4; tLean = 0.65; tSq = 0.15; tZ = 0.22; }
            else if (fam === 'bash') { tAR = -1.5; tAL = -1.3; tLean = 0.5; tSq = 0.2; tZ = 0.26; }
            else { tAR = 0.6; tAL = -1.35; tLean = -0.1; tSq = 0.1; tZ = -0.12; }
          } else {
            if (act.ph < 2) {
              act.ph = 2;
              sSq.v -= ANIM.landSquash * 0.8;
              kickSec(4);
            }
            bk = ANIM.recoverK; bc = ANIM.recoverC; ak = 150; ac = 8; // zeta thấp -> lắc tắt dần
          }
        } else {
          const C = ANIM.castCrouch, P = ANIM.castSpring, H = ANIM.castHold, E = ANIM.castSettle;
          if (t >= C + P + H + E) act = null;
          else if (t < C) {
            // tụ lực: ngồi bẹp, thu tay, rung nhẹ, bắt đầu phát sáng
            const k = t / C;
            bk = 350; bc = 24; ak = 400; ac = 26;
            tSq = -0.22; tAL = -0.5; tAR = -0.5; tLean = -0.1; tZ = -0.05; tHX = 0.15;
            dRoll = Math.sin(t * 55) * 0.03 * k;
            glow = ANIM.castGlow * k;
          } else if (t < C + P) {
            if (act.ph < 1) {
              act.ph = 1;
              sSq.v += 3;
              kickSec(-6);
              model.onStep?.(true);
            }
            // bật nhảy, giơ cao hai tay, giật lùi khi thả
            bk = 260; bc = 14; ak = 500; ac = 18;
            tY = 0.38; tSq = 0.2; tAL = -3.0; tAR = -3.0; tZ = -0.12; tHX = -0.3;
            flap = 0.6;
            glow = ANIM.castGlow;
          } else if (t < C + P + H) {
            const q = t - C - P;
            bk = 200; bc = 12; ak = 400; ac = 20;
            tY = 0.2; tSq = 0.06; tAL = -2.9; tAR = -2.9; tHX = -0.28; tZ = -0.1;
            dAL = Math.sin(q * 26) * 0.14;
            dAR = -Math.sin(q * 26) * 0.14;
            dRoll = Math.sin(q * 20) * 0.04;
            dSq = Math.sin(q * 30) * 0.03;
            flap = 0.6 + Math.sin(q * 24) * 0.25;
            glow = ANIM.castGlow * (0.55 + 0.45 * Math.sin(q * 40));
          } else {
            if (act.ph < 2) {
              act.ph = 2;
              sSq.v -= ANIM.landSquash;
              sY.v -= 1;
              kickSec(4);
            }
            bk = 190; bc = 10; ak = 150; ac = 8;
          }
        }
      }

      /* --- chạy: nhịp bước ∝ tốc độ, nhấc chân + vung tay biên độ lớn, nảy, ngả 23 độ, bụi mỗi bước --- */
      moveK += (moveTo - moveK) * Math.min(1, dt * 14);
      let swing = 0;
      const canRun = !dead && !act;
      let running = false;
      if (startT > 0 && canRun) {
        // gồng lấy đà: ngồi, ngả ra sau, rồi bứt
        startT -= dt;
        bk = 500; bc = 30;
        tSq = -0.16; tLean = -0.2; tAL = 0.5; tAR = 0.5;
        if (startT <= 0) {
          sY.v += 2.2;
          sLean.v += 5;
          sSq.v += 2.5;
          kickSec(-5);
          model.onStep?.(true);
        }
      } else if (moveK > 0.02 && canRun) {
        running = true;
        const cad = lerp(ANIM.runStepsMin, ANIM.runStepsMax, clamp01((moveK - 0.6) / 0.4)); // bước/giây
        runPh += dt * Math.PI * cad;
        const sw = Math.sin(runPh);
        swing = sw;
        legSw = sw * moveK;
        const hp = Math.abs(sw); // 0 = chạm đất, 1 = đỉnh nhảy
        dY += hp * ANIM.runHop * moveK;
        dSq += (hp - 0.5) * 0.16 * moveK; // giãn khi nhấc, bẹp khi chạm
        dRoll += sw * 0.09 * moveK;
        dYaw += sw * 0.14 * moveK;
        tLean += ANIM.runLean * moveK;
        tHX = -0.14 * moveK;
        tAL = lerp(tAL, legSw * ANIM.runArm - 0.3, moveK);
        tAR = lerp(tAR, -legSw * ANIM.runArm - 0.3, moveK);
        ak = 700; ac = 30;
        if (rich) {
          dHX -= Math.cos(runPh * 2) * 0.06 * moveK; // đầu nảy trễ pha
          dHZ -= sw * 0.08 * moveK;
          tSec = 0.35 * moveK; // đuôi/tai/cape bay ra sau
        }
        const si = Math.floor(runPh / Math.PI);
        if (si !== stepIdx) {
          stepIdx = si;
          sSq.v -= ANIM.landSquash * moveK; // chạm đất bẹp
          if (rich) {
            kickSec(2.2 * moveK);
            sHX.v += 2.5 * moveK;
          }
          if (moveK > 0.5) model.onStep?.(false);
        }
      }
      /* phanh trượt: ngả ra sau, trượt tới, chân dạng; hết giờ phanh lò xo tự lắc về thế sẵn sàng */
      if (skidT > 0 && canRun) {
        skidT -= dt;
        const k = clamp01(skidT / ANIM.skidTime);
        bk = 300; bc = 18;
        tLean = -0.4 * k;
        tZ = 0.18 * k;
        tSq = -0.08 * k;
        tAL = lerp(tAL, -0.9, k);
        tAR = lerp(tAR, -0.9, k);
        legSw = lerp(legSw, 1, k * 0.9);
        tSec = -0.5 * k;
        dY *= 1 - k;
      }
      if (running) {
        sLeg.x = legSw; // chân chạy theo chu kỳ trực tiếp
        sLeg.v = 0;
      } else {
        spStep(sLeg, tLeg, 300, 20, dt);
        legSw += sLeg.x;
      }

      /* --- tích phân lò xo --- */
      spStep(sY, tY, bk, bc, dt);
      spStep(sZ, tZ, bk, bc, dt);
      spStep(sSq, tSq, bk, bc, dt);
      spStep(sLean, tLean, bk, bc, dt);
      spStep(sRoll, tRoll, bk, bc, dt);
      spStep(sYaw, 0, bk, bc, dt);
      spStep(sHX, tHX, bk, bc, dt);
      spStep(sHZ, 0, bk, bc, dt);
      spStep(sSec, tSec, 120, 7, dt);
      spStep(sAL, tAL, ak, ac, dt);
      spStep(sAR, tAR, ak, ac, dt);

      /* --- trúng đòn: nháy trắng ngắn, mặt đau; chuyển động nằm ở xung lò xo --- */
      let flashV = glow;
      if (hitT >= 0) {
        hitT += dt;
        if (hitT < ANIM.hitFlash) flashV = 0.95;
        if (hitT >= ANIM.hitTime) hitT = -1;
      }

      /* --- ghép --- */
      let y = sY.x + dY, z = sZ.x + dZ;
      let sq = sSq.x + dSq;
      let rotX = sLean.x + dLean, rotY = sYaw.x + dYaw, rotZ = sRoll.x + dRoll;
      let headX = sHX.x + dHX, headZ = sHZ.x + dHZ;
      let aL = sAL.x + dAL, aR = sAR.x + dAR;
      let sx: number, sy: number;
      const hop = base === 'win' ? Math.max(0, Math.sin(time * ANIM.winHop)) * 0.04 : 0;

      /* --- chết: trúng đòn -> bay lùi + lộn nhào xoay -> nảy 2 lần trên đất -> co lại biến mất --- */
      if (dead) {
        dieT += dt;
        const A = ANIM.dieHit, B = ANIM.dieFly;
        aLz = 0.5;
        aRz = -0.5;
        sq = 0; y = 0; z = 0; rotX = 0; rotY = 0; rotZ = 0; headX = 0; headZ = 0;
        if (dieT < A) {
          const k = dieT / A;
          sq = 0.2 * k;
          z = -0.12 * k;
          rotX = -0.3 * k;
          aL = aR = lerp(0.1, -1.6, k);
        } else if (dieT < A + B) {
          const k = (dieT - A) / B;
          const e = ease(k);
          rotX = -Math.PI / 2 * e - 0.3 * (1 - e);
          rotY = k * Math.PI * 2;
          y = 0.3 * e + 0.85 * 4 * k * (1 - k);
          z = -0.12 - 0.8 * e;
          aL = Math.sin(dieT * 30) * 0.9 - 1.0;
          aR = -Math.sin(dieT * 30) * 0.9 - 1.0;
          sq = lerp(0.2, 0, k);
        } else {
          const tc = dieT - A - B;
          rotX = -Math.PI / 2;
          z = -0.92 - 0.14 * ease(clamp01(tc / 0.5)); // trượt thêm một chút
          const B1 = ANIM.dieBounce1, B2 = ANIM.dieBounce2;
          let lift = 0, sqz = 0;
          if (tc < B1) {
            const k = tc / B1;
            lift = 0.26 * 4 * k * (1 - k);
            sqz = k > 0.9 ? -0.12 : 0;
          } else if (tc < B1 + B2) {
            const k = (tc - B1) / B2;
            lift = 0.1 * 4 * k * (1 - k);
          } else {
            sqz = -0.08 * Math.max(0, 1 - (tc - B1 - B2) * 8);
          }
          y = 0.3 + lift;
          sq = sqz;
          aL = aR = -0.9 + Math.sin(tc * 18) * 0.15 * Math.max(0, 1 - tc);
        }
        flashV = dieT < 0.15 ? 0.7 : 0;
        const sh = clamp01((dieT - ANIM.dieFadeStart) / (ANIM.dieFadeEnd - ANIM.dieFadeStart));
        r.root.scale.setScalar(look.scale * Math.max(0.001, 1 - sh * sh));
        if (sh >= 1) r.root.visible = false;
      }
      setFlash(flashV);

      sq = Math.max(-0.4, Math.min(0.45, sq));
      sy = 1 + sq;
      sx = 1 - sq * 0.65;
      rig.position.set(0, Math.max(-0.05, y), z);
      rig.scale.set(sx, sy, sx);
      rig.rotation.set(rotX, rotY, rotZ);
      head.rotation.set(headX + Math.sin(time * 2.2 + phase) * 0.02, 0, headZ);
      armL.rotation.set(aL, 0, aLz);
      armR.rotation.set(aR, 0, aRz);
      legL.position.y = 0.15 + hop + Math.max(0, legSw) * ANIM.legLift;
      legR.position.y = 0.15 + hop + Math.max(0, -legSw) * ANIM.legLift;
      legL.position.z = legSw * ANIM.runLegSwing;
      legR.position.z = -legSw * ANIM.runLegSwing;

      /* --- phụ kiện: dao động nền + theo quán tính (sSec) --- */
      const mk = canRun ? moveK : 0;
      const sec = rich ? sSec.x : 0;
      if (extras.cape) extras.cape.rotation.x = 0.12 + Math.sin(time * 2.4 + phase) * 0.06 + (act ? 0.25 : 0) + (base === 'win' ? 0.2 : 0) + mk * (0.45 + swing * 0.12) + sec * 0.8;
      if (extras.halo) {
        extras.halo.rotation.y = time * 1.5;
        extras.halo.position.y = 0.62 + Math.sin(time * 3) * 0.02;
      }
      if (extras.tail) extras.tail.rotation.z = Math.sin(time * 3.4 + phase) * 0.35 + mk * swing * 0.55 + sec * 0.9;
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
      for (let i = 0; i < sX.length; i++) sX[i].rotation.x = 0.25 + Math.sin(time * 3 + phase + i) * 0.22 + (act ? 0.3 : 0) + mk * (0.4 + (rich ? Math.sin(runPh * 2 + i) * 0.25 : 0)) + sec * 1.1;
      const sZ2 = extras.swayZ;
      for (let i = 0; i < sZ2.length; i++) sZ2[i].rotation.z = Math.sin(time * 3.4 + phase + i * 1.7) * 0.18 + (rich ? mk * Math.sin(runPh * 2 + i * 1.7) * 0.3 : 0) + sec * 0.4;
      const pu = extras.pulse;
      for (let i = 0; i < pu.length; i++) pu[i].scale.setScalar((pu[i].userData.s as number) * (1 + Math.sin(time * 5 + i) * 0.12 + (act?.kind === 'cast' ? 0.25 : 0)));

      /* --- khuôn mặt: chỉ đổi texture offset khi trạng thái đổi --- */
      let want: number;
      if (dead) want = FACE.die;
      else if (hitT >= 0 && hitT < ANIM.hitTime) want = FACE.hit;
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
