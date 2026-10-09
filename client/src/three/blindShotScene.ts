import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Plane,
  Quaternion,
  Raycaster,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { BsFire, BsPhase } from '../games/blindshot/useBlindShotGame';
import type { BlindBody, BlindCfg } from '@shared/blindArena';

export interface BlindShotFrame {
  cfg: BlindCfg;
  body: { current: BlindBody };
  /** góc ngắm theo chuột — cảnh ghi vào, hook gửi lên server */
  aim: { current: number };
  others: { current: Record<string, [number, number, number]> };
  fire: { current: BsFire | null };
  phaseAt(serverNow: number): { phase: BsPhase; round: number; left: number };
  predict(serverNow: number): void;
  serverNow(): number;
}

export interface BlindShotSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => BlindShotFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const CHAR_SCALE = 1.05;
/** camera cố định nhìn chéo từ trên xuống, ôm trọn đấu trường */
const PITCH = (64 * Math.PI) / 180;
/** độ cao mặt phẳng ngắm (ngang tầm súng) */
const AIM_Y = 1;
const TRACER_S = 0.7;
const FENCE_POSTS = 44;

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function createBlindShotScene(o: BlindShotSceneOptions) {
  const cfg = o.read().cfg;
  const RW = cfg.r * S;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [RW + 4, RW + 4], groundY: -34, ground: false },
      sun: [-9, 24, 12],
      shadowBox: 13,
    },
    (k) => {
      const { scene } = k.engine;

      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#58c4e6' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -9;
      scene.add(sea);

      /* ---------------- đấu trường tròn ---------------- */
      const top = k.texture(512, 512, (g, w) => {
        const c = w / 2;
        const rings = 8;
        for (let i = rings; i >= 1; i--) {
          g.fillStyle = i % 2 ? '#ffe9a8' : '#ffd77a';
          g.beginPath();
          g.arc(c, c, (c * i) / rings, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 6;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          g.beginPath();
          g.moveTo(c + Math.cos(a) * c * 0.12, c + Math.sin(a) * c * 0.12);
          g.lineTo(c + Math.cos(a) * c * 0.98, c + Math.sin(a) * c * 0.98);
          g.stroke();
        }
      });
      const wall = k.lit({ color: '#ff7a59' });
      const arena = new Mesh(new CylinderGeometry(RW, RW, 0.6, 64), [wall, k.lit({ map: top }), wall]);
      arena.position.y = -0.3;
      arena.receiveShadow = true;
      scene.add(arena);

      // hàng rào thấp: cọc + hai thanh ngang chạy vòng quanh
      const fenceR = RW + 0.12;
      const posts = new InstancedMesh(new BoxGeometry(0.2, 1.0, 0.2), k.lit({ color: '#ffffff' }), FENCE_POSTS);
      const m = new Matrix4();
      const q = new Quaternion();
      const axisY = new Vector3(0, 1, 0);
      for (let i = 0; i < FENCE_POSTS; i++) {
        const a = (i / FENCE_POSTS) * Math.PI * 2;
        q.setFromAxisAngle(axisY, -a);
        m.compose(new Vector3(Math.cos(a) * fenceR, 0.5, Math.sin(a) * fenceR), q, new Vector3(1, 1, 1));
        posts.setMatrixAt(i, m);
      }
      posts.castShadow = !k.low;
      scene.add(posts);
      for (const [h, col] of [
        [0.78, '#ff5e8a'],
        [0.4, '#ffd23f'],
      ] as const) {
        const rail = new Mesh(new TorusGeometry(fenceR, 0.07, 8, 96), k.lit({ color: col }));
        rail.rotation.x = Math.PI / 2;
        rail.position.y = h;
        scene.add(rail);
      }

      /* ---------------- nhân vật + súng ---------------- */
      interface Entry {
        c: Character3D;
        gun: Group;
        flash: Mesh;
        x: number;
        z: number;
        a: number;
        px: number;
        pz: number;
        placed: boolean;
        shown: boolean;
        flashT: number;
      }
      const gunMat = k.lit({ color: '#2b2f4a' });
      const gunTrim = k.lit({ color: '#ffd23f' });
      const flashMat = new MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: 0.95 });
      const makeGun = () => {
        const g = new Group();
        const body = new Mesh(new BoxGeometry(0.16, 0.26, 0.62), gunMat);
        const barrel = new Mesh(new CylinderGeometry(0.05, 0.05, 0.55, 8), gunTrim);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.z = 0.5;
        const grip = new Mesh(new BoxGeometry(0.13, 0.28, 0.14), gunMat);
        grip.position.set(0, -0.22, -0.16);
        const flash = new Mesh(new CylinderGeometry(0.02, 0.2, 0.5, 8), flashMat);
        flash.rotation.x = Math.PI / 2;
        flash.position.z = 0.98;
        flash.visible = false;
        g.add(body, barrel, grip, flash);
        g.position.set(-0.42, 0.95, 0.45);
        return { g, flash };
      };
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        const { g, flash } = makeGun();
        c.root.add(g);
        scene.add(c.root);
        chars.set(p.id, { c, gun: g, flash, x: 0, z: 0, a: 0, px: 0, pz: 0, placed: false, shown: false, flashT: 0 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      /* ---------------- tia đạn của lượt bắn đồng loạt ---------------- */
      interface Tracer {
        mesh: Mesh;
        life: number;
      }
      const tracers: Tracer[] = [];
      const tracerGeo = new CylinderGeometry(0.05, 0.05, 1, 6);
      const up = new Vector3(0, 1, 0);
      const dir = new Vector3();
      const qq = new Quaternion();
      const spawnTracer = (x: number, z: number, a: number, len: number, color: string) => {
        const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
        const mesh = new Mesh(tracerGeo, mat);
        dir.set(Math.sin(a), 0, Math.cos(a));
        mesh.scale.set(1, len, 1);
        mesh.position.set(x + dir.x * (len / 2 + 0.9), 1.05, z + dir.z * (len / 2 + 0.9));
        qq.setFromUnitVectors(up, dir);
        mesh.quaternion.copy(qq);
        scene.add(mesh);
        tracers.push({ mesh, life: TRACER_S });
      };
      const colorOf = new Map(o.players.map((p) => [p.id, p.color]));

      const camPos = new Vector3();
      const focus = new Vector3(0, 0, 0.3);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const sunOff = new Vector3(-9, 24, 12);
      const sunAim = new Vector3();

      // chuột / ngón tay trên màn hình → điểm trên mặt phẳng ngang tầm súng → góc ngắm
      const ptr = new Vector2();
      let hasPtr = false;
      const onPtr = (e: PointerEvent) => {
        const r = o.host.getBoundingClientRect();
        ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
        hasPtr = true;
      };
      o.host.addEventListener('pointermove', onPtr);
      o.host.addEventListener('pointerdown', onPtr);
      const ray = new Raycaster();
      const plane = new Plane(new Vector3(0, 1, 0), -AIM_Y);
      const hitPt = new Vector3();
      const dist = k.fit(RW + 1.4, RW + 1.6, PITCH) * 1.05;
      let lastPhase: BsPhase | '' = '';
      let lastRound = -1;
      let firedSeen = '';

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const { phase, round } = f.phaseAt(now);
          const meBody = f.body.current;

          // hướng súng theo con trỏ (giữ góc cũ nếu con trỏ quá gần người)
          if (hasPtr && f.phaseAt(now).phase !== 'reveal') {
            ray.setFromCamera(ptr, k.engine.camera);
            if (ray.ray.intersectPlane(plane, hitPt)) {
              const ddx = hitPt.x - meBody.x * S;
              const ddz = hitPt.z - meBody.y * S;
              if (Math.hypot(ddx, ddz) > 0.5) {
                f.aim.current = Math.atan2(ddx, ddz);
                meBody.a = f.aim.current;
              }
            }
          }

          // vừa chuyển sang pha ẩn: mọi người tan biến (vị trí ai cũng vừa thấy xong nên không lộ gì thêm)
          if (phase !== lastPhase || round !== lastRound) {
            if (phase === 'hide' && lastPhase === 'prep') {
              for (const [id, e] of chars) {
                if (id !== o.meId && e.shown) {
                  k.effects.burst(e.x, 1, e.z, {
                    count: k.count(24),
                    palette: ['#ffffff', '#c9b8ff'],
                    speed: 3,
                    life: 0.7,
                    size: 0.18,
                    gravity: -1,
                  });
                }
              }
            }
            lastPhase = phase;
            lastRound = round;
          }

          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const isMe = p.id === o.meId;
            let tx: number;
            let tz: number;
            let ta: number;
            let visible: boolean;
            if (isMe) {
              tx = meBody.x * S;
              tz = meBody.y * S;
              ta = meBody.a;
              visible = true;
            } else {
              // pha ẩn: dữ liệu của người khác bị bỏ hẳn, không vẽ gì cả
              const t = phase === 'hide' ? undefined : f.others.current[p.id];
              if (t) {
                tx = t[0] * S;
                tz = t[1] * S;
                ta = t[2];
                visible = true;
              } else {
                tx = e.x;
                tz = e.z;
                ta = e.a;
                visible = false;
              }
            }
            if (!e.placed || (visible && !e.shown && !isMe)) {
              e.x = tx;
              e.z = tz;
              e.a = ta;
              e.px = tx;
              e.pz = tz;
              e.placed = true;
            } else if (isMe) {
              e.x = tx;
              e.z = tz;
              e.a = ta;
            } else {
              const kk = 1 - Math.exp(-dt * 14);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
              e.a += angDiff(e.a, ta) * kk;
            }
            e.shown = visible;
            e.c.root.visible = visible;
            if (!visible) {
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
              continue;
            }

            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;
            e.c.root.position.set(e.x, 0, e.z);
            e.c.setYaw(e.a);
            e.c.update(dt, { speed: Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)), dead: false, time, pose: 'run' });
            e.flashT = Math.max(0, e.flashT - dt);
            e.flash.visible = e.flashT > 0;
            if (!isMe) k.label(o.labels.get(p.id), e.x, 2.3, e.z);
            else {
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
            }
          }

          // lượt bắn đồng loạt: tia đạn + tia lửa nòng + hiệu ứng trúng
          const fire = f.fire.current;
          if (fire && phase === 'reveal') {
            const key = `${fire.r}:${fire.at}`;
            if (key !== firedSeen) {
              firedSeen = key;
              for (const s of fire.shots) {
                const pos = fire.pos[s.id];
                if (!pos) continue;
                spawnTracer(pos[0] * S, pos[1] * S, pos[2], s.len * S, colorOf.get(s.id) ?? '#ffffff');
                const e = chars.get(s.id);
                if (e) e.flashT = 0.18;
                if (s.hit) {
                  const v = fire.pos[s.hit];
                  if (v) {
                    k.effects.burst(v[0] * S, 1.1, v[1] * S, {
                      count: k.count(40),
                      palette: ['#ff2d55', '#ffd166', '#ffffff'],
                      speed: 5,
                      life: 0.7,
                      size: 0.2,
                    });
                  }
                  if (s.hit === o.meId) k.shake(0.35);
                }
              }
            }
          }
          for (let i = tracers.length - 1; i >= 0; i--) {
            const t = tracers[i];
            t.life -= dt;
            (t.mesh.material as MeshBasicMaterial).opacity = Math.max(0, t.life / TRACER_S);
            if (t.life <= 0) {
              scene.remove(t.mesh);
              (t.mesh.material as MeshBasicMaterial).dispose();
              tracers.splice(i, 1);
            }
          }

          // camera cố định nhìn từ trên xuống, ôm trọn đấu trường
          camPos.copy(focus).addScaledVector(camDir, dist);
          k.look(camPos, focus);
          sunAim.set(0, 0, 0);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
        dispose() {
          o.host.removeEventListener('pointermove', onPtr);
          o.host.removeEventListener('pointerdown', onPtr);
        },
      };
    },
  );
}
