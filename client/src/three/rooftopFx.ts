import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Texture,
} from 'three';
import type { SceneKit } from './scene';
import { SB_ARMOR, SB_BLEED, SB_DASH, SB_HASTE, SB_RAGE, SB_SHIELD, SB_SPIN, SK_BEAR_SLAM, SK_BULL_ROAR, SK_ROOSTER_WING, RT_CHARS, type RtChar } from '@shared/rooftop';
import type { RtFx } from '../games/rooftop/useRooftopGame';

/**
 * Hiệu ứng kỹ năng + trúng đòn cho ĐẤU VẬT TRÊN NÓC NHÀ.
 * Tất cả là pool dựng sẵn một lần (vòng sóng, chỉ báo trên sàn, vết nứt, vệt chém, afterimage, hạt/mảnh vỡ bằng InstancedMesh,
 * sprite phát sáng "bloom giả", 1 PointLight dùng chung) — không tạo geometry/material mới mỗi khung hình.
 * Server chỉ gửi sự kiện ngắn; client tự dựng hình. Tọa độ trong file này là toạ độ cảnh: (x, cao, -y).
 */
export interface FxChar {
  id: string;
  /** toạ độ server */
  x: number;
  y: number;
  z: number;
  /** hướng thân (yaw của server) */
  yaw: number;
  vx: number;
  vy: number;
  sb: number;
  out: boolean;
  scale: number;
  ch: RtChar;
}

export interface FxOptions {
  k: SceneKit;
  scene: Scene;
  meId: string;
  /** nhãn HTML dùng cho số sát thương / tên chiêu bay lên */
  popups: HTMLElement[];
  overlay: () => HTMLElement | null;
}

const COLORS: Record<string, string> = {
  bull: '#ff5a3d',
  bear: '#ffc04d',
  fox: '#7aa8ff',
  turtle: '#5de0ff',
  monkey: '#ffe14d',
  tiger: '#ff9f2d',
  rooster: '#ff5e8a',
};

