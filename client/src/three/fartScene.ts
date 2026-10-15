import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Plane,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import { sfx } from '../utils/sound';
import { FartCore } from '@shared/raftClient';
import {
  OB_ARM,
  OB_GATE,
  OB_ROCK,
  OB_SLIDER,
  OB_STRIDE,
  SEAT_X,
  SEAT_Y,
  S_A,
  S_FIN,
  S_SEG,
  S_SINK,
  S_VX,
  S_VY,
  S_W,
  obEval,
  obWarn,
  wrapPi,
  type Course,
} from '@shared/raft';

/** cầu nối giữa cảnh 3D và lớp điều khiển (chuột/cảm ứng) */
export interface FartBridge {
  /** màn hình -> toạ độ sàn (x, y của server); null nếu tia không chạm nước */
  pick: ((clientX: number, clientY: number) => [number, number] | null) | null;
  /** góc (toạ độ server) của hướng "lên màn hình" */
  camYaw: number;
}

export interface FartSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  core: FartCore;
  /** theo thứ tự chỗ ngồi của bè mình */
  team: { id: string; color: string; name: string }[];
  teamColors: string[];
  meId: string;
  labels: Map<string, HTMLElement | null>;
  teamLabels: (HTMLElement | null)[];
  bridge: FartBridge;
  serverNow: () => number;
  onFrame: () => void;
}

export const TEAM_COLORS = ['#ff7a45', '#4da3ff', '#c36bff', '#ffd23f'];
const GAS = '#8dff6a';
const TAU = Math.PI * 2;

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Puff {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  life: number;
  max: number;
  vx: number;
  vz: number;
  s0: number;
  s1: number;
  alive: boolean;
}

