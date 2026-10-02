import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { BombConfig, BombPos } from '../games/bomb/useBombGame';
import type { ArenaBox } from '@shared/bombArena';

/** Những gì cảnh 3D cần đọc mỗi khung hình — lấy thẳng từ hook useBombGame. */
export interface BombFrameState {
  cfg: BombConfig;
  holders: string[];
  ratio: number;
  out: Record<string, number>;
  blastAt: Record<string, number>;
  tagAt: number;
  jumpFx: { current: number };
  positions: { current: Record<string, BombPos> };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number; z: number } | undefined;
  serverNow(): number;
}

export interface BombSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => BombFrameState;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const PITCH = (58 * Math.PI) / 180;
const CHAR_SCALE = 1.1;
/** nửa vùng nhìn thấy khi camera bám theo mình (đơn vị 3D) */
const VIEW_HALF_W = 10.5;
const VIEW_HALF_D = 7.2;
/** số bom tối đa cùng lúc (server: ceil(16/3) = 6) */
const RIGS = 6;
const BOLTS = 4;
const BOLT_SEGS = 7;

/** hiệu ứng "đang ôm bom": quả bom + ngọn lửa khổng lồ + tia sét trên đầu */
interface Rig {
  root: Group;
  bomb: Group;
  spark: Mesh;
  bombMat: MeshBasicMaterial;
  flames: Mesh[];
  segs: Mesh[][];
  ring: Mesh;
  boltT: number;
  phase: number;
}

