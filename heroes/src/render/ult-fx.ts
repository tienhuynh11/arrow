// Hiệu ứng TUYỆT KỸ riêng từng tướng (12 tướng). Chỉ dùng sprite / vài khối hình dùng chung, texture vẽ canvas MỘT lần,
// không file ảnh. Mọi tween chạy theo thời gian đã nhân tốc độ trận (host.tween/later) nên đúng ở x2/x3.
// Ở preset 'low' (host.low) giảm mạnh số hạt và bỏ lớp phụ.
import * as THREE from 'three';

export interface FxHost {
  scene: THREE.Scene;
  tween(dur: number, fn: (k: number) => void, done?: () => void): void;
  later(sec: number, fn: () => void): void;
  ring(pos: THREE.Vector3, color: number, size: number, dur: number): void;
  burst(pos: THREE.Vector3, color: number, n?: number, speed?: number): void;
  shake(v: number): void;
  low: boolean;
}
export interface UltCtx {
  host: FxHost;
  hero: string;
  /** vị trí người dùng (chân) */
  from: THREE.Vector3;
  height: number;
  /** vị trí chân các mục tiêu */
  targets: THREE.Vector3[];
  color: number;
}

/* ------------------------------ TEXTURE (vẽ canvas một lần) ------------------------------ */
const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
const TX = {
  glow: () => canvasTex('glow', 128, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }),
  star: () => canvasTex('star', 128, (c, s) => {
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = 10;
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = (i % 2 === 0 ? 0.46 : 0.12) * s;
      c.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  }),
  crescent: () => canvasTex('crescent', 256, (c, s) => {
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = 14;
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(s * 0.62, s / 2, s * 0.42, 0, Math.PI * 2);
    c.fill();
  }),
  bar: () => canvasTex('bar', 128, (c, s) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.roundRect(s * 0.42, s * 0.02, s * 0.16, s * 0.96, s * 0.08);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(s * 0.3, s * 0.12, s * 0.4, s * 0.08);
    c.fillRect(s * 0.3, s * 0.8, s * 0.4, s * 0.08);
  }),
  blade: () => canvasTex('blade', 128, (c, s) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(s / 2, s * 0.02);
    c.lineTo(s * 0.6, s * 0.2);
    c.lineTo(s * 0.58, s * 0.74);
    c.lineTo(s * 0.7, s * 0.78);
    c.lineTo(s * 0.7, s * 0.84);
    c.lineTo(s * 0.54, s * 0.84);
    c.lineTo(s * 0.54, s * 0.97);
    c.lineTo(s * 0.46, s * 0.97);
    c.lineTo(s * 0.46, s * 0.84);
    c.lineTo(s * 0.3, s * 0.84);
    c.lineTo(s * 0.3, s * 0.78);
    c.lineTo(s * 0.42, s * 0.74);
    c.lineTo(s * 0.4, s * 0.2);
    c.closePath();
    c.fill();
  }),
  leaf: () => canvasTex('leaf', 64, (c, s) => {
    c.fillStyle = '#fff';
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.95);
    c.bezierCurveTo(s * 0.02, s * 0.6, s * 0.15, s * 0.1, s * 0.5, s * 0.03);
    c.bezierCurveTo(s * 0.85, s * 0.1, s * 0.98, s * 0.6, s * 0.5, s * 0.95);
    c.fill();
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.92);
    c.lineTo(s * 0.5, s * 0.15);
    c.stroke();
  }),
  note1: () => canvasTex('note1', 64, (c, s) => {
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.lineWidth = s * 0.07;
    c.beginPath();
    c.ellipse(s * 0.34, s * 0.76, s * 0.18, s * 0.13, -0.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.72);
    c.lineTo(s * 0.5, s * 0.14);
    c.quadraticCurveTo(s * 0.8, s * 0.22, s * 0.74, s * 0.5);
    c.stroke();
  }),
  note2: () => canvasTex('note2', 64, (c, s) => {
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.lineWidth = s * 0.07;
    for (const x of [0.26, 0.7]) {
      c.beginPath();
      c.ellipse(s * x, s * 0.78, s * 0.15, s * 0.11, -0.4, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(s * (x + 0.13), s * 0.74);
      c.lineTo(s * (x + 0.13), s * 0.2);
      c.stroke();
    }
    c.lineWidth = s * 0.12;
    c.beginPath();
    c.moveTo(s * 0.39, s * 0.2);
    c.lineTo(s * 0.83, s * 0.2);
    c.stroke();
  }),
  shield: () => canvasTex('shield', 128, (c, s) => {
    const p = () => {
      c.beginPath();
      c.moveTo(s * 0.14, s * 0.1);
      c.lineTo(s * 0.86, s * 0.1);
      c.lineTo(s * 0.86, s * 0.5);
      c.quadraticCurveTo(s * 0.86, s * 0.8, s * 0.5, s * 0.97);
      c.quadraticCurveTo(s * 0.14, s * 0.8, s * 0.14, s * 0.5);
      c.closePath();
    };
    p();
    c.fillStyle = '#2c3a52';
    c.fill();
    c.save();
    c.translate(s * 0.5, s * 0.5);
    c.scale(0.88, 0.88);
    c.translate(-s * 0.5, -s * 0.5);
    p();
    c.fillStyle = '#9fb4cc';
    c.fill();
    c.restore();
    c.fillStyle = '#ffd24d';
    c.fillRect(s * 0.44, s * 0.2, s * 0.12, s * 0.6);
    c.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.12);
  }),
  cross: () => canvasTex('cross', 128, (c, s) => {
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = 8;
    for (const sg of [1, -1]) {
      c.beginPath();
      c.moveTo(s * 0.04, s * (sg > 0 ? 0.04 : 0.96));
      c.lineTo(s * 0.46, s * 0.5 - sg * s * 0.02);
      c.lineTo(s * 0.96, s * (sg > 0 ? 0.96 : 0.04));
      c.lineTo(s * 0.54, s * 0.5 + sg * s * 0.02);
      c.closePath();
      c.fill();
    }
  }),
  monkey: () => canvasTex('monkey', 256, (c, s) => {
    const circ = (x: number, y: number, r: number, f: string) => {
      c.fillStyle = f;
      c.beginPath();
      c.arc(x * s, y * s, r * s, 0, Math.PI * 2);
      c.fill();
    };
    // viền vàng bên ngoài
    c.shadowColor = '#ffd24d';
    c.shadowBlur = 14;
    circ(0.14, 0.52, 0.14, '#ffd24d');
    circ(0.86, 0.52, 0.14, '#ffd24d');
    circ(0.5, 0.52, 0.36, '#ffd24d');
    c.shadowBlur = 0;
    circ(0.14, 0.52, 0.115, '#7a4a1e');
    circ(0.86, 0.52, 0.115, '#7a4a1e');
    circ(0.14, 0.52, 0.06, '#f3c98b');
    circ(0.86, 0.52, 0.06, '#f3c98b');
    circ(0.5, 0.52, 0.33, '#7a4a1e');
    // mặt sáng hình quả đào
    circ(0.4, 0.5, 0.17, '#f3c98b');
    circ(0.6, 0.5, 0.17, '#f3c98b');
    circ(0.5, 0.62, 0.2, '#f3c98b');
    // mắt dữ dằn
    for (const x of [0.4, 0.6]) {
      circ(x, 0.5, 0.055, '#fff');
      circ(x + (x < 0.5 ? 0.012 : -0.012), 0.51, 0.03, '#1b1f33');
    }
    c.strokeStyle = '#2a1608';
    c.lineWidth = s * 0.03;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0.32 * s, 0.4 * s);
    c.lineTo(0.45 * s, 0.46 * s);
    c.moveTo(0.68 * s, 0.4 * s);
    c.lineTo(0.55 * s, 0.46 * s);
    c.stroke();
    // miệng cười toe + mũi
    circ(0.46, 0.6, 0.012, '#2a1608');
    circ(0.54, 0.6, 0.012, '#2a1608');
    c.fillStyle = '#6b1f2a';
    c.beginPath();
    c.moveTo(0.4 * s, 0.68 * s);
    c.quadraticCurveTo(0.5 * s, 0.82 * s, 0.6 * s, 0.68 * s);
    c.closePath();
    c.fill();
    // mão vàng + lông trĩ
    c.fillStyle = '#ffd24d';
    c.fillRect(0.28 * s, 0.2 * s, 0.44 * s, 0.07 * s);
    for (const sx of [-1, 1]) {
      c.strokeStyle = '#e5484d';
      c.lineWidth = s * 0.03;
      c.beginPath();
      c.moveTo((0.5 + sx * 0.1) * s, 0.2 * s);
      c.quadraticCurveTo((0.5 + sx * 0.24) * s, 0.02 * s, (0.5 + sx * 0.4) * s, 0.1 * s);
      c.stroke();
    }
  }),
};

