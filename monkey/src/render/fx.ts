// Hiệu ứng: hạt (2 hệ thống, giới hạn theo chất lượng), vệt đạn, chớp nổ, vòng sóng, đạn bay, thực thể đặt.

import * as THREE from 'three';
import { PROJ_G, SHOCK_MAX, SHOCK_SPEED } from '@shared/monkey/content';
import type { GameModel } from '@shared/monkey/client';
import { EN_BARRICADE, EN_FLARE, EN_PICKUP, EN_POD, EN_TURRET, PJ_BANANA, PJ_BARREL, PJ_GRENADE } from '@shared/monkey/proto';
import { dotTex, flameTex } from './scene';

class Particles {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private head = 0;
  limit: number;
  mat: THREE.ShaderMaterial;

  constructor(n: number, additive: boolean, tex: THREE.Texture) {
    this.n = n;
    this.limit = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); if (t.a * vA < 0.01) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, grav = 0, drag = 0) {
    // vòng tròn, quá giới hạn thì đè hạt cũ nhất
    const i = this.head;
    this.head = (this.head + 1) % this.limit;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt: number) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const d = 1 - this.drag[i] * dt;
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k;
      this.alpha[i] = Math.min(1, k * 2.2);
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Tracer { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; life: number; r: number; g: number; b: number }
interface Ring { mesh: THREE.Mesh; t: number; life: number; r0: number; r1: number; speed: number }

const TRACERS = 128;

export class Fx {
  group = new THREE.Group();
  add: Particles;
  norm: Particles;
  private tracers: Tracer[] = [];
  private trGeo: THREE.BufferGeometry;
  private trPos = new Float32Array(TRACERS * 6);
  private trCol = new Float32Array(TRACERS * 6);
  private flashes: { mesh: THREE.Mesh; t: number; life: number; size: number }[] = [];
  private rings: Ring[] = [];
  private walls: Ring[] = [];
  private muzzle: THREE.Sprite[] = [];
  muzzleLight: THREE.PointLight;
  private muzzleT = 0;
  /* đạn bay */
  private banana: THREE.InstancedMesh;
  private grenade: THREE.InstancedMesh;
  private barrel: THREE.InstancedMesh;
  private shell: THREE.InstancedMesh;
  /** đạn pháo chuối của mình (dự đoán, chỉ để nhìn) */
  ownShells: { x: number; y: number; z: number; dx: number; dy: number; dz: number; dist: number; t: number; boom: boolean }[] = [];
  /* thực thể */
  private ents = new Map<number, THREE.Group>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private tmp = new Float64Array(3);
  onShellBoom: (x: number, y: number, z: number) => void = () => {};