export function createFartScene(o: FartSceneOptions) {
  const core = o.core;
  const c: Course = core.c;

  // dời cả khóa học về gốc toạ độ để nền (đồi, mây) bao quanh đúng
  let minX = 1e9;
  let maxX = -1e9;
  let minY = 1e9;
  let maxY = -1e9;
  for (let i = 0; i < c.n; i++) {
    minX = Math.min(minX, c.px[i]);
    maxX = Math.max(maxX, c.px[i]);
    minY = Math.min(minY, c.py[i]);
    maxY = Math.max(maxY, c.py[i]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const wx = (x: number) => x - cx;
  const wz = (y: number) => -(y - cy);
  const gy = (z: number) => cy - z;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [(maxX - minX) / 2 + 50, (maxY - minY) / 2 + 50], groundY: -0.45, ground: true },
      sun: [-14, 30, 12],
      shadowBox: 13,
      fog: [60, 190],
    },
    (k) => {
      const { scene, camera } = k.engine;
      const rng = seeded(c.seed ^ 0x5eed);
      const m4 = new Matrix4();
      const quat = new Quaternion();
      const pos = new Vector3();
      const scl = new Vector3();
      const yAxis = new Vector3(0, 1, 0);
      const color = new Color();
      const ob5 = new Float64Array(5);

      /* ---------------- nước + bờ: dựng MỘT lần từ đường tâm ---------------- */
      const nT = (i: number): [number, number] => {
        const a = Math.max(0, i - 1);
        const b = Math.min(c.n - 2, i);
        let tx = c.tx[a] + c.tx[b];
        let ty = c.ty[a] + c.ty[b];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        return [tx, ty];
      };
      const edge = (i: number, lat: number): [number, number] => {
        const [tx, ty] = nT(i);
        return [c.px[i] - ty * lat, c.py[i] + tx * lat];
      };

      const waterTex = k.texture(256, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, '#2fa4e6');
        gr.addColorStop(0.5, '#3cbcf0');
        gr.addColorStop(1, '#2fa4e6');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        const r = seeded(99);
        g.lineCap = 'round';
        // vệt nước dài theo hướng chảy (dọc) + vòng gợn nhỏ, lặp được
        for (let i = 0; i < 46; i++) {
          const x = r() * w;
          const y = r() * h;
          const len = 14 + r() * 40;
          g.strokeStyle = `rgba(255,255,255,${0.1 + r() * 0.16})`;
          g.lineWidth = 1.5 + r() * 2;
          for (const oy of [-h, 0, h]) {
            g.beginPath();
            g.moveTo(x, y + oy);
            g.quadraticCurveTo(x + (r() - 0.5) * 16, y + oy + len / 2, x + (r() - 0.5) * 6, y + oy + len);
            g.stroke();
          }
        }
        for (let i = 0; i < 26; i++) {
          const x = r() * w;
          const y = r() * h;
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.beginPath();
          g.arc(x, y, 1 + r() * 1.6, 0, TAU);
          g.fill();
        }
      });
      waterTex.wrapS = waterTex.wrapT = RepeatWrapping;
      const waterTex2 = k.texture(128, 128, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        const r = seeded(7);
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.lineWidth = 2;
        for (let i = 0; i < 12; i++) {
          const x = r() * w;
          const y = r() * h;
          for (const ox of [-w, 0, w]) {
            for (const oy of [-h, 0, h]) {
              g.beginPath();
              g.arc(x + ox, y + oy, 5 + r() * 9, r() * 6, r() * 6 + 2);
              g.stroke();
            }
          }
        }
      });
      waterTex2.wrapS = waterTex2.wrapT = RepeatWrapping;

      const strip = (
        latA: (i: number) => number,
        latB: (i: number) => number,
        yA: number,
        yB: number,
        uvScale: number,
        colA?: [number, number, number],
        colB?: [number, number, number],
      ) => {
        const pos3 = new Float32Array(c.n * 6);
        const uv = new Float32Array(c.n * 4);
        const col = colA ? new Float32Array(c.n * 6) : null;
        const idx: number[] = [];
        for (let i = 0; i < c.n; i++) {
          const a = edge(i, latA(i));
          const b = edge(i, latB(i));
          pos3.set([wx(a[0]), yA, wz(a[1]), wx(b[0]), yB, wz(b[1])], i * 6);
          uv.set([(latA(i) + c.hw[i]) / uvScale, c.sa[i] / uvScale, (latB(i) + c.hw[i]) / uvScale, c.sa[i] / uvScale], i * 4);
          if (col && colA && colB) col.set([...colA, ...colB], i * 6);
          if (i < c.n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos3, 3));
        geo.setAttribute('uv', new BufferAttribute(uv, 2));
        if (col) geo.setAttribute('color', new BufferAttribute(col, 3));
        geo.setIndex(idx);
        return geo;
      };

      const water = new Mesh(
        strip((i) => c.hw[i] + 0.25, (i) => -c.hw[i] - 0.25, 0, 0, 8),
        new MeshBasicMaterial({ map: waterTex, side: DoubleSide }),
      );
      // ribbon vẽ theo thứ tự lat từ + sang - nên mặt hướng xuống ở một số đoạn: dùng DoubleSide
      scene.add(water);
      const water2 = new Mesh(
        strip((i) => c.hw[i] + 0.25, (i) => -c.hw[i] - 0.25, 0.03, 0.03, 5),
        new MeshBasicMaterial({ map: waterTex2, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }),
      );
      scene.add(water2);

      const sand: [number, number, number] = [0.94, 0.84, 0.55];
      const sand2: [number, number, number] = [0.9, 0.76, 0.45];
      const grass: [number, number, number] = [0.47, 0.84, 0.36];
      const grass2: [number, number, number] = [0.4, 0.76, 0.32];
      const bankMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
      for (const sg of [1, -1]) {
        const s1 = new Mesh(strip((i) => sg * (c.hw[i] + 0.1), (i) => sg * (c.hw[i] + 1.7), -0.12, 0.34, 8, sand, sand2), bankMat);
        const s2 = new Mesh(strip((i) => sg * (c.hw[i] + 1.7), (i) => sg * (c.hw[i] + 7), 0.34, 0.38, 8, grass, grass2), bankMat);
        scene.add(s1, s2);
      }

      /* ---------------- cây, đá bờ: InstancedMesh ---------------- */
      const nTrees = k.low ? 120 : 230;
      const treePos: [number, number, number][] = [];
      let guard = 0;
      while (treePos.length < nTrees && guard++ < nTrees * 20) {
        const i = 1 + Math.floor(rng() * (c.n - 3));
        const side = rng() < 0.5 ? 1 : -1;
        const lat = side * (c.hw[i] + 3 + rng() * 20);
        const [ex, ey] = edge(i, lat);
        let bad = false;
        for (let j = Math.max(0, i - 40); j < Math.min(c.n, i + 40); j++) {
          if (Math.hypot(c.px[j] - ex, c.py[j] - ey) < c.hw[j] + 3.5) {
            bad = true;
            break;
          }
        }
        if (!bad) treePos.push([ex, ey, 0.8 + rng() * 0.9]);
      }
      const foliage = new InstancedMesh(new ConeGeometry(1.5, 3.6, 7), new MeshLambertMaterial({ color: '#ffffff' }), treePos.length);
      const foliage2 = new InstancedMesh(new ConeGeometry(1.15, 2.6, 7), new MeshLambertMaterial({ color: '#ffffff' }), treePos.length);
      const trunk = new InstancedMesh(new CylinderGeometry(0.22, 0.3, 1.5, 6), new MeshLambertMaterial({ color: '#8a5a2b' }), treePos.length);
      const greens = ['#3fae4a', '#4cc05a', '#2f9a52', '#62cf62'];
      treePos.forEach(([x, y, sc], i) => {
        const X = wx(x);
        const Z = wz(y);
        scl.set(sc, sc, sc);
        m4.compose(pos.set(X, 0.4 + 0.75 * sc, Z), quat.identity(), scl);
        trunk.setMatrixAt(i, m4);
        m4.compose(pos.set(X, 0.4 + 1.5 * sc + 1.3 * sc, Z), quat.identity(), scl);
        foliage.setMatrixAt(i, m4);
        m4.compose(pos.set(X, 0.4 + 1.5 * sc + 2.9 * sc, Z), quat.identity(), scl);
        foliage2.setMatrixAt(i, m4);
        color.set(greens[i % greens.length]);
        foliage.setColorAt(i, color);
        foliage2.setColorAt(i, color);
      });
      scene.add(trunk, foliage, foliage2);

      /* ---------------- chướng ngại: GAI ---------------- */
      const rockIdx: number[] = [];
      const mineIdx: number[] = [];
      const dynIdx: number[] = [];
      for (let i = 0; i < c.nOb; i++) {
        if (c.obK[i] === OB_ROCK) (c.obSp[i] ? mineIdx : rockIdx).push(i);
        else dynIdx.push(i);
      }
      const rockMesh = new InstancedMesh(new IcosahedronGeometry(1, 1), k.lit({ color: '#ffffff', flatShading: true }), Math.max(1, rockIdx.length));
      rockIdx.forEach((oi, i) => {
        const f = c.ob;
        const o5 = oi * OB_STRIDE;
        const r = f[o5 + 2];
        quat.setFromAxisAngle(yAxis, rng() * TAU);
        scl.set(r, r * 0.85, r * (0.9 + rng() * 0.2));
        m4.compose(pos.set(wx(f[o5]), r * 0.3, wz(f[o5 + 1])), quat, scl);
        rockMesh.setMatrixAt(i, m4);
        color.set(['#8d8a86', '#9b958d', '#7b7f86'][i % 3]);
        rockMesh.setColorAt(i, color);
      });
      rockMesh.count = rockIdx.length;
      scene.add(rockMesh);

      const spikeGeo = new ConeGeometry(0.15, 0.5, 6);
      const spikeMat = new MeshLambertMaterial({ color: '#e8edf6' });
      const upV = new Vector3(0, 1, 0);
      const dirV = new Vector3();
      /** đặt một gai: gốc (bx,by,bz), hướng (dx,dy,dz), dài len */
      const putSpike = (mesh: InstancedMesh, idx: number, bx: number, by: number, bz: number, dx: number, dy: number, dz: number, len: number, thick = 1) => {
        dirV.set(dx, dy, dz).normalize();
        quat.setFromUnitVectors(upV, dirV);
        scl.set(thick, len / 0.5, thick);
        m4.compose(pos.set(bx + dirV.x * len * 0.5, by + dirV.y * len * 0.5, bz + dirV.z * len * 0.5), quat, scl);
        mesh.setMatrixAt(idx, m4);
      };

      // MÌN GAI: quả cầu thép + gai toả đều
      const mineDirs: [number, number, number][] = [];
      {
        const t = (1 + Math.sqrt(5)) / 2;
        for (const [a, b] of [[1, t], [-1, t], [1, -t], [-1, -t]]) {
          mineDirs.push([0, a, b], [a, b, 0], [b, 0, a]);
        }
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) mineDirs.push([x, y, z]);
      }
      const mineBody = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshLambertMaterial({ color: '#3b414d' }), Math.max(1, mineIdx.length));
      const mineSpikes = new InstancedMesh(spikeGeo, spikeMat, Math.max(1, mineIdx.length * mineDirs.length));
      const mineRing = new InstancedMesh(
        new CircleGeometry(1, 24),
        new MeshBasicMaterial({ color: '#ff4a3d', transparent: true, opacity: 0.3, depthWrite: false }),
        Math.max(1, mineIdx.length),
      );
      mineIdx.forEach((oi, i) => {
        const f = c.ob;
        const o5 = oi * OB_STRIDE;
        const r = f[o5 + 2];
        const X = wx(f[o5]);
        const Z = wz(f[o5 + 1]);
        quat.identity();
        scl.setScalar(r * 0.6);
        m4.compose(pos.set(X, 0.25, Z), quat, scl);
        mineBody.setMatrixAt(i, m4);
        mineDirs.forEach((d, q) => putSpike(mineSpikes, i * mineDirs.length + q, X, 0.25, Z, d[0], d[1], d[2], r * 1.05, 1.1));
        quat.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
        scl.set(r + 0.6, r + 0.6, 1);
        m4.compose(pos.set(X, 0.06, Z), quat, scl);
        mineRing.setMatrixAt(i, m4);
      });
      mineBody.count = mineIdx.length;
      mineSpikes.count = mineIdx.length * mineDirs.length;
      mineRing.count = mineIdx.length;
      scene.add(mineBody, mineSpikes, mineRing);

      // GAI Ở BỜ: hàng gai nghiêng vào lòng sông + dải cảnh báo đỏ-trắng
      {
        const pts: [number, number][] = [];
        for (let i = 1; i < c.n - 1; i++) {
          if (c.spL[i]) pts.push([i, 1]);
          if (c.spR[i]) pts.push([i, -1]);
        }
        const per = 3;
        const bank = new InstancedMesh(spikeGeo, spikeMat, Math.max(1, pts.length * per));
        const tilt = Math.sin((50 * Math.PI) / 180);
        const tcos = Math.cos((50 * Math.PI) / 180);
        pts.forEach(([i, sg], q) => {
          const [tx, ty] = nT(i);
          for (let u = 0; u < per; u++) {
            const along = (u / per - 0.33) * c.ds;
            const lat = sg * (c.hw[i] + 0.15);
            const ex = c.px[i] - ty * lat + tx * along;
            const ey = c.py[i] + tx * lat + ty * along;
            // hướng vào sông (ngược dấu lat) và lên trên
            const inX = ty * sg;
            const inY = -tx * sg;
            putSpike(bank, q * per + u, wx(ex), 0.3, wz(ey), inX * tilt, tcos, -inY * tilt, 1.0 + rng() * 0.25, 1.25);
          }
        });
        bank.count = pts.length * per;
        scene.add(bank);
        const verts: number[] = [];
        const cols: number[] = [];
        const idxs: number[] = [];
        let vi = 0;
        for (const sg of [1, -1]) {
          for (let i = 1; i < c.n - 2; i++) {
            const on = sg > 0 ? c.spL[i] && c.spL[i + 1] : c.spR[i] && c.spR[i + 1];
            if (!on) continue;
            const a = edge(i, sg * (c.hw[i] + 0.05));
            const b = edge(i, sg * (c.hw[i] + 1.1));
            const a2 = edge(i + 1, sg * (c.hw[i + 1] + 0.05));
            const b2 = edge(i + 1, sg * (c.hw[i + 1] + 1.1));
            verts.push(wx(a[0]), 0.36, wz(a[1]), wx(b[0]), 0.36, wz(b[1]), wx(a2[0]), 0.36, wz(a2[1]), wx(b2[0]), 0.36, wz(b2[1]));
            const red = i % 2 === 0;
            for (let q = 0; q < 4; q++) cols.push(red ? 0.9 : 1, red ? 0.25 : 0.95, red ? 0.2 : 0.9);
            idxs.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
            vi += 4;
          }
        }
        if (vi > 0) {
          const g = new BufferGeometry();
          g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
          g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
          g.setIndex(idxs);
          scene.add(new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })));
        }
      }

      const redMat = k.lit({ color: '#e0453a' });
      const steel = k.lit({ color: '#4a4f5c' });
      const stripeTex = k.texture(64, 16, (g, w, h) => {
        g.fillStyle = '#ffd23f';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#2b2b33';
        for (let x = -h; x < w; x += 16) {
          g.beginPath();
          g.moveTo(x, h);
          g.lineTo(x + 8, h);
          g.lineTo(x + 8 + h, 0);
          g.lineTo(x + h, 0);
          g.closePath();
          g.fill();
        }
      });
      stripeTex.wrapS = RepeatWrapping;

      interface Dyn {
        i: number;
        kind: number;
        group: Group;
        bar?: Mesh;
        spikes?: InstancedMesh;
        lampMat?: MeshBasicMaterial;
        len: number;
        spikeStep?: number;
      }
      const dyns: Dyn[] = [];
      for (const oi of dynIdx) {
        const kind = c.obK[oi];
        const o5 = oi * OB_STRIDE;
        const f = c.ob;
        const group = new Group();
        const d: Dyn = { i: oi, kind, group, len: 1 };
        if (kind === OB_SLIDER) {
          // THANH GAI TRƯỢT: trục dọc theo z cục bộ, gai toả 5 hướng
          const hl = f[o5 + 6];
          const bar = new Mesh(new CylinderGeometry(0.3, 0.3, hl * 2 + 0.6, 10), steel);
          bar.rotation.x = Math.PI / 2;
          bar.position.y = 0.3;
          group.add(bar);
          const dirs: [number, number, number][] = [[0, 1, 0], [1, 0.4, 0], [-1, 0.4, 0], [0.7, 0.9, 0], [-0.7, 0.9, 0]];
          const nz = 7;
          const sp = new InstancedMesh(spikeGeo, spikeMat, nz * dirs.length);
          for (let z = 0; z < nz; z++) {
            const zz = -hl + (z / (nz - 1)) * hl * 2;
            dirs.forEach((dv, q) => putSpike(sp, z * dirs.length + q, dv[0] * 0.2, 0.3 + dv[1] * 0.2, zz, dv[0], dv[1], 0, 0.65));
          }
          group.add(sp);
          // ray + phao ở hai đầu hành trình: dấu hiệu "thanh gai quét ngang"
          const A = f[o5 + 7];
          const railGeo = new PlaneGeometry(A * 2.1, 0.35);
          railGeo.rotateX(-Math.PI / 2);
          const rail = new Mesh(railGeo, new MeshBasicMaterial({ map: stripeTex, transparent: true, opacity: 0.55, depthWrite: false }));
          rail.position.set(wx(f[o5]), 0.06, wz(f[o5 + 1]));
          rail.rotation.y = Math.atan2(f[o5 + 3], f[o5 + 2]);
          scene.add(rail);
          const buoyGeo = new SphereGeometry(0.4, 10, 8);
          for (const sg of [-1, 1]) {
            const b = new Mesh(buoyGeo, redMat);
            b.position.set(wx(f[o5] + f[o5 + 2] * A * sg * 1.08), 0.25, wz(f[o5 + 1] + f[o5 + 3] * A * sg * 1.08));
            scene.add(b);
          }
        } else if (kind === OB_ARM) {
          // THANH GAI QUAY: thân thép dọc x cục bộ, gai trên/trước/sau, trục giữa đỏ
          const L = f[o5 + 2];
          const bar = new Mesh(new BoxGeometry(L * 2, 0.36, 0.36), steel);
          bar.position.y = 0.3;
          const hub = new Mesh(new CylinderGeometry(0.75, 0.9, 1.1, 14), redMat);
          hub.position.y = 0.45;
          group.add(bar, hub);
          const nx = Math.max(3, Math.floor((L * 2) / 0.6));
          const dirs: [number, number, number][] = [[0, 1, 0], [0, 0.3, 1], [0, 0.3, -1]];
          const sp = new InstancedMesh(spikeGeo, spikeMat, nx * dirs.length);
          for (let x = 0; x < nx; x++) {
            const xx = -L + ((x + 0.5) / nx) * L * 2;
            dirs.forEach((dv, q) => putSpike(sp, x * dirs.length + q, xx, 0.3 + dv[1] * 0.15, dv[2] * 0.15, dv[0], dv[1], dv[2], 0.65));
          }
          group.add(sp);
        } else {
          // CỔNG GAI: trụ ở bờ + thanh gai trượt ra + đèn báo (đỏ nhấp nháy trước khi đóng)
          const post = new Mesh(new CylinderGeometry(0.45, 0.55, 2.4, 10), k.lit({ color: '#ffffff', map: stripeTex }));
          post.position.y = 1.0;
          const bar = new Mesh(new BoxGeometry(1, 0.36, 0.36), steel);
          bar.position.y = 0.3;
          bar.geometry.translate(0.5, 0, 0);
          const lampMat = new MeshBasicMaterial({ color: '#59ff7a' });
          const lamp = new Mesh(new SphereGeometry(0.4, 10, 8), lampMat);
          lamp.position.y = 2.5;
          group.add(post, bar, lamp);
          const step = 0.7;
          const nx = Math.ceil((f[o5 + 4] + 0.5) / step);
          const dirs: [number, number, number][] = [[0, 1, 0], [0, 0.3, 1], [0, 0.3, -1]];
          const sp = new InstancedMesh(spikeGeo, spikeMat, nx * dirs.length);
          for (let x = 0; x < nx; x++) dirs.forEach((dv, q) => putSpike(sp, x * dirs.length + q, 0.45 + x * step, 0.3 + dv[1] * 0.15, dv[2] * 0.15, dv[0], dv[1], dv[2], 0.65));
          group.add(sp);
          d.bar = bar;
          d.spikes = sp;
          d.spikeStep = step;
          d.lampMat = lampMat;
          d.len = f[o5 + 4];
        }
        dyns.push(d);
        scene.add(group);
      }

      /* ---------------- xoáy nước ---------------- */
      const spiralTex = k.texture(128, 128, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.translate(w / 2, h / 2);
        for (let arm = 0; arm < 4; arm++) {
          g.beginPath();
          for (let t = 0; t <= 1.0001; t += 0.02) {
            const rr = 4 + t * (w / 2 - 6);
            const a = arm * (TAU / 4) + t * 3.2;
            const x = Math.cos(a) * rr;
            const y = Math.sin(a) * rr;
            if (t === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.strokeStyle = 'rgba(255,255,255,0.75)';
          g.lineWidth = 5;
          g.lineCap = 'round';
          g.stroke();
        }
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
        rg.addColorStop(0, 'rgba(10,60,120,0.55)');
        rg.addColorStop(1, 'rgba(10,60,120,0)');
        g.fillStyle = rg;
        g.fillRect(-w / 2, -h / 2, w, h);
      });
      const whirls: { mesh: Mesh; dir: number }[] = [];
      for (let q = 0; q < c.nWh; q++) {
        const R = c.wh[q * 4 + 2];
        const mesh = new Mesh(
          new CircleGeometry(R, 40),
          new MeshBasicMaterial({ map: spiralTex, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(wx(c.wh[q * 4]), 0.05, wz(c.wh[q * 4 + 1]));
        scene.add(mesh);
        whirls.push({ mesh, dir: c.wh[q * 4 + 3] > 0 ? 1 : -1 });
      }

      /* ---------------- vòm cột mốc + vạch đích ---------------- */
      const checker = k.texture(128, 32, (g, w, h) => {
        const s = 16;
        for (let y = 0; y < h; y += s) {
          for (let x = 0; x < w; x += s) {
            g.fillStyle = ((x + y) / s) % 2 ? '#1c1c24' : '#ffffff';
            g.fillRect(x, y, s, s);
          }
        }
      });
      const arch = (sPos: number, label: 'start' | 'cp' | 'fin') => {
        const i = Math.min(c.n - 2, Math.round(sPos / c.ds));
        const hwH = c.hw[i] + 0.9;
        const [tx, ty] = nT(i);
        const yaw = Math.atan2(ty, tx);
        const g = new Group();
        const poleMat = k.lit({ color: label === 'fin' ? '#ffffff' : '#ffcf40' });
        for (const sg of [-1, 1]) {
          const pole = new Mesh(new CylinderGeometry(0.28, 0.34, 7.4, 8), poleMat);
          pole.position.set(0, 3.5, sg * hwH);
          g.add(pole);
        }
        const beamMat =
          label === 'fin'
            ? new MeshBasicMaterial({ map: checker })
            : label === 'start'
              ? new MeshBasicMaterial({ color: '#5bd16e' })
              : new MeshBasicMaterial({ color: '#ffcf40' });
        (beamMat as MeshBasicMaterial).map?.repeat.set(hwH / 2, 1);
        if ((beamMat as MeshBasicMaterial).map) (beamMat as MeshBasicMaterial).map!.wrapS = RepeatWrapping;
        const beam = new Mesh(new BoxGeometry(0.9, 0.9, hwH * 2), beamMat);
        beam.position.set(0, 7, 0);
        g.add(beam);
        g.position.set(wx(c.px[i]), 0, wz(c.py[i]));
        g.rotation.y = yaw;
        scene.add(g);
      };
      {
        // vạch xuất phát: dải sọc dưới nước, không dựng vòm để khỏi che camera
        const i = Math.min(c.n - 2, Math.round(c.cpS[0] / c.ds));
        const [tx, ty] = nT(i);
        const lg = new PlaneGeometry(0.9, c.hw[i] * 2);
        lg.rotateX(-Math.PI / 2);
        const line = new Mesh(lg, new MeshBasicMaterial({ map: checker, transparent: true, opacity: 0.85, depthWrite: false }));
        line.position.set(wx(c.px[i]) + tx * 3, 0.07, wz(c.py[i]) - ty * 3);
        line.rotation.y = Math.atan2(ty, tx);
        scene.add(line);
      }
      for (let q = 1; q < 4; q++) arch(c.cpS[q], 'cp');
      arch(c.finishS, 'fin');

      /* ---------------- bè ---------------- */
      const raft = new Group();
      const logMat = k.lit({ color: '#c28a50' });
      const logGeo = new CylinderGeometry(0.3, 0.3, 2.7, 10);
      for (let i = 0; i < 6; i++) {
        const log = new Mesh(logGeo, logMat);
        log.rotation.x = Math.PI / 2;
        log.position.set(-1.45 + i * 0.58, 0.12, 0);
        log.castShadow = true;
        log.receiveShadow = true;
        raft.add(log);
      }
      const beamGeo = new BoxGeometry(3.7, 0.14, 0.2);
      const beamMat = k.lit({ color: '#8a5a2b' });
      for (const z of [-0.7, 0.7]) {
        const b = new Mesh(beamGeo, beamMat);
        b.position.set(0, 0.46, z);
        b.castShadow = true;
        raft.add(b);
      }
      const ropeMat = k.lit({ color: '#e8d8a8' });
      for (const x of [-1.2, 0, 1.2]) {
        for (const z of [-0.7, 0.7]) {
          const r = new Mesh(new TorusGeometry(0.22, 0.04, 6, 14), ropeMat);
          r.rotation.y = Math.PI / 2;
          r.position.set(x, 0.42, z);
          raft.add(r);
        }
      }
      // đệm ngồi theo màu từng người
      const seatDiscs: Mesh[] = [];
      const seatGeo = new CylinderGeometry(0.33, 0.33, 0.1, 14);
      for (let s = 0; s < o.team.length; s++) {
        const slot = core.sim.slots[s];
        const disc = new Mesh(seatGeo, new MeshLambertMaterial({ color: o.team[s].color }));
        disc.position.set(SEAT_X[slot], 0.5, -SEAT_Y[slot]);
        raft.add(disc);
        seatDiscs.push(disc);
      }
      scene.add(raft);

      const chars: Character3D[] = [];
      const charT: { fireAt: number; hitAt: number }[] = [];
      const puffT: number[] = [0, 0, 0, 0];
      const ringT: number[] = [0, 0, 0, 0];
      const sndT: number[] = [0, 0, 0, 0];
      for (let s = 0; s < o.team.length; s++) {
        const slot = core.sim.slots[s];
        const ch = k.kit.create(o.team[s].color, o.team[s].id === o.meId);
        ch.root.scale.setScalar(0.95);
        ch.root.position.set(SEAT_X[slot], 0.52, -SEAT_Y[slot]);
        raft.add(ch.root);
        ch.setShadows(!k.low);
        chars.push(ch);
        charT.push({ fireAt: -9, hitAt: -9 });
      }

      /* ---------------- mũi tên hướng xì ---------------- */
      const arrows: { g: Group; shaft: Mesh; head: Mesh; mat: MeshBasicMaterial }[] = [];
      const shaftGeo = new BoxGeometry(1, 0.06, 0.16);
      shaftGeo.translate(0.5, 0, 0);
      const headGeo = new ConeGeometry(0.34, 0.7, 10);
      headGeo.rotateZ(-Math.PI / 2);
      for (let s = 0; s < o.team.length; s++) {
        const mat = new MeshBasicMaterial({ color: s === core.mySeat ? GAS : o.team[s].color, transparent: true, opacity: s === core.mySeat ? 0.95 : 0.6, depthWrite: false, depthTest: false });
        const g = new Group();
        const shaft = new Mesh(shaftGeo, mat);
        const head = new Mesh(headGeo, mat);
        g.add(shaft, head);
        g.position.y = 0.12;
        g.renderOrder = 20;
        shaft.renderOrder = 20;
        head.renderOrder = 20;
        scene.add(g);
        arrows.push({ g, shaft, head, mat });
      }

      /* ---------------- bè của các đội khác ---------------- */
      const ghostRafts: (Group | null)[] = [];
      for (let ti = 0; ti < core.nTeams; ti++) {
        if (ti === core.myTeam) {
          ghostRafts.push(null);
          continue;
        }
        const col = o.teamColors[ti % o.teamColors.length];
        const g = new Group();
        const mat = new MeshLambertMaterial({ color: '#d9a566', transparent: true, opacity: 0.6 });
        const deck = new Mesh(new BoxGeometry(3.6, 0.4, 2.5), mat);
        deck.position.y = 0.2;
        const flagMat = new MeshLambertMaterial({ color: col, transparent: true, opacity: 0.85 });
        const pole = new Mesh(new CylinderGeometry(0.05, 0.05, 2.2, 6), flagMat);
        pole.position.set(0, 1.3, 0);
        const flag = new Mesh(new BoxGeometry(0.9, 0.5, 0.05), flagMat);
        flag.position.set(0.45, 2.1, 0);
        const stripe = new Mesh(new BoxGeometry(3.7, 0.1, 0.5), flagMat);
        stripe.position.set(0, 0.45, 0);
        g.add(deck, pole, flag, stripe);
        scene.add(g);
        ghostRafts.push(g);
      }

      /* ---------------- hạt khí (pool) ---------------- */
      const puffs: Puff[] = [];
      const puffGeo = new SphereGeometry(0.5, 10, 8);
      const puffCount = k.count(44);
      const puffCols = ['#9dff7a', '#6aeb8c', '#c8ff8f', '#7be37a'];
      for (let i = 0; i < puffCount; i++) {
        const mat = new MeshBasicMaterial({ color: puffCols[i % 4], transparent: true, opacity: 0, depthWrite: false });
        const mesh = new Mesh(puffGeo, mat);
        mesh.visible = false;
        scene.add(mesh);
        puffs.push({ mesh, mat, life: 0, max: 1, vx: 0, vz: 0, s0: 0.3, s1: 1, alive: false });
      }
      let puffNext = 0;
      const spawnPuff = (x: number, z: number, vx: number, vz: number, s1: number, life: number, age = 0) => {
        const p = puffs[puffNext++ % puffs.length];
        p.alive = true;
        p.life = age;
        p.max = life;
        p.vx = vx;
        p.vz = vz;
        p.s0 = 0.28;
        p.s1 = s1;
        p.mesh.position.set(x + vx * age, 0.35 + Math.random() * 0.25, z + vz * age);
        p.mesh.visible = true;
      };

      const seatTmp = new Float64Array(2);
      const seatPos = (s: number, out: Vector3) => {
        out.set(wx(core.seatX(s)), 0.5, wz(core.seatY(s)));
        return out;
      };
      const v3 = new Vector3();

      /* ---------------- picking chuột ---------------- */
      const ray = new Raycaster();
      const ndc = new Vector2();
      const plane = new Plane(new Vector3(0, 1, 0), -0.3);
      const hit = new Vector3();
      o.bridge.pick = (clientX, clientY) => {
        const r = o.host.getBoundingClientRect();
        ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
        ray.setFromCamera(ndc, camera);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return [hit.x + cx, gy(hit.z)];
      };

      /* ---------------- camera ---------------- */
      const focus = new Vector3();
      const camPos = new Vector3();
      const lookAt = new Vector3();
      let camYaw = Math.atan2(c.ty[0], c.tx[0]);
      let first = true;

      let hitFlash = 0;
      let time = 0;
      const ghostTmp = new Float64Array(3);
      const camBack = 9.5;
      const camUp = 12.5;

      return {
        frame(dt: number, t: number) {
          time = t;
          const mono = performance.now();
          core.frame(mono, o.serverNow());
          const S = core.sim.S;

          // dòng nước trôi + xoáy
          waterTex.offset.y -= dt * 0.19;
          waterTex2.offset.y -= dt * 0.13;
          waterTex2.offset.x += dt * 0.02;
          for (const w of whirls) w.mesh.rotation.z += dt * 1.6 * -w.dir;
          const tk = core.tick + core.frac;

          // chướng ngại động theo giờ
          for (const d of dyns) {
            obEval(c, d.i, tk, ob5);
            const ax = wx(ob5[0]);
            const az = wz(ob5[1]);
            if (d.kind === OB_SLIDER) {
              d.group.position.set((ax + wx(ob5[2])) / 2, 0, (az + wz(ob5[3])) / 2);
              d.group.rotation.y = Math.atan2(ob5[2] - ob5[0], -(ob5[3] - ob5[1]));
            } else if (d.kind === OB_ARM) {
              d.group.position.set((ax + wx(ob5[2])) / 2, 0, (az + wz(ob5[3])) / 2);
              d.group.rotation.y = Math.atan2(ob5[3] - ob5[1], ob5[2] - ob5[0]);
            } else if (d.kind === OB_GATE) {
              d.group.position.set(ax, 0, az);
              const ex = ob5[2] - ob5[0];
              const ey = ob5[3] - ob5[1];
              const len = Math.hypot(ex, ey);
              d.group.rotation.y = Math.atan2(c.ob[d.i * OB_STRIDE + 3], c.ob[d.i * OB_STRIDE + 2]);
              d.bar!.scale.x = Math.max(0.001, len);
              d.bar!.visible = len > 0.05;
              const warn = obWarn(c, d.i, Math.floor(tk));
              const closing = len > 0.05;
              const flash = warn > 0 ? (Math.sin(time * 18) > 0 ? 1 : 0.3) : 0;
              d.spikes!.count = closing ? 3 * Math.max(0, Math.floor((len - 0.3) / d.spikeStep!) + 1) : 0;
              d.lampMat!.color.set(warn > 0 ? (flash > 0.5 ? '#ff3b30' : '#7a1f1a') : closing ? '#ff6a3d' : '#59ff7a');
            }
          }

          // ---- bè (pose đã nội suy + hoà trộn) ----
          const rx = wx(core.px);
          const rz = wz(core.py);
          raft.position.set(rx, 0.02 + Math.sin(time * 2.3) * 0.035, rz);
          raft.rotation.y = core.pa;
          raft.rotation.x = Math.max(-0.12, Math.min(0.12, -S[S_W] * 0.05)) + Math.sin(time * 1.7) * 0.012;
          raft.rotation.z = Math.sin(time * 1.3) * 0.015;
          const sinking = S[S_SINK] > 0;
          if (sinking) {
            raft.position.y -= Math.min(1.6, (150 - S[S_SINK]) * 0.02);
            raft.rotation.z += 0.3;
          }
          const fin = S[S_FIN] > 0;

          // ---- sự kiện ----
          const fxs = core.fx;
          for (let q = 0; q < fxs.length; q++) {
            const e = fxs[q];
            if (e.kind === 'fart') {
              const sx = seatPos(e.seat, v3);
              const a = e.a;
              const ageS = Math.max(0, (core.tick - e.tick) / 60);
              const n = 2 + Math.round(e.p * 4);
              for (let j = 0; j < n; j++) {
                const sp = (1.5 + e.p * 4.5) * (0.6 + Math.random() * 0.7);
                const aa = a + (Math.random() - 0.5) * 0.7;
                spawnPuff(sx.x + Math.cos(aa) * 0.5, sx.z - Math.sin(aa) * 0.5, Math.cos(aa) * sp, -Math.sin(aa) * sp, 0.9 + e.p * 1.5 + Math.random() * 0.5, 0.55 + e.p * 0.45, ageS * 0.6);
              }
              k.effects.ring(sx.x + Math.cos(a) * 0.6, sx.z - Math.sin(a) * 0.6, '#bfffd0', 0.7, 2 + e.p * 3);
              if (k.count(8) > 0) {
                k.effects.burst(sx.x + Math.cos(a) * 0.8, 0.5, sx.z - Math.sin(a) * 0.8, {
                  count: k.count(6 + Math.round(e.p * 8)),
                  palette: ['#d6ffe0', '#9dff7a', '#ffffff'],
                  speed: 1.8 + e.p * 2,
                  life: 0.7,
                  size: 0.2,
                  gravity: -2.5,
                });
              }
              if (e.seat < charT.length) charT[e.seat].fireAt = time;
              if (!e.mine) sfx.fart(e.p, 0.5);
            } else if (e.kind === 'hit') {
              hitFlash = 1;
              const v = e.v ?? 2;
              k.effects.burst(rx, 0.6, rz, { count: k.count(16), palette: ['#ffffff', '#bfe9ff', '#9dd5f5'], speed: 2.5 + v, life: 0.8, size: 0.25, gravity: 6 });
              k.shake(Math.min(0.9, v * 0.16));
              sfx.miss();
              for (const ct of charT) ct.hitAt = time;
            } else if (e.kind === 'sink') {
              k.effects.burst(rx, 0.3, rz, { count: k.count(40), palette: ['#ffffff', '#7fd0ff', '#b6ecff'], speed: 4.5, life: 1.2, size: 0.3, gravity: 5 });
              k.effects.ring(rx, rz, '#ffffff', 1, 6);
              sfx.miss();
              for (let i = 0; i < 3; i++) setTimeout(() => sfx.tick(), i * 160);
            } else if (e.kind === 'respawn') {
              k.effects.ring(rx, rz, '#ffd23f', 0.8, 5);
              sfx.start();
            } else if (e.kind === 'fin') {
              if (e.mine) {
                sfx.winner();
                k.effects.burst(rx, 2.5, rz, { count: k.count(50), palette: ['#ffd166', '#ff5e8a', '#5ed67a', '#ffffff'], speed: 6, life: 1.4, size: 0.2, gravity: 4 });
              } else sfx.tick();
            } else if (e.kind === 'empty') sfx.tap();
          }
          fxs.length = 0;

          // ---- người ngồi + mũi tên ----
          for (let s = 0; s < chars.length; s++) {
            const ch = chars[s];
            const isMe = s === core.mySeat;
            const aimA = core.seatAim(s);
            const charge = core.seatPower(s);
            // khí xì LIÊN TỤC khi đang giữ
            if (charge > 0 && !sinking) {
              puffT[s] -= dt;
              if (puffT[s] <= 0) {
                puffT[s] = k.low ? 0.1 : 0.06;
                const sp0 = seatPos(s, v3);
                const sp = 2.2 + charge * 2.6;
                for (let j = 0; j < (k.low ? 1 : 2); j++) {
                  const aa = aimA + (Math.random() - 0.5) * 0.55;
                  spawnPuff(sp0.x + Math.cos(aa) * 0.5, sp0.z - Math.sin(aa) * 0.5, Math.cos(aa) * sp, -Math.sin(aa) * sp, 0.8 + charge * 0.9 + Math.random() * 0.4, 0.5 + charge * 0.25);
                }
              }
              ringT[s] -= dt;
              if (ringT[s] <= 0) {
                ringT[s] = 0.32;
                const sp0 = seatPos(s, v3);
                k.effects.ring(sp0.x + Math.cos(aimA) * 0.7, sp0.z - Math.sin(aimA) * 0.7, '#bfffd0', 0.6, 2.4);
              }
              charT[s].fireAt = time;
              // âm thanh lặp nhẹ: của mình rõ hơn, của đồng đội nhỏ
              sndT[s] -= dt;
              if (sndT[s] <= 0) {
                sndT[s] = isMe ? 0.15 : 0.28;
                sfx.fart(0.2 + charge * 0.15, isMe ? 0.55 : 0.18);
              }
            } else {
              puffT[s] = 0;
              sndT[s] = 0;
            }
            // mặt quay ra NGƯỢC hướng xì (đít hướng về phía xì)
            const worldYaw = Math.atan2(-Math.cos(aimA), Math.sin(aimA));
            ch.setYaw(worldYaw - core.pa);
            const sinceFire = charge > 0 ? 0 : time - charT[s].fireAt;
            const sinceHit = time - charT[s].hitAt;
            const pose = fin ? 'cheer' : sinking ? 'sad' : sinceHit < 0.5 ? 'hit' : charge > 0.05 ? 'pull' : sinceFire < 0.2 ? 'punch' : 'idle';
            ch.update(dt, { speed: 0, dead: false, time, pose });
            const sq = charge > 0.05 ? charge : 0;
            ch.root.scale.set(0.95 + sq * 0.07, 0.95 - sq * 0.06, 0.95 + sq * 0.07);
            const sx = seatPos(s, v3);
            const ar = arrows[s];
            const len = 1.1 + charge * 2.4;
            ar.g.position.set(sx.x, 0.7, sx.z);
            ar.g.rotation.y = aimA;
            ar.shaft.scale.x = len;
            ar.head.position.x = len + 0.15;
            ar.g.visible = !sinking;
            ar.mat.opacity = isMe ? 0.95 : 0.35 + charge * 0.45;
            // nhãn tên
            k.label(o.labels.get(o.team[s].id), sx.x, 2.1, sx.z);
          }

          // ---- bè khác ----
          const renderAt = core.serverMs - 190;
          for (let ti = 0; ti < ghostRafts.length; ti++) {
            const g = ghostRafts[ti];
            if (!g) continue;
            if (core.ghostPose(ti, renderAt, ghostTmp)) {
              g.visible = true;
              g.position.set(wx(ghostTmp[0]), 0.05 + Math.sin(time * 2 + ti) * 0.03, wz(ghostTmp[1]));
              g.rotation.y = ghostTmp[2];
              k.label(o.teamLabels[ti], wx(ghostTmp[0]), 3.2, wz(ghostTmp[1]));
            } else g.visible = false;
          }

          // ---- hạt khí ----
          for (const p of puffs) {
            if (!p.alive) continue;
            p.life += dt;
            const u = p.life / p.max;
            if (u >= 1) {
              p.alive = false;
              p.mesh.visible = false;
              continue;
            }
            const drag = Math.exp(-dt * 2.2);
            p.vx *= drag;
            p.vz *= drag;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.z += p.vz * dt;
            p.mesh.position.y += dt * 0.5;
            p.mesh.scale.setScalar(p.s0 + (p.s1 - p.s0) * Math.sqrt(u));
            p.mat.opacity = 0.75 * (1 - u) * (1 - u * 0.3);
          }

          // ---- camera: thứ ba chéo từ trên xuống, bám theo bè, nhìn trước theo vận tốc ----
          const i0 = Math.min(c.n - 2, S[S_SEG] | 0);
          const ty = Math.atan2(c.ty[i0], c.tx[i0]);
          if (first) {
            camYaw = ty;
            focus.set(rx, 0, rz);
            first = false;
          }
          camYaw += wrapPi(ty - camYaw) * (1 - Math.exp(-dt * 1.8));
          o.bridge.camYaw = camYaw;
          const look = 0.55;
          const tx = rx + S[S_VX] * look;
          const tz = rz - S[S_VY] * look;
          const kf = 1 - Math.exp(-dt * 7);
          focus.x += (tx - focus.x) * kf;
          focus.z += (tz - focus.z) * kf;
          // hạn chế để bè luôn trong khung hình
          const maxOff = 3.2;
          const dx = rx - focus.x;
          const dz = rz - focus.z;
          const dl = Math.hypot(dx, dz);
          if (dl > maxOff) {
            focus.x = rx - (dx / dl) * maxOff;
            focus.z = rz - (dz / dl) * maxOff;
          }
          const fxw = Math.cos(camYaw);
          const fzw = -Math.sin(camYaw);
          camPos.set(focus.x - fxw * camBack, camUp, focus.z - fzw * camBack);
          lookAt.set(focus.x + fxw * 4, 0, focus.z + fzw * 4);
          k.look(camPos, lookAt);
          k.sun.target.position.set(focus.x, 0, focus.z);
          k.sun.position.set(focus.x - 14, 30, focus.z + 12);
          hitFlash = Math.max(0, hitFlash - dt * 3);

          o.onFrame();
        },
        dispose() {
          o.bridge.pick = null;
        },
      };
    },
  );
}
