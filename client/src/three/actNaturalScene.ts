import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { AnConfig, AnEnt, AnFx, AnPhase } from '../games/actnatural/useActNaturalGame';

export interface ActNaturalFrame {
  cfg: AnConfig;
  ents: { current: AnEnt[] | null };
  /** [góc quanh bản đồ, laze x, laze y, đạn, choáng] */
  seekerPos: { current: [number, number | null, number | null, number, number] | null };
  me: { current: { x: number; y: number } };
  orbit: { current: number };
  aim: { current: [number, number] | null };
  fx: { current: AnFx[] };
  role: { r: number; seeker: string; ent: number; alive: boolean };
  phase: AnPhase;
  reveal: Record<number, string>;
  players: { id: string; name: string }[];
  aimTo(x: number, y: number): void;
  shoot(x: number, y: number): void;
  predict(serverNow: number): void;
  serverNow(): number;
}

export interface ActNaturalSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  meId: string;
  read: () => ActNaturalFrame;
  labels: Map<number, HTMLElement | null>;
}

/** 1 đơn vị sân của server = S đơn vị 3D */
const S = 0.1;
const CHAR_SCALE = 1.3;
/** người trốn nhìn toàn cảnh từ trên xuống; thợ săn nhìn xéo xuống 45° và bay vòng quanh bản đồ */
const PITCH_HIDER = (64 * Math.PI) / 180;
const PITCH_SEEKER = Math.PI / 4;
const OBST_H = 1.5;
const OBST_COLORS = ['#8a5bff', '#2fd6a0', '#ff8a3d', '#5b8cff', '#ff5e8a'];