  constructor(limit: number) {
    const dt = dotTex();
    this.add = new Particles(1200, true, dt);
    this.norm = new Particles(900, false, dt);
    this.setLimit(limit);
    this.group.add(this.add.points, this.norm.points);
    this.trGeo = new THREE.BufferGeometry();
    this.trGeo.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trGeo.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3).setUsage(THREE.DynamicDrawUsage));
    const tl = new THREE.LineSegments(this.trGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    tl.frustumCulled = false;
    this.group.add(tl);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.flashes.push({ mesh: m, t: 0, life: 0, size: 1 });
    }
    const rg = new THREE.RingGeometry(0.85, 1, 48);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 0, life: 0, r0: 0, r1: 1, speed: 0 });
    }
    const wg = new THREE.CylinderGeometry(1, 1, 0.9, 48, 1, true);
    wg.translate(0, 0.45, 0);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      this.group.add(m);
      this.walls.push({ mesh: m, t: 0, life: 0, r0: 0, r1: SHOCK_MAX, speed: SHOCK_SPEED });
    }
    const ft = flameTex();
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ft, color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.visible = false;
      sp.userData.t = 0;
      this.group.add(sp);
      this.muzzle.push(sp);
    }
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 2);
    this.group.add(this.muzzleLight);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
      return m;
    };
    this.banana = inst(new THREE.TorusGeometry(0.2, 0.07, 6, 10, Math.PI * 0.9), new THREE.MeshLambertMaterial({ color: 0xffe14a, emissive: 0x443300 }), 64);
    this.grenade = inst(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3f5f2a, emissive: 0x220000 }), 32);
    this.barrel = inst(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }), 16);
    this.shell = inst(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff27a }), 16);
  }

  setLimit(n: number) {
    this.add.limit = Math.max(50, Math.min(1200, n));
    this.norm.limit = Math.max(50, Math.min(900, Math.round(n * 0.7)));
  }

  setScale(px: number) {
    this.add.mat.uniforms.uScale.value = px;
    this.norm.mat.uniforms.uScale.value = px;
  }

  /* ======================= BỘ PHÁT ======================= */
  sparks(x: number, y: number, z: number, n: number, r = 1, g = 0.8, b = 0.4, speed = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      const c = Math.sqrt(1 - u * u);
      this.add.spawn(x, y, z, Math.cos(a) * c * s, u * s + 2, Math.sin(a) * c * s, 0.18 + Math.random() * 0.2, 0.07, 0.02, r, g, b, 14, 2);
    }
  }

  fur(x: number, y: number, z: number, color: number, n = 6) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      this.norm.spawn(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3 + 0.5, (Math.random() - 0.5) * 4, 0.45 + Math.random() * 0.3, 0.16, 0.05, c.r, c.g, c.b, 6, 3);
    }
  }

  dust(x: number, z: number, radius: number, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const s = 2 + Math.random() * 3;
      this.norm.spawn(x + Math.cos(a) * radius * 0.3, 0.2, z + Math.sin(a) * radius * 0.3, Math.cos(a) * s, 0.6 + Math.random(), Math.sin(a) * s, 0.7 + Math.random() * 0.4, 0.5, 1.2, 0.62, 0.53, 0.4, 0.5, 2.5);
    }
  }

  explosion(x: number, z: number, r: number) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * r * 2;
      this.add.spawn(x, 0.6, z, Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s, 0.35 + Math.random() * 0.35, 0.9, 0.2, 1, 0.55 + Math.random() * 0.3, 0.15, 3, 2.5);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.5 + Math.random() * 2;
      this.norm.spawn(x, 0.8, z, Math.cos(a) * s, 1.5 + Math.random() * 2, Math.sin(a) * s, 1.1 + Math.random() * 0.6, 0.7, 2, 0.32, 0.3, 0.28, -0.6, 1.5);
    }
    this.sparks(x, 0.5, z, 16, 1, 0.75, 0.3, 12);
    const f = this.flashes.find((q) => q.t >= q.life) ?? this.flashes[0];
    f.t = 0;
    f.life = 0.28;
    f.size = r * 0.8;
    f.mesh.position.set(x, 0.7, z);
    f.mesh.visible = true;
    this.ring(x, z, 0.3, r * 1.3, 0.35, 0xffa040);
  }

  ring(x: number, z: number, r0: number, r1: number, life: number, color: number) {
    const g = this.rings.find((q) => q.t >= q.life) ?? this.rings[0];
    g.t = 0;
    g.life = life;
    g.r0 = r0;
    g.r1 = r1;
    g.mesh.position.set(x, 0.08, z);
    (g.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    g.mesh.visible = true;
  }

  shockwave(x: number, z: number) {
    const w = this.walls.find((q) => q.t >= q.life) ?? this.walls[0];
    w.t = 0;
    w.life = SHOCK_MAX / SHOCK_SPEED;
    w.mesh.position.set(x, 0, z);
    w.mesh.visible = true;
    this.dust(x, z, 3, 20);
  }

  heal(x: number, z: number) {
    for (let i = 0; i < 16; i++) {
      this.add.spawn(x + (Math.random() - 0.5) * 1.2, 0.3 + Math.random(), z + (Math.random() - 0.5) * 1.2, 0, 1.5 + Math.random() * 1.5, 0, 0.9, 0.2, 0.05, 0.3, 1, 0.45, -0.5, 1);
    }
    this.ring(x, z, 0.2, 1.6, 0.5, 0x40ff80);
  }

  coins(x: number, y: number, z: number, n = 5) {
    for (let i = 0; i < n; i++) {
      this.add.spawn(x, y, z, (Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.6, 0.14, 0.1, 1, 0.85, 0.2, 12, 1);
    }
  }

  /** vệt đạn */
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, life = 0.07) {
    if (this.tracers.length >= TRACERS) this.tracers.shift();
    const c = new THREE.Color(color);
    this.tracers.push({ x0, y0, z0, x1, y1, z1, t: 0, life, r: c.r, g: c.g, b: c.b });
  }

  muzzleFlash(p: THREE.Vector3, own: boolean, big = false) {
    const sp = this.muzzle.find((s) => !s.visible) ?? this.muzzle[0];
    sp.position.copy(p);
    const s = big ? 0.9 : 0.55;
    sp.scale.set(s, s, s);
    sp.material.rotation = Math.random() * 6;
    sp.visible = true;
    sp.userData.t = 0;
    if (own) {
      this.muzzleLight.position.copy(p);
      this.muzzleLight.intensity = 6;
      this.muzzleT = 0.05;
    }
  }

  /* ======================= CẬP NHẬT ======================= */
  update(m: GameModel | null, dt: number, t: number) {
    this.add.update(dt);
    this.norm.update(dt);
    // vệt đạn
    let k = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      if (tr.t >= tr.life) this.tracers.splice(i, 1);
    }
    for (const tr of this.tracers) {
      const a = 1 - tr.t / tr.life;
      // đuôi vệt chạy theo đầu đạn
      const h = Math.min(1, tr.t / tr.life + 0.35);
      const tl = Math.max(0, h - 0.45);
      this.trPos[k * 6] = tr.x0 + (tr.x1 - tr.x0) * tl;
      this.trPos[k * 6 + 1] = tr.y0 + (tr.y1 - tr.y0) * tl;
      this.trPos[k * 6 + 2] = tr.z0 + (tr.z1 - tr.z0) * tl;
      this.trPos[k * 6 + 3] = tr.x0 + (tr.x1 - tr.x0) * h;
      this.trPos[k * 6 + 4] = tr.y0 + (tr.y1 - tr.y0) * h;
      this.trPos[k * 6 + 5] = tr.z0 + (tr.z1 - tr.z0) * h;
      for (let j = 0; j < 2; j++) {
        const f = j === 0 ? a * 0.3 : a;
        this.trCol[k * 6 + j * 3] = tr.r * f;
        this.trCol[k * 6 + j * 3 + 1] = tr.g * f;
        this.trCol[k * 6 + j * 3 + 2] = tr.b * f;
      }
      k++;
    }
    this.trGeo.setDrawRange(0, k * 2);
    (this.trGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    // chớp nổ
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      if (f.t >= f.life) { f.mesh.visible = false; continue; }
      const p = f.t / f.life;
      f.mesh.scale.setScalar(f.size * (0.4 + p * 1.2));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    }
    for (const g of this.rings) {
      if (!g.mesh.visible) continue;
      g.t += dt;
      if (g.t >= g.life) { g.mesh.visible = false; continue; }
      const p = g.t / g.life;
      const r = g.r0 + (g.r1 - g.r0) * (1 - (1 - p) * (1 - p));
      g.mesh.scale.set(r, 1, r);
      (g.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    }
    for (const w of this.walls) {
      if (!w.mesh.visible) continue;
      w.t += dt;
      if (w.t >= w.life) { w.mesh.visible = false; continue; }
      const r = Math.max(0.3, w.t * SHOCK_SPEED);
      w.mesh.scale.set(r, 1 + Math.sin(t * 30) * 0.1, r);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - w.t / w.life) + 0.15;
    }
    for (const sp of this.muzzle) {
      if (!sp.visible) continue;
      sp.userData.t += dt;
      if (sp.userData.t > 0.05) sp.visible = false;
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzleLight.intensity = 0;
    }
    if (m) {
      this.updateProjectiles(m, dt, t);
      this.updateEnts(m, t, dt);
    }
  }

  private updateProjectiles(m: GameModel, dt: number, t: number) {
    let nb = 0, ng = 0, nr = 0, ns = 0;
    for (const p of m.projectiles) {
      if (!m.projectilePos(p, PROJ_G, this.tmp)) continue;
      let x = this.tmp[0], y = this.tmp[1], z = this.tmp[2];
      if (p.kind === PJ_GRENADE) {
        // lựu đạn: server cho lăn trên đất; ở client chỉ vẽ cung bay rồi nằm yên
        const age = (m.renderTick - p.tick) * 0.05;
        const tl = p.vy / PROJ_G + Math.sqrt(Math.max(0, (p.vy * p.vy) / (PROJ_G * PROJ_G) + (2 * (p.y - 0.15)) / PROJ_G));
        if (age > tl) {
          x = p.x + p.vx * tl;
          z = p.z + p.vz * tl;
          y = 0.15;
        }
        if (ng < 32) {
          this.e.set(t * 8, t * 5, 0);
          this.q.setFromEuler(this.e);
          this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1));
          this.grenade.setMatrixAt(ng++, this.m4);
          if (Math.sin(t * 25) > 0.6) this.add.spawn(x, y + 0.15, z, 0, 0.5, 0, 0.08, 0.25, 0.1, 1, 0.2, 0.1);
        }
      } else if (p.kind === PJ_BANANA && nb < 64) {
        this.e.set(t * 14, t * 9, 0);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1));
        this.banana.setMatrixAt(nb++, this.m4);
      } else if (p.kind === PJ_BARREL && nr < 16) {
        this.e.set(t * 6, 0, t * 4);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1));
        this.barrel.setMatrixAt(nr++, this.m4);
      }
    }
    // đạn pháo chuối của mình (bay nhanh tới điểm chạm)
    for (let i = this.ownShells.length - 1; i >= 0; i--) {
      const s = this.ownShells[i];
      s.t += dt;
      const d = s.t * 90;
      if (d >= s.dist) {
        this.ownShells.splice(i, 1);
        this.onShellBoom(s.x + s.dx * s.dist, s.y + s.dy * s.dist, s.z + s.dz * s.dist);
        continue;
      }
      if (ns < 16) {
        const x = s.x + s.dx * d, y = s.y + s.dy * d, z = s.z + s.dz * d;
        this.m4.makeTranslation(x, y, z);
        this.shell.setMatrixAt(ns++, this.m4);
        this.add.spawn(x, y, z, 0, 0.3, 0, 0.25, 0.3, 0.05, 1, 0.8, 0.3);
      }
    }
    this.banana.count = nb;
    this.grenade.count = ng;
    this.barrel.count = nr;
    this.shell.count = ns;
    this.banana.instanceMatrix.needsUpdate = true;
    this.grenade.instanceMatrix.needsUpdate = true;
    this.barrel.instanceMatrix.needsUpdate = true;
    this.shell.instanceMatrix.needsUpdate = true;
  }

  /** mesh trụ súng theo vị trí trong danh sách (vệt đạn của trụ) */
  turretMuzzle(index: number, out: THREE.Vector3): boolean {
    let i = 0;
    for (const g of this.ents.values()) {
      if (i++ === index) {
        if (g.userData.kind !== EN_TURRET) return false;
        const head = g.userData.head as THREE.Object3D;
        g.updateMatrixWorld(true);
        out.set(0, 0.05, 0.75);
        head.localToWorld(out);
        return true;
      }
    }
    return false;
  }

  private updateEnts(m: GameModel, t: number, dt: number) {
    const seen = new Set<number>();
    for (const e of m.entities) {
      seen.add(e.id);
      let g = this.ents.get(e.id);
      if (!g) {
        g = this.buildEnt(e.kind, e.owner);
        g.userData.kind = e.kind;
        g.userData.born = t;
        this.ents.set(e.id, g);
        this.group.add(g);
      }
      g.position.set(e.x, 0, e.z);
      const age = t - g.userData.born;
      const pop = Math.min(1, age * 4);
      if (e.kind === EN_TURRET) {
        const head = g.userData.head as THREE.Object3D;
        let d = e.yaw - head.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        head.rotation.y += d * Math.min(1, dt * 14);
        g.scale.setScalar(pop);
      } else if (e.kind === EN_BARRICADE) {
        g.rotation.y = e.yaw;
        g.scale.set(1, pop, 1);
      } else if (e.kind === EN_POD) {
        const ring = g.userData.ring as THREE.Mesh;
        const s = 4.5 * (0.95 + Math.sin(t * 3) * 0.05);
        ring.scale.set(s, 1, s);
        (g.userData.dome as THREE.Mesh).position.y = 0.4 + Math.sin(t * 2) * 0.08;
        if (Math.random() < dt * 12) this.add.spawn(e.x + (Math.random() - 0.5) * 6, 0.1, e.z + (Math.random() - 0.5) * 6, 0, 1.2, 0, 1, 0.15, 0.05, 0.3, 1, 0.5);
      } else if (e.kind === EN_FLARE) {
        if (Math.random() < dt * 40) this.norm.spawn(e.x, 0.3, e.z, (Math.random() - 0.5) * 0.4, 3 + Math.random() * 2, (Math.random() - 0.5) * 0.4, 1.4, 0.4, 1.4, 0.95, 0.25, 0.2, -0.5, 0.5);
        (g.userData.light as THREE.Mesh).visible = Math.sin(t * 30) > 0;
      } else if (e.kind === EN_PICKUP) {
        const item = g.userData.item as THREE.Object3D;
        item.position.y = 0.6 + Math.sin(t * 3 + e.id) * 0.15;
        item.rotation.y = t * 2;
        g.visible = e.life > 3 || Math.sin(t * 16) > 0;
      }
      if (e.life <= 3 && e.kind !== EN_PICKUP && e.kind !== EN_FLARE) g.visible = Math.sin(t * 12) > -0.3;
      else if (e.kind !== EN_PICKUP) g.visible = true;
    }
    for (const [id, g] of this.ents) {
      if (!seen.has(id)) {
        this.group.remove(g);
        g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        this.ents.delete(id);
        if (g.userData.kind !== EN_PICKUP && g.userData.kind !== EN_FLARE) this.dust(g.position.x, g.position.z, 1, 8);
      }
    }
  }

  private buildEnt(kind: number, owner: number): THREE.Group {
    const g = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x4b5563 });
    const orange = new THREE.MeshLambertMaterial({ color: 0xf97316 });
    if (kind === EN_TURRET) {
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1, 5), metal);
        const a = (i / 3) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3);
        leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
        g.add(leg);
      }
      const head = new THREE.Group();
      head.position.y = 1.0;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.5), orange);
      box.castShadow = true;
      head.add(box);
      for (const s of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), metal);
        b.rotation.x = Math.PI / 2;
        b.position.set(0.1 * s, 0.03, 0.45);
        head.add(b);
      }
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
      eye.position.set(0, 0.1, 0.26);
      head.add(eye);
      g.add(head);
      g.userData.head = head;
    } else if (kind === EN_BARRICADE) {
      const bamboo = new THREE.MeshLambertMaterial({ color: 0xa3b84a });
      for (let i = 0; i < 9; i++) {
        const h = 1 + (i % 3) * 0.2;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, h, 6), bamboo);
        p.position.set(-2 + i * 0.5, h / 2, 0);
        p.castShadow = true;
        g.add(p);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 6), bamboo);
        tip.position.set(-2 + i * 0.5, h + 0.12, 0);
        g.add(tip);
      }
      for (const y of [0.35, 0.8]) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 6), new THREE.MeshLambertMaterial({ color: 0x7c5a2b }));
        r.rotation.z = Math.PI / 2;
        r.position.set(0, y, 0.08);
        g.add(r);
      }
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.8), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.12, depthWrite: false }));
      zone.rotation.x = -Math.PI / 2;
      zone.position.y = 0.05;
      g.add(zone);
    } else if (kind === EN_POD) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x16a34a, emissiveIntensity: 0.6 }));
      g.add(dome);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
      cross.position.y = 0.95;
      const c2 = cross.clone();
      c2.rotation.z = Math.PI / 2;
      cross.add(c2);
      dome.add(cross);
      const rg = new THREE.RingGeometry(0.94, 1, 48);
      rg.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.y = 0.05;
      g.add(ring);
      g.userData.ring = ring;
      g.userData.dome = dome;
    } else if (kind === EN_FLARE) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0xdc2626 }));
      stick.position.y = 0.2;
      g.add(stick);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
      light.position.y = 0.45;
      g.add(light);
      g.userData.light = light;
    } else if (kind === EN_PICKUP) {
      const item = new THREE.Group();
      if (owner === 0) {
        const mat = new THREE.MeshLambertMaterial({ color: 0xffe14a, emissive: 0x554400 });
        for (let i = 0; i < 4; i++) {
          const b = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 10, Math.PI * 0.8), mat);
          b.rotation.set(0, (i * Math.PI) / 2, 1.2);
          item.add(b);
        }
      } else {
        const bag = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
        item.add(bag);
        const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 14), new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x664400, metalness: 0.8, roughness: 0.3 }));
        coin.rotation.x = Math.PI / 2;
        coin.position.set(0, 0.05, 0.28);
        item.add(coin);
      }
      g.add(item);
      g.userData.item = item;
      const rg = new THREE.RingGeometry(0.4, 0.55, 24);
      rg.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: owner === 0 ? 0xfff27a : 0xffb020, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.y = 0.04;
      g.add(ring);
    }
    return g;
  }

  /** dọn khi rời trận */
  clear() {
    for (const g of this.ents.values()) this.group.remove(g);
    this.ents.clear();
    this.tracers.length = 0;
    this.ownShells.length = 0;
  }
}
