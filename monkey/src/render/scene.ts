// Cảnh 3D: renderer, chất lượng (tự hạ khi FPS thấp), bầu trời, đất và đạo cụ của bản đồ đang chơi.
// Toàn bộ hình khối + texture vẽ bằng canvas (0 byte asset).
// Đạo cụ tĩnh của bản đồ được GỘP theo vật liệu (mergeGeometries) → mỗi bản đồ chỉ ~20 draw call;
// rừng/vách đá bao quanh dùng InstancedMesh; lửa đuốc là một THREE.Points.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP, mapById, type Box, type Circle, type Deco, type MapDef } from '@shared/monkey/map';
import { settings, type Quality } from '../settings';

export type Level = 'high' | 'medium' | 'low';

export interface QualityState {
  level: Level;
  particles: number;
  shadows: boolean;
  dpr: number;
  detail: boolean;
}

export function presetOf(level: Level): QualityState {
  const dev = Math.min(2, window.devicePixelRatio || 1);
  if (level === 'high') return { level, particles: 1100, shadows: true, dpr: dev, detail: true };
  if (level === 'medium') return { level, particles: 600, shadows: true, dpr: Math.min(dev, 1.25), detail: true };
  return { level, particles: 260, shadows: false, dpr: Math.min(dev, 0.9), detail: false };
}

