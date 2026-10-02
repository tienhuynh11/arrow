import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3 } from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import { barAngle, type SdConfig, type SdPos } from '../games/showdown/useShowdownGame';

export interface ShowdownFrame {
  cfg: SdConfig;
  startAt: number;
  positions: { current: Record<string, SdPos> };
  jumpAt: { current: number };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number } | undefined;
  serverNow(): number;
}

export interface ShowdownSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => ShowdownFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const CHAR_SCALE = 1.1;
const PITCH = (56 * Math.PI) / 180;
const FALL_G = 36;
const JUMP_H = 1.2;
const BAR_Y = 0.42;
const FOLLOW_UP = 7.5;
const FOLLOW_BACK = 8.6;

export function createShowdownScene(o: ShowdownSceneOptions) {
  const cfg = o.read().cfg;
  const RW = cfg.r * S;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [RW + 1, RW + 1], groundY: -34, ground: false },
      sun: [-8, 24, 10],
      shadowBox: 9,
    },
    (k) => {
      const { scene } = k.engine;

      // biển mây phía dưới: rơi khỏi sàn là chìm vào đây
      const sea = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial({ color: '#f4fbff' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -26;
      scene.add(sea);

      /* ---------------- sàn tròn chia múi ---------------- */
      const top = k.texture(512, 512, (g, w, h) => {
        const c = w / 2;
        const sectors = 16;
        for (let i = 0; i < sectors; i++) {
          g.beginPath();
          g.moveTo(c, c);
          g.arc(c, c, c, (i / sectors) * Math.PI * 2, ((i + 1) / sectors) * Math.PI * 2);
          g.closePath();
          g.fillStyle = i % 2 ? '#ffe08a' : '#ffc94d';
          g.fill();
        }
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 6;
        for (const f of [0.35, 0.68, 0.96]) {
          g.beginPath();
          g.arc(c, c, c * f, 0, Math.PI * 2);
          g.stroke();
        }
        void h;
      });
      const platform = new Mesh(new CylinderGeometry(RW, RW, 0.6, 56), [
        k.lit({ color: '#ff7a59' }),
        k.lit({ map: top }),
        k.lit({ color: '#ff7a59' }),
      ]);
      platform.position.y = -0.3;
      platform.receiveShadow = true;
      scene.add(platform);

      // cột giữa + xà
      const hub = new Mesh(new CylinderGeometry(cfg.hub * S, cfg.hub * S * 1.15, 1.3, 28), k.lit({ color: '#ff5e8a' }));
      hub.position.y = 0.65;
      hub.castShadow = !k.low;
      scene.add(hub);
      const cap = new Mesh(new SphereGeometry(cfg.hub * S * 0.95, 20, 14), k.lit({ color: '#ffd23f' }));
      cap.position.y = 1.3;
      scene.add(cap);

      const stripes = k.texture(256, 32, (g, w, h) => {
        const n = 10;
        for (let i = 0; i < n; i++) {
          g.fillStyle = i % 2 ? '#ffffff' : '#ff3b4e';
          g.fillRect((i * w) / n, 0, w / n + 1, h);
        }
      });
      const bar = new Mesh(new BoxGeometry(cfg.arm * 2 * S, 0.4, 0.34), k.lit({ map: stripes }));
      bar.position.y = BAR_Y;
      bar.castShadow = !k.low;
      scene.add(bar);

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        y: number;
        vy: number;
        px: number;
        pz: number;
        placed: boolean;
        jStart: number;
        wasJ: boolean;
        seenJumpAt: number;
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, z: 0, y: 0, vy: 0, px: 0, pz: 0, placed: false, jStart: -1, wasJ: false, seenJumpAt: 0 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const focus = new Vector3(0, 0.3, 0);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const dist = k.fit(RW + 1, RW + 1.2, PITCH) * 1.04;
      const aim = new Vector3();
      const sunOff = new Vector3(-8, 24, 10);
      const sunAim = new Vector3();
      let meOut = false;

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          bar.rotation.y = -barAngle(f.cfg, (now - f.startAt) / 1000);

          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const sp = cfg.spawns[p.id];
            const at = f.posOf(p.id) ?? (sp ? { x: sp[0], y: sp[1] } : undefined);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const server = f.positions.current[p.id];
            const out = !!server?.out;
            if (p.id === o.meId) meOut = out;
            const tx = at.x * S;
            const tz = at.y * S;
            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.placed = true;
            } else {
              // mình bám sát dự đoán; bị hất văng (lệch xa) hoặc người khác thì lướt mượt
              const far = Math.hypot(tx - e.x, tz - e.z) > 0.9;
              const kk = p.id === o.meId && !far ? 1 : 1 - Math.exp(-dt * (p.id === o.meId ? 20 : 14));
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }

            // rơi khỏi sàn
            if (out) {
              e.vy += FALL_G * dt;
              e.y -= e.vy * dt;
            } else {
              e.y = 0;
              e.vy = 0;
            }

            // cú nhảy: mình thì vẽ ngay khi bấm, người khác theo cờ `j` của server
            if (p.id === o.meId) {
              const ja = f.jumpAt.current;
              if (ja !== e.seenJumpAt) {
                e.seenJumpAt = ja;
                e.jStart = time;
              }
            } else if (server?.j && !e.wasJ) e.jStart = time;
            e.wasJ = !!server?.j;
            let hop = 0;
            if (e.jStart >= 0 && !out) {
              const u = (time - e.jStart) / (cfg.jumpMs / 1000);
              if (u >= 1) e.jStart = -1;
              else hop = 4 * JUMP_H * u * (1 - u);
            } else if (out) e.jStart = -1;

            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;

            const stunned = !!server?.s;
            e.c.root.visible = e.y > -24;
            e.c.root.position.set(e.x, e.y + hop, e.z);
            if (!out && !stunned) e.c.face(vx, vz, dt);
            e.c.update(dt, {
              speed: out || stunned ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              time,
              pose: out || hop > 0.05 ? 'jump' : stunned ? 'hit' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, e.y + hop + 2.3, e.z);
            if (out && e.y < -3) {
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
            }
          }

          const me = chars.get(o.meId);
          if (me && me.placed && !meOut) {
            // góc nhìn thứ 3: bám sau lưng mình; rơi khỏi sàn thì lùi ra xem toàn cảnh
            aim.set(me.x, 0.9, me.z);
            focus.lerp(aim, 1 - Math.exp(-dt * 6));
            camPos.set(focus.x, focus.y + FOLLOW_UP, focus.z + FOLLOW_BACK);
          } else {
            aim.set(0, 0.3, 0);
            focus.lerp(aim, 1 - Math.exp(-dt * 2.5));
            camPos.copy(focus).addScaledVector(camDir, dist);
          }
          k.look(camPos, focus);
          sunAim.set(focus.x, 0, focus.z);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
      };
    },
  );
}
