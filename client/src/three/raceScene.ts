import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  RepeatWrapping,
  CapsuleGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { RaceConfig, RacePos } from '../games/race/useRaceGame';

export interface RaceFrame {
  cfg: RaceConfig;
  positions: { current: Record<string, RacePos> };
  jumpAt: { current: Record<string, number> };
  finished: Record<string, number>;
  tripAt: Record<string, number>;
  tripHurdle: Record<string, number>;
}

export interface RaceSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => RaceFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị quãng đường của server = S đơn vị 3D (đường 330 → ~115) */
const S = 0.35;
const LANE_W = 1.25;
const PAD = 6;
const TIP_MS = 1100;

export function createRaceScene(o: RaceSceneOptions) {
  const first0 = o.read();
  const half = (first0.cfg.distance * S) / 2;
  const w0 = Math.max(1, o.players.length) * LANE_W + 1.2;
  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [half + PAD + 6, w0 / 2 + 8], groundY: -0.21 },
      sun: [-8, 22, 14],
      shadowBox: 30,
    },
    (k) => {
    const { scene } = k.engine;
    const first = o.read();
    const cfg = first.cfg;
    const n = Math.max(1, o.players.length);
    const L = cfg.distance * S;
    const x0 = -L / 2;
    const trackW = n * LANE_W + 1.2;
    const totalL = L + PAD * 2;
    const laneZ = (i: number) => (i - (n - 1) / 2) * LANE_W;
    const wx = (pos: number) => x0 + Math.max(0, Math.min(cfg.distance, pos)) * S;

    /* ---------------- đường chạy điền kinh (texture vẽ bằng canvas) ---------------- */
    const texH = Math.max(160, Math.round((4096 * trackW) / totalL));
    const trackTex = k.texture(4096, texH, (g, w, h) => {
      g.fillStyle = '#ff7a4d';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      for (let i = 0; i < 2500; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      const px = (x: number) => ((x + totalL / 2) / totalL) * w;
      const pz = (z: number) => ((z + trackW / 2) / trackW) * h;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = Math.max(2, h / 140);
      for (let i = 0; i <= n; i++) {
        const z = (i - n / 2) * LANE_W;
        g.beginPath();
        g.moveTo(0, pz(z));
        g.lineTo(w, pz(z));
        g.stroke();
      }
      g.fillStyle = '#ffffff';
      g.fillRect(px(x0) - 4, pz(-(n * LANE_W) / 2), 8, pz((n * LANE_W) / 2) - pz(-(n * LANE_W) / 2));
      // vạch đích ca-rô
      const cell = (pz((n * LANE_W) / 2) - pz(-(n * LANE_W) / 2)) / (n * 2);
      for (let r = 0; r < n * 2; r++) {
        for (let c = 0; c < 2; c++) {
          g.fillStyle = (r + c) % 2 ? '#111' : '#fff';
          g.fillRect(px(-x0) + c * cell - cell, pz(-(n * LANE_W) / 2) + r * cell, cell, cell);
        }
      }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = `bold ${Math.max(14, Math.round(h / (n * 2.4)))}px system-ui, sans-serif`;
      for (let d = 25; d < cfg.distance; d += 25) g.fillText(`${d}m`, px(x0 + d * S) + 6, pz(-(n * LANE_W) / 2) + 22);
    });
    const side = k.lit({ color: '#d8552f' });
    const track = new Mesh(new BoxGeometry(totalL, 0.2, trackW), [side, side, k.lit({ map: trackTex }), side, side, side]);
    track.position.y = -0.1;
    track.receiveShadow = true;
    scene.add(track);

    // lề đường sọc đỏ trắng như đường đua đồ chơi
    const curbTex = k.texture(128, 32, (g, w, h) => {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#ff3d6e';
        g.fillRect((i * w) / 4, 0, w / 4, h);
      }
    });
    curbTex.wrapS = RepeatWrapping;
    curbTex.repeat.set(totalL / 1.6, 1);
    const curbMat = k.lit({ map: curbTex });
    for (const sgn of [-1, 1]) {
      const curb = new Mesh(new BoxGeometry(totalL, 0.34, 0.5), curbMat);
      curb.position.set(0, 0.07, sgn * (trackW / 2 + 0.25));
      curb.castShadow = !k.low;
      curb.receiveShadow = true;
      scene.add(curb);
    }

    /* ---------------- rào: InstancedMesh → cả trăm cái rào chỉ tốn 2 draw call ---------------- */
    const H = cfg.hurdles.length;
    const posts = new InstancedMesh(new BoxGeometry(0.07, 0.72, 0.07), k.lit({ color: '#dfe3f5' }), n * H * 2);
    const barTex = k.texture(256, 32, (g, w, h) => {
      const seg = w / 8;
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#ff2d55';
        g.fillRect(i * seg, 0, seg, h);
      }
    });
    const bars = new InstancedMesh(new BoxGeometry(0.1, 0.18, LANE_W * 0.78), k.lit({ map: barTex }), n * H);
    posts.castShadow = bars.castShadow = !k.low;
    scene.add(posts, bars);
    const tipAt: number[] = new Array(n * H).fill(-1e9);
    const mBase = new Matrix4();
    const mRot = new Matrix4();
    const mOff = new Matrix4();
    const mOut = new Matrix4();
    let tipping = true; // bố trí lần đầu

    const layoutHurdles = (now: number) => {
      let active = false;
      for (let lane = 0; lane < n; lane++) {
        for (let h = 0; h < H; h++) {
          const idx = lane * H + h;
          const tt = (now - tipAt[idx]) / TIP_MS;
          // rào đổ chúi về trước rồi bật dựng lại (server vẫn giữ rào, phải nhảy lại)
          const tilt = tt >= 0 && tt <= 1 ? Math.sin(tt * Math.PI) * 1.25 : 0;
          if (tilt) active = true;
          mBase.makeTranslation(wx(cfg.hurdles[h]), 0, laneZ(lane));
          mRot.makeRotationZ(-tilt);
          for (let s = 0; s < 2; s++) {
            mOff.makeTranslation(0, 0.36, (s ? 1 : -1) * LANE_W * 0.36);
            mOut.copy(mBase).multiply(mRot).multiply(mOff);
            posts.setMatrixAt(idx * 2 + s, mOut);
          }
          mOff.makeTranslation(0, 0.66, 0);
          mOut.copy(mBase).multiply(mRot).multiply(mOff);
          bars.setMatrixAt(idx, mOut);
        }
      }
      posts.instanceMatrix.needsUpdate = true;
      bars.instanceMatrix.needsUpdate = true;
      return active;
    };

    /* ---------------- cổng đích + khán đài + đèn sân ---------------- */
    const poleMat = k.lit({ color: '#ffd23f' });
    for (const s of [-1, 1]) {
      const pole = new Mesh(new CylinderGeometry(0.28, 0.32, 3.4, 20), poleMat);
      pole.position.set(-x0, 1.7, s * (trackW / 2 + 0.55));
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
    const banner = new Mesh(new BoxGeometry(0.5, 0.8, trackW + 1.7), k.lit({ map: checker }));
    banner.position.set(-x0, 3.5, 0);
    scene.add(banner);

    const standZ = -(trackW / 2 + 2.2);
    const standMat = k.lit({ color: '#ffffff' });
    for (let r = 0; r < 3; r++) {
      const step = new Mesh(new BoxGeometry(totalL + 8, 0.5 + r * 0.55, 1.1), standMat);
      step.position.set(0, (0.5 + r * 0.55) / 2 - 0.2, standZ - r * 1.1);
      step.receiveShadow = true;
      scene.add(step);
    }
    const perRow = Math.round((totalL + 6) / 0.65);
    const crowd = new InstancedMesh(new CapsuleGeometry(0.2, 0.22, 4, 12), k.lit({}), perRow * 3);
    const crowdHeads = new InstancedMesh(new SphereGeometry(0.17, 12, 10), k.lit({ color: '#ffd9b8' }), perRow * 3);
    const crowdBase: { x: number; y: number; z: number; phase: number }[] = [];
    const tint = new Color();
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < perRow; i++) {
        const idx = r * perRow + i;
        crowdBase.push({
          x: -(totalL + 6) / 2 + i * 0.65 + (Math.random() - 0.5) * 0.2,
          y: 0.5 + r * 0.55 + 0.05,
          z: standZ - r * 1.1,
          phase: Math.random() * 6,
        });
        tint.setHSL(Math.random(), 0.85, 0.6);
        crowd.setColorAt(idx, tint);
      }
    }
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    scene.add(crowd, crowdHeads);

    /* ---------------- nhân vật ---------------- */
    interface Entry {
      c: Character3D;
      lane: number;
      x: number;
      placed: boolean;
      lastTrip: number;
      finishedSeen: boolean;
    }
    const chars = new Map<string, Entry>();
    o.players.forEach((p, lane) => {
      const c = k.kit.create(p.color, p.id === o.meId);
      c.setShadows(!k.low);
      c.setYaw(Math.PI / 2); // chạy về phía +X
      scene.add(c.root);
      chars.set(p.id, {
        c,
        lane,
        x: x0,
        placed: false,
        lastTrip: first.tripAt[p.id] ?? 0,
        finishedSeen: !!first.finished[p.id],
      });
    });
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    let camX = x0 + 4;
    let excitement = 0;
    const camPos = new Vector3();
    const camLook = new Vector3();
    const m = new Matrix4();

    return {
      frame(dt, time) {
        const f = o.read();
        const nowMs = Date.now();
        let followX = -Infinity;

        for (const pl of o.players) {
          const e = chars.get(pl.id)!;
          const q = f.positions.current[pl.id] ?? { pos: 0, jumping: false, stunned: false, running: false };
          const target = wx(q.pos);
          if (!e.placed) {
            e.x = target;
            e.placed = true;
          } else {
            // server gửi vị trí ~10 lần/giây: nội suy cho mượt
            e.x += (target - e.x) * (1 - Math.exp(-dt * 12));
          }

          const jumpT = (nowMs - (f.jumpAt.current[pl.id] ?? 0)) / cfg.jumpMs;
          const lift = jumpT >= 0 && jumpT <= 1 ? Math.sin(jumpT * Math.PI) * 1.0 : 0;
          const tripping = nowMs - (f.tripAt[pl.id] ?? 0) < 1000 || q.stunned;
          const done = !!f.finished[pl.id];

          e.c.root.position.set(e.x, lift, laneZ(e.lane));
          if (done) e.c.setYaw(0); // về đích thì quay ra ăn mừng
          e.c.update(dt, {
            speed: q.running && !tripping ? 1 : 0,
            dead: false,
            time,
            pose: done ? 'cheer' : tripping ? 'hit' : lift > 0.05 ? 'jump' : 'run',
          });
          k.label(o.labels.get(pl.id), e.x, 2.15 + lift, laneZ(e.lane));

          const trip = f.tripAt[pl.id] ?? 0;
          if (trip > e.lastTrip) {
            e.lastTrip = trip;
            const at = f.tripHurdle[pl.id];
            let h = 0;
            if (typeof at === 'number') {
              let best = Infinity;
              cfg.hurdles.forEach((v, i) => {
                if (Math.abs(v - at) < best) {
                  best = Math.abs(v - at);
                  h = i;
                }
              });
            }
            tipAt[e.lane * H + h] = nowMs;
            tipping = true;
            k.effects.burst(wx(cfg.hurdles[h]), 0.4, laneZ(e.lane), {
              count: k.count(18),
              palette: ['#d9b38c', '#a8433a', '#ffffff'],
              speed: 3.5,
              life: 0.6,
              size: 0.14,
            });
            k.shake(pl.id === o.meId ? 0.3 : 0.06);
          }
          if (done && !e.finishedSeen) {
            e.finishedSeen = true;
            excitement = 1;
            k.effects.burst(-x0, 2, laneZ(e.lane), {
              count: k.count(70),
              palette: ['#ffd166', '#4cc9f0', '#ff6bd6', '#3ddc97', '#ffffff'],
              speed: 7,
              life: 1.2,
              size: 0.2,
            });
            k.shake(0.12);
          }

          if (pl.id === o.meId) followX = e.x;
          else if (followX === -Infinity) followX = Math.max(followX, e.x);
        }

        if (tipping) tipping = layoutHurdles(nowMs);

        // khán giả nhún nhảy, hào hứng hơn khi có người về đích
        excitement = Math.max(0, excitement - dt * 0.25);
        for (let i = 0; i < crowdBase.length; i++) {
          const b = crowdBase[i];
          const bob = Math.abs(Math.sin(time * (4 + excitement * 6) + b.phase)) * (0.05 + excitement * 0.25);
          m.makeTranslation(b.x, b.y + bob, b.z);
          crowd.setMatrixAt(i, m);
          m.makeTranslation(b.x, b.y + bob + 0.42, b.z);
          crowdHeads.setMatrixAt(i, m);
        }
        crowd.instanceMatrix.needsUpdate = true;
        crowdHeads.instanceMatrix.needsUpdate = true;

        // camera bám theo mình từ phía khán đài đối diện
        const aim = Math.max(x0 + 3, Math.min(-x0 - 1, followX === -Infinity ? x0 : followX));
        camX += (aim - camX) * (1 - Math.exp(-dt * 3));
        camPos.set(camX - 6, 2.7 + n * 0.2, trackW / 2 + 5.5 + n * 0.3);
        camLook.set(camX + 3, 1.7, 0);
        k.look(camPos, camLook);
      },
    };
  },
  );
}
