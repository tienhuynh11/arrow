// Vẽ bầy khỉ bằng InstancedMesh theo BỘ PHẬN (thân, đầu, tay, chân, đuôi…): mỗi bộ phận 1 draw call
// cho cả bầy, hoạt cảnh procedural (chạy, vung tay, ném, vồ, choáng, gầm, ngã chết) không cần model.

import * as THREE from 'three';
import { MAX_MONKEYS } from '@shared/monkey/config';
import { MK_CHAY, MK_CON, MK_DOT, MK_NEM, MK_NO, MK_TRANG, MK_VUA, MONKEYS, BOMB_RADIUS } from '@shared/monkey/content';
import type { GameModel } from '@shared/monkey/client';
import {
  ST_DROP, ST_FUSE, ST_MOVE, ST_POUNCE, ST_ROAR, ST_SLAM, ST_STRIKE, ST_STUN, ST_THROW, ST_WIND, STX_SLOW, STX_TAUNT,
} from '@shared/monkey/proto';
import { blobTex } from './scene';

const CAP = MAX_MONKEYS + 48;

interface Part {
  mesh: THREE.InstancedMesh;
  n: number;
  /** dùng màu thân (0), màu bụng (1), cố định (2) */
  tint: number;
}

const WHITE = new THREE.Color(1, 1, 1);
const RED = new THREE.Color(1, 0.15, 0.1);
const SLOWC = new THREE.Color(0.55, 0.75, 1);

export class MonkeyRenderer {
  group = new THREE.Group();
  private parts: Record<string, Part> = {};
  private root = new THREE.Object3D();
  private torso = new THREE.Object3D();
  private belly = new THREE.Object3D();
  private head = new THREE.Object3D();
  private muzzle = new THREE.Object3D();
  private eyeL = new THREE.Object3D();
  private eyeR = new THREE.Object3D();
  private earL = new THREE.Object3D();
  private earR = new THREE.Object3D();
  private crown = new THREE.Object3D();
  private armL = new THREE.Object3D();
  private armR = new THREE.Object3D();
  private banana = new THREE.Object3D();
  private legL = new THREE.Object3D();
  private legR = new THREE.Object3D();
  private tail = new THREE.Object3D();
  private bomb = new THREE.Object3D();
  private blob: THREE.InstancedMesh;
  private blobN = 0;
  private tele: THREE.InstancedMesh;
  private teleN = 0;
  private barBg: THREE.InstancedMesh;
  private barFg: THREE.InstancedMesh;
  private barN = 0;
  /* trạng thái hoạt cảnh theo slot */
  private phase = new Float32Array(MAX_MONKEYS);
  private stSince = new Float32Array(MAX_MONKEYS);
  private prevSt = new Uint8Array(MAX_MONKEYS).fill(255);
  private seenAt = new Float32Array(MAX_MONKEYS);
  private wasVisible = new Uint8Array(MAX_MONKEYS);
  private hpShowUntil = new Float32Array(MAX_MONKEYS);
  private prevHp = new Uint8Array(MAX_MONKEYS);
  detail = true;
  /** gọi khi khỉ đổi trạng thái (âm thanh) */
  onState: (slot: number, st: number, x: number, z: number) => void = () => {};
  private col = new THREE.Color();
  private col2 = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private left = new THREE.Vector3();

