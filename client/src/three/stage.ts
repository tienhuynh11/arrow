import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  type Scene,
  type Texture,
} from 'three';

/**
 * "Sân khấu" kiểu game show: trời sáng, mây, đồi xa, mặt cỏ và đồ chơi khổng lồ.
 * Chỉ là phông nền rẻ (vài draw call, InstancedMesh) dùng chung cho mọi minigame.
 */
export type StageName = 'day' | 'sunset' | 'dune' | 'jungle' | 'neon';

export interface Palette {
  /** màu trời trên cùng → sát chân trời */
  top: string;
  mid: string;
  horizon: string;
  /** màu sương mù (≈ màu chân trời) */
  fog: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sun: string;
  sunIntensity: number;
  ground: [string, string];
  hills: string[];
  cloud: string;
  toys: string[];
}

export const STAGES: Record<StageName, Palette> = {
  day: {
    top: '#3a8dff',
    mid: '#7cc4ff',
    horizon: '#e4f6ff',
    fog: '#cfeaff',
    hemiSky: '#d6ecff',
    hemiGround: '#ffe9c2',
    hemiIntensity: 1.55,
    sun: '#fff3d4',
    sunIntensity: 2.6,
    ground: ['#7fe05c', '#6fd14e'],
    hills: ['#7fdc6a', '#6bd07a', '#9be070', '#5cc98c'],
    cloud: '#ffffff',
    toys: ['#ff5e8a', '#ffb627', '#5b8cff', '#8a5bff', '#2fd6a0', '#ff8a3d'],
  },
  sunset: {
    top: '#6a4cff',
    mid: '#ff7ab6',
    horizon: '#ffd9a0',
    fog: '#ffc7a0',
    hemiSky: '#ffd0e0',
    hemiGround: '#ffb98a',
    hemiIntensity: 1.5,
    sun: '#ffd9a8',
    sunIntensity: 2.4,
    ground: ['#ffb36b', '#ffa45a'],
    hills: ['#ff7a8a', '#d9588a', '#ff9a6b', '#b04aa0'],
    cloud: '#ffe6f0',
    toys: ['#ff5e8a', '#ffd166', '#7a5bff', '#3ad6c0', '#ff8a3d', '#ffffff'],
  },
  dune: {
    top: '#2f9bff',
    mid: '#8ed3ff',
    horizon: '#fff0c8',
    fog: '#ffe6b0',
    hemiSky: '#e6f4ff',
    hemiGround: '#ffd890',
    hemiIntensity: 1.55,
    sun: '#fff0c8',
    sunIntensity: 2.8,
    ground: ['#ffd36b', '#f6c555'],
    hills: ['#f2b84a', '#e9a53a', '#ffcb5e', '#d98f2c'],
    cloud: '#ffffff',
    toys: ['#ff5e8a', '#2fd6a0', '#5b8cff', '#ffffff', '#ff8a3d', '#8a5bff'],
  },
  jungle: {
    top: '#2aa6c9',
    mid: '#7fe0c2',
    horizon: '#e8ffd8',
    fog: '#c8f2c0',
    hemiSky: '#d8ffe8',
    hemiGround: '#e8f0a0',
    hemiIntensity: 1.5,
    sun: '#fff6c8',
    sunIntensity: 2.5,
    ground: ['#58d46a', '#49c25c'],
    hills: ['#2fb36a', '#27a35e', '#4fcf7a', '#1f9a6a'],
    cloud: '#ffffff',
    toys: ['#ff8a3d', '#ffd166', '#ff5e8a', '#5b8cff', '#2fd6a0', '#8a5bff'],
  },
  neon: {
    top: '#1b1055',
    mid: '#4a2aa8',
    horizon: '#ff7ad9',
    fog: '#7a3ad0',
    hemiSky: '#c8b8ff',
    hemiGround: '#ff9ae0',
    hemiIntensity: 1.35,
    sun: '#ffe0ff',
    sunIntensity: 2.2,
    ground: ['#3a2a8a', '#33247a'],
    hills: ['#5a3ad0', '#7a4ae8', '#ff5ec8', '#3ad6ff'],
    cloud: '#ffd0ff',
    toys: ['#ff5ec8', '#3ad6ff', '#ffd166', '#7aff9a', '#ffffff', '#ff8a3d'],
  },
};

export interface StageOptions {
  name: StageName;
  /** nửa kích thước (x, z) của vùng chơi: đồi và đồ chơi nằm ngoài vùng này */
  area?: [number, number];
  /** độ cao mặt đất */
  groundY?: number;
  /** có vẽ mặt cỏ hay để cảnh tự vẽ sàn */
  ground?: boolean;
}

export interface Stage {
  update(dt: number): void;
  dispose(): void;
}

