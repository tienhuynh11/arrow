// Hồ hạt dùng chung cho hiệu ứng trận đánh: sprite dựng sẵn một lần, tái dùng vòng tròn (không cấp phát mỗi khung).
// Texture vẽ bằng canvas MỘT lần. Dùng cho: tia sáng va chạm, vệt chém, sao, dấu cộng hồi máu, hồn bay, giấy hoa.
import * as THREE from 'three';

export type FxTex = 'dot' | 'star' | 'spark' | 'glow' | 'slash' | 'plus' | 'soul';

const texCache = new Map<FxTex, THREE.CanvasTexture>();

function make(key: FxTex, size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/** texture dùng chung (vẽ lần đầu khi cần) */
export function fxTex(key: FxTex): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  switch (key) {
    case 'dot':
      return make(key, 32, (c, s) => {
        const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, '#fff');
        g.addColorStop(0.55, '#fff');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
      });
    case 'glow':
      return make(key, 64, (c, s) => {
        const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
      });
    case 'star':
      // sao 5 cánh béo, có viền sáng
      return make(key, 96, (c, s) => {
        c.fillStyle = '#fff';
        c.strokeStyle = '#fff';
        c.lineJoin = 'round';
        c.lineWidth = s * 0.06;
        c.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const r = (i % 2 === 0 ? 0.46 : 0.22) * s;
          c.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
        }
        c.closePath();
        c.fill();
        c.stroke();
      });
    case 'spark':
      // tia lấp lánh 4 cánh mảnh
      return make(key, 64, (c, s) => {
        c.fillStyle = '#fff';
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.quadraticCurveTo(s / 2, s / 2, s, s / 2);
        c.quadraticCurveTo(s / 2, s / 2, s / 2, s);
        c.quadraticCurveTo(s / 2, s / 2, 0, s / 2);
        c.quadraticCurveTo(s / 2, s / 2, s / 2, 0);
        c.fill();
      });
    case 'slash':
      // vệt chém cong thon hai đầu
      return make(key, 128, (c, s) => {
        c.fillStyle = '#fff';
        c.shadowColor = '#fff';
        c.shadowBlur = 8;
        c.beginPath();
        c.moveTo(s * 0.06, s * 0.78);
        c.quadraticCurveTo(s * 0.5, s * 0.1, s * 0.94, s * 0.22);
        c.quadraticCurveTo(s * 0.52, s * 0.36, s * 0.06, s * 0.78);
        c.fill();
      });
    case 'plus':
      return make(key, 64, (c, s) => {
        c.fillStyle = '#fff';
        c.shadowColor = '#fff';
        c.shadowBlur = 6;
        c.beginPath();
        c.roundRect(s * 0.38, s * 0.12, s * 0.24, s * 0.76, s * 0.08);
        c.roundRect(s * 0.12, s * 0.38, s * 0.76, s * 0.24, s * 0.08);
        c.fill();
      });
    case 'soul':
      // hồn: giọt nước đuôi cong
      return make(key, 64, (c, s) => {
        const g = c.createRadialGradient(s / 2, s * 0.38, 2, s / 2, s * 0.4, s * 0.4);
        g.addColorStop(0, '#fff');
        g.addColorStop(1, 'rgba(255,255,255,0.75)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(s / 2, s * 0.36, s * 0.26, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.moveTo(s * 0.26, s * 0.42);
        c.quadraticCurveTo(s * 0.46, s * 0.8, s * 0.7, s * 0.96);
        c.quadraticCurveTo(s * 0.62, s * 0.62, s * 0.74, s * 0.42);
        c.fill();
        c.fillStyle = '#334';
        c.beginPath();
        c.arc(s * 0.42, s * 0.34, s * 0.04, 0, Math.PI * 2);
        c.arc(s * 0.58, s * 0.34, s * 0.04, 0, Math.PI * 2);
        c.fill();
      });
  }
}

interface P {
  sp: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  on: boolean;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  s0: number;
  s1: number;
  a0: number;
  spin: number;
  /** 1 = hiện rõ tới cuối rồi tắt; 0 = mờ dần đều */
  hold: number;
  /** màu đầu / màu cuối (0..1) để đổi màu theo tuổi hạt; ramp=false thì giữ nguyên màu đầu */
  r0: number; g0: number; b0: number;
  r1: number; g1: number; b1: number;
  ramp: boolean;
}

