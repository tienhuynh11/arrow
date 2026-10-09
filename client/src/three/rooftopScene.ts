import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D, Pose } from './character';
import {
  BRIDGE_H,
  F_ANCHOR,
  F_DOWN,
  F_FALL,
  F_HELD,
  F_HOLD,
  F_LIFT,
  F_LIFTING,
  F_OUT,
  F_PUNCH,
  F_STUN,
  F_THROWN,
  F_WHIFF,
  HALF_W,
  SIGN_REACH,
  SPEED,
  TRUCK_V,
  bridgeY,
  signX,
  swayAccel,
  type RtConfig,
  type RtWarn,
} from '@shared/rooftop';
import type { RtFx, RtPos } from '../games/rooftop/useRooftopGame';

export interface RooftopFrame {
  cfg: RtConfig;
  startAt: number;
  positions: { current: Record<string, RtPos> };
  warns: { current: RtWarn[] };
  fx: { current: RtFx[] };
  cam: { current: { yaw: number; pitch: number } };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number; z: number; face: number; flags: number; vx: number; vy: number; wob: number } | undefined;
  serverNow(): number;
}

export interface RooftopSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => RooftopFrame;
  labels: Map<string, HTMLElement | null>;
}

const PERIOD = 64;
const NPER = 6;
const ROAD_Y = -3.45;
const PASTEL = ['#ffb3c7', '#ffd48a', '#a8e6cf', '#9ec9ff', '#d5b3ff', '#fff2a1', '#ffa07a', '#8fe0d8'];
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const smooth = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