export function createActNaturalScene(o: ActNaturalSceneOptions) {
  const cfg = o.read().cfg;
  const W = cfg.w * S;
  const H = cfg.h * S;
  const wx = (x: number) => x * S - W / 2;
  const wz = (y: number) => y * S - H / 2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [W / 2 + 3, H / 2 + 3], groundY: -34, ground: false },
      sun: [-10, 26, 12],
      shadowBox: Math.max(W, H) / 2 + 3,
    },
    (k) => {
      const { scene } = k.engine;

      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#58c4e6' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -9;
      scene.add(sea);

      /* ---------------- quảng trường: cỏ + lối đi lát đá ---------------- */
      const ground = k.texture(1024, 704, (g, w, h) => {
        g.fillStyle = '#8fe36a';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) {
          g.fillStyle = i % 2 ? 'rgba(127,214,90,0.5)' : 'rgba(170,240,130,0.5)';
          g.fillRect(Math.random() * w, Math.random() * h, 60 + Math.random() * 80, 30 + Math.random() * 40);
        }
        g.fillStyle = '#f2e4c4';
        g.fillRect(0, h / 2 - 36, w, 72);
        g.fillRect(w / 2 - 36, 0, 72, h);
        g.strokeStyle = 'rgba(200,170,120,0.5)';
        g.lineWidth = 3;
        for (let x = 0; x < w; x += 48) {
          g.beginPath();
          g.moveTo(x, h / 2 - 36);
          g.lineTo(x, h / 2 + 36);
          g.stroke();
        }
        for (let y = 0; y < h; y += 48) {
          g.beginPath();
          g.moveTo(w / 2 - 36, y);
          g.lineTo(w / 2 + 36, y);
          g.stroke();
        }
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 8;
        g.strokeRect(8, 8, w - 16, h - 16);
      });
      const side = k.lit({ color: '#5d6bb8', flatShading: true });
      const floor = new Mesh(new BoxGeometry(W, 0.6, H), [side, side, k.lit({ map: ground }), side, side, side]);
      floor.position.y = -0.3;
      floor.receiveShadow = true;
      scene.add(floor);

      // vật cản: đài phun nước ở giữa + ghế đá/bụi cây rải rác
      cfg.boxes.forEach((b, i) => {
        const fountain = i === 0;
        const col = fountain ? '#9bd8ff' : OBST_COLORS[i % OBST_COLORS.length];
        const geo = fountain ? new CylinderGeometry((b.w * S) / 2, (b.w * S) / 2, 0.9, 20) : new BoxGeometry(b.w * S, OBST_H, b.d * S);
        const mesh = new Mesh(geo, k.lit({ color: col }));
        mesh.position.set(wx(b.x), (fountain ? 0.9 : OBST_H) / 2, wz(b.y));
        mesh.castShadow = !k.low;
        mesh.receiveShadow = true;
        scene.add(mesh);
        if (!fountain) {
          const top = new Mesh(new BoxGeometry(b.w * S * 0.9, 0.12, b.d * S * 0.9), k.lit({ color: '#ffffff' }));
          top.position.set(wx(b.x), OBST_H + 0.06, wz(b.y));
          scene.add(top);
        }
      });

      /* ---------------- thực thể ẩn danh: NPC và người trốn trông y hệt nhau ---------------- */
      interface Entry {
        c: Character3D;
        x: number;
        z: number;
        px: number;
        pz: number;
        placed: boolean;
        shown: boolean;
      }
      const chars: Entry[] = [];
      for (let i = 0; i < cfg.ents; i++) {
        const c = k.kit.create(cfg.colors[i], false);
        c.setShadows(!k.low);
        c.root.scale.setScalar(CHAR_SCALE);
        c.root.visible = false;
        scene.add(c.root);
        chars.push({ c, x: 0, z: 0, px: 0, pz: 0, placed: false, shown: false });
      }
      k.onTier((tier) => {
        for (const e of chars) e.c.setShadows(tier !== 'low');
      });

      // mũi tên chỉ riêng cho NGƯỜI TRỐN thấy thực thể của chính mình
      const mark = new Mesh(new ConeGeometry(0.28, 0.6, 4), new MeshBasicMaterial({ color: '#ffd23f' }));
      mark.rotation.x = Math.PI;
      mark.visible = false;
      scene.add(mark);

      /* ---------------- thợ săn: không có nhân vật trong sân, chỉ có khẩu súng bay quanh bản đồ + tia laze ---------------- */
      const gun = new Group();
      const gunBody = new Mesh(new BoxGeometry(0.5, 0.5, 1.5), k.lit({ color: '#2b2f4a' }));
      const gunBarrel = new Mesh(new CylinderGeometry(0.12, 0.12, 1.4, 10), k.lit({ color: '#ff3b4e' }));
      gunBarrel.rotation.x = Math.PI / 2;
      gunBarrel.position.z = 1.3;
      const gunGlow = new Mesh(new SphereGeometry(0.22, 10, 8), new MeshBasicMaterial({ color: '#ff5a5a' }));
      gunGlow.position.z = 2.05;
      gun.add(gunBody, gunBarrel, gunGlow);
      gun.visible = false;
      scene.add(gun);

      const laserMat = new MeshBasicMaterial({ color: '#ff2d2d', transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false });
      const laser = new Mesh(new CylinderGeometry(0.045, 0.045, 1, 6), laserMat);
      laser.visible = false;
      scene.add(laser);
      const dotMat = new MeshBasicMaterial({ color: '#ff3030', transparent: true, opacity: 0.9, depthWrite: false });
      const dot = new Mesh(new CylinderGeometry(0.42, 0.42, 0.04, 20), dotMat);
      dot.visible = false;
      scene.add(dot);
      const up = new Vector3(0, 1, 0);
      const fwd = new Vector3(0, 0, 1);
      const dir = new Vector3();
      const muzzle = new Vector3();
      const beam = new Vector3();
      const src = new Vector3();
      const dst = new Vector3();

      /* ---------------- chuột / ngón tay: rọi laze, bấm để bắn (chỉ thợ săn) ---------------- */
      const ptr = new Vector2();
      const ray = new Raycaster();
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      const hit = new Vector3();
      const pick = (e: PointerEvent): [number, number] | null => {
        const r = o.host.getBoundingClientRect();
        ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
        ray.setFromCamera(ptr, k.engine.camera);
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        return [Math.max(0, Math.min(cfg.w, (hit.x + W / 2) / S)), Math.max(0, Math.min(cfg.h, (hit.z + H / 2) / S))];
      };
      const seekerNow = () => {
        const f = o.read();
        return f.role.seeker === o.meId && f.phase === 'u';
      };
      const onMove = (e: PointerEvent) => {
        if (!seekerNow()) return;
        const p = pick(e);
        if (p) o.read().aimTo(p[0], p[1]);
      };
      const onDown = (e: PointerEvent) => {
        if (!seekerNow()) return;
        const p = pick(e);
        if (!p) return;
        const f = o.read();
        f.aimTo(p[0], p[1]);
        f.shoot(p[0], p[1]);
      };
      o.host.addEventListener('pointermove', onMove);
      o.host.addEventListener('pointerdown', onDown);

      /* ---------------- camera ---------------- */
      const camHider = new Vector3(0, Math.sin(PITCH_HIDER), Math.cos(PITCH_HIDER));
      const camPos = new Vector3();
      const focus = new Vector3(0, 0, 0.3);
      const distHider = k.fit(W / 2 + 1.2, H / 2 + 1.4, PITCH_HIDER) * 1.03;
      // thợ săn bay trên vòng tròn quanh tâm: khoảng cách đủ ôm trọn bản đồ ở góc 45° dù xoay hướng nào
      const R = Math.hypot(W, H) / 2;
      const distSeeker = k.fit(R * 0.82, R * 0.62, PITCH_SEEKER);
      const dh = distSeeker * Math.cos(PITCH_SEEKER);
      const dv = distSeeker * Math.sin(PITCH_SEEKER);
      const sunOff = new Vector3(-10, 26, 12);
      const sunAim = new Vector3(0, 0, 0);
      let fxDone = 0;

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const iSeeker = f.role.seeker === o.meId;
          const ents = f.ents.current;
          const myEnt = !iSeeker && f.role.alive ? f.role.ent : -1;

          for (let i = 0; i < chars.length; i++) {
            const e = chars[i];
            const s = ents?.[i];
            // thợ săn chưa nhận vị trí (đang nhắm mắt) thì không vẽ ai cả
            if (!s) {
              e.c.root.visible = false;
              e.shown = false;
              const el = o.labels.get(i);
              if (el) el.style.opacity = '0';
              continue;
            }
            const mine = i === myEnt;
            const tx = wx(mine ? f.me.current.x : s[0]);
            const tz = wz(mine ? f.me.current.y : s[1]);
            if (!e.placed || !e.shown) {
              e.x = tx;
              e.z = tz;
              e.px = tx;
              e.pz = tz;
              e.placed = true;
            } else if (mine) {
              e.x = tx;
              e.z = tz;
            } else {
              const kk = 1 - Math.exp(-dt * 12);
              e.x += (tx - e.x) * kk;
              e.z += (tz - e.z) * kk;
            }
            e.shown = true;
            const vx = (e.x - e.px) / Math.max(dt, 1e-3);
            const vz = (e.z - e.pz) / Math.max(dt, 1e-3);
            e.px = e.x;
            e.pz = e.z;
            e.c.root.visible = true;
            e.c.root.position.set(e.x, 0, e.z);
            e.c.face(vx, vz, dt);
            e.c.update(dt, { speed: Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)), dead: false, time, pose: 'run' });
            // tên chỉ hiện ở cuối vòng khi danh tính được tiết lộ
            const el = o.labels.get(i);
            if (el) {
              const who = f.phase === 'r' ? f.reveal[i] : undefined;
              if (who) {
                el.textContent = f.players.find((p) => p.id === who)?.name ?? '';
                k.label(el, e.x, 2.2, e.z);
              } else el.style.opacity = '0';
            }
          }

          // mũi tên của riêng mình
          if (myEnt >= 0 && ents?.[myEnt]) {
            mark.visible = true;
            mark.position.set(chars[myEnt].x, 2.4 + Math.sin(time * 4) * 0.12, chars[myEnt].z);
            mark.rotation.y = time * 2;
          } else mark.visible = false;

          // khẩu súng bay quanh bản đồ + tia laze (thợ săn thấy ngay điểm rọi của mình; mọi người thấy theo server)
          const kp = f.seekerPos.current;
          const phi = iSeeker ? f.orbit.current : kp ? kp[0] : f.orbit.current;
          const ax = iSeeker ? f.aim.current?.[0] : kp?.[1];
          const ay = iSeeker ? f.aim.current?.[1] : kp?.[2];
          const hunting = f.phase === 'u' && !!kp;
          gun.visible = !!kp && f.phase !== 'r';
          src.set(Math.cos(phi) * dh * 0.92, dv * 0.34, Math.sin(phi) * dh * 0.92);
          gun.position.copy(src);
          if (hunting && ax != null && ay != null) {
            dst.set(wx(ax), 0.05, wz(ay));
            dir.subVectors(dst, src).normalize();
            gun.quaternion.setFromUnitVectors(fwd, dir);
            // tia laze đi từ đầu nòng súng (cách thân súng ~2 đơn vị) tới điểm rọi trên sàn
            muzzle.copy(src).addScaledVector(dir, 2.05);
            beam.subVectors(dst, muzzle);
            const blen = beam.length();
            laser.visible = true;
            laser.scale.set(1, blen, 1);
            laser.position.copy(muzzle).addScaledVector(beam, 0.5);
            laser.quaternion.setFromUnitVectors(up, beam.normalize());
            dot.visible = true;
            dot.position.copy(dst);
            dot.scale.setScalar(1 + 0.15 * Math.sin(time * 14));
            const stun = !!kp?.[4];
            laserMat.opacity = stun ? 0.25 : 0.85;
            dotMat.opacity = stun ? 0.3 : 0.9;
          } else {
            laser.visible = false;
            dot.visible = false;
            // chưa rọi: súng hướng vào tâm bản đồ
            dir.set(-src.x, 0, -src.z).normalize();
            gun.quaternion.setFromUnitVectors(fwd, dir);
          }

          // hiệu ứng bắn
          const fxs = f.fx.current;
          while (fxDone < fxs.length) {
            const ev = fxs[fxDone++];
            const x = wx(ev.x);
            const z = wz(ev.y);
            if (ev.kind === 'kill') {
              k.effects.burst(x, 1, z, { count: k.count(40), palette: ['#ff2d55', '#ffd166', '#ffffff'], speed: 5, life: 0.8, size: 0.22 });
              k.effects.ring(x, z, '#ff2d55', 0.6, 4);
              k.shake(0.25);
            } else if (ev.kind === 'miss') {
              k.effects.burst(x, 0.8, z, { count: k.count(26), palette: ['#ffffff', '#c9d2e8', '#9aa3c7'], speed: 3, life: 0.7, size: 0.28, additive: false });
            } else {
              k.effects.burst(x, 0.3, z, { count: k.count(8), palette: ['#ffd166', '#ffffff'], speed: 2, life: 0.4, size: 0.14 });
            }
          }

          if (iSeeker) {
            // camera thợ săn: bay trên vòng tròn quanh bản đồ, nhìn xéo xuống 45° về tâm
            focus.set(0, 0, 0);
            camPos.set(Math.cos(phi) * dh, dv, Math.sin(phi) * dh);
          } else {
            focus.set(0, 0, 0.3);
            camPos.copy(focus).addScaledVector(camHider, distHider);
          }
          k.look(camPos, focus);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
        dispose() {
          o.host.removeEventListener('pointermove', onMove);
          o.host.removeEventListener('pointerdown', onDown);
        },
      };
    },
  );
}
