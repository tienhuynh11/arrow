import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import { CELL_CRATE, CELL_WALL } from '@shared/bombMaze';
import type { BmBomb, BmConfig, BmFx, BmPlayer } from '../games/bombmaze/useBombMazeGame';

export interface BombMazeFrame {
  cfg: BmConfig;
  grid: { current: { cols: number; rows: number; cells: Uint8Array } };
  gridVer: { current: number };
  bombs: { current: Map<number, BmBomb> };
  flames: { current: Map<number, number> };
  items: { current: Map<number, string> };
  snap: { current: Record<string, BmPlayer> };
  fx: { current: BmFx[] };
  me: { current: { x: number; y: number } };
  closing(serverNow: number): { closed: number; warnTo: number };
  predict(serverNow: number): void;
  serverNow(): number;
}

export interface BombMazeSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => BombMazeFrame;
  labels: Map<string, HTMLElement | null>;
}

/** một ô của lưới = TS đơn vị 3D */
const TS = 1.8;
const PITCH = (68 * Math.PI) / 180;
const CHAR_SCALE = 1.25;
const WALL_H = 1.5;
const CRATE_H = 1.25;
const ITEM_POOL = 48;
const BOMB_POOL = 64;
const KIND_COLOR: Record<string, string> = { b: '#8a5bff', f: '#ff7a1a', s: '#2fd6a0', h: '#3aa8ff' };

