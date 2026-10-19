// Khung xem 3D trong sảnh (paperdoll): nhân vật mặc đúng đồ, hoặc chế độ "xem súng" (súng to xoay chậm).
// Renderer nhỏ riêng, chỉ vẽ ~30 khung/giây khi đang hiện, kéo để xoay. dispose() khi rời để trả WebGL context.

import * as THREE from 'three';
import type { WeaponDef } from '@shared/monkey/content';
import { Avatar, makeGunModel, type AvatarLook } from './avatars';
import { blobTex } from './scene';

export class AvatarPreview {
  readonly el: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private avatar: Avatar | null = null;
  private gunG: THREE.Group | null = null;
  private gunKey = '';
  private mode: 'avatar' | 'gun' = 'avatar';
  private raf = 0;
  private last = 0;
  private yaw = 0.45; // camera ở phía +z → yaw 0 là quay mặt về camera
  private spin = 0.35;
  private dragX: number | null = null;
  private blob = blobTex();
  private slashAt = 0;
  private pedestal: THREE.Mesh;

  constructor(cls: number, look: AvatarLook | null) {
    this.el = document.createElement('canvas');
    this.el.className = 'preview3d';
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.el, antialias: true, alpha: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      this.renderer = null;
    }
    this.scene.add(new THREE.HemisphereLight(0xfff0d0, 0x2a1a0a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffc860, 1.4);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    // bệ đá tròn viền vàng dưới chân
    this.pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.82, 0.08, 32), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 }));
    this.pedestal.position.y = -0.04;
    this.scene.add(this.pedestal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.018, 6, 40), new THREE.MeshStandardMaterial({ color: 0xd6b25e, metalness: 0.7, roughness: 0.35 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);
    this.setChar(cls, look);
    const down = (x: number) => { this.dragX = x; this.spin = 0; };
    const move = (x: number) => {
      if (this.dragX === null) return;
      this.yaw += (x - this.dragX) * 0.012;
      this.dragX = x;
    };
    const up = () => { if (this.dragX !== null) { this.dragX = null; this.spin = 0.35; } };
    this.el.addEventListener('pointerdown', (e) => { down(e.clientX); this.el.setPointerCapture?.(e.pointerId); });
    this.el.addEventListener('pointermove', (e) => move(e.clientX));
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
    this.el.addEventListener('dblclick', () => this.avatar?.slash());
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  get ok() {
    return !!this.renderer;
  }

  setChar(cls: number, look: AvatarLook | null) {
    // hình khối + vật liệu dùng chung (cache trong avatars.ts) → chỉ gỡ khỏi cảnh, không dispose
    if (this.avatar) this.scene.remove(this.avatar.root, this.avatar.blob);
    const a = new Avatar(cls, this.blob, 0, look);
    a.setTier(2);
    this.avatar = a;
    this.scene.add(a.root, a.blob);
    a.root.visible = this.mode === 'avatar';
  }

  slash() {
    if (this.mode === 'avatar') this.avatar?.slash();
  }

  /** chế độ xem súng: súng to, xoay chậm */
  showGun(w: WeaponDef, color: number) {
    const key = `${w.model}|${color}`;
    if (this.mode !== 'gun') this.yaw = 0.6;
    this.mode = 'gun';
    if (key !== this.gunKey) {
      if (this.gunG) this.scene.remove(this.gunG);
      const gm = makeGunModel(w.model, color);
      const holder = new THREE.Group();
      gm.g.scale.setScalar(2.1);
      // căn giữa theo hộp bao
      const bb = new THREE.Box3().setFromObject(gm.g);
      const c = bb.getCenter(new THREE.Vector3());
      gm.g.position.sub(c);
      holder.add(gm.g);
      holder.position.y = 0.85;
      this.gunG = holder;
      this.gunKey = key;
      this.scene.add(holder);
    }
    if (this.gunG) this.gunG.visible = true;
    if (this.avatar) this.avatar.root.visible = false;
    if (this.avatar) this.avatar.blob.visible = false;
  }

  showAvatar() {
    if (this.mode === 'avatar') return;
    this.mode = 'avatar';
    if (this.gunG) this.gunG.visible = false;
    if (this.avatar) {
      this.avatar.root.visible = true;
      this.avatar.blob.visible = true;
    }
  }

  private frame(now: number) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const r = this.renderer;
    if (!r || !this.avatar || !this.el.isConnected) return;
    if (now - this.last < 33) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.033;
    this.last = now;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w < 4 || h < 4) return;
    if (this.el.width !== Math.round(w * r.getPixelRatio()) || this.el.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.cam.aspect = w / h;
      this.cam.updateProjectionMatrix();
    }
    this.yaw += this.spin * dt;
    const t = now / 1000;
    // khung hẹp (paperdoll) → lùi camera để vừa cả người
    const fit = Math.max(1, 0.62 / Math.max(0.3, this.cam.aspect));
    if (this.mode === 'gun' && this.gunG) {
      this.gunG.rotation.set(Math.sin(t * 0.7) * 0.12, this.yaw, 0);
      this.cam.position.set(0, 1.0, 3.6 * fit);
      this.cam.lookAt(0, 0.85, 0);
      this.pedestal.visible = false;
    } else {
      this.pedestal.visible = true;
      this.cam.position.set(0, 1.15, 4.9 * fit);
      this.cam.lookAt(0, 0.78, 0);
      if (t - this.slashAt > 6) {
        this.slashAt = t;
        this.avatar.slash();
      }
      this.avatar.update({
        x: 0, y: 0, z: 0, yaw: this.yaw, pitch: -0.05, dt, t, down: 0, ads: false, sprint: false, brace: false, rage: false, reviving: false, reload: -1,
      });
    }
    r.render(this.scene, this.cam);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    (this.renderer as any)?.forceContextLoss?.();
    this.renderer = null;
    this.el.remove();
  }
}
