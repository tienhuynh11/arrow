import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D, Pose } from './character';
import {
  F_ANCHOR,
  F_CHARGE,
  F_DODGE,
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
  SPEED,
  roofScale,
  type RtConfig,
} from '@shared/rooftop';
import type { RtFx, RtPos } from '../games/rooftop/useRooftopGame';

export interface RooftopFrame {
  cfg: RtConfig;
  startAt: number;
  positions: { current: Record<string, RtPos> };
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

/**
 * Cảnh TĨNH: xe tải đậu trên đường phố, nóc xe là sàn đấu. Phần nền (đường, cây, cột đèn, nhà, biển báo) dựng một lần
 * bằng vài InstancedMesh và không bao giờ cập nhật lại; mỗi khung chỉ có nhân vật + hạt hiệu ứng + nóc xe thu hẹp.
 */
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
      const geoCyl = own(new CylinderGeometry(1, 1, 1, 8));
      const geoCone = own(new ConeGeometry(1, 1, 8));

      /* ---------------- đất + đường (tĩnh) ---------------- */
      const grass = new Mesh(own(new PlaneGeometry(500, 500)), own(new MeshBasicMaterial({ color: '#76db58' })));
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(0, ROAD_Y - 0.06, -100);
      scene.add(grass);
      const road = new Mesh(own(new PlaneGeometry(21, 500)), own(new MeshBasicMaterial({ color: '#4a4f5c' })));
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, ROAD_Y, -100);
      scene.add(road);

      /* ---------------- nền tĩnh: InstancedMesh ---------------- */
      const mats = {
        white: own(new MeshBasicMaterial({ color: '#ffffff' })),
        lamp: k.lit({ color: '#6b7488' }),
        lampHead: own(new MeshBasicMaterial({ color: '#fff3a8' })),
        trunk: k.lit({ color: '#8a5a35' }),
        tinted: k.lit({ color: '#ffffff' }),
      };
      disposables.push(...Object.values(mats));
      const col = new Color();
      type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; c?: string };
      const stat = (geo: BoxGeometry | CylinderGeometry | ConeGeometry, mat: MeshBasicMaterial | Mesh['material'], items: Item[]) => {
        const m = new InstancedMesh(geo, mat as Mesh['material'], items.length);
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z);
          dummy.scale.set(it.sx, it.sy, it.sz);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          if (it.c) m.setColorAt(i, col.set(it.c));
        });
        m.instanceMatrix.needsUpdate = true;
        m.frustumCulled = false;
        scene.add(m);
        return m;
      };
      const zs = [-90, -60, -30, 0, 30, 60];
      const dashes: Item[] = [];
      for (const s of [-1, 1]) for (let z = -120; z < 60; z += 8) dashes.push({ x: s * 6.9, y: ROAD_Y + 0.03, z, sx: 0.28, sy: 0.02, sz: 3.2 });
      stat(geoBox, mats.white, dashes);
      const poles: Item[] = [];
      const heads: Item[] = [];
      const trunks: Item[] = [];
      const crowns: Item[] = [];
      const builds: Item[] = [];
      for (const s of [-1, 1]) {
        for (const z of [-80, -40, 0, 40]) {
          poles.push({ x: s * 10.8, y: ROAD_Y + 3.2, z, sx: 0.14, sy: 6.4, sz: 0.14 });
          heads.push({ x: s * 10.0, y: ROAD_Y + 6.4, z, sx: 1.6, sy: 0.18, sz: 0.5 });
        }
        for (const zb of zs) {
          for (let i = 0; i < 2; i++) {
            const x = s * (12.8 + rand() * 5);
            const z = zb - i * 14 - rand() * 6;
            const h = 3 + rand() * 2.5;
            trunks.push({ x, y: ROAD_Y + 0.9, z, sx: 0.28, sy: 1.8, sz: 0.28 });
            crowns.push({ x, y: ROAD_Y + 1.8 + h / 2, z, sx: 1.5 + rand() * 0.8, sy: h, sz: 1.5 + rand() * 0.8, c: rand() > 0.5 ? '#3fbf5a' : '#58d36b' });
          }
          const h = 8 + rand() * 24;
          builds.push({ x: s * (22 + rand() * 12), y: ROAD_Y + h / 2, z: zb - 8 - rand() * 6, sx: 8 + rand() * 7, sy: h, sz: 11 + rand() * 5, c: PASTEL[Math.floor(rand() * PASTEL.length)] });
        }
      }
      stat(geoCyl, mats.lamp, poles);
      stat(geoBox, mats.lampHead, heads);
      stat(geoCyl, mats.trunk, trunks);
      stat(geoCone, mats.tinted, crowns);
      stat(geoBox, mats.tinted, builds);
      const sPost: Item[] = [];
      const sBoard: Item[] = [];
      for (const s of [-1, 1]) {
        sPost.push({ x: s * 9.6, y: ROAD_Y + 1.6, z: -20, sx: 0.1, sy: 3.2, sz: 0.1 });
        sBoard.push({ x: s * 9.6, y: ROAD_Y + 3.0, z: -20, sx: 1.5, sy: 1.1, sz: 0.1, c: s > 0 ? '#2f80ed' : '#ffb627' });
      }
      stat(geoBox, mats.lamp, sPost);
      stat(geoBox, mats.tinted, sBoard);

      /* ---------------- xe tải đậu ---------------- */
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
        const b = 22;
        for (let i = 0; i < Math.max(w, h) / 20; i++) {
          g.fillStyle = i % 2 ? '#222' : '#ffcf33';
          g.fillRect(i * 20, 0, 20, b);
          g.fillRect(i * 20, h - b, 20, b);
          g.fillRect(0, i * 20, b, 20);
          g.fillRect(w - b, i * 20, b, 20);
        }
      });
      const side = k.lit({ color: '#b8c0d4' });
      disposables.push(side);
      const roof = new Mesh(geoBox, [side, side, k.lit({ map: roofTex }), side, side, side]);
      roof.scale.set(HALF_W * 2, 0.4, L);
      roof.position.set(0, -0.2, 0);
      roof.receiveShadow = true;
      veh.add(roof);
      const mk = (color: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, basic = false) => {
        const m = new Mesh(geoBox, basic ? own(new MeshBasicMaterial({ color })) : k.lit({ color }));
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        veh.add(m);
        return m;
      };
      mk('#3a7bd5', HALF_W * 2 - 0.15, 2.7, L, 0, -1.75, 0);
      mk('#ffb627', HALF_W * 2 - 0.05, 0.35, L + 0.02, 0, -1.0, 0);
      mk('#2b2f3d', HALF_W * 2 - 0.9, 0.5, L + 3.6, 0, -3.3, -1.8);
      mk('#ef5b4b', HALF_W * 2 - 0.1, 3.9, 3.4, 0, -1.15, -(L / 2 + 1.7));
      mk('#bfe8ff', HALF_W * 2 - 0.5, 0.7, 0.12, 0, 0.4, -(L / 2 + 3.45));
      const wheelGeo = own(new CylinderGeometry(0.9, 0.9, 0.7, 14));
      wheelGeo.rotateZ(Math.PI / 2);
      const wheels = new InstancedMesh(wheelGeo, k.lit({ color: '#20232e' }), 8);
      let wi = 0;
      for (const z of [L / 2 - 1.4, 0.2, -L / 2 + 1.4, -(L / 2 + 2.3)]) {
        for (const s of [-1, 1]) {
          dummy.position.set(s * (HALF_W - 0.25), ROAD_Y + 0.9, z);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          wheels.setMatrixAt(wi++, dummy.matrix);
        }
      }
      wheels.count = wi;
      veh.add(wheels);

      /* lan can: một InstancedMesh duy nhất (thanh ngang + cột), biến mất khi nóc bắt đầu sập */
      const rails = new InstancedMesh(geoBox, k.lit({ color: '#ffcf33' }), Math.max(1, cfg.rails.reduce((n, r) => n + 2 + 2 + Math.floor((r.y1 - r.y0) / 1.4), 0)));
      let ri = 0;
      const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
        dummy.position.set(x, y, z);
        dummy.scale.set(sx, sy, sz);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        rails.setMatrixAt(ri++, dummy.matrix);
      };
      for (const r of cfg.rails) {
        const len = r.y1 - r.y0;
        const x = r.s * (HALF_W - 0.1);
        put(x, 0.82, -(r.y0 + r.y1) / 2, 0.1, 0.1, len);
        put(x, 0.45, -(r.y0 + r.y1) / 2, 0.1, 0.07, len);
        const cnt = 2 + Math.floor(len / 1.4);
        for (let i = 0; i < cnt; i++) put(x, 0.42, -(r.y0 + (len * i) / (cnt - 1)), 0.12, 0.84, 0.12);
      }
      rails.count = ri;
      rails.frustumCulled = false;
      veh.add(rails);

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        y: number;
        z: number;
        yaw: number;
        placed: boolean;
        spin: number;
        phase: number;
        hitAt: number;
        freeze: number;
      }
      const chars = new Map<string, Entry>();
      o.players.forEach((p, i) => {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.visible = false;
        veh.add(c.root);
        chars.set(p.id, { c, x: 0, y: 0, z: 0, yaw: 0, placed: false, spin: 0, phase: i * 1.7, hitAt: -1e9, freeze: 0 });
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
      let camDist = 6.3;
      let railsOn = true;

      const burst = (x: number, y: number, z: number, n: number, palette: string[], speed = 3.5, life = 0.7, grav = 8) =>
        k.effects.burst(x, y, -z, { count: k.count(n), palette, speed, life, size: 0.2, gravity: grav });

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const t = now - f.startAt; // ms

          /* nóc xe thu hẹp từ mép vào theo lịch cố định (cùng công thức với server) */
          const sc = roofScale(cfg, Math.max(0, t));
          roof.scale.set(HALF_W * 2 * sc, 0.4, L * sc);
          const rOn = t < cfg.shrinkAt;
          if (rOn !== railsOn) {
            railsOn = rOn;
            rails.visible = rOn;
            k.shake(0.5);
          }
          if (t > cfg.shrinkAt - 3000 && t < cfg.shrinkAt) roof.position.y = -0.2 + Math.sin(time * 40) * 0.02;
          else roof.position.y = -0.2;

          /* ---------------- sự kiện từ server ---------------- */
          const list = f.fx.current;
          while (list.length) {
            const ev = list.shift()!;
            if (ev.kind === 'out') {
              outSet.add(ev.playerId);
              const e = chars.get(ev.playerId);
              if (e) burst(e.x, ROAD_Y + 0.3, e.y, 18, ['#c8c8d4', '#ffffff', '#8c8c9c'], 4, 0.8, 9);
            } else if (ev.kind === 'fx') {
              const va = chars.get(ev.a);
              const vb = ev.b ? chars.get(ev.b) : undefined;
              switch (ev.k) {
                case 'hit': {
                  // đòn mạnh / kết combo / phản công phản hồi rõ hơn; hit-stop rất ngắn để cảm giác có lực
                  const big = ev.hk === 'heavy' || ev.idx === 2 || !!ev.counter;
                  if (vb) {
                    vb.hitAt = time;
                    vb.freeze = time + (big ? 0.11 : 0.05);
                    const sp = Math.min(8, 3 + (ev.force ?? 5) * 0.4);
                    burst(vb.x + (ev.dx ?? 0) * 0.3, vb.z + 1.1, vb.y + (ev.dy ?? 0) * 0.3, big ? 22 : 12, big ? ['#ffffff', '#ffe066', '#ff5e8a'] : ['#ffffff', '#ffe066', '#ff9f43'], sp, 0.5, 6);
                  }
                  if (va) va.freeze = time + (big ? 0.08 : 0.04);
                  if (ev.a === o.meId || ev.b === o.meId) k.shake(big ? 0.45 : 0.2);
                  break;
                }
                case 'dodge':
                  if (va) burst(va.x, va.z + 0.2, va.y, 8, ['#ffffff', '#bfe3ff'], 2.4, 0.4, 3);
                  break;
                case 'down':
                  if (va) burst(va.x, va.z + 0.1, va.y, 12, ['#e6e8f2', '#b8c0d4'], 3, 0.6, 4);
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
              }
            }
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

            // người chơi của mình: thân hướng THEO CAMERA ngay (không chờ server), trừ lúc choáng/ngã/bị túm/bị quăng/rơi.
            // camera nhìn (sin y, -cos y) trong cảnh; mặt nhân vật ở yaw a nhìn (sin a, cos a) → a = π - y
            const ownYaw = isMe && !(fl & (F_STUN | F_DOWN | F_HELD | F_THROWN | F_FALL | F_OUT)) && time - e.hitAt >= 0.5;
            const wantYaw = ownYaw ? Math.PI - f.cam.current.yaw : Math.PI - at.face;
            e.yaw += angDiff(e.yaw, wantYaw) * (ownYaw ? 1 - Math.exp(-dt * 60) : 1 - Math.exp(-dt * 18));
            e.c.setYaw(e.yaw);

            let pose: Pose = 'run';
            let speed = Math.min(1, spd / SPEED);
            if (aliveCount <= 1 && !out && total > 1) pose = 'cheer';
            else if (falling || fl & F_THROWN) pose = 'jump';
            else if (lifted) pose = 'hit';
            else if (fl & F_PUNCH) pose = 'punch';
            else if (fl & F_WHIFF) pose = 'sad';
            else if (fl & F_HELD) pose = 'hit';
            else if (fl & F_ANCHOR || fl & F_HOLD || fl & F_CHARGE) pose = 'pull';
            else if (stunned) pose = 'hit';
            else if (fl & F_DODGE) pose = 'jump';
            else if (!grounded) pose = 'jump';
            if (pose !== 'run') speed = 0;

            e.c.update(time < e.freeze ? dt * 0.05 : dt, { speed, dead: down && !falling, time, pose, holder: !!(fl & F_LIFTING) });

            const wob = Math.min(1, at.wob + (stunned ? 0.3 : 0));
            if (falling) {
              e.spin += dt * 7;
              e.c.root.rotation.z = e.spin;
              e.c.root.rotation.x = Math.sin(e.spin * 0.7) * 0.5;
            } else {
              e.spin = 0;
              e.c.root.rotation.x = 0;
              e.c.root.rotation.z = Math.sin(time * 8 + e.phase) * wob * 0.32;
            }
            e.c.root.position.set(e.x, e.z, -e.y);
            e.c.root.visible = !out || (falling && e.z > ROAD_Y - 0.5);

            const lab = o.labels.get(p.id);
            if (!out) k.label(lab, e.x, e.z + 2.35, -e.y);
            else if (lab) lab.style.opacity = '0';
            if (isMe) {
              meX = e.x;
              meY = e.z;
              meZ = -e.y;
              meOut = out;
            }
          }

          /* ---------------- camera góc nhìn thứ ba bằng chuột (camera sau vai, song song hướng nhìn của nhân vật) ---------------- */
          const c = f.cam.current;
          const tx = meOut ? 0 : meX;
          const ty = meOut ? 0.4 : meY;
          const tz = meOut ? 0 : meZ;
          const lk = 1 - Math.exp(-dt * 12);
          focus.x += (tx - focus.x) * lk;
          focus.y += (ty - focus.y) * lk;
          focus.z += (tz - focus.z) * lk;
          camDist += ((meOut ? 13 : 6.3) - camDist) * (1 - Math.exp(-dt * 3));
          const cp = Math.cos(c.pitch);
          const sp2 = Math.sin(c.pitch);
          const fx3 = Math.sin(c.yaw);
          const fz3 = -Math.cos(c.yaw);
          const rx3 = Math.cos(c.yaw);
          const rz3 = Math.sin(c.yaw);
          const shoulder = meOut ? 0 : 0.6;
          camPos.set(
            focus.x - fx3 * camDist * cp + rx3 * shoulder,
            Math.max(0.5, focus.y + 1.5 + camDist * sp2),
            focus.z - fz3 * camDist * cp + rz3 * shoulder,
          );
          lookAt.set(focus.x + fx3 * 3.5 + rx3 * shoulder, focus.y + 1.35, focus.z + fz3 * 3.5 + rz3 * shoulder);
          k.look(camPos, lookAt);

          k.sun.target.position.copy(focus);
          k.sun.position.copy(focus).add(sunOff);
        },
        dispose() {
          for (const d of disposables) d.dispose();
        },
      };
    },
  );
}
