import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
  Euler,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { MtConfig, MtFx, MtPos } from '../games/mountain/useMountainGame';

export interface MountainFrame {
  cfg: MtConfig;
  startAt: number;
  positions: { current: Record<string, MtPos> };
  fx: { current: MtFx[] };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number } | undefined;
  serverNow(): number;
}

export interface MountainSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => MountainFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
/** độ dốc của núi (rad) */
const TILT = 0.2;
const CHAR_SCALE = 0.85;
const FOLLOW_UP = 6.4;
const FOLLOW_BACK = 7.6;
const BALL_COLORS = ['#ff5e5e', '#ff9f43', '#b07cff', '#2fc4e8', '#ff6bd6'];

export function createMountainScene(o: MountainSceneOptions) {
  const first = o.read();
  const cfg = first.cfg;
  const W = cfg.w * S;
  const LEN = cfg.len * S;
  const sinT = Math.sin(TILT);
  const cosT = Math.cos(TILT);
  // cả sườn núi được dịch để nằm giữa khung cảnh
  const gy = -(LEN * sinT) / 2;
  const gz = (LEN * cosT) / 2;
  /** (x, y) của server → toạ độ thế giới của một điểm nằm trên mặt dốc */
  const worldY = (y: number) => gy + y * S * sinT;
  const worldZ = (y: number) => gz - y * S * cosT;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [W / 2 + 4, (LEN * cosT) / 2 + 2], groundY: gy - 1.2, ground: true },
      sun: [-8, 26, 10],
      shadowBox: 15,
    },
    (k) => {
      const { scene } = k.engine;
      const m = new Matrix4();
      const quat = new Quaternion();
      const euler = new Euler();
      const pos = new Vector3();
      const scl = new Vector3();

      /* ---------------- thân núi (khối đá bên dưới mặt dốc) ---------------- */
      {
        const H = LEN * cosT;
        const shape = new Shape();
        shape.moveTo(0, gy - 6);
        shape.lineTo(H, gy - 6);
        shape.lineTo(H, gy + LEN * sinT - 0.45);
        shape.lineTo(0, gy - 0.45);
        shape.closePath();
        const depth = W + 1.4;
        const rock = new Mesh(new ExtrudeGeometry(shape, { depth, bevelEnabled: false }), k.lit({ color: '#b99a74' }));
        rock.rotation.y = Math.PI / 2;
        rock.position.set(-depth / 2, 0, gz + 0.0);
        rock.receiveShadow = true;
        scene.add(rock);
      }

      /* ---------------- mặt dốc: mọi thứ trên núi nằm trong một nhóm nghiêng ---------------- */
      const slope = new Group();
      slope.position.set(0, gy, gz);
      slope.rotation.x = TILT;
      scene.add(slope);

      const stripLen = 2.5;
      const strips = Math.ceil(LEN / stripLen) + 2;
      const floor = new InstancedMesh(new BoxGeometry(W + 0.6, 0.4, stripLen), k.lit({ color: '#ffffff' }), strips);
      floor.receiveShadow = true;
      for (let i = 0; i < strips; i++) {
        m.makeTranslation(0, -0.2, 1 - i * stripLen);
        floor.setMatrixAt(i, m);
        floor.setColorAt(i, new Color(i % 2 ? '#f7fbff' : '#dcebfa'));
      }
      slope.add(floor);

      const railMat = k.lit({ color: '#8a6a4a' });
      for (const s of [-1, 1]) {
        const rail = new Mesh(new BoxGeometry(0.5, 1.1, LEN + 4), railMat);
        rail.position.set(s * (W / 2 + 0.55), 0.55, -LEN / 2);
        rail.castShadow = !k.low;
        slope.add(rail);
      }

      // vạch xuất phát + cổng đỉnh núi
      const checker = k.texture(256, 64, (g, w, h) => {
        const c = h / 2;
        for (let x = 0; x < w / c; x++) {
          for (let y = 0; y < 2; y++) {
            g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
            g.fillRect(x * c, y * c, c, c);
          }
        }
      });
      const startLine = new Mesh(new BoxGeometry(W, 0.02, 0.4), k.lit({ color: '#ffffff' }));
      startLine.position.set(0, 0.02, -1.5 * S * 10 * 0.1);
      slope.add(startLine);
      const poleMat = k.lit({ color: '#ffd23f' });
      for (const s of [-1, 1]) {
        const pole = new Mesh(new CylinderGeometry(0.28, 0.32, 4.6, 20), poleMat);
        pole.position.set(s * (W / 2 + 0.6), 2.3, -LEN);
        pole.castShadow = !k.low;
        slope.add(pole);
      }
      const banner = new Mesh(new BoxGeometry(W + 1.7, 0.8, 0.5), k.lit({ map: checker }));
      banner.position.set(0, 4.5, -LEN);
      slope.add(banner);
      const goal = new Mesh(new BoxGeometry(W, 0.02, 0.5), k.lit({ map: checker }));
      goal.position.set(0, 0.02, -LEN);
      slope.add(goal);

      /* ---------------- chướng ngại theo lịch ---------------- */
      const balls = cfg.obstacles.map((ob, i) => ({ ob, i })).filter((e) => e.ob.k === 0);
      const logs = cfg.obstacles.map((ob, i) => ({ ob, i })).filter((e) => e.ob.k === 1);

      const stripes = k.texture(128, 128, (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#cfcfd8';
        for (let i = 0; i < 4; i++) g.fillRect(0, i * (h / 4), w, h / 8);
      });
      const ballMesh = new InstancedMesh(new SphereGeometry(1, 20, 14), k.lit({ map: stripes }), Math.max(1, balls.length));
      ballMesh.castShadow = !k.low;
      ballMesh.frustumCulled = false;
      balls.forEach((b, j) => ballMesh.setColorAt(j, new Color(BALL_COLORS[b.i % BALL_COLORS.length])));
      const logGeo = new CylinderGeometry(cfg.logDepth * S * 1.15, cfg.logDepth * S * 1.15, 1, 18);
      logGeo.rotateZ(Math.PI / 2);
      const logMesh = new InstancedMesh(logGeo, k.lit({ map: stripes }), Math.max(1, logs.length));
      logMesh.castShadow = !k.low;
      logMesh.frustumCulled = false;
      logs.forEach((_, j) => logMesh.setColorAt(j, new Color('#c98f55')));
      slope.add(ballMesh, logMesh);

      const hiddenBall = new Uint8Array(balls.length);
      const hiddenLog = new Uint8Array(logs.length);
      const placeObstacles = (t: number) => {
        let dirty = false;
        balls.forEach(({ ob }, j) => {
          const y = cfg.topY - ob.v * (t - ob.t0);
          const vis = y > -20 && y < cfg.topY + 2;
          if (!vis) {
            if (!hiddenBall[j]) {
              hiddenBall[j] = 1;
              m.makeScale(0, 0, 0);
              ballMesh.setMatrixAt(j, m);
              dirty = true;
            }
            return;
          }
          hiddenBall[j] = 0;
          const r = ob.s * S;
          const rolled = (ob.v * (t - ob.t0) * S) / r;
          quat.setFromEuler(euler.set(rolled, 0, 0));
          pos.set(ob.x * S, r, -y * S);
          m.compose(pos, quat, scl.set(r, r, r));
          ballMesh.setMatrixAt(j, m);
          dirty = true;
        });
        if (dirty) ballMesh.instanceMatrix.needsUpdate = true;
        dirty = false;
        logs.forEach(({ ob }, j) => {
          const y = cfg.topY - ob.v * (t - ob.t0);
          const vis = y > -20 && y < cfg.topY + 2;
          if (!vis) {
            if (!hiddenLog[j]) {
              hiddenLog[j] = 1;
              m.makeScale(0, 0, 0);
              logMesh.setMatrixAt(j, m);
              dirty = true;
            }
            return;
          }
          hiddenLog[j] = 0;
          const rad = cfg.logDepth * S * 1.15;
          const rolled = (ob.v * (t - ob.t0) * S) / rad;
          quat.setFromEuler(euler.set(rolled, 0, 0));
          pos.set(ob.x * S, rad, -y * S);
          m.compose(pos, quat, scl.set(ob.s * 2 * S, 1, 1));
          logMesh.setMatrixAt(j, m);
          dirty = true;
        });
        if (dirty) logMesh.instanceMatrix.needsUpdate = true;
      };

      // búa quét: thanh quay quanh một trụ
      const spinMat = k.lit({ color: '#ff5e8a' });
      const poleGeo = new CylinderGeometry(0.22, 0.3, 1.1, 16);
      const spinners = cfg.spinners.map((s) => {
        const g = new Group();
        g.position.set(s.x * S, 0, -s.y * S);
        const post = new Mesh(poleGeo, k.lit({ color: '#ffd23f' }));
        post.position.y = 0.55;
        post.castShadow = !k.low;
        const bar = new Mesh(new BoxGeometry(s.half * 2 * S, 0.34, 0.34), spinMat);
        bar.position.y = 0.55;
        bar.castShadow = !k.low;
        const capL = new Mesh(new SphereGeometry(0.42, 14, 10), k.lit({ color: '#ffe27a' }));
        const capR = capL.clone();
        capL.position.set(-s.half * S, 0.55, 0);
        capR.position.set(s.half * S, 0.55, 0);
        capL.castShadow = capR.castShadow = !k.low;
        g.add(post, bar, capL, capR);
        slope.add(g);
        return { g, s };
      });

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        px: number;
        pz: number;
        placed: boolean;
        wasFin: boolean;
        hitAt: number;
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, z: 0, px: 0, pz: 0, placed: false, wasFin: false, hitAt: -1e9 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const focus = new Vector3(0, worldY(0) + 1, worldZ(0));
      const camPos = new Vector3();
      const aim = new Vector3();
      const sunOff = new Vector3(-8, 26, 10);
      const sunAim = new Vector3();

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          placeObstacles((now - f.startAt) / 1000);
          for (const sp of spinners) sp.g.rotation.y = sp.s.ph + sp.s.w * ((now - f.startAt) / 1000);

          // cú trúng: hạt + rung màn hình
          const list = f.fx.current;
          while (list.length) {
            const h = list.shift()!;
            const e = chars.get(h.playerId);
            if (!e) continue;
            e.hitAt = time;
            k.effects.burst(e.x, worldY(0) + 1, e.z, {
              count: k.count(16),
              palette: ['#ffffff', '#ffd166', '#ff5e8a'],
              speed: 3.4,
              life: 0.6,
              size: 0.16,
              gravity: -4,
            });
            if (h.playerId === o.meId) k.shake(0.5);
          }

          let meX = 0;
          let meWY = worldY(0);
          let meZ = worldZ(0);
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const sp = cfg.spawns[p.id];
            const at = f.posOf(p.id) ?? (sp ? { x: sp[0], y: sp[1] } : undefined);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const server = f.positions.current[p.id];
            const tx = at.x * S;
            const ty = at.y;
            if (!e.placed) {
              e.x = tx;
              e.z = ty;
              e.placed = true;
            } else {
              // mình bám sát dự đoán; bị văng (lệch xa) hoặc người khác thì lướt mượt
              const far = Math.hypot(tx - e.x, (ty - e.z) * S) > 0.9;
              const kk = p.id === o.meId && !far ? 1 : 1 - Math.exp(-dt * (p.id === o.meId ? 20 : 14));
              e.x += (tx - e.x) * kk;
              e.z += (ty - e.z) * kk;
            }
            // e.z đang giữ y của server
            const wy = worldY(e.z);
            const wz = worldZ(e.z);
            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = ((worldZ(e.z) - worldZ(e.pz)) / Math.max(dt, 1e-3)) || 0;
            e.px = e.x;
            e.pz = e.z;

            const finished = !!server?.f;
            const stunned = !!server?.s || time - e.hitAt < 0.5;
            if (finished && !e.wasFin) {
              e.wasFin = true;
              k.effects.burst(e.x, wy + 1.2, wz, {
                count: k.count(18),
                palette: ['#ffd166', '#ff5e8a', '#5ed67a', '#ffffff'],
                speed: 3.4,
                life: 0.9,
                size: 0.15,
                gravity: -3,
              });
            }
            e.c.root.visible = true;
            e.c.root.position.set(e.x, wy, wz);
            if (finished) e.c.setYaw(Math.PI);
            else if (!stunned) e.c.face(vx, vz, dt);
            e.c.update(dt, {
              speed: stunned || finished ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              time,
              safe: !!server?.g && !finished,
              pose: finished ? 'cheer' : stunned ? 'hit' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, wy + 2.2, wz);
            if (p.id === o.meId) {
              meX = e.x;
              meWY = wy;
              meZ = wz;
            }
          }

          // góc nhìn thứ ba: bám sau lưng, nhìn lên đỉnh núi
          aim.set(meX, meWY + 0.9, meZ - 1.6);
          focus.lerp(aim, 1 - Math.exp(-dt * 6));
          camPos.set(focus.x * 0.9, focus.y + FOLLOW_UP, focus.z + FOLLOW_BACK);
          k.look(camPos, focus);

          // bóng đổ đi theo người chơi (sườn núi dài hơn vùng bóng của mặt trời)
          sunAim.copy(focus);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
      };
    },
  );
}
