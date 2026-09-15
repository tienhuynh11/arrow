import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { SeqKey, SeqProg } from '../games/sequence/useSequenceGame';

export interface SequenceFrame {
  rounds: SeqKey[][];
  prog: Record<string, SeqProg>;
  errAt: { current: Record<string, number> };
  totalKeys: number;
  doneOf(q?: SeqProg): number;
}

export interface SequenceSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => SequenceFrame;
  labels: Map<string, HTMLElement | null>;
}

const LANE = 1.7;
const START_W = 1.6;
const TOP_W = 2.4;
// nhìn chéo từ trên xuống để các làn tách nhau ra, nhãn tên không chồng lên nhau
const PITCH = (32 * Math.PI) / 180;

export function createSequenceScene(o: SequenceSceneOptions) {
  return runScene(o.host, o.hooks, { background: '#0b0c24', fog: [30, 75], sun: [-4, 18, 12], shadowBox: 16 }, (k) => {
    const { scene } = k.engine;
    const f0 = o.read();
    const total = Math.max(1, f0.totalKeys);
    const n = Math.max(1, o.players.length);
    const D = Math.min(0.36, 10 / total);
    const H = D * 0.42;
    const stairW = total * D;
    const span = START_W + stairW + TOP_W;
    const x0 = -span / 2 + START_W; // chân bậc đầu tiên
    const topH = total * H;
    const depth = n * LANE + 0.6;
    const laneZ = (i: number) => (i - (n - 1) / 2) * LANE;

    const ground = new Mesh(new PlaneGeometry(120, 90), k.lit({ color: '#10132c' }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const start = new Mesh(new BoxGeometry(START_W, 0.12, depth), k.lit({ color: '#2c3160' }));
    start.position.set(x0 - START_W / 2, 0.06, 0);
    start.receiveShadow = true;
    scene.add(start);

    /* ---------------- cầu thang: 1 InstancedMesh cho mọi bậc của mọi người ---------------- */
    const stepMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), k.lit({}), n * total);
    stepMesh.castShadow = !k.low;
    stepMesh.receiveShadow = true;
    const boundaries = new Set<number>();
    let acc = 0;
    for (const r of f0.rounds) {
      acc += r.length;
      boundaries.add(acc - 1);
    }
    const baseColors: Color[] = [];
    for (let j = 0; j < total; j++) {
      baseColors.push(
        boundaries.has(j) ? new Color('#8a6d2a') : new Color('#2c3160').lerp(new Color('#4a4f86'), j / total),
      );
    }
    const m = new Matrix4();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < total; j++) {
        const h = (j + 1) * H;
        m.makeScale(D * 0.96, h, LANE * 0.86);
        m.setPosition(x0 + j * D + D / 2, h / 2, laneZ(i));
        stepMesh.setMatrixAt(i * total + j, m);
        stepMesh.setColorAt(i * total + j, baseColors[j]);
      }
    }
    scene.add(stepMesh);

    /* ---------------- bục đích + cúp ---------------- */
    const topX = x0 + stairW + TOP_W / 2;
    const top = new Mesh(new BoxGeometry(TOP_W, topH, depth), k.lit({ color: '#3a3f72' }));
    top.position.set(topX, topH / 2, 0);
    top.castShadow = !k.low;
    top.receiveShadow = true;
    const trim = new Mesh(new BoxGeometry(TOP_W + 0.04, 0.08, depth + 0.04), new MeshBasicMaterial({ color: '#ffd166' }));
    trim.position.set(topX, topH, 0);
    scene.add(top, trim);

    const gold = k.lit({ color: '#ffd166', emissive: '#ff9f00', emissiveIntensity: 0.35 });
    const trophy = new Group();
    const cup = new Mesh(new CylinderGeometry(0.42, 0.16, 0.6, 18), gold);
    cup.position.y = 0.75;
    const stem = new Mesh(new CylinderGeometry(0.07, 0.07, 0.3, 8), gold);
    stem.position.y = 0.3;
    const base = new Mesh(new BoxGeometry(0.5, 0.15, 0.5), k.lit({ color: '#2b2f55' }));
    base.position.y = 0.08;
    const gem = new Mesh(new OctahedronGeometry(0.16, 0), new MeshBasicMaterial({ color: '#fff6c9' }));
    gem.position.y = 1.35;
    trophy.add(cup, stem, base, gem);
    trophy.position.set(topX + TOP_W * 0.25, topH, -depth / 2 + 0.5);
    scene.add(trophy);

    const pole = new Mesh(new CylinderGeometry(0.05, 0.05, 2.6, 8), k.lit({ color: '#c9cde6' }));
    pole.position.set(topX + TOP_W / 2 - 0.2, topH + 1.3, depth / 2 - 0.3);
    const flag = new Mesh(new PlaneGeometry(0.9, 0.55), new MeshBasicMaterial({ color: '#ff6bd6', side: DoubleSide }));
    flag.position.set(topX + TOP_W / 2 - 0.2 - 0.47, topH + 2.3, depth / 2 - 0.3);
    scene.add(pole, flag);

    /* ---------------- nhân vật ---------------- */
    interface Entry {
      c: Character3D;
      i: number;
      color: Color;
      x: number;
      y: number;
      lastDone: number;
      lastErr: number;
      finished: boolean;
    }
    const chars = new Map<string, Entry>();
    o.players.forEach((p, i) => {
      const c = k.kit.create(p.color, p.id === o.meId);
      c.setShadows(!k.low);
      c.setYaw(Math.PI / 2); // leo về phía +X
      scene.add(c.root);
      chars.set(p.id, {
        c,
        i,
        color: new Color(p.color),
        x: x0 - 0.6,
        y: 0.12,
        lastDone: 0,
        lastErr: f0.errAt.current[p.id] ?? 0,
        finished: false,
      });
    });
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    const target = new Vector3(0, topH * 0.45, 0);
    const camPos = new Vector3();

    return {
      frame(dt, time) {
        const f = o.read();
        const now = Date.now();
        let colorsDirty = false;

        for (const pl of o.players) {
          const e = chars.get(pl.id)!;
          const q = f.prog[pl.id];
          const done = f.doneOf(q);
          if (done !== e.lastDone) {
            const lo = Math.min(done, e.lastDone);
            const hi = Math.max(done, e.lastDone);
            for (let j = lo; j < hi && j < total; j++) {
              stepMesh.setColorAt(e.i * total + j, j < done ? e.color : baseColors[j]);
            }
            colorsDirty = true;
            e.lastDone = done;
          }

          let tx: number;
          let ty: number;
          if (q?.done) {
            tx = x0 + stairW + 0.6;
            ty = topH;
          } else if (done === 0) {
            tx = x0 - 0.6;
            ty = 0.12;
          } else {
            tx = x0 + (done - 0.5) * D;
            ty = done * H;
          }
          const ease = 1 - Math.exp(-dt * 12);
          const gap = Math.abs(tx - e.x);
          e.x += (tx - e.x) * ease;
          e.y += (ty - e.y) * ease;
          const hop = Math.min(0.3, gap * 1.2);
          const z = laneZ(e.i);
          e.c.root.position.set(e.x, e.y + hop, z);

          const err = f.errAt.current[pl.id] ?? 0;
          if (err > e.lastErr) {
            e.lastErr = err;
            k.effects.burst(e.x, e.y + 1.2, z, { count: k.count(12), palette: ['#ff2d55', '#ffffff'], speed: 3, life: 0.45, size: 0.12 });
            if (pl.id === o.meId) k.shake(0.18);
          }
          if (q?.done && !e.finished) {
            e.finished = true;
            e.c.setYaw(0);
            k.effects.burst(tx, topH + 1.2, z, {
              count: k.count(60),
              palette: ['#ffd166', '#ff6bd6', '#4cc9f0', '#3ddc97', '#ffffff'],
              speed: 6,
              life: 1.1,
              size: 0.18,
              additive: true,
            });
          }

          const hurt = now - err < 400;
          e.c.update(dt, {
            speed: gap > 0.03 ? 1 : 0,
            dead: false,
            time,
            pose: q?.done ? 'cheer' : hurt ? 'hit' : gap > 0.03 ? 'run' : 'idle',
          });
          k.label(o.labels.get(pl.id), e.x, e.y + hop + 2.15, z);
        }
        if (colorsDirty && stepMesh.instanceColor) stepMesh.instanceColor.needsUpdate = true;

        trophy.rotation.y = time * 0.8;
        gem.rotation.y = time * 3;
        flag.rotation.y = Math.sin(time * 3) * 0.25;

        const dist = Math.max(
          k.fit(span / 2 + 1.6, depth / 2 + 0.8, PITCH),
          k.fit(0, (topH / 2 + 3.4) / Math.sin(PITCH), PITCH),
          8,
        );
        camPos.set(target.x, target.y + Math.sin(PITCH) * dist, target.z + Math.cos(PITCH) * dist);
        k.look(camPos, target);
      },
    };
  });
}
