// Khung xem trước nhân vật 3D trong sảnh (tab Nhân vật): renderer nhỏ riêng, chỉ vẽ ~30 khung/giây khi đang hiện,
// kéo chuột / vuốt để xoay. Gọi dispose() khi rời tab để trả WebGL context.

import * as THREE from 'three';
import { Avatar, type AvatarLook } from './avatars';
import { blobTex } from './scene';

export class AvatarPreview {
  readonly el: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private avatar: Avatar | null = null;
  private raf = 0;
  private last = 0;
  private yaw = 0.45; // camera ở phía +z → yaw 0 là quay mặt về camera
  private spin = 0.35;
  private dragX: number | null = null;
  private blob = blobTex();
  private slashAt = 0;

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
    this.scene.add(new THREE.HemisphereLight(0xfff4d6, 0x2a3a1a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffd23f, 1.2);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    this.cam.position.set(0, 1.15, 4.9);
    this.cam.lookAt(0, 0.78, 0);
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
    if (t - this.slashAt > 6) {
      this.slashAt = t;
      this.avatar.slash();
    }
    this.avatar.update({
      x: 0, y: 0, z: 0, yaw: this.yaw, pitch: -0.05, dt, t, down: 0, ads: false, sprint: false, brace: false, rage: false, reviving: false, reload: -1,
    });
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
