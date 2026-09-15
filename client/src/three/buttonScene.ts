import { Color, CylinderGeometry, Mesh, MeshBasicMaterial, OctahedronGeometry, TorusGeometry, Vector3 } from 'three';
import { runScene, tileTexture, type SceneHooks } from './scene';
import type { Character3D } from './character';

export interface ButtonFrame {
  counts: Record<string, number>;
  punch: number;
  punchAt: { current: Record<string, number> };
  penaltyAt: { current: Record<string, number> };
  isDanger: boolean;
  max: number;
}

export interface ButtonSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => ButtonFrame;
  labels: Map<string, HTMLElement | null>;
}

const TOWER_MAX = 2.3;
const PITCH = (32 * Math.PI) / 180;

export function createButtonScene(o: ButtonSceneOptions) {
  return runScene(o.host, o.hooks, { background: '#0d0b20', fog: [24, 60], sun: [4, 16, 10], shadowBox: 12 }, (k) => {
    const { scene } = k.engine;
    const n = Math.max(1, o.players.length);
    const rows = n > 8 ? 2 : 1;
    const rMax = 3.1 + (rows - 1) * 1.35;
    const floorR = rMax + 2.2;

    /* ---------------- sàn tròn + viền neon đổi màu khi đèn đỏ ---------------- */
    const floor = new Mesh(
      new CylinderGeometry(floorR, floorR + 0.3, 0.4, 56),
      k.lit({ map: tileTexture(k, 10, 10, ['#1d1f3d', '#23264a'], 'rgba(255,209,102,0.25)') }),
    );
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    scene.add(floor);
    const edgeMat = new MeshBasicMaterial({ color: '#4cc9f0' });
    const edge = new Mesh(new TorusGeometry(floorR, 0.08, 8, 72), edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.02;
    scene.add(edge);

    /* ---------------- nút bấm khổng lồ ---------------- */
    const base = new Mesh(new CylinderGeometry(1.3, 1.55, 0.7, 36), k.lit({ color: '#2a2d4a' }));
    base.position.y = 0.35;
    base.castShadow = !k.low;
    const collar = new Mesh(new TorusGeometry(1.12, 0.07, 8, 40), new MeshBasicMaterial({ color: '#ffd166' }));
    collar.rotation.x = -Math.PI / 2;
    collar.position.y = 0.72;
    const capMat = k.lit({ color: '#ff9f1c', emissive: '#6a3000', emissiveIntensity: 0.6 });
    const cap = new Mesh(new CylinderGeometry(1.02, 1.02, 0.36, 36), capMat);
    cap.position.y = 0.88;
    cap.castShadow = !k.low;
    scene.add(base, collar, cap);

    /* ---------------- người chơi đứng vòng cung + tháp sức mạnh ---------------- */
    const towerGeo = new CylinderGeometry(0.3, 0.3, 1, 14);
    const gemGeo = new OctahedronGeometry(0.2, 0);
    interface Entry {
      c: Character3D;
      x: number;
      z: number;
      tower: Mesh;
      gem: Mesh;
      h: number;
      lastPenalty: number;
      lastCount: number;
    }
    const chars = new Map<string, Entry>();
    const byRow: { id: string; color: string }[][] = Array.from({ length: rows }, () => []);
    o.players.forEach((p, i) => byRow[i % rows].push(p));
    byRow.forEach((list, row) => {
      const r = 3.1 + row * 1.35;
      list.forEach((p, idx) => {
        const a = Math.PI * (1.08 + (0.84 * (idx + 0.5 + row * 0.5)) / (list.length + row * 0.5));
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.setYaw(Math.atan2(-x, -z)); // nhìn vào nút
        c.root.position.set(x, 0, z);
        scene.add(c.root);

        const tower = new Mesh(towerGeo, k.lit({ color: p.color, emissive: p.color, emissiveIntensity: 0.25 }));
        const tr = r + 0.95;
        tower.position.set(Math.cos(a) * tr, 0, Math.sin(a) * tr);
        tower.castShadow = !k.low;
        const gem = new Mesh(gemGeo, new MeshBasicMaterial({ color: new Color(p.color).lerp(new Color('#ffffff'), 0.5) }));
        gem.position.copy(tower.position);
        scene.add(tower, gem);
        chars.set(p.id, { c, x, z, tower, gem, h: 0.15, lastPenalty: 0, lastCount: 0 });
      });
    });
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    const warm = new Color('#fff1dc');
    const alarm = new Color('#ff5c7a');
    let press = 0;
    let lastPunch = 0;
    const target = new Vector3(0, 1.3, -1.6);
    const camPos = new Vector3();

    return {
      frame(dt, time) {
        const f = o.read();
        const now = Date.now();
        const danger = f.isDanger;
        const blink = Math.floor(now / 180) % 2 === 0;

        capMat.color.set(danger ? '#ff2d55' : '#ff9f1c');
        capMat.emissive.set(danger ? (blink ? '#b0002a' : '#4a0010') : '#6a3000');
        edgeMat.color.set(danger ? (blink ? '#ff2d55' : '#5a0f1f') : '#4cc9f0');
        k.sun.color.lerp(danger ? alarm : warm, 1 - Math.exp(-dt * 6));

        press += ((now - f.punch < 90 ? 1 : 0) - press) * (1 - Math.exp(-dt * 30));
        cap.position.y = 0.88 - press * 0.2;
        if (f.punch !== lastPunch) {
          lastPunch = f.punch;
          k.effects.burst(0, 1.1, 0, {
            count: k.count(danger ? 14 : 6),
            palette: danger ? ['#ff2d55', '#ffffff'] : ['#ffd166', '#ff9f1c', '#ffffff'],
            speed: danger ? 5 : 3.5,
            life: 0.35,
            size: 0.12,
            additive: true,
          });
        }

        for (const pl of o.players) {
          const e = chars.get(pl.id)!;
          const count = f.counts[pl.id] ?? 0;
          const h = 0.15 + (TOWER_MAX * Math.max(0, count)) / Math.max(1, f.max);
          e.h += (h - e.h) * (1 - Math.exp(-dt * 8));
          e.tower.scale.y = e.h;
          e.tower.position.y = e.h / 2;
          e.gem.position.y = e.h + 0.35 + Math.sin(time * 3 + e.x) * 0.06;
          e.gem.rotation.y = time * 2;

          if (count > e.lastCount && count % 10 === 0) {
            k.effects.burst(e.tower.position.x, e.h + 0.3, e.tower.position.z, {
              count: k.count(12),
              palette: [pl.color, '#ffffff'],
              speed: 2.5,
              life: 0.5,
              size: 0.12,
              additive: true,
            });
          }
          e.lastCount = count;

          const penalty = f.penaltyAt.current[pl.id] ?? 0;
          if (penalty > e.lastPenalty) {
            e.lastPenalty = penalty;
            k.effects.burst(e.tower.position.x, e.h, e.tower.position.z, {
              count: k.count(24),
              palette: ['#ff2d55', '#ff9f43'],
              speed: 4,
              life: 0.6,
              size: 0.16,
            });
            if (pl.id === o.meId) k.shake(0.3);
          }

          const punching = now - (f.punchAt.current[pl.id] ?? 0) < 130 || (pl.id === o.meId && now - f.punch < 130);
          const hurt = now - penalty < 500;
          e.c.update(dt, { speed: 0, dead: false, time, pose: hurt ? 'hit' : punching ? 'punch' : 'idle' });
          k.label(o.labels.get(pl.id), e.x, 2.2, e.z);
        }

        const dist = Math.max(k.fit(floorR + 0.5, floorR * 0.95, PITCH), 11.5);
        camPos.set(target.x, target.y + Math.sin(PITCH) * dist, target.z + Math.cos(PITCH) * dist);
        k.look(camPos, target);
      },

      dispose() {
        towerGeo.dispose();
        gemGeo.dispose();
      },
    };
  });
}