const rand = (seed: number) => {
  // số ngẫu nhiên cố định theo seed để cảnh giống nhau giữa các lần vào
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

export function skyTexture(p: Palette): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, p.top);
  grad.addColorStop(0.55, p.mid);
  grad.addColorStop(0.8, p.horizon);
  grad.addColorStop(1, p.horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function buildStage(scene: Scene, o: StageOptions, low: boolean): Stage {
  const p = STAGES[o.name];
  const [ax, az] = o.area ?? [20, 12];
  const gy = o.groundY ?? -0.21;
  const textures: Texture[] = [];
  const owned: { dispose(): void }[] = [];
  const root = new Group();
  scene.add(root);
  const rnd = rand(7 + o.name.length * 31);

  scene.background = skyTexture(p);
  textures.push(scene.background as Texture);

  /* ---------------- mặt cỏ sọc ---------------- */
  if (o.ground !== false) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.fillStyle = p.ground[0];
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = p.ground[1];
    g.fillRect(0, 0, 128, 64);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(60, 60);
    textures.push(tex);
    const mat = new MeshBasicMaterial({ map: tex });
    owned.push(mat);
    const geo = new PlaneGeometry(520, 520);
    owned.push(geo);
    const ground = new Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = gy - 0.02;
    root.add(ground);
  }

  /* ---------------- đồi xa: hình cầu dẹt, đủ màu ---------------- */
  const hillGeo = new SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  owned.push(hillGeo);
  const hills = new InstancedMesh(hillGeo, new MeshBasicMaterial({ color: '#ffffff' }), 22);
  owned.push(hills.material as MeshBasicMaterial);
  const m = new Matrix4();
  const scaleM = new Matrix4();
  const c = new Color();
  const rx = ax + 70;
  const rz = az + 85;
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
    const size = 14 + rnd() * 20;
    m.makeScale(size * (1 + rnd() * 0.8), size * (0.3 + rnd() * 0.25), size);
    m.setPosition(Math.cos(a) * (rx + rnd() * 18), gy - 0.5, Math.sin(a) * (rz + rnd() * 14));
    hills.setMatrixAt(i, m);
    hills.setColorAt(i, c.set(p.hills[i % p.hills.length]));
  }
  hills.instanceMatrix.needsUpdate = true;
  if (hills.instanceColor) hills.instanceColor.needsUpdate = true;
  root.add(hills);

  /* ---------------- đồ chơi khổng lồ (khối, trụ, bóng) ---------------- */
  const toyCount = low ? 14 : 26;
  const toyGeos = [new BoxGeometry(1, 1, 1), new CylinderGeometry(0.5, 0.5, 1, 18), new SphereGeometry(0.5, 16, 12)];
  toyGeos.forEach((geo) => owned.push(geo));
  const toyMat = new MeshLambertMaterial({ color: '#ffffff' });
  owned.push(toyMat);
  const perKind = Math.ceil(toyCount / 3);
  toyGeos.forEach((geo, kind) => {
    const mesh = new InstancedMesh(geo, toyMat, perKind);
    for (let i = 0; i < perKind; i++) {
      const a = rnd() * Math.PI * 2;
      const dist = 1 + rnd() * 0.5;
      const size = 3 + rnd() * 5;
      const x = Math.cos(a) * (ax + 14 + dist * 22);
      const z = Math.sin(a) * (az + 14 + dist * 18);
      const tall = size * (0.8 + rnd() * 0.8);
      m.makeRotationY(rnd() * 3).multiply(scaleM.makeScale(size, tall, size));
      m.setPosition(x, gy + tall * 0.5 - 0.3, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(p.toys[(i + kind * 2) % p.toys.length]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
  });

  /* ---------------- mây ---------------- */
  const cloudGeo = new SphereGeometry(1, 12, 9);
  owned.push(cloudGeo);
  const cloudMat = new MeshBasicMaterial({ color: p.cloud, fog: false });
  owned.push(cloudMat);
  const clouds = new Group();
  const puffs = 9 * 5;
  const cloudMesh = new InstancedMesh(cloudGeo, cloudMat, puffs);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.5;
    const dist = 95 + rnd() * 35;
    const cx = Math.cos(a) * (dist + ax * 0.6);
    const cz = Math.sin(a) * dist;
    const cy = 26 + rnd() * 16;
    const base = 4 + rnd() * 3;
    for (let j = 0; j < 5; j++) {
      const s = base * (0.65 + rnd() * 0.5) * (j === 2 ? 1.3 : 1);
      m.makeScale(s * 1.4, s * 0.75, s);
      m.setPosition(cx + (j - 2) * base * 1.1, cy + (j % 2) * 0.8, cz + (rnd() - 0.5) * 2);
      cloudMesh.setMatrixAt(i * 5 + j, m);
    }
  }
  cloudMesh.instanceMatrix.needsUpdate = true;
  clouds.add(cloudMesh);
  root.add(clouds);

  return {
    update(dt) {
      clouds.rotation.y += dt * 0.006;
    },
    dispose() {
      scene.remove(root);
      for (const t of textures) t.dispose();
      for (const o2 of owned) o2.dispose();
    },
  };
}
