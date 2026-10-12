import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import type { SceneKit } from './scene';

/**
 * Bộ nhân vật RIÊNG cho ĐẤU VẬT TRÊN NÓC NHÀ: mô hình có khớp (hông–bụng/ngực–đầu, tay: vai–cánh tay–cẳng tay–nắm đấm,
 * chân: đùi–cẳng chân–bàn chân, đuôi/tai/sừng/mào là khớp phụ) + bộ animator thủ tục (không clip, lò xo + blend mượt):
 * đứng nghỉ thủ thế, chạy, nhảy / đáp, đấm 3 đòn, tư thế tung skill, bị đánh, choáng, ngã / đứng dậy, ăn mừng.
 * Hai lớp: nửa dưới (chạy) và nửa trên (đánh / skill) nên vừa chạy vừa đánh được.
 * Geometry + vật liệu dùng chung theo loài (cache), không tạo mới mỗi khung hình.
 */
export interface FighterState {
  time: number;
  /** vận tốc trong toạ độ cảnh (x, z) */
  vx: number;
  vz: number;
  /** hướng thân hiện tại (yaw cảnh): mặt nhìn (sin yaw, cos yaw) */
  yaw: number;
  grounded: boolean;
  vy: number;
  stunned: boolean;
  down: boolean;
  out: boolean;
  cheer: boolean;
  /** mức loạng choạng 0..1 */
  wob: number;
}

export interface Fighter {
  root: Group;
  /** gắn thêm vào thân (aura…) */
  body: Group;
  setYaw(a: number): void;
  update(dt: number, s: FighterState): void;
  punch(idx: number): void;
  skill(key: string, durSec: number): void;
  /** dx, dz: hướng lực (toạ độ cảnh) */
  hit(dx: number, dz: number, force: number): void;
  setShadows(on: boolean): void;
  dispose(): void;
}

export interface FighterKit {
  create(speciesId: string, accent: string, isMe: boolean): Fighter;
  dispose(): void;
}

/* ---------------- khớp ---------------- */
const K = {
  bob: 0, hipTw: 1, leanX: 2, leanZ: 3, tTw: 4, tPx: 5, tRz: 6, hX: 7, hY: 8, hZ: 9,
  aLx: 10, aLz: 11, aLe: 12, aRx: 13, aRz: 14, aRe: 15,
  lLx: 16, lLk: 17, lRx: 18, lRk: 19, sq: 20, lunge: 21, N: 22,
};

interface Sp {
  fur: string;
  belly: string;
  skin: string;
  chest: [number, number, number];
  bellyR: [number, number, number];
  thigh: number;
  shin: number;
  legT: number;
  foot: [number, number, number];
  sw: number;
  ua: number;
  fa: number;
  armT: number;
  fist: number;
  headR: number;
  headY: number;
  headZ: number;
  cad: number;
  stride: number;
  weight: number;
}

