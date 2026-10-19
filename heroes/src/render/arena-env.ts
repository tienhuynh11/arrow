// Sảnh đá của đấu trường (thủ tục, three.js): sàn lát đá, tường cuối có cổng vòm + bậc thang, hai tấm cờ đỏ viền vàng,
// cột đá, đài lửa nhấp nháy, tượng canh hai bên, đồi/cây xa nhìn qua cổng vòm. Tất cả hình khối/vật liệu/texture dựng MỘT lần,
// không có shadow map, không có đèn điểm (ánh sáng lửa chỉ là sprite cộng sáng) — rẻ cho điện thoại yếu.
// Chủ đề theo chương: 1 Đền Rừng (đá + cờ đỏ), 2 Làng Ven Sông (gỗ + cờ xanh + nước), 3 Mỏ Đá (đá tối + đuốc cam).
import * as THREE from 'three';
import { fxTex } from './fx-pool';

export type EnvLevel = 'high' | 'medium' | 'low';
export type ThemeId = 1 | 2 | 3;

export interface ArenaEnv {
  /** nhấp nháy lửa, cờ đung đưa, nước chảy */
  update(dt: number, t: number): void;
  dispose(): void;
}

/** toạ độ z của mặt tường cuối (đơn vị thế giới) — cảnh dùng để đặt camera */
export const WALL_Z = -4.6;

interface Pal {
  wood: boolean;
  water: boolean;
  floorA: string;
  floorB: string;
  grout: string;
  crack: string;
  wall: string;
  wallLine: string;
  stone: number;
  dark: number;
  trim: number;
  cloth: string;
  clothDark: string;
  flame: number;
  glow: number;
  bg: number;
  skyTop: string;
  skyBot: string;
  hill1: string;
  hill2: string;
  tree: string;
}

const PALS: Record<ThemeId, Pal> = {
  1: {
    wood: false, water: false, floorA: '#9a917e', floorB: '#867d6b', grout: '#4f493e', crack: '#3d382f',
    wall: '#8c8271', wallLine: '#4a4439', stone: 0xa59a86, dark: 0x3b362f, trim: 0xd9a93a,
    cloth: '#b3261e', clothDark: '#7d1712', flame: 0xffa032, glow: 0xff9a3a, bg: 0x2a2420,
    skyTop: '#7fc8ff', skyBot: '#e6f6ff', hill1: '#6aa85c', hill2: '#437f48', tree: '#2e6a3a',
  },
  2: {
    wood: true, water: true, floorA: '#9a7650', floorB: '#85643f', grout: '#4a3320', crack: '#3a2615',
    wall: '#7b5b3b', wallLine: '#3f2c1a', stone: 0x9b7f5a, dark: 0x33281d, trim: 0xe0b552,
    cloth: '#2c68c8', clothDark: '#183f80', flame: 0xffb04a, glow: 0xffb050, bg: 0x1d2330,
    skyTop: '#6ec0ff', skyBot: '#f4ecd0', hill1: '#79b56a', hill2: '#4c8c58', tree: '#2f6b44',
  },
  3: {
    wood: false, water: false, floorA: '#524e59', floorB: '#443f4b', grout: '#25222b', crack: '#1a1820',
    wall: '#4d4640', wallLine: '#201b18', stone: 0x6b645d, dark: 0x1f1b18, trim: 0xc58a2e,
    cloth: '#9a3b16', clothDark: '#5e220c', flame: 0xff7a1c, glow: 0xff6a18, bg: 0x120f0d,
    skyTop: '#2a1a12', skyBot: '#b4561c', hill1: '#4a3a30', hill2: '#2a211c', tree: '#18120f',
  },
};

/** PRNG nhỏ có hạt giống: texture giống hệt nhau mỗi lần dựng */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 2;
  return t;
}

