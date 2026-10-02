import { Color, CylinderGeometry, Euler, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { hexCenter, makeHexGrid } from '@shared/hex';
import { runScene, type LitMaterial, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { HexConfig, HexPos } from '../games/hex/useHexGame';

export interface HexFrame {
  cfg: HexConfig;
  positions: { current: Record<string, HexPos> };
  tiles: { current: string };
  jumpAt: { current: number };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number } | undefined;
  serverNow(): number;
}

export interface HexSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => HexFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
/** khoảng cách giữa hai tầng */
const GAP = 3.6;
const TILE_H = 0.5;
const CHAR_SCALE = 1.15;
const PITCH = (54 * Math.PI) / 180;
const FALL_G = 40;
/** độ cao đỉnh cú nhảy */
const JUMP_H = 1.5;
const GONE_AFTER = 1.7;
/** vị trí camera bám theo so với nhân vật của mình */
const FOLLOW_UP = 8.2;
const FOLLOW_BACK = 9.6;

/** màu mỗi tầng (tầng thấp → cao), mỗi tầng hai tông xen kẽ kiểu tổ ong */
const LAYER_COLORS: [string, string][] = [
  ['#2fd6a0', '#6ff0c6'],
  ['#ffb627', '#ffd35f'],
  ['#ff5e8a', '#ff93b3'],
];

const layerY = (l: number) => l * GAP;

export function createHexScene(o: HexSceneOptions) {
  const first = o.read();
  const cfg = first.cfg;
  const grid = makeHexGrid(cfg.radius);
  const N = grid.cells.length;
  const total = cfg.layers * N;
  const unit = cfg.size * S;
  const tileR = unit * 0.93;
  const halfW = unit * Math.sqrt(3) * (cfg.radius + 0.9);
  const halfD = unit * 1.5 * cfg.radius + unit * 1.2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [halfW, halfD], groundY: -34, ground: false },
      sun: [-9, 28, 12],
      shadowBox: 17,
    },
    (k) => {
      const { scene } = k.engine;

      // biển mây phía dưới: rơi khỏi tầng thấp nhất là chìm vào đây
      const sea = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial({ color: '#f4fbff' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -28;
      scene.add(sea);

      /* ---------------- các ô lục giác: một InstancedMesh cho cả ba tầng ---------------- */
      // mỗi tầng một mesh riêng: tầng nằm trên chỗ bạn đứng được làm mờ để không che tầm nhìn
      const geo = new CylinderGeometry(tileR, tileR, TILE_H, 6);
      const meshes: InstancedMesh[] = [];
      const mats: LitMaterial[] = [];
      for (let l = 0; l < cfg.layers; l++) {
        const mat = k.lit({ color: '#ffffff' });
        const mesh = new InstancedMesh(geo, mat, N);
        mesh.castShadow = !k.low;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
        meshes.push(mesh);
        mats.push(mat);
      }
      const opacity = new Array<number>(cfg.layers).fill(1);

      const baseX = new Float32Array(total);
      const baseZ = new Float32Array(total);
      const baseY = new Float32Array(total);
      const baseColor: Color[] = [];
      for (let l = 0; l < cfg.layers; l++) {
        const pal = LAYER_COLORS[l % LAYER_COLORS.length];
        grid.cells.forEach((c, i) => {
          const slot = l * N + i;
          const p = hexCenter(c, cfg.size);
          baseX[slot] = p.x * S;
          baseZ[slot] = p.y * S;
          baseY[slot] = layerY(l) - TILE_H / 2;
          baseColor.push(new Color(pal[(((c.q - c.r) % 3) + 3) % 3 === 0 ? 1 : 0]));
          meshes[l].setColorAt(i, baseColor[slot]);
        });
      }
      const warnA = new Color('#ff3b4e');
      const warnB = new Color('#ffffff');
      const tmpColor = new Color();

      const blank = '0'.repeat(total);
      const prev = new Uint8Array(total).fill(255);
      const changedAt = new Float64Array(total);
      const hidden = new Uint8Array(total);
      const m = new Matrix4();
      const quat = new Quaternion();
      const euler = new Euler();
      const pos = new Vector3();
      const scl = new Vector3();
      let seeded = false;
      let animating = 0;

      const updateTiles = (time: number) => {
        // chưa có gói trạng thái nào (đang đếm ngược): coi như sàn còn nguyên
        const got = o.read().tiles.current;
        const s = got.length === total ? got : blank;
        const colorsDirty = new Array<boolean>(cfg.layers).fill(false);
        let changed = false;
        for (let i = 0; i < total; i++) {
          const ch = s.charCodeAt(i) - 48;
          if (prev[i] !== ch) {
            changed = true;
            // lần đầu thấy (vào lại giữa ván): ô đã rơi thì coi như rơi từ lâu, khỏi diễn lại
            changedAt[i] = seeded ? time : ch === 2 ? -1e9 : time;
            if (seeded && ch === 2) {
              k.effects.burst(baseX[i], baseY[i] + TILE_H / 2, baseZ[i], {
                count: k.count(7),
                palette: [baseColor[i].getStyle(), '#ffffff'],
                speed: 2.2,
                life: 0.7,
                size: 0.16,
                gravity: -5,
              });
            }
            prev[i] = ch;
            if (ch === 0) {
              meshes[Math.floor(i / N)].setColorAt(i % N, baseColor[i]);
              colorsDirty[Math.floor(i / N)] = true;
            }
          }
        }
        seeded = true;
        // không ô nào đổi hay đang nháy/rơi: khỏi tính lại 500 ma trận mỗi khung hình
        if (!changed && animating === 0) return;
        animating = 0;

        for (let i = 0; i < total; i++) {
          if (hidden[i]) continue;
          const layerOf = Math.floor(i / N);
          const local = i % N;
          const ch = prev[i];
          pos.set(baseX[i], baseY[i], baseZ[i]);
          euler.set(0, 0, 0);
          let sc = 1;
          if (ch === 1) {
            animating++;
            const t = time - changedAt[i];
            pos.x += Math.sin(t * 70 + i) * 0.035;
            pos.z += Math.cos(t * 63 + i * 2) * 0.035;
            const blink = Math.sin(t * 26) > 0;
            tmpColor.copy(baseColor[i]).lerp(blink ? warnA : warnB, blink ? 0.85 : 0.55);
            meshes[layerOf].setColorAt(local, tmpColor);
            colorsDirty[layerOf] = true;
          } else if (ch === 2) {
            const t = time - changedAt[i];
            if (t > GONE_AFTER) {
              hidden[i] = 1;
              sc = 0;
            } else {
              animating++;
              pos.y -= 0.5 * FALL_G * 0.45 * t * t;
              euler.set(t * 1.3 * (i % 2 ? 1 : -1), 0, t * 0.9 * (i % 3 ? 1 : -1));
              sc = t > 1.1 ? Math.max(0, 1 - (t - 1.1) / (GONE_AFTER - 1.1)) : 1;
              if (sc === 1) {
                // đang rơi vẫn giữ màu đỏ nhạt cho dễ thấy
                tmpColor.copy(baseColor[i]).lerp(warnA, 0.35);
                meshes[layerOf].setColorAt(local, tmpColor);
                colorsDirty[layerOf] = true;
              }
            }
          }
          quat.setFromEuler(euler);
          scl.set(sc, sc, sc);
          m.compose(pos, quat, scl);
          meshes[layerOf].setMatrixAt(local, m);
        }
        for (let l = 0; l < cfg.layers; l++) {
          meshes[l].instanceMatrix.needsUpdate = true;
          const ic = meshes[l].instanceColor;
          if (colorsDirty[l] && ic) ic.needsUpdate = true;
        }
      };

      /** tầng nào đang được "nhìn": tầng của mình, hoặc (đã rơi) tầng thấp nhất còn người */
      const viewLayer = (f: HexFrame, meId: string) => {
        const mine = f.positions.current[meId];
        if (mine && mine.l >= 0) return mine.l;
        let low = cfg.layers - 1;
        for (const q of Object.values(f.positions.current)) if (q.l >= 0 && q.l < low) low = q.l;
        return low;
      };
      const fadeLayers = (dt: number, view: number) => {
        for (let l = 0; l < cfg.layers; l++) {
          const target = l > view ? 0 : 1;
          opacity[l] += (target - opacity[l]) * (1 - Math.exp(-dt * 7));
          const op = Math.abs(opacity[l] - target) < 0.01 ? target : opacity[l];
          const ghost = op < 0.995;
          mats[l].transparent = ghost;
          mats[l].opacity = op;
          mats[l].depthWrite = !ghost;
          meshes[l].castShadow = !k.low && op > 0.9;
          meshes[l].visible = op > 0.02;
        }
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
        layer: number;
        /** thời điểm bắt đầu cú nhảy hiện tại (giây của cảnh), -1 = không nhảy */
        jStart: number;
        wasJ: boolean;
        seenJumpAt: number;
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, z: 0, y: 0, vy: 0, px: 0, pz: 0, placed: false, layer: cfg.layers - 1, jStart: -1, wasJ: false, seenJumpAt: 0 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const focus = new Vector3(0, GAP * 0.85, 0);
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const camPos = new Vector3();
      const aim = new Vector3();

      return {
        frame(dt, time) {
          const f = o.read();
          f.predict(f.serverNow());
          updateTiles(time);
          fadeLayers(dt, viewLayer(f, o.meId));

          let meX = 0;
          let meZ = 0;
          const view = viewLayer(f, o.meId);
          const meAlive = !!f.positions.current[o.meId] && f.positions.current[o.meId].l >= 0;
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const sp = cfg.spawns[p.id];
            const at = f.posOf(p.id) ?? (sp ? { x: sp[0], y: sp[1] } : undefined);
            if (!at) {
              e.c.root.visible = false;
              continue;
            }
            const server = f.positions.current[p.id];
            const layer = server ? server.l : cfg.layers - 1;
            const targetY = layer >= 0 ? layerY(layer) : -80;
            const tx = at.x * S;
            const tz = at.y * S;

            if (!e.placed) {
              e.x = tx;
              e.z = tz;
              e.y = targetY;
              e.layer = layer;
              e.placed = true;
            } else if (p.id === o.meId) {
              e.x = tx;
              e.z = tz;
            } else {
              const kk = 1 - Math.exp(-dt * 14);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }

            // rơi xuống tầng dưới: nhanh dần, chạm sàn thì dừng
            if (layer < e.layer && layer >= 0) {
              k.effects.burst(e.x, layerY(layer) + 0.4, e.z, {
                count: k.count(10),
                palette: ['#ffffff', '#ffd166'],
                speed: 2.4,
                life: 0.5,
                size: 0.14,
              });
              if (p.id === o.meId) k.shake(0.25);
            }
            e.layer = layer;
            if (e.y > targetY + 0.001) {
              e.vy += FALL_G * dt;
              e.y = Math.max(targetY, e.y - e.vy * dt);
              if (e.y === targetY) e.vy = 0;
            } else {
              e.y = targetY;
              e.vy = 0;
            }
            const falling = e.y > targetY + 0.2 || layer < 0;

            // cú nhảy: mình thì vẽ ngay khi bấm, người khác theo cờ `j` của server
            if (p.id === o.meId) {
              const ja = f.jumpAt.current;
              if (ja !== e.seenJumpAt) {
                e.seenJumpAt = ja;
                e.jStart = time;
              }
            } else if (server?.j && !e.wasJ) e.jStart = time;
            e.wasJ = !!server?.j;
            let hop = 0;
            if (e.jStart >= 0 && !falling) {
              const u = (time - e.jStart) / (cfg.jumpMs / 1000);
              if (u >= 1) e.jStart = -1;
              else hop = 4 * JUMP_H * u * (1 - u);
            } else if (falling) e.jStart = -1;

            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;

            // chỉ thấy người cùng tầng hoặc ở tầng dưới (tầng trên đã bị ẩn)
            e.c.root.visible = e.y > -30 && (p.id === o.meId || e.y < layerY(view) + GAP * 0.6);
            e.c.root.position.set(e.x, e.y + hop, e.z);
            if (!falling) e.c.face(vx, vz, dt);
            e.c.update(dt, {
              speed: falling ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              time,
              pose: falling || hop > 0.05 ? 'jump' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, e.y + hop + 2.35, e.z);
            if (!e.c.root.visible) {
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
            }
            if (layer < 0 && e.y < -4) {
              const el = o.labels.get(p.id);
              if (el) el.style.opacity = '0';
            }
            if (p.id === o.meId && layer >= 0) {
              meX = e.x;
              meZ = e.z;
            }
          }

          if (meAlive) {
            // góc nhìn thứ ba: bám sau lưng, chỉ thấy tầng mình đang đứng
            aim.set(meX, layerY(view) + 0.9, meZ);
            focus.lerp(aim, 1 - Math.exp(-dt * 5));
            camPos.set(focus.x, focus.y + FOLLOW_UP, focus.z + FOLLOW_BACK);
          } else {
            // đã rơi: quay về toàn cảnh tầng thấp nhất còn người để xem tiếp
            aim.set(0, layerY(view) + 0.5, 0);
            focus.lerp(aim, 1 - Math.exp(-dt * 2.5));
            const dist = k.fit(halfW + 1.0, halfD + 1.6, PITCH) * 1.06;
            camPos.copy(focus).addScaledVector(camDir, dist);
          }
          k.look(camPos, focus);
        },
      };
    },
  );
}
