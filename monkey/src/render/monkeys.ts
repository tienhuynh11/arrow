// Bầy khỉ: khung xương có khớp (hông–ngực–cổ–đầu, vai–cánh tay–cẳng tay–bàn tay, đùi–cẳng chân–bàn chân, đuôi 3 đốt)
// dựng mỗi con bằng ~30 khối bầu dục bo tròn, NHƯNG cả bầy chỉ tốn vài draw call: mọi bộ phận "thịt" dùng chung
// một InstancedMesh (màu theo instance), mắt một mesh không chiếu sáng, phụ kiện (chuối, bom, vương miện, quầng sáng) riêng.
// Hoạt cảnh thủ tục, pha trộn mượt: đi/chạy hai chân, phi bốn chân (khỉ chạy, khỉ đột), vung tay, ném, vồ, choáng,
// sắp nổ (rung + phát sáng), gầm đấm ngực, rơi từ cây xuống, trúng đạn giật đầu, ngã chết văng.

import * as THREE from 'three';
import { MAX_MONKEYS } from '@shared/monkey/config';
import { BOMB_RADIUS, MK_CHAY, MK_CON, MK_DOT, MK_NAU, MK_NEM, MK_NO, MK_TRANG, MK_VUA, MONKEYS } from '@shared/monkey/content';
import type { GameModel } from '@shared/monkey/client';
import {
  ST_DROP, ST_FUSE, ST_MOVE, ST_POUNCE, ST_ROAR, ST_SLAM, ST_STRIKE, ST_STUN, ST_THROW, ST_WIND, STX_SLOW, STX_TAUNT,
} from '@shared/monkey/proto';
import { blobTex } from './scene';

const CAP = MAX_MONKEYS + 48;
const PARTS_PER = 34;

/** tỉ lệ cơ thể theo loài */
interface Build {
  chest: number; // bề ngang ngực
  arm: number; // độ dài tay
  armT: number; // độ dày tay
  leg: number;
  head: number;
  tail: number; // 0 = không đuôi
  hunch: number; // gù lưng khi đứng
  gallop: number; // 0..1: thiên về phi bốn chân khi chạy
  fluff: boolean;
}
const BUILDS: Build[] = [];
BUILDS[MK_NAU] = { chest: 1, arm: 1, armT: 1, leg: 1, head: 1, tail: 1, hunch: 0.2, gallop: 0.25, fluff: false };
BUILDS[MK_CHAY] = { chest: 0.88, arm: 1.05, armT: 0.85, leg: 1.12, head: 0.95, tail: 1.2, hunch: 0.25, gallop: 1, fluff: false };
BUILDS[MK_NEM] = { chest: 1, arm: 1.08, armT: 0.95, leg: 0.95, head: 1, tail: 1, hunch: 0.12, gallop: 0, fluff: false };
BUILDS[MK_NO] = { chest: 1.05, arm: 0.95, armT: 1, leg: 0.95, head: 1.05, tail: 0.9, hunch: 0.15, gallop: 0.3, fluff: false };
BUILDS[MK_TRANG] = { chest: 1.05, arm: 1, armT: 1.05, leg: 1.05, head: 1.05, tail: 1.1, hunch: 0.18, gallop: 0.6, fluff: true };
BUILDS[MK_DOT] = { chest: 1.5, arm: 1.3, armT: 1.55, leg: 0.78, head: 0.82, tail: 0, hunch: 0.55, gallop: 0.85, fluff: false };
BUILDS[MK_VUA] = { chest: 1.55, arm: 1.32, armT: 1.6, leg: 0.8, head: 0.85, tail: 0, hunch: 0.5, gallop: 0.7, fluff: true };
BUILDS[MK_CON] = { chest: 0.9, arm: 0.9, armT: 0.9, leg: 0.85, head: 1.3, tail: 1.1, hunch: 0.1, gallop: 0.4, fluff: false };

/* màu phụ */
const C_EYE = new THREE.Color(0xfdfdf5);
const C_PUPIL = new THREE.Color(0x15110f);
const C_RED_EYE = new THREE.Color(0xff3020);
const C_BLUE_EYE = new THREE.Color(0x48c8ff);
const C_MOUTH = new THREE.Color(0x4a1414);
const C_NOSE = new THREE.Color(0x2a1b14);
const C_WHITE = new THREE.Color(1, 1, 1);
const C_SLOW = new THREE.Color(0.55, 0.78, 1);
const C_HOT = new THREE.Color(1, 0.25, 0.1);

type Mat = 'fur' | 'skin' | 'dark' | 'mouth' | 'nose';

/** một nút khung xương: Object3D + (tuỳ) là một khối "thịt" cần vẽ */
interface Part { node: THREE.Object3D; mat: Mat; lod: number }