function floorTex(p: Pal): THREE.CanvasTexture {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(11);
    if (p.wood) {
      // ván gỗ ngang
      const n = 4;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? p.floorA : p.floorB;
        g.fillRect(0, (i * h) / n, w, h / n);
        for (let k = 0; k < 26; k++) {
          g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
          g.fillRect(r() * w, (i * h) / n + 2 + r() * (h / n - 4), 20 + r() * 70, 1.2);
        }
        g.fillStyle = p.grout;
        g.fillRect(0, (i * h) / n, w, 3);
        g.fillRect(((i * 97) % w) | 0, (i * h) / n, 3, h / n);
      }
      return;
    }
    // ô đá 2x2 xen kẽ + vữa + vết nứt
    const cw = w / 2;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        g.fillStyle = (x + y) % 2 ? p.floorA : p.floorB;
        g.fillRect(x * cw, y * cw, cw, cw);
        for (let k = 0; k < 70; k++) {
          g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
          g.fillRect(x * cw + r() * cw, y * cw + r() * cw, 1 + r() * 3, 1 + r() * 3);
        }
      }
    }
    g.strokeStyle = p.grout;
    g.lineWidth = 4;
    g.strokeRect(0, 0, w, h);
    g.beginPath();
    g.moveTo(cw, 0);
    g.lineTo(cw, h);
    g.moveTo(0, cw);
    g.lineTo(w, cw);
    g.stroke();
    g.strokeStyle = p.crack;
    g.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) {
      let x = r() * w;
      let y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += (r() - 0.5) * 36;
        y += (r() - 0.5) * 36;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

function wallTex(p: Pal): THREE.CanvasTexture {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(23);
    g.fillStyle = p.wall;
    g.fillRect(0, 0, w, h);
    if (p.wood) {
      // cột gỗ đứng
      for (let i = 0; i < 4; i++) {
        g.fillStyle = `rgba(0,0,0,${0.06 + (i % 2) * 0.06})`;
        g.fillRect((i * w) / 4, 0, w / 4, h);
        g.fillStyle = p.wallLine;
        g.fillRect((i * w) / 4, 0, 3, h);
        for (let k = 0; k < 8; k++) g.fillRect((i * w) / 4 + 6 + r() * 50, r() * h, 1.2, 14 + r() * 40);
      }
      return;
    }
    const rows = 4;
    const bh = h / rows;
    g.strokeStyle = p.wallLine;
    g.lineWidth = 3;
    for (let y = 0; y < rows; y++) {
      const off = y % 2 ? w / 4 : 0;
      for (let x = -1; x < 3; x++) {
        const bx = x * (w / 2) + off;
        g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.07})`;
        g.fillRect(bx, y * bh, w / 2, bh);
        g.strokeRect(bx, y * bh, w / 2, bh);
      }
    }
  });
}

function clothTex(p: Pal, trim: string): THREE.CanvasTexture {
  return canvasTex(128, 384, (g, w, h) => {
    g.fillStyle = p.cloth;
    g.fillRect(0, 0, w, h);
    // sọc vải
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.fillRect(x, 0, 3, h);
    }
    g.fillStyle = p.clothDark;
    g.fillRect(0, 0, w, 14);
    g.strokeStyle = trim;
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 30);
    // huy hiệu: vòng + thoi vàng
    g.fillStyle = trim;
    g.beginPath();
    g.arc(w / 2, h * 0.42, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = p.clothDark;
    g.beginPath();
    g.arc(w / 2, h * 0.42, 24, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = trim;
    g.beginPath();
    g.moveTo(w / 2, h * 0.42 - 18);
    g.lineTo(w / 2 + 12, h * 0.42);
    g.lineTo(w / 2, h * 0.42 + 18);
    g.lineTo(w / 2 - 12, h * 0.42);
    g.closePath();
    g.fill();
    // mép dưới răng cưa
    g.fillStyle = p.clothDark;
    for (let x = 0; x < w; x += 32) {
      g.beginPath();
      g.moveTo(x, h - 24);
      g.lineTo(x + 32, h - 24);
      g.lineTo(x + 16, h);
      g.closePath();
      g.fill();
    }
  }, false);
}

/** phong cảnh xa nhìn qua cổng vòm: trời + hai lớp đồi + cây (chương 3: hang lửa) */
function skyTex(p: Pal, cheap: boolean): THREE.CanvasTexture {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(37);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, p.skyTop);
    gr.addColorStop(0.7, p.skyBot);
    gr.addColorStop(1, p.skyBot);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    if (!cheap) {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        const cx = r() * w;
        const cy = 40 + r() * 120;
        g.beginPath();
        g.ellipse(cx, cy, 50 + r() * 40, 14 + r() * 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    const hill = (base: number, amp: number, col: string, ph: number) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, base - amp * (0.55 * Math.sin(x * 0.011 + ph) + 0.45 * Math.sin(x * 0.027 + ph * 2)));
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };
    hill(h * 0.66, 46, p.hill1, 1);
    hill(h * 0.78, 40, p.hill2, 3.2);
    // cây tam giác trên đồi gần
    g.fillStyle = p.tree;
    const n = cheap ? 10 : 22;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w + r() * 16;
      const y = h * 0.8 + r() * 30;
      const s = 18 + r() * 22;
      g.beginPath();
      g.moveTo(x, y - s * 1.6);
      g.lineTo(x + s * 0.55, y);
      g.lineTo(x - s * 0.55, y);
      g.closePath();
      g.fill();
    }
  }, false);
}

function waterTex(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g, w, h) => {
    const r = rng(5);
    g.fillStyle = '#3d86d6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const y = r() * h;
      const x = r() * w;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 14, y - 5, x + 30, y);
      g.stroke();
    }
  });
}

export function buildArena(scene: THREE.Scene, chapter: number, level: EnvLevel): ArenaEnv {
  const id = (chapter >= 3 ? 3 : chapter === 2 ? 2 : 1) as ThemeId;
  const p = PALS[id];
  const low = level === 'low';
  const hi = level === 'high';
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };
  const grp = new THREE.Group();
  scene.add(grp);
  scene.background = new THREE.Color(p.bg);
  const lam = (o: THREE.MeshLambertMaterialParameters) => own(new THREE.MeshLambertMaterial(o));
  const box = (w: number, h: number, d: number) => own(new THREE.BoxGeometry(w, h, d));

  /* ---- sàn ---- */
  const ft = own(floorTex(p));
  ft.repeat.set(60 / 3.2, 46 / 3.2);
  const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(60, 46).rotateX(-Math.PI / 2)), lam({ map: ft }));
  floor.position.set(0, 0, 8);
  grp.add(floor);

  /* ---- tường cuối có cổng vòm (một khối extrude có lỗ) ---- */
  const wt = own(wallTex(p));
  wt.repeat.set(1 / 3.2, 1 / 3.2);
  const R = 2.4;
  const AY = 3.3;
  const sh = new THREE.Shape();
  sh.moveTo(-24, 0);
  sh.lineTo(24, 0);
  sh.lineTo(24, 13);
  sh.lineTo(-24, 13);
  sh.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-R, 0);
  hole.lineTo(R, 0);
  hole.lineTo(R, AY);
  hole.absarc(0, AY, R, 0, Math.PI, false);
  hole.lineTo(-R, 0);
  sh.holes.push(hole);
  const wallMat = lam({ map: wt });
  const wall = new THREE.Mesh(own(new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: false, curveSegments: low ? 8 : 16 })), wallMat);
  wall.position.set(0, 0, WALL_Z - 1.2);
  grp.add(wall);

  // phong cảnh xa sau cổng
  const sky = new THREE.Mesh(own(new THREE.PlaneGeometry(26, 15)), own(new THREE.MeshBasicMaterial({ map: own(skyTex(p, low)) })));
  sky.position.set(0, 5.2, WALL_Z - 6);
  grp.add(sky);

  // viền vòm vàng + hai cột đá hai bên cổng
  const trimMat = lam({ color: p.trim });
  const stoneMat = lam({ color: p.stone });
  const darkMat = lam({ color: p.dark });
  const arc = new THREE.Mesh(own(new THREE.TorusGeometry(R + 0.16, 0.2, 6, low ? 16 : 28, Math.PI)), trimMat);
  arc.position.set(0, AY, WALL_Z + 0.1);
  grp.add(arc);
  const colGeo = own(new THREE.CylinderGeometry(0.36, 0.42, AY + 0.4, low ? 8 : 14));
  const capGeo = box(1.0, 0.3, 1.0);
  const baseGeo = box(1.1, 0.3, 1.1);
  for (const s of [-1, 1]) {
    const x = s * (R + 0.75);
    const c = new THREE.Mesh(colGeo, stoneMat);
    c.position.set(x, (AY + 0.4) / 2, WALL_Z + 0.5);
    const cap = new THREE.Mesh(capGeo, trimMat);
    cap.position.set(x, AY + 0.55, WALL_Z + 0.5);
    const base = new THREE.Mesh(baseGeo, stoneMat);
    base.position.set(x, 0.15, WALL_Z + 0.5);
    grp.add(c, cap, base);
  }

  // bậc thang dẫn lên cổng (thấp dần ra phía camera)
  const stepGeo = box(R * 2 + 1.4, 1, 0.75);
  for (let i = 0; i < 3; i++) {
    const h = 0.2 * (3 - i);
    const m = new THREE.Mesh(stepGeo, i % 2 ? stoneMat : lam({ color: new THREE.Color(p.stone).multiplyScalar(0.88).getHex() }));
    m.scale.y = h;
    m.position.set(0, h / 2, WALL_Z + 0.5 + 0.75 * (i + 1) - 0.1 * i);
    grp.add(m);
  }

  /* ---- hai tấm cờ treo ---- */
  const cloth = own(clothTex(p, '#' + p.trim.toString(16).padStart(6, '0')));
  const clothMat = lam({ map: cloth, side: THREE.DoubleSide });
  const clothGeo = own(new THREE.PlaneGeometry(1.8, 4.6, 1, low ? 1 : 4));
  const rodGeo = box(2.3, 0.14, 0.14);
  const sway: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pv = new THREE.Group();
    pv.position.set(s * 4.9, 6.9, WALL_Z + 0.12);
    const rod = new THREE.Mesh(rodGeo, trimMat);
    const cl = new THREE.Mesh(clothGeo, clothMat);
    cl.position.set(0, -2.4, 0.02);
    pv.add(rod, cl);
    grp.add(pv);
    sway.push(pv);
  }

  /* ---- đài lửa (cột đá + chậu + ngọn lửa + quầng sáng cộng) ---- */
  const potGeo = own(new THREE.CylinderGeometry(0.3, 0.42, 1.3, 10));
  const bowlGeo = own(new THREE.CylinderGeometry(0.62, 0.34, 0.4, 12));
  const flameGeo = own(new THREE.ConeGeometry(0.3, 0.95, 8));
  const flameMat = own(new THREE.MeshBasicMaterial({ color: p.flame }));
  const flameMat2 = own(new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
  const flames: { m: THREE.Mesh; core: THREE.Mesh; glow: THREE.Sprite; ph: number }[] = [];
  const glowTex = fxTex('glow');
  const brazier = (x: number, z: number, big: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pot = new THREE.Mesh(potGeo, stoneMat);
    pot.position.y = 0.65;
    const bowl = new THREE.Mesh(bowlGeo, darkMat);
    bowl.position.y = 1.5;
    const fl = new THREE.Mesh(flameGeo, flameMat);
    fl.position.y = 2.05;
    const core = new THREE.Mesh(flameGeo, flameMat2);
    core.scale.setScalar(0.55);
    core.position.y = 1.9;
    const gm = own(new THREE.SpriteMaterial({ map: glowTex, color: p.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    const glow = new THREE.Sprite(gm);
    glow.position.y = 2.1;
    glow.scale.setScalar(3.6 * big);
    g.add(pot, bowl, fl, core, glow);
    grp.add(g);
    flames.push({ m: fl, core, glow, ph: x * 1.7 + z });
  };
  brazier(-6.5, WALL_Z + 0.9, 1);
  brazier(6.5, WALL_Z + 0.9, 1);
  if (!low) {
    brazier(-10.2, WALL_Z + 0.9, 0.9);
    brazier(10.2, WALL_Z + 0.9, 0.9);
  }

  /* ---- tượng canh hai bên (bóng đen) ---- */
  if (!low) {
    const pedGeo = box(1.3, 0.7, 1.3);
    const bodyGeo = own(new THREE.CylinderGeometry(0.42, 0.55, 2.3, 8));
    const headGeo = own(new THREE.SphereGeometry(0.34, 10, 8));
    const swordGeo = box(0.14, 2.8, 0.1);
    const shGeo = box(0.12, 1.1, 0.7);
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 8.2, 0, WALL_Z + 1.0);
      const ped = new THREE.Mesh(pedGeo, darkMat);
      ped.position.y = 0.35;
      const body = new THREE.Mesh(bodyGeo, darkMat);
      body.position.y = 1.85;
      const head = new THREE.Mesh(headGeo, darkMat);
      head.position.y = 3.2;
      const sw = new THREE.Mesh(swordGeo, darkMat);
      sw.position.set(s * 0.7, 2.4, 0.15);
      const shd = new THREE.Mesh(shGeo, darkMat);
      shd.position.set(-s * 0.62, 1.9, 0.2);
      g.add(ped, body, head, sw, shd);
      grp.add(g);
    }
    // tường bên (khung hiện dần ở mép màn ngang)
    const sideGeo = box(1.2, 13, 40);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(sideGeo, wallMat);
      m.position.set(s * 21, 6.5, 12);
      grp.add(m);
    }
  }

  /* ---- chương 2: kênh nước chảy trước chân tường ---- */
  let wtex: THREE.CanvasTexture | null = null;
  if (p.water) {
    wtex = own(waterTex());
    wtex.repeat.set(10, 0.8);
    const wmesh = new THREE.Mesh(own(new THREE.PlaneGeometry(40, 1.3).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ map: wtex, transparent: true, opacity: 0.88 })));
    wmesh.position.set(0, 0.02, WALL_Z + 3.4);
    grp.add(wmesh);
  }

  const upd = (dt: number, t: number) => {
    for (const f of flames) {
      const k = 0.5 + 0.5 * Math.sin(t * 11 + f.ph) * Math.sin(t * 7.3 + f.ph * 0.7);
      f.m.scale.set(1 + k * 0.12, 0.85 + k * 0.4, 1 + k * 0.12);
      f.core.scale.set(0.55, 0.5 + k * 0.25, 0.55);
      (f.glow.material as THREE.SpriteMaterial).opacity = 0.6 + 0.35 * k;
    }
    if (!low) for (let i = 0; i < sway.length; i++) sway[i].rotation.z = Math.sin(t * 0.9 + i * 2) * 0.025;
    if (wtex) wtex.offset.x += dt * 0.04;
  };
  void hi;
  return {
    update: upd,
    dispose() {
      scene.remove(grp);
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
