import { BoxGeometry, Color, CylinderGeometry, Euler, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { TtConfig, TtPos } from '../games/tiptoe/useTipToeGame';

export interface TipToeFrame {
  cfg: TtConfig;
  positions: { current: Record<string, TtPos> };
  broken: { current: string };
  kickFx: { current: { by: string; hits: string[]; x: number; y: number }[] };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number } | undefined;
  serverNow(): number;
}

export interface TipToeSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => TipToeFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const CHAR_SCALE = 1.05;
const PITCH = (58 * Math.PI) / 180;
const FALL_G = 36;
const TILE_FALL_G = 24;
const GONE_AFTER = 1.4;
const FOLLOW_UP = 6.2;
const FOLLOW_BACK = 7.4;

export function createTipToeScene(o: TipToeSceneOptions) {
  const cfg = o.read().cfg;
  const { cols, rows } = cfg;
  const cells = cols * rows;
  const tile = cfg.size * S;
  const halfW = (cols * tile) / 2;
  const length = rows * tile;
  const startD = cfg.startDepth * S;
  const finishD = cfg.finishDepth * S;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [halfW + 2, length / 2 + startD], groundY: -34, ground: false },
      sun: [-8, 24, 10],
      shadowBox: 9,
    },
    (k) => {
      const { scene } = k.engine;

      // vực sâu phía dưới: màu xanh đậm để ô vỡ lộ ra lỗ trống rõ ràng, không lẫn với nền trời
      const sea = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial({ color: '#3f86d6' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -26;
      scene.add(sea);

      /* ---------------- bệ xuất phát + bệ đích ---------------- */
      const startPad = new Mesh(new BoxGeometry(halfW * 2, 0.5, startD), k.lit({ color: '#ff8fb1' }));
      startPad.position.set(0, -0.25, startD / 2);
      startPad.receiveShadow = true;
      scene.add(startPad);

      const finTex = k.texture(256, 128, (g, w, h) => {
        const n = 16;
        const sq = w / n;
        for (let y = 0; y < h / sq; y++) {
          for (let x = 0; x < n; x++) {
            g.fillStyle = (x + y) % 2 ? '#2b2540' : '#ffffff';
            g.fillRect(x * sq, y * sq, sq + 1, sq + 1);
          }
        }
      });
      const finishPad = new Mesh(new BoxGeometry(halfW * 2, 0.5, finishD), [
        k.lit({ color: '#ffd23f' }),
        k.lit({ color: '#ffd23f' }),
        k.lit({ map: finTex }),
        k.lit({ color: '#ffd23f' }),
        k.lit({ color: '#ffd23f' }),
        k.lit({ color: '#ffd23f' }),
      ]);
      finishPad.position.set(0, -0.25, -length - finishD / 2);
      finishPad.receiveShadow = true;
      scene.add(finishPad);

      // cổng đích: hai cột + biển ca-rô
      for (const sx of [-1, 1]) {
        const post = new Mesh(new CylinderGeometry(0.16, 0.2, 2.6, 16), k.lit({ color: '#ff5e8a' }));
        post.position.set(sx * (halfW - 0.2), 1.3, -length - 0.3);
        post.castShadow = !k.low;
        scene.add(post);
      }
      const banner = new Mesh(new BoxGeometry(halfW * 2 - 0.2, 0.55, 0.2), k.lit({ map: finTex }));
      banner.position.set(0, 2.45, -length - 0.3);
      banner.castShadow = !k.low;
      scene.add(banner);

      /* ---------------- sàn kính: mọi ô nhìn y hệt nhau, ô giả sẽ vỡ khi bị giẫm ---------------- */
      const tiles = new InstancedMesh(
        new BoxGeometry(tile * 0.94, 0.3, tile * 0.94),
        k.lit({ color: '#ffffff', transparent: true, opacity: 0.82 }),
        cells,
      );
      tiles.castShadow = false;
      tiles.receiveShadow = true;
      tiles.frustumCulled = false;
      scene.add(tiles);

      const baseX = new Float32Array(cells);
      const baseZ = new Float32Array(cells);
      const glass = [new Color('#c6ebff'), new Color('#e3f6ff')];
      for (let i = 0; i < cells; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        baseX[i] = (c + 0.5) * tile - halfW;
        baseZ[i] = -(r + 0.5) * tile;
        tiles.setColorAt(i, glass[(r + c) % 2]);
      }
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;

      const fallAt = new Float64Array(cells).fill(-1);
      const gone = new Uint8Array(cells);
      const seen = new Uint8Array(cells);
      let animating = 1;
      let firstSync = true;
      const m = new Matrix4();
      const quat = new Quaternion();
      const euler = new Euler();
      const pos = new Vector3();
      const scl = new Vector3();

      const syncTiles = (time: number, brokenStr: string) => {
        for (let i = 0; i < cells; i++) {
          if (brokenStr.charCodeAt(i) === 49 && !seen[i]) {
            seen[i] = 1;
            // vào lại giữa ván: ô đã vỡ từ trước thì biến mất luôn
            if (firstSync) gone[i] = 1;
            else fallAt[i] = time;
            animating = 1;
          }
        }
        firstSync = false;
        if (!animating) return;
        let busy = false;
        for (let i = 0; i < cells; i++) {
          pos.set(baseX[i], -0.15, baseZ[i]);
          euler.set(0, 0, 0);
          let sc = 1;
          if (gone[i]) sc = 0;
          else if (fallAt[i] >= 0) {
            const t = time - fallAt[i];
            if (t > GONE_AFTER) {
              gone[i] = 1;
              sc = 0;
            } else {
              busy = true;
              pos.y -= 0.5 * TILE_FALL_G * t * t;
              euler.set(t * 1.6 * (i % 2 ? 1 : -1), 0, t * 1.2 * (i % 3 ? 1 : -1));
              if (t > 0.9) sc = Math.max(0, 1 - (t - 0.9) / (GONE_AFTER - 0.9));
            }
          }
          quat.setFromEuler(euler);
          m.compose(pos, quat, scl.set(sc, sc, sc));
          tiles.setMatrixAt(i, m);
        }
        tiles.instanceMatrix.needsUpdate = true;
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
        kickT: number;
        hitT: number;
        hx: number;
        hz: number;
      }
      const chars = new Map<string, Entry>();
      for (const p of o.players) {
        const c = k.kit.create(p.color, p.id === o.meId);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.set(p.id, { c, x: 0, z: 0, y: 0, vy: 0, px: 0, pz: 0, placed: false, kickT: -9, hitT: -9, hx: 0, hz: 0 });
      }
      k.onTier((tier) => {
        for (const e of chars.values()) e.c.setShadows(tier !== 'low');
      });

      const focus = new Vector3(0, 0.9, 1);
      const aim = new Vector3();
      const camPos = new Vector3();
      const camDir = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
      const overview = k.fit(halfW + 0.6, length / 2 + 1.4, PITCH) * 1.05;
      const sunOff = new Vector3(-8, 24, 10);
      const sunAim = new Vector3();
      let seenFirstFrame = false;

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          syncTiles(time, f.broken.current);

          // đá / bị hất: nhún, văng, bụi tung lên
          const fxq = f.kickFx.current;
          while (fxq.length) {
            const ev = fxq.shift()!;
            const kc = chars.get(ev.by);
            if (kc) kc.kickT = time;
            const kx = ev.x * S;
            const kz = ev.y * S;
            k.effects.burst(kx, 0.5, kz, { count: k.count(10), palette: ['#ffffff', '#ffd23f'], speed: 3, life: 0.35, size: 0.16 });
            for (const hid of ev.hits) {
              const v = chars.get(hid);
              if (!v) continue;
              v.hitT = time;
              const dx = v.x - kx;
              const dz = v.z - kz;
              const l = Math.hypot(dx, dz) || 1;
              v.hx = dx / l;
              v.hz = dz / l;
              k.effects.burst(v.x, 1.1, v.z, { count: k.count(26), palette: ['#ff5e8a', '#ffd23f', '#ffffff'], speed: 5, life: 0.6, size: 0.22 });
            }
          }

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
            } else if (p.id === o.meId && !out && !f.positions.current[o.meId]?.st) {
              e.x = tx;
              e.z = tz;
            } else if (out) {
              // đang rơi thì rơi thẳng tại chỗ; quay về xuất phát thì nhảy cóc về
            } else {
              const far = Math.hypot(tx - e.x, tz - e.z) > 3;
              const kk = far ? 1 : 1 - Math.exp(-dt * 14);
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
            const hitAge = time - e.hitT;
            const kickAge = time - e.kickT;
            const stunned = !out && hitAge < 0.7;
            if (!out && !stunned) e.c.face(vx, vz, dt);
            // nhân vật nghiêng ngửa khi bị hất, nhún tới trước khi đá
            const tilt = stunned ? Math.sin(Math.min(1, hitAge / 0.25) * Math.PI) * 0.9 * (1 - hitAge / 0.7) : 0;
            e.c.root.rotation.x = tilt * e.hz;
            e.c.root.rotation.z = -tilt * e.hx;
            const lunge = kickAge < 0.25 ? Math.sin((kickAge / 0.25) * Math.PI) : 0;
            e.c.root.scale.set(CHAR_SCALE * (1 + lunge * 0.12), CHAR_SCALE * (1 - lunge * 0.1 - (stunned ? 0.08 : 0)), CHAR_SCALE * (1 + lunge * 0.12));
            e.c.update(dt, {
              speed: out ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)),
              dead: false,
              time,
              pose: out ? 'jump' : stunned ? 'hit' : kickAge < 0.3 ? 'jump' : 'run',
            });
            k.label(o.labels.get(p.id), e.x, e.y + 2.2, e.z);
            const el = o.labels.get(p.id);
            if (el && out && e.y < -3) el.style.opacity = '0';
            else if (el && !out && el.style.opacity === '0') el.style.opacity = '';
          }

          const me = chars.get(o.meId);
          if (me && me.placed) {
            // góc nhìn thứ 3: bám sau lưng mình (cả lúc rơi: mắt vẫn nhìn tại chỗ ô vỡ)
            aim.set(me.x, 0.9, me.z);
            if (!seenFirstFrame) {
              focus.copy(aim);
              seenFirstFrame = true;
            }
            focus.lerp(aim, 1 - Math.exp(-dt * 6));
            camPos.set(focus.x, focus.y + FOLLOW_UP, focus.z + FOLLOW_BACK);
          } else {
            // khán giả: nhìn cả con đường
            aim.set(0, 0.3, -length / 2);
            focus.lerp(aim, 1 - Math.exp(-dt * 3));
            camPos.copy(focus).addScaledVector(camDir, overview);
          }
          k.look(camPos, focus);
          sunAim.set(focus.x, 0, focus.z);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
      };
    },
  );
}