export class MonkeyRenderer {
  group = new THREE.Group();
  /* mesh dùng chung */
  private flesh: THREE.InstancedMesh;
  private eyes: THREE.InstancedMesh;
  private banana: THREE.InstancedMesh;
  private bomb: THREE.InstancedMesh;
  private crown: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private blob: THREE.InstancedMesh;
  private tele: THREE.InstancedMesh;
  private barBg: THREE.InstancedMesh;
  private barFg: THREE.InstancedMesh;
  private nF = 0;
  private nE = 0;
  private nBan = 0;
  private nBomb = 0;
  private nCrown = 0;
  private nGlow = 0;
  private nBlob = 0;
  private nTele = 0;
  private nBar = 0;

  /* khung xương (dùng lại cho mọi con) */
  private root = new THREE.Object3D();
  private pelvis = new THREE.Object3D();
  private chest = new THREE.Object3D();
  private head = new THREE.Object3D();
  private jaw = new THREE.Object3D();
  private shL = new THREE.Object3D();
  private shR = new THREE.Object3D();
  private elL = new THREE.Object3D();
  private elR = new THREE.Object3D();
  private hipL = new THREE.Object3D();
  private hipR = new THREE.Object3D();
  private knL = new THREE.Object3D();
  private knR = new THREE.Object3D();
  private t1 = new THREE.Object3D();
  private t2 = new THREE.Object3D();
  private t3 = new THREE.Object3D();
  private parts: Part[] = [];
  private eyeParts: { node: THREE.Object3D; kind: 'white' | 'pupil' | 'glint' }[] = [];
  private handR = new THREE.Object3D();
  private bombNode = new THREE.Object3D();
  private crownNode = new THREE.Object3D();
  private glowNode = new THREE.Object3D();
  private fluffParts: Part[] = [];
  private tailParts: Part[] = [];
  private mouthPart!: Part;
  /* các khối "thịt" cần chỉnh theo loài */
  private torsoM!: THREE.Object3D;
  private bellyM!: THREE.Object3D;
  private headM!: THREE.Object3D;
  private uaL!: THREE.Object3D; private uaR!: THREE.Object3D;
  private faL!: THREE.Object3D; private faR!: THREE.Object3D;
  private thL!: THREE.Object3D; private thR!: THREE.Object3D;
  private snL!: THREE.Object3D; private snR!: THREE.Object3D;

  /* trạng thái hoạt cảnh theo slot */
  private phase = new Float32Array(MAX_MONKEYS);
  private run = new Float32Array(MAX_MONKEYS);
  private gal = new Float32Array(MAX_MONKEYS);
  private stSince = new Float32Array(MAX_MONKEYS);
  private prevSt = new Uint8Array(MAX_MONKEYS).fill(255);
  private seenAt = new Float32Array(MAX_MONKEYS);
  private wasVisible = new Uint8Array(MAX_MONKEYS);
  private hpShowUntil = new Float32Array(MAX_MONKEYS);
  private prevHp = new Uint8Array(MAX_MONKEYS);
  private look = new Float32Array(MAX_MONKEYS);
  detail = true;
  onState: (slot: number, st: number, x: number, z: number) => void = () => {};

  private col = new THREE.Color();
  private furC = new THREE.Color();
  private skinC = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private left = new THREE.Vector3();

