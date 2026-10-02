import { BoxGeometry, Color, Euler, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { MmConfig, MmPos, MmRound } from '../games/memory/useMemoryGame';
import { MM_SYMBOLS, drawHidden, drawSymbol } from '../games/memory/symbols';

export interface MemoryFrame {
  cfg: MmConfig;
  positions: { current: Record<string, MmPos> };
  round: { current: MmRound };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number } | undefined;
  serverNow(): number;
}

export interface MemorySceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => MemoryFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const CHAR_SCALE = 1.05;
const PITCH = (58 * Math.PI) / 180;
const FALL_G = 36;
const TILE_FALL_G = 22;
const GONE_AFTER = 1.5;
const FLIP_S = 0.35;
/** chỉ số "ô úp" trong dãy mesh hình */
const HIDDEN = MM_SYMBOLS.length;

export function createMemoryScene(o: MemorySceneOptions) {
  const cfg = o.read().cfg;
  const n = cfg.n;
  const cells = n * n;
  const tile = cfg.size * S;
  const half = (n * tile) / 2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [half + 1, half + 1], groundY: -34, ground: false },
      sun: [-8, 24, 10],
      shadowBox: half + 4,
    },
    (k) => {
      const { scene } = k.engine;

      const sea = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial({ color: '#f4fbff' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -26;
      scene.add(sea);

      /* ---------------- các ô nền (caro sáng) ---------------- */
      const tiles = new InstancedMesh(new BoxGeometry(tile * 0.97, 0.4, tile * 0.97), k.lit({ color: '#ffffff' }), cells);
      tiles.castShadow = !k.low;
      tiles.receiveShadow = true;
      tiles.frustumCulled = false;
      scene.add(tiles);

      /* ---------------- hình trên mặt ô: mỗi hình một InstancedMesh + một mesh cho ô úp ---------------- */
      const decalGeo = new PlaneGeometry(tile * 0.8, tile * 0.8);
      const decals: InstancedMesh[] = [];
      for (let s = 0; s <= HIDDEN; s++) {
        const tex = k.texture(128, 128, (g, w) => (s === HIDDEN ? drawHidden(g, w) : drawSymbol(g, s, w)));
        const mesh = new InstancedMesh(decalGeo, new MeshBasicMaterial({ map: tex, transparent: true }), cells);
        mesh.frustumCulled = false;
        mesh.count = 0;
        scene.add(mesh);
        decals.push(mesh);
      }

      const baseX = new Float32Array(cells);
      const baseZ = new Float32Array(cells);
      const pale = [new Color('#fdfdff'), new Color('#dcecff')];
      for (let i = 0; i < cells; i++) {
        const cx = i % n;
        const cy = Math.floor(i / n);
        baseX[i] = (cx + 0.5) * tile - half;
        baseZ[i] = (cy + 0.5) * tile - half;
        tiles.setColorAt(i, pale[(cx + cy) % 2]);
      }
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;

      const symOf = new Uint8Array(cells);
      const appearAt = new Float64Array(cells);
      const fallAt = new Float64Array(cells).fill(-1);
      const gone = new Uint8Array(cells);
      const meshOf = new Uint8Array(cells);
      const slotOf = new Uint16Array(cells);
      let flipAt = -1e9;

      let shown = -1;
      let shownPattern = '';
      let faceDown = false;
      let animating = 1;
      const m = new Matrix4();
      const quat = new Quaternion();
      const quatD = new Quaternion();
      const flatQ = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
      const euler = new Euler();
      const pos = new Vector3();
      const posD = new Vector3();
      const scl = new Vector3();
      const sclD = new Vector3();

      /** xếp lại ô nào dùng mesh hình nào (theo ngửa/úp) */
      const assign = () => {
        const counts = new Array(HIDDEN + 1).fill(0);
        for (let i = 0; i < cells; i++) {
          const mi = faceDown ? HIDDEN : symOf[i];
          meshOf[i] = mi;
          slotOf[i] = counts[mi]++;
        }
        for (let s = 0; s <= HIDDEN; s++) decals[s].count = counts[s];
        animating = 1;
      };

      const loadRound = (rd: BpLike, time: number, fresh: boolean) => {
        for (let i = 0; i < cells; i++) {
          symOf[i] = Number(rd.pattern[i]);
          appearAt[i] = fresh ? -1e9 : time + Math.random() * 0.3;
          fallAt[i] = -1;
          gone[i] = 0;
        }
        shown = rd.r;
        shownPattern = rd.pattern;
        faceDown = false;
        assign();
      };

      const updateTiles = (time: number, serverNow: number, rd: BpLike) => {
        // tới giờ chốt: ô sai hình bắt đầu rơi
        if (rd.target >= 0 && serverNow >= rd.dropAt) {
          for (let i = 0; i < cells; i++) {
            if (symOf[i] !== rd.target && fallAt[i] < 0 && !gone[i]) {
              // vào lại muộn thì coi như rơi từ lâu
              fallAt[i] = serverNow - rd.dropAt > 2500 ? -1e9 : time - Math.max(0, serverNow - rd.dropAt) / 1000;
              animating = 1;
            }
          }
        }
        if (!animating) return;
        let busy = false;
        const fu = (time - flipAt) / FLIP_S;
        const flip = fu >= 0 && fu < 1 ? 1 + 0.2 * Math.sin(fu * Math.PI) : 1;
        if (fu >= 0 && fu < 1) busy = true;
        for (let i = 0; i < cells; i++) {
          if (gone[i]) continue;
          pos.set(baseX[i], -0.2, baseZ[i]);
          euler.set(0, 0, 0);
          let sc = 1;
          const ap = time - appearAt[i];
          if (ap < 0) {
            sc = 0;
            busy = true;
          } else if (ap < 0.35) {
            const u = ap / 0.35;
            sc = 1 - Math.pow(1 - u, 3) * 0.9 - (1 - u) * 0.1;
            busy = true;
          }
          if (fallAt[i] > -1) {
            const t = time - fallAt[i];
            if (t > GONE_AFTER) {
              gone[i] = 1;
              sc = 0;
            } else {
              busy = true;
              pos.y -= 0.5 * TILE_FALL_G * t * t;
              euler.set(t * 1.5 * (i % 2 ? 1 : -1), 0, t * 1.1 * (i % 3 ? 1 : -1));
              if (t > 1) sc = Math.max(0, 1 - (t - 1) / (GONE_AFTER - 1));
            }
          }
          quat.setFromEuler(euler);
          m.compose(pos, quat, scl.set(sc, sc * flip, sc));
          tiles.setMatrixAt(i, m);

          // hình nằm sát mặt trên của ô, đi theo ô khi ô rơi
          posD.set(pos.x, pos.y + 0.22, pos.z);
          quatD.copy(quat).multiply(flatQ);
          const sd = sc * flip;
          m.compose(posD, quatD, sclD.set(sd, sd, sd));
          decals[meshOf[i]].setMatrixAt(slotOf[i], m);
        }
        tiles.instanceMatrix.needsUpdate = true;
        for (const d of decals) d.instanceMatrix.needsUpdate = true;
        animating = busy ? 1 : 0;
      };

      /* ---------------- nhân vật ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        y: number;
        vy: number;
        px: number;
        pz: number;
        placed: boolean;
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, z: 0, y: 0, vy: 0, px: 0, pz: 0, placed: false });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      // lệch tầm nhìn về phía xa để sàn nằm thấp hơn, chừa chỗ cho ô "hình cần tìm" phía trên
      const focus = new Vector3(0, 0.2, -half * 0.06);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const dist = k.fit(half + 0.6, half + 1.2, PITCH) * 1.16;
      let first = true;

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const rd = f.round.current;
          if (rd.r !== shown || rd.pattern !== shownPattern) {
            // vòng đầu, hoặc vào lại giữa ván → hiện luôn; vòng mới trong ván → nhô lên
            loadRound(rd, time, first && now >= rd.hideAt - 200);
            if (first && now < rd.hideAt - 200) for (let i = 0; i < cells; i++) appearAt[i] = -1e9;
            if (first && now >= rd.hideAt) faceDown = false;
            first = false;
          }
          // tới giờ úp: lật cả sàn
          const wantDown = now >= rd.hideAt;
          if (wantDown !== faceDown) {
            faceDown = wantDown;
            flipAt = time;
            assign();
          }
          updateTiles(time, now, rd);

          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const sp = cfg.spawns[p.id];
            const at = f.posOf(p.id) ?? (sp ? { x: sp[0], y: sp[1] } : undefined);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const out = !!f.positions.current[p.id]?.out;
            const tx = at.x * S;
            const tz = at.y * S;
            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.placed = true;
            } else if (p.id === o.meId) {
              e.x = tx;
              e.z = tz;
            } else {
              const kk = 1 - Math.exp(-dt * 14);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }
            if (out) {
              e.vy += FALL_G * dt;
              e.y -= e.vy * dt;
            } else {
              e.y = 0;
              e.vy = 0;
            }
            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;

            e.c.root.visible = e.y > -24;
            e.c.root.position.set(e.x, e.y, e.z);
            if (!out) e.c.face(vx, vz, dt);
            e.c.update(dt, {
              speed: out ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              time,
              pose: out ? 'jump' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, e.y + 2.2, e.z);
            if (out && e.y < -3) {
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
            }
          }

          camPos.copy(focus).addScaledVector(camDir, dist);
          k.look(camPos, focus);
        },
      };
    },
  );
}

type BpLike = MmRound;
