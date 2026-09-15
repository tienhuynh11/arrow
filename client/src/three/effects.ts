import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  PointsMaterial,
  RingGeometry,
  type Scene,
} from 'three';

export interface BurstOptions {
  count: number;
  palette: string[];
  speed: number;
  life: number;
  size: number;
  additive?: boolean;
  /** dương = rơi xuống, âm = bay lên (khói) */
  gravity?: number;
  drag?: number;
}

interface Burst {
  points: Points;
  geo: BufferGeometry;
  mat: PointsMaterial;
  vel: Float32Array;
  life: number;
  max: number;
  gravity: number;
  drag: number;
}

interface Ring {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  life: number;
  max: number;
  scale: number;
}

/**
 * Hiệu ứng nổ bằng hạt điểm (Points) - mỗi vụ nổ chỉ là 1 draw call dù có cả trăm hạt.
 */
export class Effects {
  private bursts: Burst[] = [];
  private rings: Ring[] = [];
  private readonly ringGeo = new RingGeometry(0.82, 1, 48);
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  burst(x: number, y: number, z: number, o: BurstOptions) {
    const pos = new Float32Array(o.count * 3);
    const vel = new Float32Array(o.count * 3);
    const col = new Float32Array(o.count * 3);
    const c = new Color();

    for (let i = 0; i < o.count; i++) {
      const j = i * 3;
      pos[j] = x;
      pos[j + 1] = y;
      pos[j + 2] = z;
      // hướng ngẫu nhiên, thiên về phía trên như một vụ nổ trên mặt đất
      const theta = Math.random() * Math.PI * 2;
      const up = 0.1 + Math.random() * 0.9;
      const flat = Math.sqrt(1 - up * up);
      const v = o.speed * (0.35 + Math.random() * 0.65);
      vel[j] = Math.cos(theta) * flat * v;
      vel[j + 1] = up * v * 1.1;
      vel[j + 2] = Math.sin(theta) * flat * v;
      c.set(o.palette[Math.floor(Math.random() * o.palette.length)]);
      col[j] = c.r;
      col[j + 1] = c.g;
      col[j + 2] = c.b;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    const mat = new PointsMaterial({
      size: o.size,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: o.additive === false ? NormalBlending : AdditiveBlending,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false; // hạt bay xa khỏi hộp bao ban đầu
    this.scene.add(points);
    this.bursts.push({ points, geo, mat, vel, life: 0, max: o.life, gravity: o.gravity ?? 12, drag: o.drag ?? 1.2 });
  }

  ring(x: number, z: number, color: string, life = 0.6, scale = 5) {
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    mesh.scale.setScalar(0.2);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, life: 0, max: life, scale });
  }

  update(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const k = b.life / b.max;
      if (k >= 1) {
        this.scene.remove(b.points);
        b.geo.dispose();
        b.mat.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const attr = b.geo.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      const damp = Math.exp(-b.drag * dt);
      for (let j = 0; j < arr.length; j += 3) {
        b.vel[j + 1] -= b.gravity * dt;
        b.vel[j] *= damp;
        b.vel[j + 1] *= damp;
        b.vel[j + 2] *= damp;
        arr[j] += b.vel[j] * dt;
        arr[j + 1] += b.vel[j + 1] * dt;
        arr[j + 2] += b.vel[j + 2] * dt;
        if (arr[j + 1] < 0.05) {
          // chạm sàn thì nảy nhẹ rồi lăn
          arr[j + 1] = 0.05;
          b.vel[j + 1] *= -0.3;
          b.vel[j] *= 0.6;
          b.vel[j + 2] *= 0.6;
        }
      }
      attr.needsUpdate = true;
      b.mat.opacity = 1 - k * k;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      const k = r.life / r.max;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(0.2 + k * r.scale);
      r.mat.opacity = (1 - k) * 0.9;
    }
  }

  dispose() {
    for (const b of this.bursts) {
      this.scene.remove(b.points);
      b.geo.dispose();
      b.mat.dispose();
    }
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.bursts = [];
    this.rings = [];
    this.ringGeo.dispose();
  }
}
