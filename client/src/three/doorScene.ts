import { BoxGeometry, Color, Euler, InstancedMesh, Matrix4, Mesh, Quaternion, SphereGeometry, Vector3, CylinderGeometry } from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { DoorConfig, DoorFx, DoorPos } from '../games/door/useDoorGame';

export interface DoorFrame {
  cfg: DoorConfig;
  positions: { current: Record<string, DoorPos> };
  open: { current: boolean[] };
  fx: { current: DoorFx[] };
  closeAt: { current: number[] };
  tried: { current: boolean[] };
  behind: boolean;
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number } | undefined;
  serverNow(): number;
}

export interface DoorSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => DoorFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const DOOR_H = 2.4;
const CHAR_SCALE = 0.85;
const PITCH = 0.62;
const FOLLOW_UP = 7;
const FOLLOW_BACK = 7.4;
const SWING = 1.75;

/** màu mỗi hàng cửa (cửa thật và cửa giả luôn cùng màu, không có gợi ý nào) */
const ROW_COLORS = ['#ff5e8a', '#ff9f43', '#ffd23f', '#5ed67a', '#2fc4e8', '#6c8cff', '#b07cff', '#ff6bd6'];

export function createDoorScene(o: DoorSceneOptions) {
  const cfg = o.read().cfg;
  const { cols, rows } = cfg;
  const W = cfg.w * S;
  const DW = cfg.doorW * S;
  const LEN = cfg.finishY * S;
  const halfLen = LEN / 2;
  const thick = cfg.half * 2 * S;
  const doors = rows * cols;
  /** x/y của server → x/z của cảnh: đích ở phía -z */
  const wx = (x: number) => x * S;
  const wz = (y: number) => halfLen - y * S;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [W / 2 + 3, halfLen + 6], groundY: -0.4, ground: true },
      sun: [-8, 26, 10],
      shadowBox: 15,
    },
    (k) => {
      const { scene } = k.engine;
      const m = new Matrix4();
      const quat = new Quaternion();
      const euler = new Euler();
      const pos = new Vector3();
      const one = new Vector3(1, 1, 1);

      /* ---------------- sàn: dải màu xen kẽ để thấy mình đang chạy ---------------- */
      const stripLen = 2.5;
      const strips = Math.ceil(LEN / stripLen) + 1;
      const floor = new InstancedMesh(new BoxGeometry(W + 0.6, 0.4, stripLen), k.lit({ color: '#ffffff' }), strips);
      floor.receiveShadow = true;
      for (let i = 0; i < strips; i++) {
        m.makeTranslation(0, -0.2, halfLen + 1 - i * stripLen);
        floor.setMatrixAt(i, m);
        floor.setColorAt(i, new Color(i % 2 ? '#fff0c9' : '#ffe2a0'));
      }
      scene.add(floor);

      // tường bên
      const wallMat = k.lit({ color: '#ffffff' });
      for (const s of [-1, 1]) {
        const wall = new Mesh(new BoxGeometry(0.5, 1.5, LEN + 4), wallMat);
        wall.position.set(s * (W / 2 + 0.55), 0.75, 0);
        wall.castShadow = !k.low;
        scene.add(wall);
      }

      /* ---------------- khung cửa: cột + dầm ngang cho mỗi hàng ---------------- */
      const postGeo = new BoxGeometry(0.32, DOOR_H + 0.45, thick + 0.06);
      const posts = new InstancedMesh(postGeo, k.lit({ color: '#ffffff' }), rows * (cols + 1));
      const lintels = new InstancedMesh(new BoxGeometry(W + 0.7, 0.45, thick + 0.06), k.lit({ color: '#ffffff' }), rows);
      posts.castShadow = lintels.castShadow = !k.low;
      for (let r = 0; r < rows; r++) {
        const z = wz(cfg.rowY[r]);
        const c = new Color(ROW_COLORS[r % ROW_COLORS.length]).multiplyScalar(0.72);
        for (let i = 0; i <= cols; i++) {
          m.makeTranslation(-W / 2 + i * DW, (DOOR_H + 0.45) / 2, z);
          posts.setMatrixAt(r * (cols + 1) + i, m);
          posts.setColorAt(r * (cols + 1) + i, c);
        }
        m.makeTranslation(0, DOOR_H + 0.225, z);
        lintels.setMatrixAt(r, m);
        lintels.setColorAt(r, c);
      }
      scene.add(posts, lintels);

      /* ---------------- cánh cửa + tay nắm: mỗi loại một InstancedMesh ---------------- */
      const panelW = DW - 0.05;
      const panels = new InstancedMesh(new BoxGeometry(panelW, DOOR_H, 0.26), k.lit({ color: '#ffffff' }), doors);
      const knobs = new InstancedMesh(new SphereGeometry(0.1, 12, 10), k.lit({ color: '#ffe27a' }), doors);
      panels.castShadow = !k.low;
      panels.frustumCulled = knobs.frustumCulled = false;
      const base: Color[] = [];
      for (let r = 0; r < rows; r++) {
        const c = new Color(ROW_COLORS[r % ROW_COLORS.length]);
        for (let i = 0; i < cols; i++) {
          // sáng/tối xen kẽ nhẹ cho đỡ đơn điệu (xen kẽ theo cột cố định, không liên quan cửa thật/giả)
          const col = c.clone().lerp(new Color('#ffffff'), i % 2 ? 0.12 : 0);
          base.push(col);
          panels.setColorAt(r * cols + i, col);
        }
      }
      scene.add(panels, knobs);

      const hingeX = (d: number) => -W / 2 + (d % cols) * DW + 0.025;
      const doorZ = (d: number) => wz(cfg.rowY[Math.floor(d / cols)]);
      const swing = new Float32Array(doors);
      const openState = new Uint8Array(doors);
      const bumpAt = new Float64Array(doors).fill(-1e9);
      let timeNow = 0;

      const flash = new Color('#ffffff');
      const dark = new Color('#3a3a48');
      const tmp = new Color();
      const placeDoors = (dt: number) => {
        const open = o.read().open.current;
        const closeAt = o.read().closeAt.current;
        const nowMs = o.read().serverNow();
        const tried = o.read().tried.current;
        const hint = o.read().behind;
        let colorDirty = false;
        for (let d = 0; d < doors; d++) {
          const target = open[d] ? 1 : 0;
          if (swing[d] !== target) swing[d] += (target - swing[d]) * (1 - Math.exp(-dt * 9));
          if (Math.abs(swing[d] - target) < 0.004) swing[d] = target;
          const bt = timeNow - bumpAt[d];
          let wob = 0;
          if (bt < 0.6) wob = Math.sin(bt * 55) * 0.07 * (1 - bt / 0.6);
          // sắp đóng sầm: cửa rung báo hiệu
          const left = closeAt[d] - nowMs;
          if (open[d] && closeAt[d] && left < 900) wob += Math.sin(timeNow * 40) * 0.08;
          const th = swing[d] * SWING + wob;
          const cs = Math.cos(th);
          const sn = Math.sin(th);
          quat.setFromEuler(euler.set(0, th, 0));
          // bản lề ở mép trái; quay quanh trục đứng
          pos.set(hingeX(d) + (panelW / 2) * cs, DOOR_H / 2, doorZ(d) - (panelW / 2) * sn);
          m.compose(pos, quat, one);
          panels.setMatrixAt(d, m);
          pos.set(hingeX(d) + panelW * 0.85 * cs + 0.2 * sn, 1.25, doorZ(d) - panelW * 0.85 * sn + 0.2 * cs);
          m.compose(pos, quat, one);
          knobs.setMatrixAt(d, m);

          // đâm trúng cửa giả: nháy trắng-đỏ một nhịp
          const flashing = bt < 0.3;
          const dim = hint && !!tried[d] && !open[d];
          if (flashing || dim || openState[d] === 2) {
            tmp.copy(base[d]);
            if (dim) tmp.lerp(dark, 0.55);
            if (flashing) tmp.lerp(flash, 0.7 * (1 - bt / 0.3));
            panels.setColorAt(d, tmp);
            openState[d] = flashing || dim ? 2 : 0;
            colorDirty = true;
          }
        }
        panels.instanceMatrix.needsUpdate = true;
        knobs.instanceMatrix.needsUpdate = true;
        if (colorDirty && panels.instanceColor) panels.instanceColor.needsUpdate = true;
      };

      /* ---------------- cổng đích + vạch xuất phát ---------------- */
      const poleMat = k.lit({ color: '#ffd23f' });
      for (const s of [-1, 1]) {
        const pole = new Mesh(new CylinderGeometry(0.28, 0.32, 4.6, 20), poleMat);
        pole.position.set(s * (W / 2 + 0.6), 2.3, wz(cfg.finishY));
        pole.castShadow = !k.low;
        scene.add(pole);
      }
      const checker = k.texture(256, 64, (g, w, h) => {
        const c = h / 2;
        for (let x = 0; x < w / c; x++) {
          for (let y = 0; y < 2; y++) {
            g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
            g.fillRect(x * c, y * c, c, c);
          }
        }
      });
      const banner = new Mesh(new BoxGeometry(W + 1.7, 0.8, 0.5), k.lit({ map: checker }));
      banner.position.set(0, 4.5, wz(cfg.finishY));
      scene.add(banner);
      const line = new Mesh(new BoxGeometry(W, 0.02, 0.5), k.lit({ map: checker }));
      line.position.set(0, 0.02, wz(cfg.finishY));
      scene.add(line);

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        px: number;
        pz: number;
        placed: boolean;
        wasFin: boolean;
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, z: 0, px: 0, pz: 0, placed: false, wasFin: false });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const focus = new Vector3(0, 1, halfLen - 8);
      const camPos = new Vector3();
      const aim = new Vector3();
      const sunOff = new Vector3(-8, 26, 10);
      const sunAim = new Vector3();
      void PITCH;

      const drainFx = () => {
        const list = o.read().fx.current;
        while (list.length) {
          const f = list.shift()!;
          const d = f.row * cols + f.col;
          const cx = hingeX(d) + panelW / 2;
          const z = doorZ(d);
          if (f.kind === 'shut') {
            bumpAt[d] = timeNow;
            k.effects.burst(cx, 0.4, z, { count: k.count(10), palette: ['#ffffff', '#c9a56a'], speed: 2.4, life: 0.5, size: 0.14, gravity: -3 });
          } else if (f.kind === 'bump') {
            bumpAt[d] = timeNow;
            k.effects.burst(cx, 1.4, z + 0.6, {
              count: k.count(14),
              palette: ['#ffffff', '#ffd166', '#ff5e8a'],
              speed: 3.2,
              life: 0.55,
              size: 0.16,
              gravity: -4,
            });
            if (f.by === o.meId) k.shake(0.35);
          } else {
            k.effects.burst(cx, 1.3, z - 0.4, {
              count: k.count(16),
              palette: ['#5ed67a', '#ffe27a', '#ffffff'],
              speed: 3.6,
              life: 0.7,
              size: 0.15,
              gravity: -3,
            });
          }
        }
      };

      return {
        frame(dt, time) {
          timeNow = time;
          const f = o.read();
          f.predict(f.serverNow());
          drainFx();
          placeDoors(dt);

          let meX = 0;
          let meZ = wz(0);
          let haveMe = false;
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const sp = cfg.spawns[p.id];
            const at = f.posOf(p.id) ?? (sp ? { x: sp[0], y: sp[1] } : undefined);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const server = f.positions.current[p.id];
            const tx = wx(at.x);
            const tz = wz(at.y);
            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.placed = true;
            } else {
              // mình bám sát dự đoán; bị văng lại (lệch xa) hoặc người khác thì lướt mượt
              const far = Math.hypot(tx - e.x, tz - e.z) > 0.9;
              const kk = p.id === o.meId && !far ? 1 : 1 - Math.exp(-dt * (p.id === o.meId ? 20 : 14));
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }
            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;

            const finished = !!server?.f;
            const stunned = !!server?.s;
            if (finished && !e.wasFin) {
              e.wasFin = true;
              k.effects.burst(e.x, 1.2, e.z, {
                count: k.count(18),
                palette: ['#ffd166', '#ff5e8a', '#5ed67a', '#ffffff'],
                speed: 3.4,
                life: 0.9,
                size: 0.15,
                gravity: -3,
              });
            }
            e.c.root.visible = true;
            e.c.root.position.set(e.x, 0, e.z);
            if (!finished && !stunned) e.c.face(vx, vz, dt);
            else if (finished) e.c.setYaw(Math.PI);
            e.c.update(dt, {
              speed: stunned || finished ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              time,
              pose: finished ? 'cheer' : stunned ? 'hit' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, 2.2, e.z);
            if (p.id === o.meId) {
              meX = e.x;
              meZ = e.z;
              haveMe = true;
            }
          }

          // góc nhìn thứ ba: bám sau lưng, nhìn về phía đích
          if (!haveMe) meZ = wz(0);
          aim.set(meX, 0.9, meZ - 1.6);
          focus.lerp(aim, 1 - Math.exp(-dt * 6));
          camPos.set(focus.x * 0.9, focus.y + FOLLOW_UP, focus.z + FOLLOW_BACK);
          k.look(camPos, focus);

          // bóng đổ đi theo người chơi (đường chạy dài hơn vùng bóng của mặt trời)
          sunAim.set(focus.x, 0, focus.z);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
      };
    },
  );
}