export function guessLevel(): Level {
  const touch = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as any).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (touch) return mem >= 6 && cores >= 8 ? 'medium' : 'low';
  if (cores <= 2 || mem <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

export function resolveQuality(q: Quality): Level {
  return q === 'auto' ? guessLevel() : q;
}

/* ---------------- texture canvas ---------------- */
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function rand(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function groundTex(def: MapDef) {
  const th = def.theme;
  const A = def.arena;
  return canvasTex(1024, (g, s) => {
    const r = rand(7);
    g.fillStyle = th.ground;
    g.fillRect(0, 0, s, s);
    // nền lốm đốm
    for (let i = 0; i < 9000; i++) {
      const x = r() * s, y = r() * s;
      const k = r();
      g.fillStyle = k < 0.33 ? th.dots[0] : k < 0.66 ? th.dots[1] : th.dots[2];
      g.fillRect(x, y, 2 + r() * 4, 2 + r() * 4);
    }
    const cx = s / 2;
    const sc = s / (A * 2.2);
    const X = (x: number) => cx + x * sc;
    const dirt = (x: number, y: number, rad: number, a = 1) => {
      const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      gr.addColorStop(0, `rgba(${th.path},${a})`);
      gr.addColorStop(0.7, `rgba(${th.path},${a * 0.85})`);
      gr.addColorStop(1, `rgba(${th.path},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    };
    // lòng sông (bùn) vẽ trước để lối mòn không đè lên
    for (const d of def.deco) {
      if (d.kind !== 'river') continue;
      g.fillStyle = 'rgba(92,78,50,0.9)';
      g.fillRect(X(d.x - d.hx), X(d.z - d.hz - 1.1), d.hx * 2 * sc, (d.hz + 1.1) * 2 * sc);
      g.fillStyle = 'rgba(150,130,90,0.55)';
      g.fillRect(X(d.x - d.hx), X(d.z - d.hz - 1.6), d.hx * 2 * sc, 0.6 * sc);
      g.fillRect(X(d.x - d.hx), X(d.z + d.hz + 1.0), d.hx * 2 * sc, 0.6 * sc);
    }
    dirt(cx, cx, (th.style === 'jungle' ? 17 : 13) * sc, 1);
    for (const sp of def.spawns) {
      for (let t = 0; t <= 1; t += 0.03) {
        const x = cx + sp.x * sc * t + Math.sin(t * 9 + sp.x) * 8;
        const y = cx + sp.z * sc * t + Math.cos(t * 7 + sp.z) * 8;
        dirt(x, y, (2.2 + (1 - t) * 1.2) * sc, 0.5);
      }
    }
    if (th.style === 'jungle') {
      // lát đá quanh bàn thờ
      g.strokeStyle = 'rgba(80,70,60,0.5)';
      g.fillStyle = 'rgba(170,160,140,0.55)';
      for (let i = -4; i < 4; i++) {
        for (let j = -4; j < 4; j++) {
          if (r() < 0.25) continue;
          const x = cx + i * 1.7 * sc, y = cx + j * 1.7 * sc;
          g.fillRect(x + 1, y + 1, 1.6 * sc - 2, 1.6 * sc - 2);
          g.strokeRect(x + 1, y + 1, 1.6 * sc - 2, 1.6 * sc - 2);
        }
      }
    } else if (th.style === 'village') {
      // sân gạch quanh giếng làng
      g.strokeStyle = 'rgba(120,70,40,0.45)';
      g.fillStyle = 'rgba(178,104,70,0.5)';
      for (let i = -3; i < 3; i++) {
        for (let j = -3; j < 3; j++) {
          const x = cx + i * 1.4 * sc, y = cx + j * 1.4 * sc;
          g.fillRect(x + 1, y + 1, 1.3 * sc - 2, 1.3 * sc - 2);
          g.strokeRect(x + 1, y + 1, 1.3 * sc - 2, 1.3 * sc - 2);
        }
      }
    } else {
      // vết bóng tối dưới vách đá + sỏi
      for (const b of def.boxes) {
        if (b.kind !== 'cliff') continue;
        g.fillStyle = 'rgba(60,50,40,0.35)';
        g.fillRect(X(b.x - b.hx - 1), X(b.z - b.hz - 1), (b.hx + 1) * 2 * sc, (b.hz + 1) * 2 * sc);
      }
    }
    // lá rụng / sỏi
    for (let i = 0; i < 900; i++) {
      if (th.style === 'quarry') {
        const l = 90 + r() * 70;
        g.fillStyle = `rgba(${l},${l - 8},${l - 20},0.8)`;
        g.beginPath();
        g.arc(r() * s, r() * s, 1 + r() * 2.5, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = r() < 0.5 ? 'rgba(120,90,40,0.6)' : 'rgba(70,110,40,0.6)';
        g.beginPath();
        g.ellipse(r() * s, r() * s, 3 + r() * 3, 1.5, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

function stoneTex(base: [number, number, number]) {
  return canvasTex(256, (g, s) => {
    const r = rand(3);
    g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    g.fillRect(0, 0, s, s);
    const rows = 6;
    for (let j = 0; j < rows; j++) {
      const h = s / rows;
      const off = (j % 2) * 24;
      for (let x = -off; x < s; x += 48) {
        const l = r() * 40 - 20;
        g.fillStyle = `rgb(${base[0] + l + 10},${base[1] + l + 4},${base[2] + l - 8})`;
        g.fillRect(x + 2, j * h + 2, 44, h - 4);
      }
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(60,90,40,${r() * 0.5})`;
      g.fillRect(r() * s, r() * s * 0.4, 3, 3);
    }
  });
}

function woodTex() {
  return canvasTex(128, (g, s) => {
    const r = rand(5);
    g.fillStyle = '#a0692f';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#94602a' : '#a8733a';
      g.fillRect(0, (i * s) / 4 + 1, s, s / 4 - 2);
    }
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = 'rgba(70,40,15,0.35)';
      g.beginPath();
      const y = r() * s;
      g.moveTo(0, y);
      g.lineTo(s, y + (r() - 0.5) * 6);
      g.stroke();
    }
    g.strokeStyle = '#5a3612';
    g.lineWidth = 8;
    g.strokeRect(4, 4, s - 8, s - 8);
    g.beginPath();
    g.moveTo(8, 8);
    g.lineTo(s - 8, s - 8);
    g.stroke();
  });
}

const lin = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

function skyDome() {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: lin(0x4d8cdb) }, mid: { value: lin(0xfacc8c) }, low: { value: lin(0x8cb38c) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){
        float h = vP.y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*2.2,0.0,1.0),0.7)) : mix(mid, low, clamp(-h*4.0,0.0,1.0));
        gl_FragColor = vec4(c,1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

/* ---------------- gộp hình tĩnh theo vật liệu ---------------- */
interface Xf { ry?: number; rx?: number; rz?: number; sx?: number; sy?: number; sz?: number; cast?: boolean; /** thứ tự xoay YXZ (nghiêng cục bộ rồi mới quay hướng) */ yxz?: boolean }
class Batch {
  private parts = new Map<THREE.Material, [THREE.BufferGeometry[], THREE.BufferGeometry[]]>();
  private o = new THREE.Object3D();

  /** thêm một hình (geo sẽ bị tiêu thụ) vào lô của vật liệu mat */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, t: Xf = {}) {
    const o = this.o;
    o.position.set(x, y, z);
    o.rotation.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, t.yxz ? 'YXZ' : 'XYZ');
    o.scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    o.updateMatrix();
    let g = geo;
    if (g.index) {
      g = geo.toNonIndexed();
      geo.dispose();
    }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g.applyMatrix4(o.matrix);
    let l = this.parts.get(mat);
    if (!l) this.parts.set(mat, (l = [[], []]));
    l[t.cast === false ? 1 : 0].push(g);
  }

  build(parent: THREE.Object3D) {
    for (const [mat, lists] of this.parts) {
      for (let k = 0; k < 2; k++) {
        const l = lists[k];
        if (!l.length) continue;
        const g = mergeGeometries(l, false);
        for (const x of l) x.dispose();
        if (!g) continue;
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat);
        m.castShadow = k === 0;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        parent.add(m);
      }
    }
    this.parts.clear();
  }
}

/** vật liệu dùng chung trong một bản đồ */
interface Mats {
  stone: THREE.Material; moss: THREE.Material; wood: THREE.Material; plank: THREE.Material; dark: THREE.Material;
  rock: THREE.Material; trunk: THREE.Material; leaf: THREE.Material; leaf2: THREE.Material; thatch: THREE.Material;
  water: THREE.Material; metal: THREE.Material; hay: THREE.Material; lantern: THREE.Material; bone: THREE.Material; ore: THREE.Material;
}

