import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import {
  COLLAPSE_DELAY,
  COLLAPSE_GONE,
  F_FIN,
  F_GROUND,
  F_OUT,
  F_STUN,
  lavaZ,
  platCenter,
  vanishOn,
  type LvBody,
  type LvConfig,
} from '@shared/lavaRun';
import type { LvFx, LvPos } from '../games/lava/useLavaGame';

export interface LavaFrame {
  cfg: LvConfig;
  startAt: number;
  positions: { current: Record<string, LvPos> };
  fx: { current: LvFx[] };
  trig: { current: number[] };
  meBody: { current: LvBody };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number; z: number } | undefined;
  serverNow(): number;
}

export interface LavaSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => LavaFrame;
  labels: Map<string, HTMLElement | null>;
}

const THICK = 0.8;
const CHAR_SCALE = 1;
const COLORS = ['#5aa9ff', '#ff9f43', '#9fe6ff', '#c08bff', '#4fe0a0'];
const CP_COLOR = '#ffd23f';

/** vẽ các vệt dung nham liền mạch (lặp được) */
function drawLava(g: CanvasRenderingContext2D, w: number, h: number, overlay: boolean) {
  let s = overlay ? 77 : 1234;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  if (!overlay) {
    g.fillStyle = '#c4260a';
    g.fillRect(0, 0, w, h);
  } else {
    g.clearRect(0, 0, w, h);
  }
  const blob = (x: number, y: number, r: number, c0: string, c1: string) => {
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, c0);
        gr.addColorStop(1, c1);
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  };
  if (!overlay) {
    for (let i = 0; i < 46; i++) blob(rand() * w, rand() * h, 14 + rand() * 26, 'rgba(255,120,20,0.85)', 'rgba(255,120,20,0)');
    for (let i = 0; i < 26; i++) blob(rand() * w, rand() * h, 8 + rand() * 18, 'rgba(255,214,70,0.9)', 'rgba(255,214,70,0)');
    for (let i = 0; i < 20; i++) blob(rand() * w, rand() * h, 10 + rand() * 20, 'rgba(70,10,0,0.75)', 'rgba(70,10,0,0)');
  } else {
    for (let i = 0; i < 34; i++) blob(rand() * w, rand() * h, 8 + rand() * 20, 'rgba(255,230,120,0.9)', 'rgba(255,230,120,0)');
  }
}

