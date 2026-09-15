import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  TorusGeometry,
  Vector3,
} from 'three';
import { runScene, tileTexture, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { JudgeEvent, RhythmConfig, RhythmLive } from '../games/rhythm/useRhythmGame';

export interface RhythmFrame {
  cfg: RhythmConfig;
  startAt: number;
  status: Record<string, RhythmLive>;
  consumed: { current: Set<number> };
  events: { current: JudgeEvent[] };
  serverNow(): number;
}

export interface RhythmSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => RhythmFrame;
  labels: Map<string, HTMLElement | null>;
}

/** nốt chạy về phía camera: 1 ms = SPEED đơn vị 3D */
const SPEED = 0.011;
const LANE_X = [-1.05, 1.05] as const;
const LANE_COLOR = ['#4cc9f0', '#b388ff'] as const;
const ROAD_W = 4.4;
const ROAD_L = 46;
const ROAD_NEAR = 4;
const TILES = 8;
const NOTE_Y = 0.22;
const PITCH = (26 * Math.PI) / 180;

export function createRhythmScene(o: RhythmSceneOptions) {
  return runScene(o.host, o.hooks, { background: '#0c0822', fog: [20, 50], sun: [3, 14, 9], shadowBox: 10 }, (k) => {
    const { scene } = k.engine;
    const cfg = o.read().cfg;
    const roadZ = ROAD_NEAR - ROAD_L / 2;

    /* ---------------- đường nhạc ---------------- */
    const roadTex = k.texture(256, 256, (g, w, h) => {
      g.fillStyle = '#140f33';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,107,214,0.55)';
      g.fillRect(0, 0, w, 5);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(w / 2 - 2, 0, 4, h);
    });
    roadTex.wrapS = roadTex.wrapT = RepeatWrapping;
    roadTex.repeat.set(1, TILES);
    const road = new Mesh(new PlaneGeometry(ROAD_W, ROAD_L), k.lit({ map: roadTex }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, roadZ);
    road.receiveShadow = true;
    scene.add(road);

    const laneGlow = LANE_X.map((x, i) => {
      const mat = new MeshBasicMaterial({
        color: LANE_COLOR[i],
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const glow = new Mesh(new PlaneGeometry(1.7, ROAD_L), mat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, 0.005, roadZ);
      scene.add(glow);
      return mat;
    });
    for (const side of [0, 1]) {
      const rail = new Mesh(new BoxGeometry(0.12, 0.12, ROAD_L), new MeshBasicMaterial({ color: LANE_COLOR[side] }));
      rail.position.set((side ? 1 : -1) * (ROAD_W / 2 + 0.06), 0.06, roadZ);
      scene.add(rail);
    }

    // vùng chấm điểm ở vạch đánh: TẠM → KHÁ → CHUẨN
    const zone = (ms: number, color: string, opacity: number, y: number) => {
      for (const x of LANE_X) {
        const m = new Mesh(
          new PlaneGeometry(1.7, ms * SPEED * 2),
          new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, y, 0);
        scene.add(m);
      }
    };
    zone(cfg.windows.good, '#4cc9f0', 0.12, 0.01);
    zone(cfg.windows.great, '#3ddc97', 0.18, 0.012);
    zone(cfg.windows.perfect, '#ffd166', 0.35, 0.014);

    const pads = LANE_X.map((x, i) => {
      const pad = new Mesh(new TorusGeometry(0.66, 0.07, 8, 32), new MeshBasicMaterial({ color: LANE_COLOR[i] }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 0.05, 0);
      scene.add(pad);
      return pad;
    });
    const padFlash = [0, 0];
    const hitBar = new Mesh(new BoxGeometry(ROAD_W, 0.05, 0.08), new MeshBasicMaterial({ color: '#ffd166' }));
    hitBar.position.y = 0.03;
    scene.add(hitBar);

    /* ---------------- loa + sân khấu hai bên ---------------- */
    const cabMat = k.lit({ color: '#1c1a33' });
    const coneMat = k.lit({ color: '#4a4580', emissive: '#ff6bd6', emissiveIntensity: 0.2 });
    const cones: Mesh[] = [];
    for (const s of [-1, 1]) {
      const cab = new Mesh(new BoxGeometry(1.8, 3, 1.2), cabMat);
      cab.position.set(s * (ROAD_W / 2 + 2.2), 1.5, -9);
      cab.castShadow = !k.low;
      scene.add(cab);
      for (const y of [0.9, 2.2]) {
        const cone = new Mesh(new CylinderGeometry(y > 1 ? 0.45 : 0.65, y > 1 ? 0.45 : 0.65, 0.12, 20), coneMat);
        cone.rotation.x = Math.PI / 2;
        cone.position.set(s * (ROAD_W / 2 + 2.2), y, -8.35);
        scene.add(cone);
        cones.push(cone);
      }
    }
    const stageTop = k.lit({ map: tileTexture(k, 3, 7, ['#231a45', '#2b2152'], 'rgba(255,107,214,0.45)') });
    const stageSide = k.lit({ color: '#15122b' });
    for (const s of [-1, 1]) {
      const stage = new Mesh(new BoxGeometry(2.8, 0.3, 7), [stageSide, stageSide, stageTop, stageSide, stageSide, stageSide]);
      stage.position.set(s * (ROAD_W / 2 + 1.75), -0.15, -2.9);
      stage.receiveShadow = true;
      scene.add(stage);
    }

    /* ---------------- nốt nhạc 3D ---------------- */
    const G = {
      puck: new CylinderGeometry(0.5, 0.5, 0.2, 20),
      gold: new CylinderGeometry(0.62, 0.62, 0.24, 24),
      gem: new OctahedronGeometry(0.24, 0),
      trap: new IcosahedronGeometry(0.46, 0),
    };
    const laneMats = LANE_COLOR.map((c) => k.lit({ color: c, emissive: c, emissiveIntensity: 0.35 }));
    const goldMat = k.lit({ color: '#ffd166', emissive: '#ff9f00', emissiveIntensity: 0.4 });
    const gemMat = new MeshBasicMaterial({ color: '#fff6c9' });
    const trapMat = k.lit({ color: '#ff2d55', emissive: '#7a0018', emissiveIntensity: 0.5, flatShading: true });
    const noteMeshes = cfg.notes.map((n) => {
      let m: Mesh;
      if (n.type === 'trap') m = new Mesh(G.trap, trapMat);
      else if (n.type === 'gold') {
        m = new Mesh(G.gold, goldMat);
        const gem = new Mesh(G.gem, gemMat);
        gem.position.y = 0.36;
        m.add(gem);
      } else m = new Mesh(G.puck, laneMats[n.lane]);
      m.visible = false;
      scene.add(m);
      return m;
    });

    /* ---------------- nhân vật nhảy múa hai bên ---------------- */
    const chars = new Map<string, { c: Character3D; x: number; z: number }>();
    let maxX = ROAD_W / 2 + 1.8;
    o.players.forEach((p, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const slot = Math.floor(i / 2);
      const col = slot % 2;
      const row = Math.floor(slot / 2);
      const x = side * (ROAD_W / 2 + 1.2 + col * 1.1);
      const z = -0.6 - row * 1.45 - col * 0.35;
      maxX = Math.max(maxX, Math.abs(x) + 0.8);
      const c = k.kit.create(p.color, p.id === o.meId);
      c.setShadows(!k.low);
      c.setYaw(side < 0 ? 0.45 : -0.45);
      c.root.position.set(x, 0, z);
      scene.add(c.root);
      chars.set(p.id, { c, x, z });
    });
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    let passed = 0;
    let pulse = 0;
    const target = new Vector3(0, 0.5, -4.5);
    const camPos = new Vector3();

    return {
      frame(dt, time) {
        const f = o.read();
        const rel = f.serverNow() - f.startAt;
        const notes = f.cfg.notes;

        roadTex.offset.y = (((rel * SPEED) / (ROAD_L / TILES)) % 1 + 1) % 1;
        while (passed < notes.length && notes[passed].t < rel) {
          passed += 1;
          pulse = 1;
        }
        pulse = Math.max(0, pulse - dt * 3);
        for (const mat of laneGlow) mat.opacity = 0.07 + pulse * 0.08;
        for (const cone of cones) cone.scale.setScalar(1 + pulse * 0.22);

        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          const m = noteMeshes[i];
          const z = (rel - n.t) * SPEED;
          const visible = !f.consumed.current.has(i) && z > -(ROAD_L - ROAD_NEAR) && z < 2.2;
          m.visible = visible;
          if (!visible) continue;
          if (n.type === 'trap') {
            m.position.set(LANE_X[n.lane], NOTE_Y + 0.2 + Math.sin(time * 6 + i) * 0.06, z);
            m.rotation.set(time * 2, time * 3, 0);
          } else {
            m.position.set(LANE_X[n.lane], NOTE_Y, z);
            if (n.type === 'gold') m.rotation.y = time * 3;
          }
        }

        for (const e of f.events.current.splice(0)) {
          if (e.playerId === o.meId) {
            const x = LANE_X[e.lane];
            if (e.judge === 'TRAP') {
              k.effects.burst(x, 0.4, 0, { count: k.count(30), palette: ['#ff2d55', '#ff9f43', '#ffffff'], speed: 6, life: 0.6, size: 0.18 });
              k.shake(0.35);
            } else if (e.judge === 'PERFECT') {
              padFlash[e.lane] = 1;
              const gold = e.note === 'gold';
              k.effects.burst(x, 0.4, 0, {
                count: k.count(gold ? 36 : 22),
                palette: gold ? ['#ffd166', '#fff6c9', '#ff9f00'] : ['#ffffff', LANE_COLOR[e.lane], '#ffd166'],
                speed: 5.5,
                life: 0.55,
                size: 0.15,
                additive: true,
              });
              k.shake(0.05);
            } else if (e.judge === 'GREAT') {
              padFlash[e.lane] = 0.6;
              k.effects.burst(x, 0.4, 0, { count: k.count(14), palette: ['#3ddc97', '#ffffff'], speed: 4, life: 0.45, size: 0.13, additive: true });
            } else if (e.judge === 'GOOD') {
              padFlash[e.lane] = 0.3;
              k.effects.burst(x, 0.4, 0, { count: k.count(8), palette: ['#4cc9f0'], speed: 3, life: 0.4, size: 0.12, additive: true });
            } else {
              k.effects.burst(x, 0.3, 0.2, { count: k.count(6), palette: ['#6b6f8f'], speed: 2, life: 0.4, size: 0.12 });
            }
          } else if (e.judge === 'PERFECT' || e.judge === 'TRAP') {
            const ch = chars.get(e.playerId);
            if (ch) {
              k.effects.burst(ch.x, 1.9, ch.z, {
                count: k.count(10),
                palette: e.judge === 'TRAP' ? ['#ff2d55'] : ['#ffd166', '#ffffff'],
                speed: 2.5,
                life: 0.5,
                size: 0.12,
                additive: true,
              });
            }
          }
        }
        pads.forEach((pad, i) => {
          padFlash[i] = Math.max(0, padFlash[i] - dt * 4);
          pad.scale.setScalar(1 + padFlash[i] * 0.45 + pulse * 0.06);
        });

        const now = Date.now();
        for (const pl of o.players) {
          const e = chars.get(pl.id)!;
          const s = f.status[pl.id];
          const recent = s && now - s.at < 450;
          const bad = s && (s.judge === 'MISS' || s.judge === 'TRAP');
          e.c.update(dt, {
            speed: 0,
            dead: false,
            time,
            pose: recent ? (bad ? 'hit' : 'dance') : s && s.combo >= 5 ? 'dance' : 'idle',
          });
          k.label(o.labels.get(pl.id), e.x, 2.2, e.z);
        }
        LANE_X.forEach((x, i) => k.label(o.labels.get(`lane${i}`), x, 0.05, 1.25));

        const dist = Math.max(k.fit(maxX, 8, PITCH), 12.5);
        camPos.set(0, target.y + Math.sin(PITCH) * dist, target.z + Math.cos(PITCH) * dist);
        k.look(camPos, target);
      },

      dispose() {
        for (const g of Object.values(G)) g.dispose();
      },
    };
  });
}