/** cảnh của một bản đồ (gỡ ra khi đổi bản đồ) */
interface MapScene {
  group: THREE.Group;
  glow: THREE.Object3D | null;
  flames: THREE.Points | null;
  motes: THREE.Points | null;
  moteVel: Float32Array | null;
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  q: QualityState;
  private hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private flameTexP: THREE.Texture;
  /** id bản đồ đang dựng */
  mapId = '';
  private ms: MapScene | null = null;
  fpsAvg = 60;
  private lowSince = 0;
  private lastDrop = 0;
  onQuality: (l: Level) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.q = presetOf(resolveQuality(settings.quality));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.level !== 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 500);
    this.scene.fog = new THREE.Fog(0xb8c9a0, 45, 135);
    this.sky = skyDome();
    this.scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xdcefff, 0x46602c, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.1);
    this.sun.position.set(30, 50, 18);
    this.sun.shadow.camera.left = -30;
    this.sun.shadow.camera.right = 30;
    this.sun.shadow.camera.top = 30;
    this.sun.shadow.camera.bottom = -30;
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.flameTexP = flamePointTex();
    this.setMap(MAP.id);
    this.applyQuality(this.q.level);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyQuality(level: Level) {
    this.q = presetOf(level);
    this.renderer.setPixelRatio(this.q.dpr);
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.sun.castShadow = this.q.shadows;
    const sz = level === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== sz) {
      this.sun.shadow.mapSize.set(sz, sz);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as any).map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    if (this.ms?.motes) this.ms.motes.visible = this.q.detail;
    this.resize();
    this.onQuality(level);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** đo FPS, chế độ Tự động thì hạ chất lượng khi < 45 fps kéo dài */
  trackFps(dt: number, now: number) {
    if (dt <= 0) return;
    const fps = 1 / dt;
    this.fpsAvg += (fps - this.fpsAvg) * 0.05;
    if (settings.quality !== 'auto') return;
    if (this.fpsAvg < 45) {
      if (!this.lowSince) this.lowSince = now;
      if (now - this.lowSince > 3500 && now - this.lastDrop > 7000 && this.q.level !== 'low') {
        this.lastDrop = now;
        this.lowSince = 0;
        this.applyQuality(this.q.level === 'high' ? 'medium' : 'low');
        this.fpsAvg = 55;
      }
    } else this.lowSince = 0;
  }

  /** bóng đổ đi theo người chơi */
  followShadow(x: number, z: number) {
    this.sun.position.set(x + 22, 48, z + 14);
    this.sun.target.position.set(x, 0, z);
  }

  update(t: number, dt: number) {
    const ms = this.ms;
    if (!ms) return;
    if (ms.flames) {
      const m = ms.flames.material as THREE.PointsMaterial;
      m.size = 0.62 * (0.88 + Math.sin(t * 13) * 0.06 + Math.sin(t * 7.3) * 0.05);
    }
    if (ms.glow) {
      ms.glow.rotation.y = t * 0.6;
      ms.glow.position.y = 2.15 + Math.sin(t * 1.6) * 0.08;
    }
    if (ms.motes && ms.motes.visible && ms.moteVel) {
      const pos = ms.motes.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < a.length / 3; i++) {
        a[i * 3] += Math.sin(t * 0.5 + i) * dt * 0.3;
        a[i * 3 + 1] += ms.moteVel[i] * dt;
        if (a[i * 3 + 1] > 6) a[i * 3 + 1] = 0.3;
      }
      pos.needsUpdate = true;
    }
  }

  /** dựng cảnh cho bản đồ (gỡ bản đồ cũ, giải phóng GPU); không làm gì nếu đã đúng bản đồ */
  setMap(id: string) {
    const def = mapById(id);
    if (def.id === this.mapId) return;
    this.disposeMap();
    this.mapId = def.id;
    const th = def.theme;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(th.fog);
    fog.near = th.fogNear;
    fog.far = th.fogFar;
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.top.value = lin(th.skyTop);
    u.mid.value = lin(th.skyMid);
    u.low.value = lin(th.skyLow);
    this.hemi.color.setHex(th.hemiSky);
    this.hemi.groundColor.setHex(th.hemiGround);
    this.ms = this.buildMap(def);
    this.scene.add(this.ms.group);
    if (this.ms.motes) this.ms.motes.visible = this.q.detail;
  }

  private disposeMap() {
    const ms = this.ms;
    if (!ms) return;
    this.scene.remove(ms.group);
    const mats = new Set<THREE.Material>();
    ms.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
      else if (mm) mats.add(mm);
    });
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture && v !== this.flameTexP) (v as THREE.Texture).dispose();
      m.dispose();
    }
    this.ms = null;
  }

  private buildMap(def: MapDef): MapScene {
    const group = new THREE.Group();
    const th = def.theme;
    const A = def.arena;
    const quarry = th.style === 'quarry';
    const ms: MapScene = { group, glow: null, flames: null, motes: null, moteVel: null };

    // ---- đất ----
    const big = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshLambertMaterial({ map: canvasTex(256, (g, s) => {
        const r = rand(9);
        g.fillStyle = th.outer;
        g.fillRect(0, 0, s, s);
        for (let i = 0; i < 2500; i++) { g.fillStyle = r() < 0.5 ? th.outerDots[0] : th.outerDots[1]; g.fillRect(r() * s, r() * s, 3, 3); }
      }, 60) }),
    );
    big.rotation.x = -Math.PI / 2;
    big.position.y = -0.02;
    big.receiveShadow = true;
    group.add(big);
    const size = A * 2.2;
    const gt = groundTex(def);
    gt.wrapS = gt.wrapT = THREE.ClampToEdgeWrapping;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: gt }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    const L = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
    const M: Mats = {
      stone: L({ map: stoneTex(quarry ? [128, 114, 96] : [143, 138, 124]) }),
      moss: L({ color: 0x5c7d33 }),
      wood: L({ map: woodTex() }),
      plank: L({ color: 0x9a6a3a }),
      dark: L({ color: 0x5e3b1e }),
      rock: L({ color: quarry ? 0x9a8b74 : 0x8a877d, flatShading: true }),
      trunk: L({ color: 0x6b4a2b }),
      leaf: L({ color: th.leaf, flatShading: true }),
      leaf2: L({ color: th.leaf2, flatShading: true }),
      thatch: L({ color: 0xc8a25a, flatShading: true }),
      water: L({ color: 0x3f8fb0, emissive: 0x0b2c3c }),
      metal: L({ color: 0x5d5f63 }),
      hay: L({ color: 0xd9b45a, flatShading: true }),
      lantern: L({ color: 0xd23a2a, emissive: 0x6a1408 }),
      bone: L({ color: 0xe8e0c8 }),
      ore: L({ color: 0xc8a040, emissive: 0x2a1c00, flatShading: true }),
    };
    const bt = new Batch();
    const flames: number[] = [];

    for (const c of def.circles) this.circleProp(bt, M, c, flames);
    for (const b of def.boxes) {
      const glow = this.boxProp(bt, M, b, th.style);
      if (glow) { group.add(glow); ms.glow = glow; }
    }
    for (const d of def.deco) this.decoProp(bt, M, d);

    // ---- cổng khỉ: cột gỗ + đuốc ----
    for (const s of def.spawns) {
      const len = Math.hypot(s.x, s.z) || 1;
      const nx = s.x / len, nz = s.z / len;
      const px = -nz, pz = nx;
      for (const side of [-1, 1]) {
        const x = s.x + px * 2.6 * side, z = s.z + pz * 2.6 * side;
        bt.add(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 6), M.trunk, x, 1.1, z);
        flames.push(x, 2.45, z);
      }
      // đầu lâu khỉ treo trên cổng (cảnh báo)
      bt.add(new THREE.SphereGeometry(0.3, 8, 6), M.bone, s.x, 2.4, s.z);
      bt.add(new THREE.BoxGeometry(0.15, 0.15, 5.4), M.trunk, s.x, 2.25, s.z, { ry: Math.atan2(px, pz) });
    }
    bt.build(group);

    // ---- vòng ngoài (instanced) ----
    this.outerRing(group, def, M);

    // ---- lửa đuốc: một draw call ----
    if (flames.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(flames, 3));
      ms.flames = new THREE.Points(g, new THREE.PointsMaterial({ map: this.flameTexP, size: 0.62, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
      ms.flames.frustumCulled = false;
      group.add(ms.flames);
    }

    // ---- đom đóm / bụi sáng ----
    const r = rand(77);
    const n = 140;
    const pos = new Float32Array(n * 3);
    ms.moteVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() * 2 - 1) * A;
      pos[i * 3 + 1] = r() * 6;
      pos[i * 3 + 2] = (r() * 2 - 1) * A;
      ms.moteVel[i] = 0.1 + r() * 0.3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ms.motes = new THREE.Points(g, new THREE.PointsMaterial({ color: th.mote, size: quarry ? 0.07 : 0.09, transparent: true, opacity: quarry ? 0.5 : 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(ms.motes);
    return ms;
  }

  private circleProp(bt: Batch, M: Mats, c: Circle, flames: number[]) {
    switch (c.kind) {
      case 'pillar': {
        bt.add(new THREE.CylinderGeometry(c.r * 0.92, c.r, c.h, 10), M.stone, c.x, c.h / 2, c.z);
        bt.add(new THREE.BoxGeometry(c.r * 2.4, 0.35, c.r * 2.4), M.stone, c.x, c.h + 0.17, c.z);
        if (c.h > 3) bt.add(new THREE.CylinderGeometry(c.r * 1.25, c.r * 1.25, 0.3, 10), M.moss, c.x, c.h + 0.4, c.z, { cast: false });
        else {
          // gạch vụn quanh cột gãy
          for (let k = 0; k < 4; k++) bt.add(new THREE.DodecahedronGeometry(0.28 + (k % 2) * 0.12, 0), M.rock, c.x + Math.cos(k * 1.7) * 1.4, 0.15, c.z + Math.sin(k * 1.7) * 1.4);
        }
        return;
      }
      case 'tree': {
        const s = 1.05;
        bt.add(new THREE.CylinderGeometry(0.42 * s, 0.6 * s, 6 * s, 7), M.trunk, c.x, 3 * s, c.z);
        const parts: [number, number, number, number, THREE.Material][] = [
          [0, 6.8, 0, 2.6, M.leaf], [1.4, 6, 0.6, 1.9, M.leaf2], [-1.2, 6.2, -0.8, 2.0, M.leaf2], [0.3, 7.9, -0.4, 1.7, M.leaf],
        ];
        for (const [dx, dy, dz, r, m] of parts) bt.add(new THREE.IcosahedronGeometry(r * s, 0), m, c.x + dx * s, dy * s, c.z + dz * s);
        bt.add(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 4), M.leaf2, c.x + 1.3 * s, 4.4 * s, c.z + 0.4 * s, { cast: false });
        return;
      }
      case 'palm': {
        // thân cong: 3 khúc nghiêng dần
        const lean = (c.x * 7 + c.z * 3) % 6.28;
        const lx = Math.sin(lean), lz = Math.cos(lean);
        const seg = c.h / 3;
        let x = c.x, z = c.z;
        for (let k = 0; k < 3; k++) {
          const tilt = 0.06 + k * 0.08;
          const nx = x + lx * seg * tilt, nz = z + lz * seg * tilt;
          bt.add(new THREE.CylinderGeometry(c.r * (0.75 - k * 0.12), c.r * (0.9 - k * 0.12), seg + 0.1, 7), M.trunk, (x + nx) / 2, seg * (k + 0.5), (z + nz) / 2, { rx: lz * tilt, rz: -lx * tilt });
          x = nx;
          z = nz;
        }
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + lean;
          bt.add(new THREE.BoxGeometry(0.55, 0.06, 2.8), k & 1 ? M.leaf : M.leaf2, x + Math.sin(a) * 1.3, c.h - 0.25, z + Math.cos(a) * 1.3, { ry: a, rx: 0.35, yxz: true });
        }
        for (let k = 0; k < 3; k++) bt.add(new THREE.SphereGeometry(0.17, 6, 5), M.dark, x + Math.sin(k * 2.1) * 0.3, c.h - 0.4, z + Math.cos(k * 2.1) * 0.3);
        return;
      }
      case 'rock':
      case 'boulder': {
        const R = c.r * 1.08;
        bt.add(new THREE.DodecahedronGeometry(R, 1), M.rock, c.x, c.h * 0.45, c.z, { sy: (c.h * 0.58) / R, ry: c.x });
        if (c.kind === 'boulder') {
          bt.add(new THREE.DodecahedronGeometry(c.r * 0.55, 0), M.rock, c.x + c.r * 0.55, c.h * 0.85, c.z - c.r * 0.3, { ry: c.z, sy: 0.8 });
          bt.add(new THREE.DodecahedronGeometry(c.r * 0.4, 0), M.rock, c.x - c.r * 0.9, 0.3, c.z + c.r * 0.6, { ry: c.x });
        }
        return;
      }
      case 'stump':
        bt.add(new THREE.CylinderGeometry(c.r * 0.9, c.r, c.h, 9), M.trunk, c.x, c.h / 2, c.z);
        return;
      case 'post': {
        bt.add(new THREE.CylinderGeometry(c.r * 0.45, c.r * 0.6, c.h, 6), M.dark, c.x, c.h / 2, c.z);
        bt.add(new THREE.BoxGeometry(0.4, 0.5, 0.4), M.lantern, c.x, c.h - 0.1, c.z);
        bt.add(new THREE.ConeGeometry(0.38, 0.3, 4), M.dark, c.x, c.h + 0.3, c.z, { ry: Math.PI / 4 });
        flames.push(c.x, c.h + 0.05, c.z);
        return;
      }
      case 'barrel': {
        bt.add(new THREE.CylinderGeometry(c.r * 0.92, c.r, c.h, 10), M.plank, c.x, c.h / 2, c.z);
        for (const y of [0.22, 0.78]) bt.add(new THREE.CylinderGeometry(c.r * 1.02, c.r * 1.02, 0.07, 10), M.metal, c.x, c.h * y, c.z, { cast: false });
        return;
      }
      case 'hay': {
        bt.add(new THREE.CylinderGeometry(c.r, c.r * 1.05, c.h * 0.65, 9), M.hay, c.x, c.h * 0.325, c.z);
        bt.add(new THREE.ConeGeometry(c.r, c.h * 0.45, 9), M.hay, c.x, c.h * 0.65 + c.h * 0.225, c.z);
        return;
      }
    }
  }

  /** trả về vật thể động (tượng chuối vàng) nếu có */
  private boxProp(bt: Batch, M: Mats, b: Box, style: string): THREE.Object3D | null {
    const W = b.hx * 2, D = b.hz * 2;
    const alongX = b.hx >= b.hz;
    switch (b.kind) {
      case 'crate':
        bt.add(new THREE.BoxGeometry(W, b.h, D), M.wood, b.x, b.h / 2, b.z);
        return null;
      case 'wall':
        bt.add(new THREE.BoxGeometry(W, b.h, D), M.stone, b.x, b.h / 2, b.z);
        bt.add(new THREE.BoxGeometry(W + 0.1, 0.12, D + 0.1), M.moss, b.x, b.h + 0.05, b.z, { cast: false });
        return null;
      case 'altar': {
        bt.add(new THREE.BoxGeometry(W, b.h, D), M.stone, b.x, b.h / 2, b.z);
        bt.add(new THREE.BoxGeometry(W + 0.8, 0.25, D + 0.8), M.stone, b.x, 0.12, b.z);
        // tượng chuối vàng phát sáng (3 nải gộp một mesh)
        const parts: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 3; k++) {
          const g = new THREE.TorusGeometry(0.45, 0.13, 8, 16, Math.PI * 0.75);
          g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, (k * Math.PI * 2) / 3, Math.PI * 0.12)));
          g.translate(0, 0.1, 0);
          parts.push(g);
        }
        const mg = mergeGeometries(parts, false)!;
        parts.forEach((p) => p.dispose());
        const gold = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xb07a00, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 });
        const glow = new THREE.Mesh(mg, gold);
        glow.position.set(b.x, 2.15, b.z);
        return glow;
      }
      case 'hut': {
        const floorY = b.h * 0.47;
        const bodyH = b.h * 0.41;
        const village = style === 'village';
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bt.add(new THREE.CylinderGeometry(0.14, 0.16, floorY, 6), M.trunk, b.x + dx * (b.hx - 0.2), floorY / 2, b.z + dz * (b.hz - 0.2));
        bt.add(new THREE.BoxGeometry(W, bodyH, D), village ? M.plank : M.wood, b.x, floorY + bodyH / 2, b.z);
        const roofH = b.h * 0.47;
        bt.add(new THREE.ConeGeometry(Math.max(b.hx, b.hz) * 1.9, roofH, 4), M.thatch, b.x, floorY + bodyH + roofH / 2 - 0.1, b.z, { ry: Math.PI / 4 });
        if (village) {
          // hiên + thang + bậu cửa sổ
          bt.add(new THREE.BoxGeometry(W + 0.8, 0.1, 0.9), M.dark, b.x, floorY, b.z + b.hz + 0.35, { cast: false });
          for (const s of [-0.3, 0.3]) bt.add(new THREE.BoxGeometry(0.07, floorY * 1.15, 0.07), M.dark, b.x + s, floorY / 2, b.z + b.hz + 0.95, { rx: -0.35 });
          bt.add(new THREE.BoxGeometry(0.8, 0.5, 0.05), M.dark, b.x, floorY + bodyH * 0.55, b.z + b.hz + 0.02, { cast: false });
        }
        return null;
      }
      case 'water':
        return null; // dòng sông vẽ bằng deco 'river'
      case 'boat': {
        const len = alongX ? W : D, wid = alongX ? D : W;
        const ry = alongX ? 0 : Math.PI / 2;
        const ox = alongX ? 1 : 0, oz = alongX ? 0 : 1;
        bt.add(new THREE.BoxGeometry(len * 0.66, 0.5, wid), M.dark, b.x, 0.3, b.z, { ry });
        for (const s of [-1, 1]) bt.add(new THREE.BoxGeometry(wid * 0.72, 0.46, wid * 0.72), M.dark, b.x + ox * s * len * 0.33, 0.32, b.z + oz * s * len * 0.33, { ry: ry + Math.PI / 4, sx: 1, sz: 1 });
        bt.add(new THREE.CylinderGeometry(wid * 0.48, wid * 0.48, len * 0.38, 10, 1, true, 0, Math.PI), M.thatch, b.x, 0.55, b.z, { rz: Math.PI / 2, ry });
        return null;
      }
      case 'pier': {
        bt.add(new THREE.BoxGeometry(W, 0.12, D), M.plank, b.x, b.h, b.z);
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]]) bt.add(new THREE.CylinderGeometry(0.09, 0.1, b.h + 0.3, 5), M.dark, b.x + dx * (b.hx - 0.1), (b.h + 0.3) / 2 - 0.15, b.z + dz * (b.hz - 0.1));
        return null;
      }
      case 'fence': {
        const len = alongX ? W : D;
        const n = Math.max(2, Math.round(len / 1.5) + 1);
        for (let k = 0; k < n; k++) {
          const t = -len / 2 + (k * len) / (n - 1);
          bt.add(new THREE.BoxGeometry(0.14, b.h, 0.14), M.dark, b.x + (alongX ? t : 0), b.h / 2, b.z + (alongX ? 0 : t));
        }
        for (const y of [0.4, 0.85]) bt.add(new THREE.BoxGeometry(alongX ? len : 0.08, 0.08, alongX ? 0.08 : len), M.plank, b.x, b.h * y, b.z);
        return null;
      }
      case 'cliff': {
        bt.add(new THREE.BoxGeometry(W, b.h, D), M.rock, b.x, b.h / 2, b.z);
        bt.add(new THREE.BoxGeometry(W * 0.96, 0.25, D * 0.96), M.stone, b.x, b.h * 0.35, b.z, { cast: false, sx: 1.04, sz: 1.04 });
        const len = alongX ? W : D, th = Math.min(b.hx, b.hz);
        const n = Math.max(2, Math.round(len / 2.6));
        for (let k = 0; k < n; k++) {
          const t = -len / 2 + ((k + 0.5) * len) / n;
          bt.add(new THREE.DodecahedronGeometry(th * 1.05, 0), M.rock, b.x + (alongX ? t : 0), b.h - th * 0.3, b.z + (alongX ? 0 : t), { ry: k * 1.3 + b.x, sy: 0.7 });
        }
        return null;
      }
      case 'cart': {
        bt.add(new THREE.BoxGeometry(W, 0.7, D), M.dark, b.x, 0.8, b.z);
        bt.add(new THREE.BoxGeometry(W + 0.04, 0.08, D + 0.04), M.metal, b.x, 1.1, b.z, { cast: false });
        for (const s of [-1, 1]) {
          for (const u of [-0.6, 0.6]) {
            const x = alongX ? b.x + u * b.hx : b.x + s * (b.hx + 0.04);
            const z = alongX ? b.z + s * (b.hz + 0.04) : b.z + u * b.hz;
            bt.add(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), M.metal, x, 0.3, z, alongX ? { rx: Math.PI / 2 } : { rz: Math.PI / 2 });
          }
        }
        bt.add(new THREE.DodecahedronGeometry(Math.min(b.hx, b.hz) * 0.95, 0), M.ore, b.x, 1.18, b.z, { sy: 0.55, sx: alongX ? 1.5 : 1, sz: alongX ? 1 : 1.5 });
        return null;
      }
      case 'scaffold': {
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bt.add(new THREE.CylinderGeometry(0.12, 0.14, b.h, 6), M.trunk, b.x + dx * (b.hx - 0.12), b.h / 2, b.z + dz * (b.hz - 0.12));
        for (const y of [b.h * 0.5, b.h]) bt.add(new THREE.BoxGeometry(W, 0.12, D), M.plank, b.x, y, b.z);
        // giằng chéo 4 mặt
        const hd = b.h * 0.5;
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const span = dx ? D : W;
          const len = Math.hypot(span, hd);
          const ang = Math.atan2(hd, span);
          bt.add(new THREE.BoxGeometry(0.08, 0.08, len), M.trunk, b.x + dx * (b.hx - 0.05), hd / 2, b.z + dz * (b.hz - 0.05), dx ? { rx: ang } : { ry: Math.PI / 2, rx: ang, cast: false, yxz: true });
        }
        // hàng hoá chất dưới giàn (đọc thành khối chắn)
        bt.add(new THREE.BoxGeometry(W * 0.7, b.h * 0.3, D * 0.7), M.wood, b.x, b.h * 0.15, b.z);
        bt.add(new THREE.BoxGeometry(W * 0.4, b.h * 0.18, D * 0.4), M.wood, b.x + b.hx * 0.2, b.h * 0.3 + b.h * 0.09, b.z - b.hz * 0.15, { ry: 0.3 });
        bt.add(new THREE.BoxGeometry(0.6, 0.6, 0.6), M.lantern, b.x, b.h + 0.36, b.z, { cast: false });
        return null;
      }
    }
    return null;
  }

  private decoProp(bt: Batch, M: Mats, d: Deco) {
    const alongX = d.hx >= d.hz;
    if (d.kind === 'river') {
      bt.add(new THREE.PlaneGeometry(d.hx * 2, d.hz * 2), M.water, d.x, 0.04, d.z, { rx: -Math.PI / 2, cast: false });
    } else if (d.kind === 'bridge') {
      bt.add(new THREE.BoxGeometry(d.hx * 2, 0.14, d.hz * 2), M.plank, d.x, 0.1, d.z, { cast: false });
      const len = alongX ? d.hx * 2 : d.hz * 2;
      const n = Math.round(len / 0.7);
      for (let k = 0; k < n; k++) {
        const t = -len / 2 + (k + 0.5) * (len / n);
        bt.add(new THREE.BoxGeometry(alongX ? 0.06 : d.hx * 2, 0.02, alongX ? d.hz * 2 : 0.06), M.dark, d.x + (alongX ? t : 0), 0.18, d.z + (alongX ? 0 : t), { cast: false });
      }
    } else {
      // đường ray: 2 thanh sắt + tà vẹt
      const len = alongX ? d.hx * 2 : d.hz * 2;
      for (const s of [-0.45, 0.45]) bt.add(new THREE.BoxGeometry(alongX ? len : 0.08, 0.08, alongX ? 0.08 : len), M.metal, d.x + (alongX ? 0 : s), 0.07, d.z + (alongX ? s : 0), { cast: false });
      const n = Math.round(len / 0.8);
      for (let k = 0; k < n; k++) {
        const t = -len / 2 + (k + 0.5) * (len / n);
        bt.add(new THREE.BoxGeometry(alongX ? 0.25 : 1.3, 0.06, alongX ? 1.3 : 0.25), M.dark, d.x + (alongX ? t : 0), 0.03, d.z + (alongX ? 0 : t), { cast: false });
      }
    }
  }

  /** rừng / vách đá bao quanh sân (InstancedMesh, ≤3 draw call) */
  private outerRing(group: THREE.Group, def: MapDef, M: Mats) {
    const A = def.arena;
    const th = def.theme;
    const r = rand(42);
    const tmp = new THREE.Object3D();
    const nearGate = (x: number, z: number, rad: number) => def.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < rad && Math.max(Math.abs(x), Math.abs(z)) < A + 8);
    const inRiver = (x: number, z: number) => def.deco.some((d) => d.kind === 'river' && Math.abs(x - d.x) < d.hx && Math.abs(z - d.z) < d.hz + 1.5);
    /** điểm ngẫu nhiên trên vành vuông [A+d0, A+d0+span] */
    const ringPt = (d0: number, span: number): [number, number] => {
      const a = r() * Math.PI * 2;
      const d = A + d0 + r() * span;
      const m = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      return [(Math.cos(a) * d) / m, (Math.sin(a) * d) / m];
    };

    if (th.style === 'quarry') {
      // vách núi bao quanh
      const rocks: THREE.Matrix4[] = [];
      for (let i = 0; i < 150; i++) {
        const [x, z] = ringPt(2.5, 20);
        if (nearGate(x, z, 6)) continue;
        const s = 3 + r() * 5;
        tmp.position.set(x, s * 0.5, z);
        tmp.scale.set(s * (0.8 + r() * 0.5), s * (0.9 + r() * 0.9), s * (0.8 + r() * 0.5));
        tmp.rotation.set(0, r() * 6, 0);
        tmp.updateMatrix();
        rocks.push(tmp.matrix.clone());
      }
      const rI = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), M.rock, rocks.length);
      rocks.forEach((m, i) => {
        rI.setMatrixAt(i, m);
        rI.setColorAt(i, new THREE.Color().setHSL(0.08 + r() * 0.03, 0.18 + r() * 0.1, 0.42 + r() * 0.14));
      });
      rI.castShadow = true;
      rI.receiveShadow = true;
      group.add(rI);
      // thông lác đác trên vách
      const pines: THREE.Matrix4[] = [];
      for (let i = 0; i < 70; i++) {
        const [x, z] = ringPt(6, 22);
        if (nearGate(x, z, 6)) continue;
        const s = 0.8 + r() * 0.8;
        tmp.position.set(x, 2.6 * s + 2, z);
        tmp.scale.set(s, s, s);
        tmp.rotation.set(0, r() * 6, 0);
        tmp.updateMatrix();
        pines.push(tmp.matrix.clone());
      }
      const pI = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 5.2, 6), M.leaf2, pines.length);
      pines.forEach((m, i) => pI.setMatrixAt(i, m));
      pI.castShadow = true;
      group.add(pI);
      return;
    }

    const village = th.style === 'village';
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const crownCol: THREE.Color[] = [];
    const count = village ? 190 : 280;
    for (let i = 0; i < count; i++) {
      const [x, z] = ringPt(1.5, 26);
      if (Math.max(Math.abs(x), Math.abs(z)) < A + 1.2) continue;
      if (nearGate(x, z, 4.5) || inRiver(x, z)) continue;
      const s = 0.8 + r() * 0.9;
      tmp.position.set(x, 2.2 * s, z);
      tmp.scale.set(s, s, s);
      tmp.rotation.set(0, r() * 6, 0);
      tmp.updateMatrix();
      trunks.push(tmp.matrix.clone());
      tmp.position.set(x, 5.2 * s, z);
      tmp.scale.set(s * (1 + r() * 0.3), s * (0.8 + r() * 0.4), s * (1 + r() * 0.3));
      tmp.updateMatrix();
      crowns.push(tmp.matrix.clone());
      crownCol.push(new THREE.Color().setHSL((village ? 0.25 : 0.28) + r() * 0.07, 0.45 + r() * 0.2, (village ? 0.3 : 0.25) + r() * 0.12));
    }
    const tI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 4.4, 6), M.trunk, trunks.length);
    const cI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), M.leaf, crowns.length);
    trunks.forEach((m, i) => tI.setMatrixAt(i, m));
    crowns.forEach((m, i) => {
      cI.setMatrixAt(i, m);
      cI.setColorAt(i, crownCol[i]);
    });
    cI.castShadow = true;
    group.add(tI, cI);
    // bụi cây sát mép
    const bushes: THREE.Matrix4[] = [];
    for (let i = 0; i < 170; i++) {
      const side = i % 4;
      const t = (r() * 2 - 1) * (A + 2);
      const off = A + 0.8 + r() * 2.5;
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? off : -off;
      const z = side === 0 ? off : side === 1 ? -off : t;
      if (def.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 4) || inRiver(x, z)) continue;
      const s = 0.7 + r() * 0.8;
      tmp.position.set(x, 0.4 * s, z);
      tmp.scale.set(s * 1.3, s, s * 1.3);
      tmp.rotation.set(0, r() * 6, 0);
      tmp.updateMatrix();
      bushes.push(tmp.matrix.clone());
    }
    const bI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), M.leaf2, bushes.length);
    bushes.forEach((m, i) => bI.setMatrixAt(i, m));
    group.add(bI);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

export function flameTex() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 64, 4, 32, 56, 40);
  gr.addColorStop(0, 'rgba(255,250,200,1)');
  gr.addColorStop(0.3, 'rgba(255,190,60,0.9)');
  gr.addColorStop(0.7, 'rgba(230,80,20,0.4)');
  gr.addColorStop(1, 'rgba(200,40,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(32, 2);
  g.bezierCurveTo(56, 40, 60, 70, 32, 94);
  g.bezierCurveTo(4, 70, 8, 40, 32, 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** ngọn lửa trong ô vuông (cho THREE.Points) */
function flamePointTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 44, 3, 32, 38, 28);
  gr.addColorStop(0, 'rgba(255,250,200,1)');
  gr.addColorStop(0.3, 'rgba(255,190,60,0.9)');
  gr.addColorStop(0.7, 'rgba(230,80,20,0.4)');
  gr.addColorStop(1, 'rgba(200,40,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(32, 2);
  g.bezierCurveTo(48, 26, 50, 46, 32, 62);
  g.bezierCurveTo(14, 46, 16, 26, 32, 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** texture chấm tròn mềm cho hạt */
export function dotTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** bóng tròn mềm dưới chân */
export function blobTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
