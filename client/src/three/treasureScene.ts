import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { runScene, tileTexture, type SceneHooks } from './scene';
import { sfx } from '../utils/sound';
import { BASE_R, MAXC, MAXI, MAXP, PILLAR_R, PR, faceRad, radDiff } from '@shared/treasure';
import type { TreasureClient } from '@shared/treasureClient';

export interface TreasureFrame {
  cl: TreasureClient;
  /** poll + dự đoán + nội suy tới giờ server hiện tại */
  step(now: number): void;
  serverNow(): number;
}

export interface TreasureSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  /** theo thứ tự ghế trong đấu trường */
  players: { id: string; color: string }[];
  meSeat: number;
  W: number;
  H: number;
  read: () => TreasureFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị thế giới = S đơn vị 3D */
const S = 0.04;
const PITCH = (62 * Math.PI) / 180;
const PAWN_SCALE = 1.25;

export function createTreasureScene(o: TreasureSceneOptions) {
  const { W, H } = o;
  const halfW = (W * S) / 2;
  const halfD = (H * S) / 2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [halfW + 1.5, halfD + 1.5] },
      sun: [-6, 22, 10],
      shadowBox: Math.max(halfW, halfD) + 3,
    },
    (k) => {
      const { scene } = k.engine;
      /** toạ độ thế giới (đv server) → 3D, gốc ở tâm sân */
      const wx = (x: number) => x * S - halfW;
      const wz = (y: number) => y * S - halfD;

      /* ---------------- sàn + viền ---------------- */
      const floorTex = tileTexture(k, Math.round(W / 40), Math.round(H / 40), ['#e7d3a6', '#efdfb8'], 'rgba(120,80,30,0.7)');
      const floor = new Mesh(new PlaneGeometry(halfW * 2, halfD * 2), new MeshLambertMaterial({ map: floorTex }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.02;
      scene.add(floor);
      const wallMat = new MeshLambertMaterial({ color: '#8a5a2b' });
      const wallT = 0.5;
      const addWall = (x: number, z: number, sx: number, sz: number) => {
        const m = new Mesh(new BoxGeometry(sx, 0.7, sz), wallMat);
        m.position.set(x, 0.33, z);
        scene.add(m);
      };
      addWall(0, -halfD - wallT / 2, halfW * 2 + wallT * 2, wallT);
      addWall(0, halfD + wallT / 2, halfW * 2 + wallT * 2, wallT);
      addWall(-halfW - wallT / 2, 0, wallT, halfD * 2);
      addWall(halfW + wallT / 2, 0, wallT, halfD * 2);

      /* ---------------- trung tâm kho báu + cột đá ---------------- */
      const centerGlow = new Mesh(
        new CircleGeometry(Math.min(W, H) * 0.19 * S, 40),
        new MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.22, depthWrite: false }),
      );
      centerGlow.rotation.x = -Math.PI / 2;
      centerGlow.position.set(0, 0.04, 0);
      scene.add(centerGlow);
      const pillarMat = new MeshLambertMaterial({ color: '#7c8296' });
      const capMat = new MeshLambertMaterial({ color: '#a9afc4' });
      for (let p = 0; p < 4; p++) {
        const px = W / 2 + (p % 2 ? 1 : -1) * W * 0.2;
        const py = H / 2 + (p < 2 ? -1 : 1) * H * 0.2;
        const body = new Mesh(new CylinderGeometry(PILLAR_R * S, PILLAR_R * S * 1.08, 1.5, 14), pillarMat);
        body.position.set(wx(px), 0.75, wz(py));
        const cap = new Mesh(new CylinderGeometry(PILLAR_R * S * 1.12, PILLAR_R * S * 1.12, 0.18, 14), capMat);
        cap.position.set(wx(px), 1.55, wz(py));
        scene.add(body, cap);
      }

      /* ---------------- căn cứ ---------------- */
      const baseRings: Mesh[] = [];
      const baseArrow: Group[] = [];
      o.players.forEach((pl, i) => {
        const cl0 = o.read().cl;
        const bx = wx(cl0.world.bx[i]);
        const bz = wz(cl0.world.by[i]);
        const disc = new Mesh(
          new CircleGeometry(BASE_R * S, 36),
          new MeshBasicMaterial({ color: pl.color, transparent: true, opacity: 0.42, depthWrite: false }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(bx, 0.05, bz);
        scene.add(disc);
        const ring = new Mesh(new RingGeometry(BASE_R * S - 0.12, BASE_R * S, 40), new MeshBasicMaterial({ color: pl.color, transparent: true, opacity: 0.95, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(bx, 0.06, bz);
        scene.add(ring);
        baseRings.push(ring);
        // rương nhỏ
        const chest = new Group();
        const box = new Mesh(new BoxGeometry(0.9, 0.5, 0.6), new MeshLambertMaterial({ color: '#a1662f' }));
        box.position.y = 0.25;
        const lid = new Mesh(new CylinderGeometry(0.3, 0.3, 0.9, 10, 1, false, 0, Math.PI), new MeshLambertMaterial({ color: pl.color }));
        lid.rotation.z = Math.PI / 2;
        lid.rotation.y = Math.PI / 2;
        lid.position.y = 0.5;
        const band = new Mesh(new BoxGeometry(0.12, 0.56, 0.64), new MeshLambertMaterial({ color: '#ffd23f' }));
        band.position.y = 0.27;
        chest.add(box, lid, band);
        chest.position.set(bx, 0, bz);
        scene.add(chest);
        if (i === o.meSeat) {
          const g = new Group();
          const cone = new Mesh(new ConeGeometry(0.28, 0.6, 12), new MeshBasicMaterial({ color: '#ffffff' }));
          cone.rotation.x = Math.PI;
          g.add(cone);
          g.position.set(bx, 2.1, bz);
          scene.add(g);
          baseArrow.push(g);
        }
      });

      /* ---------------- người chơi ---------------- */
      interface Pawn {
        g: Group;
        body: Mesh;
        head: Mesh;
        bodyMat: MeshLambertMaterial;
        shield: Mesh;
        yaw: number;
        px: number;
        pz: number;
        speed: number;
        phase: number;
        swing: number;
      }
      const shadowGeo = new CircleGeometry(PR * S * 1.15, 16);
      const shadowMat = new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false });
      const pawns: Pawn[] = o.players.map((p, i) => {
        const g = new Group();
        const bodyMat = new MeshLambertMaterial({ color: p.color });
        const body = new Mesh(new CylinderGeometry(PR * S * 0.78, PR * S * 0.95, 0.75, 14), bodyMat);
        body.position.y = 0.4;
        const head = new Mesh(new SphereGeometry(PR * S * 0.85, 14, 10), new MeshLambertMaterial({ color: '#ffe0bd' }));
        head.position.y = 1.0;
        const nose = new Mesh(new BoxGeometry(0.18, 0.1, 0.18), new MeshLambertMaterial({ color: '#2b2b3a' }));
        nose.position.set(0.3, 1.05, 0);
        const hat = new Mesh(new CylinderGeometry(PR * S * 0.55, PR * S * 0.85, 0.18, 12), new MeshLambertMaterial({ color: '#2b2b3a' }));
        hat.position.y = 1.32;
        const sh = new Mesh(shadowGeo, shadowMat);
        sh.rotation.x = -Math.PI / 2;
        sh.position.y = 0.07;
        const shield = new Mesh(new SphereGeometry(0.75, 16, 12), new MeshBasicMaterial({ color: '#7fe9ff', transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false }));
        shield.position.y = 0.7;
        shield.visible = false;
        g.add(body, head, nose, hat, shield);
        scene.add(g, sh);
        // bóng đổ riêng bám theo g (đặt ở scene để không xoay theo hướng)
        (g as Group & { blob?: Mesh }).blob = sh;
        void i;
        return { g, body, head, bodyMat, shield, yaw: 0, px: 0, pz: 0, speed: 0, phase: i * 1.7, swing: 0 };
      });

      /* ---------------- kho báu (InstancedMesh) ---------------- */
      const coinGeo = new CylinderGeometry(0.38, 0.38, 0.12, 14);
      const coinMat = new MeshLambertMaterial({ color: '#ffc61a', emissive: '#7a5200' });
      const groundCoins = new InstancedMesh(coinGeo, coinMat, MAXI);
      groundCoins.frustumCulled = false;
      groundCoins.count = 0;
      scene.add(groundCoins);
      const carried = new InstancedMesh(new CylinderGeometry(0.26, 0.26, 0.08, 12), coinMat, MAXP * MAXC);
      carried.frustumCulled = false;
      carried.count = 0;
      scene.add(carried);
      const born = new Float32Array(MAXI);
      const bornId = new Int32Array(MAXI);

      const m4 = new Matrix4();
      const q = new Quaternion();
      const eul = new Euler();
      const v3 = new Vector3();
      const v3s = new Vector3();

      /* ---------------- camera ---------------- */
      const focus = new Vector3(0, 0, 0.3);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const dist = k.fit(halfW + 1.2, halfD + 1.2, PITCH) * 1.03;

      let fxBudget = 0;
      let lastPickSfx = 0;

      const handleFx = (f: TreasureFrame, nowMs: number) => {
        const cl = f.cl;
        const me = o.meSeat;
        for (const e of cl.fx) {
          const x = wx(e.x);
          const z = wz(e.y);
          switch (e.kind) {
            case 'pick':
              if (e.i === me && nowMs - lastPickSfx > 40) {
                lastPickSfx = nowMs;
                sfx.trPick();
              }
              if (fxBudget < 8) {
                fxBudget++;
                k.effects.burst(x, 0.7, z, { count: k.count(6), palette: ['#fff3a0', '#ffd23f'], speed: 2.4, life: 0.35, size: 0.2, gravity: 4, drag: 3 });
              }
              break;
            case 'deliver': {
              if (e.i === me) sfx.trDeliver();
              else sfx.trDeliverOther();
              const col = o.players[e.i]?.color ?? '#ffd23f';
              k.effects.burst(x, 0.9, z, { count: k.count(10 + e.v * 5), palette: ['#ffe27a', '#ffd23f', col, '#ffffff'], speed: 6, life: 0.9, size: 0.3, gravity: 7, drag: 1.2 });
              k.effects.ring(x, z, '#ffd23f', 0.7, BASE_R * S * 1.6);
              break;
            }
            case 'steal':
              sfx.trSteal();
              k.effects.burst(x, 0.9, z, { count: k.count(18), palette: ['#ff5a5a', '#ffd23f', '#ffffff'], speed: 5, life: 0.5, size: 0.3, gravity: 6, drag: 2 });
              k.effects.ring(x, z, '#ff6a6a', 0.45, 3);
              k.shake(e.i === me || e.v === me ? 0.4 : 0.12);
              break;
            case 'drop':
              k.effects.burst(x, 0.8, z, { count: k.count(8), palette: ['#ffd23f', '#fff3a0'], speed: 3.5, life: 0.5, size: 0.22, gravity: 9, drag: 1.5 });
              break;
            case 'swing': {
              if (e.i === me) sfx.trSwing();
              else if (fxBudget < 8) {
                sfx.trSwingOther();
                fxBudget++;
              }
              if (pawns[e.i]) pawns[e.i].swing = 0.28;
              break;
            }
            case 'shove':
              sfx.trShove();
              k.effects.burst(x, 0.5, z, { count: k.count(10), palette: ['#ffffff', '#d9c9a3'], speed: 3, life: 0.4, size: 0.28, gravity: 2, drag: 3 });
              if (pawns[e.v]) pawns[e.v].swing = 0.28;
              if (e.i === me) k.shake(0.2);
              break;
            case 'wave':
              sfx.trWave();
              k.effects.ring(wx(W / 2), wz(H / 2), '#ffd23f', 0.9, Math.min(W, H) * 0.3 * S);
              k.effects.burst(wx(W / 2), 1.2, wz(H / 2), { count: k.count(26), palette: ['#ffe27a', '#ffd23f', '#ffffff'], speed: 5, life: 0.9, size: 0.3, gravity: 8, drag: 1.5 });
              break;
            case 'over':
              sfx.trWhistle();
              break;
            default:
              break;
          }
        }
        cl.fx.length = 0;
      };

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.step(now);
          const cl = f.cl;
          fxBudget = 0;
          handleFx(f, now);
          const w = cl.world;

          /* người chơi */
          let cn = 0;
          for (let i = 0; i < o.players.length; i++) {
            const pw = pawns[i];
            const x = wx(cl.rx[i]);
            const z = wz(cl.ry[i]);
            const mv = Math.hypot(x - pw.px, z - pw.pz);
            pw.speed += (Math.min(1, mv / Math.max(dt, 1e-3) / 6) - pw.speed) * Math.min(1, dt * 10);
            pw.px = x;
            pw.pz = z;
            const target = faceRad(cl.rface[i]);
            pw.yaw += radDiff(pw.yaw, target) * Math.min(1, dt * 14);
            pw.phase += dt * (6 + pw.speed * 8);
            const load = Math.min(MAXC, w.load[i]);
            const bob = Math.abs(Math.sin(pw.phase)) * 0.14 * pw.speed;
            pw.g.position.set(x, bob, z);
            pw.g.rotation.y = -pw.yaw;
            // dốc người về phía trước khi chạy, nặng thì lom khom
            pw.g.rotation.z = -0.12 * pw.speed - load * 0.015;
            const st = 1 + Math.sin(pw.phase * 2) * 0.03 * pw.speed;
            pw.g.scale.set(PAWN_SCALE, st * PAWN_SCALE, PAWN_SCALE);
            if (pw.swing > 0) {
              pw.swing -= dt;
              const t = Math.max(0, pw.swing) / 0.28;
              pw.g.rotation.x = Math.sin(t * Math.PI) * 0.35;
            } else pw.g.rotation.x = 0;
            const blob = (pw.g as Group & { blob?: Mesh }).blob;
            if (blob) blob.position.set(x, 0.07, z);
            // miễn nhiễm: nhấp nháy khiên
            const imm = !!cl.immune[i];
            pw.shield.visible = imm;
            if (imm) pw.shield.scale.setScalar(1 + Math.sin(time * 12) * 0.06);
            pw.bodyMat.emissive.set(imm && Math.sin(time * 16) > 0 ? '#445566' : '#000000');
            // đống kho báu mang trên lưng/đầu
            for (let c = 0; c < load; c++) {
              const wob = Math.sin(time * 5 + c) * 0.025 * (1 + pw.speed);
              m4.compose(v3.set(x + wob, bob + 1.75 + c * 0.11, z), q.identity(), v3s.set(1.15, 1.15, 1.15));
              carried.setMatrixAt(cn++, m4);
            }
            const lab = o.labels.get(o.players[i].id);
            k.label(lab, x, 2.2 + load * 0.11, z);
          }
          carried.count = cn;
          carried.instanceMatrix.needsUpdate = true;

          /* kho báu trên sân */
          let gn = 0;
          for (let s = 0; s < MAXI; s++) {
            if (!cl.iAct[s] || cl.ihide[s]) continue;
            const id = cl.iid[s];
            if (bornId[s] !== id) {
              bornId[s] = id;
              born[s] = time;
            }
            const age = time - born[s];
            const pop = age < 0.3 ? 1 + Math.sin((age / 0.3) * Math.PI) * 0.6 : 1;
            const hop = age < 0.4 ? Math.sin((age / 0.4) * Math.PI) * 0.7 : 0;
            eul.set(Math.PI / 2, time * 2.2 + s * 0.9, 0, 'YXZ');
            q.setFromEuler(eul);
            m4.compose(v3.set(wx(cl.ix[s]), 0.42 + hop + Math.sin(time * 3 + s) * 0.05, wz(cl.iy[s])), q, v3s.set(pop, pop, pop));
            groundCoins.setMatrixAt(gn++, m4);
          }
          groundCoins.count = gn;
          groundCoins.instanceMatrix.needsUpdate = true;

          /* căn cứ của mình nhấp nháy */
          for (const b of baseArrow) b.position.y = 2.0 + Math.sin(time * 4) * 0.2;
          for (let i = 0; i < baseRings.length; i++) {
            const mat = baseRings[i].material as MeshBasicMaterial;
            mat.opacity = i === o.meSeat ? 0.7 + Math.sin(time * 5) * 0.3 : 0.8;
          }
          (centerGlow.material as MeshBasicMaterial).opacity = 0.16 + Math.sin(time * 2) * 0.06;

          k.look(camPos.copy(focus).addScaledVector(camDir, dist), focus);
        },
        dispose() {
          floorTex.dispose();
        },
      };
    },
  );
}
