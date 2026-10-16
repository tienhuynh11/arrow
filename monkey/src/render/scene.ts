// Cảnh 3D: renderer, chất lượng (tự hạ khi FPS thấp), bầu trời, đất, đền đá, cây rừng, đuốc.
// Toàn bộ hình khối + texture vẽ bằng canvas (0 byte asset).

import * as THREE from 'three';
import { ARENA, BOXES, CIRCLES, SPAWNS } from '@shared/monkey/map';
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

function groundTex() {
  return canvasTex(1024, (g, s) => {
    const r = rand(7);
    g.fillStyle = '#4f7a2f';
    g.fillRect(0, 0, s, s);
    // cỏ lốm đốm
    for (let i = 0; i < 9000; i++) {
      const x = r() * s, y = r() * s;
      const k = r();
      g.fillStyle = k < 0.33 ? '#5f8f36' : k < 0.66 ? '#446b28' : '#6c9c3e';
      g.fillRect(x, y, 2 + r() * 4, 2 + r() * 4);
    }
    // bãi đất giữa sân (đền) + lối mòn tới các cổng
    const cx = s / 2;
    const sc = s / (ARENA * 2.2);
    const dirt = (x: number, y: number, rad: number, a = 1) => {
      const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      gr.addColorStop(0, `rgba(150,112,70,${a})`);
      gr.addColorStop(0.7, `rgba(132,98,60,${a * 0.85})`);
      gr.addColorStop(1, 'rgba(132,98,60,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    };
    dirt(cx, cx, 17 * sc, 1);
    for (const sp of SPAWNS) {
      for (let t = 0; t <= 1; t += 0.04) {
        const x = cx + sp.x * sc * t + Math.sin(t * 9 + sp.x) * 8;
        const y = cx + sp.z * sc * t + Math.cos(t * 7 + sp.z) * 8;
        dirt(x, y, (2.2 + (1 - t) * 1.2) * sc, 0.55);
      }
    }
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
    // lá rụng
    for (let i = 0; i < 700; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,90,40,0.6)' : 'rgba(70,110,40,0.6)';
      g.beginPath();
      g.ellipse(r() * s, r() * s, 3 + r() * 3, 1.5, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function stoneTex() {
  return canvasTex(256, (g, s) => {
    const r = rand(3);
    g.fillStyle = '#8f8a7c';
    g.fillRect(0, 0, s, s);
    const rows = 6;
    for (let j = 0; j < rows; j++) {
      const h = s / rows;
      const off = (j % 2) * 24;
      for (let x = -off; x < s; x += 48) {
        const l = 120 + r() * 40;
        g.fillStyle = `rgb(${l},${l - 6},${l - 18})`;
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

function skyDome() {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 top = vec3(0.30,0.55,0.86);
        vec3 mid = vec3(0.98,0.80,0.55);
        vec3 low = vec3(0.55,0.70,0.55);
        vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*2.2,0.0,1.0),0.7)) : mix(mid, low, clamp(-h*4.0,0.0,1.0));
        gl_FragColor = vec4(c,1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  q: QualityState;
  torches: THREE.Sprite[] = [];
  private flameMat: THREE.SpriteMaterial;
  bananaGlow: THREE.Mesh | null = null;
  private motes: THREE.Points | null = null;
  private moteVel: Float32Array | null = null;
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
    this.scene.fog = new THREE.Fog(0xb8c9a0, 38, 110);
    this.scene.add(skyDome());
    const hemi = new THREE.HemisphereLight(0xdcefff, 0x46602c, 1.05);
    this.scene.add(hemi);
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
    this.flameMat = new THREE.SpriteMaterial({ map: flameTex(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.buildWorld();
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
    if (this.motes) this.motes.visible = this.q.detail;
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
    for (let i = 0; i < this.torches.length; i++) {
      const s = this.torches[i];
      const k = 0.85 + Math.sin(t * 13 + i * 3.1) * 0.08 + Math.sin(t * 7.3 + i) * 0.07;
      s.scale.set(0.7 * k, 1.1 * k, 1);
    }
    if (this.bananaGlow) {
      this.bananaGlow.rotation.y = t * 0.6;
      this.bananaGlow.position.y = 2.15 + Math.sin(t * 1.6) * 0.08;
    }
    if (this.motes && this.motes.visible && this.moteVel) {
      const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < a.length / 3; i++) {
        a[i * 3] += Math.sin(t * 0.5 + i) * dt * 0.3;
        a[i * 3 + 1] += this.moteVel[i] * dt;
        if (a[i * 3 + 1] > 6) a[i * 3 + 1] = 0.3;
      }
      pos.needsUpdate = true;
    }
  }

  private buildWorld() {
    const sc = this.scene;
    // ---- đất ----
    const big = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshLambertMaterial({ map: canvasTex(256, (g, s) => {
        const r = rand(9);
        g.fillStyle = '#3f6a26';
        g.fillRect(0, 0, s, s);
        for (let i = 0; i < 2500; i++) { g.fillStyle = r() < 0.5 ? '#4b7a2e' : '#36601f'; g.fillRect(r() * s, r() * s, 3, 3); }
      }, 60) }),
    );
    big.rotation.x = -Math.PI / 2;
    big.position.y = -0.02;
    big.receiveShadow = true;
    sc.add(big);
    const size = ARENA * 2.2;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: groundTex() }));
    (ground.material as THREE.MeshLambertMaterial).map!.wrapS = THREE.ClampToEdgeWrapping;
    (ground.material as THREE.MeshLambertMaterial).map!.wrapT = THREE.ClampToEdgeWrapping;
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    sc.add(ground);

    const stone = new THREE.MeshLambertMaterial({ map: stoneTex() });
    const moss = new THREE.MeshLambertMaterial({ color: 0x5c7d33 });
    const wood = new THREE.MeshLambertMaterial({ map: woodTex() });
    const rockM = new THREE.MeshLambertMaterial({ color: 0x8a877d, flatShading: true });
    const trunkM = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    const leafM = new THREE.MeshLambertMaterial({ color: 0x3f8a3a, flatShading: true });
    const leafM2 = new THREE.MeshLambertMaterial({ color: 0x2f7330, flatShading: true });
    const thatch = new THREE.MeshLambertMaterial({ color: 0xc8a25a, flatShading: true });

    const add = (m: THREE.Mesh, shadow = true) => {
      m.castShadow = shadow;
      m.receiveShadow = true;
      sc.add(m);
      return m;
    };

    for (const c of CIRCLES) {
      if (c.kind === 'pillar') {
        const p = add(new THREE.Mesh(new THREE.CylinderGeometry(c.r * 0.92, c.r, c.h, 10), stone));
        p.position.set(c.x, c.h / 2, c.z);
        const cap = add(new THREE.Mesh(new THREE.BoxGeometry(c.r * 2.4, 0.35, c.r * 2.4), stone));
        cap.position.set(c.x, c.h + 0.17, c.z);
        if (c.h > 3) {
          const m = add(new THREE.Mesh(new THREE.CylinderGeometry(c.r * 1.25, c.r * 1.25, 0.3, 10), moss), false);
          m.position.set(c.x, c.h + 0.4, c.z);
        } else {
          // gạch vụn quanh cột gãy
          for (let k = 0; k < 4; k++) {
            const d = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + (k % 2) * 0.12, 0), rockM));
            d.position.set(c.x + Math.cos(k * 1.7) * 1.4, 0.15, c.z + Math.sin(k * 1.7) * 1.4);
          }
        }
      } else if (c.kind === 'tree') {
        this.tree(c.x, c.z, 1.05, trunkM, leafM, leafM2);
      } else if (c.kind === 'rock') {
        const m = add(new THREE.Mesh(new THREE.DodecahedronGeometry(c.r * 1.05, 1), rockM));
        m.scale.set(1, c.h / c.r, 1);
        m.position.set(c.x, c.h * 0.45, c.z);
        m.rotation.y = c.x;
      } else {
        const m = add(new THREE.Mesh(new THREE.CylinderGeometry(c.r * 0.9, c.r, c.h, 9), trunkM));
        m.position.set(c.x, c.h / 2, c.z);
      }
    }
    for (const b of BOXES) {
      if (b.kind === 'crate') {
        const m = add(new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), wood));
        m.position.set(b.x, b.h / 2, b.z);
        m.rotation.y = 0;
      } else if (b.kind === 'wall') {
        const m = add(new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), stone));
        m.position.set(b.x, b.h / 2, b.z);
        const top = add(new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 0.1, 0.12, b.hz * 2 + 0.1), moss), false);
        top.position.set(b.x, b.h + 0.05, b.z);
      } else if (b.kind === 'altar') {
        const m = add(new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), stone));
        m.position.set(b.x, b.h / 2, b.z);
        const step = add(new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 0.8, 0.25, b.hz * 2 + 0.8), stone));
        step.position.set(b.x, 0.12, b.z);
        // tượng chuối vàng phát sáng
        const gold = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xb07a00, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 });
        const grp = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const ban = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.13, 8, 16, Math.PI * 0.75), gold);
          ban.rotation.set(0, (k * Math.PI * 2) / 3, Math.PI * 0.12);
          ban.position.y = 0.1;
          grp.add(ban);
        }
        grp.position.set(b.x, 2.15, b.z);
        sc.add(grp);
        this.bananaGlow = grp as unknown as THREE.Mesh;
      } else if (b.kind === 'hut') {
        const floorY = 1.6;
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, floorY, 6), trunkM));
          leg.position.set(b.x + dx * (b.hx - 0.2), floorY / 2, b.z + dz * (b.hz - 0.2));
        }
        const body = add(new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, 1.4, b.hz * 2), wood));
        body.position.set(b.x, floorY + 0.7, b.z);
        const roof = add(new THREE.Mesh(new THREE.ConeGeometry(b.hx * 1.9, 1.6, 4), thatch));
        roof.position.set(b.x, floorY + 2.2, b.z);
        roof.rotation.y = Math.PI / 4;
      }
    }

    // ---- rừng bao quanh (instanced, 2 draw call) ----
    const r = rand(42);
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const tmp = new THREE.Object3D();
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2;
      const d = ARENA + 1.5 + r() * 26;
      let x = Math.cos(a) * d;
      let z = Math.sin(a) * d;
      // vuông hoá theo cạnh sân
      const m = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      x /= m * 1.0;
      z /= m * 1.0;
      if (Math.max(Math.abs(x), Math.abs(z)) < ARENA + 1.2) continue;
      // chừa lối ở cổng khỉ
      if (SPAWNS.some((s) => Math.hypot(s.x - x, s.z - z) < 4.5 && Math.max(Math.abs(x), Math.abs(z)) < ARENA + 8)) continue;
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
    }
    const tI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 4.4, 6), trunkM, trunks.length);
    const cI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), leafM, crowns.length);
    trunks.forEach((m, i) => tI.setMatrixAt(i, m));
    crowns.forEach((m, i) => {
      cI.setMatrixAt(i, m);
      const c = new THREE.Color().setHSL(0.28 + r() * 0.07, 0.45 + r() * 0.2, 0.25 + r() * 0.12);
      cI.setColorAt(i, c);
    });
    cI.castShadow = true;
    sc.add(tI, cI);
    // bụi cây sát mép
    const bushes: THREE.Matrix4[] = [];
    for (let i = 0; i < 140; i++) {
      const side = i % 4;
      const t = (r() * 2 - 1) * (ARENA + 2);
      const off = ARENA + 0.8 + r() * 2.5;
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? off : -off;
      const z = side === 0 ? off : side === 1 ? -off : t;
      if (SPAWNS.some((s) => Math.hypot(s.x - x, s.z - z) < 4)) continue;
      const s = 0.7 + r() * 0.8;
      tmp.position.set(x, 0.4 * s, z);
      tmp.scale.set(s * 1.3, s, s * 1.3);
      tmp.rotation.set(0, r() * 6, 0);
      tmp.updateMatrix();
      bushes.push(tmp.matrix.clone());
    }
    const bI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), leafM2, bushes.length);
    bushes.forEach((m, i) => bI.setMatrixAt(i, m));
    sc.add(bI);

    // ---- cổng khỉ: cột gỗ + đuốc ----
    for (const s of SPAWNS) {
      const len = Math.hypot(s.x, s.z);
      const nx = s.x / len, nz = s.z / len;
      const px = -nz, pz = nx;
      for (const side of [-1, 1]) {
        const x = s.x + px * 2.6 * side, z = s.z + pz * 2.6 * side;
        const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 6), trunkM));
        post.position.set(x, 1.1, z);
        const fl = new THREE.Sprite(this.flameMat);
        fl.position.set(x, 2.45, z);
        fl.scale.set(0.7, 1.1, 1);
        sc.add(fl);
        this.torches.push(fl);
      }
      // đầu lâu khỉ treo trên cổng (cảnh báo)
      const skull = add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshLambertMaterial({ color: 0xe8e0c8 })));
      skull.position.set(s.x, 2.4, s.z);
      const bar = add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 5.4), trunkM));
      bar.position.set(s.x, 2.25, s.z);
      bar.rotation.y = Math.atan2(px, pz);
    }

    // ---- đom đóm / bụi sáng ----
    const n = 120;
    const pos = new Float32Array(n * 3);
    this.moteVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() * 2 - 1) * ARENA;
      pos[i * 3 + 1] = r() * 6;
      pos[i * 3 + 2] = (r() * 2 - 1) * ARENA;
      this.moteVel[i] = 0.1 + r() * 0.3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff3a0, size: 0.09, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    sc.add(this.motes);
  }

  private tree(x: number, z: number, s: number, trunkM: THREE.Material, leafM: THREE.Material, leafM2: THREE.Material) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * s, 0.6 * s, 6 * s, 7), trunkM);
    t.position.set(x, 3 * s, z);
    t.castShadow = true;
    this.scene.add(t);
    const parts: [number, number, number, number, THREE.Material][] = [
      [0, 6.8, 0, 2.6, leafM], [1.4, 6, 0.6, 1.9, leafM2], [-1.2, 6.2, -0.8, 2.0, leafM2], [0.3, 7.9, -0.4, 1.7, leafM],
    ];
    for (const [dx, dy, dz, r, m] of parts) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 0), m);
      c.position.set(x + dx * s, dy * s, z + dz * s);
      c.castShadow = true;
      this.scene.add(c);
    }
    // dây leo rủ xuống
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 4), leafM2);
    vine.position.set(x + 1.3 * s, 4.4 * s, z + 0.4 * s);
    this.scene.add(vine);
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