export function createLavaScene(o: LavaSceneOptions) {
  const first = o.read();
  const cfg = first.cfg;
  const plats = cfg.plats;
  const maxY = Math.max(...plats.map((p) => p.y + p.d / 2 + (p.k === 4 ? (p.amp ?? 0) : 0)));
  const L = maxY + 8;
  /** y của server → z của thế giới (khóa học chạy về phía -z, cân giữa khung cảnh) */
  const YC = maxY / 2;
  const wz = (y: number) => -(y - YC);

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [26, L / 2 + 12], groundY: -9, ground: true },
      sun: [-10, 30, 12],
      shadowBox: 16,
    },
    (k) => {
      const { scene } = k.engine;
      const m = new Matrix4();
      const quat = new Quaternion();
      const pos = new Vector3();
      const scl = new Vector3();

      /* ---------------- bục: một InstancedMesh duy nhất ---------------- */
      const tile = k.texture(64, 64, (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#e4ecf7';
        g.fillRect(0, 0, w, 5);
        g.fillRect(0, 0, 5, h);
        g.fillStyle = '#cfd9e8';
        g.fillRect(0, h - 5, w, 5);
        g.fillRect(w - 5, 0, 5, h);
      });
      const geo = new BoxGeometry(1, 1, 1);
      geo.translate(0, -0.5, 0);
      const platMesh = new InstancedMesh(geo, k.lit({ color: '#ffffff', map: tile }), plats.length);
      platMesh.receiveShadow = true;
      platMesh.frustumCulled = false;
      plats.forEach((p, i) => platMesh.setColorAt(i, new Color(p.cp ? CP_COLOR : p.goal ? '#ff8ad0' : COLORS[p.k])));
      scene.add(platMesh);

      // bóng ma của bục biến mất
      const vanishIdx = plats.map((p, i) => (p.k === 3 ? i : -1)).filter((i) => i >= 0);
      const ghost = new InstancedMesh(
        geo,
        new MeshBasicMaterial({ color: '#c08bff', transparent: true, opacity: 0.16, depthWrite: false }),
        Math.max(1, vanishIdx.length),
      );
      ghost.frustumCulled = false;
      scene.add(ghost);

      const dynamic = plats.map((p, i) => (p.k === 1 || p.k === 3 || p.k === 4 ? i : -1)).filter((i) => i >= 0);
      const setPlat = (i: number, cx: number, top: number, cy: number, sx: number, sy: number, sz: number, rotZ = 0) => {
        quat.set(0, 0, Math.sin(rotZ / 2), Math.cos(rotZ / 2));
        pos.set(cx, top, wz(cy));
        m.compose(pos, quat, scl.set(sx, sy, sz));
        platMesh.setMatrixAt(i, m);
      };
      const place = (t: number) => {
        for (const i of dynamic) {
          const p = plats[i];
          const c = platCenter(p, t);
          if (p.k === 4) {
            setPlat(i, c[0], p.z, c[1], p.w, THICK, p.d);
          } else if (p.k === 3) {
            const on = vanishOn(p, t);
            // 0.7s cuối của pha hiện: nhấp nháy báo sắp mất
            const per = p.per ?? 4;
            const left = (p.on ?? 2.5) - ((((t + (p.ph ?? 0)) % per) + per) % per);
            const warn = on && left < 0.7 && Math.floor(t * 10) % 2 === 0;
            const s = on ? (warn ? 0.9 : 1) : 0;
            setPlat(i, c[0], p.z, c[1], p.w * s, THICK * (on ? 1 : 0.0001), p.d * s);
            const gi = vanishIdx.indexOf(i);
            const gs = on ? 0 : 1;
            pos.set(c[0], p.z, wz(c[1]));
            quat.set(0, 0, 0, 1);
            m.compose(pos, quat, scl.set(p.w * gs, THICK * (gs || 0.0001), p.d * gs));
            ghost.setMatrixAt(gi, m);
          } else {
            const tr = first.trig.current[i];
            const e = t - tr; // giây kể từ lúc bị giẫm (Infinity → -Infinity)
            if (!(e >= 0)) {
              setPlat(i, c[0], p.z, c[1], p.w, THICK, p.d);
            } else if (e < COLLAPSE_DELAY) {
              // rung + nghiêng nhẹ trước khi sụp
              const sh = Math.sin(e * 70) * 0.06 * (1 + e * 3);
              setPlat(i, c[0] + sh, p.z - e * 0.08, c[1], p.w, THICK, p.d, Math.sin(e * 55) * 0.025);
            } else if (e < COLLAPSE_DELAY + COLLAPSE_GONE) {
              const f = e - COLLAPSE_DELAY;
              setPlat(i, c[0], p.z - 5 * f * f * 3, c[1], p.w * Math.max(0, 1 - f * 0.9), THICK, p.d * Math.max(0, 1 - f * 0.9), f * 0.8);
            } else {
              // hiện lại: nảy lên
              const f = Math.min(1, (e - COLLAPSE_DELAY - COLLAPSE_GONE) * 4);
              setPlat(i, c[0], p.z, c[1], p.w * f, THICK * (0.4 + 0.6 * f), p.d * f);
            }
          }
        }
        platMesh.instanceMatrix.needsUpdate = true;
        if (vanishIdx.length) ghost.instanceMatrix.needsUpdate = true;
      };
      // vị trí tĩnh dựng một lần
      plats.forEach((p, i) => {
        if (!dynamic.includes(i)) setPlat(i, p.x, p.z, p.y, p.w, THICK, p.d);
      });
      place(0);

      /* ---------------- điểm kiểm tra + cổng đích ---------------- */
      const poleMat = k.lit({ color: '#ffffff' });
      const flagMat = k.lit({ color: '#ffd23f' });
      plats.forEach((p) => {
        if (!p.cp || p === plats[0]) return;
        for (const s of [-1, 1]) {
          const pole = new Mesh(new CylinderGeometry(0.12, 0.14, 2.6, 10), poleMat);
          pole.position.set(p.x + s * (p.w / 2 - 0.4), p.z + 1.3, wz(p.y + p.d / 2 - 0.4));
          const flag = new Mesh(new BoxGeometry(0.9, 0.55, 0.06), flagMat);
          flag.position.set(p.x + s * (p.w / 2 - 0.4) + 0.5, p.z + 2.3, wz(p.y + p.d / 2 - 0.4));
          scene.add(pole, flag);
        }
      });
      const goal = plats[plats.length - 1];
      {
        const checker = k.texture(256, 64, (g, w, h) => {
          const c = h / 2;
          for (let x = 0; x < w / c; x++) for (let y = 0; y < 2; y++) {
            g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
            g.fillRect(x * c, y * c, c, c);
          }
        });
        const gate = new Group();
        gate.position.set(goal.x, goal.z, wz(goal.y));
        for (const s of [-1, 1]) {
          const pole = new Mesh(new CylinderGeometry(0.3, 0.34, 7, 16), k.lit({ color: '#ffd23f' }));
          pole.position.set(s * (goal.w / 2 - 1), 3.5, 0);
          gate.add(pole);
        }
        const banner = new Mesh(new BoxGeometry(goal.w - 1.4, 1.3, 0.4), k.lit({ map: checker }));
        banner.position.set(0, 7, 0);
        gate.add(banner);
        const line = new Mesh(new BoxGeometry(goal.w, 0.03, 0.7), k.lit({ map: checker }));
        line.position.set(0, 0.03, goal.d / 2 - 0.6);
        gate.add(line);
        scene.add(gate);
      }

      /* ---------------- dung nham ---------------- */
      const lavaTex = k.texture(256, 256, (g, w, h) => drawLava(g, w, h, false));
      const glowTex = k.texture(256, 256, (g, w, h) => drawLava(g, w, h, true));
      for (const t of [lavaTex, glowTex]) {
        t.wrapS = t.wrapT = RepeatWrapping;
      }
      const LW = 200;
      const LD = L + 220;
      lavaTex.repeat.set(LW / 22, LD / 22);
      glowTex.repeat.set(LW / 15, LD / 15);
      const lavaMesh = new Mesh(new PlaneGeometry(LW, LD), new MeshBasicMaterial({ map: lavaTex, toneMapped: false }));
      lavaMesh.rotation.x = -Math.PI / 2;
      const glowMesh = new Mesh(
        new PlaneGeometry(LW, LD),
        new MeshBasicMaterial({ map: glowTex, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.55, toneMapped: false }),
      );
      glowMesh.rotation.x = -Math.PI / 2;
      scene.add(lavaMesh, glowMesh);
      let bubbleT = 0;

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        y: number;
        z: number;
        px: number;
        pz: number;
        placed: boolean;
        wasFin: boolean;
        wasOut: boolean;
        burnAt: number;
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, y: 0, z: 0, px: 0, pz: 0, placed: false, wasFin: false, wasOut: false, burnAt: -1e9 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const startSp = cfg.spawns[o.meId] ?? [0, 0];
      const focus = new Vector3(startSp[0], 1, wz(startSp[1]));
      const lookAt = new Vector3();
      const camPos = new Vector3();
      const aim = new Vector3(startSp[0], 1, wz(startSp[1]));
      const sunOff = new Vector3(-10, 30, 12);

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const t = Math.max(0, (now - f.startAt) / 1000);
          place(t);

          // dung nham dâng + trôi
          const lz = lavaZ(cfg.lava, t);
          lavaMesh.position.set(0, lz, 0);
          glowMesh.position.set(0, lz + 0.04 + Math.sin(time * 2.2) * 0.03, 0);
          lavaTex.offset.set(time * 0.012, time * 0.02);
          glowTex.offset.set(-time * 0.02, time * 0.03);

          // sự kiện: bục sụp + người chạm dung nham
          const list = f.fx.current;
          while (list.length) {
            const ev = list.shift()!;
            if (ev.kind === 'col') {
              const p = plats[ev.i];
              k.effects.burst(p.x, p.z, wz(p.y), {
                count: k.count(12),
                palette: ['#e8c9a0', '#ffffff', '#ff9f43'],
                speed: 2.4,
                life: 0.7,
                size: 0.2,
                gravity: -4,
              });
            } else {
              const e = chars.get(ev.playerId);
              if (e) e.burnAt = time;
              k.effects.burst(ev.x, ev.z + 0.3, wz(ev.y), {
                count: k.count(26),
                palette: ['#ff5a1f', '#ffd23f', '#ff9f43', '#ffffff'],
                speed: 6,
                life: 0.9,
                size: 0.26,
                gravity: 9,
              });
              if (ev.playerId === o.meId) k.shake(0.7);
            }
          }

          // bọt dung nham quanh người chơi
          bubbleT -= dt;
          if (bubbleT <= 0) {
            bubbleT = 0.22;
            const n = k.count(2);
            if (n > 0) {
              k.effects.burst(focus.x + (Math.random() - 0.5) * 34, lz + 0.1, focus.z - Math.random() * 30 + 6, {
                count: n,
                palette: ['#ffd23f', '#ff7a1f'],
                speed: 1.2,
                life: 0.9,
                size: 0.3,
                gravity: -2,
              });
            }
          }

          let meX = focus.x;
          let meY = focus.y;
          let meZ = focus.z;
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const sv = f.positions.current[p.id];
            const sp = cfg.spawns[p.id];
            const at = f.posOf(p.id) ?? (sp ? { x: sp[0], y: sp[1], z: 0 } : undefined);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const flags = sv ? sv[3] : F_GROUND;
            const out = !!(flags & F_OUT);
            const finished = !!(flags & F_FIN);
            const stunned = !!(flags & F_STUN) || time - e.burnAt < 0.9;
            const isMe = p.id === o.meId;
            if (!e.placed) {
              e.x = at.x;
              e.y = at.z;
              e.z = at.y;
              e.placed = true;
            } else {
              const far = Math.hypot(at.x - e.x, at.y - e.z) > 4 || Math.abs(at.z - e.y) > 3;
              const kk = far ? 1 : isMe ? 1 : 1 - Math.exp(-dt * 16);
              e.x += (at.x - e.x) * kk;
              e.y += (at.z - e.y) * kk;
              e.z += (at.y - e.z) * kk;
            }
            const wx = e.x;
            const wy = e.y;
            const wzz = wz(e.z);
            const vx = (wx - e.px) / Math.max(dt, 1e-3);
            const vz = (wzz - e.pz) / Math.max(dt, 1e-3);
            const jumpedBig = Math.abs(wx - e.px) > 3 || Math.abs(wzz - e.pz) > 3;
            e.px = wx;
            e.pz = wzz;

            if (finished && !e.wasFin) {
              e.wasFin = true;
              k.effects.burst(wx, wy + 1.4, wzz, {
                count: k.count(20),
                palette: ['#ffd166', '#ff5e8a', '#5ed67a', '#ffffff'],
                speed: 3.6,
                life: 1,
                size: 0.16,
                gravity: -3,
              });
            }
            if (out && !e.wasOut) e.wasOut = true;
            e.c.root.visible = !out;
            if (out) continue;
            e.c.root.position.set(wx, wy, wzz);
            const grounded = isMe ? f.meBody.current.on >= 0 : !!(flags & F_GROUND);
            const sp2 = Math.hypot(vx, vz);
            if (finished) e.c.setYaw(Math.PI);
            else if (!stunned && sp2 > 0.8 && !jumpedBig) e.c.face(vx, vz, dt);
            e.c.update(dt, {
              speed: stunned || finished || !grounded ? 0 : Math.min(1, sp2 / cfg.speed),
              dead: false,
              time,
              safe: stunned && !finished,
              pose: finished ? 'cheer' : stunned ? 'sad' : !grounded ? 'jump' : 'run',
            });
            k.label(o.labels.get(p.id), wx, wy + 2.5, wzz);
            if (isMe) {
              meX = wx;
              meY = wy;
              meZ = wzz;
            }
          }

          // góc nhìn thứ ba kiểu Fall Guys: bám sau lưng, hơi cao nhìn xuống, hướng về phía đích
          aim.set(meX, meY, meZ);
          const lerpK = 1 - Math.exp(-dt * 5);
          focus.x += (aim.x - focus.x) * lerpK;
          focus.y += (aim.y - focus.y) * (1 - Math.exp(-dt * 3.2));
          focus.z += (aim.z - focus.z) * lerpK;
          camPos.set(focus.x * 0.92, focus.y + 6.4, focus.z + 12.5);
          lookAt.set(focus.x, focus.y + 1.6, focus.z - 7.5);
          k.look(camPos, lookAt);

          k.sun.target.position.copy(focus);
          k.sun.position.copy(focus).add(sunOff);
        },
      };
    },
  );
}
