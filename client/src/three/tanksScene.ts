import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { runScene, tileTexture, type SceneHooks } from './scene';
import { sfx } from '../utils/sound';
import { CELL, MAXB, MAXT, MAX_ITEMS, PK_ICON, WALL_HT, angToRad, BK_MISSILE, BK_RAPID } from '@shared/tank';
import type { TankClient } from '@shared/tankClient';

export interface TanksFrame {
  cl: TankClient;
  /** poll + dự đoán + nội suy tới giờ server hiện tại */
  step(now: number): void;
  serverNow(): number;
}

export interface TanksSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  /** theo thứ tự ghế trong đấu trường */
  players: { id: string; color: string }[];
  meSeat: number;
  mw: number;
  mh: number;
  read: () => TanksFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị thế giới (CELL = 60) = S đơn vị 3D */
const S = 0.05;
const PITCH = (63 * Math.PI) / 180;
const WALL_H = 1.5;
const MAX_WALLS = 240;
const MAX_BEAM = 24;
const TANK_SCALE = 1.2;
const ICON_BG = ['', '#ff9f43', '#ff6bd6', '#ff4d4d', '#4cc9f0', '#3ddc97'];

function iconTexture(emoji: string, bg: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.arc(48, 48, 44, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#fff';
  g.stroke();
  g.font = '54px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 48, 52);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createTanksScene(o: TanksSceneOptions) {
  const { mw, mh } = o;
  const halfW = (mw * CELL * S) / 2;
  const halfD = (mh * CELL * S) / 2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [halfW + 1.5, halfD + 1.5] },
      sun: [-6, 22, 10],
      shadowBox: Math.max(halfW, halfD) + 3,
    },
    (k) => {
      const { scene } = k.engine;
      const cx = halfW;
      const cz = halfD;
      /** toạ độ thế giới (đv server) → 3D, gốc ở tâm mê cung */
      const wx = (x: number) => x * S - cx;
      const wz = (y: number) => y * S - cz;

      /* ---------------- sàn ---------------- */
      const floorTex = tileTexture(k, mw, mh, ['#cfd9e6', '#dbe4ef'], 'rgba(60,70,100,0.55)');
      const floor = new Mesh(new PlaneGeometry(halfW * 2 + 0.7, halfD * 2 + 0.7), new MeshLambertMaterial({ map: floorTex }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.02;
      floor.receiveShadow = true;
      scene.add(floor);
      const rim = new Mesh(new BoxGeometry(halfW * 2 + 1.6, 0.12, halfD * 2 + 1.6), new MeshLambertMaterial({ color: '#46546f' }));
      rim.position.y = -0.05;
      scene.add(rim);

      /* ---------------- tường (InstancedMesh) ---------------- */
      const wallMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), k.lit({ color: '#ffffff' }), MAX_WALLS);
      // tường không đổ bóng thật (bóng răng cưa): dùng "bóng tiếp xúc" mờ vẽ sẵn dưới chân tường
      wallMesh.castShadow = false;
      wallMesh.receiveShadow = false;
      wallMesh.frustumCulled = false;
      wallMesh.count = 0;
      scene.add(wallMesh);
      const aoMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: '#0b1226', transparent: true, opacity: 0.2, depthWrite: false }), MAX_WALLS);
      aoMesh.frustumCulled = false;
      aoMesh.count = 0;
      scene.add(aoMesh);
      const m4 = new Matrix4();
      const q = new Quaternion();
      const eul = new Euler();
      const v3 = new Vector3();
      const v3s = new Vector3();
      const colOuter = new Color('#37425c');
      const colInner = new Color('#5d6f96');
      let shownRound = -2;
      const buildMaze = (cl: TankClient) => {
        const m = cl.world.maze;
        let n = 0;
        const t = WALL_HT * 2 * S;
        const put = (x: number, z: number, sx: number, sz: number, outer: boolean) => {
          if (n >= MAX_WALLS) return;
          m4.compose(v3.set(x, WALL_H / 2, z), q.identity(), v3s.set(sx, WALL_H, sz));
          wallMesh.setMatrixAt(n, m4);
          wallMesh.setColorAt(n, outer ? colOuter : colInner);
          m4.compose(v3.set(x, 0.04, z), q.identity(), v3s.set(sx + 0.5, 0.01, sz + 0.5));
          aoMesh.setMatrixAt(n, m4);
          n++;
        };
        for (let j = 0; j <= m.h; j++) {
          for (let i = 0; i < m.w; i++) {
            if (m.hw[j * m.w + i]) put(wx((i + 0.5) * CELL), wz(j * CELL), CELL * S + t, t, j === 0 || j === m.h);
          }
        }
        for (let j = 0; j < m.h; j++) {
          for (let i = 0; i <= m.w; i++) {
            if (m.vw[j * (m.w + 1) + i]) put(wx(i * CELL), wz((j + 0.5) * CELL), t, CELL * S + t, i === 0 || i === m.w);
          }
        }
        wallMesh.count = n;
        aoMesh.count = n;
        aoMesh.instanceMatrix.needsUpdate = true;
        wallMesh.instanceMatrix.needsUpdate = true;
        if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
      };

      /* ---------------- xe tăng ---------------- */
      interface TankObj {
        g: Group;
        mats: MeshLambertMaterial[];
        base: Color[];
        turret: Group;
        shield: Mesh;
        fire: Mesh;
        smokeAt: number;
        wasAlive: boolean;
        color: Color;
      }
      const trackGeo = new BoxGeometry(1.3, 0.3, 0.3);
      const hullGeo = new BoxGeometry(1.05, 0.34, 0.64);
      const turretGeo = new CylinderGeometry(0.26, 0.3, 0.22, 14);
      const barrelGeo = new BoxGeometry(0.66, 0.1, 0.1);
      const shieldGeo = new SphereGeometry(0.85, 16, 12);
      const fireGeo = new SphereGeometry(0.22, 8, 6);
      const dark = '#262a36';
      const tanks: TankObj[] = o.players.map((p) => {
        const g = new Group();
        const mk = (hex: string) => new MeshLambertMaterial({ color: hex });
        const bodyMat = mk(p.color);
        const topMat = mk('#' + new Color(p.color).lerp(new Color('#ffffff'), 0.25).getHexString());
        const trackMat = mk(dark);
        const barrelMat = mk('#3a3f52');
        const add = (geo: BoxGeometry | CylinderGeometry, mat: MeshLambertMaterial, x: number, y: number, z: number, parent: Group = g) => {
          const mesh = new Mesh(geo, mat);
          mesh.position.set(x, y, z);
          mesh.castShadow = !k.low;
          parent.add(mesh);
          return mesh;
        };
        add(trackGeo, trackMat, 0, 0.15, 0.4);
        add(trackGeo, trackMat, 0, 0.15, -0.4);
        add(hullGeo, bodyMat, 0, 0.36, 0);
        const turret = new Group();
        add(turretGeo, topMat, 0.02, 0.64, 0, turret);
        add(barrelGeo, barrelMat, 0.48, 0.64, 0, turret);
        g.add(turret);
        const shield = new Mesh(shieldGeo, new MeshBasicMaterial({ color: '#7fe9ff', transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false }));
        shield.position.y = 0.4;
        shield.visible = false;
        g.add(shield);
        const fire = new Mesh(fireGeo, new MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.9, blending: AdditiveBlending }));
        fire.position.set(-0.1, 0.55, 0);
        fire.visible = false;
        g.add(fire);
        g.visible = false;
        g.scale.setScalar(TANK_SCALE);
        scene.add(g);
        return {
          g,
          mats: [bodyMat, topMat, trackMat, barrelMat],
          base: [bodyMat.color.clone(), topMat.color.clone(), trackMat.color.clone(), barrelMat.color.clone()],
          turret,
          shield,
          fire,
          smokeAt: 0,
          wasAlive: true,
          color: new Color(p.color),
        };
      });

      /* ---------------- đạn + vệt ---------------- */
      const bulletMesh = new InstancedMesh(new SphereGeometry(0.14, 8, 6), new MeshBasicMaterial({ color: '#ffffff' }), MAXB);
      bulletMesh.frustumCulled = false;
      bulletMesh.count = 0;
      scene.add(bulletMesh);
      const trailMesh = new InstancedMesh(
        new BoxGeometry(1, 1, 1),
        new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }),
        MAXB,
      );
      trailMesh.frustumCulled = false;
      trailMesh.count = 0;
      scene.add(trailMesh);
      const lightCols = o.players.map((p) => new Color(p.color).lerp(new Color('#ffffff'), 0.55));
      const white = new Color('#ffffff');

      /* ---------------- tia laze ---------------- */
      const beamMesh = new InstancedMesh(
        new BoxGeometry(1, 1, 1),
        new MeshBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }),
        MAX_BEAM,
      );
      beamMesh.frustumCulled = false;
      beamMesh.count = 0;
      scene.add(beamMesh);

      /* ---------------- vật phẩm ---------------- */
      const itemGeo = new BoxGeometry(0.62, 0.62, 0.62);
      const itemTex = PK_ICON.map((e, i) => (i ? iconTexture(e, ICON_BG[i]) : null));
      interface ItemObj {
        g: Group;
        box: Mesh;
        spr: Sprite;
        kind: number;
      }
      const items: ItemObj[] = [];
      for (let s = 0; s < MAX_ITEMS; s++) {
        const g = new Group();
        const box = new Mesh(itemGeo, new MeshLambertMaterial({ color: '#ffd23f', emissive: '#6b4a00' }));
        box.position.y = 0.55;
        box.castShadow = !k.low;
        const spr = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false }));
        spr.scale.setScalar(1.15);
        spr.position.y = 1.35;
        g.add(box, spr);
        g.visible = false;
        scene.add(g);
        items.push({ g, box, spr, kind: 0 });
      }

      /* ---------------- mảnh vỡ ---------------- */
      interface Debris {
        m: Mesh;
        vx: number;
        vy: number;
        vz: number;
        sp: number;
        life: number;
      }
      const debrisGeo = new BoxGeometry(0.22, 0.12, 0.2);
      const debris: Debris[] = [];
      const debrisMat = new MeshLambertMaterial({ color: '#333' });
      for (let i = 0; i < 28; i++) {
        const m = new Mesh(debrisGeo, debrisMat);
        m.visible = false;
        scene.add(m);
        debris.push({ m, vx: 0, vy: 0, vz: 0, sp: 0, life: 0 });
      }
      let debrisAt = 0;
      const shatter = (x: number, z: number) => {
        const n = k.count(10);
        for (let i = 0; i < n; i++) {
          const d = debris[debrisAt++ % debris.length];
          const a = Math.random() * Math.PI * 2;
          const s = 2 + Math.random() * 5;
          d.m.position.set(x, 0.5, z);
          d.vx = Math.cos(a) * s;
          d.vz = Math.sin(a) * s;
          d.vy = 4 + Math.random() * 5;
          d.sp = 6 + Math.random() * 10;
          d.life = 1.3 + Math.random() * 0.5;
          d.m.visible = true;
        }
      };

      /* ---------------- camera ---------------- */
      const focus = new Vector3(0, 0, 0.2);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const dist = k.fit(halfW + 1.4, halfD + 1.4, PITCH) * 1.04;

      let lastBounceSfx = 0;
      let fxBudget = 0;
      let lastTime = 0;

      const handleFx = (f: TanksFrame, nowMs: number) => {
        const cl = f.cl;
        const me = o.meSeat;
        for (const e of cl.fx) {
          const x = wx(e.x);
          const z = wz(e.y);
          switch (e.kind) {
            case 'fire': {
              sfx.tankFire();
              if (fxBudget < 6) {
                const a = angToRad(e.a);
                k.effects.burst(x + Math.cos(a) * 0.7, 0.55, z + Math.sin(a) * 0.7, {
                  count: k.count(6), palette: e.v === BK_RAPID ? ['#fff3a0', '#ffd23f'] : e.v === BK_MISSILE ? ['#ffb36b', '#ff7a2a'] : ['#ffffff', '#ffe28a'], speed: 3, life: 0.25, size: 0.22, gravity: 0, drag: 5,
                });
                fxBudget++;
              }
              break;
            }
            case 'bounce':
              if (nowMs - lastBounceSfx > 45) {
                lastBounceSfx = nowMs;
                sfx.tankBounce();
              }
              if (fxBudget < 6) {
                k.effects.burst(x, 0.7, z, { count: k.count(5), palette: ['#ffffff', '#cfe8ff'], speed: 2.4, life: 0.22, size: 0.16, gravity: 8, drag: 3 });
                fxBudget++;
              }
              break;
            case 'spark':
              k.effects.burst(x, 0.7, z, { count: k.count(8), palette: ['#ffffff', '#ffe28a'], speed: 3, life: 0.3, size: 0.2, gravity: 4, drag: 3 });
              break;
            case 'boom': {
              sfx.tankBoom();
              k.effects.burst(x, 0.6, z, { count: k.count(70), palette: ['#ffe27a', '#ff8a2a', '#ff4a22', '#555'], speed: 9, life: 0.95, size: 0.55, gravity: 9, drag: 1.6 });
              k.effects.ring(x, z, '#ffa23a', 0.6, 5);
              shatter(x, z);
              k.shake(e.i === me ? 0.55 : 0.22);
              break;
            }
            case 'pick': {
              if (e.i === me) sfx.tankPick();
              k.effects.ring(x, z, '#ffffff', 0.5, 3);
              break;
            }
            case 'item':
              k.effects.ring(x, z, '#ffd23f', 0.7, 3);
              break;
            case 'shield':
              sfx.tankShield();
              k.effects.ring(x, z, '#7fe9ff', 0.5, 3);
              break;
            case 'laser':
              sfx.tankLaser();
              break;
            case 'round':
              shownRound = -2;
              break;
            default:
              break;
          }
        }
        cl.fx.length = 0;
      };

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.step(now);
          const cl = f.cl;
          lastTime = time;
          fxBudget = 0;
          if (cl.round < 0) {
            k.look(camPos.copy(focus).addScaledVector(camDir, dist), focus);
            return;
          }
          if (cl.round !== shownRound) {
            buildMaze(cl);
            shownRound = cl.round;
            for (const t of tanks) {
              for (let i = 0; i < t.mats.length; i++) t.mats[i].color.copy(t.base[i]);
              t.g.scale.set(TANK_SCALE, TANK_SCALE, TANK_SCALE);
              t.turret.visible = true;
              t.fire.visible = false;
              t.wasAlive = true;
            }
          }
          handleFx(f, now);

          /* xe */
          for (let i = 0; i < o.players.length; i++) {
            const t = tanks[i];
            const alive = !!cl.alive[i];
            t.g.visible = true;
            t.g.position.set(wx(cl.rx[i]), 0, wz(cl.ry[i]));
            const ang = alive ? cl.ra[i] : cl.deadA[i] || cl.ra[i];
            t.g.rotation.y = -angToRad(ang);
            t.shield.visible = alive && !!cl.shield[i];
            if (t.shield.visible) t.shield.scale.setScalar(1 + Math.sin(time * 6) * 0.04);
            if (!alive) {
              if (t.wasAlive) {
                t.wasAlive = false;
                for (const m of t.mats) m.color.set('#23252d');
                t.turret.visible = false;
                t.g.scale.y = TANK_SCALE * 0.55;
                t.fire.visible = true;
              }
              t.fire.scale.setScalar(0.8 + Math.sin(time * 18 + i) * 0.25);
              t.smokeAt -= dt;
              if (t.smokeAt <= 0 && fxBudget < 8) {
                t.smokeAt = 0.5;
                fxBudget++;
                k.effects.burst(t.g.position.x, 0.6, t.g.position.z, { count: k.count(4), palette: ['#555', '#777'], speed: 1.0, life: 1.4, size: 0.5, gravity: -2.2, drag: 0.8, additive: false });
              }
            }
            const lab = o.labels.get(o.players[i].id);
            k.label(lab, t.g.position.x, alive ? 1.75 : 1.0, t.g.position.z);
          }

          /* đạn */
          const w = cl.world;
          const a = cl.alpha;
          let bn = 0;
          for (let b = 0; b < MAXB; b++) {
            if (!w.bAct[b] || cl.bhide[b]) continue;
            const x = wx(w.bx[b] + w.bvx[b] * a);
            const z = wz(w.by[b] + w.bvy[b] * a);
            const own = w.bown[b];
            const missile = w.bkind[b] === BK_MISSILE;
            const rapid = w.bkind[b] === BK_RAPID;
            const sc = missile ? 1.7 : rapid ? 0.8 : 1;
            m4.compose(v3.set(x, 0.62, z), q.identity(), v3s.set(sc, sc, sc));
            bulletMesh.setMatrixAt(bn, m4);
            const tmpC = lightCols[own] ?? white;
            bulletMesh.setColorAt(bn, tmpC);
            // vệt phía sau viên đạn
            const len = (missile ? 1.5 : rapid ? 0.9 : 0.7);
            const vl = Math.hypot(w.bvx[b], w.bvy[b]) || 1;
            const dx = w.bvx[b] / vl;
            const dy = w.bvy[b] / vl;
            eul.set(0, -Math.atan2(dy, dx), 0);
            q.setFromEuler(eul);
            m4.compose(v3.set(x - dx * len * 0.5, 0.62, z - dy * len * 0.5), q, v3s.set(len, 0.1 * sc, 0.1 * sc));
            trailMesh.setMatrixAt(bn, m4);
            trailMesh.setColorAt(bn, tmpC);
            bn++;
          }
          bulletMesh.count = bn;
          trailMesh.count = bn;
          bulletMesh.instanceMatrix.needsUpdate = true;
          trailMesh.instanceMatrix.needsUpdate = true;
          if (bulletMesh.instanceColor) bulletMesh.instanceColor.needsUpdate = true;
          if (trailMesh.instanceColor) trailMesh.instanceColor.needsUpdate = true;

          /* tia laze */
          let nb = 0;
          for (let li = cl.lasers.length - 1; li >= 0; li--) {
            const L = cl.lasers[li];
            const age = (now - L.born) / 1000;
            if (age > 0.45 || age < -1) {
              cl.lasers.splice(li, 1);
              continue;
            }
            // `born` theo đồng hồ khung hình của client = giờ server tại lúc nhận
            const th = 0.16 * Math.max(0.1, 1 - age / 0.45);
            for (let s = 0; s + 1 < L.n && nb < MAX_BEAM; s++) {
              const x0 = wx(L.pts[s * 2]);
              const z0 = wz(L.pts[s * 2 + 1]);
              const x1 = wx(L.pts[s * 2 + 2]);
              const z1 = wz(L.pts[s * 2 + 3]);
              const len = Math.hypot(x1 - x0, z1 - z0);
              if (len < 0.01) continue;
              eul.set(0, -Math.atan2(z1 - z0, x1 - x0), 0);
              q.setFromEuler(eul);
              m4.compose(v3.set((x0 + x1) / 2, 0.62, (z0 + z1) / 2), q, v3s.set(len, th, th));
              beamMesh.setMatrixAt(nb++, m4);
            }
          }
          beamMesh.count = nb;
          beamMesh.instanceMatrix.needsUpdate = true;

          /* vật phẩm */
          for (let s = 0; s < MAX_ITEMS; s++) {
            const it = items[s];
            const kind = cl.iKind[s];
            if (!kind) {
              it.g.visible = false;
              continue;
            }
            if (it.kind !== kind) {
              it.kind = kind;
              (it.spr.material as SpriteMaterial).map = itemTex[kind];
              (it.spr.material as SpriteMaterial).needsUpdate = true;
            }
            const c = cl.iCell[s];
            it.g.visible = true;
            it.g.position.set(wx(((c % mw) + 0.5) * CELL), 0, wz((((c / mw) | 0) + 0.5) * CELL));
            it.box.rotation.y = time * 1.6;
            it.box.position.y = 0.55 + Math.sin(time * 3 + s) * 0.1;
            it.spr.position.y = 1.35 + Math.sin(time * 3 + s) * 0.1;
          }

          /* mảnh vỡ */
          for (const d of debris) {
            if (!d.m.visible) continue;
            d.life -= dt;
            if (d.life <= 0) {
              d.m.visible = false;
              continue;
            }
            d.vy -= 16 * dt;
            d.m.position.x += d.vx * dt;
            d.m.position.z += d.vz * dt;
            d.m.position.y += d.vy * dt;
            if (d.m.position.y < 0.08) {
              d.m.position.y = 0.08;
              d.vy *= -0.3;
              d.vx *= 0.7;
              d.vz *= 0.7;
            }
            d.m.rotation.x += d.sp * dt;
            d.m.rotation.z += d.sp * dt * 0.7;
            d.m.scale.setScalar(Math.min(1, d.life * 2));
          }

          k.look(camPos.copy(focus).addScaledVector(camDir, dist), focus);
          void lastTime;
        },
        dispose() {
          floorTex.dispose();
          for (const t of itemTex) t?.dispose();
        },
      };
    },
  );
}

void MAXT;