const SP: Record<string, Sp> = {
  bull: { fur: '#8a5a3a', belly: '#e8d0b0', skin: '#6c4430', chest: [0.5, 0.42, 0.34], bellyR: [0.4, 0.34, 0.32], thigh: 0.36, shin: 0.34, legT: 0.17, foot: [0.2, 0.12, 0.34], sw: 0.54, ua: 0.32, fa: 0.3, armT: 0.18, fist: 0.18, headR: 0.36, headY: 0.86, headZ: 0.05, cad: 0.85, stride: 0.75, weight: 1.0 },
  bear: { fur: '#8a5a35', belly: '#c89a6a', skin: '#6a4428', chest: [0.54, 0.46, 0.42], bellyR: [0.5, 0.42, 0.4], thigh: 0.32, shin: 0.3, legT: 0.22, foot: [0.26, 0.14, 0.36], sw: 0.58, ua: 0.3, fa: 0.28, armT: 0.22, fist: 0.22, headR: 0.4, headY: 0.8, headZ: 0.04, cad: 0.7, stride: 0.6, weight: 1.3 },
  fox: { fur: '#ff8a3d', belly: '#fff0e0', skin: '#3a2a20', chest: [0.34, 0.34, 0.26], bellyR: [0.3, 0.28, 0.24], thigh: 0.4, shin: 0.38, legT: 0.12, foot: [0.14, 0.1, 0.3], sw: 0.4, ua: 0.3, fa: 0.3, armT: 0.11, fist: 0.13, headR: 0.32, headY: 0.8, headZ: 0.04, cad: 1.25, stride: 1.0, weight: 0.6 },
  turtle: { fur: '#7fd88a', belly: '#e8e0a0', skin: '#5cb86a', chest: [0.46, 0.4, 0.36], bellyR: [0.42, 0.36, 0.34], thigh: 0.28, shin: 0.26, legT: 0.2, foot: [0.22, 0.12, 0.3], sw: 0.5, ua: 0.26, fa: 0.26, armT: 0.18, fist: 0.17, headR: 0.3, headY: 0.72, headZ: 0.24, cad: 0.6, stride: 0.55, weight: 1.2 },
  monkey: { fur: '#9a6a3a', belly: '#e8c9a0', skin: '#e8c9a0', chest: [0.36, 0.36, 0.26], bellyR: [0.32, 0.3, 0.26], thigh: 0.36, shin: 0.36, legT: 0.14, foot: [0.16, 0.1, 0.3], sw: 0.44, ua: 0.42, fa: 0.4, armT: 0.13, fist: 0.15, headR: 0.34, headY: 0.8, headZ: 0.04, cad: 1.15, stride: 1.0, weight: 0.7 },
  tiger: { fur: '#ff9f2d', belly: '#fff2dc', skin: '#e08a1a', chest: [0.46, 0.42, 0.32], bellyR: [0.38, 0.32, 0.3], thigh: 0.38, shin: 0.36, legT: 0.17, foot: [0.19, 0.11, 0.33], sw: 0.5, ua: 0.32, fa: 0.3, armT: 0.17, fist: 0.17, headR: 0.35, headY: 0.82, headZ: 0.04, cad: 1.0, stride: 0.9, weight: 1.0 },
  rooster: { fur: '#f4f0e8', belly: '#ffffff', skin: '#ffc233', chest: [0.34, 0.4, 0.3], bellyR: [0.3, 0.32, 0.28], thigh: 0.4, shin: 0.42, legT: 0.08, foot: [0.22, 0.06, 0.34], sw: 0.42, ua: 0.3, fa: 0.28, armT: 0.1, fist: 0.15, headR: 0.28, headY: 0.86, headZ: 0.04, cad: 1.3, stride: 1.0, weight: 0.55 },
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createFighterKit(k: SceneKit): FighterKit {
  const low = k.low;
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const G = {
    sph: own(new SphereGeometry(1, low ? 8 : 12, low ? 6 : 9)),
    cap: own(new CapsuleGeometry(0.5, 1, 3, low ? 6 : 8)),
    cone: own(new ConeGeometry(1, 1, low ? 6 : 8)),
    box: own(new BoxGeometry(1, 1, 1)),
    cyl: own(new CylinderGeometry(1, 1, 1, low ? 6 : 8)),
    torus: own(new TorusGeometry(1, 0.13, 6, low ? 12 : 18)),
  };
  const matCache = new Map<string, Material>();
  const mat = (c: string): Material => {
    let m = matCache.get(c);
    if (!m) {
      m = k.lit({ color: c });
      matCache.set(c, m);
      owned.push(m as unknown as { dispose(): void });
    }
    return m;
  };
  // texture vẽ sẵn: mai rùa, sọc hổ (một lần)
  const shellTex = k.texture(128, 128, (g, w, h) => {
    g.fillStyle = '#3c8f4a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#26602f';
    g.lineWidth = 5;
    const r = 24;
    for (let row = -1; row < 6; row++) {
      for (let c = -1; c < 5; c++) {
        const cx = c * r * 1.75 + (row % 2 ? r * 0.875 : 0);
        const cy = row * r * 1.52;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          g.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
        }
        g.closePath();
        g.stroke();
      }
    }
  });
  const shellMat = k.lit({ map: shellTex });
  owned.push(shellMat as unknown as { dispose(): void });

  const create = (speciesId: string, accent: string, isMe: boolean): Fighter => {
    const sp = SP[speciesId] ?? SP.bear;
    const root = new Group();
    const body = new Group();
    root.add(body);
    const shadowMeshes: Mesh[] = [];
    const smallMeshes: Mesh[] = [];

    const m = (parent: Group, geo: BufferGeometry, material: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0, opt = '') => {
      const mesh = new Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.rotation.set(rx, ry, rz);
      parent.add(mesh);
      if (opt === 's') shadowMeshes.push(mesh);
      else if (opt === 'x') smallMeshes.push(mesh);
      return mesh;
    };
    const grp = (parent: Group, x: number, y: number, z: number) => {
      const g = new Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };
    const fur = mat(sp.fur);
    const belly = mat(sp.belly);
    const skin = mat(sp.skin);
    const dark = mat('#2a2a2e');
    const white = mat('#ffffff');
    const acc = mat(accent);

    const hipsY = sp.thigh + sp.shin + sp.foot[1] * 0.8;
    const hips = grp(body, 0, hipsY, 0);

    /* ---- chân ---- */
    const mkLeg = (side: number) => {
      const thigh = grp(hips, side * 0.17, -0.04, 0);
      m(thigh, G.cap, fur, 0, -sp.thigh * 0.5, 0, sp.legT, sp.thigh * 0.9, sp.legT, 0, 0, 0, 's');
      const knee = grp(thigh, 0, -sp.thigh, 0);
      m(knee, G.cap, speciesId === 'fox' || speciesId === 'rooster' ? skin : fur, 0, -sp.shin * 0.5, 0, sp.legT * 0.92, sp.shin * 0.9, sp.legT * 0.92, 0, 0, 0, 's');
      const foot = grp(knee, 0, -sp.shin, 0);
      m(foot, G.sph, skin, 0, -sp.foot[1] * 0.2, sp.foot[2] * 0.22, sp.foot[0], sp.foot[1], sp.foot[2], 0, 0, 0, 's');
      if (speciesId === 'rooster') for (const t of [-1, 0, 1]) m(foot, G.cone, skin, t * 0.07, -sp.foot[1] * 0.2, sp.foot[2] * 0.6, 0.03, 0.2, 0.03, Math.PI / 2, 0, 0, 'x');
      return { thigh, knee };
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);

    /* ---- thân ---- */
    const torso = grp(hips, 0, 0.1, 0);
    const bellyMesh = m(torso, G.sph, belly, 0, 0.2, 0.02, sp.bellyR[0], sp.bellyR[1], sp.bellyR[2], 0, 0, 0, 's');
    const chestMesh = m(torso, G.sph, fur, 0, 0.5, -0.02, sp.chest[0], sp.chest[1], sp.chest[2], 0, 0, 0, 's');
    m(torso, G.sph, belly, 0, 0.46, sp.chest[2] * 0.55, sp.chest[0] * 0.7, sp.chest[1] * 0.7, sp.chest[2] * 0.55);
    // đai / dây màu người chơi (điểm nhận diện)
    m(torso, G.torus, acc, 0, 0.12, 0, 1, 1, 1, Math.PI / 2, 0, 0).scale.set(sp.bellyR[0] * 0.98, sp.bellyR[2] * 0.98, 0.3);

    /* ---- đầu ---- */
    const neck = grp(torso, 0, sp.headY - sp.headR * 0.6, sp.headZ * 0.5);
    const head = grp(neck, 0, sp.headR * 0.6, sp.headZ);
    const hr = sp.headR;
    m(head, G.sph, fur, 0, 0, 0, hr, hr * 0.95, hr, 0, 0, 0, 's');
    // mắt
    for (const sd of [-1, 1]) {
      m(head, G.sph, white, sd * hr * 0.36, hr * 0.12, hr * 0.84, hr * 0.2, hr * 0.24, hr * 0.12);
      m(head, G.sph, dark, sd * hr * 0.37, hr * 0.12, hr * 0.94, hr * 0.1, hr * 0.13, hr * 0.06);
    }
    // băng đô màu người chơi
    const band = m(head, G.torus, acc, 0, hr * 0.52, 0, hr * 0.92, hr * 0.92, 0.5, Math.PI / 2, 0, 0);
    band.scale.set(hr * 0.9, hr * 0.9, hr * 0.5);

    /* ---- tay ---- */
    const mkArm = (side: number) => {
      const sh = grp(torso, side * sp.sw, 0.64, 0);
      m(sh, G.sph, fur, 0, 0, 0, sp.armT * 1.15, sp.armT * 1.15, sp.armT * 1.15, 0, 0, 0, 's');
      m(sh, G.cap, fur, 0, -sp.ua * 0.5, 0, sp.armT, sp.ua * 0.9, sp.armT, 0, 0, 0, 's');
      const el = grp(sh, 0, -sp.ua, 0);
      m(el, G.cap, speciesId === 'rooster' ? fur : skin, 0, -sp.fa * 0.5, 0, sp.armT * 0.95, sp.fa * 0.9, sp.armT * 0.95, 0, 0, 0, 's');
      m(el, G.torus, acc, 0, -sp.fa * 0.3, 0, 1, 1, 1, Math.PI / 2, 0, 0).scale.set(sp.armT * 0.95, sp.armT * 0.95, sp.armT * 0.45);
      const fist = grp(el, 0, -sp.fa, 0);
      if (speciesId === 'rooster') m(fist, G.sph, fur, 0, -0.06, 0, sp.fist * 0.6, sp.fist * 1.4, sp.fist * 1.1, 0, 0, 0, 's');
      else m(fist, G.sph, skin, 0, -sp.fist * 0.5, 0, sp.fist, sp.fist, sp.fist, 0, 0, 0, 's');
      return { sh, el };
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);

    /* ---- đặc trưng từng loài ---- */
    const earGroups: Group[] = [];
    const tailGroups: Group[] = [];
    const hornGroups: Group[] = [];
    const combGroups: Group[] = [];
    const ear = (side: number, x: number, y: number, z: number, geo: BufferGeometry, material: Material, sx: number, sy: number, sz: number, rz = 0) => {
      const g = grp(head, side * x, y, z);
      m(g, geo, material, 0, sy * (geo === G.cone ? 0.5 : 0), 0, sx, sy, sz, 0, 0, rz * side, 'x');
      earGroups.push(g);
      return g;
    };
    const tail = (x: number, y: number, z: number, parent: Group = hips) => {
      const g = grp(parent, x, y, z);
      tailGroups.push(g);
      return g;
    };
    switch (speciesId) {
      case 'bull': {
        // vai rộng, bướu lưng, mõm to + vòng mũi, sừng cong
        m(torso, G.sph, fur, 0, 0.78, -0.18, 0.4, 0.26, 0.3, 0, 0, 0, 's');
        m(head, G.sph, mat('#e8a8a0'), 0, -hr * 0.28, hr * 0.78, hr * 0.62, hr * 0.42, hr * 0.5);
        for (const sd of [-1, 1]) m(head, G.sph, dark, sd * hr * 0.2, -hr * 0.2, hr * 1.2, hr * 0.07, hr * 0.07, hr * 0.05, 0, 0, 0, 'x');
        m(head, G.torus, mat('#f2c94c'), 0, -hr * 0.5, hr * 1.15, hr * 0.16, hr * 0.16, 0.5, 0, 0, 0, 'x').scale.set(hr * 0.16, hr * 0.16, hr * 0.1);
        for (const sd of [-1, 1]) {
          const h = grp(head, sd * hr * 0.78, hr * 0.55, 0);
          m(h, G.cone, mat('#f5f0e0'), sd * 0.1, 0.16, 0, hr * 0.26, hr * 0.7, hr * 0.26, 0, 0, -sd * 0.95, 'x');
          m(h, G.cone, mat('#f5f0e0'), sd * 0.4, 0.46, 0, hr * 0.17, hr * 0.42, hr * 0.17, 0, 0, sd * 0.2, 'x');
          hornGroups.push(h);
        }
        ear(1, hr * 1.0, hr * 0.2, -hr * 0.1, G.sph, fur, hr * 0.28, hr * 0.14, hr * 0.12);
        ear(-1, hr * 1.0, hr * 0.2, -hr * 0.1, G.sph, fur, hr * 0.28, hr * 0.14, hr * 0.12);
        const t = tail(0, -0.05, -sp.bellyR[2] * 0.8);
        m(t, G.cyl, fur, 0, -0.2, -0.05, 0.035, 0.45, 0.035, 0.2, 0, 0, 'x');
        m(t, G.sph, dark, 0, -0.45, -0.08, 0.09, 0.14, 0.09, 0, 0, 0, 'x');
        break;
      }
      case 'bear': {
        for (const sd of [-1, 1]) ear(sd, hr * 0.72, hr * 0.78, 0, G.sph, fur, hr * 0.3, hr * 0.3, hr * 0.2);
        m(head, G.sph, belly, 0, -hr * 0.3, hr * 0.74, hr * 0.5, hr * 0.38, hr * 0.42);
        m(head, G.sph, dark, 0, -hr * 0.14, hr * 1.1, hr * 0.14, hr * 0.1, hr * 0.1);
        const t = tail(0, 0, -sp.bellyR[2] * 0.9);
        m(t, G.sph, fur, 0, 0, -0.05, 0.15, 0.15, 0.15, 0, 0, 0, 'x');
        break;
      }
      case 'fox': {
        for (const sd of [-1, 1]) {
          const g = ear(sd, hr * 0.55, hr * 0.7, -hr * 0.05, G.cone, fur, hr * 0.32, hr * 0.8, hr * 0.14);
          m(g, G.cone, dark, 0, hr * 0.5, 0, hr * 0.2, hr * 0.4, hr * 0.1, 0, 0, 0, 'x');
        }
        m(head, G.cone, belly, 0, -hr * 0.2, hr * 1.12, hr * 0.38, hr * 0.8, hr * 0.38, Math.PI / 2, 0, 0);
        m(head, G.sph, dark, 0, -hr * 0.12, hr * 1.5, hr * 0.09, hr * 0.09, hr * 0.09);
        m(head, G.sph, belly, 0, -hr * 0.3, hr * 0.7, hr * 0.7, hr * 0.38, hr * 0.5);
        const t = tail(0, 0.05, -sp.bellyR[2] * 0.9);
        const t2 = grp(t, 0, 0, -0.3);
        m(t, G.sph, fur, 0, 0.05, -0.2, 0.2, 0.2, 0.42, -0.4, 0, 0, 's');
        m(t2, G.sph, fur, 0, 0.12, -0.15, 0.22, 0.22, 0.38, -0.4, 0, 0, 'x');
        m(t2, G.sph, white, 0, 0.18, -0.5, 0.17, 0.17, 0.2, -0.4, 0, 0, 'x');
        tailGroups.push(t2);
        break;
      }
      case 'turtle': {
        // mai lớn trên lưng, đầu thò ra
        const shell = m(torso, G.sph, shellMat, 0, 0.44, -0.32, 0.62, 0.52, 0.42, 0, 0, 0, 's');
        shell.scale.set(0.66, 0.54, 0.44);
        m(torso, G.torus, mat('#26602f'), 0, 0.3, -0.3, 0.66, 0.66, 0.5, Math.PI / 2, 0, 0, 'x').scale.set(0.62, 0.42, 0.3);
        m(head, G.sph, mat('#f6efb0'), 0, -hr * 0.45, hr * 0.5, hr * 0.5, hr * 0.28, hr * 0.4);
        const t = tail(0, -0.05, -sp.bellyR[2] * 0.9);
        m(t, G.cone, fur, 0, 0, -0.1, 0.08, 0.28, 0.08, -Math.PI / 2, 0, 0, 'x');
        break;
      }
      case 'monkey': {
        for (const sd of [-1, 1]) {
          const g = ear(sd, hr * 1.0, hr * 0.05, 0, G.sph, mat('#e8c9a0'), hr * 0.32, hr * 0.32, hr * 0.14);
          m(g, G.sph, fur, 0, 0, -0.02, hr * 0.38, hr * 0.38, hr * 0.12, 0, 0, 0, 'x');
        }
        m(head, G.sph, mat('#e8c9a0'), 0, -hr * 0.1, hr * 0.62, hr * 0.78, hr * 0.62, hr * 0.5);
        m(head, G.sph, mat('#c89a6a'), 0, -hr * 0.34, hr * 0.98, hr * 0.28, hr * 0.14, hr * 0.12);
        const t = tail(0, -0.02, -sp.bellyR[2] * 0.85);
        m(t, G.cyl, fur, 0, 0, -0.25, 0.045, 0.55, 0.045, Math.PI / 2 + 0.3, 0, 0, 's');
        const t2 = grp(t, 0, 0.15, -0.5);
        m(t2, G.cyl, fur, 0, 0.12, -0.05, 0.045, 0.45, 0.045, 0.2, 0, 0, 'x');
        m(t2, G.sph, dark, 0, 0.3, -0.05, 0.07, 0.07, 0.07, 0, 0, 0, 'x');
        tailGroups.push(t2);
        break;
      }
      case 'tiger': {
        for (const sd of [-1, 1]) ear(sd, hr * 0.7, hr * 0.78, 0, G.sph, fur, hr * 0.24, hr * 0.24, hr * 0.12);
        m(head, G.sph, belly, 0, -hr * 0.3, hr * 0.72, hr * 0.54, hr * 0.36, hr * 0.42);
        m(head, G.sph, mat('#e8708a'), 0, -hr * 0.12, hr * 1.08, hr * 0.12, hr * 0.08, hr * 0.08);
        for (let i = -1; i <= 1; i++) m(head, G.box, dark, i * hr * 0.26, hr * 0.62, hr * 0.72, hr * 0.07, hr * 0.28, hr * 0.06, -0.5, 0, i * 0.2, 'x');
        for (let i = 0; i < 4; i++) m(torso, G.box, dark, (i - 1.5) * 0.2, 0.52, sp.chest[2] * 0.88, 0.07, 0.3, 0.05, 0, 0, (i - 1.5) * 0.15, 'x');
        for (const sh of [armL.sh, armR.sh]) for (let i = 0; i < 2; i++) m(sh, G.torus, dark, 0, -0.1 - i * 0.12, 0, sp.armT * 1.05, sp.armT * 1.05, 0.4, Math.PI / 2, 0, 0, 'x').scale.set(sp.armT * 1.02, sp.armT * 1.02, 0.35);
        const t = tail(0, 0, -sp.bellyR[2] * 0.9);
        const t2 = grp(t, 0, 0.12, -0.3);
        m(t, G.cyl, fur, 0, 0.05, -0.15, 0.06, 0.4, 0.06, -1.0, 0, 0, 's');
        m(t2, G.cyl, mat('#2a2a2e'), 0, 0.18, -0.1, 0.065, 0.3, 0.065, -0.9, 0, 0, 'x');
        tailGroups.push(t2);
        break;
      }
      case 'rooster': {
        // mỏ, mào, yếm, cánh (tay), đuôi lông xoè
        m(head, G.cone, mat('#ffb627'), 0, -hr * 0.1, hr * 1.15, hr * 0.26, hr * 0.5, hr * 0.26, Math.PI / 2, 0, 0);
        const comb = grp(head, 0, hr * 0.85, 0);
        for (let i = 0; i < 3; i++) m(comb, G.sph, mat('#e63946'), 0, i === 1 ? 0.05 : 0, (i - 1) * hr * 0.32, hr * 0.12, hr * (0.3 + (i === 1 ? 0.12 : 0)), hr * 0.2, 0, 0, 0, 'x');
        combGroups.push(comb);
        m(head, G.sph, mat('#e63946'), 0, -hr * 0.55, hr * 0.8, hr * 0.12, hr * 0.22, hr * 0.1, 0, 0, 0, 'x');
        const t = tail(0, 0.1, -sp.bellyR[2] * 0.9);
        const cols = ['#3a7bd5', '#2fd6a0', '#e63946', '#2fd6a0', '#3a7bd5'];
        cols.forEach((c, i) => m(t, G.cone, mat(c), (i - 2) * 0.1, 0.25, -0.1, 0.1, 0.62, 0.05, -0.7, 0, (i - 2) * 0.28, 'x'));
        break;
      }
    }
    if (isMe) m(head, G.cone, mat('#ff9f43'), 0, hr * 2.0, 0, hr * 0.22, hr * 0.36, hr * 0.22, Math.PI, 0, 0);
    // sao quay khi choáng
    const stars = grp(head, 0, hr * 1.25, 0);
    const starMeshes: Mesh[] = [];
    for (let i = 0; i < 3; i++) starMeshes.push(m(stars, G.sph, mat('#ffe14d'), 0, 0, 0, 0.07, 0.07, 0.07));
    stars.visible = false;
    if (low) for (const s of smallMeshes) s.visible = false;

    /* ---------------- animator ---------------- */
    const cur = new Float32Array(K.N);
    const base = new Float32Array(K.N);
    const act = new Float32Array(K.N);
    let actW = 0;
    let phase = Math.random() * 6;
    let pvx = 0;
    let pvz = 0;
    let pvy = 0;
    let lie = 0;
    let lieV = 0;
    // lò xo: [giá trị, vận tốc]
    const sx = { kx: 0, kxv: 0, kz: 0, kzv: 0, hd: 0, hdv: 0, fl: 0, flv: 0, bl: 0, blv: 0, sqz: 0, sqzv: 0, tail: 0, tail2: 0, ear: 0, earv: 0 };
    let punchT = -1;
    let punchIdx = 0;
    let skillKey = '';
    let skillT = -1;
    let skillDur = 0.5;
    let spin = 0;
    let wasGround = true;
    let yaw = 0;
    const ph = Math.random() * 6;

    const spr = (a: number, v: number, dt: number, kk: number, cc: number): [number, number] => {
      v += (-kk * a - cc * v) * dt;
      return [a + v * dt, v];
    };

    /** pose đấm: ext = độ vươn (âm = kéo về chuẩn bị) */
    const punchPose = (idx: number, u: number) => {
      const ext = u < 0.22 ? -(u / 0.22) * 0.4 : u < 0.45 ? -0.4 + 1.4 * smooth((u - 0.22) / 0.23) : 1 - smooth((u - 0.45) / 0.55);
      if (idx === 0 || idx === 1) {
        const right = idx === 0;
        const sx_ = right ? K.aRx : K.aLx;
        const sz_ = right ? K.aRz : K.aLz;
        const se_ = right ? K.aRe : K.aLe;
        if (idx === 0) {
          // đấm thẳng
          act[sx_] = -0.55 - 1.05 * ext;
          act[se_] = -1.25 + 1.25 * Math.max(ext, 0) - 0.6 * Math.min(ext, 0);
          act[sz_] = 0.1;
          act[K.tTw] = (right ? 1 : -1) * -0.55 * ext;
          act[K.hipTw] = (right ? 1 : -1) * -0.3 * ext;
        } else {
          // móc ngang
          act[sx_] = -0.9 - 0.7 * ext;
          act[sz_] = 0.35 + 0.95 * ext;
          act[se_] = -1.7 + 0.8 * Math.max(ext, 0);
          act[K.tTw] = (right ? 1 : -1) * -0.7 * ext;
          act[K.hipTw] = (right ? 1 : -1) * -0.35 * ext;
        }
        act[K.lunge] = 0.26 * ext;
        act[K.leanX] = 0.1 + 0.28 * ext;
        act[K.hZ] = (right ? 1 : -1) * 0.1 * ext;
        act[K.hX] = 0.1 * ext;
        // bước chân theo đòn
        act[K.lLx] = right ? 0.3 * Math.max(ext, 0) : -0.7 * Math.max(ext, 0);
        act[K.lRx] = right ? -0.7 * Math.max(ext, 0) : 0.3 * Math.max(ext, 0);
      } else {
        // đòn kết: hai tay giơ cao rồi bổ xuống, bước tới, xoay cả người
        const up = u < 0.3 ? smooth(u / 0.3) : 1 - smooth((u - 0.3) / 0.1);
        const slam = u < 0.3 ? 0 : smooth((u - 0.3) / 0.12) * (1 - smooth((u - 0.5) / 0.5));
        const arm = -2.7 * up - 0.6 * slam;
        act[K.aLx] = arm;
        act[K.aRx] = arm;
        act[K.aLe] = -0.3 * up - 0.2;
        act[K.aRe] = -0.3 * up - 0.2;
        act[K.aLz] = 0.2;
        act[K.aRz] = 0.2;
        act[K.tPx] = -0.3 * up + 0.8 * slam;
        act[K.leanX] = -0.15 * up + 0.55 * slam;
        act[K.lunge] = 0.5 * slam - 0.1 * up;
        act[K.bob] = -0.1 * slam;
        act[K.lLx] = -0.8 * slam;
        act[K.lRx] = 0.4 * slam;
        act[K.lLk] = 0.3;
        act[K.hX] = 0.4 * slam;
        act[K.tTw] = 0.3 * slam;
        act[K.sq] = -0.12 * slam;
      }
      return u < 0.12 ? smooth(u / 0.12) : u > 0.82 ? 1 - smooth((u - 0.82) / 0.18) : 1;
    };

    const skillPose = (key: string, u: number, t: number) => {
      const set = (i: number, v: number) => {
        act[i] = v;
      };
      let w = u < 0.1 ? smooth(u / 0.1) : u > 0.85 ? 1 - smooth((u - 0.85) / 0.15) : 1;
      switch (key) {
        case 'bull1':
          set(K.leanX, 0.75);
          set(K.hX, 0.55);
          set(K.aLx, 0.9); set(K.aRx, 0.9); set(K.aLe, -0.3); set(K.aRe, -0.3); set(K.aLz, 0.3); set(K.aRz, 0.3);
          set(K.tPx, 0.3);
          break;
        case 'bull2': {
          const wind = u < 0.62;
          set(K.hX, wind ? -0.55 : 0.35);
          set(K.aLz, wind ? 1.4 : 0.2); set(K.aRz, wind ? 1.4 : 0.2);
          set(K.aLx, -0.4); set(K.aRx, -0.4); set(K.aLe, -0.4); set(K.aRe, -0.4);
          set(K.tPx, wind ? -0.3 : 0.4);
          set(K.leanX, wind ? -0.2 : 0.3);
          set(K.hY, Math.sin(t * 60) * (wind ? 0.12 : 0.02));
          set(K.sq, wind ? 0.08 : -0.1);
          break;
        }
        case 'bear1': {
          const up = u < 0.62 ? smooth(u / 0.55) : 0;
          const slam = u < 0.62 ? 0 : smooth((u - 0.62) / 0.1) * (1 - smooth((u - 0.8) / 0.2));
          set(K.aLx, -3.0 * up - 0.4 * slam); set(K.aRx, -3.0 * up - 0.4 * slam);
          set(K.aLe, -0.2); set(K.aRe, -0.2); set(K.aLz, 0.25); set(K.aRz, 0.25);
          set(K.leanX, -0.3 * up + 0.5 * slam);
          set(K.tPx, -0.2 * up + 0.7 * slam);
          set(K.bob, -0.08 * up - 0.14 * slam);
          set(K.hX, 0.3 * slam);
          set(K.sq, -0.1 * slam + 0.06 * up);
          break;
        }
        case 'bear2':
          set(K.aLx, -1.1); set(K.aRx, -1.1); set(K.aLz, -0.45); set(K.aRz, -0.45); set(K.aLe, -1.9); set(K.aRe, -1.9);
          set(K.bob, -0.1); set(K.sq, -0.08); set(K.hX, 0.3);
          break;
        case 'fox1': {
          const s = smooth(u * 1.4);
          set(K.aRx, -2.4 + 2.2 * s); set(K.aRz, 0.4); set(K.aRe, -0.2);
          set(K.aLx, 0.8); set(K.aLe, -0.5);
          set(K.tTw, 0.9 - 1.8 * s);
          set(K.leanX, 0.45);
          set(K.lunge, 0.3 * s);
          break;
        }
        case 'fox2':
          set(K.aLx, 1.0); set(K.aRx, 1.0); set(K.aLe, -0.4); set(K.aRe, -0.4);
          set(K.leanX, 0.5); set(K.hX, 0.3);
          break;
        case 'turtle1':
          set(K.aLx, -1.3); set(K.aRx, -1.3); set(K.aLe, -1.7); set(K.aRe, -1.7); set(K.aLz, 0.05); set(K.aRz, 0.05);
          set(K.bob, -0.12); set(K.sq, -0.1); set(K.hX, 0.4);
          break;
        case 'turtle2':
          set(K.aLz, 1.5); set(K.aRz, 1.5); set(K.aLx, -0.2); set(K.aRx, -0.2); set(K.aLe, -0.15); set(K.aRe, -0.15);
          set(K.leanX, 0.1);
          break;
        case 'monkey1': {
          const up = u < 0.5;
          set(K.aLx, up ? -2.4 : 0.6); set(K.aRx, up ? -2.4 : 0.6); set(K.aLe, -0.3); set(K.aRe, -0.3);
          set(K.lLx, up ? -1.1 : -1.5); set(K.lLk, up ? 1.3 : 0.05);
          set(K.lRx, up ? -0.5 : 0.4); set(K.lRk, up ? 1.0 : 0.9);
          set(K.leanX, up ? -0.1 : 0.55);
          set(K.hX, up ? 0 : 0.3);
          break;
        }
        case 'monkey2': {
          const s = smooth(u * 1.6);
          set(K.aRx, -2.9 + 1.9 * s); set(K.aRe, -0.4); set(K.aRz, 0.2);
          set(K.aLx, -0.8); set(K.aLe, -1.0);
          set(K.tTw, -0.5 + 1.0 * s);
          set(K.leanX, 0.1 + 0.3 * s);
          break;
        }
        case 'tiger1':
          set(K.aLx, -1.5); set(K.aRx, -1.5); set(K.aLz, 0.35); set(K.aRz, 0.35); set(K.aLe, -0.1); set(K.aRe, -0.1);
          set(K.leanX, 0.85); set(K.hX, 0.3); set(K.lLx, 0.9); set(K.lRx, 0.9); set(K.lLk, 0.2); set(K.lRk, 0.2);
          break;
        case 'tiger2':
          set(K.hX, -0.6); set(K.aLz, 1.0); set(K.aRz, 1.0); set(K.aLx, -0.5); set(K.aRx, -0.5); set(K.aLe, -0.6); set(K.aRe, -0.6);
          set(K.tPx, -0.3); set(K.leanX, -0.2); set(K.sq, 0.06); set(K.hY, Math.sin(t * 50) * 0.1);
          break;
        case 'rooster1':
          set(K.hX, 0.4 + 0.5 * Math.sin(u * Math.PI * 9));
          set(K.leanX, 0.3); set(K.aLz, 1.0); set(K.aRz, 1.0); set(K.aLx, 0.3); set(K.aRx, 0.3); set(K.aLe, -0.4); set(K.aRe, -0.4);
          break;
        case 'rooster2': {
          const fl = Math.sin(t * 32) * 0.7;
          set(K.aLz, 1.1 + fl); set(K.aRz, 1.1 + fl);
          set(K.aLx, -0.9); set(K.aRx, -0.9); set(K.aLe, -0.2); set(K.aRe, -0.2);
          set(K.leanX, -0.15); set(K.hX, -0.2);
          break;
        }
        default:
          set(K.aLz, 1.0); set(K.aRz, 1.0);
      }
      w = Math.max(0, Math.min(1, w));
      return w;
    };

    const api: Fighter = {
      root,
      body,
      update: () => {},
      setYaw(a: number) {
        yaw = a;
        root.rotation.y = a + spin;
      },
      punch(idx: number) {
        punchT = 0;
        punchIdx = idx % 3;
        skillT = -1;
      },
      skill(key: string, durSec: number) {
        skillKey = key;
        skillT = 0;
        skillDur = Math.max(0.3, durSec);
        punchT = -1;
      },
      hit(dx: number, dz: number, force: number) {
        // đổi sang toạ độ cục bộ của thân
        const fa = Math.sin(yaw);
        const fb = Math.cos(yaw);
        const f = dx * fa + dz * fb;
        const s = dx * fb - dz * fa;
        const m2 = Math.min(1.6, 0.5 + force * 0.08) / Math.sqrt(sp.weight);
        sx.kxv += f * 9 * m2;
        sx.kzv += -s * 9 * m2;
        sx.hdv += -f * 14 * m2;
        sx.flv += 12 * m2;
        sx.sqzv += -2.4 * m2;
        sx.earv += 14 * m2;
      },
      setShadows(on: boolean) {
        for (const s of shadowMeshes) s.castShadow = on;
      },
      dispose() {},
    };

    const update = (dt: number, s: FighterState) => {
      if (dt < 1e-4) return;
      const t = s.time;
      const fa = Math.sin(s.yaw);
      const fb = Math.cos(s.yaw);
      const fv = s.vx * fa + s.vz * fb;
      const sv = s.vx * fb - s.vz * fa;
      const spd = Math.hypot(s.vx, s.vz);
      const run = clamp(spd / 4.6, 0, 1.3);
      const accF = ((s.vx - pvx) * fa + (s.vz - pvz) * fb) / dt;
      const accS = ((s.vx - pvx) * fb - (s.vz - pvz) * fa) / dt;
      pvx = s.vx;
      pvz = s.vz;
      const rise = s.vy;
      pvy = rise;

      // lò xo phụ
      [sx.kx, sx.kxv] = spr(sx.kx, sx.kxv, dt, 110, 10);
      [sx.kz, sx.kzv] = spr(sx.kz, sx.kzv, dt, 110, 10);
      [sx.hd, sx.hdv] = spr(sx.hd, sx.hdv, dt, 150, 11);
      [sx.fl, sx.flv] = spr(sx.fl, sx.flv, dt, 90, 6);
      [sx.sqz, sx.sqzv] = spr(sx.sqz, sx.sqzv, dt, 170, 12);
      [sx.ear, sx.earv] = spr(sx.ear, sx.earv, dt, 80, 4);
      sx.blv += (clamp(-s.vy * 0.2, -3, 3) + clamp(-accF * 0.01, -1, 1)) * dt * 20;
      [sx.bl, sx.blv] = spr(sx.bl, sx.blv, dt, 110, 7);
      // nhảy / đáp đất: kéo giãn và bẹp
      if (!s.grounded && wasGround && s.vy > 0.5) sx.sqzv += 3.4 / Math.sqrt(sp.weight);
      if (s.grounded && !wasGround) sx.sqzv += -4.4 * (0.7 + 0.3 * sp.weight);
      wasGround = s.grounded;

      // lớp nền: đứng thủ thế / chạy / trên không / ngã
      phase += dt * (6 + 7 * run) * sp.cad;
      const sinP = Math.sin(phase);
      const cosP = Math.cos(phase);
      const breathe = Math.sin(t * 2.2 + ph);
      const guardX = -0.55;
      const guardE = -1.25;
      base.fill(0);
      base[K.bob] = -0.04 + breathe * 0.012 + Math.abs(cosP) * 0.07 * run * sp.stride;
      base[K.leanX] = clamp(fv * 0.035 + accF * 0.012, -0.5, 0.55) * (0.8 + 0.3 * (1.1 - sp.weight * 0.4));
      base[K.leanZ] = -clamp(sv * 0.035 + accS * 0.012, -0.4, 0.4);
      base[K.hipTw] = sinP * 0.16 * run;
      base[K.tTw] = -sinP * 0.22 * run;
      base[K.tPx] = 0.06 * run;
      // chân
      base[K.lLx] = 0.15 * (1 - run) + sinP * 0.95 * sp.stride * run;
      base[K.lRx] = -0.1 * (1 - run) - sinP * 0.95 * sp.stride * run;
      base[K.lLk] = 0.3 * (1 - run) + (Math.max(0, -cosP) * 1.2 + 0.15) * run;
      base[K.lRk] = 0.2 * (1 - run) + (Math.max(0, cosP) * 1.2 + 0.15) * run;
      // tay: thủ thế → vung đối nhau khi chạy
      base[K.aLx] = lerp(guardX + breathe * 0.04, -0.35 - sinP * 0.85, run);
      base[K.aRx] = lerp(guardX - breathe * 0.04, -0.35 + sinP * 0.85, run);
      base[K.aLe] = lerp(guardE, -1.0, run);
      base[K.aRe] = lerp(guardE, -1.0, run);
      base[K.aLz] = 0.18;
      base[K.aRz] = 0.18;
      base[K.hX] = -0.04 * run;
      base[K.sq] = breathe * 0.012;
      if (!s.grounded) {
        base[K.lLx] = -0.7; base[K.lRx] = 0.3; base[K.lLk] = 1.0; base[K.lRk] = 0.8;
        base[K.aLx] = -2.0; base[K.aRx] = -2.0; base[K.aLz] = 0.5; base[K.aRz] = 0.5; base[K.aLe] = -0.4; base[K.aRe] = -0.4;
        base[K.leanX] = clamp(fv * 0.03, -0.3, 0.4);
      }
      if (s.cheer) {
        base[K.aLx] = -2.8 + Math.sin(t * 9) * 0.35;
        base[K.aRx] = -2.8 - Math.sin(t * 9) * 0.35;
        base[K.aLz] = 0.4; base[K.aRz] = 0.4; base[K.aLe] = -0.2; base[K.aRe] = -0.2;
        base[K.bob] = Math.abs(Math.sin(t * 7)) * 0.18;
        base[K.hipTw] = Math.sin(t * 7) * 0.2;
      }
      if (s.stunned && !s.down) {
        // loạng choạng: lắc người, đầu choáng, tay thả lỏng
        base[K.leanZ] += Math.sin(t * 7 + ph) * (0.1 + 0.18 * s.wob);
        base[K.leanX] += Math.sin(t * 5.3 + ph) * 0.08;
        base[K.hY] = Math.sin(t * 9) * 0.35;
        base[K.hX] = 0.25;
        base[K.aLx] = -0.2 + Math.sin(t * 6) * 0.3; base[K.aRx] = -0.2 - Math.sin(t * 6) * 0.3;
        base[K.aLe] = -0.5; base[K.aRe] = -0.5; base[K.aLz] = 0.7; base[K.aRz] = 0.7;
      }
      // ngã sõng soài / KO
      const wantLie = s.down || s.out ? 1 : 0;
      [lie, lieV] = spr(lie - wantLie, lieV, dt, 90, wantLie ? 11 : 9);
      lie += wantLie;
      if (lie > 0.02) {
        const k2 = clamp(lie, 0, 1);
        base[K.aLx] = lerp(base[K.aLx], -0.15, k2); base[K.aRx] = lerp(base[K.aRx], -0.15, k2);
        base[K.aLz] = lerp(base[K.aLz], 1.4, k2); base[K.aRz] = lerp(base[K.aRz], 1.4, k2);
        base[K.aLe] = lerp(base[K.aLe], -0.1, k2); base[K.aRe] = lerp(base[K.aRe], -0.1, k2);
        base[K.lLx] = lerp(base[K.lLx], -0.2, k2); base[K.lRx] = lerp(base[K.lRx], 0.25, k2);
        base[K.lLk] = lerp(base[K.lLk], 0.1, k2); base[K.lRk] = lerp(base[K.lRk], 0.1, k2);
        base[K.hX] = lerp(base[K.hX], -0.3, k2);
      }

      // lớp hành động (nửa trên): đấm / skill
      for (let i = 0; i < K.N; i++) act[i] = NaN;
      let wantW = 0;
      if (!s.down && !s.out) {
        if (punchT >= 0) {
          punchT += dt;
          const u = punchT / 0.34;
          if (u >= 1) punchT = -1;
          else wantW = punchPose(punchIdx, u);
        } else if (skillT >= 0) {
          skillT += dt;
          const u = skillT / skillDur;
          if (u >= 1) skillT = -1;
          else wantW = skillPose(skillKey, u, t);
        }
      } else {
        punchT = -1;
        skillT = -1;
      }
      actW += (wantW - actW) * (1 - Math.exp(-dt * (wantW > actW ? 38 : 16)));
      // xoáy rùa: quay cả người
      if (skillT >= 0 && skillKey === 'turtle2') spin += dt * 15;
      else if (spin !== 0) {
        spin = spin % (Math.PI * 2);
        spin *= Math.exp(-dt * 10);
        if (Math.abs(spin) < 0.01) spin = 0;
      }
      const rate = 1 - Math.exp(-dt * (actW > 0.2 ? 34 : 16));
      for (let i = 0; i < K.N; i++) {
        let target = base[i];
        const a = act[i];
        if (a === a) target = lerp(target, a, actW); // a === a: không phải NaN
        cur[i] += (target - cur[i]) * rate;
      }

      // áp lên khớp
      const sq = clamp(cur[K.sq] + sx.sqz, -0.4, 0.4);
      body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      body.rotation.x = cur[K.leanX] + sx.kx - lie * 1.5;
      body.rotation.z = cur[K.leanZ] + sx.kz;
      body.position.z = cur[K.lunge] - lie * 0.2;
      body.position.y = lie * 0.42;
      hips.position.y = hipsY + cur[K.bob];
      hips.rotation.y = cur[K.hipTw];
      torso.rotation.set(cur[K.tPx] + sx.hd * 0.3, cur[K.tTw], 0);
      head.rotation.set(cur[K.hX] + sx.hd, cur[K.hY], cur[K.hZ]);
      armL.sh.rotation.set(cur[K.aLx] + sx.fl * 0.3, 0, -cur[K.aLz] - sx.fl * 0.4);
      armR.sh.rotation.set(cur[K.aRx] + sx.fl * 0.3, 0, cur[K.aRz] + sx.fl * 0.4);
      armL.el.rotation.x = cur[K.aLe];
      armR.el.rotation.x = cur[K.aRe];
      legL.thigh.rotation.x = cur[K.lLx];
      legR.thigh.rotation.x = cur[K.lRx];
      legL.knee.rotation.x = cur[K.lLk];
      legR.knee.rotation.x = cur[K.lRk];
      root.rotation.y = yaw + spin;
      // bụng / ngực nảy theo gia tốc
      const bj = 1 + sx.bl * 0.05;
      bellyMesh.scale.set(sp.bellyR[0] * (2 - bj), sp.bellyR[1] * bj, sp.bellyR[2] * (2 - bj));
      chestMesh.scale.y = sp.chest[1] * (1 + breathe * 0.015);
      // tai / đuôi / mào / sừng: lò xo theo gia tốc + vẫy theo nhịp chạy
      const ea = clamp(-fv * 0.03 - accF * 0.004, -0.5, 0.5) + sx.ear * 0.04;
      for (const g of earGroups) g.rotation.x = ea;
      for (let i = 0; i < tailGroups.length; i++) {
        const g = tailGroups[i];
        g.rotation.x = clamp(-fv * 0.03 - accF * 0.006, -0.6, 0.6) * (1 + i * 0.5) + Math.sin(t * (5 + 7 * run) - i * 0.9 + ph) * (0.1 + 0.2 * run) + sx.ear * 0.03;
        g.rotation.y = Math.sin(t * 3.4 + ph - i) * 0.25 * (1 - run * 0.4) + clamp(sv * 0.04, -0.4, 0.4);
      }
      for (const g of combGroups) g.rotation.x = clamp(-fv * 0.05, -0.4, 0.4) + Math.sin(t * 12 + ph) * 0.06 * run;
      for (const g of hornGroups) g.rotation.x = Math.max(-0.2, Math.min(0.2, sx.hd * 0.4));
      // sao choáng
      stars.visible = s.stunned && !s.out;
      if (stars.visible) {
        for (let i = 0; i < 3; i++) {
          const a = t * 6 + (i * Math.PI * 2) / 3;
          starMeshes[i].position.set(Math.cos(a) * hr * 0.9, Math.sin(t * 4 + i) * 0.04, Math.sin(a) * hr * 0.9);
        }
      }
      void pvy;
    };
    api.update = update;
    return api;
  };

  return {
    create,
    dispose() {
      for (const o of owned) o.dispose();
    },
  };
}