export class FxPool {
  private ps: P[] = [];
  private next = 0;
  private live = 0;

  constructor(private scene: THREE.Scene, size: number) {
    for (let i = 0; i < size; i++) {
      const mat = new THREE.SpriteMaterial({ map: fxTex('dot'), transparent: true, depthWrite: false, depthTest: false });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 20;
      scene.add(sp);
      this.ps.push({ sp, mat, on: false, age: 0, life: 1, vx: 0, vy: 0, vz: 0, g: 0, s0: 1, s1: 1, a0: 1, spin: 0, hold: 0, r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1, ramp: false });
    }
  }

  /** phát một hạt; hết chỗ thì ghi đè hạt cũ nhất theo vòng. `add` = hoà trộn cộng sáng */
  spawn(
    tex: FxTex, x: number, y: number, z: number, vx: number, vy: number, vz: number, g: number,
    life: number, s0: number, s1: number, color: number, spin = 0, add = true, alpha = 1, rot = 0,
    /** màu cuối đời (hex); bỏ trống = không đổi màu. Ví dụ trắng nóng -> màu nguyên tố rồi tắt */
    color2 = -1,
  ): void {
    const p = this.ps[this.next];
    this.next = (this.next + 1) % this.ps.length;
    if (!p.on) this.live++;
    p.on = true;
    p.age = 0;
    p.life = Math.max(0.05, life);
    p.vx = vx; p.vy = vy; p.vz = vz; p.g = g;
    p.s0 = s0; p.s1 = s1; p.a0 = alpha; p.spin = spin;
    p.hold = tex === 'star' || tex === 'plus' || tex === 'soul' ? 0.45 : 0;
    p.mat.map = fxTex(tex);
    p.mat.color.setHex(color);
    p.ramp = color2 >= 0;
    if (p.ramp) {
      p.r0 = ((color >> 16) & 255) / 255; p.g0 = ((color >> 8) & 255) / 255; p.b0 = (color & 255) / 255;
      p.r1 = ((color2 >> 16) & 255) / 255; p.g1 = ((color2 >> 8) & 255) / 255; p.b1 = (color2 & 255) / 255;
    }
    p.mat.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.mat.rotation = rot;
    p.mat.opacity = alpha;
    p.sp.position.set(x, y, z);
    p.sp.scale.set(s0, s0, 1);
    p.sp.visible = true;
  }

  get active(): number {
    return this.live;
  }

  update(dt: number) {
    if (this.live <= 0 || dt <= 0) return;
    for (const p of this.ps) {
      if (!p.on) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.on = false;
        p.sp.visible = false;
        this.live--;
        continue;
      }
      p.vy += p.g * dt;
      p.sp.position.x += p.vx * dt;
      p.sp.position.y += p.vy * dt;
      p.sp.position.z += p.vz * dt;
      const s = p.s0 + (p.s1 - p.s0) * k;
      p.sp.scale.set(s, s, 1);
      p.mat.rotation += p.spin * dt;
      const fade = p.hold > 0 ? (k < p.hold ? 1 : 1 - (k - p.hold) / (1 - p.hold)) : 1 - k * k;
      p.mat.opacity = p.a0 * fade;
      if (p.ramp) {
        // đổi màu theo tuổi (không cấp phát): nhanh về màu cuối ở nửa đầu đời hạt
        const c = Math.min(1, k * 1.6);
        p.mat.color.setRGB(p.r0 + (p.r1 - p.r0) * c, p.g0 + (p.g1 - p.g0) * c, p.b0 + (p.b1 - p.b0) * c, THREE.SRGBColorSpace);
      }
    }
  }

  dispose() {
    for (const p of this.ps) {
      this.scene.remove(p.sp);
      p.mat.dispose();
    }
    this.ps.length = 0;
    this.live = 0;
  }
}

/** giải phóng texture dùng chung (khi rời màn trận) */
export function disposeFxTextures() {
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
}