export function createBombScene(o: BombSceneOptions) {
  const cfg = o.read().cfg;
  const AW = cfg.w * S;
  const AH = cfg.h * S;
  const wx = (x: number) => x * S - AW / 2;
  const wz = (y: number) => y * S - AH / 2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [AW / 2 + 3, AH / 2 + 3], groundY: -34, ground: false },
      sun: [-10, 26, 12],
      shadowBox: 15,
    },
    (k) => {
      const { scene } = k.engine;

      // biển trong xanh phía dưới đảo
      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#58c4e6' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -9;
      scene.add(sea);

      /* ---------------- đảo nổi: mặt cỏ caro + thân đá + viền ---------------- */
      const grass = k.texture(1024, 672, (g, w, h) => {
        const cols = 16;
        const rows = 10.5;
        const tw = w / cols;
        const th = h / rows;
        for (let r = 0; r < rows; r++) {
          for (let q = 0; q < cols; q++) {
            g.fillStyle = (r + q) % 2 ? '#8fe36a' : '#7fd65a';
            g.fillRect(q * tw, r * th, tw + 1, th + 1);
          }
        }
        // vòng tròn + vạch giữa sân như sân thi đấu
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = 7;
        g.beginPath();
        g.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(w / 2, 0);
        g.lineTo(w / 2, h);
        g.stroke();
        g.setLineDash([22, 18]);
        g.lineWidth = 5;
        g.strokeRect(34, 34, w - 68, h - 68);
        g.setLineDash([]);
      });
      const dirt = k.lit({ color: '#d99a52', flatShading: true });
      const island = new Mesh(new BoxGeometry(AW, 0.6, AH), [dirt, dirt, k.lit({ map: grass }), dirt, dirt, dirt]);
      island.position.y = -0.3;
      island.receiveShadow = true;
      scene.add(island);

      const rock = new Mesh(new CylinderGeometry(AW * 0.52, AW * 0.12, 9, 7, 1), k.lit({ color: '#b87a3d', flatShading: true }));
      rock.scale.z = AH / AW;
      rock.position.y = -5.1;
      scene.add(rock);

      const rim = k.lit({ color: '#fff4d8' });
      const addRim = (x: number, z: number, w: number, d: number) => {
        const m = new Mesh(new BoxGeometry(w, 0.28, d), rim);
        m.position.set(x, 0.14, z);
        m.castShadow = !k.low;
        m.receiveShadow = true;
        scene.add(m);
      };
      addRim(0, -AH / 2 - 0.15, AW + 0.6, 0.3);
      addRim(0, AH / 2 + 0.15, AW + 0.6, 0.3);
      addRim(-AW / 2 - 0.15, 0, 0.3, AH);
      addRim(AW / 2 + 0.15, 0, 0.3, AH);

      /* ---------------- khối: thùng, bục, tường, cột, bục sân khấu (khớp từng khối của server) ---------------- */
      const crateTex = k.texture(256, 256, (g, w, h) => {
        g.fillStyle = '#f4a63a';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#d98a1f';
        g.lineWidth = 6;
        for (let i = 1; i < 4; i++) {
          g.beginPath();
          g.moveTo((i * w) / 4, 0);
          g.lineTo((i * w) / 4, h);
          g.stroke();
        }
        g.strokeStyle = '#b9731f';
        g.lineWidth = 18;
        g.strokeRect(9, 9, w - 18, h - 18);
        g.lineWidth = 12;
        g.beginPath();
        g.moveTo(14, 14);
        g.lineTo(w - 14, h - 14);
        g.moveTo(w - 14, 14);
        g.lineTo(14, h - 14);
        g.stroke();
      });
      const blockTex = k.texture(256, 256, (g, w, h) => {
        g.fillStyle = '#8b5cf6';
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.22)';
        for (let i = -2; i < 6; i++) {
          g.beginPath();
          g.moveTo(i * 64, h);
          g.lineTo(i * 64 + 32, h);
          g.lineTo(i * 64 + 32 + h, 0);
          g.lineTo(i * 64 + h, 0);
          g.closePath();
          g.fill();
        }
        g.strokeStyle = '#5b34c9';
        g.lineWidth = 16;
        g.strokeRect(8, 8, w - 16, h - 16);
      });
      const wallTex = k.texture(256, 128, (g, w, h) => {
        g.fillStyle = '#2fd6a0';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#1ba67a';
        g.lineWidth = 5;
        const bh = h / 3;
        for (let r = 0; r < 3; r++) {
          g.beginPath();
          g.moveTo(0, r * bh);
          g.lineTo(w, r * bh);
          g.stroke();
          const off = r % 2 ? w / 8 : 0;
          for (let q = 0; q < 5; q++) {
            g.beginPath();
            g.moveTo(off + (q * w) / 4, r * bh);
            g.lineTo(off + (q * w) / 4, (r + 1) * bh);
            g.stroke();
          }
        }
      });
      const pillarTex = k.texture(128, 256, (g, w, h) => {
        const bands = 8;
        for (let i = 0; i < bands; i++) {
          g.fillStyle = i % 2 ? '#ffffff' : '#ff4d6d';
          g.fillRect(0, (i * h) / bands, w, h / bands + 1);
        }
      });
      const stageTop = k.texture(256, 256, (g, w, h) => {
        const n = 6;
        for (let r = 0; r < n; r++) {
          for (let q = 0; q < n; q++) {
            g.fillStyle = (r + q) % 2 ? '#ffe27a' : '#ffd23f';
            g.fillRect((q * w) / n, (r * h) / n, w / n + 1, h / n + 1);
          }
        }
        g.strokeStyle = '#ff9f1c';
        g.lineWidth = 12;
        g.strokeRect(6, 6, w - 12, h - 12);
      });

      const mats: Record<ArenaBox['kind'], { side: ReturnType<typeof k.lit>; top: ReturnType<typeof k.lit> }> = {
        crate: { side: k.lit({ map: crateTex }), top: k.lit({ color: '#ffc063' }) },
        block: { side: k.lit({ map: blockTex }), top: k.lit({ color: '#b79bff' }) },
        wall: { side: k.lit({ map: wallTex }), top: k.lit({ color: '#6ff0c6' }) },
        pillar: { side: k.lit({ map: pillarTex }), top: k.lit({ color: '#ffffff' }) },
        stage: { side: k.lit({ color: '#ffb000' }), top: k.lit({ map: stageTop }) },
      };
      const capGeo = new SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      for (const b of cfg.boxes) {
        const m = mats[b.kind];
        const mesh = new Mesh(new BoxGeometry(b.w * S, b.h * S, b.d * S), [m.side, m.side, m.top, m.side, m.side, m.side]);
        mesh.position.set(wx(b.x), (b.h * S) / 2, wz(b.y));
        mesh.castShadow = !k.low;
        mesh.receiveShadow = true;
        scene.add(mesh);
        if (b.kind === 'pillar') {
          const cap = new Mesh(capGeo, k.lit({ color: '#ff4d6d' }));
          cap.scale.setScalar((b.w * S) / 2 + 0.08);
          cap.position.set(wx(b.x), b.h * S, wz(b.y));
          cap.castShadow = !k.low;
          scene.add(cap);
        }
      }

      /* ---------------- trang trí: cờ ở bốn góc + đảo con có cây quanh đảo chính ---------------- */
      const flags: Mesh[] = [];
      const flagColors = ['#ff5e8a', '#ffd23f', '#5b8cff', '#2fd6a0'];
      [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].forEach(([sx, sz], i) => {
        const pole = new Mesh(new CylinderGeometry(0.06, 0.07, 3, 8), k.lit({ color: '#ffffff' }));
        pole.position.set(sx * (AW / 2 + 0.1), 1.5, sz * (AH / 2 + 0.1));
        pole.castShadow = !k.low;
        const flag = new Mesh(new PlaneGeometry(1.1, 0.7), new MeshBasicMaterial({ color: flagColors[i], side: DoubleSide }));
        flag.position.set(sx * (AW / 2 + 0.1) + 0.55 * -sx, 2.65, sz * (AH / 2 + 0.1));
        flags.push(flag);
        scene.add(pole, flag);
      });

      const trunk = k.lit({ color: '#9a6a3a' });
      const leaf = [k.lit({ color: '#4fd27a', flatShading: true }), k.lit({ color: '#7be070', flatShading: true })];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const rx = AW / 2 + 5 + (i % 3) * 1.6;
        const rz = AH / 2 + 4.5 + (i % 2) * 1.8;
        const isle = new Group();
        const base = new Mesh(new CylinderGeometry(1.8, 1.1, 1.4, 9), k.lit({ color: '#e9c07c', flatShading: true }));
        base.position.y = -0.7;
        const top = new Mesh(new CylinderGeometry(1.8, 1.8, 0.16, 9), k.lit({ color: '#8fe36a' }));
        top.position.y = 0.02;
        isle.add(base, top);
        if (i % 3 !== 2) {
          const t = new Mesh(new CylinderGeometry(0.12, 0.18, 1.5, 6), trunk);
          t.position.y = 0.8;
          const c1 = new Mesh(new IcosahedronGeometry(0.85, 0), leaf[i % 2]);
          c1.position.y = 1.9;
          const c2 = new Mesh(new IcosahedronGeometry(0.55, 0), leaf[(i + 1) % 2]);
          c2.position.set(0.5, 1.5, 0.2);
          isle.add(t, c1, c2);
        } else {
          const r = new Mesh(new DodecahedronGeometry(0.7, 0), k.lit({ color: '#9aa7b8', flatShading: true }));
          r.position.set(0.2, 0.5, 0);
          isle.add(r);
        }
        isle.position.set(Math.cos(a) * rx, -0.9 - (i % 3) * 0.6, Math.sin(a) * rz);
        scene.add(isle);
      }

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        y: number;
        z: number;
        px: number;
        py: number;
        pz: number;
        placed: boolean;
        outAt: number;
        lastBlast: number;
      }
      const first = o.read();
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, placed: false, outAt: -1, lastBlast: first.blastAt[p.id] ?? 0 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      /* ---------------- hiệu ứng ôm bom: lửa khổng lồ + sét (dùng chung RIGS bộ, gán cho từng người ôm bom) ---------------- */
      const flameGeo = new ConeGeometry(0.55, 1.7, 10, 1, true);
      const flameCols = ['#ff5a00', '#ffb300', '#fff6b0'];
      const segGeo = new CylinderGeometry(0.04, 0.04, 1, 4);
      const boltMat = new MeshBasicMaterial({ color: '#d6f4ff', blending: AdditiveBlending, transparent: true, depthWrite: false });
      const ringGeo = new RingGeometry(0.62, 0.86, 36);
      const rigs: Rig[] = [];
      for (let i = 0; i < RIGS; i++) {
        const root = new Group();
        root.visible = false;

        const flames = flameCols.map((col, j) => {
          const m = new Mesh(
            flameGeo,
            new MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.62 + j * 0.12,
              blending: AdditiveBlending,
              depthWrite: false,
              side: DoubleSide,
            }),
          );
          m.scale.setScalar(1.25 - j * 0.3);
          m.position.y = 3.0 + j * 0.04;
          root.add(m);
          return m;
        });

        const bomb = new Group();
        const bombMat = new MeshBasicMaterial({ color: '#1d2036' });
        const body = new Mesh(new SphereGeometry(0.42, 16, 12), bombMat);
        const cap = new Mesh(new CylinderGeometry(0.13, 0.15, 0.13, 10), new MeshBasicMaterial({ color: '#9aa3c7' }));
        cap.position.y = 0.42;
        const fuse = new Mesh(new CylinderGeometry(0.03, 0.03, 0.3, 6), new MeshBasicMaterial({ color: '#d7b13a' }));
        fuse.position.set(0.08, 0.6, 0);
        fuse.rotation.z = -0.5;
        const spark = new Mesh(new SphereGeometry(0.1, 8, 6), new MeshBasicMaterial({ color: '#ffe07a' }));
        spark.position.set(0.17, 0.77, 0);
        bomb.add(body, cap, fuse, spark);
        bomb.position.y = 2.65;
        root.add(bomb);

        const segs: Mesh[][] = [];
        for (let b = 0; b < BOLTS; b++) {
          const list: Mesh[] = [];
          for (let s = 0; s < BOLT_SEGS; s++) {
            const m = new Mesh(segGeo, boltMat);
            m.visible = false;
            root.add(m);
            list.push(m);
          }
          segs.push(list);
        }

        const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#ff2d55', transparent: true, opacity: 0.8, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        scene.add(ring);
        ring.visible = false;

        scene.add(root);
        rigs.push({ root, bomb, spark, bombMat, flames, segs, ring, boltT: 0, phase: Math.random() * 6 });
      }

      const up = new Vector3(0, 1, 0);
      const qa = new Quaternion();
      const va = new Vector3();
      const vb = new Vector3();
      const vd = new Vector3();
      /** vẽ lại các tia sét: mỗi tia là một đường gấp khúc ngẫu nhiên toả ra từ ngọn lửa */
      const rezap = (r: Rig, power: number) => {
        r.segs.forEach((list, bi) => {
          const on = Math.random() < 0.5 + power * 0.45;
          const ang = Math.random() * Math.PI * 2;
          const len = 1.7 + Math.random() * 1.5 + power;
          const lift = 0.35 + Math.random() * 0.9;
          va.set(0, 2.9 + Math.random() * 0.5, 0);
          list.forEach((m, si) => {
            if (!on) {
              m.visible = false;
              return;
            }
            const t = (si + 1) / BOLT_SEGS;
            vb.set(
              Math.cos(ang + bi * 1.2) * len * t + (Math.random() - 0.5) * 0.55,
              2.9 + lift * t * (bi % 2 ? 1 : -0.6) + (Math.random() - 0.5) * 0.5,
              Math.sin(ang + bi * 1.2) * len * t + (Math.random() - 0.5) * 0.55,
            );
            vd.subVectors(vb, va);
            const l = vd.length() || 0.01;
            m.position.copy(va).addScaledVector(vd, 0.5);
            m.scale.set(1, l, 1);
            qa.setFromUnitVectors(up, vd.divideScalar(l));
            m.quaternion.copy(qa);
            m.visible = true;
            va.copy(vb);
          });
        });
      };

      const flash = new PointLight('#ffb35a', 0, 16, 2);
      if (!k.low) scene.add(flash);

      /* ---------------- camera: bám sau lưng mình ở mức vừa, lùi ra xem toàn đảo khi đã nổ ---------------- */
      const focus = new Vector3(0, 0.5, 0);
      const aim = new Vector3();
      const camPos = new Vector3();
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const sunOff = new Vector3(-10, 26, 12);
      const sunAim = new Vector3();
      let followDist = k.fit(VIEW_HALF_W, VIEW_HALF_D, PITCH);
      /** khoảng cách camera hiện tại (làm mượt khi chuyển giữa bám theo ↔ toàn cảnh) */
      let dist = followDist;
      let seenFirst = false;
      let lastTag = first.tagAt;
      let lastJumpFx = first.jumpFx.current;
      const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
      const tmp = new Vector3();

      const explode = (e: Entry, y: number) => {
        k.effects.burst(e.x, y + 1, e.z, {
          count: k.count(120),
          palette: ['#ff9f43', '#ffd166', '#ff2d55', '#fff3c4'],
          speed: 9,
          life: 1,
          size: 0.26,
        });
        if (!k.low) {
          k.effects.burst(e.x, y + 0.8, e.z, {
            count: k.count(40),
            palette: ['#5b5f7a', '#3b3f58', '#2a2d40'],
            speed: 2.6,
            life: 1.4,
            size: 0.55,
            additive: false,
            gravity: -1.6,
            drag: 2,
          });
        }
        k.effects.ring(e.x, e.z, '#ffb35a', 0.6, 6);
        flash.position.set(e.x, y + 1.8, e.z);
        flash.intensity = 24;
        k.shake(0.5);
      };

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const hot = f.ratio < 0.3 && f.holders.length > 0;
          const pulse = Math.abs(Math.sin(time * (4 + 20 * (1 - f.ratio) ** 2)));

          let me: Entry | undefined;
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const at = f.posOf(p.id) ?? (cfg.spawns[p.id] ? { x: cfg.spawns[p.id][0], y: cfg.spawns[p.id][1], z: 0 } : undefined);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const server = f.positions.current[p.id];
            const out = !!server?.out || f.out[p.id] !== undefined;
            const tx = wx(at.x);
            const tz = wz(at.y);
            const ty = at.z * S;
            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.y = ty;
              e.px = tx;
              e.pz = tz;
              e.py = ty;
              e.placed = true;
            } else if (p.id === o.meId && !out) {
              e.x = tx;
              e.z = tz;
              e.y = ty;
            } else if (!out) {
              const kk = 1 - Math.exp(-dt * 14);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
              e.y += (ty - e.y) * kk;
            }
            if (p.id === o.meId) me = e;

            const step = Math.max(dt, 1e-3);
            const vx = (e.x - e.px) / step;
            const vz = (e.z - e.pz) / step;
            const vy = (e.y - e.py) / step;
            e.px = e.x;
            e.pz = e.z;
            e.py = e.y;

            const blastTime = f.blastAt[p.id] ?? 0;
            if (blastTime > e.lastBlast) {
              e.lastBlast = blastTime;
              explode(e, e.y);
            }

            if (out) {
              if (e.outAt < 0) e.outAt = time;
              // bị nổ văng lên cao xoay tròn rồi biến mất
              const t = time - e.outAt;
              e.c.root.visible = t < 1.5;
              e.c.root.position.set(e.x, e.y + 5 * t - 5 * t * t, e.z);
              e.c.root.rotation.z = t * 7;
              e.c.update(dt, { speed: 0, dead: false, time, pose: 'hit' });
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
              continue;
            }
            e.outAt = -1;
            const air = Math.abs(vy) > 0.6 || (at.z > 0.5 && Math.abs(vy) > 0.2);
            const holding = f.holders.includes(p.id);
            e.c.root.visible = true;
            e.c.root.rotation.z = 0;
            e.c.root.position.set(e.x, e.y, e.z);
            e.c.face(vx, vz, dt);
            e.c.update(dt, {
              speed: Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S * (holding ? cfg.carrierBoost : 1))),
              dead: false,
              safe: !!server?.safe,
              holder: holding,
              time,
              pose: air ? 'jump' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, e.y + (holding ? 4.4 : 2.35), e.z);
          }

          // tung bom / bật nhảy: tia sáng nhỏ cho cảm giác có "lực"
          if (f.tagAt > lastTag) {
            lastTag = f.tagAt;
            for (const hid of f.holders) {
              const h = chars.get(hid);
              if (h?.placed) {
                k.effects.burst(h.x, h.y + 1.5, h.z, {
                  count: k.count(28),
                  palette: ['#ffffff', '#ffd166', '#7df9ff'],
                  speed: 5,
                  life: 0.45,
                  size: 0.15,
                });
              }
            }
            k.shake(0.16);
          }
          if (me && f.jumpFx.current !== lastJumpFx) {
            lastJumpFx = f.jumpFx.current;
            k.effects.burst(me.x, me.y + 0.1, me.z, {
              count: k.count(10),
              palette: ['#ffffff', '#e8f7ff'],
              speed: 2.2,
              life: 0.35,
              size: 0.12,
              gravity: 2,
            });
          }

          // gán từng bộ hiệu ứng cho một người đang ôm bom
          rigs.forEach((r, i) => {
            const id = f.holders[i];
            const h = id ? chars.get(id) : undefined;
            const on = !!h && h.placed && f.out[id!] === undefined;
            r.root.visible = on;
            r.ring.visible = on;
            if (!on || !h) return;
            const wob = Math.sin(time * 9 + r.phase);
            r.root.position.set(h.x, h.y, h.z);
            const grow = 1 + (hot ? 0.35 : 0) + 0.08 * wob;
            r.flames.forEach((m, j) => {
              const flick = 1 + 0.18 * Math.sin(time * (13 + j * 5) + r.phase + j);
              m.scale.set(grow * (1.25 - j * 0.3) * (1 + 0.1 * wob), grow * (1.25 - j * 0.3) * flick, grow * (1.25 - j * 0.3));
              m.rotation.y = time * (2 + j) + r.phase;
              m.position.y = 2.05 + 0.85 * m.scale.y;
              (m.material as MeshBasicMaterial).color.set(hot && j === 0 ? '#ff2400' : flameCols[j]);
            });
            r.bomb.rotation.y += dt * 1.4;
            r.bomb.position.y = 2.65 + 0.05 * wob;
            r.bomb.scale.setScalar(hot ? 1 + 0.2 * pulse : 1);
            r.bombMat.color.set(hot && pulse > 0.5 ? '#6a1020' : '#1d2036');
            r.spark.scale.setScalar(0.7 + Math.random() * 0.8);
            r.boltT -= dt;
            if (r.boltT <= 0) {
              r.boltT = hot ? 0.04 : 0.08;
              rezap(r, hot ? 1 : 0.2);
            }
            r.ring.position.set(h.x, h.y + 0.04, h.z);
            r.ring.scale.setScalar(1 + 0.12 * Math.sin(time * 8));
            (r.ring.material as MeshBasicMaterial).opacity = hot ? 0.5 + 0.5 * pulse : 0.75;
          });

          for (let i = 0; i < flags.length; i++) {
            flags[i].rotation.y = Math.sin(time * 3 + i) * 0.35;
            flags[i].scale.x = 1 + Math.sin(time * 5 + i * 2) * 0.08;
          }
          flash.intensity *= Math.exp(-dt * 7);

          // camera
          const meOut = !me || f.out[o.meId] !== undefined;
          const targetDist = meOut ? k.fit(AW / 2 + 1.5, AH / 2 + 1.4, PITCH) : followDist;
          if (!meOut && me) {
            aim.set(clamp(me.x, AW / 2 - VIEW_HALF_W * 0.55), 0.6, clamp(me.z, AH / 2 - VIEW_HALF_D * 0.45));
          } else aim.set(0, 0.4, 0.3);
          if (!seenFirst) {
            focus.copy(aim);
            seenFirst = true;
          }
          focus.lerp(aim, 1 - Math.exp(-dt * 4));
          followDist = k.fit(VIEW_HALF_W, VIEW_HALF_D, PITCH);
          dist = dist + (targetDist - dist) * (1 - Math.exp(-dt * 3));
          camPos.copy(focus).addScaledVector(camDir, dist);
          k.look(camPos, focus);
          tmp.set(focus.x, 0, focus.z);
          sunAim.copy(tmp);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
      };
    },
  );
}
