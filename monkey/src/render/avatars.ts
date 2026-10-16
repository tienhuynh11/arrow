// Nhân vật người chơi (low-poly dựng bằng khối): mũ theo lớp, súng theo bậc, tư thế chạy/ngắm/gục.

import * as THREE from 'three';
import { CLASSES, WEAPONS } from '@shared/monkey/content';

const SKIN = 0xf1c27d;

function gunModel(tier: number): THREE.Group {
  const g = new THREE.Group();
  const w = WEAPONS[tier];
  const metal = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const accent = new THREE.MeshLambertMaterial({ color: w.color });
  const woodM = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  let len = 0.35;
  switch (tier) {
    case 0:
      box(0.07, 0.1, 0.28, 0, 0, 0.1, metal);
      box(0.06, 0.14, 0.07, 0, -0.1, 0, accent);
      len = 0.26;
      break;
    case 1:
      box(0.09, 0.12, 0.42, 0, 0, 0.12, metal);
      box(0.06, 0.2, 0.07, 0, -0.14, 0.14, accent);
      box(0.04, 0.04, 0.16, 0, 0.02, 0.4, metal);
      len = 0.48;
      break;
    case 2:
      box(0.09, 0.1, 0.8, 0, 0, 0.25, metal);
      box(0.1, 0.09, 0.26, 0, -0.07, 0.3, woodM);
      box(0.08, 0.13, 0.25, 0, -0.04, -0.18, woodM);
      len = 0.65;
      break;
    case 3:
      box(0.09, 0.13, 0.86, 0, 0, 0.22, accent);
      box(0.06, 0.06, 0.24, 0, 0.11, 0.15, metal);
      box(0.06, 0.18, 0.08, 0, -0.14, 0.2, metal);
      box(0.08, 0.14, 0.22, 0, -0.02, -0.25, metal);
      len = 0.66;
      break;
    default: {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 10), accent);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.04, 0.2);
      tube.castShadow = true;
      g.add(tube);
      box(0.06, 0.16, 0.08, 0, -0.12, 0.05, metal);
      len = 0.66;
    }
  }
  g.userData.len = len;
  return g;
}

function helmet(cls: number): THREE.Object3D {
  const g = new THREE.Group();
  const id = CLASSES[cls].id;
  if (id === 'chienbinh') {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4d6b2f }));
    h.scale.set(1.05, 0.85, 1.1);
    h.position.y = 0.02;
    g.add(h);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 6, 16), new THREE.MeshLambertMaterial({ color: 0x2f4020 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.04;
    g.add(band);
  } else if (id === 'ysi') {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.14, 12), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    h.position.y = 0.16;
    g.add(h);
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xe11d48 }));
    c1.position.set(0, 0.17, 0.26);
    const c2 = c1.clone();
    c2.scale.set(0.3, 3.3, 1);
    g.add(c1, c2);
  } else if (id === 'kysu') {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xfacc15 }));
    h.position.y = 0.04;
    g.add(h);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 16), new THREE.MeshLambertMaterial({ color: 0xeab308 }));
    brim.position.y = 0.05;
    g.add(brim);
  } else {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), new THREE.MeshLambertMaterial({ color: 0x6b7280 }));
    h.position.y = 0.02;
    g.add(h);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 8), new THREE.MeshLambertMaterial({ color: 0xf5f0e0 }));
      horn.position.set(0.27 * s, 0.14, 0);
      horn.rotation.z = -0.9 * s;
      g.add(horn);
    }
  }
  return g;
}

export class Avatar {
  root = new THREE.Group();
  private body = new THREE.Group();
  private upper = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private gunHold = new THREE.Group();
  private gun: THREE.Group | null = null;
  private tier = -1;
  private shield: THREE.Mesh;
  private rage: THREE.Mesh;
  private phase = 0;
  readonly cls: number;
  private muzzleLocal = new THREE.Vector3();
  private recoil = 0;
  blob: THREE.Mesh;