/* ------------------------------ HÌNH KHỐI DÙNG CHUNG ------------------------------ */
const GEO = {
  coneUp: new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0),
  boxUp: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  sphere: new THREE.SphereGeometry(1, 12, 10),
};
const basicShared = new Map<number, THREE.MeshBasicMaterial>();
function sharedBasicMat(color: number): THREE.MeshBasicMaterial {
  let m = basicShared.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    basicShared.set(color, m);
  }
  return m;
}

/* ------------------------------ TIỆN ÍCH ------------------------------ */
class Bag {
  objs: THREE.Object3D[] = [];
  mats: THREE.Material[] = [];
  constructor(private scene: THREE.Scene) {}
  sprite(tex: THREE.Texture, color: number, opacity = 1, additive = true): THREE.Sprite {
    const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mats.push(m);
    const s = new THREE.Sprite(m);
    this.objs.push(s);
    this.scene.add(s);
    return s;
  }
  mat(color: number, opacity = 1, additive = true, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mats.push(m);
    return m;
  }
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    this.objs.push(m);
    this.scene.add(m);
    return m;
  }
  free() {
    for (const o of this.objs) this.scene.remove(o);
    for (const m of this.mats) m.dispose();
    this.objs.length = 0;
    this.mats.length = 0;
  }
}
const mat = (s: THREE.Sprite) => s.material as THREE.SpriteMaterial;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const easeBack = (k: number) => {
  const t = k - 1;
  return 1 + t * t * (2.9 * t + 1.9);
};
const mid = (ts: THREE.Vector3[], from: THREE.Vector3): THREE.Vector3 => {
  const m = new THREE.Vector3();
  if (!ts.length) return m.copy(from);
  for (const t of ts) m.add(t);
  return m.multiplyScalar(1 / ts.length);
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** bắn n hạt sprite bay toả ra (có trọng lực nhẹ) rồi mờ dần */
function sparks(h: FxHost, tex: THREE.Texture, color: number, pos: THREE.Vector3, n: number, speed: number, size: number, dur = 0.7, up = 1.5) {
  const bag = new Bag(h.scene);
  const ps: { s: THREE.Sprite; vx: number; vy: number; vz: number; sp: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = bag.sprite(tex, color, 1);
    s.position.copy(pos);
    s.scale.setScalar(size * rnd(0.6, 1.2));
    const a = Math.random() * Math.PI * 2;
    ps.push({ s, vx: Math.cos(a) * speed * rnd(0.4, 1), vy: up * rnd(0.6, 1.4), vz: Math.sin(a) * speed * rnd(0.4, 1), sp: rnd(-4, 4) });
  }
  let last = 0;
  h.tween(dur, (k) => {
    const dt = (k - last) * dur;
    last = k;
    for (const p of ps) {
      p.vy -= 3 * dt;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      mat(p.s).rotation += p.sp * dt;
      mat(p.s).opacity = 1 - k * k;
    }
  }, () => bag.free());
}

/* ------------------------------ TỪNG TƯỚNG ------------------------------ */
type Ult = (c: UltCtx) => void;

const ULTS: Record<string, Ult> = {
  /** Lính Rừng — Rừng Gầm: vòng kiếm xoáy cùng lá cuốn + sóng gầm lan ra */
  linh_rung(c) {
    const { host: h, from, color } = c;
    const bag = new Bag(h.scene);
    const blades = [0, 1, 2].map(() => bag.sprite(TX.blade(), 0xe8fff0, 1));
    const n = h.low ? 3 : 9;
    const leaves = Array.from({ length: n }, (_, i) => {
      const s = bag.sprite(TX.leaf(), i % 2 ? 0x7be05a : 0x3fae4a, 1, false);
      s.scale.setScalar(0.34);
      return s;
    });
    h.ring(from, color, 4.5, 0.7);
    h.tween(0.8, (k) => {
      const R = 0.5 + 1.5 * easeOut(k);
      const sp = k * Math.PI * 7;
      for (let i = 0; i < 3; i++) {
        const a = sp + (i * Math.PI * 2) / 3;
        const b = blades[i];
        b.position.set(from.x + Math.cos(a) * R, 0.9 + k * 0.5, from.z + Math.sin(a) * R);
        b.scale.set(0.55, 1.35, 1);
        mat(b).rotation = -a + Math.PI;
        mat(b).opacity = k < 0.8 ? 1 : (1 - k) / 0.2;
      }
      for (let i = 0; i < leaves.length; i++) {
        const a = -sp * 0.8 + (i * Math.PI * 2) / leaves.length;
        const rr = R * (0.8 + 0.3 * Math.sin(i));
        leaves[i].position.set(from.x + Math.cos(a) * rr, 0.2 + k * 1.8 * ((i % 3) + 1) / 3, from.z + Math.sin(a) * rr);
        mat(leaves[i]).rotation = a * 2;
        mat(leaves[i]).opacity = 1 - k * k;
      }
    }, () => bag.free());
    h.later(0.35, () => {
      for (const t of c.targets) h.ring(t, color, 1.8, 0.5);
      h.shake(0.2);
    });
  },

  /** Thợ Săn — Mưa Tên: mưa mũi tên cắm xuống từng mục tiêu */
  tho_san(c) {
    const { host: h, targets } = c;
    const per = h.low ? 2 : 5;
    const wood = sharedBasicMat(0x8a5a2b);
    const steel = sharedBasicMat(0xdfe6ee);
    const fea = sharedBasicMat(0xff5a5a);
    for (const t of targets) {
      h.ring(t, 0xd9a050, 1.6, 0.9);
      for (let i = 0; i < per; i++) {
        h.later(0.1 + i * 0.07 + Math.random() * 0.1, () => {
          const g = new THREE.Group();
          const shaft = new THREE.Mesh(GEO.cyl, wood);
          shaft.scale.set(0.02, 0.9, 0.02);
          shaft.position.y = 0.45;
          const head = new THREE.Mesh(GEO.coneUp, steel);
          head.scale.set(0.06, 0.14, 0.06);
          head.rotation.x = Math.PI;
          head.position.y = 0.06;
          const tail = new THREE.Mesh(GEO.boxUp, fea);
          tail.scale.set(0.1, 0.12, 0.012);
          tail.position.y = 0.9;
          g.add(shaft, head, tail);
          const x = t.x + rnd(-0.55, 0.55);
          const z = t.z + rnd(-0.55, 0.55);
          g.position.set(x, 7, z);
          g.rotation.z = rnd(-0.12, 0.12);
          h.scene.add(g);
          h.tween(0.22, (k) => {
            g.position.y = 7 * (1 - k * k);
          }, () => {
            g.position.y = 0;
            h.burst(new THREE.Vector3(x, 0.15, z), 0xd9a050, h.low ? 1 : 3, 1.2);
            h.later(0.5, () => {
              h.tween(0.2, (k) => g.scale.setScalar(1 - k), () => h.scene.remove(g));
            });
          });
        });
      }
    }
    h.shake(0.12);
  },

  /** Khiên Đá — Tường Đá: khiên khổng lồ giáng xuống, biểu tượng khiên bật trên đầu đồng đội */
  khien_da(c) {
    const { host: h, from, color } = c;
    const bag = new Bag(h.scene);
    const big = bag.sprite(TX.shield(), 0xffffff, 1, false);
    h.tween(0.7, (k) => {
      const drop = k < 0.3 ? 1 - easeOut(k / 0.3) : 0;
      const sq = k >= 0.3 && k < 0.5 ? Math.sin(((k - 0.3) / 0.2) * Math.PI) * 0.25 : 0;
      big.position.set(from.x, 1.2 + drop * 3.5, from.z);
      big.scale.set(2.6 * (1 + sq), 2.6 * (1 - sq), 1);
      mat(big).opacity = k < 0.65 ? 1 : (1 - k) / 0.35;
    }, () => bag.free());
    h.later(0.2, () => {
      h.ring(from, color, 4, 0.6);
      h.shake(0.3);
      h.burst(from.clone().setY(0.3), 0xcdb87a, h.low ? 3 : 10, 3);
    });
    c.targets.forEach((t, i) =>
      h.later(0.3 + i * 0.07, () => {
        const b2 = new Bag(h.scene);
        const s = b2.sprite(TX.shield(), 0xffffff, 1, false);
        h.ring(t, 0x7fe3ff, 1.5, 0.5);
        h.tween(0.9, (k) => {
          const sc = k < 0.25 ? easeBack(k / 0.25) : 1;
          s.position.set(t.x, c.height + 0.7 + Math.sin(k * 8) * 0.04, t.z);
          s.scale.setScalar(0.8 * sc);
          mat(s).opacity = k < 0.75 ? 1 : (1 - k) / 0.25;
        }, () => b2.free());
      }),
    );
  },

  /** Thầy Thuốc — Suối Lành: lá thuốc và giọt nước xoáy quanh đồng đội */
  thay_thuoc(c) {
    const { host: h, from } = c;
    const per = h.low ? 3 : 7;
    for (const t of c.targets) {
      const bag = new Bag(h.scene);
      const ls = Array.from({ length: per }, (_, i) => {
        const s = bag.sprite(TX.leaf(), i % 2 ? 0x7be05a : 0xb6ff9a, 1, false);
        s.scale.setScalar(0.3);
        return s;
      });
      h.ring(t, 0x5ee08a, 1.5, 0.7);
      h.tween(1.0, (k) => {
        for (let i = 0; i < ls.length; i++) {
          const a = k * 6 + (i * Math.PI * 2) / ls.length;
          const r = 0.55 * (1 - k * 0.3);
          ls[i].position.set(t.x + Math.cos(a) * r, 0.1 + k * (c.height + 0.5) * (0.6 + 0.4 * ((i % 3) / 2)), t.z + Math.sin(a) * r);
          mat(ls[i]).rotation = a;
          mat(ls[i]).opacity = k < 0.7 ? 1 : (1 - k) / 0.3;
        }
      }, () => bag.free());
    }
    // đài phun nước ở người dùng
    h.ring(from, 0x7fd0ff, 3, 0.7);
    sparks(h, TX.glow(), 0x7fd0ff, from.clone().setY(0.5), h.low ? 4 : 14, 1.2, 0.22, 0.9, 3.4);
  },

  /** Kiếm Sĩ Sông — Thuỷ Triều: hai nhát chém cung khổng lồ + sóng nước */
  kiem_si_song(c) {
    const { host: h, from, targets } = c;
    const m = mid(targets, from);
    const p = from.clone().lerp(m, 0.55).setY(1.3);
    const dirx = m.x - from.x;
    const flip = dirx < 0 ? -1 : 1;
    for (let w = 0; w < (h.low ? 1 : 2); w++) {
      h.later(w * 0.14, () => {
        const bag = new Bag(h.scene);
        const s = bag.sprite(TX.crescent(), w ? 0xffffff : 0x7fd0ff, 1);
        s.position.copy(p);
        h.tween(0.42, (k) => {
          const e = easeOut(k);
          s.scale.setScalar(2.2 + 3.2 * e);
          mat(s).rotation = flip * (w ? 1 : -1) * (1.1 - 2.2 * e) + (flip < 0 ? Math.PI : 0);
          mat(s).opacity = k < 0.5 ? 1 : (1 - k) * 2;
        }, () => bag.free());
      });
    }
    targets.forEach((t, i) => h.later(0.2 + i * 0.08, () => {
      h.ring(t, 0x3fa7ff, 2.2, 0.6);
      h.burst(t.clone().setY(0.5), 0x7fd0ff, h.low ? 3 : 8, 2.5);
    }));
    h.shake(0.25);
  },

  /** Pháp Sư Rễ — Rừng Thức Tỉnh: dây leo trồi lên từ đất dưới chân mỗi kẻ địch */
  phap_su_re(c) {
    const { host: h, targets } = c;
    const per = h.low ? 2 : 4;
    const g1 = sharedBasicMat(0x2f9e4a);
    const g2 = sharedBasicMat(0x6fd45a);
    for (const t of targets) {
      h.ring(t, 0x54c74a, 2, 0.8);
      const vines: { m: THREE.Mesh; tilt: number; h: number; ph: number }[] = [];
      for (let i = 0; i < per; i++) {
        const m = new THREE.Mesh(GEO.coneUp, i % 2 ? g1 : g2);
        const a = (i / per) * Math.PI * 2 + Math.random();
        m.position.set(t.x + Math.cos(a) * 0.4, 0, t.z + Math.sin(a) * 0.4);
        m.scale.set(0.13, 0.01, 0.13);
        h.scene.add(m);
        vines.push({ m, tilt: rnd(0.15, 0.4), h: rnd(1.6, 2.5), ph: Math.random() * 6 });
      }
      h.later(0.1, () => {
        h.tween(1.0, (k) => {
          const grow = k < 0.3 ? easeBack(k / 0.3) : k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
          for (const v of vines) {
            v.m.scale.y = Math.max(0.01, v.h * grow);
            v.m.rotation.z = Math.sin(k * 9 + v.ph) * v.tilt;
            v.m.rotation.x = Math.cos(k * 7 + v.ph) * v.tilt;
          }
        }, () => {
          for (const v of vines) h.scene.remove(v.m);
        });
      });
      h.later(0.15, () => sparks(h, TX.leaf(), 0x7be05a, t.clone().setY(0.4), h.low ? 3 : 9, 1.6, 0.3, 0.8, 3));
    }
    h.shake(0.22);
  },

  /** Hộ Vệ Núi — Động Đất: bức tường đá trồi lên + gai đá dưới chân địch + khói bụi */
  ho_ve_nui(c) {
    const { host: h, from, targets } = c;
    const m = mid(targets, from);
    const dx = m.x - from.x, dz = m.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;
    const rock = [sharedBasicMat(0x8b8f99), sharedBasicMat(0xa8764a), sharedBasicMat(0x6d717c)];
    const wall: THREE.Mesh[] = [];
    const cnt = h.low ? 4 : 7;
    for (let i = 0; i < cnt; i++) {
      const o = (i - (cnt - 1) / 2) * 0.62;
      const b = new THREE.Mesh(GEO.boxUp, rock[i % 3]);
      b.position.set(from.x + nx * 1.4 - nz * o, -1.5, from.z + nz * 1.4 + nx * o);
      b.scale.set(0.58, 1.1 + (i % 3) * 0.35, 0.5);
      b.rotation.y = Math.atan2(nx, nz) + (Math.random() - 0.5) * 0.3;
      h.scene.add(b);
      wall.push(b);
    }
    h.ring(from, 0xa8764a, 5, 0.8);
    h.shake(0.45);
    h.tween(1.0, (k) => {
      const up = k < 0.25 ? easeBack(k / 0.25) : k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      wall.forEach((b, i) => {
        const d = Math.min(1, Math.max(0, up * (1.4 - i * 0.05)));
        b.position.y = -1.5 + 1.5 * d;
      });
    }, () => wall.forEach((b) => h.scene.remove(b)));
    for (const t of targets) {
      const sp: THREE.Mesh[] = [];
      for (let i = 0; i < (h.low ? 1 : 3); i++) {
        const s = new THREE.Mesh(GEO.coneUp, rock[(i + 1) % 3]);
        s.position.set(t.x + rnd(-0.5, 0.5), 0, t.z + rnd(-0.5, 0.5));
        s.scale.set(0.2, 0.01, 0.2);
        h.scene.add(s);
        sp.push(s);
      }
      h.later(0.25, () => {
        h.ring(t, 0x8b6a3a, 2.2, 0.6);
        h.tween(0.7, (k) => {
          const g = k < 0.3 ? easeBack(k / 0.3) : 1 - (k - 0.3) / 0.7;
          for (const s of sp) s.scale.y = Math.max(0.01, 1.3 * g);
        }, () => sp.forEach((s) => h.scene.remove(s)));
        sparks(h, TX.glow(), 0xb09a7a, t.clone().setY(0.2), h.low ? 2 : 6, 1.1, 0.6, 0.8, 0.8);
      });
    }
  },

  /** Nhạc Sĩ Gió — Bản Nhạc Chiến: nốt nhạc nhiều màu bay tới đồng đội rồi xoay quanh */
  nhac_si_gio(c) {
    const { host: h, from } = c;
    const cols = [0xff7fa0, 0xffe14d, 0x7fd9ff, 0xb08cff];
    h.ring(from, 0xff9fb2, 3.5, 0.7);
    const per = h.low ? 1 : 3;
    c.targets.forEach((t, ti) => {
      for (let i = 0; i < per; i++) {
        h.later(ti * 0.05 + i * 0.1, () => {
          const bag = new Bag(h.scene);
          const s = bag.sprite(i % 2 ? TX.note2() : TX.note1(), cols[(ti + i) % cols.length], 1, false);
          const ph = rnd(0, 6.28);
          h.tween(1.1, (k) => {
            if (k < 0.4) {
              const e = easeOut(k / 0.4);
              s.position.set(from.x + (t.x - from.x) * e, 1.2 + Math.sin(e * Math.PI) * 1.3, from.z + (t.z - from.z) * e);
            } else {
              const a = ph + (k - 0.4) * 9;
              s.position.set(t.x + Math.cos(a) * 0.55, 0.9 + (k - 0.4) * 1.8, t.z + Math.sin(a) * 0.55);
            }
            s.scale.setScalar(0.5 + Math.sin(k * 20 + ph) * 0.06);
            mat(s).rotation = Math.sin(k * 10 + ph) * 0.3;
            mat(s).opacity = k < 0.8 ? 1 : (1 - k) / 0.2;
          }, () => bag.free());
        });
      }
      h.later(0.4 + ti * 0.05, () => h.ring(t, cols[ti % cols.length], 1.4, 0.5));
    });
  },

  /** Nữ Pháp Sư Ánh Sáng — Thiên Quang: mặt trời lớn + tia nắng thẳng từ trời xuống từng kẻ địch */
  phap_su_anh_sang(c) {
    const { host: h, targets, from } = c;
    const m = mid(targets, from);
    const bag = new Bag(h.scene);
    const sun = bag.sprite(TX.glow(), 0xfff2a0, 1);
    const core = bag.sprite(TX.star(), 0xffffff, 1);
    h.tween(1.0, (k) => {
      const a = k < 0.25 ? easeBack(k / 0.25) : k < 0.8 ? 1 : (1 - k) / 0.2;
      sun.position.set(m.x, 5.5, m.z);
      sun.scale.setScalar(5.5 * a);
      core.position.copy(sun.position);
      core.scale.setScalar(2.6 * a);
      mat(core).rotation = k * 3;
      mat(sun).opacity = 0.9;
    }, () => bag.free());
    targets.forEach((t, i) => {
      h.later(0.18 + i * 0.08, () => {
        const b = new Bag(h.scene);
        const beam = b.mesh(GEO.cylOpen, b.mat(0xfff0a0, 0.7));
        const inner = b.mesh(GEO.cylOpen, b.mat(0xffffff, 0.85));
        beam.position.set(t.x, 3.2, t.z);
        inner.position.copy(beam.position);
        h.ring(t, 0xffe66b, 2, 0.6);
        h.burst(t.clone().setY(0.6), 0xfff176, h.low ? 3 : 8, 2.2);
        h.tween(0.5, (k) => {
          const w = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
          beam.scale.set(0.5 * w + 0.05, 6.4, 0.5 * w + 0.05);
          inner.scale.set(0.22 * w + 0.02, 6.4, 0.22 * w + 0.02);
        }, () => b.free());
      });
    });
    h.shake(0.2);
  },

  /** Sát Thủ Bóng Đêm — Bóng Tử Thần: lướt bóng tối + nổ tím đen + nhát chém chữ X */
  sat_thu_bong_dem(c) {
    const { host: h, from, targets } = c;
    const t = targets[0] ?? from;
    const bag = new Bag(h.scene);
    const n = h.low ? 3 : 7;
    const ghosts = Array.from({ length: n }, () => bag.sprite(TX.glow(), 0x3a1470, 0.8, false));
    h.tween(0.35, (k) => {
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / (n + 1);
        const g = ghosts[i];
        g.position.set(from.x + (t.x - from.x) * f, 0.9, from.z + (t.z - from.z) * f);
        g.scale.set(1.3, 1.9, 1);
        mat(g).opacity = Math.max(0, 0.8 * (f <= k * 1.3 ? 1 - (k * 1.3 - f) * 2 : 0));
      }
    }, () => bag.free());
    h.later(0.3, () => {
      const b = new Bag(h.scene);
      const orb = b.mesh(GEO.sphere, b.mat(0x2a0f4a, 0.85, false));
      const x = b.sprite(TX.cross(), 0xe6c8ff, 1);
      orb.position.copy(t).setY(0.9);
      x.position.copy(orb.position);
      h.ring(t, 0xb066ff, 3, 0.6);
      h.burst(orb.position, 0x7a2ad0, h.low ? 4 : 12, 3);
      h.shake(0.35);
      h.tween(0.6, (k) => {
        const e = easeOut(k);
        orb.scale.setScalar(0.2 + 1.5 * e);
        (orb.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
        x.scale.setScalar(2.4 * easeBack(Math.min(1, k * 3)));
        mat(x).opacity = k < 0.5 ? 1 : (1 - k) * 2;
      }, () => b.free());
    });
  },

  /** Thánh Y — Hồi Sinh Sáng: cột sáng thánh + sao vàng bay lên + vòng hào quang lan */
  thanh_y(c) {
    const { host: h, from } = c;
    const list = [from, ...c.targets.filter((t) => t.distanceToSquared(from) > 0.01)];
    h.ring(from, 0xffe66b, 5, 0.9);
    list.forEach((t, i) => {
      h.later(i * 0.06, () => {
        const b = new Bag(h.scene);
        const pil = b.mesh(GEO.cylOpen, b.mat(0xfff3b0, 0.6));
        const stars = Array.from({ length: h.low ? 2 : 5 }, () => b.sprite(TX.star(), 0xffe66b, 1));
        pil.position.set(t.x, 2.2, t.z);
        const seeds = stars.map(() => ({ a: rnd(0, 6.28), r: rnd(0.2, 0.55), v: rnd(0.8, 1.4) }));
        h.tween(1.0, (k) => {
          const w = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
          pil.scale.set(0.62 * w + 0.02, 4.4, 0.62 * w + 0.02);
          (pil.material as THREE.MeshBasicMaterial).opacity = 0.6 * w;
          stars.forEach((s, j) => {
            const d = seeds[j];
            s.position.set(t.x + Math.cos(d.a + k * 3) * d.r, 0.2 + k * 2.6 * d.v, t.z + Math.sin(d.a + k * 3) * d.r);
            s.scale.setScalar(0.42 * (1 - k * 0.5));
            mat(s).rotation = k * 4;
            mat(s).opacity = 1 - k * k;
          });
        }, () => b.free());
        h.ring(t, 0xffffff, 1.8, 0.6);
      });
    });
  },

  /** Đại Thánh Hầu Vương — Đại Náo Thiên Cung: múa gậy vàng, bóng khỉ khổng lồ, sóng xung kích */
  hau_vuong(c) {
    const { host: h, from, color } = c;
    const bag = new Bag(h.scene);
    const staffs = [0xfff1a0, 0xffd24d, 0xffa51f].map((col, i) => {
      const s = bag.sprite(TX.bar(), col, 1 - i * 0.25);
      return s;
    });
    const mk = bag.sprite(TX.monkey(), 0xffffff, 0, false);
    h.shake(0.55);
    h.ring(from, 0xffd24d, 7, 0.8);
    h.later(0.18, () => h.ring(from, 0xff9a3d, 6, 0.7));
    h.later(0.36, () => h.ring(from, 0xffffff, 5, 0.6));
    h.tween(1.0, (k) => {
      const grow = k < 0.2 ? easeBack(k / 0.2) : k < 0.8 ? 1 : (1 - k) / 0.2;
      for (let i = 0; i < staffs.length; i++) {
        const s = staffs[i];
        s.position.set(from.x, 1.7 + c.height * 0.2, from.z);
        s.scale.set(0.5 * grow, (3.6 + Math.sin(k * 30) * 0.3) * grow, 1);
        mat(s).rotation = k * Math.PI * 9 - i * 0.28;
      }
      mk.position.set(from.x, 3.1 + Math.sin(k * 6) * 0.1, from.z);
      mk.scale.setScalar(3.4 * grow);
      mat(mk).opacity = 0.9 * Math.min(1, grow);
    }, () => bag.free());
    if (!h.low) sparks(h, TX.star(), 0xffe14d, from.clone().setY(1.2), 14, 3.2, 0.5, 0.9, 2.5);
    for (const t of c.targets) {
      h.later(0.3, () => {
        h.ring(t, color, 1.8, 0.5);
        h.burst(t.clone().setY(0.7), 0xffd24d, h.low ? 3 : 7, 2.4);
      });
    }
  },
};

/** phát hiệu ứng tuyệt kỹ riêng của tướng; trả false nếu tướng/quái không có (dùng hiệu ứng theo hệ mặc định) */
export function playUlt(c: UltCtx): boolean {
  const f = ULTS[c.hero];
  if (!f) return false;
  f(c);
  return true;
}
