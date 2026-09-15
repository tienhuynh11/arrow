import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Vector3,
} from 'three';
import { runScene, tileTexture, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { TugConfig } from '../games/tug/useTugGame';

export interface TugFrame {
  cfg: TugConfig;
  ropeRef: { current: number };
  winner: 'A' | 'B' | null;
  winAt: number;
  pullAt: number;
  myTeam: 'A' | 'B';
}

export interface TugSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => TugFrame;
  labels: Map<string, HTMLElement | null>;
}

/** dây dịch tối đa bao xa (đơn vị 3D) khi kéo tới vạch thắng */
const MAX_SHIFT = 3.4;
const GAP = 1.5;
const STEP = 0.95;
const PIT = 1.2;
const SHOWN = 8;
const PITCH = (22 * Math.PI) / 180;
const BLUE = '#4cc9f0';
const RED = '#ff5c7a';

export function createTugScene(o: TugSceneOptions) {
  return runScene(o.host, o.hooks, { background: '#0b0e22', fog: [22, 60], sun: [4, 16, 12], shadowBox: 16 }, (k) => {
    const { scene } = k.engine;
    const first = o.read();
    const cfg = first.cfg;
    const byId = new Map(o.players.map((p) => [p.id, p]));
    const teamA = cfg.teams.A.filter((id) => byId.has(id)).slice(0, SHOWN);
    const teamB = cfg.teams.B.filter((id) => byId.has(id)).slice(0, SHOWN);
    const deepest = Math.max(teamA.length, teamB.length, 1);
    const halfW = GAP + STEP * deepest + MAX_SHIFT + 1.4;

    /* ---------------- hai bệ đứng + hố bùn ở giữa ---------------- */
    const platW = halfW + 3;
    const topA = k.lit({ map: tileTexture(k, 8, 3, ['#1f2d4d', '#243559'], 'rgba(76,201,240,0.6)') });
    const topB = k.lit({ map: tileTexture(k, 8, 3, ['#4a1f2c', '#552433'], 'rgba(255,92,122,0.6)') });
    const sideMat = k.lit({ color: '#171a30' });
    for (const [sign, top] of [
      [-1, topA],
      [1, topB],
    ] as const) {
      const plat = new Mesh(new BoxGeometry(platW - PIT, 0.8, 4.4), [sideMat, sideMat, top, sideMat, sideMat, sideMat]);
      plat.position.set(sign * (PIT + (platW - PIT) / 2), -0.4, 0);
      plat.receiveShadow = true;
      scene.add(plat);
      // vạch thắng của mỗi đội
      const goal = new Mesh(new BoxGeometry(0.12, 0.04, 4.4), new MeshBasicMaterial({ color: sign < 0 ? BLUE : RED }));
      goal.position.set(sign * MAX_SHIFT, 0.02, 0);
      scene.add(goal);
    }

    const mudTex = k.texture(256, 256, (g, w, h) => {
      g.fillStyle = '#4a3322';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(${40 + Math.random() * 40},${25 + Math.random() * 25},${12 + Math.random() * 15},0.6)`;
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 18, 0, Math.PI * 2);
        g.fill();
      }
    });
    const mud = new Mesh(new PlaneGeometry(PIT * 2, 4.4), k.lit({ map: mudTex }));
    mud.rotation.x = -Math.PI / 2;
    mud.position.y = -0.45;
    mud.receiveShadow = true;
    scene.add(mud);

    const ground = new Mesh(new PlaneGeometry(120, 80), k.lit({ color: '#0d1024' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.82;
    scene.add(ground);

    // cờ đội ở hai đầu sân
    const flagMeshes: Mesh[] = [];
    const poleMat = k.lit({ color: '#c9cde6' });
    for (const sign of [-1, 1]) {
      const pole = new Mesh(new CylinderGeometry(0.06, 0.06, 3.4, 8), poleMat);
      pole.position.set(sign * (platW - 0.4), 1.7, -1.6);
      const flag = new Mesh(
        new PlaneGeometry(1.2, 0.7),
        new MeshBasicMaterial({ color: sign < 0 ? BLUE : RED, side: DoubleSide }),
      );
      flag.position.set(sign * (platW - 0.4) - sign * 0.62, 3.0, -1.6);
      flag.userData.sign = sign;
      scene.add(pole, flag);
      flagMeshes.push(flag);
    }

    // đèn lồng lơ lửng
    const lanterns: Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const l = new Mesh(
        new OctahedronGeometry(0.22, 0),
        new MeshBasicMaterial({ color: ['#ffd166', '#b388ff', '#4cc9f0'][i % 3] }),
      );
      l.position.set(-halfW + (i / 5) * halfW * 2, 2.6 + Math.random() * 0.4, -2.6);
      l.userData.base = l.position.y;
      scene.add(l);
      lanterns.push(l);
    }

    /* ---------------- sợi dây + cờ đỏ ở giữa ---------------- */
    const ropeGroup = new Group();
    const ropeLen = (GAP + STEP * deepest + 1.2) * 2;
    const rope = new Mesh(new CylinderGeometry(0.06, 0.06, ropeLen, 8), k.lit({ color: '#c9a227' }));
    rope.rotation.z = Math.PI / 2;
    rope.castShadow = !k.low;
    const ribbon = new Mesh(new BoxGeometry(0.1, 0.5, 0.04), new MeshBasicMaterial({ color: '#ff2d55' }));
    ribbon.position.y = -0.28;
    const marker = new Mesh(new ConeGeometry(0.14, 0.3, 6), new MeshBasicMaterial({ color: '#ffd166' }));
    marker.position.y = 0.45;
    marker.rotation.x = Math.PI;
    ropeGroup.add(rope, ribbon, marker);
    ropeGroup.position.y = 1.02;
    scene.add(ropeGroup);

    /* ---------------- nhân vật hai đội ---------------- */
    interface Entry {
      c: Character3D;
      team: 'A' | 'B';
      slot: number;
      x: number;
      y: number;
    }
    const chars = new Map<string, Entry>();
    const place = (ids: string[], team: 'A' | 'B') => {
      ids.forEach((id, slot) => {
        const p = byId.get(id)!;
        const c = k.kit.create(p.color, id === o.meId);
        c.setShadows(!k.low);
        c.setYaw(team === 'A' ? Math.PI / 2 : -Math.PI / 2); // quay mặt vào sợi dây
        scene.add(c.root);
        chars.set(id, { c, team, slot, x: 0, y: 0 });
      });
    };
    place(teamA, 'A');
    place(teamB, 'B');
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    let offset = 0;
    let prevOffset = 0;
    let vel = 0;
    let splashed = false;
    const camPos = new Vector3();
    const camLook = new Vector3(0, 0.8, 0);

    return {
      frame(dt, time) {
        const f = o.read();
        const target = (f.ropeRef.current / cfg.goal) * MAX_SHIFT; // âm = đội A (trái) đang thắng
        offset += (target - offset) * (1 - Math.exp(-dt * 10));
        const rawVel = (offset - prevOffset) / Math.max(dt, 1e-3);
        prevOffset = offset;
        vel += (rawVel - vel) * (1 - Math.exp(-dt * 6));
        ropeGroup.position.x = offset;
        ribbon.rotation.z = Math.sin(time * 9) * 0.15;

        const sinceWin = f.winner ? (Date.now() - f.winAt) / 1000 : 0;
        const pullA = Math.min(1, Math.max(0.2, -vel * 1.4));
        const pullB = Math.min(1, Math.max(0.2, vel * 1.4));

        for (const [id, e] of chars) {
          const sign = e.team === 'A' ? -1 : 1;
          const won = f.winner === e.team;
          const lost = !!f.winner && !won;
          // đội thua bị lôi tuột về phía hố bùn
          const drag = lost ? Math.min(1, sinceWin / 0.9) * (GAP + e.slot * STEP * 0.4) : 0;
          const baseX = offset + sign * (GAP + e.slot * STEP) - sign * drag;
          e.x += (baseX - e.x) * (1 - Math.exp(-dt * 12));
          const inMud = Math.abs(e.x) < PIT;
          e.y += ((inMud ? -0.4 : 0) - e.y) * (1 - Math.exp(-dt * 8));
          const z = e.slot % 2 ? 0.3 : -0.3;

          e.c.root.position.set(e.x, e.y, z);
          const minePulling = id === o.meId && Date.now() - f.pullAt < 160;
          if (won) e.c.setYaw(0);
          e.c.update(dt, {
            speed: minePulling ? 1 : e.team === 'A' ? pullA : pullB,
            dead: lost && sinceWin > 0.9,
            time,
            pose: won ? 'cheer' : lost ? 'hit' : 'pull',
          });
          k.label(o.labels.get(id), e.x, 2.1 + e.y, z);
        }

        if (f.winner && sinceWin > 0.85 && !splashed) {
          splashed = true;
          k.effects.burst(0, 0, 0, {
            count: k.count(90),
            palette: ['#4a3322', '#6b4a30', '#8a6440'],
            speed: 6,
            life: 1.1,
            size: 0.22,
            additive: false,
          });
          k.shake(0.3);
        }

        for (const fl of flagMeshes) fl.rotation.y = Math.sin(time * 3 + fl.userData.sign) * 0.25;
        for (const l of lanterns) {
          l.rotation.y += dt;
          l.position.y = l.userData.base + Math.sin(time * 1.4 + l.position.x) * 0.15;
        }

        const dist = k.fit(halfW, 2.6, PITCH);
        camPos.set(0, camLook.y + Math.sin(PITCH) * dist, Math.cos(PITCH) * dist);
        k.look(camPos, camLook);
      },
    };
  });
}
