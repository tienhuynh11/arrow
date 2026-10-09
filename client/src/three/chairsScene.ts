import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { ChConfig, ChPlayer } from '../games/chairs/useChairsGame';

export interface ChairsFrame {
  cfg: ChConfig;
  snap: { current: Record<string, ChPlayer> };
  chairs: { current: [number, number, string][] };
  me: { current: { x: number; y: number } };
  stopFx: { current: number };
  phase: 'm' | 's' | 'r';
  predict(serverNow: number): void;
  serverNow(): number;
}

export interface ChairsSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => ChairsFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const CHAR_SCALE = 1.05;
const PITCH = (63 * Math.PI) / 180;
const MAX_CHAIRS = 16;
const CHAIR_COLORS = ['#ff5e8a', '#ffb627', '#5b8cff', '#8a5bff', '#2fd6a0', '#ff8a3d'];
const NOTES = ['#ff5e8a', '#ffd23f', '#5b8cff', '#2fd6a0', '#c9b8ff'];

export function createChairsScene(o: ChairsSceneOptions) {
  const cfg = o.read().cfg;
  const RW = cfg.r * S;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'sunset', area: [RW + 3, RW + 3], groundY: -34, ground: false },
      sun: [-9, 24, 12],
      shadowBox: RW + 3,
    },
    (k) => {
      const { scene } = k.engine;

      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#ffb199' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -9;
      scene.add(sea);

      /* ---------------- sàn tròn: vòng màu như sân khấu ---------------- */
      const top = k.texture(512, 512, (g, w) => {
        const c = w / 2;
        const rings = 9;
        for (let i = rings; i >= 1; i--) {
          g.fillStyle = i % 2 ? '#ffe9a8' : '#ffc6d9';
          g.beginPath();
          g.arc(c, c, (c * i) / rings, 0, Math.PI * 2);
          g.fill();
        }
        // đường chạy vòng khi nhạc phát (3 làn)
        g.strokeStyle = 'rgba(138,91,255,0.35)';
        g.lineWidth = (c * 24) / cfg.r;
        g.beginPath();
        g.arc(c, c, (c * 84) / cfg.r, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 8;
        g.beginPath();
        g.arc(c, c, (c * cfg.ring) / cfg.r, 0, Math.PI * 2);
        g.stroke();
      });
      const wall = k.lit({ color: '#8a5bff' });
      const arena = new Mesh(new CylinderGeometry(RW, RW, 0.6, 64), [wall, k.lit({ map: top }), wall]);
      arena.position.y = -0.3;
      arena.receiveShadow = true;
      scene.add(arena);

      /* ---------------- ghế: dùng chung một bộ, bật/tắt theo số ghế của vòng ---------------- */
      interface ChairView {
        g: Group;
        seat: Mesh;
      }
      const legGeo = new CylinderGeometry(0.06, 0.06, 0.62, 6);
      const seatGeo = new BoxGeometry(1.0, 0.16, 1.0);
      const backGeo = new BoxGeometry(1.0, 0.9, 0.14);
      const legMat = k.lit({ color: '#4a3b66' });
      const views: ChairView[] = [];
      for (let i = 0; i < MAX_CHAIRS; i++) {
        const g = new Group();
        const mat = k.lit({ color: CHAIR_COLORS[i % CHAIR_COLORS.length] });
        const seat = new Mesh(seatGeo, mat);
        seat.position.y = 0.7;
        seat.castShadow = !k.low;
        const back = new Mesh(backGeo, mat);
        back.position.set(0, 1.18, -0.43);
        back.castShadow = !k.low;
        g.add(seat, back);
        for (const [x, z] of [
          [-0.4, -0.4],
          [0.4, -0.4],
          [-0.4, 0.4],
          [0.4, 0.4],
        ]) {
          const leg = new Mesh(legGeo, legMat);
          leg.position.set(x, 0.31, z);
          g.add(leg);
        }
        g.visible = false;
        scene.add(g);
        views.push({ g, seat });
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
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, z: 0, px: 0, pz: 0, placed: false, dead: false });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const focus = new Vector3(0, 0, 0.4);
      const dist = k.fit(RW + 1.2, RW + 1.5, PITCH) * 1.03;
      const sunOff = new Vector3(-9, 24, 12);
      const sunAim = new Vector3(0, 0, 0);
      let lastStop = 0;
      let noteT = 0;

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const chairs = f.chairs.current;
          const beat = f.phase === 'm' ? 1 + 0.06 * Math.sin(time * 14) : 1;

          // ghế: bật đúng số ghế của vòng, nhún theo nhịp nhạc, chớp khi nhạc dừng
          const flash = Date.now() - f.stopFx.current < 450;
          for (let i = 0; i < MAX_CHAIRS; i++) {
            const v = views[i];
            const c = chairs[i];
            v.g.visible = !!c;
            if (!c) continue;
            v.g.position.set(c[0] * S, 0, c[1] * S);
            // ghế quay mặt ra ngoài vòng
            v.g.rotation.y = Math.atan2(c[0], c[1]);
            v.g.scale.setScalar(c[2] ? 1 : beat);
            (v.seat.material as MeshBasicMaterial & { emissive?: { set(c: string): void } }).emissive?.set(flash && !c[2] ? '#ffffff' : '#000000');
          }

          // nhạc dừng: hiệu ứng chớp + vòng sóng ở giữa sân
          if (f.stopFx.current !== lastStop) {
            lastStop = f.stopFx.current;
            k.effects.ring(0, 0, '#ffffff', 0.7, RW * 0.6);
            k.shake(0.25);
          }
          // nốt nhạc bay lên khi nhạc đang phát
          if (f.phase === 'm') {
            noteT -= dt;
            if (noteT <= 0) {
              noteT = 0.22;
              const a = Math.random() * Math.PI * 2;
              k.effects.burst(Math.cos(a) * RW * 0.5, 0.6, Math.sin(a) * RW * 0.5, {
                count: 2,
                palette: NOTES,
                speed: 1.2,
                life: 1.2,
                size: 0.26,
                gravity: -2,
              });
            }
          }

          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const isMe = p.id === o.meId;
            const s = f.snap.current[p.id];
            const sp = cfg.spawns[p.id];
            if (!s && !sp) continue;
            const alive = s ? !!s[3] : true;
            const seat = s ? s[2] : -1;
            const px = isMe && alive && seat < 0 ? f.me.current.x : s ? s[0] : sp[0];
            const py = isMe && alive && seat < 0 ? f.me.current.y : s ? s[1] : sp[1];
            const tx = px * S;
            const tz = py * S;
            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.px = tx;
              e.pz = tz;
              e.placed = true;
            } else if (isMe && alive && seat < 0) {
              e.x = tx;
              e.z = tz;
            } else {
              const kk = 1 - Math.exp(-dt * 14);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }
            if (!alive) {
              if (!e.dead) {
                e.dead = true;
                k.effects.burst(e.x, 1, e.z, { count: k.count(28), palette: ['#ffffff', p.color, '#ffd166'], speed: 4, life: 0.8, size: 0.2 });
              }
              e.c.root.visible = false;
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
            const seated = seat >= 0;
            // ngồi: hạ thấp xuống mặt ghế, quay mặt ra ngoài vòng giống chiếc ghế
            e.c.root.position.set(e.x, seated ? 0.62 : 0, e.z);
            if (seated) e.c.setYaw(Math.atan2(e.x, e.z));
            else e.c.face(vx, vz, dt);
            e.c.update(dt, {
              speed: seated ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              time,
              pose: seated ? 'cheer' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, 2.2 + (seated ? 0.5 : 0), e.z);
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