  constructor() {
    const mat = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mk = (name: string, geo: THREE.BufferGeometry, perMonkey: number, tint: number, material?: THREE.Material) => {
      const m = new THREE.InstancedMesh(geo, material ?? mat(), CAP * perMonkey);
      m.frustumCulled = false;
      m.castShadow = name === 'torso' || name === 'head';
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.parts[name] = { mesh: m, n: 0, tint };
      this.group.add(m);
    };
    const capsule = (r: number, len: number) => {
      const g = new THREE.CapsuleGeometry(r, len, 3, 7);
      g.translate(0, -(len / 2 + r * 0.6), 0);
      return g;
    };
    mk('torso', new THREE.SphereGeometry(0.42, 12, 10), 1, 0);
    mk('belly', new THREE.SphereGeometry(0.29, 10, 8), 1, 1);
    mk('head', new THREE.SphereGeometry(0.3, 12, 10), 1, 0);
    mk('muzzle', new THREE.SphereGeometry(0.2, 10, 8), 1, 1);
    mk('ear', new THREE.SphereGeometry(0.11, 8, 6), 2, 1);
    mk('eye', new THREE.SphereGeometry(0.055, 6, 5), 2, 2, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mk('arm', capsule(0.085, 0.48), 2, 0);
    mk('leg', capsule(0.1, 0.24), 2, 0);
    const tg = new THREE.CapsuleGeometry(0.05, 0.55, 2, 5);
    tg.translate(0, 0.33, 0);
    mk('tail', tg, 1, 0);
    mk('banana', new THREE.TorusGeometry(0.16, 0.05, 6, 10, Math.PI * 0.9), 1, 2, new THREE.MeshLambertMaterial({ color: 0xffe14a, emissive: 0x332200 }));
    mk('bomb', new THREE.SphereGeometry(0.24, 10, 8), 1, 2, new THREE.MeshLambertMaterial({ color: 0x222222 }));
    mk('crown', new THREE.CylinderGeometry(0.2, 0.25, 0.2, 6, 1, true), 1, 2, new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x664400, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));

    // khung xương
    this.root.add(this.torso, this.head, this.armL, this.armR, this.legL, this.legR, this.tail, this.bomb);
    this.torso.add(this.belly);
    this.head.add(this.muzzle, this.eyeL, this.eyeR, this.earL, this.earR, this.crown);
    this.armR.add(this.banana);
    this.torso.position.set(0, 0.62, 0);
    this.torso.scale.set(1, 1.1, 0.9);
    this.belly.position.set(0, -0.04, 0.24);
    this.head.position.set(0, 1.18, 0.05);
    this.muzzle.position.set(0, -0.07, 0.22);
    this.muzzle.scale.set(1.25, 0.9, 0.85);
    this.eyeL.position.set(-0.1, 0.07, 0.25);
    this.eyeR.position.set(0.1, 0.07, 0.25);
    this.earL.position.set(-0.3, 0.03, 0);
    this.earR.position.set(0.3, 0.03, 0);
    this.earL.scale.set(1, 1, 0.5);
    this.earR.scale.set(1, 1, 0.5);
    this.crown.position.set(0, 0.32, 0);
    this.armL.position.set(-0.36, 0.9, 0.05);
    this.armR.position.set(0.36, 0.9, 0.05);
    this.banana.position.set(0, -0.68, 0.08);
    this.banana.rotation.set(0, 0, 1.2);
    this.legL.position.set(-0.17, 0.36, 0);
    this.legR.position.set(0.17, 0.36, 0);
    this.tail.position.set(0, 0.42, -0.32);
    this.bomb.position.set(0, 0.8, -0.38);

    const bt = blobTex();
    const bg = new THREE.PlaneGeometry(1, 1);
    bg.rotateX(-Math.PI / 2);
    this.blob = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false }), CAP);
    this.blob.frustumCulled = false;
    this.blob.renderOrder = 1;
    this.group.add(this.blob);
    const rg = new THREE.RingGeometry(0.82, 1, 40);
    rg.rotateX(-Math.PI / 2);
    this.tele = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }), 64);
    this.tele.frustumCulled = false;
    this.group.add(this.tele);
    const pg = new THREE.PlaneGeometry(1, 0.11);
    this.barBg = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthTest: false }), CAP);
    const pg2 = new THREE.PlaneGeometry(1, 0.11);
    pg2.translate(0.5, 0, 0);
    this.barFg = new THREE.InstancedMesh(pg2, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), CAP);
    this.barBg.frustumCulled = this.barFg.frustumCulled = false;
    this.barBg.renderOrder = 10;
    this.barFg.renderOrder = 11;
    this.group.add(this.barBg, this.barFg);
  }

  private put(name: string, obj: THREE.Object3D, c: THREE.Color | null) {
    const p = this.parts[name];
    if (p.n >= p.mesh.instanceMatrix.count) return;
    p.mesh.setMatrixAt(p.n, obj.matrixWorld);
    if (c) p.mesh.setColorAt(p.n, c);
    p.n++;
  }

  private resetPose() {
    this.root.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.head.position.set(0, 1.18, 0.05);
    this.armL.rotation.set(0, 0, 0.12);
    this.armR.rotation.set(0, 0, -0.12);
    this.armL.scale.set(1, 1, 1);
    this.armR.scale.set(1, 1, 1);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.tail.rotation.set(-1.0, 0, 0);
    this.tail.scale.set(1, 1, 1);
  }

  /** dựng tư thế + ghi instance cho một con khỉ */
  private drawOne(type: number, x: number, y: number, z: number, yaw: number, st: number, phase: number, stT: number, speed: number, t: number, flash: number, extra: number, dist: number, hpFrac: number, camQ: THREE.Quaternion, showBar: boolean) {
    const def = MONKEYS[type];
    const S = def.scale;
    this.resetPose();
    const big = type === MK_DOT || type === MK_VUA;
    if (big) {
      this.armL.scale.set(1.6, 1.15, 1.6);
      this.armR.scale.set(1.6, 1.15, 1.6);
      this.tail.scale.set(0, 0, 0);
    }
    // ---- hoạt cảnh ----
    const run = Math.min(1, speed / 3);
    const sw = Math.sin(phase);
    let lean = 0;
    let bob = 0;
    switch (st & 15) {
      case ST_MOVE:
      case ST_DROP: {
        if (type === MK_CHAY || (big && speed > 2)) {
          // phi bằng bốn chân (đặc trưng khỉ chạy nhanh / khỉ đột)
          lean = 0.55 * run;
          this.armL.rotation.x = -0.9 * run + sw * 0.9 * run;
          this.armR.rotation.x = -0.9 * run - sw * 0.9 * run;
        } else {
          lean = 0.18 * run;
          this.armL.rotation.x = -sw * 0.8 * run - 0.2;
          this.armR.rotation.x = sw * 0.8 * run - 0.2;
        }
        this.legL.rotation.x = sw * 0.9 * run;
        this.legR.rotation.x = -sw * 0.9 * run;
        bob = Math.abs(Math.cos(phase)) * 0.08 * run;
        this.tail.rotation.z = Math.sin(t * 3 + x) * 0.4;
        if (run < 0.1) {
          // đứng thở + gãi đầu
          this.armR.rotation.x = -0.4 + Math.sin(t * 2 + z) * 0.15;
          bob = Math.sin(t * 3 + x) * 0.02;
        }
        if (type === MK_NEM) this.armR.rotation.x = -0.6;
        break;
      }
      case ST_WIND:
      case ST_SLAM: {
        const k = Math.min(1, stT / 0.3);
        this.armL.rotation.x = -2.6 * k;
        this.armR.rotation.x = -2.6 * k;
        this.armL.rotation.z = 0.3 * k;
        this.armR.rotation.z = -0.3 * k;
        lean = -0.25 * k;
        this.head.rotation.x = -0.3 * k;
        break;
      }
      case ST_STRIKE: {
        const k = Math.min(1, stT / 0.12);
        this.armL.rotation.x = -2.6 + 3.4 * k;
        this.armR.rotation.x = -2.6 + 3.4 * k;
        lean = 0.45 * k;
        break;
      }
      case ST_THROW: {
        const k = Math.min(1, stT / 0.45);
        this.armR.rotation.x = k < 0.8 ? -2.8 * (k / 0.8) : -2.8 + 3.6 * ((k - 0.8) / 0.2);
        this.armL.rotation.x = -0.6;
        lean = -0.2 + 0.4 * k;
        break;
      }
      case ST_STUN: {
        this.root.rotation.z = Math.sin(t * 18) * 0.18;
        this.head.rotation.y = Math.sin(t * 9) * 0.5;
        this.armL.rotation.z = 0.9;
        this.armR.rotation.z = -0.9;
        break;
      }
      case ST_FUSE: {
        this.root.rotation.z = Math.sin(t * 40) * 0.08;
        this.armL.rotation.x = -3;
        this.armR.rotation.x = -3;
        lean = 0.2;
        break;
      }
      case ST_POUNCE: {
        lean = 1.25;
        this.armL.rotation.x = -2.9;
        this.armR.rotation.x = -2.9;
        this.legL.rotation.x = 0.9;
        this.legR.rotation.x = 0.9;
        bob = 0.5;
        break;
      }
      case ST_ROAR: {
        // đấm ngực
        const b = Math.sin(t * 22);
        this.armL.rotation.x = -1.4 + b * 0.5;
        this.armR.rotation.x = -1.4 - b * 0.5;
        this.armL.rotation.y = 0.8;
        this.armR.rotation.y = -0.8;
        this.head.rotation.x = -0.5;
        lean = -0.2;
        break;
      }
    }
    if (big) lean += 0.25;
    this.torso.rotation.x = lean;
    this.head.position.z = 0.05 + lean * 0.35;
    this.head.position.y = 1.18 - lean * 0.15 - (big ? 0.12 : 0);
    // ---- gốc ----
    this.root.position.set(x, y + bob * S, z);
    this.root.rotation.y = yaw;
    if (extra > 0) {
      // xác chết: ngã ngửa
      this.root.rotation.x = -Math.min(1.45, extra * 6);
      this.root.position.y = y - Math.max(0, extra - 0.9) * 0.9;
    }
    const sink = extra > 1.2 ? Math.max(0.01, 1 - (extra - 1.2) / 0.4) : 1;
    this.root.scale.set(S * sink, S * sink, S * sink);
    this.root.updateMatrixWorld(true);

    // ---- màu ----
    const body = this.col.setHex(def.color);
    const bel = this.col2.setHex(def.belly);
    if ((st & 15) === ST_FUSE) {
      const blink = Math.sin(t * 30) > 0 ? 1 : 0;
      body.lerp(WHITE, blink * 0.6);
    }
    if (st & STX_SLOW) {
      body.lerp(SLOWC, 0.35);
      bel.lerp(SLOWC, 0.35);
    }
    if (flash > 0) {
      body.lerp(WHITE, flash);
      bel.lerp(WHITE, flash);
    }
    this.put('torso', this.torso, body);
    this.put('head', this.head, body);
    this.put('arm', this.armL, body);
    this.put('arm', this.armR, body);
    this.put('leg', this.legL, body);
    this.put('leg', this.legR, body);
    if (!big) this.put('tail', this.tail, body);
    const near = dist < 32 || !this.detail;
    if (near || this.detail) {
      this.put('belly', this.belly, bel);
      this.put('muzzle', this.muzzle, bel);
    }
    if (dist < 40) {
      this.put('ear', this.earL, bel);
      this.put('ear', this.earR, bel);
      const eyeC = type === MK_NO || type === MK_VUA || (st & STX_TAUNT) ? RED : type === MK_TRANG ? this.col.setHex(0x55ccff) : this.col.setHex(0x111111);
      this.put('eye', this.eyeL, eyeC);
      this.put('eye', this.eyeR, eyeC);
    }
    if (type === MK_NEM && (st & 15) !== ST_STRIKE) this.put('banana', this.banana, null);
    if (type === MK_NO) this.put('bomb', this.bomb, null);
    if (type === MK_VUA) this.put('crown', this.crown, null);

    // ---- bóng ----
    if (this.blobN < CAP) {
      const r = def.r * 2.6 * (extra > 0 ? sink : 1);
      this.m4.makeScale(r, 1, r);
      this.m4.setPosition(x, 0.03, z);
      this.blob.setMatrixAt(this.blobN++, this.m4);
    }
    // ---- vạch máu (khỉ bị thương) ----
    if (showBar && this.barN < CAP && hpFrac < 0.999 && extra === 0) {
      const w = type === MK_VUA ? 0 : big ? 1.2 : 0.75;
      if (w > 0) {
        const hy = y + 1.65 * S + 0.25;
        this.v.set(x, hy, z);
        this.s.set(w, 1, 1);
        this.m4.compose(this.v, camQ, this.s);
        this.barBg.setMatrixAt(this.barN, this.m4);
        // phần đỏ: dịch về mép trái
        this.s.set(w * hpFrac, 1, 1);
        this.left.set(-w / 2, 0, 0).applyQuaternion(camQ);
        this.v.add(this.left);
        this.m4.compose(this.v, camQ, this.s);
        this.barFg.setMatrixAt(this.barN, this.m4);
        this.col.setRGB(1 - hpFrac * 0.6, 0.2 + hpFrac * 0.7, 0.15);
        this.barFg.setColorAt(this.barN, this.col);
        this.barN++;
      }
    }
  }

  private teleRing(x: number, z: number, r: number, alpha: number) {
    if (this.teleN >= 64) return;
    const s = r * (0.92 + alpha * 0.08);
    this.m4.makeScale(s, 1, s);
    this.m4.setPosition(x, 0.06, z);
    this.tele.setMatrixAt(this.teleN++, this.m4);
  }

  update(m: GameModel, t: number, dt: number, camPos: THREE.Vector3, camQ: THREE.Quaternion) {
    for (const k in this.parts) this.parts[k].n = 0;
    this.blobN = 0;
    this.teleN = 0;
    this.barN = 0;
    for (let sl = 0; sl < MAX_MONKEYS; sl++) {
      if (!m.rmVisible[sl]) {
        this.wasVisible[sl] = 0;
        this.prevSt[sl] = 255;
        continue;
      }
      const type = m.mType[sl];
      const st = m.mSt[sl];
      const x = m.rmX[sl], z = m.rmZ[sl];
      if (!this.wasVisible[sl]) {
        this.wasVisible[sl] = 1;
        this.seenAt[sl] = t;
        this.phase[sl] = Math.random() * 6;
        this.prevHp[sl] = m.mHp[sl];
      }
      if ((st & 15) !== this.prevSt[sl]) {
        if (this.prevSt[sl] !== 255) this.onState(sl, st & 15, x, z);
        this.prevSt[sl] = st & 15;
        this.stSince[sl] = t;
      }
      if (m.mHp[sl] !== this.prevHp[sl]) {
        this.prevHp[sl] = m.mHp[sl];
        this.hpShowUntil[sl] = t + 3;
      }
      const sp = m.rmSpeed[sl];
      this.phase[sl] += dt * (4 + sp * 2.4) * (type === MK_CON ? 1.5 : 1) / Math.sqrt(MONKEYS[type].scale);
      let y = 0;
      const since = t - this.seenAt[sl];
      if ((st & 15) === ST_DROP && since < 0.55) y = 2.6 * (1 - since / 0.55) ** 2;
      const dx = x - camPos.x, dz = z - camPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const flash = Math.max(0, Math.min(1, m.mFlash[sl] / 90));
      this.drawOne(type, x, y, z, m.rmYaw[sl], st, this.phase[sl], t - this.stSince[sl], sp, t, flash, 0, dist, m.mHp[sl] / 255, camQ, t < this.hpShowUntil[sl] && dist < 30);
      // vòng cảnh báo đòn đánh
      const s4 = st & 15;
      const a = (Math.sin(t * 20) + 1) / 2;
      if (s4 === ST_FUSE) this.teleRing(x, z, BOMB_RADIUS, a);
      else if (s4 === ST_WIND && type === MK_DOT) this.teleRing(x + Math.sin(m.rmYaw[sl]) * 1.1, z + Math.cos(m.rmYaw[sl]) * 1.1, 2.6, a);
      else if (s4 === ST_SLAM) this.teleRing(x, z, 3.5, a);
    }
    // xác chết
    for (let i = m.corpses.length - 1; i >= 0; i--) {
      const c = m.corpses[i];
      c.t += dt;
      if (c.t > 1.6) {
        m.corpses.splice(i, 1);
        continue;
      }
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.vx *= 1 - dt * 5;
      c.vz *= 1 - dt * 5;
      this.drawOne(c.type, c.x, 0, c.z, c.yaw, ST_STUN, 0, 0, 0, t, Math.max(0, 1 - c.t * 6), Math.max(0.001, c.t), 10, 1, camQ, false);
    }
    for (const k in this.parts) {
      const p = this.parts[k];
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
    this.blob.count = this.blobN;
    this.blob.instanceMatrix.needsUpdate = true;
    this.tele.count = this.teleN;
    this.tele.instanceMatrix.needsUpdate = true;
    this.barBg.count = this.barFg.count = this.barN;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFg.instanceMatrix.needsUpdate = true;
    if (this.barFg.instanceColor) this.barFg.instanceColor.needsUpdate = true;
  }
}
