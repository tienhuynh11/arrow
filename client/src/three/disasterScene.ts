import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import { sfx } from '../utils/sound';
import {
  CRACK_WARN,
  GRID,
  HALF,
  HSTEP,
  K_QUAKE,
  K_TORNADO,
  MET_KILL_R,
  MET_WARN,
  QUAKE_LIFE,
  QUAKE_PRE,
  QUAKE_V,
  TICK_HZ,
  TORN_KILL,
  TORN_PULL,
  TS,
} from '@shared/disaster';
import { FL_AIR, FL_WON, type DisasterClient } from '@shared/disasterClient';

export interface DisasterFrame {
  cl: DisasterClient;
  /** dự đoán + nội suy tới giờ server hiện tại */
  step(now: number): void;
  serverNow(): number;
}

export interface DisasterSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  /** theo thứ tự ghế trong arena */
  players: { id: string; color: string }[];
  meSeat: number;
  read: () => DisasterFrame;
  labels: Map<string, HTMLElement | null>;
}

const PITCH = (58 * Math.PI) / 180;
const CHAR_SCALE = 1.0;
const MAX_MET = 12;
const MAX_PULSE = 3;
const TORN_LAYERS = 7;

/** [nền trời, mặt đất thấp, mặt đất cao, hố sâu] theo chủ đề địa hình */
const THEMES = [
  ['#9fd4ff', '#6fcf6a', '#d7f08a', '#35502f'],
  ['#ffd9a0', '#e8c070', '#fff0b8', '#6b4a22'],
  ['#cfe6ff', '#d6e6f2', '#ffffff', '#506680'],
  ['#4a1c20', '#5a4048', '#c8665a', '#2a0c0c'],
];