export function createRooftopScene(o: RooftopSceneOptions) {
  const first = o.read();
  const cfg = first.cfg;
  const L = cfg.L;
  const total = o.players.length;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [40, 60], groundY: ROAD_Y, ground: false },
      sun: [-9, 22, 10],
      shadowBox: 13,
      fog: [60, 230],
    },
    (k) => {
      const { scene } = k.engine;
      const dummy = new Object3D();
      const rand = seeded(2024);
      const disposables: { dispose(): void }[] = [];
      const own = <T extends { dispose(): void }>(x: T): T => {
        disposables.push(x);
        return x;
      };
      const geoBox = own(new BoxGeometry(1, 1, 1));

      /* ---------------- đất + đường (trôi bằng texture) ---------------- */
      const stripes = k.texture(64, 64, (g, w, h) => {
        g.fillStyle = '#7fe05c';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#6fd14e';
        g.fillRect(0, 0, w, h / 2);
      });
      stripes.wrapS = stripes.wrapT = RepeatWrapping;
      stripes.repeat.set(1, 75);
      const grass = new Mesh(own(new PlaneGeometry(600, 600)), own(new MeshBasicMaterial({ map: stripes })));
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(0, ROAD_Y - 0.06, -150);
      scene.add(grass);

      const asphaltTex = k.texture(64, 64, (g, w, h) => {
        g.fillStyle = '#4a4f5c';
        g.fillRect(0, 0, w, h);
        const r = seeded(5);
        for (let i = 0; i < 70; i++) {
          g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
          g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
        }
      });
      asphaltTex.wrapS = asphaltTex.wrapT = RepeatWrapping;
      asphaltTex.repeat.set(6, 75);
      const road = new Mesh(own(new PlaneGeometry(21, 600)), own(new MeshBasicMaterial({ map: asphaltTex })));
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, ROAD_Y, -150);
      scene.add(road);
      for (const s of [-1, 1]) {
        const kerb = new Mesh(geoBox, own(new MeshBasicMaterial({ color: '#d9d9e3' })));
        kerb.scale.set(0.7, 0.25, 600);
        kerb.position.set(s * 10.8, ROAD_Y + 0.1, -150);
        scene.add(kerb);
      }

      /* ---------------- cảnh nền lặp vô hạn: InstancedMesh, cả nhóm chỉ dịch 1 vector mỗi khung ---------------- */
      const world = new Group();
      scene.add(world);
      const mats = {
        dash: own(new MeshBasicMaterial({ color: '#ffffff' })),
        lamp: k.lit({ color: '#6b7488' }),
        lampHead: own(new MeshBasicMaterial({ color: '#fff3a8' })),
        trunk: k.lit({ color: '#8a5a35' }),
        crown: k.lit({ color: '#ffffff' }),
        build: k.lit({ color: '#ffffff' }),
        post: k.lit({ color: '#cfd5e6' }),
        board: k.lit({ color: '#ffffff' }),
      };
      disposables.push(...Object.values(mats));
      const geoCyl = own(new CylinderGeometry(1, 1, 1, 8));
      const geoCone = own(new ConeGeometry(1, 1, 8));
      const makeInst = (geo: BoxGeometry | CylinderGeometry | ConeGeometry, mat: Mesh['material'], n: number) => {
        const m = new InstancedMesh(geo, mat, n * NPER);
        m.frustumCulled = false;
        world.add(m);
        return m;
      };
      const col = new Color();
      const addAll = (
        mesh: InstancedMesh,
        items: { x: number; y: number; z: number; sx: number; sy: number; sz: number; c?: string }[],
      ) => {
        let i = 0;
        for (let j = 0; j < NPER; j++) {
          for (const it of items) {
            dummy.position.set(it.x, it.y, it.z + PERIOD * (1 - j));
            dummy.scale.set(it.sx, it.sy, it.sz);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            if (it.c) mesh.setColorAt(i, col.set(it.c));
            i++;
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      };
      const dashes: Parameters<typeof addAll>[1] = [];
      for (const s of [-1, 1]) for (let i = 0; i < 8; i++) dashes.push({ x: s * 6.9, y: ROAD_Y + 0.03, z: -i * 8, sx: 0.28, sy: 0.02, sz: 3.2 });
      addAll(makeInst(geoBox, mats.dash, dashes.length), dashes);

      const poles: Parameters<typeof addAll>[1] = [];
      const heads: Parameters<typeof addAll>[1] = [];
      for (const s of [-1, 1]) {
        for (const z of [-8, -40]) {
          poles.push({ x: s * 10.8, y: ROAD_Y + 3.2, z, sx: 0.14, sy: 6.4, sz: 0.14 });
          heads.push({ x: s * 10.0, y: ROAD_Y + 6.4, z, sx: 1.6, sy: 0.18, sz: 0.5 });
        }
      }
      addAll(makeInst(geoCyl, mats.lamp, poles.length), poles);
      addAll(makeInst(geoBox, mats.lampHead, heads.length), heads);

      const trunks: Parameters<typeof addAll>[1] = [];
      const crowns: Parameters<typeof addAll>[1] = [];
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const x = s * (12.8 + rand() * 5);
          const z = -(i * 12.8 + rand() * 6);
          const h = 3 + rand() * 2.5;
          trunks.push({ x, y: ROAD_Y + 0.9, z, sx: 0.28, sy: 1.8, sz: 0.28 });
          crowns.push({ x, y: ROAD_Y + 1.8 + h / 2, z, sx: 1.5 + rand() * 0.8, sy: h, sz: 1.5 + rand() * 0.8, c: rand() > 0.5 ? '#3fbf5a' : '#58d36b' });
        }
      }
      addAll(makeInst(geoCyl, mats.trunk, trunks.length), trunks);
      addAll(makeInst(geoCone, mats.crown, crowns.length), crowns);

      const builds: Parameters<typeof addAll>[1] = [];
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const h = 8 + rand() * 24;
          const w = 8 + rand() * 7;
          const d = 11 + rand() * 5;
          builds.push({
            x: s * (22 + rand() * 12),
            y: ROAD_Y + h / 2,
            z: -(i * 21 + 6 + rand() * 4),
            sx: w,
            sy: h,
            sz: d,
            c: PASTEL[Math.floor(rand() * PASTEL.length)],
          });
        }
      }
      addAll(makeInst(geoBox, mats.build, builds.length), builds);

      const sp: Parameters<typeof addAll>[1] = [];
      const sb: Parameters<typeof addAll>[1] = [];
      for (const s of [-1, 1]) {
        sp.push({ x: s * 9.6, y: ROAD_Y + 1.6, z: -30, sx: 0.1, sy: 3.2, sz: 0.1 });
        sb.push({ x: s * 9.6, y: ROAD_Y + 3.0, z: -30, sx: 1.5, sy: 1.1, sz: 0.1, c: s > 0 ? '#2f80ed' : '#ffb627' });
      }
      addAll(makeInst(geoBox, mats.post, sp.length), sp);
      addAll(makeInst(geoBox, mats.board, sb.length), sb);

      /* ---------------- xe tải ---------------- */
      const veh = new Group();
      scene.add(veh);
      const roofTex = k.texture(256, 512, (g, w, h) => {
        g.fillStyle = '#cfd6e4';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(80,95,125,0.35)';
        g.lineWidth = 3;
        for (let y = 0; y <= h; y += h / 8) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        for (let x = 0; x <= w; x += w / 3) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        }
        // viền vàng-đen để thấy mép nóc xe
        const b = 22;
        for (let i = 0; i < Math.max(w, h) / 20; i++) {
          g.fillStyle = i % 2 ? '#222' : '#ffcf33';
          g.fillRect(i * 20, 0, 20, b);
          g.fillRect(i * 20, h - b, 20, b);
          g.fillRect(0, i * 20, b, 20);
          g.fillRect(w - b, i * 20, b, 20);
        }
        g.fillStyle = 'rgba(255,120,60,0.55)';
        g.fillRect(w / 2 - 6, 30, 12, h - 60);
      });
      const roof = new Mesh(own(new BoxGeometry(HALF_W * 2, 0.4, L)), [
        k.lit({ color: '#b8c0d4' }),
        k.lit({ color: '#b8c0d4' }),
        k.lit({ map: roofTex }),
        k.lit({ color: '#8f98b0' }),
        k.lit({ color: '#b8c0d4' }),
        k.lit({ color: '#b8c0d4' }),
      ]);
      roof.position.set(0, -0.2, 0);
      roof.receiveShadow = true;
      veh.add(roof);
      const bodyMat = k.lit({ color: '#3a7bd5' });
      const trim = k.lit({ color: '#ffb627' });
      disposables.push(bodyMat, trim);
      const body = new Mesh(geoBox, bodyMat);
      body.scale.set(HALF_W * 2 - 0.15, 2.7, L);
      body.position.set(0, -1.75, 0);
      veh.add(body);
      const stripe = new Mesh(geoBox, trim);
      stripe.scale.set(HALF_W * 2 - 0.05, 0.35, L + 0.02);
      stripe.position.set(0, -1.0, 0);
      veh.add(stripe);
      const chassis = new Mesh(geoBox, k.lit({ color: '#2b2f3d' }));
      chassis.scale.set(HALF_W * 2 - 0.9, 0.5, L + 3.6);
      chassis.position.set(0, -3.3, -1.8);
      veh.add(chassis);
      const cab = new Mesh(geoBox, k.lit({ color: '#ef5b4b' }));
      cab.scale.set(HALF_W * 2 - 0.1, 3.9, 3.4);
      cab.position.set(0, -1.15, -(L / 2 + 1.7));
      veh.add(cab);
      const glass = new Mesh(geoBox, k.lit({ color: '#bfe8ff' }));
      glass.scale.set(HALF_W * 2 - 0.5, 0.7, 0.12);
      glass.position.set(0, 0.4, -(L / 2 + 3.45));
      veh.add(glass);
      const lightsMat = own(new MeshBasicMaterial({ color: '#fff7c2' }));
      const brakeMat = own(new MeshBasicMaterial({ color: '#8a1d1d' }));
      for (const s of [-1, 1]) {
        const hl = new Mesh(geoBox, lightsMat);
        hl.scale.set(0.8, 0.5, 0.1);
        hl.position.set(s * 2.3, -2.1, -(L / 2 + 3.45));
        veh.add(hl);
        const bl = new Mesh(geoBox, brakeMat);
        bl.scale.set(0.7, 0.45, 0.1);
        bl.position.set(s * 2.4, -1.4, L / 2 + 0.03);
        veh.add(bl);
      }
      const wheelGeo = own(new CylinderGeometry(0.9, 0.9, 0.7, 14));
      wheelGeo.rotateZ(Math.PI / 2);
      const wheelMat = k.lit({ color: '#20232e' });
      disposables.push(wheelMat);
      const hubGeo = own(new CylinderGeometry(0.4, 0.4, 0.72, 10));
      hubGeo.rotateZ(Math.PI / 2);
      const hubMat = k.lit({ color: '#e6e8f2' });
      disposables.push(hubMat);
      const wheels: Mesh[] = [];
      const wz = [L / 2 - 1.4, 0.2, -L / 2 + 1.4, -(L / 2 + 2.3)];
      for (const z of wz) {
        for (const s of [-1, 1]) {
          const w = new Mesh(wheelGeo, wheelMat);
          w.add(new Mesh(hubGeo, hubMat));
          w.position.set(s * (HALF_W - 0.25), ROAD_Y + 0.9, z);
          veh.add(w);
          wheels.push(w);
        }
      }
      // lan can
      const railMat = k.lit({ color: '#ffcf33' });
      disposables.push(railMat);
      const nPosts = cfg.rails.reduce((n, r) => n + 2 + Math.floor((r.y1 - r.y0) / 1.4), 0);
      const posts = new InstancedMesh(geoBox, railMat, Math.max(1, nPosts));
      let pi = 0;
      for (const r of cfg.rails) {
        const len = r.y1 - r.y0;
        const cz = -(r.y0 + r.y1) / 2;
        const x = r.s * (HALF_W - 0.1);
        for (const [yy, th] of [[0.82, 0.1], [0.45, 0.07]] as const) {
          const bar = new Mesh(geoBox, railMat);
          bar.scale.set(0.1, th, len);
          bar.position.set(x, yy, cz);
          bar.castShadow = false;
          veh.add(bar);
        }
        const cnt = 2 + Math.floor(len / 1.4);
        for (let i = 0; i < cnt; i++) {
          dummy.position.set(x, 0.42, -(r.y0 + (len * i) / (cnt - 1)));
          dummy.scale.set(0.12, 0.84, 0.12);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          posts.setMatrixAt(pi++, dummy.matrix);
        }
      }
      posts.count = pi;
      posts.frustumCulled = false;
      veh.add(posts);

      /* ---------------- chướng ngại: dùng lại một vài đối tượng ---------------- */
      const hazardTex = k.texture(64, 64, (g, w, h) => {
        g.fillStyle = '#ffcf33';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#1d1f2b';
        for (let i = -2; i < 6; i++) {
          g.beginPath();
          g.moveTo(i * 16, 0);
          g.lineTo(i * 16 + 8, 0);
          g.lineTo(i * 16 + 8 + h, h);
          g.lineTo(i * 16 + h, h);
          g.fill();
        }
      });
      hazardTex.wrapS = hazardTex.wrapT = RepeatWrapping;
      const slabMat = k.lit({ color: '#8d9ab3' });
      const hazMat = k.lit({ map: hazardTex });
      disposables.push(slabMat, hazMat);
      interface Bridge {
        g: Group;
        left: Mesh;
        right: Mesh;
        lStripe: Mesh;
        rStripe: Mesh;
        id: number;
      }
      const makeBridge = (): Bridge => {
        const g = new Group();
        g.visible = false;
        const mk = (m: Mesh['material']) => {
          const mesh = new Mesh(geoBox, m);
          g.add(mesh);
          return mesh;
        };
        const left = mk(slabMat);
        const right = mk(slabMat);
        const lStripe = mk(hazMat);
        const rStripe = mk(hazMat);
        scene.add(g);
        return { g, left, right, lStripe, rStripe, id: -1 };
      };
      const bridges = [makeBridge(), makeBridge()];

      const signTex = k.texture(128, 96, (g, w, h) => {
        g.fillStyle = '#e63946';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff';
        g.fillRect(8, 8, w - 16, h - 16);
        g.fillStyle = '#e63946';
        g.fillRect(14, 14, w - 28, h - 28);
        g.fillStyle = '#fff';
        g.font = 'bold 34px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('XIN ĐƯỜNG', w / 2, h / 2);
      });
      const signMat = k.lit({ map: signTex });
      const armMat = k.lit({ color: '#cfd5e6' });
      disposables.push(signMat, armMat);
      interface Sign {
        g: Group;
        board: Mesh;
        arm: Mesh;
        pole: Mesh;
        id: number;
      }
      const makeSign = (): Sign => {
        const g = new Group();
        g.visible = false;
        const board = new Mesh(geoBox, signMat);
        board.scale.set(1.5, 0.95, 0.18);
        board.position.y = 0.5;
        const arm = new Mesh(geoBox, armMat);
        arm.scale.set(1, 0.12, 0.12);
        arm.position.y = 1.15;
        const pole = new Mesh(geoBox, armMat);
        pole.scale.set(0.16, 3.4, 0.16);
        g.add(board, arm, pole);
        scene.add(g);
        return { g, board, arm, pole, id: -1 };
      };
      const signs = [makeSign(), makeSign()];
      const stripMat = own(new MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.4, depthWrite: false }));
      const strips = [0, 1].map(() => {
        const m = new Mesh(own(new PlaneGeometry(1, 1)), stripMat);
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        veh.add(m);
        return m;
      });

      // gió: vệt trắng bay ngang
      const NSTREAK = 26;
      const streakMat = own(new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }));
      const streaks = new InstancedMesh(geoBox, streakMat, NSTREAK);
      streaks.frustumCulled = false;
      streaks.visible = false;
      scene.add(streaks);
      const sx0 = Array.from({ length: NSTREAK }, () => rand() * 26 - 13);
      const sy0 = Array.from({ length: NSTREAK }, () => 0.4 + rand() * 3.6);
      const sz0 = Array.from({ length: NSTREAK }, () => -rand() * (L + 8) + (L / 2 + 4));
      const sl0 = Array.from({ length: NSTREAK }, () => 1.2 + rand() * 2.2);

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        y: number;
        z: number;
        yaw: number;
        placed: boolean;
        out: boolean;
        spin: number;
        phase: number;
        hitAt: number;
      }
      const chars = new Map<string, Entry>();
      o.players.forEach((p, i) => {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.visible = false;
        veh.add(c.root);
        chars.set(p.id, { c, x: 0, y: 0, z: 0, yaw: 0, placed: false, out: false, spin: 0, phase: i * 1.7, hitAt: -1e9 });
      });
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });
      const outSet = new Set<string>();

      const spawn0 = cfg.spawns[o.meId] ?? [0, 0, 0];
      const focus = new Vector3(spawn0[0], 0, -spawn0[1]);
      const camPos = new Vector3();
      const lookAt = new Vector3();
      const sunOff = new Vector3(-9, 22, 10);
      const m4 = new Matrix4();
      let scroll = 0;
      let speedNow = TRUCK_V;
      let roll = 0;
      let pitchBrake = 0;
      let hop = 0;
      let hopV = 0;
      let camDist = 6.3;
      let windT = 0;
      let lastGust = 0;

      const burst = (x: number, y: number, z: number, n: number, palette: string[], speed = 3.5, life = 0.7, grav = 8) =>
        k.effects.burst(x, y, -z, { count: k.count(n), palette, speed, life, size: 0.2, gravity: grav });

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const t = now - f.startAt; // ms
          const warns = f.warns.current;

          /* tốc độ cảnh: phanh gấp thì chậm lại */
          let tgtSpeed = TRUCK_V;
          let brakeAmt = 0;
          let gust = 0;
          for (const w of warns) {
            if (w.kind === 'brake') {
              const a = smooth((t - w.hitAt) / 250) * (1 - smooth((t - (w.hitAt + w.dur)) / 500));
              if (a > brakeAmt) brakeAmt = a;
            } else if (w.kind === 'gust' && t >= w.hitAt - 200 && t < w.hitAt + w.dur) {
              gust = w.a;
              lastGust = w.a;
            }
          }
          tgtSpeed = TRUCK_V * (1 - 0.82 * brakeAmt);
          speedNow += (tgtSpeed - speedNow) * (1 - Math.exp(-dt * 6));
          scroll += speedNow * dt;
          world.position.z = scroll % PERIOD;
          stripes.offset.y = scroll / 8;
          asphaltTex.offset.y = scroll / 8;
          for (const w of wheels) w.rotation.x -= (speedNow / 0.9) * dt;

          /* thân xe: nghiêng khi xóc mạnh, chúi đầu khi phanh, nảy khi qua ổ gà */
          const sway = swayAccel(f.cfg, Math.max(0, t));
          roll += (-sway * 0.0075 - roll) * (1 - Math.exp(-dt * 6));
          pitchBrake += (brakeAmt * 0.045 - pitchBrake) * (1 - Math.exp(-dt * 8));
          hopV -= 30 * dt;
          hop = Math.max(0, hop + hopV * dt);
          if (hop === 0 && hopV < 0) hopV = 0;
          veh.rotation.z = roll;
          veh.rotation.x = pitchBrake;
          veh.position.y = hop + Math.sin(time * 38) * 0.008 * (1 + (t > cfg.tiltAt ? 2 : 0));
          lightsBrake(brakeAmt);

          /* ---------------- sự kiện từ server ---------------- */
          const list = f.fx.current;
          while (list.length) {
            const ev = list.shift()!;
            if (ev.kind === 'tilt') k.shake(0.5);
            else if (ev.kind === 'out') {
              outSet.add(ev.playerId);
              const e = chars.get(ev.playerId);
              if (e) burst(e.x, ROAD_Y + 0.3, e.y, 18, ['#c8c8d4', '#ffffff', '#8c8c9c'], 4, 0.8, 9);
            } else if (ev.kind === 'fx') {
              const va = chars.get(ev.a);
              const vb = ev.b ? chars.get(ev.b) : undefined;
              switch (ev.k) {
                case 'hit':
                  if (vb) {
                    vb.hitAt = time;
                    burst(vb.x, vb.z + 1.1, vb.y, 14, ['#ffffff', '#ffe066', '#ff9f43'], 4.5, 0.5, 6);
                  }
                  if (ev.a === o.meId || ev.b === o.meId) k.shake(0.3);
                  break;
                case 'whiff':
                  if (va) burst(va.x, va.z + 0.2, va.y, 8, ['#ffffff', '#d7d7e8'], 2.2, 0.5, 5);
                  break;
                case 'grab':
                  if (vb) burst(vb.x, vb.z + 1.1, vb.y, 8, ['#ffd23f', '#ffffff'], 2.4, 0.5, 2);
                  break;
                case 'throw':
                  if (vb) burst(vb.x, vb.z + 1.4, vb.y, 18, ['#ff9f43', '#ffffff', '#ffd23f'], 5, 0.7, 3);
                  k.shake(0.25);
                  break;
                case 'bowl':
                case 'crash':
                  if (vb ?? va) {
                    const e = (vb ?? va)!;
                    burst(e.x, e.z + 1.2, e.y, 26, ['#ff5e8a', '#ffd23f', '#ffffff', '#5b8cff'], 6.5, 0.9, 6);
                  }
                  k.shake(0.5);
                  break;
                case 'land':
                  if (va) burst(va.x, va.z + 0.1, va.y, 10, ['#e6e8f2', '#b8c0d4'], 2.8, 0.5, 4);
                  break;
                case 'ledge':
                case 'free':
                  if (va) burst(va.x, va.z + 1, va.y, 8, ['#7aff9a', '#ffffff'], 2.6, 0.5, 3);
                  break;
                case 'pothole':
                  hopV = 5.5;
                  k.shake(0.55);
                  for (const w of wheels.slice(0, 2)) burst(w.position.x, ROAD_Y + 0.5, -w.position.z, 10, ['#6e6e7e', '#a0a0b0'], 3, 0.6, 6);
                  break;
              }
            }
          }

          /* ---------------- chướng ngại ---------------- */
          let bi = 0;
          let si = 0;
          let stripI = 0;
          let gustOn = false;
          for (const w of warns) {
            if (w.kind === 'bridge') {
              const yb = bridgeY(cfg, w.hitAt, t);
              const b = bridges[bi];
              if (b && yb < L / 2 + 70 && yb > -L / 2 - 12) {
                bi++;
                b.g.visible = true;
                b.g.position.set(0, 0, -yb);
                const gw = w.b;
                const half = HALF_W + 2.2;
                const lx0 = -half;
                const lx1 = w.a - gw / 2;
                const rx0 = w.a + gw / 2;
                const rx1 = half;
                const H = 1.35;
                const y0 = BRIDGE_H;
                b.left.scale.set(Math.max(0.01, lx1 - lx0), H, 1.1);
                b.left.position.set((lx0 + lx1) / 2, y0 + H / 2, 0);
                b.right.scale.set(Math.max(0.01, rx1 - rx0), H, 1.1);
                b.right.position.set((rx0 + rx1) / 2, y0 + H / 2, 0);
                b.lStripe.scale.set(Math.max(0.01, lx1 - lx0), 0.34, 1.14);
                b.lStripe.position.set((lx0 + lx1) / 2, y0 + 0.17, 0);
                b.rStripe.scale.set(Math.max(0.01, rx1 - rx0), 0.34, 1.14);
                b.rStripe.position.set((rx0 + rx1) / 2, y0 + 0.17, 0);
              }
            } else if (w.kind === 'sign') {
              if (t > w.hitAt - 1900 && t < w.hitAt + w.dur + 350) {
                const sg = signs[si];
                if (!sg) continue;
                si++;
                sg.g.visible = true;
                const x = signX(w.a, w.hitAt, t);
                const sx = w.a * (SIGN_REACH + 0.15);
                const zz = -w.b;
                sg.g.position.set(0, 0, zz);
                sg.board.position.set(x, 0.5, 0);
                sg.pole.position.set(sx, 1.5, 0);
                sg.arm.scale.x = Math.max(0.05, Math.abs(sx - x));
                sg.arm.position.set((sx + x) / 2, 1.15, 0);
                const st = strips[stripI++];
                if (st) {
                  st.visible = t < w.hitAt + w.dur;
                  st.scale.set(HALF_W * 2, 0.9, 1);
                  st.position.set(0, 0.04, zz);
                  stripMat.opacity = 0.25 + 0.2 * Math.sin(time * 14);
                }
              }
            } else if (w.kind === 'pothole') {
              if (t > w.hitAt - 1800 && t < w.hitAt + 100) {
                // dấu hiệu: cảnh báo trên HUD; thêm vệt tối ngay trước xe
              }
            }
          }
          for (let i = bi; i < bridges.length; i++) bridges[i].g.visible = false;
          for (let i = si; i < signs.length; i++) signs[i].g.visible = false;
          for (let i = stripI; i < strips.length; i++) strips[i].visible = false;

          gustOn = gust !== 0;
          streaks.visible = gustOn;
          if (gustOn) {
            windT += dt;
            for (let i = 0; i < NSTREAK; i++) {
              const span = 30;
              let x = ((sx0[i] + lastGust * windT * 22 + 15) % span + span) % span - 15;
              if (lastGust < 0) x = -x;
              dummy.position.set(x, sy0[i], sz0[i]);
              dummy.scale.set(sl0[i], 0.05, 0.05);
              dummy.rotation.set(0, 0, 0);
              dummy.updateMatrix();
              streaks.setMatrixAt(i, dummy.matrix);
            }
            streaks.instanceMatrix.needsUpdate = true;
          }

          /* ---------------- nhân vật ---------------- */
          const aliveCount = total - outSet.size;
          let meX = focus.x;
          let meY = focus.y;
          let meZ = focus.z;
          let meOut = outSet.has(o.meId);
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const at = f.posOf(p.id);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const fl = at.flags;
            const isMe = p.id === o.meId;
            const out = !!(fl & F_OUT) || outSet.has(p.id);
            if (!e.placed) {
              e.x = at.x;
              e.y = at.y;
              e.z = at.z;
              e.yaw = Math.PI - at.face;
              e.placed = true;
            } else {
              const far = Math.hypot(at.x - e.x, at.y - e.y) > 2.5;
              const kk = far || isMe ? 1 : 1 - Math.exp(-dt * 18);
              e.x += (at.x - e.x) * kk;
              e.y += (at.y - e.y) * kk;
              e.z += (at.z - e.z) * (far || isMe ? 1 : 1 - Math.exp(-dt * 24));
            }
            const lifted = !!(fl & F_LIFT);
            const falling = !!(fl & F_FALL);
            const down = !!(fl & F_DOWN);
            const stunned = !!(fl & F_STUN) || time - e.hitAt < 0.5;
            const grounded = e.z < 0.08 && !falling;
            const spd = Math.hypot(at.vx, at.vy);

            // thân quay mượt theo hướng server
            const wantYaw = Math.PI - at.face;
            e.yaw += angDiff(e.yaw, wantYaw) * (1 - Math.exp(-dt * 16));
            e.c.setYaw(e.yaw);

            let pose: Pose = 'run';
            let speed = Math.min(1, spd / SPEED);
            if (aliveCount <= 1 && !out && total > 1) pose = 'cheer';
            else if (falling || (fl & F_THROWN)) pose = 'jump';
            else if (lifted) pose = 'hit';
            else if (fl & F_PUNCH) pose = 'punch';
            else if (fl & F_WHIFF) pose = 'sad';
            else if (fl & F_HELD) pose = 'hit';
            else if (fl & F_ANCHOR || fl & F_HOLD) pose = 'pull';
            else if (stunned) pose = 'hit';
            else if (!grounded) pose = 'jump';
            if (pose !== 'run') speed = 0;

            e.c.update(dt, {
              speed,
              dead: down && !falling,
              time,
              pose,
              holder: !!(fl & F_LIFTING),
            });

            // loạng choạng theo độ choáng; ngã nhào khi rơi
            const wob = Math.min(1, at.wob + (stunned ? 0.3 : 0));
            if (falling) {
              e.spin += dt * 7;
              e.c.root.rotation.z = e.spin;
              e.c.root.rotation.x = Math.sin(e.spin * 0.7) * 0.5;
            } else {
              e.spin = 0;
              e.c.root.rotation.x = 0;
              e.c.root.rotation.z = Math.sin(time * 8 + e.phase) * wob * 0.32 + (down ? 0 : 0);
            }
            e.c.root.position.set(e.x, e.z, -e.y);
            e.c.root.visible = !out || (falling && e.z > ROAD_Y - 0.5);
            if (out) e.out = true;

            if (!out) o.labels.get(p.id) && k.label(o.labels.get(p.id), e.x, e.z + 2.35, -e.y);
            else {
              const lab = o.labels.get(p.id);
              if (lab) lab.style.opacity = '0';
            }
            if (isMe) {
              meX = e.x;
              meY = e.z;
              meZ = -e.y;
              meOut = out;
            }
          }

          /* ---------------- camera góc nhìn thứ ba bằng chuột ---------------- */
          const c = f.cam.current;
          const tx = meOut ? 0 : meX;
          const ty = meOut ? 0.4 : meY;
          const tz = meOut ? 0 : meZ;
          const lk = 1 - Math.exp(-dt * 12);
          focus.x += (tx - focus.x) * lk;
          focus.y += (ty - focus.y) * lk;
          focus.z += (tz - focus.z) * lk;
          const wantDist = meOut ? 13 : 6.3;
          camDist += (wantDist - camDist) * (1 - Math.exp(-dt * 3));
          const cp = Math.cos(c.pitch);
          const sp2 = Math.sin(c.pitch);
          const fx3 = Math.sin(c.yaw);
          const fz3 = -Math.cos(c.yaw);
          const rx3 = Math.cos(c.yaw);
          const rz3 = Math.sin(c.yaw);
          const shoulder = meOut ? 0 : 0.75;
          camPos.set(
            focus.x - fx3 * camDist * cp + rx3 * shoulder,
            Math.max(0.5, focus.y + 1.5 + camDist * sp2),
            focus.z - fz3 * camDist * cp + rz3 * shoulder,
          );
          lookAt.set(focus.x + fx3 * 3.5 + rx3 * shoulder * 0.5, focus.y + 1.35, focus.z + fz3 * 3.5 + rz3 * shoulder * 0.5);
          k.look(camPos, lookAt);
          m4.identity();

          k.sun.target.position.copy(focus);
          k.sun.position.copy(focus).add(sunOff);
        },
        dispose() {
          for (const d of disposables) d.dispose();
        },
      };

      function lightsBrake(a: number) {
        brakeMat.color.set(a > 0.2 ? '#ff2d2d' : '#8a1d1d');
      }
    },
  );
}