  constructor(cls: number, blobTexture: THREE.Texture) {
    this.cls = cls;
    const c = CLASSES[cls];
    const shirt = new THREE.MeshLambertMaterial({ color: c.color });
    const pants = new THREE.MeshLambertMaterial({ color: 0x3b3a36 });
    const skin = new THREE.MeshLambertMaterial({ color: SKIN });
    const boots = new THREE.MeshLambertMaterial({ color: 0x2a1d12 });
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    // chân
    for (const [leg, x] of [[this.legL, -0.13], [this.legR, 0.13]] as const) {
      leg.position.set(x, 0.82, 0);
      const g = new THREE.CapsuleGeometry(0.1, 0.5, 3, 7);
      g.translate(0, -0.38, 0);
      mesh(g, pants, leg);
      mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), boots, leg, 0, -0.78, 0.05);
      this.body.add(leg);
    }
    // thân trên
    this.upper.position.set(0, 0.85, 0);
    mesh(new THREE.CapsuleGeometry(0.24, 0.36, 4, 10), shirt, this.upper, 0, 0.3, 0);
    mesh(new THREE.BoxGeometry(0.42, 0.3, 0.26), new THREE.MeshLambertMaterial({ color: c.accent }), this.upper, 0, 0.34, 0.03).scale.set(1, 1, 1);
    // ba lô
    mesh(new THREE.BoxGeometry(0.34, 0.4, 0.18), new THREE.MeshLambertMaterial({ color: 0x5b4a33 }), this.upper, 0, 0.36, -0.26);
    if (c.id === 'dausi') {
      for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshLambertMaterial({ color: 0x6b7280 }), this.upper, 0.27 * s, 0.6, 0);
    }
    const head = new THREE.Group();
    head.position.set(0, 0.85, 0);
    mesh(new THREE.SphereGeometry(0.22, 14, 10), skin, head);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.03, 6, 5), new THREE.MeshBasicMaterial({ color: 0x111111 }), head, 0.08 * s, 0.03, 0.2);
    head.add(helmet(cls));
    this.upper.add(head);
    // tay ôm súng
    for (const [arm, x] of [[this.armL, -0.3], [this.armR, 0.3]] as const) {
      arm.position.set(x, 0.55, 0);
      const g = new THREE.CapsuleGeometry(0.075, 0.42, 3, 6);
      g.translate(0, -0.27, 0);
      mesh(g, shirt, arm);
      mesh(new THREE.SphereGeometry(0.075, 6, 5), skin, arm, 0, -0.56, 0);
      this.upper.add(arm);
    }
    this.armR.rotation.set(-1.45, 0, 0.2);
    this.armL.rotation.set(-1.35, 0, -0.55);
    this.gunHold.position.set(0.12, 0.42, 0.42);
    this.upper.add(this.gunHold);
    this.body.add(this.upper);
    this.root.add(this.body);
    // khiên gồng mình / cuồng nộ
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shield.scale.set(0.75, 1.05, 0.75);
    this.shield.position.y = 0.95;
    this.shield.visible = false;
    this.root.add(this.shield);
    this.rage = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.rage.scale.set(0.85, 1.1, 0.85);
    this.rage.position.y = 0.95;
    this.rage.visible = false;
    this.root.add(this.rage);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.035;
  }

  setTier(tier: number) {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.gun) this.gunHold.remove(this.gun);
    this.gun = gunModel(tier);
    this.gunHold.add(this.gun);
    this.muzzleLocal.set(0, 0.02, this.gun.userData.len);
  }

  kick() {
    this.recoil = 1;
  }

  /**
   * @param down 0 đứng, 1 gục, 2 chết
   */
  update(x: number, y: number, z: number, yaw: number, pitch: number, speed: number, dt: number, t: number, down: number, ads: boolean, sprint: boolean, brace: boolean, rage: boolean, reviving: boolean) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.blob.position.set(x, 0.035, z);
    const s = Math.max(0.35, 1 - y * 0.25);
    this.blob.scale.set(s, s, s);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    const run = Math.min(1, speed / 5);
    this.phase += dt * (5 + speed * 1.6);
    const sw = Math.sin(this.phase);
    this.shield.visible = brace;
    this.rage.visible = rage;
    if (rage) this.rage.scale.setScalar(0.9 + Math.sin(t * 10) * 0.05);
    if (down) {
      // nằm gục, bò lết
      this.body.rotation.set(-1.35, 0, 0);
      this.body.position.set(0, 0.28, 0);
      this.upper.rotation.set(0.25, 0, 0);
      this.legL.rotation.x = sw * 0.3 * run;
      this.legR.rotation.x = -sw * 0.3 * run;
      this.armR.rotation.set(-2.6 + Math.sin(t * 3) * 0.3, 0, 0.3);
      this.armL.rotation.set(-1 + sw * 0.4 * run, 0, -0.3);
      this.gunHold.visible = false;
      if (down === 2) this.body.position.y = 0.18;
      return;
    }
    this.gunHold.visible = true;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    // ngẩng theo pitch (thân trên)
    const air = y > 0.05;
    this.upper.rotation.x = -pitch * 0.85 + (sprint ? 0.25 : 0);
    this.upper.rotation.y = sprint ? 0.3 * sw * 0.2 : 0;
    this.legL.rotation.x = air ? -0.6 : sw * 0.85 * run;
    this.legR.rotation.x = air ? 0.3 : -sw * 0.85 * run;
    this.body.position.y = air ? 0 : Math.abs(Math.cos(this.phase)) * 0.05 * run;
    if (reviving) {
      this.upper.rotation.x = 0.6;
      this.armR.rotation.set(-0.8, 0, 0.1);
      this.armL.rotation.set(-0.8, 0, -0.1);
      this.gunHold.visible = false;
      return;
    }
    if (sprint) {
      this.armR.rotation.set(-0.6 + sw * 0.6, 0, 0.3);
      this.armL.rotation.set(-0.9 - sw * 0.6, 0, -0.4);
      this.gunHold.position.set(0.2, 0.3, 0.25);
      this.gunHold.rotation.set(0.9, 0.6, 0);
    } else {
      const r = this.recoil;
      this.armR.rotation.set(-1.45 + r * 0.15, 0, ads ? 0.05 : 0.2);
      this.armL.rotation.set(-1.35 + r * 0.12, 0, -0.55);
      this.gunHold.position.set(ads ? 0.04 : 0.12, ads ? 0.5 : 0.42, 0.42 - r * 0.08);
      this.gunHold.rotation.set(-r * 0.25, 0, 0);
    }
  }

  muzzleWorld(out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    if (!this.gun) return out.copy(this.root.position);
    return this.gun.localToWorld(out.copy(this.muzzleLocal));
  }

  setVisible(v: boolean) {
    this.body.visible = v;
  }
}