export function createDisasterScene(o: DisasterSceneOptions) {
  const n = o.players.length;
  const cells = GRID * GRID;

  return runScene(
    o.host,
    o.hooks,
    {
      background: '#9fd4ff',
      fog: [45, 120],
      sun: [10, 26, 12],
      shadowBox: HALF + 3,
    },
    (k) => {
      const { scene } = k.engine;

      /* ---------------- nền hố sâu ---------------- */
      const abyss = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({ color: THEMES[0][3] }));
      abyss.rotation.x = -Math.PI / 2;
      abyss.position.y = -14;
      scene.add(abyss);

      /* ---------------- sàn: 144 ô ---------------- */
      const tiles = new InstancedMesh(new BoxGeometry(1, 1, 1), k.lit({ color: '#ffffff' }), cells);
      tiles.castShadow = !k.low;
      tiles.receiveShadow = true;
      tiles.frustumCulled = false;
      scene.add(tiles);
      const cx = new Float32Array(cells);
      const cz = new Float32Array(cells);
      for (let i = 0; i < cells; i++) {
        cx[i] = ((i % GRID) + 0.5) * TS - HALF;
        cz[i] = (Math.floor(i / GRID) + 0.5) * TS - HALF;
      }
      const baseCol = new Array<Color>(cells);
      for (let i = 0; i < cells; i++) baseCol[i] = new Color();
      const warnTint = new Uint8Array(cells);
      const tmpC = new Color();
      const RED = new Color('#ff3b30');
      const m4 = new Matrix4();
      const quat = new Quaternion();
      const euler = new Euler();
      const pos = new Vector3();
      const scl = new Vector3();

      /* ---------------- nước ---------------- */
      const waterMat = new MeshBasicMaterial({ color: '#3a9be8', transparent: true, opacity: 0.62, depthWrite: false });
      const water = new Mesh(new PlaneGeometry(HALF * 2 + 6, HALF * 2 + 6), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.visible = false;
      scene.add(water);

      /* ---------------- thiên thạch ---------------- */
      const markGeo = new CircleGeometry(1, 30);
      const rimGeo = new RingGeometry(0.88, 1, 40);
      const fireGeo = new SphereGeometry(0.8, 12, 10);
      const trailGeo = new CylinderGeometry(0.05, 0.7, 7, 8, 1, true);
      interface MetSlot {
        mark: Mesh;
        rim: Mesh;
        fire: Group;
      }
      const mets: MetSlot[] = [];
      for (let i = 0; i < MAX_MET; i++) {
        const mark = new Mesh(markGeo, new MeshBasicMaterial({ color: '#ff3030', transparent: true, opacity: 0.3, depthWrite: false, depthTest: false }));
        mark.rotation.x = -Math.PI / 2;
        mark.renderOrder = 5;
        const rim = new Mesh(rimGeo, new MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: DoubleSide }));
        rim.rotation.x = -Math.PI / 2;
        rim.renderOrder = 6;
        const fire = new Group();
        fire.add(new Mesh(fireGeo, new MeshBasicMaterial({ color: '#ffb02e' })));
        const trail = new Mesh(trailGeo, new MeshBasicMaterial({ color: '#ff6a1a', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
        trail.position.y = 3.6;
        fire.add(trail);
        mark.visible = rim.visible = fire.visible = false;
        scene.add(mark, rim, fire);
        mets.push({ mark, rim, fire });
      }

      /* ---------------- động đất ---------------- */
      const pulseGeo = new RingGeometry(0.9, 1, 64);
      const pulses: { ring: Mesh; core: Mesh }[] = [];
      for (let i = 0; i < MAX_PULSE; i++) {
        const ring = new Mesh(pulseGeo, new MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, side: DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 6;
        const core = new Mesh(markGeo, new MeshBasicMaterial({ color: '#ffb300', transparent: true, opacity: 0.35, depthWrite: false, depthTest: false }));
        core.rotation.x = -Math.PI / 2;
        core.renderOrder = 5;
        ring.visible = core.visible = false;
        scene.add(ring, core);
        pulses.push({ ring, core });
      }

      /* ---------------- lốc xoáy ---------------- */
      const tornLayers = k.low ? 4 : TORN_LAYERS;
      interface Torn {
        g: Group;
        layers: Mesh[];
        zone: Mesh;
      }
      const torns: Torn[] = [];
      for (let t = 0; t < 3; t++) {
        const g = new Group();
        const layers: Mesh[] = [];
        for (let i = 0; i < tornLayers; i++) {
          const h = 8.5 / tornLayers;
          const rb = 0.5 + (i / tornLayers) * 2.6;
          const rt = 0.5 + ((i + 1) / tornLayers) * 2.6;
          const m = new Mesh(
            new CylinderGeometry(rt, rb, h, 18, 1, true),
            new MeshBasicMaterial({ color: i % 2 ? '#b9c2cf' : '#8b95a5', transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }),
          );
          m.position.y = h * (i + 0.5);
          g.add(m);
          layers.push(m);
        }
        const zone = new Mesh(rimGeo, new MeshBasicMaterial({ color: '#c8d3e6', transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, side: DoubleSide }));
        zone.rotation.x = -Math.PI / 2;
        zone.scale.setScalar(TORN_PULL);
        zone.renderOrder = 4;
        g.visible = false;
        zone.visible = false;
        scene.add(g, zone);
        torns.push({ g, layers, zone });
      }

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        y: number;
        z: number;
        px: number;
        pz: number;
        deadAt: number;
        placed: boolean;
      }
      const chars: Entry[] = [];
      for (let i = 0; i < n; i++) {
        const c = k.kit.create(o.players[i].color, i === o.meSeat);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.push({ c, x: 0, y: 0, z: 0, px: 0, pz: 0, deadAt: -1, placed: false });
      }
      k.onTier((tier) => {
        for (const e of chars) e.c.setShadows(tier !== 'low');
      });
      const meRing = new Mesh(new RingGeometry(0.55, 0.72, 28), new MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.95, side: DoubleSide, depthTest: false }));
      meRing.rotation.x = -Math.PI / 2;
      meRing.renderOrder = 7;
      scene.add(meRing);

      /* ---------------- camera ---------------- */
      const focus = new Vector3(0, 0.6, 0.5);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const dist = k.fit(HALF + 1.2, HALF + 2.2, PITCH) * 1.04;

      /* ---------------- trạng thái dựng ---------------- */
      let loadedRound = -1;
      let loadedBase = -1;
      let tilesDirty = true;
      let fxMet = 0;
      let fxPulse = 0;
      const out = new Float64Array(3);
      let lastPhaseSfx = -1;

      const loadRound = (cl: DisasterClient) => {
        const w = cl.w;
        const th = THEMES[w.theme];
        const sky = new Color(th[0]);
        scene.background = sky;
        if (scene.fog) scene.fog.color.copy(sky);
        (abyss.material as MeshBasicMaterial).color.set(th[3]);
        const lo = new Color(th[1]);
        const hi = new Color(th[2]);
        for (let i = 0; i < cells; i++) {
          const h = w.heights[i];
          baseCol[i].copy(lo).lerp(hi, h / 3);
          // bàn cờ nhẹ để dễ đoán khoảng cách khi chạy
          if (((i % GRID) + Math.floor(i / GRID)) % 2) baseCol[i].multiplyScalar(0.93);
          tiles.setColorAt(i, baseCol[i]);
          warnTint[i] = 0;
        }
        if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
        loadedRound = cl.round;
        loadedBase = cl.base;
        tilesDirty = true;
        const lt = cl.sim.tick - cl.base;
        fxMet = w.nMet > 0 ? w.mFirst[Math.max(0, Math.min(w.mFirst.length - 1, Math.floor(lt)))] : 0;
        fxPulse = 0;
        for (let i = 0; i < w.nPulse; i++) if (w.pulseT[i] <= lt) fxPulse = i + 1;
        lastPhaseSfx = -1;
      };

      const updateTiles = (cl: DisasterClient, local: number, time: number) => {
        const w = cl.w;
        let busy = false;
        let colorsChanged = false;
        for (let i = 0; i < cells; i++) {
          const ft = w.fallTick[i];
          const h = w.heights[i];
          const top = h * HSTEP;
          const sy = top + 3;
          let px = cx[i];
          let py = top - sy / 2;
          let pz = cz[i];
          let sc = 1;
          euler.set(0, 0, 0);
          let tint = 0;
          if (ft < 0x7fffffff) {
            const dtk = local - ft;
            if (dtk >= 0) {
              const t = dtk / TICK_HZ;
              if (t > 1.6) sc = 0;
              else {
                py -= 0.5 * 18 * t * t;
                euler.set(t * 1.3 * (i % 2 ? 1 : -1), 0, t * 1.0 * (i % 3 ? 1 : -1));
                busy = true;
              }
              tint = 2;
            } else if (dtk > -CRACK_WARN) {
              const a = 1 + dtk / CRACK_WARN;
              const sh = 0.03 + a * 0.07;
              px += Math.sin(time * 55 + i) * sh;
              pz += Math.cos(time * 47 + i * 2) * sh;
              tint = 1;
              busy = true;
              const f = 0.25 + 0.5 * a * (0.5 + 0.5 * Math.sin(time * 18));
              tmpC.copy(baseCol[i]).lerp(RED, f);
              tiles.setColorAt(i, tmpC);
              colorsChanged = true;
            }
          }
          if (tint !== 1 && warnTint[i] === 1) {
            tiles.setColorAt(i, baseCol[i]);
            colorsChanged = true;
          }
          warnTint[i] = tint;
          quat.setFromEuler(euler);
          m4.compose(pos.set(px, py, pz), quat, scl.set(TS * 0.97 * sc, sy * sc, TS * 0.97 * sc));
          tiles.setMatrixAt(i, m4);
        }
        tiles.instanceMatrix.needsUpdate = true;
        if (colorsChanged && tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
        tilesDirty = busy;
      };

      const groundAt = (cl: DisasterClient, local: number, x: number, y: number) => {
        const g = cl.w.groundZ(local, x, y);
        return g < -100 ? 0 : g;
      };

      return {
        frame(dt, time) {
          const fr = o.read();
          const now = fr.serverNow();
          fr.step(now);
          const cl = fr.cl;
          if (cl.round !== loadedRound || cl.base !== loadedBase) loadRound(cl);
          const w = cl.w;
          const local = cl.localTick(now);
          const L = Math.floor(local);
          const live = !cl.inter;

          /* sàn: chỉ cập nhật khi có ô nứt/rơi */
          {
            // quét nhanh để biết có ô nào đang trong cửa sổ cảnh báo / rơi không
            let any = tilesDirty;
            if (!any) {
              for (let i = 0; i < cells; i++) {
                const ft = w.fallTick[i];
                if (ft < 0x7fffffff && local > ft - CRACK_WARN - 2 && local < ft + 120) {
                  any = true;
                  break;
                }
              }
            }
            if (any) updateTiles(cl, local, time);
          }

          /* nước */
          const lv = w.water(local);
          if (lv > 0.01) {
            water.visible = true;
            water.position.y = lv * HSTEP - 0.06 + Math.sin(time * 2) * 0.03;
            waterMat.opacity = 0.55 + Math.sin(time * 1.3) * 0.05;
          } else water.visible = false;

          /* thiên thạch: vòng đỏ báo trước + quả cầu lửa */
          let slot = 0;
          if (w.nMet > 0) {
            const i0 = w.mFirst[Math.max(0, Math.min(w.mFirst.length - 1, L))];
            for (let i = i0; i < w.nMet && slot < MAX_MET; i++) {
              const left = w.mTick[i] - local;
              if (left > MET_WARN) break;
              const s = mets[slot++];
              const mx = w.mX[i];
              const my = w.mY[i];
              const gy = groundAt(cl, local, mx, my);
              const u = 1 - left / MET_WARN;
              s.mark.visible = s.rim.visible = true;
              s.mark.position.set(mx, gy + 0.06, my);
              s.rim.position.set(mx, gy + 0.07, my);
              s.mark.scale.setScalar(MET_KILL_R * (0.35 + 0.65 * u));
              s.rim.scale.setScalar(MET_KILL_R);
              (s.mark.material as MeshBasicMaterial).opacity = 0.18 + 0.5 * u * (0.7 + 0.3 * Math.sin(time * (10 + u * 20)));
              const fp = 1 - left / 55;
              if (fp > 0 && fp < 1) {
                s.fire.visible = true;
                s.fire.position.set(mx + (1 - fp) * 12, gy + (1 - fp) * 26, my - (1 - fp) * 10);
                s.fire.rotation.set(0.0, 0, -0.42);
              } else s.fire.visible = false;
            }
          }
          for (let i = slot; i < MAX_MET; i++) mets[i].mark.visible = mets[i].rim.visible = mets[i].fire.visible = false;
          // nổ đúng tick rơi
          while (w.nMet > 0 && fxMet < w.nMet && w.mTick[fxMet] <= local) {
            const i = fxMet++;
            if (local - w.mTick[i] > 40) continue;
            const mx = w.mX[i];
            const my = w.mY[i];
            const gy = groundAt(cl, local, mx, my);
            k.effects.burst(mx, gy + 0.3, my, { count: k.count(46), palette: ['#ffcf3a', '#ff7a1a', '#ff3b1a', '#5a3a2a'], speed: 11, life: 0.9, size: 0.35 });
            k.effects.ring(mx, my, '#ffb347', 0.5, MET_KILL_R * 1.5);
            const dx = (cl.sim.s[0] - mx) * (cl.sim.s[0] - mx) + (cl.sim.s[1] - my) * (cl.sim.s[1] - my);
            k.shake(dx < 100 ? 0.7 : 0.35);
            sfx.dzBoom();
          }

          /* động đất */
          const qp = w.phaseOf[K_QUAKE];
          let ps = 0;
          if (w.nPulse > 0) {
            for (let i = 0; i < w.nPulse && ps < MAX_PULSE; i++) {
              const age = local - w.pulseT[i];
              if (age < -QUAKE_PRE || age > QUAKE_LIFE) continue;
              const p = pulses[ps++];
              const gy = 0.25;
              p.ring.visible = p.core.visible = true;
              p.ring.position.set(w.pulseX[i], gy, w.pulseY[i]);
              p.core.position.set(w.pulseX[i], gy - 0.02, w.pulseY[i]);
              if (age < 0) {
                const u = 1 + age / QUAKE_PRE;
                p.ring.scale.setScalar(0.6 + 1.2 * u);
                p.core.scale.setScalar(0.5 + 1.0 * u);
                (p.ring.material as MeshBasicMaterial).opacity = 0.4 + 0.5 * Math.sin(time * 24) * 0.5 + 0.1;
                (p.core.material as MeshBasicMaterial).opacity = 0.2 + 0.3 * u;
              } else {
                const r = age * QUAKE_V + 0.6;
                p.ring.scale.setScalar(r);
                p.core.scale.setScalar(0.001);
                (p.ring.material as MeshBasicMaterial).opacity = Math.max(0, 0.9 - age / QUAKE_LIFE);
              }
            }
          }
          for (let i = ps; i < MAX_PULSE; i++) pulses[i].ring.visible = pulses[i].core.visible = false;
          while (fxPulse < w.nPulse && w.pulseT[fxPulse] <= local) {
            const i = fxPulse++;
            if (local - w.pulseT[i] > 40) continue;
            k.shake(0.6);
            sfx.dzQuake();
          }
          if (qp >= 0 && local >= w.pWarn[qp] && local < w.pEnd[qp]) k.shake(local < w.pAct[qp] ? 0.06 : 0.12);

          /* lốc xoáy */
          const tp = w.phaseOf[K_TORNADO];
          for (let t = 0; t < 3; t++) {
            const T = torns[t];
            if (tp < 0 || t >= w.nTorn) {
              T.g.visible = T.zone.visible = false;
              continue;
            }
            const sc = w.tornado(t, local);
            if (sc <= 0.01) {
              T.g.visible = T.zone.visible = false;
              continue;
            }
            const active = local >= w.pAct[tp];
            T.g.visible = true;
            T.zone.visible = true;
            const gy = groundAt(cl, local, w.tx, w.ty);
            T.g.position.set(w.tx, gy, w.ty);
            T.zone.position.set(w.tx, gy + 0.08, w.ty);
            T.g.scale.set(sc, 0.4 + 0.6 * sc, sc);
            (T.zone.material as MeshBasicMaterial).opacity = active ? 0.28 : 0.15 + 0.15 * Math.sin(time * 10);
            T.zone.scale.setScalar(TORN_PULL * Math.max(0.2, sc));
            for (let i = 0; i < T.layers.length; i++) {
              T.layers[i].rotation.y = time * (3 + i * 0.7) * (i % 2 ? 1 : -1);
              T.layers[i].position.x = Math.sin(time * 2.2 + i * 0.8) * 0.18 * (i + 1);
            }
            void TORN_KILL;
          }

          /* nhân vật */
          for (let i = 0; i < n; i++) {
            const e = chars[i];
            let flags: number;
            if (i === o.meSeat) {
              cl.renderMe(now, out);
              flags = cl.flags[i];
              if (!cl.alive) flags = (flags & ~7) | (cl.deathCause & 7);
              if (cl.airborne) flags |= FL_AIR;
            } else flags = cl.renderOther(i, now, out);
            const dead = (flags & 7) !== 0;
            e.x = out[0];
            e.z = out[1];
            e.y = out[2];
            if (!e.placed) {
              e.px = e.x;
              e.pz = e.z;
              e.placed = true;
            }
            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;
            if (dead && e.deadAt < 0) {
              e.deadAt = time;
              if (((flags & 7) === 1 || (flags & 7) === 2) && live) {
                k.effects.burst(e.x, e.y + 0.8, e.z, { count: k.count(26), palette: ['#ffffff', '#ffd166', o.players[i].color], speed: 6, life: 0.7, size: 0.28 });
              }
              if ((flags & 7) === 3) k.effects.ring(e.x, e.z, '#8fd0ff', 0.7, 2.4);
            } else if (!dead) e.deadAt = -1;
            const gone = dead && e.deadAt >= 0 && time - e.deadAt > 2.6 && (flags & 7) !== 4;
            e.c.root.visible = !gone && e.y > -9;
            e.c.root.position.set(e.x, e.y, e.z);
            const sink = dead && (flags & 7) === 3 ? Math.min(1, (time - e.deadAt) / 1.2) : 0;
            if (sink > 0) e.c.root.position.y -= sink * 0.9;
            const speed = Math.min(1, Math.hypot(vx, vz) / 7);
            if (!dead && speed > 0.05) e.c.face(vx, vz, dt);
            const won = (flags & FL_WON) !== 0;
            e.c.update(dt, {
              speed: dead ? 0 : speed,
              dead,
              time,
              pose: dead ? 'idle' : won ? 'cheer' : (flags & FL_AIR) !== 0 ? 'jump' : 'run',
            });
            const el = o.labels.get(o.players[i].id);
            k.label(el, e.x, e.y + 2.15, e.z);
            if (el) el.style.opacity = e.c.root.visible ? (dead ? '0.45' : '') : '0';
            if (i === o.meSeat) {
              meRing.visible = !dead;
              meRing.position.set(e.x, e.y + 0.07, e.z);
              meRing.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
            }
          }

          /* chuyển pha → còi báo */
          const ph = w.phaseAt(local);
          if (ph !== lastPhaseSfx) {
            if (ph >= 0 && lastPhaseSfx !== -2 && local < w.pAct[ph] + 5) sfx.dzAlarm();
            lastPhaseSfx = ph;
          }

          camPos.copy(focus).addScaledVector(camDir, dist);
          k.look(camPos, focus);
        },
        dispose() {
          markGeo.dispose();
          rimGeo.dispose();
          fireGeo.dispose();
          trailGeo.dispose();
          pulseGeo.dispose();
        },
      };
    },
  );
}