export function createRooftopFx(o: FxOptions) {
  const { k, scene } = o;
  const low = k.low;
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const q = () => (k.low ? 0.5 : 1);
  const dummy = new Object3D();
  const col = new Color();

  /* ---------------- texture vẽ sẵn một lần ---------------- */
  const T = {
    glow: k.texture(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }),
    ring: k.texture(256, 256, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.7, 'rgba(255,255,255,0.12)');
      gr.addColorStop(0.9, 'rgba(255,255,255,1)');
      gr.addColorStop(0.96, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }),
    tele: k.texture(256, 256, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,60,40,0.12)');
      gr.addColorStop(0.85, 'rgba(255,70,40,0.4)');
      gr.addColorStop(1, 'rgba(255,70,40,0.5)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,220,120,0.95)';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 3;
      g.setLineDash([14, 10]);
      g.beginPath();
      g.arc(w / 2, h / 2, w / 4, 0, Math.PI * 2);
      g.stroke();
    }),
    cone: k.texture(256, 256, (g, w, h) => {
      // quạt chỉ về phía trên (hướng nhìn), đỉnh ở giữa
      const a = 0.9;
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,200,80,0.15)');
      gr.addColorStop(1, 'rgba(255,90,40,0.55)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.arc(w / 2, h / 2, w / 2 - 4, -Math.PI / 2 - a, -Math.PI / 2 + a);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,230,150,0.95)';
      g.lineWidth = 5;
      g.stroke();
    }),
    crack: k.texture(256, 256, (g, w, h) => {
      g.translate(w / 2, h / 2);
      let s = 7;
      const r = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      for (let pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass === 0 ? 'rgba(255,150,40,0.85)' : 'rgba(25,18,14,0.95)';
        g.lineWidth = pass === 0 ? 9 : 4;
        for (let i = 0; i < 11; i++) {
          let a = (i / 11) * Math.PI * 2 + r() * 0.3;
          let x = 0;
          let y = 0;
          g.beginPath();
          g.moveTo(0, 0);
          const segs = 5 + Math.floor(r() * 3);
          for (let j = 0; j < segs; j++) {
            a += (r() - 0.5) * 0.7;
            const l = 14 + r() * 14;
            x += Math.cos(a) * l;
            y += Math.sin(a) * l;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      }
    }),
    claw: k.texture(256, 256, (g, w, h) => {
      for (let i = 0; i < 3; i++) {
        const x0 = 70 + i * 55;
        const gr = g.createLinearGradient(x0, 20, x0 + 70, 236);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.35, 'rgba(255,255,255,1)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(x0, 20);
        g.quadraticCurveTo(x0 + 34, 120, x0 + 70, 236);
        g.quadraticCurveTo(x0 + 22, 120, x0 - 6, 20);
        g.closePath();
        g.fill();
      }
    }),
    arc: k.texture(256, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, h / 2, w, h / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.5, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(8, h - 10);
      g.quadraticCurveTo(w / 2, -30, w - 8, h - 10);
      g.quadraticCurveTo(w / 2, 34, 8, h - 10);
      g.fill();
    }),
    hex: k.texture(256, 256, (g, w, h) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 3;
      const r = 28;
      for (let row = -1; row < 8; row++) {
        for (let c = -1; c < 6; c++) {
          const cx = c * r * 1.75 + (row % 2 ? r * 0.875 : 0);
          const cy = row * r * 1.52;
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i + Math.PI / 6;
            const px = cx + Math.cos(a) * r * 0.95;
            const py = cy + Math.sin(a) * r * 0.95;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      }
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(0, 0, w, h);
    }),
    rock: k.texture(128, 128, (g, w, h) => {
      g.fillStyle = 'rgba(255,200,80,0.35)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,230,140,0.9)';
      g.lineWidth = 3;
      let s = 3;
      const r = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      for (let i = 0; i < 16; i++) {
        g.beginPath();
        g.moveTo(r() * w, r() * h);
        g.lineTo(r() * w, r() * h);
        g.stroke();
      }
    }),
    whirl: k.texture(256, 128, (g, w, h) => {
      for (let i = 0; i < 6; i++) {
        const gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.5, 'rgba(255,255,255,0.9)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.save();
        g.translate(0, (i * h) / 6);
        g.transform(1, 0.35, 0, 1, 0, 0);
        g.fillRect(0, 0, w, 7);
        g.restore();
      }
    }),
    star: k.texture(64, 64, (g, w, h) => {
      g.fillStyle = '#fff';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 11 : 28;
        g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    }),
  };
  for (const t of [T.hex, T.whirl]) t.wrapS = t.wrapT = RepeatWrapping;
  T.whirl.repeat.set(2, 1);
  T.hex.repeat.set(2, 1.4);

  const addMat = (map: Texture | null, color = '#ffffff', op = 1, blending: typeof AdditiveBlending | typeof NormalBlending = AdditiveBlending) => {
    const m = own(new MeshBasicMaterial({ map, color, transparent: true, opacity: op, blending, depthWrite: false, toneMapped: false, side: DoubleSide }));
    return m;
  };
  const planeGeo = own(new PlaneGeometry(2, 2));
  const boxGeo = own(new BoxGeometry(1, 1, 1));
  const capsuleGeo = own(new CapsuleGeometry(0.34, 0.8, 4, 10));
  const cylGeo = own(new CylinderGeometry(1.1, 1.1, 1.8, 28, 1, true));
  const sphGeo = own(new SphereGeometry(1, 16, 12));

  /* ---------------- pool: vòng sóng phát sáng nằm trên sàn ---------------- */
  interface Anim {
    mesh: Mesh;
    t: number;
    life: number;
    a: number;
    r0: number;
    r1: number;
    op: number;
    on: boolean;
    kind: number; // 0 nở ra, 1 co lại
    y0?: number;
  }
  const makePool = (n: number, mk: () => Mesh): Anim[] =>
    Array.from({ length: n }, () => {
      const mesh = mk();
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, t: 0, life: 1, a: 0, r0: 1, r1: 1, op: 1, on: false, kind: 0 };
    });
  const take = (pool: Anim[]) => {
    let best = pool[0];
    for (const a of pool) {
      if (!a.on) return a;
      if (a.t / a.life > best.t / best.life) best = a;
    }
    return best;
  };
  const flat = (pool: Anim[], x: number, y: number, z: number, rot: number, r0: number, r1: number, life: number, color: string, op = 1, map?: Texture) => {
    const a = take(pool);
    a.on = true;
    a.t = 0;
    a.life = life;
    a.r0 = r0;
    a.r1 = r1;
    a.op = op;
    const m = a.mesh;
    m.visible = true;
    m.position.set(x, y + 0.04, z);
    m.rotation.set(-Math.PI / 2, 0, rot);
    if (map) (m.material as MeshBasicMaterial).map = map;
    (m.material as MeshBasicMaterial).color.set(color);
    m.scale.setScalar(r0);
    return a;
  };
  const rings = makePool(16, () => new Mesh(planeGeo, addMat(T.ring)));
  const teles = makePool(6, () => new Mesh(planeGeo, addMat(T.tele, '#ffffff', 1, NormalBlending)));
  const cracks = makePool(4, () => new Mesh(planeGeo, addMat(T.crack, '#ffffff', 1, NormalBlending)));
  const slashes = makePool(10, () => new Mesh(planeGeo, addMat(T.claw)));

  /* ---------------- sprite phát sáng (bloom giả) ---------------- */
  interface Glow {
    s: Sprite;
    t: number;
    life: number;
    s0: number;
    s1: number;
    op: number;
    on: boolean;
    vy: number;
  }
  const glows: Glow[] = Array.from({ length: 28 }, () => {
    const s = new Sprite(own(new SpriteMaterial({ map: T.glow, color: '#fff', transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false })));
    s.visible = false;
    scene.add(s);
    return { s, t: 0, life: 1, s0: 1, s1: 1, op: 1, on: false, vy: 0 };
  });
  let glowI = 0;
  const glow = (x: number, y: number, z: number, color: string, s0: number, s1: number, life: number, op = 1, vy = 0, map: Texture = T.glow) => {
    const g = glows[glowI++ % glows.length];
    g.on = true;
    g.t = 0;
    g.life = life;
    g.s0 = s0;
    g.s1 = s1;
    g.op = op;
    g.vy = vy;
    const m = g.s.material as SpriteMaterial;
    m.color.set(color);
    m.map = map;
    g.s.position.set(x, y, z);
    g.s.visible = true;
    g.s.scale.set(s0, s0, 1);
  };

  /* ---------------- mảnh vỡ / hạt: một InstancedMesh ---------------- */
  const ND = 110;
  const debris = new InstancedMesh(boxGeo, own(new MeshBasicMaterial({ color: '#ffffff', toneMapped: false })), ND);
  debris.frustumCulled = false;
  scene.add(debris);
  const dp = new Float32Array(ND * 3);
  const dv = new Float32Array(ND * 3);
  const dl = new Float32Array(ND);
  const dm = new Float32Array(ND);
  const ds = new Float32Array(ND);
  const dg = new Float32Array(ND);
  const dr = new Float32Array(ND);
  const dflat = new Float32Array(ND);
  let dI = 0;
  let dActive = 0;
  for (let i = 0; i < ND; i++) {
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    debris.setMatrixAt(i, dummy.matrix);
    debris.setColorAt(i, col.set('#fff'));
  }
  const spawnDebris = (x: number, h: number, z: number, n: number, colors: string[], speed: number, size: number, grav = 9, up = 0.6, flatness = 1, dirx = 0, dirz = 0, spread = 1) => {
    n = Math.max(1, Math.round(n * q()));
    for (let j = 0; j < n; j++) {
      const i = dI++ % ND;
      const th = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      const hv = Math.cos(th) * sp * spread + dirx * speed * 0.9;
      const hz = Math.sin(th) * sp * spread + dirz * speed * 0.9;
      dp[i * 3] = x;
      dp[i * 3 + 1] = h;
      dp[i * 3 + 2] = z;
      dv[i * 3] = hv;
      dv[i * 3 + 1] = (0.3 + Math.random()) * speed * up;
      dv[i * 3 + 2] = hz;
      dl[i] = dm[i] = 0.55 + Math.random() * 0.5;
      ds[i] = size * (0.6 + Math.random() * 0.8);
      dg[i] = grav;
      dr[i] = Math.random() * 6;
      dflat[i] = flatness;
      debris.setColorAt(i, col.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
  };

  /* ---------------- afterimage (bóng mờ phân thân) ---------------- */
  const ghosts = makePool(10, () => new Mesh(capsuleGeo, addMat(null, '#fff', 0.5)));
  const ghost = (px: number, h: number, pz: number, yaw: number, color: string, life: number, op = 0.5) => {
    const a = take(ghosts);
    a.on = true;
    a.t = 0;
    a.life = life;
    a.op = op;
    const m = a.mesh;
    m.visible = true;
    m.position.set(px, h + 0.85, pz);
    m.rotation.set(0, yaw, 0);
    m.scale.set(1.15, 1, 0.8);
    (m.material as MeshBasicMaterial).color.set(color);
  };
  /** vệt kéo dài (speed line / vệt chém thẳng): box mảnh theo hướng */
  const streaks = makePool(26, () => new Mesh(boxGeo, addMat(null, '#fff', 0.9)));
  const streak = (x0: number, h: number, z0: number, x1: number, z1: number, w: number, color: string, life: number, op = 0.9) => {
    const a = take(streaks);
    a.on = true;
    a.t = 0;
    a.life = life;
    a.op = op;
    const m = a.mesh;
    m.visible = true;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 0.01;
    m.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
    m.rotation.set(0, Math.atan2(dx, dz), 0);
    m.scale.set(w, w, len);
    a.r0 = w;
    a.r1 = len;
    (m.material as MeshBasicMaterial).color.set(color);
  };
  /** lốc xoáy (rùa) */
  const whirls = makePool(3, () => new Mesh(cylGeo, addMat(T.whirl, '#7fe8ff', 0.8)));
  const whirlOwner = ['', '', ''];

  /* ---------------- aura trạng thái (quả cầu mờ gắn từng nhân vật; scene dùng) ---------------- */
  const auraMats = {
    shield: own(new MeshBasicMaterial({ map: T.hex, color: '#7fe8ff', transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide })),
    armor: own(new MeshBasicMaterial({ map: T.rock, color: '#ffc04d', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide })),
    rage: own(new MeshBasicMaterial({ color: '#ff4a2d', transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, toneMapped: false })),
    haste: own(new MeshBasicMaterial({ color: '#7fb8ff', transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, toneMapped: false })),
  };

  /* ---------------- 1 PointLight dùng chung ---------------- */
  const light = low ? null : new PointLight('#ffffff', 0, 12, 2);
  if (light) {
    light.position.set(0, 2, 0);
    scene.add(light);
  }
  let lightT = 0;
  let lightLife = 0.3;
  let lightI = 0;
  const flashLight = (x: number, h: number, z: number, color: string, intensity: number, life: number) => {
    if (!light) return;
    light.color.set(color);
    light.position.set(x, h + 1.5, z);
    lightI = intensity;
    lightLife = life;
    lightT = 0;
  };

  /* ---------------- số sát thương / tên chiêu: pool nhãn HTML ---------------- */
  interface Pop {
    el: HTMLElement;
    x: number;
    h: number;
    z: number;
    t: number;
    life: number;
    on: boolean;
    rise: number;
  }
  const pops: Pop[] = o.popups.map((el) => ({ el, x: 0, h: 0, z: 0, t: 0, life: 1, on: false, rise: 1.2 }));
  let popI = 0;
  const popup = (x: number, h: number, z: number, text: string, cls: string, life = 0.95, rise = 1.4) => {
    if (!pops.length) return;
    const p = pops[popI++ % pops.length];
    const span = p.el.firstElementChild as HTMLElement | null;
    if (!span) return;
    span.textContent = text;
    span.className = `rt-pop ${cls}`;
    // chạy lại animation CSS
    span.style.animation = 'none';
    void span.offsetWidth;
    span.style.animation = '';
    p.on = true;
    p.t = 0;
    p.life = life;
    p.x = x + (Math.random() - 0.5) * 0.5;
    p.h = h;
    p.z = z;
    p.rise = rise;
  };

  /* ---------------- hiệu ứng màn hình: FOV punch, viền chớp ---------------- */
  const baseFov = k.engine.camera.fov;
  let fovPunch = 0;
  let flashA = 0;
  let flashColor = '#fff';
  const screenFlash = (color: string, a: number) => {
    flashColor = color;
    flashA = Math.max(flashA, a);
  };

  /* ---------------- trạng thái nền theo từng nhân vật ---------------- */
  const acc: Record<string, { ghost: number; fire: number; drip: number; spark: number; dash: number }> = {};
  const leapUntil: Record<string, number> = {};
  const trails: Record<string, number> = {};
  const blinkFrom: Record<string, { x: number; z: number }> = {};
  let clock = 0;
  let chars: FxChar[] = [];
  const byId = (id: string) => chars.find((c) => c.id === id);
  const W = (c: FxChar) => ({ x: c.x, h: c.z, z: -c.y });
  const dirOf = (yaw: number) => ({ x: Math.sin(yaw), z: -Math.cos(yaw) });
  const colOf = (c?: string) => COLORS[c ?? ''] ?? '#ffffff';

  /* ================== sự kiện ================== */
  const onFx = (ev: RtFx) => {
    if (ev.kind !== 'fx') return;
    const ca = byId(ev.a);
    const cb = ev.b ? byId(ev.b) : undefined;
    const isMe = ev.a === o.meId || ev.b === o.meId;
    switch (ev.k) {
      case 'skill': {
        if (!ca) break;
        const ch = ca.ch;
        const sk = ch.skills[(ev.s ?? 1) - 1];
        const p = W(ca);
        const yaw = ev.yaw ?? ca.yaw;
        const d = dirOf(yaw);
        const color = colOf(ch.id);
        popup(p.x, p.h + 2.9 * ca.scale, p.z, `${sk.icon} ${sk.name.toUpperCase()}!`, 'skill');
        glow(p.x, p.h + 1.1, p.z, color, 0.5, 2.6, 0.35, 0.9);
        const key = ch.id + ev.s;
        const delay = (ev.delay ?? 0) / 1000;
        if (key === 'bull2') {
          flat(teles, p.x, p.h, p.z, 0, 0.5, SK_BULL_ROAR.radius, delay, '#ffffff', 0.9, T.tele);
          glow(p.x, p.h + 1.8, p.z, '#ffd0a0', 0.6, 1.8, delay, 0.9);
        } else if (key === 'bear1') {
          flat(teles, p.x, p.h, p.z, 0, 0.5, SK_BEAR_SLAM.radius, delay, '#ffffff', 0.9, T.tele);
          for (const sd of [-1, 1]) glow(p.x + sd * 0.4, p.h + 2.3, p.z, '#ffc04d', 0.4, 1.3, delay, 0.95);
        } else if (key === 'rooster2') {
          flat(teles, p.x, p.h, p.z, -yaw, 0.6, SK_ROOSTER_WING.range, delay, '#ffffff', 0.9, T.cone);
        } else if (key === 'bull1') {
          flat(rings, p.x, p.h, p.z, 0, 0.3, 1.8, 0.35, '#ff5a3d', 0.9);
          for (const sd of [-1, 1]) glow(p.x + sd * 0.3, p.h + 1.9, p.z, '#ff7a3d', 0.3, 1.0, 0.4, 1);
          spawnDebris(p.x - d.x * 0.5, p.h + 0.2, p.z - d.z * 0.5, 10, ['#d8c8b0', '#a89878'], 3, 0.16, 6, 0.4, 1, -d.x, -d.z, 0.6);
        } else if (key === 'tiger1') {
          for (let i = 0; i < 3; i++) {
            const a = take(slashes);
            a.on = true;
            a.t = -i * 0.05;
            a.life = 0.45;
            a.op = 1;
            const m = a.mesh;
            m.visible = true;
            m.position.set(p.x + d.x * 1.3, p.h + 1.1, p.z + d.z * 1.3);
            m.rotation.set(0, -yaw + Math.PI, i * 0.5 - 0.5);
            (m.material as MeshBasicMaterial).map = T.claw;
            (m.material as MeshBasicMaterial).color.set(i === 1 ? '#ffffff' : '#ff9f2d');
            m.scale.setScalar(1.7);
            a.r0 = 1.7;
            a.r1 = 2.4;
          }
          flashLight(p.x, p.h, p.z, '#ff9f2d', 2, 0.3);
        } else if (key === 'tiger2') {
          for (let i = 0; i < 3; i++) flat(rings, p.x, p.h + 0.5 + i * 0.3, p.z, 0, 0.5, 4.2 + i * 0.5, 0.7 + i * 0.1, '#ff9f2d', 0.9);
          if (isMe) k.shake(0.5);
          fovPunch = Math.max(fovPunch, 5);
          screenFlash('#ff9f2d', 0.35);
          flashLight(p.x, p.h, p.z, '#ff9f2d', 3, 0.5);
        } else if (key === 'bear2') {
          flat(rings, p.x, p.h, p.z, 0, 0.5, 2.4, 0.5, '#ffc04d', 0.9);
          spawnDebris(p.x, p.h + 1, p.z, 14, ['#ffc04d', '#fff2a0', '#8a6a3a'], 3.6, 0.14, 4, 0.8);
        } else if (key === 'fox2') {
          flat(rings, p.x, p.h, p.z, 0, 0.4, 2.6, 0.5, '#7fb8ff', 0.9);
          spawnDebris(p.x, p.h + 1, p.z, 14, ['#9fd0ff', '#ffffff'], 3, 0.1, -1, 0.9);
        } else if (key === 'turtle1') {
          flat(rings, p.x, p.h, p.z, 0, 0.4, 2.2, 0.5, '#5de0ff', 0.9);
          glow(p.x, p.h + 1, p.z, '#7fe8ff', 0.5, 3, 0.4, 0.8);
        } else if (key === 'turtle2') {
          flat(rings, p.x, p.h, p.z, 0, 0.4, 2.2, 0.4, '#5de0ff', 0.9);
        } else if (key === 'monkey1') {
          flat(rings, p.x, p.h, p.z, 0, 0.3, 1.6, 0.4, '#ffe14d', 0.9);
          spawnDebris(p.x, p.h + 0.2, p.z, 10, ['#e6e8f2', '#b8c0d4'], 3, 0.15, 6, 0.5);
          leapUntil[ev.a] = clock + 0.95;
        } else if (key === 'monkey2') {
          glow(p.x + d.x * 0.8, p.h + 1.2, p.z + d.z * 0.8, '#ffe14d', 0.4, 1.4, 0.35, 0.9);
        } else if (key === 'rooster1') {
          glow(p.x + d.x, p.h + 1.3, p.z + d.z, '#ff5e8a', 0.4, 1.2, 0.3, 0.9);
        } else if (key === 'fox1') {
          // điểm đi: khói tím + afterimage
          blinkFrom[ev.a] = { x: p.x, z: p.z };
        }
        break;
      }
      case 'skillgo': {
        if (!ca) break;
        const p = W(ca);
        const yaw = ev.yaw ?? ca.yaw;
        const d = dirOf(yaw);
        const key = ca.ch.id + ev.s;
        if (key === 'bull2') {
          for (let i = 0; i < 3; i++) flat(rings, p.x, p.h, p.z, 0, 0.4, SK_BULL_ROAR.radius * (1 - i * 0.12), 0.5 + i * 0.1, i === 1 ? '#ffffff' : '#ff9a4d', 1 - i * 0.2);
          spawnDebris(p.x, p.h + 0.2, p.z, 24, ['#d8c8b0', '#a89878', '#ffffff'], 6, 0.2, 7, 0.4);
          glow(p.x, p.h + 1, p.z, '#ffd0a0', 1, 5, 0.4, 0.9);
          k.shake(0.6);
          fovPunch = Math.max(fovPunch, 7);
          screenFlash('#ff9a4d', 0.3);
          flashLight(p.x, p.h, p.z, '#ff9a4d', 3, 0.4);
        } else if (key === 'bear1') {
          flat(cracks, p.x, p.h, p.z, Math.random() * 6, 1, SK_BEAR_SLAM.radius * 1.15, 2.2, '#ffffff', 1, T.crack);
          flat(rings, p.x, p.h, p.z, 0, 0.4, SK_BEAR_SLAM.radius, 0.5, '#ffc04d', 1);
          flat(rings, p.x, p.h, p.z, 0, 0.3, SK_BEAR_SLAM.radius * 1.2, 0.7, '#ffffff', 0.8);
          spawnDebris(p.x, p.h + 0.3, p.z, 22, ['#8a8a96', '#6c6c78', '#b0a090'], 6.5, 0.15, 12, 1.2, 1);
          spawnDebris(p.x, p.h + 0.3, p.z, 16, ['#d8c8b0', '#a89878'], 4, 0.18, 2, 0.5, 1);
          glow(p.x, p.h + 0.6, p.z, '#ffe08a', 1.2, 6, 0.4, 1);
          k.shake(0.9);
          fovPunch = Math.max(fovPunch, 6);
          screenFlash('#ffc04d', 0.35);
          flashLight(p.x, p.h, p.z, '#ffc04d', 4, 0.45);
        } else if (key === 'rooster2') {
          for (let i = 0; i < 9; i++) {
            const a = yaw + (i / 8 - 0.5) * 1.7;
            const dd = dirOf(a);
            const r0 = 0.8 + Math.random() * 0.6;
            streak(p.x + dd.x * r0, p.h + 0.5 + Math.random() * 1.2, p.z + dd.z * r0, p.x + dd.x * (r0 + 2.8), p.z + dd.z * (r0 + 2.8), 0.07, i % 2 ? '#ffffff' : '#9fe8ff', 0.4, 0.9);
          }
          spawnDebris(p.x + d.x, p.h + 1, p.z + d.z, 24, ['#ffffff', '#ff5e8a', '#ffd23f', '#3a7bd5'], 7, 0.16, 2.5, 0.3, 0.3, d.x, d.z, 0.55);
          flat(rings, p.x + d.x * 1.3, p.h, p.z + d.z * 1.3, 0, 0.6, 3.4, 0.5, '#ffffff', 0.7);
          k.shake(0.35);
          fovPunch = Math.max(fovPunch, 3);
        }
        break;
      }
      case 'blinkEnd': {
        if (!ca) break;
        const p = W(ca);
        const from = blinkFrom[ev.a];
        const yaw = ev.yaw ?? ca.yaw;
        if (from) {
          streak(from.x, p.h + 1, from.z, p.x, p.z, 0.12, '#b8a0ff', 0.4, 0.9);
          glow(from.x, p.h + 1, from.z, '#9a6aff', 0.6, 3, 0.45, 0.9);
          spawnDebris(from.x, p.h + 0.8, from.z, 16, ['#8a5aff', '#c8a8ff', '#3a2a6a'], 3, 0.18, -1, 0.9);
          flat(rings, from.x, p.h, from.z, 0, 0.3, 1.8, 0.4, '#9a6aff', 0.9);
          ghost(from.x, p.h, from.z, -yaw + Math.PI, '#8a5aff', 0.55, 0.55);
        }
        glow(p.x, p.h + 1, p.z, '#7ad0ff', 0.7, 3.4, 0.4, 1);
        spawnDebris(p.x, p.h + 0.8, p.z, 16, ['#7ad0ff', '#ffffff', '#3a7bd5'], 4, 0.14, 2, 0.8);
        const a = take(slashes);
        a.on = true;
        a.t = 0;
        a.life = 0.4;
        a.op = 1;
        const m = a.mesh;
        const d = dirOf(yaw);
        m.visible = true;
        m.position.set(p.x + d.x * 0.9, p.h + 1.1, p.z + d.z * 0.9);
        m.rotation.set(0, -yaw + Math.PI, 0.6);
        (m.material as MeshBasicMaterial).map = T.arc;
        (m.material as MeshBasicMaterial).color.set('#bfe8ff');
        a.r0 = 1.1;
        a.r1 = 2.2;
        m.scale.setScalar(1.1);
        flashLight(p.x, p.h, p.z, '#7ad0ff', 2.5, 0.3);
        if (isMe) {
          fovPunch = Math.max(fovPunch, 4);
          screenFlash('#9a8aff', 0.25);
        }
        break;
      }
      case 'peck': {
        if (!ca) break;
        const p = W(ca);
        const d = dirOf(ev.yaw ?? ca.yaw);
        streak(p.x + d.x * 0.5, p.h + 1.3, p.z + d.z * 0.5, p.x + d.x * 1.9, p.z + d.z * 1.9, 0.09, '#ff5e8a', 0.18, 1);
        glow(p.x + d.x * 1.8, p.h + 1.3, p.z + d.z * 1.8, '#ffffff', 0.3, 0.9, 0.2, 1);
        spawnDebris(p.x + d.x * 1.2, p.h + 1.2, p.z + d.z * 1.2, 3, ['#ffffff', '#ff5e8a'], 3, 0.12, 2, 0.3, 0.3);
        break;
      }
      case 'spinpulse': {
        if (!ca) break;
        const p = W(ca);
        flat(rings, p.x, p.h, p.z, 0, 0.5, 1.9, 0.35, '#5de0ff', 0.9);
        spawnDebris(p.x, p.h + 0.2, p.z, 5, ['#e6e8f2', '#9fe8ff'], 4, 0.12, 4, 0.3, 1);
        break;
      }
      case 'stomp': {
        if (!ca) break;
        const p = W(ca);
        flat(rings, p.x, p.h, p.z, 0, 0.3, 2.1, 0.5, '#ffe14d', 1);
        flat(cracks, p.x, p.h, p.z, Math.random() * 6, 1, 2.0, 1.6, '#ffffff', 1, T.crack);
        spawnDebris(p.x, p.h + 0.2, p.z, 16, ['#8a8a96', '#d8c8b0', '#ffe14d'], 5, 0.2, 10, 1, 1);
        glow(p.x, p.h + 0.5, p.z, '#ffe14d', 0.8, 4, 0.35, 1);
        if (isMe) k.shake(0.5);
        fovPunch = Math.max(fovPunch, 4);
        break;
      }
      case 'slip': {
        if (!ca) break;
        const p = W(ca);
        popup(p.x, p.h + 2.6, p.z, 'TRƠN!', 'skill');
        for (let i = 0; i < 6; i++) glow(p.x + (Math.random() - 0.5) * 1.2, p.h + 1.6 + Math.random() * 0.6, p.z + (Math.random() - 0.5) * 1.2, '#ffe14d', 0.3, 0.7, 0.6, 1, 1, T.star);
        spawnDebris(p.x, p.h + 0.4, p.z, 10, ['#ffe14d', '#fff7b0'], 3.5, 0.12, 6, 0.8);
        popup(p.x, p.h + 2.0, p.z, `-${Math.round(ev.dmg ?? 8)}`, 'dmg mid');
        break;
      }
      case 'reflect': {
        if (!ca) break;
        const p = W(ca);
        flat(rings, p.x, p.h + 1, p.z, 0, 0.5, 2.4, 0.4, '#5de0ff', 1);
        glow(p.x, p.h + 1.1, p.z, '#bff4ff', 1, 3.6, 0.3, 1);
        spawnDebris(p.x, p.h + 1.1, p.z, 12, ['#bff4ff', '#ffffff'], 5, 0.1, 2, 0.5);
        popup(p.x, p.h + 2.6, p.z, 'PHẢN!', 'skill');
        break;
      }
      case 'dodged': {
        if (!ca) break;
        const p = W(ca);
        ghost(p.x, p.h, p.z, -ca.yaw + Math.PI, '#7fb8ff', 0.4, 0.5);
        popup(p.x, p.h + 2.6, p.z, 'NÉ!', 'skill');
        break;
      }
      case 'wall': {
        if (!ca) break;
        const p = W(ca);
        spawnDebris(p.x, p.h + 1, p.z, 6, ['#ffffff', '#b8c0d4'], 3, 0.12, 6, 0.5);
        popup(p.x, p.h + 2.2, p.z, `-${Math.round(ev.dmg ?? 3)}`, 'dmg low');
        break;
      }
      case 'wallpunch':
      case 'whiff': {
        if (!ca) break;
        const p = W(ca);
        spawnDebris(p.x, p.h + 0.2, p.z, 5, ['#e6e8f2', '#b8c0d4'], 2.4, 0.12, 5, 0.3);
        if (ev.k === 'wallpunch') popup(p.x, p.h + 2.4, p.z, 'TỰ ĐẬP!', 'skill');
        break;
      }
      case 'down': {
        if (!ca) break;
        const p = W(ca);
        flat(rings, p.x, p.h, p.z, 0, 0.3, 1.5, 0.35, '#ffffff', 0.7);
        spawnDebris(p.x, p.h + 0.2, p.z, 10, ['#e6e8f2', '#b8c0d4'], 3.5, 0.16, 6, 0.5, 1);
        break;
      }
      case 'hit': {
        if (!cb) break;
        const p = W(cb);
        const strong = ev.tag === 'charge' || ev.tag === 'slam' || ev.tag === 'kick' || ev.tag === 'roar' || ev.tag === 'wing' || ev.tag === 'pounce' || ev.tag === 'combo' || ev.counter;
        const color = ev.counter ? '#ff5e8a' : strong ? '#ffb347' : '#ffe9a0';
        const dir = { x: ev.dx ?? 0, z: -(ev.dy ?? 0) };
        glow(p.x, p.h + 1.2, p.z, color, 0.5, strong ? 3.2 : 2, 0.22, 1);
        spawnDebris(p.x, p.h + 1.2, p.z, strong ? 14 : 7, [color, '#ffffff', '#ffe066'], strong ? 6 : 4, 0.1, 8, 0.5, 1, dir.x, dir.z, 0.7);
        if (strong) flat(rings, p.x, p.h, p.z, 0, 0.3, 1.6, 0.3, color, 0.9);
        const dmg = Math.round(ev.dmg ?? 0);
        if (dmg > 0) popup(p.x, p.h + 2.3 * cb.scale, p.z, `${dmg}`, dmg >= 15 ? 'dmg big' : dmg >= 8 ? 'dmg mid' : 'dmg low');
        trails[cb.id] = clock + Math.min(0.5, (ev.force ?? 4) * 0.05);
        // đòn trúng: rung + FOV punch nhẹ cho chiêu mạnh; viền chớp
        if (isMe) {
          k.shake(strong ? 0.5 : 0.2);
          if (strong) fovPunch = Math.max(fovPunch, 4);
          if (ev.b === o.meId) screenFlash('#ff2d2d', strong ? 0.4 : 0.22);
          else screenFlash('#ffffff', strong ? 0.2 : 0.1);
        }
        if (ev.tag === 'charge' || ev.tag === 'pounce') {
          flashLight(p.x, p.h, p.z, color, 2.5, 0.3);
          if (ev.tag === 'pounce') {
            // đốm máu nhẹ
            spawnDebris(p.x, p.h + 1.2, p.z, 8, ['#d6283a', '#ff6b6b'], 4, 0.08, 9, 0.6);
          } else {
            flat(rings, p.x, p.h, p.z, 0, 0.3, 2.6, 0.4, '#ff5a3d', 1);
            spawnDebris(p.x, p.h + 0.3, p.z, 12, ['#d8c8b0', '#a89878'], 5, 0.2, 9, 0.8, 1);
          }
        }
        break;
      }
    }
  };

  /** KO hoành tráng: nổ sao + khói, nhân vật bay lên rồi tan (phần bay do scene làm) */
  const onKo = (ca: FxChar | undefined, x: number, yy: number) => {
    const px = ca ? ca.x : x;
    const pz = ca ? -ca.y : -yy;
    glow(px, 1.2, pz, '#fff2a0', 1, 7, 0.5, 1);
    flat(rings, px, 0, pz, 0, 0.3, 4.2, 0.7, '#ffe14d', 1);
    flat(rings, px, 0, pz, 0, 0.3, 2.6, 0.5, '#ffffff', 0.8);
    for (let i = 0; i < 9; i++) glow(px + (Math.random() - 0.5) * 1.6, 1 + Math.random() * 1.6, pz + (Math.random() - 0.5) * 1.6, i % 2 ? '#ffe14d' : '#ffffff', 0.4, 0.9, 0.9, 1, 2.2, T.star);
    spawnDebris(px, 1.1, pz, 28, ['#ffe14d', '#ffffff', '#ff9f43', '#ff5e8a'], 7, 0.14, 7, 1.1);
    flashLight(px, 0, pz, '#ffe14d', 3, 0.5);
    k.shake(0.4);
    if (ca && ca.id === o.meId) screenFlash('#ffffff', 0.4);
  };

  /* ================== cập nhật mỗi khung ================== */
  const update = (dt: number, time: number, list: FxChar[]) => {
    clock += dt;
    chars = list;

    // pool: vòng / chỉ báo / vết nứt / vệt / bóng mờ / lốc xoáy
    const step = (pool: Anim[], fn: (a: Anim, u: number) => void) => {
      for (const a of pool) {
        if (!a.on) continue;
        a.t += dt;
        if (a.t < 0) continue;
        const u = a.t / a.life;
        if (u >= 1) {
          a.on = false;
          a.mesh.visible = false;
          continue;
        }
        fn(a, u);
      }
    };
    const ease = (u: number) => 1 - (1 - u) * (1 - u);
    step(rings, (a, u) => {
      a.mesh.scale.setScalar(a.r0 + (a.r1 - a.r0) * ease(u));
      (a.mesh.material as MeshBasicMaterial).opacity = a.op * (1 - u) * (1 - u * 0.3);
    });
    step(teles, (a, u) => {
      const e = ease(Math.min(1, u * 1.6));
      a.mesh.scale.setScalar(a.r0 + (a.r1 - a.r0) * e);
      (a.mesh.material as MeshBasicMaterial).opacity = (0.55 + 0.45 * Math.sin(time * 28)) * 0.9 * (u > 0.85 ? (1 - u) / 0.15 : 1);
    });
    step(cracks, (a, u) => {
      a.mesh.scale.setScalar(a.r0 + (a.r1 - a.r0) * Math.min(1, u * 8));
      (a.mesh.material as MeshBasicMaterial).opacity = u < 0.6 ? 1 : (1 - u) / 0.4;
    });
    step(slashes, (a, u) => {
      a.mesh.scale.setScalar(a.r0 + (a.r1 - a.r0) * ease(u));
      (a.mesh.material as MeshBasicMaterial).opacity = a.op * (1 - u);
    });
    step(streaks, (a, u) => {
      a.mesh.scale.set(a.r0 * (1 - u), a.r0 * (1 - u), a.r1);
      (a.mesh.material as MeshBasicMaterial).opacity = a.op * (1 - u);
    });
    step(ghosts, (a, u) => {
      (a.mesh.material as MeshBasicMaterial).opacity = a.op * (1 - u);
      a.mesh.scale.set(1.15 + u * 0.15, 1, 0.8 + u * 0.1);
    });

    // sprite phát sáng
    for (const g of glows) {
      if (!g.on) continue;
      g.t += dt;
      const u = g.t / g.life;
      if (u >= 1) {
        g.on = false;
        g.s.visible = false;
        continue;
      }
      const s = g.s0 + (g.s1 - g.s0) * ease(u);
      g.s.scale.set(s, s, 1);
      g.s.position.y += g.vy * dt;
      (g.s.material as SpriteMaterial).opacity = g.op * (1 - u) * (1 - u);
    }

    // mảnh vỡ
    if (dActive > 0 || dI > 0) {
      let act = 0;
      for (let i = 0; i < ND; i++) {
        if (dl[i] <= 0) continue;
        dl[i] -= dt;
        if (dl[i] <= 0) {
          dummy.scale.setScalar(0);
          dummy.position.set(0, -50, 0);
          dummy.updateMatrix();
          debris.setMatrixAt(i, dummy.matrix);
          continue;
        }
        act++;
        const j = i * 3;
        dv[j + 1] -= dg[i] * dt;
        dv[j] *= 1 - dt * 1.2;
        dv[j + 2] *= 1 - dt * 1.2;
        dp[j] += dv[j] * dt;
        dp[j + 1] += dv[j + 1] * dt;
        dp[j + 2] += dv[j + 2] * dt;
        if (dp[j + 1] < 0.03 && dg[i] > 0) {
          dp[j + 1] = 0.03;
          dv[j + 1] = 0;
          dv[j] *= 0.5;
          dv[j + 2] *= 0.5;
        }
        const life = dl[i] / dm[i];
        const sc = ds[i] * Math.sqrt(Math.min(1, life * 1.6));
        dummy.position.set(dp[j], dp[j + 1], dp[j + 2]);
        dummy.rotation.set(dr[i] + time * 6, dr[i] * 2 + time * 5, 0);
        dummy.scale.set(sc, sc * (0.5 + 0.5 * dflat[i] * 0.6), sc);
        dummy.updateMatrix();
        debris.setMatrixAt(i, dummy.matrix);
      }
      dActive = act;
      debris.instanceMatrix.needsUpdate = true;
    }

    // đèn
    if (light) {
      lightT += dt;
      light.intensity = lightT < lightLife ? lightI * (1 - lightT / lightLife) : 0;
    }

    // popup nhãn
    for (const p of pops) {
      if (!p.on) continue;
      p.t += dt;
      const u = p.t / p.life;
      if (u >= 1) {
        p.on = false;
        p.el.style.opacity = '0';
        continue;
      }
      k.label(p.el, p.x, p.h + p.rise * ease(u), p.z);
    }

    // hiệu ứng màn hình
    const cam = k.engine.camera;
    if (fovPunch > 0.01) {
      fovPunch *= Math.exp(-dt * 8);
      cam.fov = baseFov + fovPunch;
      cam.updateProjectionMatrix();
    } else if (cam.fov !== baseFov) {
      cam.fov = baseFov;
      cam.updateProjectionMatrix();
    }
    const ov = o.overlay();
    if (ov) {
      if (flashA > 0.01) {
        flashA *= Math.exp(-dt * 7);
        ov.style.opacity = String(Math.min(1, flashA));
        ov.style.boxShadow = `inset 0 0 140px 40px ${flashColor}`;
      } else if (ov.style.opacity !== '0') ov.style.opacity = '0';
    }

    // hào quang
    auraMats.shield.map!.offset.y = (time * 0.15) % 1;
    auraMats.armor.opacity = 0.4 + 0.2 * Math.sin(time * 16);
    auraMats.rage.opacity = 0.22 + 0.12 * Math.sin(time * 18);

    // hiệu ứng theo trạng thái từng nhân vật
    let whirlN = 0;
    for (const c of list) {
      if (c.out) continue;
      const a = (acc[c.id] ??= { ghost: 0, fire: 0, drip: 0, spark: 0, dash: 0 });
      const p = W(c);
      const color = colOf(c.ch.id);
      const sb = c.sb;
      const d = dirOf(c.yaw);
      if (sb & SB_DASH) {
        a.dash -= dt;
        a.ghost -= dt;
        if (a.dash <= 0) {
          a.dash = 0.03;
          const ox = (Math.random() - 0.5) * 0.9;
          const hh = 0.5 + Math.random() * 1.3;
          const sx = p.x - d.x * 0.4 + -d.z * ox;
          const sz = p.z - d.z * 0.4 + d.x * ox;
          streak(sx, p.h + hh, sz, sx - d.x * 3.2, sz - d.z * 3.2, 0.07, color, 0.22, 0.9);
          spawnDebris(p.x - d.x * 0.5, p.h + 0.15, p.z - d.z * 0.5, 2, ['#d8c8b0', '#a89878'], 2.2, 0.15, 5, 0.4, 1, -d.x, -d.z, 0.5);
        }
        if (a.ghost <= 0) {
          a.ghost = 0.05;
          ghost(p.x, p.h, p.z, -c.yaw + Math.PI, color, 0.3, 0.45);
          glow(p.x, p.h + 1.1, p.z, color, 1.4, 0.4, 0.25, 0.7);
        }
      }
      if (sb & SB_HASTE) {
        a.ghost -= dt;
        if (a.ghost <= 0) {
          a.ghost = 0.09;
          ghost(p.x, p.h, p.z, -c.yaw + Math.PI, '#7fb8ff', 0.42, 0.4);
          spawnDebris(p.x, p.h + 1, p.z, 1, ['#9fd0ff', '#ffffff'], 1.4, 0.09, -1, 0.8);
        }
      }
      if (sb & SB_RAGE) {
        a.fire -= dt;
        if (a.fire <= 0) {
          a.fire = 0.05;
          const ox = (Math.random() - 0.5) * 0.9;
          const oz = (Math.random() - 0.5) * 0.9;
          glow(p.x + ox, p.h + 0.3, p.z + oz, Math.random() > 0.5 ? '#ff6a1d' : '#ffb347', 0.6, 0.9, 0.5, 0.9, 2.2);
          spawnDebris(p.x + ox, p.h + 0.4, p.z + oz, 1, ['#ffb347', '#ff6a1d'], 1.5, 0.09, -3, 1.4, 1, 0, 0, 0.3);
        }
      }
      if (sb & SB_BLEED) {
        a.drip -= dt;
        if (a.drip <= 0) {
          a.drip = 0.22;
          spawnDebris(p.x, p.h + 1.2, p.z, 1, ['#d6283a'], 0.8, 0.07, 9, 0.2);
        }
      }
      if (sb & SB_ARMOR) {
        a.spark -= dt;
        if (a.spark <= 0) {
          a.spark = 0.18;
          spawnDebris(p.x, p.h + 1, p.z, 1, ['#ffe08a', '#ffc04d'], 2, 0.08, 3, 0.8);
        }
      }
      if (sb & SB_SHIELD) {
        a.spark -= dt;
        if (a.spark <= 0) {
          a.spark = 0.25;
          glow(p.x + (Math.random() - 0.5) * 1.4, p.h + 0.4 + Math.random() * 1.4, p.z + (Math.random() - 0.5) * 1.4, '#bff4ff', 0.4, 0.2, 0.4, 0.9);
        }
      }
      if (sb & SB_SPIN) {
        // lốc xoáy bao quanh rùa
        let wi = whirlOwner.indexOf(c.id);
        if (wi < 0) wi = whirlOwner.indexOf('');
        if (wi >= 0) {
          whirlOwner[wi] = c.id;
          const a2 = whirls[wi];
          a2.on = true;
          a2.t = 0;
          a2.life = 1e9;
          const m = a2.mesh;
          m.visible = true;
          m.position.set(p.x, p.h + 0.9, p.z);
          m.rotation.y = time * 14;
          m.scale.set(1.15 + Math.sin(time * 10) * 0.05, 1, 1.15 + Math.sin(time * 10) * 0.05);
          (m.material as MeshBasicMaterial).opacity = 0.75;
          (m.material as MeshBasicMaterial).map!.offset.y = (time * 1.2) % 1;
          whirlN++;
        }
        a.drip -= dt;
        if (a.drip <= 0) {
          a.drip = 0.04;
          const an = time * 14;
          spawnDebris(p.x + Math.cos(an) * 1.3, p.h + 0.15, p.z + Math.sin(an) * 1.3, 1, ['#e6e8f2', '#9fe8ff'], 2.4, 0.12, 3, 0.9, 1, -Math.sin(an), Math.cos(an), 0.2);
        }
      }
      const lu = leapUntil[c.id];
      if (lu && clock < lu) {
        glow(p.x, p.h + 0.9, p.z, '#ffe14d', 0.8, 0.3, 0.35, 0.8);
        if (Math.random() < 0.5) spawnDebris(p.x, p.h + 0.9, p.z, 1, ['#ffe14d', '#ffffff'], 1.4, 0.08, 1, 0.3);
      }
      const tr = trails[c.id];
      if (tr && clock < tr) spawnDebris(p.x, p.h + 0.15, p.z, 1, ['#d8c8b0', '#a89878'], 1.6, 0.14, 4, 0.5, 1);
    }
    for (let i = 0; i < whirls.length; i++) {
      const owner = whirlOwner[i];
      if (!owner) continue;
      const c = list.find((x) => x.id === owner);
      if (!c || !(c.sb & SB_SPIN) || c.out) {
        whirlOwner[i] = '';
        whirls[i].on = false;
        whirls[i].mesh.visible = false;
      }
    }
    void whirlN;
  };

  const dispose = () => {
    for (const d of owned) d.dispose();
    debris.dispose();
  };

  return { onFx, onKo, update, auraMats, dispose, screenFlash };
}

export type RooftopFx = ReturnType<typeof createRooftopFx>;
