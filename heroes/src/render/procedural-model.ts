// Mô hình chibi PROCEDURAL (tạm thời, chưa có glTF): đầu to ~45% chiều cao, thân nhỏ, hình khối dùng chung (cache),
// MeshToonMaterial, viền bằng vỏ phóng to quay mặt trong, hoạt hình squash & stretch tự tính (không cần skeleton).
import * as THREE from 'three';
import type { HeroAnim, HeroModel, HeroPalette } from './hero-model';

export interface ProcLook {
  body: string;
  accent: string;
  skin: string;
  props: string[];
  scale: number;
  monkey: boolean;
  /** mô tả riêng cho quái */
  extra?: string[];
}

/* ------------------------------ HÌNH KHỐI + VẬT LIỆU DÙNG CHUNG ------------------------------ */
const G = {
  sphere: new THREE.SphereGeometry(1, 18, 14),
  dome: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cone: new THREE.ConeGeometry(1, 1, 14),
  torus: new THREE.TorusGeometry(1, 0.12, 8, 24),
  arc: new THREE.TorusGeometry(1, 0.09, 6, 16, Math.PI),
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

interface Rig {
  root: THREE.Group;
  rig: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  extras: { cape?: THREE.Object3D; halo?: THREE.Object3D; tail?: THREE.Object3D };
}

function build(look: ProcLook, c: Ctx): Rig {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  const mk = look.monkey;
  const ex = look.extra ?? [];
  const big = ex.includes('gorilla');

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
  // mắt
  const eyeY = 0.0, eyeZ = 0.37;
  for (const sx of [-1, 1]) {
    part(c, head, G.sphere, sharedBasic('#1b1f33'), [sx * 0.15, eyeY, eyeZ], [0.065, 0.085, 0.04], 0);
    part(c, head, G.sphere, sharedBasic('#ffffff'), [sx * 0.15 + 0.02, eyeY + 0.03, eyeZ + 0.03], [0.022, 0.026, 0.015], 0);
    // má hồng
    if (!mk) part(c, head, G.sphere, sharedBasic('#ff9aa8'), [sx * 0.25, eyeY - 0.1, eyeZ - 0.07], [0.06, 0.035, 0.02], 0);
  }
  // miệng
  part(c, head, G.sphere, sharedBasic('#7a2a2a'), [0, eyeY - 0.13, eyeZ - 0.02], [0.05, 0.025, 0.02], 0);

  if (mk) {
    // mặt khỉ: mảng da sáng + tai tròn + lông mày dữ
    part(c, head, G.sphere, c.accent, [0, -0.06, 0.25], [0.3, 0.24, 0.2], 0);
    for (const sx of [-1, 1]) {
      part(c, head, G.sphere, c.body, [sx * 0.46, 0.02, -0.02], [0.14, 0.14, 0.08]);
      part(c, head, G.sphere, c.accent, [sx * 0.47, 0.02, 0.03], [0.09, 0.09, 0.04], 0);
      part(c, head, G.box, sharedBasic('#2a1a12'), [sx * 0.15, eyeY + 0.12, eyeZ - 0.02], [0.13, 0.03, 0.03], 0, [0, 0, sx * 0.35]);
    }
    part(c, head, G.dome, c.body, [0, 0.03, -0.02], [0.46, 0.4, 0.43], 1.0);
  } else if (!look.props.includes('hat') && !look.props.includes('hood') && !look.props.includes('helm')) {
    // tóc: mũ nửa cầu + mái
    part(c, head, G.dome, c.hair, [0, 0.03, -0.02], [0.47, 0.4, 0.44], 1.05);
    part(c, head, G.sphere, c.hair, [0, 0.2, 0.33], [0.3, 0.1, 0.14], 0);
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
  const extras: Rig['extras'] = {};

  // đuôi khỉ
  if (mk) {
    const tail = new THREE.Group();
    tail.position.set(0, 0.28, -0.24);
    rig.add(tail);
    for (let i = 0; i < 4; i++) {
      part(c, tail, G.sphere, c.body, [0, 0.08 * i + i * i * 0.012, -0.08 * i], [0.06 - i * 0.006, 0.06 - i * 0.006, 0.06 - i * 0.006], 1.1);
    }
    extras.tail = tail;
  }

  // phụ kiện
  for (const p of [...look.props, ...ex]) addProp(p, c, { rig, head, armL, armR, extras, mk });

  root.scale.setScalar(look.scale);
  return { root, rig, head, armL, armR, legL, legR, extras };
}

interface PropCtx {
  rig: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  extras: Rig['extras'];
  mk: boolean;
}
const STEEL = '#dfe6ee';
const GOLD = '#ffd24d';
const WOOD = '#8a5a2b';

function addProp(name: string, c: Ctx, x: PropCtx): void {
  switch (name) {
    case 'sword': {
      const g = new THREE.Group();
      g.position.set(0, -0.36, 0.05);
      g.rotation.x = -1.25;
      x.armR.add(g);
      part(c, g, G.box, sharedToon(STEEL), [0, 0.42, 0], [0.08, 0.72, 0.03], 1.2);
      part(c, g, G.box, c.accent, [0, 0.06, 0], [0.26, 0.05, 0.06], 1.15);
      part(c, g, G.cyl, c.accent, [0, -0.03, 0], [0.03, 0.09, 0.03], 1.2);
      break;
    }
    case 'dagger': {
      for (const arm of [x.armR, x.armL]) {
        const g = new THREE.Group();
        g.position.set(0, -0.36, 0.05);
        g.rotation.x = -1.3;
        arm.add(g);
        part(c, g, G.box, sharedToon('#cfd6ff'), [0, 0.2, 0], [0.06, 0.34, 0.025], 1.25);
        part(c, g, G.box, c.accent, [0, 0.02, 0], [0.16, 0.04, 0.05], 1.2);
      }
      break;
    }
    case 'bow': {
      const g = new THREE.Group();
      g.position.set(0, -0.3, 0.12);
      x.armL.add(g);
      const inner = new THREE.Group();
      inner.rotation.z = Math.PI / 2;
      const outer = new THREE.Group();
      outer.rotation.y = Math.PI / 2;
      g.add(outer);
      outer.add(inner);
      inner.scale.setScalar(0.42);
      part(c, inner, G.arc, sharedToon(WOOD), [0, 0, 0], [1, 1, 1], 1.18);
      part(c, g, G.box, sharedBasic('#f4f4f4'), [0, 0, 0], [0.012, 0.84, 0.012], 0);
      break;
    }
    case 'shield': {
      const g = new THREE.Group();
      g.position.set(-0.04, -0.22, 0.14);
      x.armL.add(g);
      part(c, g, G.cyl, c.body, [0, 0, 0], [0.27, 0.04, 0.27], 1.1, [Math.PI / 2, 0, 0]);
      part(c, g, G.torus, c.accent, [0, 0, 0.03], [0.27, 0.27, 0.5], 1.1);
      part(c, g, G.sphere, c.accent, [0, 0, 0.05], [0.08, 0.08, 0.05], 1.1);
      break;
    }
    case 'staff': {
      const g = new THREE.Group();
      g.position.set(0.02, -0.36, 0.06);
      x.armR.add(g);
      part(c, g, G.cyl, sharedToon(WOOD), [0, 0.1, 0], [0.035, 0.85, 0.035], 1.3);
      const orb = part(c, g, G.sphere, sharedBasic(c.accent.color.getStyle()), [0, 1.0, 0], [0.12, 0.12, 0.12], 1.15);
      orb.userData.pulse = true;
      part(c, g, G.torus, sharedToon(GOLD), [0, 0.92, 0], [0.11, 0.11, 0.11], 1.2, [Math.PI / 2, 0, 0]);
      break;
    }
    case 'flute': {
      const g = new THREE.Group();
      g.position.set(0.04, -0.4, 0.12);
      g.rotation.set(0, 0.4, Math.PI / 2 - 0.3);
      x.armR.add(g);
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
    case 'hood': {
      part(c, x.head, G.dome, c.body, [0, 0.0, -0.05], [0.54, 0.47, 0.5], 1.05);
      part(c, x.head, G.cone, c.body, [0, 0.0, -0.45], [0.2, 0.35, 0.2], 1.1, [-Math.PI / 2 - 0.3, 0, 0]);
      break;
    }
    case 'helm': {
      part(c, x.head, G.dome, sharedToon('#b9c0cc'), [0, 0.03, -0.02], [0.49, 0.42, 0.46], 1.06);
      part(c, x.head, G.box, c.accent, [0, 0.38, 0], [0.05, 0.12, 0.3], 1.1);
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
    case 'halo': {
      const h = new THREE.Group();
      h.position.set(0, 0.62, -0.02);
      x.head.add(h);
      part(c, h, G.torus, sharedBasic('#ffe27a'), [0, 0, 0], [0.26, 0.26, 0.5], 0, [Math.PI / 2, 0, 0]);
      x.extras.halo = h;
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
    case 'rock': {
      const g = new THREE.Group();
      g.position.set(0, -0.3, 0.05);
      x.armR.add(g);
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
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

export function createProceduralModel(look: ProcLook, outlines: boolean): HeroModel {
  const mats = {
    body: toon(look.body),
    accent: toon(look.accent),
    skin: toon(look.skin),
    hair: toon(darker(look.accent, 0.55)),
  };
  const ctx: Ctx = { outlines, ...mats };
  const r = build(look, ctx);
  const own = [mats.body, mats.accent, mats.skin, mats.hair];
  const phase = Math.random() * 6.28;

  let time = 0;
  let base: 'idle' | 'win' | 'die' = 'idle';
  let act: { kind: 'attack' | 'cast'; t: number } | null = null;
  let hitT = -1;
  let dieT = 0;
  let flash = 0;

  function setFlash(v: number) {
    if (v === flash) return;
    flash = v;
    for (const m of own) m.emissive.setRGB(v, v, v);
  }

  const model: HeroModel = {
    object3d: r.root,
    height: 1.55 * look.scale,
    play(a: HeroAnim) {
      if (a === 'die') {
        base = 'die';
        dieT = 0;
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
      const { rig, head, armL, armR, legL, legR, extras } = r;
      let y = 0, z = 0, sx = 1, sy = 1, rotX = 0;
      let aL = 0.08, aR = 0.08, aLz = 0.12, aRz = -0.12, headX = 0;

      const br = Math.sin(time * 3 + phase);
      if (base === 'idle' || base === 'win') {
        sy = 1 + br * 0.022;
        sx = 1 - br * 0.014;
        y = (br * 0.5 + 0.5) * 0.015;
        aLz = 0.14 + br * 0.04;
        aRz = -0.14 - br * 0.04;
      }
      if (base === 'win') {
        const j = Math.abs(Math.sin(time * 5.5));
        y = j * 0.28;
        sy = 1 + j * 0.08;
        sx = 1 - j * 0.05;
        aL = aR = -2.7 + Math.sin(time * 11) * 0.25;
        aLz = 0.25;
        aRz = -0.25;
      }

      if (act) {
        act.t += dt;
        if (act.kind === 'attack') {
          const p = act.t / 0.5;
          if (p >= 1) act = null;
          else if (p < 0.4) {
            const k = ease(p / 0.4);
            aR = -2.4 * k;
            rotX = -0.14 * k;
            sy = 1 + 0.06 * k;
            sx = 1 - 0.04 * k;
          } else {
            const k = ease((p - 0.4) / 0.6);
            aR = lerp(-2.4, -0.3, k);
            rotX = lerp(0.3, 0, k);
            z = lerp(0.12, 0, k);
            sy = lerp(0.92, 1, k);
            sx = lerp(1.06, 1, k);
          }
        } else {
          const p = act.t / 0.8;
          if (p >= 1) act = null;
          else if (p < 0.25) {
            const k = ease(p / 0.25);
            sy = 1 - 0.16 * k;
            sx = 1 + 0.1 * k;
            aL = aR = lerp(0.1, -0.6, k);
          } else if (p < 0.55) {
            const k = ease((p - 0.25) / 0.3);
            y = 0.35 * Math.sin(k * Math.PI * 0.9);
            sy = lerp(0.84, 1.16, k);
            sx = lerp(1.1, 0.92, k);
            aL = aR = lerp(-0.6, -2.8, k);
            headX = -0.25 * k;
          } else {
            const k = ease((p - 0.55) / 0.45);
            y = 0.1 * (1 - k);
            sy = lerp(1.16, 1, k);
            sx = lerp(0.92, 1, k);
            aL = aR = lerp(-2.8, 0.1, k);
            headX = -0.25 * (1 - k);
          }
        }
      }

      if (hitT >= 0) {
        hitT += dt;
        const p = hitT / 0.32;
        if (p >= 1) {
          hitT = -1;
          setFlash(0);
        } else {
          const s = Math.sin(p * Math.PI);
          z -= 0.16 * s;
          sy *= 1 - 0.14 * s;
          sx *= 1 + 0.1 * s;
          rotX -= 0.22 * s;
          setFlash(p < 0.4 ? 0.7 : 0);
        }
      }

      if (base === 'die') {
        dieT += dt;
        const k = ease(clamp01(dieT / 0.5));
        rotX = -Math.PI / 2 * k;
        y = 0.3 * k;
        aL = aR = lerp(0.1, -0.9, k);
        setFlash(dieT < 0.15 ? 0.6 : 0);
        const sh = clamp01((dieT - 0.9) / 0.5);
        const s = 1 - sh;
        r.root.scale.setScalar(look.scale * Math.max(0.001, s));
        if (sh >= 1) r.root.visible = false;
      }

      rig.position.set(0, y, z);
      rig.scale.set(sx, sy, sx);
      rig.rotation.set(rotX, 0, 0);
      head.rotation.x = headX + Math.sin(time * 2.2 + phase) * 0.02;
      armL.rotation.set(aL, 0, aLz);
      armR.rotation.set(aR, 0, aRz);
      legL.position.y = 0.15 + (base === 'win' ? Math.max(0, Math.sin(time * 5.5)) * 0.04 : 0);
      legR.position.y = legL.position.y;
      if (extras.cape) extras.cape.rotation.x = 0.12 + Math.sin(time * 2.4 + phase) * 0.06 + (act ? 0.2 : 0);
      if (extras.halo) {
        extras.halo.rotation.y = time * 1.5;
        extras.halo.position.y = 0.62 + Math.sin(time * 3) * 0.02;
      }
      if (extras.tail) extras.tail.rotation.z = Math.sin(time * 3.4 + phase) * 0.35;
    },
    setPalette(p: Partial<HeroPalette>) {
      if (p.body) mats.body.color.set(p.body);
      if (p.accent) {
        mats.accent.color.set(p.accent);
        mats.hair.color.copy(darker(p.accent, 0.55));
      }
    },
    dispose() {
      for (const m of own) m.dispose();
    },
  };
  return model;
}