export function createBombMazeScene(o: BombMazeSceneOptions) {
  const cfg = o.read().cfg;
  const { cols, rows } = cfg;
  const cells = cols * rows;
  const W = cols * TS;
  const H = rows * TS;
  const wx = (cx: number) => (cx + 0.5) * TS - W / 2;
  const wz = (cy: number) => (cy + 0.5) * TS - H / 2;
  const ix = (i: number) => i % cols;
  const iy = (i: number) => Math.floor(i / cols);

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [W / 2 + 3, H / 2 + 3], groundY: -34, ground: false },
      sun: [-10, 26, 12],
      shadowBox: Math.max(W, H) / 2 + 3,
    },
    (k) => {
      const { scene } = k.engine;

      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#58c4e6' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -9;
      scene.add(sea);

      const m = new Matrix4();
      const q = new Quaternion();
      const one = new Vector3(1, 1, 1);
      const pos = new Vector3();
      const scl = new Vector3();

      /* ---------------- nền: tấm đế + sàn caro ---------------- */
      const base = new Mesh(new BoxGeometry(W + 1.2, 1, H + 1.2), k.lit({ color: '#5d6bb8', flatShading: true }));
      base.position.y = -0.62;
      base.receiveShadow = true;
      scene.add(base);
      const floor = new InstancedMesh(new BoxGeometry(TS * 0.995, 0.18, TS * 0.995), k.lit({ color: '#ffffff' }), cells);
      floor.receiveShadow = true;
      floor.frustumCulled = false;
      const pale = [new Color('#b8f0a0'), new Color('#a5e48c')];
      for (let i = 0; i < cells; i++) {
        pos.set(wx(ix(i)), -0.09, wz(iy(i)));
        m.compose(pos, q, one);
        floor.setMatrixAt(i, m);
        floor.setColorAt(i, pale[(ix(i) + iy(i)) % 2]);
      }
      if (floor.instanceColor) floor.instanceColor.needsUpdate = true;
      scene.add(floor);

      /* ---------------- tường cố định (viền + trụ) ---------------- */
      const grid0 = o.read().grid.current;
      const wallIdx: number[] = [];
      for (let i = 0; i < cells; i++) if (grid0.cells[i] === CELL_WALL) wallIdx.push(i);
      const walls = new InstancedMesh(new BoxGeometry(TS, WALL_H, TS), k.lit({ color: '#ffffff' }), wallIdx.length);
      walls.castShadow = !k.low;
      walls.receiveShadow = true;
      walls.frustumCulled = false;
      wallIdx.forEach((i, n) => {
        pos.set(wx(ix(i)), WALL_H / 2, wz(iy(i)));
        m.compose(pos, q, one);
        walls.setMatrixAt(n, m);
        const edge = ix(i) === 0 || iy(i) === 0 || ix(i) === cols - 1 || iy(i) === rows - 1;
        walls.setColorAt(n, new Color(edge ? '#7a6bd6' : '#ff9fb8'));
      });
      if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
      scene.add(walls);

      /* ---------------- thùng gỗ ---------------- */
      const crateTex = k.texture(128, 128, (g, w, h) => {
        g.fillStyle = '#f2a63a';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#c9811f';
        g.lineWidth = 6;
        for (let i = 1; i < 4; i++) {
          g.beginPath();
          g.moveTo(0, (i * h) / 4);
          g.lineTo(w, (i * h) / 4);
          g.stroke();
        }
        g.strokeStyle = '#a8651a';
        g.lineWidth = 12;
        g.strokeRect(6, 6, w - 12, h - 12);
        g.beginPath();
        g.moveTo(10, 10);
        g.lineTo(w - 10, h - 10);
        g.moveTo(w - 10, 10);
        g.lineTo(10, h - 10);
        g.stroke();
      });
      const crates = new InstancedMesh(new BoxGeometry(TS * 0.88, CRATE_H, TS * 0.88), k.lit({ map: crateTex }), cells);
      crates.castShadow = !k.low;
      crates.receiveShadow = true;
      crates.frustumCulled = false;
      scene.add(crates);
      let shownVer = -1;
      const rebuildCrates = (g: { cells: Uint8Array }) => {
        let n = 0;
        for (let i = 0; i < cells; i++) {
          if (g.cells[i] !== CELL_CRATE) continue;
          pos.set(wx(ix(i)), CRATE_H / 2, wz(iy(i)));
          m.compose(pos, q, one);
          crates.setMatrixAt(n++, m);
        }
        crates.count = n;
        crates.instanceMatrix.needsUpdate = true;
      };

      /* ---------------- sập sàn: ô đã sập + ô sắp sập nháy đỏ ---------------- */
      const fallen = new InstancedMesh(new BoxGeometry(TS, WALL_H, TS), k.lit({ color: '#ff5e8a' }), cfg.spiral.length);
      fallen.castShadow = !k.low;
      fallen.receiveShadow = true;
      fallen.frustumCulled = false;
      fallen.count = 0;
      scene.add(fallen);
      let fallenCount = 0;
      const warnMat = new MeshBasicMaterial({ color: '#ff2d55', transparent: true, opacity: 0.5, depthWrite: false });
      const warn = new InstancedMesh(new PlaneGeometry(TS * 0.96, TS * 0.96), warnMat, cfg.spiral.length);
      warn.frustumCulled = false;
      warn.count = 0;
      scene.add(warn);
      const flatQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

      /* ---------------- lửa nổ ---------------- */
      // hộp đơn vị (cao 1), co giãn theo từng ô; màu theo vòng đời qua instanceColor
      const flameMesh = new InstancedMesh(new BoxGeometry(TS * 0.98, 1, TS * 0.98), new MeshBasicMaterial({ color: '#ffffff' }), cells);
      flameMesh.frustumCulled = false;
      flameMesh.count = 0;
      flameMesh.setColorAt(0, new Color('#ffffff'));
      scene.add(flameMesh);
      const flameCore = new InstancedMesh(new BoxGeometry(TS * 0.6, 1, TS * 0.6), new MeshBasicMaterial({ color: '#ffffff' }), cells);
      flameCore.frustumCulled = false;
      flameCore.count = 0;
      flameCore.setColorAt(0, new Color('#ffffff'));
      scene.add(flameCore);
      const OUT_STOPS = ['#ffffff', '#ffe27a', '#ff9a2e', '#ff7a66'].map((c) => new Color(c));
      const CORE_STOPS = ['#ffffff', '#fffbd0', '#ffe066', '#ffb066'].map((c) => new Color(c));
      const ramp = (stops: Color[], u: number, out: Color) => {
        const x = Math.min(1, Math.max(0, u)) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(x));
        out.copy(stops[i]).lerp(stops[i + 1], x - i);
      };
      const cOut = new Color();
      const cCore = new Color();
      const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
      const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

      // thông tin từng ô lửa: thời điểm bắt đầu (giờ server, có trễ theo khoảng cách), loại ô
      interface Blast {
        start: number;
        fired: boolean;
        crate: boolean;
        tip: boolean;
      }
      const blast = new Map<number, Blast>();
      const seenBooms = new WeakSet<BmFx>();
      const SPREAD_MAX = 120; // tổng thời gian lan ra tới ô xa nhất (ms)
      const SPREAD_STEP = 35; // mỗi ô cách nhau tối đa (ms)

      // sốc ở tâm: quả cầu sáng + vòng sóng, dùng chung pool
      const SHOCKS = 6;
      interface Shock {
        sphere: Mesh;
        ring: Mesh;
        t0: number;
        x: number;
        z: number;
        power: number;
        on: boolean;
      }
      const shockSphereGeo = new SphereGeometry(1, 16, 12);
      const shockRingGeo = new RingGeometry(0.86, 1, 40);
      const shocks: Shock[] = [];
      for (let i = 0; i < SHOCKS; i++) {
        const sphere = new Mesh(shockSphereGeo, new MeshBasicMaterial({ color: '#fff6c8', transparent: true, depthWrite: false }));
        const ring = new Mesh(shockRingGeo, new MeshBasicMaterial({ color: '#ffe9a8', transparent: true, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        sphere.visible = false;
        ring.visible = false;
        scene.add(sphere, ring);
        shocks.push({ sphere, ring, t0: 0, x: 0, z: 0, power: 1, on: false });
      }
      let shockN = 0;
      const boomLight = new PointLight('#ffb35a', 0, 16, 2);
      if (!k.low) scene.add(boomLight);

      // mảnh gỗ bay khi thùng vỡ
      const CHIPS = k.low ? 40 : 120;
      const chipMesh = new InstancedMesh(new BoxGeometry(0.2, 0.12, 0.3), new MeshBasicMaterial({ color: '#ffffff' }), CHIPS);
      chipMesh.frustumCulled = false;
      chipMesh.count = 0;
      chipMesh.setColorAt(0, new Color('#ffffff'));
      scene.add(chipMesh);
      const chipCols = ['#f2a63a', '#c9811f', '#a8651a', '#ffd08a'].map((c) => new Color(c));
      const chips = Array.from({ length: CHIPS }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, wx: 0, wy: 0 }));
      let chipN = 0;
      const euler = new Quaternion();
      const eulerQ = new Quaternion();
      const AX = new Vector3(1, 0, 0);
      const AY = new Vector3(0, 1, 0);

      /* ---------------- bom ---------------- */
      interface BombView {
        g: Group;
        body: Mesh;
        spark: Mesh;
      }
      const bombBodyMat = new MeshBasicMaterial({ color: '#1b1d33' });
      const bombFlashMat = new MeshBasicMaterial({ color: '#ff3b4e' });
      const bombViews: BombView[] = [];
      const bombBodyGeo = new SphereGeometry(0.46, 16, 12);
      for (let i = 0; i < BOMB_POOL; i++) {
        const g = new Group();
        const body = new Mesh(bombBodyGeo, bombBodyMat);
        body.position.y = 0.5;
        body.castShadow = !k.low;
        const cap = new Mesh(new BoxGeometry(0.22, 0.12, 0.22), new MeshBasicMaterial({ color: '#9aa3c7' }));
        cap.position.y = 0.98;
        const spark = new Mesh(new SphereGeometry(0.12, 8, 6), new MeshBasicMaterial({ color: '#ffd23f' }));
        spark.position.set(0.1, 1.2, 0);
        g.add(body, cap, spark);
        g.visible = false;
        scene.add(g);
        bombViews.push({ g, body, spark });
      }

      /* ---------------- vật phẩm: bom thêm / lửa mạnh hơn / chạy nhanh ---------------- */
      const itemViews: Group[] = [];
      const itemGeo = {
        b: new SphereGeometry(0.3, 12, 8),
        f: new ConeGeometry(0.3, 0.7, 10),
        s: new OctahedronGeometry(0.34, 0),
        h: new CylinderGeometry(0.34, 0.12, 0.2, 6),
      };
      for (let i = 0; i < ITEM_POOL; i++) {
        const g = new Group();
        const ring = new Mesh(new TorusGeometry(0.46, 0.06, 6, 20), new MeshBasicMaterial({ color: '#ffffff' }));
        ring.rotation.x = Math.PI / 2;
        const core = new Mesh(itemGeo.b, new MeshBasicMaterial({ color: '#ffffff' }));
        g.add(ring, core);
        g.visible = false;
        scene.add(g);
        itemViews.push(g);
      }

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        px: number;
        pz: number;
        placed: boolean;
        dead: boolean;
        bubble: Mesh;
      }
      const bubbleGeo = new SphereGeometry(1.15, 20, 14);
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        const bubble = new Mesh(bubbleGeo, new MeshBasicMaterial({ color: '#4db8ff', transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide }));
        bubble.visible = false;
        scene.add(bubble);
        chars.set(p.id, { c, x: 0, z: 0, px: 0, pz: 0, placed: false, dead: false, bubble });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const focus = new Vector3(0, 0, 0.4);
      const dist = k.fit(W / 2 + 1.2, H / 2 + 1.4, PITCH) * 1.03;
      const sunOff = new Vector3(-10, 26, 12);
      const sunAim = new Vector3(0, 0, 0);
      let fxDone = 0;
      const cellPos = (i: number) => [wx(ix(i)), wz(iy(i))] as const;

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);

          // thùng: dựng lại khi lưới đổi
          if (f.gridVer.current !== shownVer) {
            shownVer = f.gridVer.current;
            rebuildCrates(f.grid.current);
          }

          // sập sàn (suy ra từ giờ server, khớp với server)
          const { closed, warnTo } = f.closing(now);
          if (closed !== fallenCount) {
            for (let n = fallenCount; n < closed; n++) {
              const i = cfg.spiral[n];
              pos.set(wx(ix(i)), WALL_H / 2, wz(iy(i)));
              m.compose(pos, q, one);
              fallen.setMatrixAt(n, m);
              const [x, z] = cellPos(i);
              k.effects.burst(x, 1, z, { count: k.count(10), palette: ['#ff5e8a', '#ffffff'], speed: 3, life: 0.5, size: 0.18 });
            }
            fallenCount = closed;
            fallen.count = closed;
            fallen.instanceMatrix.needsUpdate = true;
          }
          let wn = 0;
          for (let n = closed; n < warnTo; n++) {
            const i = cfg.spiral[n];
            pos.set(wx(ix(i)), 0.06, wz(iy(i)));
            m.compose(pos, flatQ, one);
            warn.setMatrixAt(wn++, m);
          }
          warn.count = wn;
          warn.instanceMatrix.needsUpdate = true;
          warnMat.opacity = 0.35 + 0.3 * Math.abs(Math.sin(time * 9));

          // lửa
          // 1) sự kiện nổ mới: tính độ trễ lan theo khoảng cách tới tâm, tạo sốc + ánh sáng + rung
          for (const ev of f.fx.current) {
            if (ev.kind !== 'boom' || seenBooms.has(ev)) continue;
            seenBooms.add(ev);
            const cs = ev.cells ?? [];
            if (!cs.length) continue;
            const c0 = cs[0];
            const dOf = (c: number) => Math.abs(ix(c) - ix(c0)) + Math.abs(iy(c) - iy(c0));
            let maxD = 0;
            for (const c of cs) maxD = Math.max(maxD, dOf(c));
            const step = maxD > 0 ? Math.min(SPREAD_STEP, SPREAD_MAX / maxD) : 0;
            const crateSet = new Set((ev.crates ?? []).map((c) => c[0]));
            cs.forEach((c, n) => {
              const d = dOf(c);
              const nextD = n + 1 < cs.length ? dOf(cs[n + 1]) : -1;
              blast.set(c, { start: now + d * step, fired: false, crate: crateSet.has(c), tip: d > 0 && nextD <= d });
            });
            const [cx, cz] = cellPos(c0);
            const sh = shocks[shockN++ % SHOCKS];
            sh.t0 = now;
            sh.x = cx;
            sh.z = cz;
            sh.power = Math.max(1, maxD);
            sh.on = true;
            boomLight.position.set(cx, 2, cz);
            boomLight.intensity = 30;
            k.effects.burst(cx, 0.9, cz, { count: k.count(26), palette: ['#ffffff', '#ffe27a', '#ff9a2e'], speed: 5, life: 0.55, size: 0.2 });
            k.effects.burst(cx, 1.2, cz, { count: k.count(8), palette: ['#8f94b0', '#c5c9de'], speed: 1.6, life: 1.1, size: 0.42, additive: false });
            // rung nhẹ, mạnh hơn khi nổ gần mình
            const dx = cx - (f.me.current.x * TS - W / 2);
            const dz = cz - (f.me.current.y * TS - H / 2);
            k.shake(0.1 + 0.4 / (1 + Math.hypot(dx, dz) * 0.5));
          }

          // 2) vẽ từng ô lửa: phình ra (easeOutBack) -> giữ -> co dần, màu trắng -> vàng -> cam -> đỏ nhạt
          let fn = 0;
          for (const [idx, until] of f.flames.current) {
            if (until <= now) {
              blast.delete(idx);
              continue;
            }
            let e = blast.get(idx);
            if (!e) {
              // lửa có sẵn từ trạng thái đầy đủ (vào giữa chừng): vẫn vẽ, không hiệu ứng lan
              e = { start: until - cfg.flameMs, fired: true, crate: false, tip: false };
              blast.set(idx, e);
            }
            const a = now - e.start;
            if (a < 0) continue; // sóng lửa chưa lan tới ô này
            const [cx, cz] = cellPos(idx);
            if (!e.fired) {
              e.fired = true;
              k.effects.burst(cx, 0.7, cz, { count: k.count(5), palette: ['#ff9f43', '#ffd166', '#fff3c4'], speed: 2.8, life: 0.45, size: 0.18 });
              if (e.crate) {
                k.effects.burst(cx, 0.8, cz, { count: k.count(10), palette: ['#f2a63a', '#c9811f', '#fff1c4'], speed: 3.5, life: 0.6, size: 0.2, additive: false });
                const nChip = k.low ? 2 : 6;
                for (let c = 0; c < nChip; c++) {
                  const ch = chips[chipN++ % CHIPS];
                  const ang = Math.random() * Math.PI * 2;
                  const sp = 2 + Math.random() * 3;
                  ch.life = ch.max = 0.7 + Math.random() * 0.5;
                  ch.x = cx + Math.cos(ang) * 0.3;
                  ch.z = cz + Math.sin(ang) * 0.3;
                  ch.y = 0.5 + Math.random() * 0.4;
                  ch.vx = Math.cos(ang) * sp;
                  ch.vz = Math.sin(ang) * sp;
                  ch.vy = 4 + Math.random() * 3;
                  ch.rx = Math.random() * 6;
                  ch.ry = Math.random() * 6;
                  ch.wx = (Math.random() - 0.5) * 16;
                  ch.wy = (Math.random() - 0.5) * 16;
                }
              }
            }
            const life = Math.max(120, until - e.start);
            const u = Math.min(1, a / life);
            const grow = a < 110 ? easeOutBack(a / 110) : 1;
            const tail = u > 0.5 ? 1 - ((u - 0.5) / 0.5) ** 2 : 1;
            const s = Math.max(0, grow * tail);
            const flick = 1 + 0.07 * Math.sin(time * 26 + idx * 1.7);
            const wide = (e.tip ? 0.82 : 1) * s;
            const hOut = 1.05 * s * flick;
            pos.set(cx, hOut / 2, cz);
            scl.set(wide, hOut, wide);
            m.compose(pos, q, scl);
            flameMesh.setMatrixAt(fn, m);
            const hCore = 1.35 * s * flick * (1 - u * 0.35);
            const wCore = 0.55 * wide * (1 - u * 0.4) + 0.05;
            pos.set(cx, hCore / 2, cz);
            scl.set(wCore, hCore, wCore);
            m.compose(pos, q, scl);
            flameCore.setMatrixAt(fn, m);
            ramp(OUT_STOPS, u, cOut);
            ramp(CORE_STOPS, u, cCore);
            flameMesh.setColorAt(fn, cOut);
            flameCore.setColorAt(fn, cCore);
            fn++;
          }
          flameMesh.count = fn;
          flameCore.count = fn;
          flameMesh.instanceMatrix.needsUpdate = true;
          flameCore.instanceMatrix.needsUpdate = true;
          if (flameMesh.instanceColor) flameMesh.instanceColor.needsUpdate = true;
          if (flameCore.instanceColor) flameCore.instanceColor.needsUpdate = true;

          // 3) quả cầu sốc + vòng sóng + ánh sáng chớp
          for (const sh of shocks) {
            if (!sh.on) continue;
            const a = now - sh.t0;
            if (a > 340) {
              sh.on = false;
              sh.sphere.visible = false;
              sh.ring.visible = false;
              continue;
            }
            const ps = Math.max(0, a / 200);
            sh.sphere.visible = ps < 1;
            if (ps < 1) {
              sh.sphere.position.set(sh.x, 0.8, sh.z);
              sh.sphere.scale.setScalar(TS * (0.35 + 0.55 * easeOut(ps)));
              (sh.sphere.material as MeshBasicMaterial).opacity = 0.85 * (1 - ps) ** 1.5;
            }
            const pr = Math.max(0, a / 340);
            sh.ring.visible = true;
            sh.ring.position.set(sh.x, 0.1, sh.z);
            sh.ring.scale.setScalar(TS * (0.4 + (sh.power + 0.4) * easeOut(pr)));
            (sh.ring.material as MeshBasicMaterial).opacity = 0.7 * (1 - pr);
          }
          boomLight.intensity *= Math.exp(-dt * 9);

          // 4) mảnh gỗ bay (trọng lực đơn giản, co nhỏ dần khi hết đời)
          let cn = 0;
          for (const ch of chips) {
            if (ch.life <= 0) continue;
            ch.life -= dt;
            ch.vy -= 16 * dt;
            ch.x += ch.vx * dt;
            ch.z += ch.vz * dt;
            ch.y += ch.vy * dt;
            if (ch.y < 0.1) {
              ch.y = 0.1;
              ch.vy *= -0.3;
              ch.vx *= 0.7;
              ch.vz *= 0.7;
            }
            ch.rx += ch.wx * dt;
            ch.ry += ch.wy * dt;
            pos.set(ch.x, ch.y, ch.z);
            euler.setFromAxisAngle(AX, ch.rx);
            eulerQ.setFromAxisAngle(AY, ch.ry);
            euler.multiply(eulerQ);
            scl.setScalar(Math.min(1, Math.max(0, ch.life / ch.max) * 3));
            m.compose(pos, euler, scl);
            chipMesh.setMatrixAt(cn, m);
            chipMesh.setColorAt(cn, chipCols[cn % chipCols.length]);
            cn++;
          }
          chipMesh.count = cn;
          chipMesh.instanceMatrix.needsUpdate = true;
          if (chipMesh.instanceColor) chipMesh.instanceColor.needsUpdate = true;

          // bom: nháy nhanh dần khi sắp nổ
          let bi = 0;
          for (const b of f.bombs.current.values()) {
            if (bi >= BOMB_POOL) break;
            if (fallenIs(b.idx, cfg.spiral, closed)) continue;
            const v = bombViews[bi++];
            const left = Math.max(0, b.at - now);
            const rate = 6 + 22 * (1 - Math.min(1, left / cfg.fuseMs));
            const pulse = 1 + 0.1 * Math.sin(time * rate);
            v.g.visible = true;
            v.g.position.set(wx(ix(b.idx)), 0, wz(iy(b.idx)));
            v.g.scale.setScalar(pulse);
            v.body.material = left < 800 && Math.sin(time * 26) > 0 ? bombFlashMat : bombBodyMat;
            v.spark.scale.setScalar(0.7 + Math.random() * 0.9);
          }
          for (; bi < BOMB_POOL; bi++) bombViews[bi].g.visible = false;

          // vật phẩm
          let ii = 0;
          for (const [idx, kind] of f.items.current) {
            if (ii >= ITEM_POOL) break;
            if (fallenIs(idx, cfg.spiral, closed)) continue;
            const g = itemViews[ii++];
            g.visible = true;
            g.position.set(wx(ix(idx)), 0.65 + Math.sin(time * 3 + idx) * 0.1, wz(iy(idx)));
            g.rotation.y = time * 2;
            const core = g.children[1] as Mesh;
            const col = KIND_COLOR[kind] ?? '#ffffff';
            core.geometry = itemGeo[kind as 'b' | 'f' | 's' | 'h'] ?? itemGeo.b;
            (core.material as MeshBasicMaterial).color.set(col);
            (g.children[0] as Mesh & { material: MeshBasicMaterial }).material.color.set(col);
          }
          for (; ii < ITEM_POOL; ii++) itemViews[ii].visible = false;

          // nhân vật
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const isMe = p.id === o.meId;
            const s = f.snap.current[p.id];
            const alive = s ? !!s[2] : true;
            let tx: number;
            let tz: number;
            if (isMe && alive) {
              tx = f.me.current.x * TS - W / 2;
              tz = f.me.current.y * TS - H / 2;
            } else if (s) {
              tx = s[0] * TS - W / 2;
              tz = s[1] * TS - H / 2;
            } else {
              const sp = cfg.spawns[p.id];
              if (!sp) continue;
              tx = wx(sp[0]);
              tz = wz(sp[1]);
            }
            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.px = tx;
              e.pz = tz;
              e.placed = true;
            } else if (isMe && alive) {
              e.x = tx;
              e.z = tz;
            } else {
              // người khác: server gửi ~15 lần/giây nên làm mượt hơn để bớt giật; lệch quá xa (dịch chuyển) thì nhảy luôn
              const far = Math.hypot(tx - e.x, tz - e.z) > 3 * TS;
              const kk = far ? 1 : 1 - Math.exp(-dt * 10);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }
            if (!alive) {
              if (!e.dead) {
                e.dead = true;
                k.effects.burst(e.x, 1, e.z, { count: k.count(40), palette: ['#ffffff', p.color, '#ffd166'], speed: 5, life: 0.8, size: 0.22 });
              }
              e.c.root.visible = false;
              e.bubble.visible = false;
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
              continue;
            }
            e.dead = false;
            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;
            e.c.root.visible = true;
            e.c.root.position.set(e.x, 0, e.z);
            e.c.face(vx, vz, dt);
            e.c.update(dt, { speed: Math.min(1, Math.hypot(vx, vz) / (cfg.speed * TS)), dead: false, time, pose: 'run' });
            k.label(o.labels.get(p.id), e.x, 2.1, e.z);
            e.bubble.visible = !!s?.[6];
            if (e.bubble.visible) {
              e.bubble.position.set(e.x, 1.05, e.z);
              e.bubble.scale.setScalar(1 + 0.04 * Math.sin(time * 6));
              (e.bubble.material as MeshBasicMaterial).opacity = 0.26 + 0.08 * Math.sin(time * 5);
            }
          }

          // hiệu ứng nổ / nhặt đồ
          const fxs = f.fx.current;
          while (fxDone < fxs.length) {
            const ev = fxs[fxDone++];
            // 'boom' đã xử lý ở khối lửa phía trên
            if (ev.kind === 'shield' && ev.who) {
              const e = chars.get(ev.who);
              if (e) k.effects.burst(e.x, 1, e.z, { count: k.count(30), palette: ['#ffffff', '#4db8ff', '#bfe6ff'], speed: 5, life: 0.6, size: 0.2 });
            }
            if (ev.kind === 'pick' && ev.idx !== undefined) {
              const [x, z] = cellPos(ev.idx);
              k.effects.burst(x, 1, z, { count: k.count(16), palette: ['#ffffff', '#ffd23f', '#7df9ff'], speed: 3, life: 0.6, size: 0.16 });
            }
          }
          if (fxDone > 200) {
            fxs.splice(0, fxDone);
            fxDone = 0;
          }

          camPos.copy(focus).addScaledVector(camDir, dist);
          k.look(camPos, focus);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
      };
    },
  );
}

/** ô này đã sập chưa (đã nằm trong `closed` ô đầu của vòng xoáy) */
function fallenIs(idx: number, spiral: number[], closed: number): boolean {
  if (closed === 0) return false;
  for (let n = 0; n < closed; n++) if (spiral[n] === idx) return true;
  return false;
}
