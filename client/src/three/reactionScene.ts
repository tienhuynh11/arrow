import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { ReactionResult } from '../games/reaction/useReactionGame';

export interface ReactionFrame {
  go: boolean;
  fake: number;
  results: Record<string, ReactionResult>;
}

export interface ReactionSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => ReactionFrame;
  labels: Map<string, HTMLElement | null>;
}

const LANE = 1.25;
const TRACK_L = 22;
const TRACK_NEAR = 4;
const GANTRY_Z = -15;
const START_Z = 0.6;
const DASH = 7.5;
const DASH_S = 1.3;
// camera lùi xa và nhìn gần như ngang: thấy trọn nhân vật ở vạch xuất phát lẫn cột đèn ở cuối đường,
// cột đèn nằm dưới dòng chữ READY/GO
const PITCH = (11 * Math.PI) / 180;

export function createReactionScene(o: ReactionSceneOptions) {
  return runScene(o.host, o.hooks, { background: '#0a0f22', fog: [26, 60], sun: [-5, 16, 10], shadowBox: 14 }, (k) => {
    const { scene } = k.engine;
    const n = Math.max(1, o.players.length);
    const trackW = n * LANE + 1.4;
    const laneX = (i: number) => (i - (n - 1) / 2) * LANE;
    const trackZ = TRACK_NEAR - TRACK_L / 2;

    /* ---------------- đường chạy + vạch xuất phát ---------------- */
    const tex = k.texture(512, 1024, (g, w, h) => {
      g.fillStyle = '#a8433a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.07)';
      for (let i = 0; i < 1800; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i <= n; i++) {
        const x = (((i - n / 2) * LANE + trackW / 2) / trackW) * w;
        g.fillRect(x - 2, 0, 4, h);
      }
      // ảnh: y = 0 là đầu xa (z = -18), y = h là đầu gần (z = +4)
      const zy = (z: number) => ((z - (TRACK_NEAR - TRACK_L)) / TRACK_L) * h;
      g.fillStyle = '#ffffff';
      g.fillRect(0, zy(0) - 6, w, 12);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(0, zy(-DASH) - 3, w, 6);
    });
    const track = new Mesh(new PlaneGeometry(trackW, TRACK_L), k.lit({ map: tex }));
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0, trackZ);
    track.receiveShadow = true;
    scene.add(track);

    const ground = new Mesh(new PlaneGeometry(160, 120), k.lit({ color: '#0e1530' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);

    for (const s of [-1, 1]) {
      const wall = new Mesh(new BoxGeometry(0.3, 0.5, TRACK_L), k.lit({ color: '#232a44' }));
      wall.position.set(s * (trackW / 2 + 0.3), 0.25, trackZ);
      const strip = new Mesh(new BoxGeometry(0.32, 0.06, TRACK_L), new MeshBasicMaterial({ color: '#4cc9f0' }));
      strip.position.set(s * (trackW / 2 + 0.3), 0.52, trackZ);
      scene.add(wall, strip);
    }

    /* ---------------- cột đèn tín hiệu khổng lồ ---------------- */
    const postX = Math.max(trackW / 2, 2.6) + 0.4;
    const metal = k.lit({ color: '#c9cde6' });
    for (const s of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.14, 0.18, 4.8, 10), metal);
      post.position.set(s * postX, 2.4, GANTRY_Z);
      post.castShadow = !k.low;
      scene.add(post);
    }
    const beam = new Mesh(new BoxGeometry(postX * 2 + 0.4, 0.3, 0.3), metal);
    beam.position.set(0, 4.8, GANTRY_Z);
    const housing = new Mesh(new BoxGeometry(4, 1.5, 0.6), k.lit({ color: '#15182b' }));
    housing.position.set(0, 3.9, GANTRY_Z);
    scene.add(beam, housing);

    const LAMP = [
      { x: -1.25, on: '#ff2d55', off: '#3a0c16' },
      { x: 0, on: '#ffb020', off: '#3a2a08' },
      { x: 1.25, on: '#3dff8a', off: '#0b2a17' },
    ];
    const lampGeo = new SphereGeometry(0.48, 18, 12);
    const lamps = LAMP.map((l) => {
      const mat = new MeshBasicMaterial({ color: l.off });
      const lamp = new Mesh(lampGeo, mat);
      lamp.position.set(l.x, 3.9, GANTRY_Z + 0.35);
      scene.add(lamp);
      return mat;
    });
    const glowMat = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const glow = new Mesh(new CircleGeometry(1.5, 28), glowMat);
    glow.position.set(0, 3.9, GANTRY_Z + 0.7);
    scene.add(glow);

    const poleMat = new MeshBasicMaterial({ color: '#fff6d8' });
    for (const sx of [-1, 1]) {
      for (const z of [-4, -14]) {
        const pole = new Mesh(new CylinderGeometry(0.1, 0.14, 8, 8), metal);
        pole.position.set(sx * (trackW / 2 + 3), 4, z);
        const lamp = new Mesh(new BoxGeometry(1.2, 0.5, 0.4), poleMat);
        lamp.position.set(sx * (trackW / 2 + 3), 8.2, z);
        scene.add(pole, lamp);
      }
    }

    /* ---------------- nhân vật ở vạch xuất phát ---------------- */
    interface Entry {
      c: Character3D;
      x: number;
      z: number;
      at: number;
      turned: boolean;
    }
    const chars = new Map<string, Entry>();
    o.players.forEach((p, i) => {
      const c = k.kit.create(p.color, p.id === o.meId);
      c.setShadows(!k.low);
      c.setYaw(Math.PI); // nhìn về cột đèn
      scene.add(c.root);
      chars.set(p.id, { c, x: laneX(i), z: START_Z, at: 0, turned: false });
    });
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    let lastGo = false;
    let lastFake = 0;
    const target = new Vector3(0, 1.4, -5.5);
    const camPos = new Vector3();

    return {
      frame(dt, time) {
        const f = o.read();
        const now = Date.now();
        const fakeOn = !!f.fake && !f.go;

        const red = fakeOn && Math.floor(now / 70) % 2 === 0;
        const amberLevel = !f.go && !fakeOn ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
        lamps[0].color.set(red ? LAMP[0].on : LAMP[0].off);
        lamps[1].color.set(LAMP[1].off).lerp(glowMat.color.set(LAMP[1].on), amberLevel);
        lamps[2].color.set(f.go ? LAMP[2].on : LAMP[2].off);
        const active = f.go ? 2 : fakeOn ? 0 : 1;
        glowMat.color.set(LAMP[active].on);
        glowMat.opacity = f.go ? 0.55 : fakeOn ? (red ? 0.5 : 0) : amberLevel * 0.3;
        glow.position.x = LAMP[active].x;

        if (f.go && !lastGo) {
          k.effects.burst(0, 3.9, GANTRY_Z + 1, {
            count: k.count(80),
            palette: ['#3dff8a', '#ffffff', '#ffd166', '#4cc9f0'],
            speed: 9,
            life: 1.2,
            size: 0.25,
            additive: true,
          });
          k.shake(0.15);
        }
        lastGo = f.go;
        if (f.fake && f.fake !== lastFake) k.shake(0.06);
        lastFake = f.fake;

        for (const pl of o.players) {
          const e = chars.get(pl.id)!;
          const r = f.results[pl.id];
          if (r && !e.at) {
            e.at = now;
            if (r.falseStart) {
              k.effects.burst(e.x, 1.2, e.z, { count: k.count(20), palette: ['#ff2d55', '#ffffff'], speed: 4, life: 0.5, size: 0.14 });
              if (pl.id === o.meId) k.shake(0.3);
            } else {
              k.effects.burst(e.x, 0.2, e.z, {
                count: k.count(r.order === 1 ? 40 : 14),
                palette: r.order === 1 ? ['#ffd166', '#fff6c9', '#ff9f00'] : ['#d9b38c', '#ffffff'],
                speed: r.order === 1 ? 6 : 3,
                life: 0.7,
                size: 0.16,
                additive: r.order === 1,
              });
            }
          }

          let pose: 'run' | 'hit' | 'cheer' | 'idle' = 'run';
          let speed = 0;
          let dead = false;
          if (r && r.falseStart) {
            if (now - e.at < 500) pose = 'hit';
            else dead = true;
          } else if (r) {
            const t = (now - e.at) / 1000;
            if (t < DASH_S) {
              const q = t / DASH_S;
              e.z = START_Z - DASH * (1 - (1 - q) * (1 - q));
              speed = 1;
            } else {
              e.z = START_Z - DASH;
              if (!e.turned) {
                e.turned = true;
                e.c.setYaw(0);
              }
              pose = r.order <= 3 ? 'cheer' : 'idle';
            }
          }
          e.c.root.position.set(e.x, 0, e.z);
          e.c.update(dt, { speed, dead, time, pose });
          k.label(o.labels.get(pl.id), e.x, 2.2, e.z);
        }

        // phòng đông thì lùi camera theo tỉ lệ, giữ nguyên góc nhìn
        const s = Math.max(1, (trackW / 2 + 1.2) / 11.5);
        camPos.set(0, 6.5 * s, START_Z + 14.4 * s);
        target.set(0, camPos.y - Math.tan(PITCH) * 20, camPos.z - 20);
        k.look(camPos, target);
      },

      dispose() {
        lampGeo.dispose();
      },
    };
  });
}