  constructor() {
    const sph = new THREE.SphereGeometry(1, 14, 10);
    const sphLo = new THREE.SphereGeometry(1, 8, 6);
    this.flesh = this.inst(sph, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 }), CAP * PARTS_PER, true);
    this.eyes = this.inst(sphLo, new THREE.MeshBasicMaterial({ color: 0xffffff }), CAP * 6, false);
    this.banana = this.inst(new THREE.TorusGeometry(0.17, 0.055, 7, 12, Math.PI * 0.9), new THREE.MeshStandardMaterial({ color: 0xffe14a, emissive: 0x3a2a00, roughness: 0.6 }), CAP, false);
    this.bomb = this.inst(new THREE.SphereGeometry(0.25, 12, 10), new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.35, metalness: 0.3 }), CAP, false);
    const crownG = new THREE.CylinderGeometry(0.24, 0.27, 0.2, 7, 1, true);
    this.crown = this.inst(crownG, new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0x6a4400, metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide }), 16, false);
    this.glow = this.inst(sphLo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), CAP, false);

    this.buildRig();

    const bg = new THREE.PlaneGeometry(1, 1);
    bg.rotateX(-Math.PI / 2);
    this.blob = this.inst(bg, new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }), CAP, false);
    this.blob.renderOrder = 1;
    const rg = new THREE.RingGeometry(0.82, 1, 48);
    rg.rotateX(-Math.PI / 2);
    this.tele = this.inst(rg, new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }), 64, false);
    const pg = new THREE.PlaneGeometry(1, 0.11);
    this.barBg = this.inst(pg, new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthTest: false }), CAP, false);
    const pg2 = new THREE.PlaneGeometry(1, 0.11);
    pg2.translate(0.5, 0, 0);
    this.barFg = this.inst(pg2, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), CAP, false);
    this.barBg.renderOrder = 10;
    this.barFg.renderOrder = 11;
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(m);
    return m;
  }

  /** khối bầu dục gắn vào khớp: vị trí, bán trục (sx,sy,sz) */
  private blobPart(parent: THREE.Object3D, mat: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, lod = 0, rx = 0): THREE.Object3D {
    const n = new THREE.Object3D();
    n.position.set(x, y, z);
    n.scale.set(sx, sy, sz);
    n.rotation.x = rx;
    parent.add(n);
    this.parts.push({ node: n, mat, lod });
    return n;
  }

  private buildRig() {
    const r = this.root;
    r.add(this.pelvis);
    this.pelvis.add(this.chest, this.hipL, this.hipR, this.t1);
    this.chest.add(this.head, this.shL, this.shR, this.bombNode, this.glowNode);
    this.head.add(this.jaw, this.crownNode);
    this.shL.add(this.elL);
    this.shR.add(this.elR);
    this.hipL.add(this.knL);
    this.hipR.add(this.knR);
    this.t1.add(this.t2);
    this.t2.add(this.t3);
    // --- thân ---
    this.blobPart(this.pelvis, 'fur', 0, 0.02, -0.02, 0.27, 0.22, 0.24);
    this.torsoM = this.blobPart(this.chest, 'fur', 0, 0.2, 0, 0.35, 0.33, 0.29);
    this.bellyM = this.blobPart(this.chest, 'skin', 0, 0.13, 0.16, 0.24, 0.24, 0.16);
    // --- đầu ---
    this.headM = this.blobPart(this.head, 'fur', 0, 0, 0, 0.29, 0.27, 0.27);
    this.blobPart(this.head, 'fur', 0, 0.19, -0.05, 0.12, 0.1, 0.12, 1); // chỏm tóc
    this.blobPart(this.head, 'skin', 0, -0.04, 0.17, 0.22, 0.2, 0.14); // mặt
    this.blobPart(this.head, 'skin', 0, -0.11, 0.25, 0.15, 0.1, 0.11); // mõm
    this.blobPart(this.head, 'nose', 0, -0.07, 0.355, 0.045, 0.026, 0.02, 1); // mũi
    this.blobPart(this.head, 'dark', 0, 0.075, 0.26, 0.17, 0.035, 0.05, 1); // gờ lông mày
    this.blobPart(this.head, 'fur', -0.29, 0.02, -0.01, 0.1, 0.12, 0.05);
    this.blobPart(this.head, 'fur', 0.29, 0.02, -0.01, 0.1, 0.12, 0.05);
    this.blobPart(this.head, 'skin', -0.3, 0.02, 0.025, 0.06, 0.075, 0.02, 1);
    this.blobPart(this.head, 'skin', 0.3, 0.02, 0.025, 0.06, 0.075, 0.02, 1);
    this.jaw.position.set(0, -0.15, 0.22);
    this.mouthPart = { node: this.blobPart(this.jaw, 'mouth', 0, 0, 0.06, 0.09, 0.03, 0.04, 1), mat: 'mouth', lod: 1 };
    this.parts.pop();
    this.parts.push(this.mouthPart);
    // mắt (mesh không chiếu sáng để luôn rõ)
    for (const sx of [-1, 1]) {
      const w = new THREE.Object3D();
      w.position.set(0.085 * sx, 0.02, 0.265);
      w.scale.set(0.062, 0.07, 0.04);
      this.head.add(w);
      this.eyeParts.push({ node: w, kind: 'white' });
      const p = new THREE.Object3D();
      p.position.set(0.09 * sx, 0.015, 0.297);
      p.scale.set(0.034, 0.042, 0.02);
      this.head.add(p);
      this.eyeParts.push({ node: p, kind: 'pupil' });
      const g = new THREE.Object3D();
      g.position.set(0.1 * sx, 0.035, 0.313);
      g.scale.set(0.011, 0.011, 0.008);
      this.head.add(g);
      this.eyeParts.push({ node: g, kind: 'glint' });
    }
    this.crownNode.position.set(0, 0.29, -0.02);
    // --- tay ---
    for (const [sh, el, sx] of [[this.shL, this.elL, -1], [this.shR, this.elR, 1]] as const) {
      sh.position.set(0.33 * sx, 0.36, 0.02);
      this.blobPart(sh, 'fur', 0, 0, 0, 0.11, 0.11, 0.11, 1); // khớp vai
      const ua = this.blobPart(sh, 'fur', 0, -0.17, 0, 0.085, 0.19, 0.085);
      el.position.set(0, -0.34, 0);
      const fa = this.blobPart(el, 'fur', 0, -0.16, 0.01, 0.075, 0.18, 0.075);
      this.blobPart(el, 'skin', 0, -0.36, 0.03, 0.075, 0.07, 0.085, 1); // bàn tay
      if (sx < 0) { this.uaL = ua; this.faL = fa; } else { this.uaR = ua; this.faR = fa; }
    }
    this.handR.position.set(0, -0.4, 0.06);
    this.elR.add(this.handR);
    // --- chân ---
    for (const [hp, kn, sx] of [[this.hipL, this.knL, -1], [this.hipR, this.knR, 1]] as const) {
      hp.position.set(0.15 * sx, -0.04, 0);
      const th = this.blobPart(hp, 'fur', 0, -0.11, 0, 0.1, 0.14, 0.1);
      kn.position.set(0, -0.23, 0);
      const sn = this.blobPart(kn, 'fur', 0, -0.1, 0, 0.08, 0.13, 0.08);
      this.blobPart(kn, 'skin', 0, -0.22, 0.06, 0.08, 0.045, 0.13, 1); // bàn chân
      if (sx < 0) { this.thL = th; this.snL = sn; } else { this.thR = th; this.snR = sn; }
    }
    // --- đuôi ---
    this.t1.position.set(0, 0.02, -0.24);
    this.t2.position.set(0, 0.22, 0);
    this.t3.position.set(0, 0.2, 0);
    this.tailParts.push({ node: this.blobPart(this.t1, 'fur', 0, 0.11, 0, 0.05, 0.13, 0.05), mat: 'fur', lod: 0 });
    this.tailParts.push({ node: this.blobPart(this.t2, 'fur', 0, 0.1, 0, 0.042, 0.12, 0.042), mat: 'fur', lod: 1 });
    this.tailParts.push({ node: this.blobPart(this.t3, 'fur', 0, 0.09, 0, 0.034, 0.1, 0.034, 1), mat: 'fur', lod: 1 });
    for (let i = 0; i < 3; i++) this.parts.pop();
    // --- lông xù (khỉ trắng / vua) ---
    for (const [x, y, z, s] of [[0, 0.42, 0.05, 0.16], [-0.25, 0.3, 0.1, 0.13], [0.25, 0.3, 0.1, 0.13], [0, 0.3, -0.22, 0.15]] as const) {
      this.fluffParts.push({ node: this.blobPart(this.chest, 'fur', x, y, z, s, s * 0.8, s, 1), mat: 'fur', lod: 1 });
      this.parts.pop();
    }
    this.bombNode.position.set(0, 0.28, -0.32);
    this.glowNode.position.set(0, 0.2, 0);
  }

  /** đặt lại tư thế nghỉ + tỉ lệ theo loài */
  private resetPose(b: Build) {
    this.root.rotation.set(0, 0, 0);
    this.pelvis.position.set(0, 0.5 * b.leg, 0);
    this.pelvis.rotation.set(0, 0, 0);
    this.chest.position.set(0, 0.18, 0);
    this.chest.rotation.set(b.hunch, 0, 0);
    this.chest.scale.set(b.chest, 1 + (b.chest - 1) * 0.5, b.chest);
    this.head.position.set(0, 0.5 + (b.head - 1) * 0.1, 0.06 + b.hunch * 0.1);
    this.head.rotation.set(-b.hunch * 0.8, 0, 0);
    this.head.scale.setScalar(b.head / ((b.chest + 1) / 2));
    this.jaw.rotation.set(0, 0, 0);
    const aL = b.arm, aT = b.armT;
    for (const [sh, el, ua, fa, sx] of [[this.shL, this.elL, this.uaL, this.faL, -1], [this.shR, this.elR, this.uaR, this.faR, 1]] as const) {
      sh.rotation.set(0, 0, 0.12 * sx);
      el.rotation.set(-0.25, 0, 0);
      el.position.set(0, -0.34 * aL, 0);
      ua.scale.set(0.085 * aT, 0.19 * aL, 0.085 * aT);
      ua.position.y = -0.17 * aL;
      fa.scale.set(0.078 * aT, 0.18 * aL, 0.078 * aT);
      fa.position.y = -0.16 * aL;
    }
    this.handR.position.set(0, -0.4 * aL, 0.06);
    for (const [hp, kn, th, sn] of [[this.hipL, this.knL, this.thL, this.snL], [this.hipR, this.knR, this.thR, this.snR]] as const) {
      hp.rotation.set(-0.15, 0, 0);
      kn.rotation.set(0.25, 0, 0);
      kn.position.y = -0.23 * b.leg;
      th.scale.set(0.1 * (0.6 + 0.4 * b.chest), 0.14 * b.leg, 0.1 * (0.6 + 0.4 * b.chest));
      th.position.y = -0.11 * b.leg;
      sn.scale.set(0.08 * (0.6 + 0.4 * b.chest), 0.13 * b.leg, 0.08 * (0.6 + 0.4 * b.chest));
    }
    this.t1.rotation.set(-1.2, 0, 0);
    this.t2.rotation.set(0.5, 0, 0);
    this.t3.rotation.set(0.6, 0, 0);
    this.t1.scale.setScalar(b.tail || 0.0001);
  }

  /**
   * dựng tư thế + ghi instance cho một con.
   * extra > 0: xác chết (giây kể từ khi chết).
   */
  private drawOne(type: number, x: number, y: number, z: number, yaw: number, st: number, ph: number, stT: number, run: number, gal: number, t: number, flash: number, extra: number, dist: number, hpFrac: number, camQ: THREE.Quaternion, showBar: boolean, look: number, seed: number) {
    const def = MONKEYS[type];
    const b = BUILDS[type];
    const S = def.scale;
    this.resetPose(b);
    const s4 = st & 15;
    const sw = Math.sin(ph);
    const cw = Math.cos(ph);
    let bob = 0;
    let mouth = 0;
    const big = type === MK_DOT || type === MK_VUA;

    // ---- đi / chạy / phi ----
    if (s4 === ST_MOVE || s4 === ST_DROP) {
      const biped = run * (1 - gal);
      const quad = run * gal;
      // hai chân
      const legSw = 0.85 * biped + 0.55 * quad;
      this.hipL.rotation.x += sw * legSw;
      this.hipR.rotation.x += -sw * legSw;
      this.knL.rotation.x += Math.max(0, -cw) * 1.1 * run;
      this.knR.rotation.x += Math.max(0, cw) * 1.1 * run;
      // tay vung ngược chân (hai chân) / cùng nhịp vươn trước (phi bốn chân: tay chống đất như chân trước)
      this.shL.rotation.x += -sw * 0.7 * biped - (1.25 + Math.sin(ph + 1.2) * 0.75) * quad;
      this.shR.rotation.x += sw * 0.7 * biped - (1.25 + Math.sin(ph + 1.6) * 0.75) * quad;
      this.elL.rotation.x += -0.5 * biped + 0.25 * quad;
      this.elR.rotation.x += -0.5 * biped + 0.25 * quad;
      // thân cúi theo tốc độ; phi thì gần như nằm ngang
      this.chest.rotation.x += 0.22 * biped + 0.95 * quad;
      this.pelvis.rotation.x += 0.1 * biped + 0.3 * quad;
      this.head.rotation.x -= 0.15 * biped + 0.8 * quad;
      bob = Math.abs(cw) * 0.07 * biped + Math.max(0, Math.sin(ph * 1 + 0.5)) * 0.12 * quad;
      // đuôi: thẳng ra sau khi phi, ve vẩy khi đi
      this.t1.rotation.x += -0.6 * quad;
      this.t1.rotation.z = Math.sin(t * 3 + seed) * 0.35 * (1 - quad);
      this.t2.rotation.z = Math.sin(t * 3 + seed - 0.8) * 0.3;
      this.t3.rotation.z = Math.sin(t * 3 + seed - 1.6) * 0.3;
      if (run < 0.15) {
        // đứng thở, nhìn quanh, gãi đầu
        const br = Math.sin(t * 2.2 + seed);
        this.chest.rotation.x += br * 0.03;
        this.head.rotation.y = Math.sin(t * 0.7 + seed) * 0.5 + look;
        const scratch = Math.max(0, Math.sin(t * 0.45 + seed * 3) - 0.75) * 4;
        this.shR.rotation.x -= scratch * 2.4;
        this.shR.rotation.z += scratch * 0.4;
        this.elR.rotation.x -= scratch * 1.6;
        this.shL.rotation.z -= 0.1;
        if (big) { this.shL.rotation.x -= 0.5; this.shR.rotation.x -= 0.5; }
      }
      if (type === MK_NEM && s4 === ST_MOVE) {
        this.shR.rotation.x = -0.9;
        this.elR.rotation.x = -1.1;
      }
      if (s4 === ST_DROP) {
        // rơi từ trên cây: dang tay, co chân
        this.shL.rotation.z -= 1.4;
        this.shR.rotation.z += 1.4;
        this.hipL.rotation.x -= 0.8;
        this.hipR.rotation.x -= 0.8;
        this.knL.rotation.x += 1.2;
        this.knR.rotation.x += 1.2;
        mouth = 0.8;
      }
    } else if (s4 === ST_WIND || s4 === ST_SLAM) {
      const k = Math.min(1, stT / 0.3);
      this.shL.rotation.x -= 2.7 * k;
      this.shR.rotation.x -= 2.7 * k;
      this.shL.rotation.z -= 0.35 * k;
      this.shR.rotation.z += 0.35 * k;
      this.elL.rotation.x -= 0.6 * k;
      this.elR.rotation.x -= 0.6 * k;
      this.chest.rotation.x -= 0.45 * k;
      this.head.rotation.x -= 0.35 * k;
      this.knL.rotation.x += 0.5 * k;
      this.knR.rotation.x += 0.5 * k;
      this.hipL.rotation.x -= 0.35 * k;
      this.hipR.rotation.x -= 0.35 * k;
      bob = -0.06 * k;
      mouth = k;
    } else if (s4 === ST_STRIKE) {
      const k = Math.min(1, stT / 0.1);
      this.shL.rotation.x += -3 + 3.3 * k;
      this.shR.rotation.x += -3 + 3.3 * k;
      this.elL.rotation.x -= 0.2;
      this.elR.rotation.x -= 0.2;
      this.chest.rotation.x += 0.6 * k;
      this.head.rotation.x += 0.2 * k;
      mouth = 1 - k * 0.5;
    } else if (s4 === ST_THROW) {
      const k = Math.min(1, stT / 0.45);
      const back = k < 0.75 ? k / 0.75 : 1 - (k - 0.75) / 0.25;
      this.shR.rotation.x = -1.2 - 1.8 * back + (k > 0.75 ? 2.6 * ((k - 0.75) / 0.25) : 0);
      this.elR.rotation.x = -1.2 * back;
      this.shL.rotation.x = -0.9;
      this.chest.rotation.y = 0.5 * back - 0.5 * Math.max(0, (k - 0.75) / 0.25);
      this.chest.rotation.x -= 0.2 * back;
      mouth = 0.6;
    } else if (s4 === ST_STUN) {
      this.root.rotation.z = Math.sin(t * 16 + seed) * 0.15;
      this.head.rotation.y = Math.sin(t * 9) * 0.6;
      this.head.rotation.z = Math.sin(t * 7) * 0.3;
      this.shL.rotation.z -= 0.9;
      this.shR.rotation.z += 0.9;
      this.knL.rotation.x += 0.5;
      this.knR.rotation.x += 0.5;
      this.hipL.rotation.x -= 0.3;
      this.hipR.rotation.x -= 0.3;
      bob = -0.08;
      mouth = 0.5;
    } else if (s4 === ST_FUSE) {
      const tr = Math.sin(t * 55) * 0.05;
      this.root.rotation.z = tr;
      this.shL.rotation.x -= 3;
      this.shR.rotation.x -= 3;
      this.elL.rotation.x -= 0.4;
      this.elR.rotation.x -= 0.4;
      this.chest.rotation.x -= 0.25;
      this.head.rotation.x -= 0.4;
      mouth = 1;
    } else if (s4 === ST_POUNCE) {
      // vồ: duỗi người bay ngang, tay vươn trước, chân đạp sau
      this.chest.rotation.x += 1.2;
      this.pelvis.rotation.x += 0.4;
      this.head.rotation.x -= 0.9;
      this.shL.rotation.x -= 2.9;
      this.shR.rotation.x -= 2.9;
      this.elL.rotation.x = 0;
      this.elR.rotation.x = 0;
      this.hipL.rotation.x += 0.9;
      this.hipR.rotation.x += 0.9;
      this.knL.rotation.x += 0.2;
      this.knR.rotation.x += 0.2;
      bob = 0.5;
      mouth = 1;
    } else if (s4 === ST_ROAR) {
      // đấm ngực luân phiên, ngửa cổ gầm
      const b2 = Math.sin(t * 20);
      this.shL.rotation.x = -1.3 + b2 * 0.4;
      this.shR.rotation.x = -1.3 - b2 * 0.4;
      this.shL.rotation.y = 0.9;
      this.shR.rotation.y = -0.9;
      this.elL.rotation.x = -1.6;
      this.elR.rotation.x = -1.6;
      this.chest.rotation.x -= 0.35;
      this.head.rotation.x -= 0.7;
      mouth = 1;
    }
    if (big && s4 !== ST_POUNCE) this.chest.rotation.x += 0.15;
    // trúng đạn: giật đầu + lùi người
    if (flash > 0 && extra === 0) {
      this.head.rotation.x -= flash * 0.35;
      this.chest.rotation.x -= flash * 0.2;
      mouth = Math.max(mouth, flash);
    }
    this.jaw.rotation.x = mouth * 0.5;
    this.mouthPart.node.scale.y = 0.03 + mouth * 0.06;

    // ---- gốc ----
    this.root.position.set(x, y + bob * S, z);
    this.root.rotation.y = yaw;
    let sink = 1;
    if (extra > 0) {
      // xác: ngã ngửa, tay chân dang, chìm dần
      const f = Math.min(1, extra * 5);
      this.root.rotation.x = -1.45 * f;
      this.root.position.y = y + Math.sin(f * Math.PI) * 0.3 - Math.max(0, extra - 0.9) * 0.9;
      this.shL.rotation.z = -1.6 * f;
      this.shR.rotation.z = 1.6 * f;
      this.hipL.rotation.z = -0.5 * f;
      this.hipR.rotation.z = 0.5 * f;
      this.jaw.rotation.x = 0.6;
      if (extra > 1.2) sink = Math.max(0.01, 1 - (extra - 1.2) / 0.4);
    }
    const breathe = 1 + Math.sin(t * 2.4 + seed) * 0.02;
    this.root.scale.set(S * sink, S * sink * breathe, S * sink);
    this.root.updateMatrixWorld(true);

    // ---- màu ----
    this.furC.setHex(def.color);
    this.skinC.setHex(def.belly);
    if (type === MK_NO) {
      // khỉ đỏ: sắp nổ thì nhấp nháy trắng–đỏ rực
      const pulse = s4 === ST_FUSE ? (Math.sin(t * 34) > 0 ? 0.65 : 0.1) : 0.12 + Math.sin(t * 5 + seed) * 0.08;
      this.furC.lerp(C_HOT, pulse);
      if (s4 === ST_FUSE) this.furC.lerp(C_WHITE, Math.sin(t * 34) > 0 ? 0.35 : 0);
    }
    if (st & STX_SLOW) {
      this.furC.lerp(C_SLOW, 0.35);
      this.skinC.lerp(C_SLOW, 0.3);
    }
    if (flash > 0) {
      this.furC.lerp(C_WHITE, flash * 0.85);
      this.skinC.lerp(C_WHITE, flash * 0.85);
    }
    const lodCut = !this.detail ? (dist > 14 ? 1 : 2) : dist > 34 ? 1 : 2;
    const fl = this.flesh;
    const put = (p: Part) => {
      if (p.lod >= lodCut || this.nF >= fl.instanceMatrix.count) return;
      fl.setMatrixAt(this.nF, p.node.matrixWorld);
      const c = p.mat === 'fur' ? this.furC : p.mat === 'skin' ? this.skinC : p.mat === 'mouth' ? C_MOUTH : p.mat === 'nose' ? C_NOSE : this.col.copy(this.furC).multiplyScalar(0.55);
      fl.setColorAt(this.nF, c);
      this.nF++;
    };
    for (const p of this.parts) put(p);
    if (b.tail > 0) for (const p of this.tailParts) put(p);
    if (b.fluff) for (const p of this.fluffParts) put(p);
    // mắt
    if (lodCut > 1 || dist < 20) {
      const red = type === MK_NO || type === MK_VUA || (st & STX_TAUNT) !== 0;
      for (const e of this.eyeParts) {
        if (this.nE >= this.eyes.instanceMatrix.count) break;
        if (e.kind === 'glint' && dist > 18) continue;
        this.eyes.setMatrixAt(this.nE, e.node.matrixWorld);
        this.eyes.setColorAt(this.nE, e.kind === 'white' ? (red ? C_RED_EYE : C_EYE) : e.kind === 'pupil' ? (type === MK_TRANG ? C_BLUE_EYE : C_PUPIL) : C_WHITE);
        this.nE++;
      }
    }
    // phụ kiện
    if (type === MK_NEM && s4 !== ST_STRIKE && extra === 0 && this.nBan < CAP) {
      this.banana.setMatrixAt(this.nBan++, this.handR.matrixWorld);
    }
    if (type === MK_NO && this.nBomb < CAP) this.bomb.setMatrixAt(this.nBomb++, this.bombNode.matrixWorld);
    if (type === MK_VUA && this.nCrown < 16) this.crown.setMatrixAt(this.nCrown++, this.crownNode.matrixWorld);
    if ((type === MK_NO || type === MK_VUA) && extra === 0 && this.nGlow < CAP) {
      // quầng sáng: khỉ đỏ đập nhanh khi sắp nổ, vua khỉ âm ỉ
      const k = type === MK_NO ? (s4 === ST_FUSE ? 0.75 + Math.sin(t * 34) * 0.25 : 0.5 + Math.sin(t * 4 + seed) * 0.08) : 0.75 + Math.sin(t * 2) * 0.05;
      this.glowNode.scale.setScalar(k * (type === MK_VUA ? 0.7 : 0.62));
      this.glowNode.updateMatrixWorld(true);
      this.glow.setMatrixAt(this.nGlow, this.glowNode.matrixWorld);
      this.glow.setColorAt(this.nGlow, type === MK_NO ? this.col.setRGB(1, s4 === ST_FUSE ? 0.55 : 0.3, 0.15) : this.col.setRGB(0.7, 0.15, 0.9));
      this.nGlow++;
    }

    // ---- bóng ----
    if (this.nBlob < CAP) {
      const rr = def.r * 2.7 * sink;
      this.m4.makeScale(rr, 1, rr);
      this.m4.setPosition(x, 0.03, z);
      this.blob.setMatrixAt(this.nBlob++, this.m4);
    }
    // ---- vạch máu ----
    if (showBar && this.nBar < CAP && hpFrac < 0.999 && extra === 0) {
      const w = type === MK_VUA ? 0 : big ? 1.2 : 0.75;
      if (w > 0) {
        this.v.set(x, y + 1.75 * S + 0.2, z);
        this.s.set(w, 1, 1);
        this.m4.compose(this.v, camQ, this.s);
        this.barBg.setMatrixAt(this.nBar, this.m4);
        this.s.set(w * hpFrac, 1, 1);
        this.left.set(-w / 2, 0, 0).applyQuaternion(camQ);
        this.v.add(this.left);
        this.m4.compose(this.v, camQ, this.s);
        this.barFg.setMatrixAt(this.nBar, this.m4);
        this.col.setRGB(1 - hpFrac * 0.6, 0.2 + hpFrac * 0.7, 0.15);
        this.barFg.setColorAt(this.nBar, this.col);
        this.nBar++;
      }
    }
  }

  private teleRing(x: number, z: number, r: number, a: number) {
    if (this.nTele >= 64) return;
    const s = r * (0.92 + a * 0.08);
    this.m4.makeScale(s, 1, s);
    this.m4.setPosition(x, 0.06, z);
    this.tele.setMatrixAt(this.nTele++, this.m4);
  }

  update(m: GameModel, t: number, dt: number, camPos: THREE.Vector3, camQ: THREE.Quaternion) {
    this.nF = this.nE = this.nBan = this.nBomb = this.nCrown = this.nGlow = this.nBlob = this.nTele = this.nBar = 0;
    const kBlend = 1 - Math.exp(-dt * 8);
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
        this.run[sl] = 0;
        this.gal[sl] = 0;
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
      const def = MONKEYS[type];
      const b = BUILDS[type];
      const sp = m.rmSpeed[sl];
      // pha bước theo quãng đường thực (chân không trượt), blend chạy/phi mượt
      const stride = 0.55 * def.scale * (0.8 + b.leg * 0.4) * (1 + this.gal[sl] * 0.6);
      this.phase[sl] += (sp / stride) * dt * 1.6 + dt * 0.5;
      const wantRun = Math.min(1, sp / (def.speed * 0.55));
      this.run[sl] += (wantRun - this.run[sl]) * kBlend;
      const wantGal = sp > def.speed * 0.7 ? b.gallop : b.gallop * 0.2;
      this.gal[sl] += (wantGal - this.gal[sl]) * kBlend;
      let y = 0;
      const since = t - this.seenAt[sl];
      if ((st & 15) === ST_DROP && since < 0.55) y = 2.8 * (1 - since / 0.55) ** 2;
      const dx = x - camPos.x, dz = z - camPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // ngoái nhìn về camera khi đứng gần
      const want = dist < 12 ? Math.max(-0.6, Math.min(0.6, Math.atan2(-dx, -dz) - m.rmYaw[sl])) : 0;
      this.look[sl] += ((Number.isFinite(want) ? want : 0) - this.look[sl]) * kBlend;
      const flash = Math.max(0, Math.min(1, m.mFlash[sl] / 90));
      this.drawOne(type, x, y, z, m.rmYaw[sl], st, this.phase[sl], t - this.stSince[sl], this.run[sl], this.gal[sl], t, flash, 0, dist, m.mHp[sl] / 255, camQ, t < this.hpShowUntil[sl] && dist < 30, this.look[sl] * 0.3, sl * 1.7);
      const s4 = st & 15;
      const a = (Math.sin(t * 20) + 1) / 2;
      if (s4 === ST_FUSE) this.teleRing(x, z, BOMB_RADIUS, a);
      else if (s4 === ST_WIND && type === MK_DOT) this.teleRing(x + Math.sin(m.rmYaw[sl]) * 1.1, z + Math.cos(m.rmYaw[sl]) * 1.1, 2.6, a);
      else if (s4 === ST_SLAM) this.teleRing(x, z, 3.5, a);
    }
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
      this.drawOne(c.type, c.x, 0, c.z, c.yaw, ST_STUN, 0, 0, 0, 0, t, Math.max(0, 1 - c.t * 6), Math.max(0.001, c.t), 10, 1, camQ, false, 0, i);
    }
    const fin = (mesh: THREE.InstancedMesh, n: number) => {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    fin(this.flesh, this.nF);
    fin(this.eyes, this.nE);
    fin(this.banana, this.nBan);
    fin(this.bomb, this.nBomb);
    fin(this.crown, this.nCrown);
    fin(this.glow, this.nGlow);
    fin(this.blob, this.nBlob);
    fin(this.tele, this.nTele);
    fin(this.barBg, this.nBar);
    fin(this.barFg, this.nBar);
  }
}
