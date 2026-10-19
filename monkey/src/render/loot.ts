// Túi đồ rơi trên đất (chế độ ải): túi da nhỏ nhún nhảy + cột sáng + vòng sáng dưới đất, màu theo phẩm.
// Phẩm cao → cột sáng cao hơn, sáng hơn. Hình khối + vật liệu dùng chung; tối đa vài chục túi nên rẻ.

import * as THREE from 'three';
import type { Grade, GroundLoot } from '@shared/monkey/gear';

export const GRADE_HEX = [0xecebe6, 0x4fa8ff, 0xc07bff, 0xffd84a, 0xff8c24];

interface Bag {
  l: GroundLoot;
  g: THREE.Group;
  bag: THREE.Object3D;
  beam: THREE.Mesh;
  ring: THREE.Mesh;
  t0: number;
}

let beamTex: THREE.Texture | null = null;
function beamTexture() {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,.35)');
  gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 64);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}

export class LootRenderer {
  readonly group = new THREE.Group();
  private bags = new Map<number, Bag>();
  private beamGeo = new THREE.CylinderGeometry(0.1, 0.22, 1, 10, 1, true);
  private ringGeo = new THREE.RingGeometry(0.32, 0.5, 24);
  private bagGeo = new THREE.SphereGeometry(0.2, 12, 9);
  private knotGeo = new THREE.CylinderGeometry(0.05, 0.09, 0.12, 8);
  private bagMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
  private beamMats: THREE.MeshBasicMaterial[];
  private ringMats: THREE.MeshBasicMaterial[];
  private glowMats: THREE.MeshStandardMaterial[];

  constructor() {
    const tex = beamTexture();
    this.beamMats = GRADE_HEX.map((c, i) => new THREE.MeshBasicMaterial({
      color: c, map: tex, transparent: true, opacity: 0.45 + i * 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.ringMats = GRADE_HEX.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.glowMats = GRADE_HEX.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, roughness: 0.5 }));
  }

  get list(): GroundLoot[] {
    return [...this.bags.values()].map((b) => b.l);
  }
  get size() {
    return this.bags.size;
  }

  add(l: GroundLoot, now = performance.now()) {
    if (this.bags.has(l.id)) return;
    const gr = Math.max(0, Math.min(4, l.grade | 0)) as Grade;
    const g = new THREE.Group();
    g.position.set(l.x, 0, l.z);
    const bag = new THREE.Group();
    const body = new THREE.Mesh(this.bagGeo, this.bagMat);
    body.scale.set(1, 0.85, 1);
    body.castShadow = true;
    bag.add(body);
    const knot = new THREE.Mesh(this.knotGeo, this.glowMats[gr]);
    knot.position.y = 0.2;
    bag.add(knot);
    bag.position.y = 0.25;
    g.add(bag);
    const beam = new THREE.Mesh(this.beamGeo, this.beamMats[gr]);
    const H = 1.4 + gr * 0.9;
    beam.scale.set(1 + gr * 0.12, H, 1 + gr * 0.12);
    beam.position.y = H / 2;
    beam.renderOrder = 3;
    g.add(beam);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMats[gr]);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);
    this.group.add(g);
    this.bags.set(l.id, { l, g, bag, beam, ring, t0: now });
  }

  remove(id: number) {
    const b = this.bags.get(id);
    if (!b) return;
    this.group.remove(b.g);
    this.bags.delete(id);
  }

  clear() {
    for (const b of this.bags.values()) this.group.remove(b.g);
    this.bags.clear();
  }

  update(t: number, now = performance.now()) {
    for (const b of this.bags.values()) {
      const age = (now - b.t0) / 1000;
      // rơi xuống + nảy nhẹ lúc mới xuất hiện
      const drop = age < 0.45 ? (1 - age / 0.45) * 1.6 * Math.abs(Math.cos(age * 7)) : 0;
      b.bag.position.y = 0.25 + drop + Math.sin(t * 2.4 + b.l.id) * 0.05;
      b.bag.rotation.y = t * 0.9 + b.l.id;
      const k = 0.85 + Math.sin(t * 3 + b.l.id * 1.7) * 0.15;
      b.ring.scale.setScalar(k + (b.l.grade >= 3 ? Math.sin(t * 5) * 0.08 : 0));
      // sắp hết hạn (60 s): nhấp nháy
      b.g.visible = age < 52 || Math.floor(now / 180) % 2 === 0;
    }
  }

  dispose() {
    this.clear();
    this.beamGeo.dispose();
    this.ringGeo.dispose();
    this.bagGeo.dispose();
    this.knotGeo.dispose();
  }
}
