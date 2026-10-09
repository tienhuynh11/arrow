import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  RingGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { AnBullet, AnConfig, AnEnt, AnFx, AnKillCam, AnPhase } from '../games/actnatural/useActNaturalGame';

export interface ActNaturalFrame {
  cfg: AnConfig;
  ents: { current: AnEnt[] | null };
  /** [góc quanh bản đồ, laze x, laze y, đạn, choáng] */
  seekerPos: { current: [number, number | null, number | null, number, number] | null };
  me: { current: { x: number; y: number } };
  orbit: { current: number };
  aim: { current: [number, number] | null };
  fx: { current: AnFx[] };
  bullets: { current: AnBullet[] };
  killCam: { current: AnKillCam | null };
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
/** người trốn: camera thứ ba bám theo nhân vật (nhìn chéo xuống ~58°, zoom gần); thợ săn nhìn xéo xuống 45° và bay vòng quanh đảo */
const PITCH_HIDER = (58 * Math.PI) / 180;
const HIDER_DIST = 8.6;
const PITCH_SEEKER = Math.PI / 4;
/** thời điểm đạn chạm nạn nhân trong kill cam (tỉ lệ 0..1 của cả đoạn quay chậm) */
const KC_IMPACT = 0.72;
const smooth = (a: number, b: number, t: number) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function createActNaturalScene(o: ActNaturalSceneOptions) {
  const cfg = o.read().cfg;
  const W = cfg.w * S;
  const H = cfg.h * S;
  const Rs = cfg.R * S;
  const wx = (x: number) => x * S - W / 2;
  const wz = (y: number) => y * S - H / 2;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [Rs + 4, Rs + 4], groundY: -34, ground: false },
      sun: [-10, 26, 12],
      shadowBox: Rs + 4,
    },
    (k) => {
      const { scene } = k.engine;

      const sea = new Mesh(new PlaneGeometry(700, 700), new MeshBasicMaterial({ color: '#4fb8e0' }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -0.9;
      scene.add(sea);
      // vùng nước nông quanh đảo
      const shallow = new Mesh(
        new CircleGeometry(Rs * 1.28, 64),
        new MeshBasicMaterial({ color: '#8fe3f2', transparent: true, opacity: 0.7, depthWrite: false }),
      );
      shallow.rotation.x = -Math.PI / 2;
      shallow.position.y = -0.85;
      scene.add(shallow);

      /* ---------------- hòn đảo: bãi cát ngoài, cỏ trong, lối đi lát đá ---------------- */
      const sandMat = k.lit({ color: '#f1d9a0' });
      const sand = new Mesh(new CylinderGeometry(Rs, Rs * 1.04, 0.9, 64), [sandMat, sandMat, sandMat]);
      sand.position.y = -0.45;
      sand.receiveShadow = true;
      scene.add(sand);
      const grassTex = k.texture(1024, 1024, (g, w, h) => {
        g.fillStyle = '#8fe36a';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) {
          g.fillStyle = i % 2 ? 'rgba(127,214,90,0.5)' : 'rgba(170,240,130,0.5)';
          g.fillRect(Math.random() * w, Math.random() * h, 50 + Math.random() * 90, 30 + Math.random() * 50);
        }
        g.fillStyle = '#f2e4c4';
        g.fillRect(0, h / 2 - 34, w, 68);
        g.fillRect(w / 2 - 34, 0, 68, h);
        g.strokeStyle = 'rgba(200,170,120,0.5)';
        g.lineWidth = 3;
        for (let x = 0; x < w; x += 48) {
          g.beginPath();
          g.moveTo(x, h / 2 - 34);
          g.lineTo(x, h / 2 + 34);
          g.stroke();
          g.beginPath();
          g.moveTo(w / 2 - 34, x);
          g.lineTo(w / 2 + 34, x);
          g.stroke();
        }
      });
      const grass = new Mesh(new CircleGeometry(Rs - 0.95, 64), k.lit({ map: grassTex }));
      grass.rotation.x = -Math.PI / 2;
      grass.position.y = 0.01;
      grass.receiveShadow = true;
      scene.add(grass);

      // vật cản: đài nước ở giữa + cây / đá / ghế
      const mk = (geo: any, color: string, x: number, y: number, z: number) => {
        const m = new Mesh(geo, k.lit({ color }));
        m.position.set(x, y, z);
        m.castShadow = !k.low;
        m.receiveShadow = true;
        scene.add(m);
        return m;
      };
      cfg.props.forEach((b) => {
        const x = wx(b.x);
        const z = wz(b.y);
        const w = b.w * S;
        const d = b.d * S;
        if (b.k === 0) {
          mk(new CylinderGeometry(w / 2, w / 2, 0.7, 24), '#c9d2e8', x, 0.35, z);
          const water = new Mesh(new CylinderGeometry(w / 2 - 0.12, w / 2 - 0.12, 0.05, 24), new MeshBasicMaterial({ color: '#7fd6ff' }));
          water.position.set(x, 0.66, z);
          scene.add(water);
          mk(new CylinderGeometry(0.2, 0.28, 1.5, 10), '#c9d2e8', x, 1.2, z);
          mk(new SphereGeometry(0.4, 12, 8), '#9bd8ff', x, 2.0, z);
        } else if (b.k === 1) {
          mk(new CylinderGeometry(w * 0.12, w * 0.16, 1.0, 8), '#8a5a35', x, 0.5, z);
          mk(new ConeGeometry(w * 0.62, 1.4, 9), '#2fae5c', x, 1.6, z);
          mk(new ConeGeometry(w * 0.46, 1.1, 9), '#3bc46c', x, 2.4, z);
        } else if (b.k === 2) {
          const rock = mk(new IcosahedronGeometry(Math.max(w, d) * 0.5, 0), '#9aa3b8', x, 0.55, z);
          rock.scale.set(1, 0.75, d / w);
          rock.rotation.y = x * 3;
        } else {
          // ghế đá: mặt ngồi + lưng tựa, dài theo cạnh dài của hộp
          const along = w >= d;
          const L = along ? w : d;
          const T = along ? d : w;
          mk(new BoxGeometry(along ? L : T, 0.12, along ? T : L), '#c98b4f', x, 0.55, z);
          const back = mk(new BoxGeometry(along ? L : 0.1, 0.5, along ? 0.1 : L), '#a8703a', x + (along ? 0 : T * 0.45), 0.85, z + (along ? T * 0.45 : 0));
          back.castShadow = false;
          mk(new BoxGeometry(along ? 0.12 : T, 0.5, along ? T : 0.12), '#6b6f86', x - (along ? L * 0.42 : 0), 0.28, z - (along ? 0 : L * 0.42));
          mk(new BoxGeometry(along ? 0.12 : T, 0.5, along ? T : 0.12), '#6b6f86', x + (along ? L * 0.42 : 0), 0.28, z + (along ? 0 : L * 0.42));
        }
      });
      // vài cây dừa trang trí trên bãi cát (ngoài vùng chơi)
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const r = Rs - 0.4;
        const px = Math.cos(a) * r;
        const pz = Math.sin(a) * r;
        mk(new CylinderGeometry(0.07, 0.11, 1.3, 6), '#a9794a', px, 0.65, pz).rotation.z = 0.15;
        mk(new SphereGeometry(0.42, 8, 6), '#35b860', px, 1.4, pz).scale.y = 0.55;
      }

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

      /* ---------------- thợ săn: không có nhân vật trong sân, chỉ có khẩu súng bay quanh đảo + tia laze ---------------- */
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
      // vòng trúng: bán kính đúng bằng hitR — đạn tới nơi thì ai đứng trong vòng này là trúng
      const HR = cfg.hitR * S;
      const dotMat = new MeshBasicMaterial({ color: '#ff3030', transparent: true, opacity: 0.28, depthWrite: false });
      const dot = new Mesh(new CylinderGeometry(HR, HR, 0.04, 32), dotMat);
      dot.visible = false;
      scene.add(dot);
      const ringMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, side: DoubleSide, depthWrite: false });
      const ring = new Mesh(new RingGeometry(HR * 0.9, HR, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      const cross = new Mesh(new RingGeometry(0.06, 0.1, 16), ringMat);
      cross.rotation.x = -Math.PI / 2;
      cross.visible = false;
      scene.add(cross);

      const up = new Vector3(0, 1, 0);
      const fwd = new Vector3(0, 0, 1);
      const dir = new Vector3();
      const beam = new Vector3();
      const src = new Vector3();
      const dst = new Vector3();

      /* ---------------- camera (hằng số dùng cho vị trí súng) ---------------- */
      const distSeeker = k.fit(Rs * 1.12, Rs * 0.82, PITCH_SEEKER);
      const dh = distSeeker * Math.cos(PITCH_SEEKER);
      const dv = distSeeker * Math.sin(PITCH_SEEKER);
      const gunAt = (phi: number, out: Vector3) => out.set(Math.cos(phi) * dh * 0.92, dv * 0.34, Math.sin(phi) * dh * 0.92);

      /* ---------------- đạn bay (mọi người đều thấy) ---------------- */
      const bulletMat = new MeshBasicMaterial({ color: '#fff2a8' });
      const trailMat = new MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false });
      interface Slug {
        g: Group;
        trail: Mesh;
      }
      const makeSlug = (): Slug => {
        const g = new Group();
        g.add(new Mesh(new SphereGeometry(0.16, 10, 8), bulletMat));
        const trail = new Mesh(new CylinderGeometry(0.07, 0.01, 1, 8), trailMat);
        trail.rotation.x = Math.PI / 2;
        g.add(trail);
        g.visible = false;
        scene.add(g);
        return { g, trail };
      };
      const slugs = new Map<number, Slug>();
      const kcSlug = makeSlug();
      const bStart = new Vector3();
      const bEnd = new Vector3();
      const bPos = new Vector3();
      /** đặt viên đạn ở vị trí pos, đầu hướng d, vệt đuôi dài `len` */
      const placeSlug = (s: Slug, pos: Vector3, d: Vector3, len: number, scale = 1) => {
        s.g.visible = true;
        s.g.position.copy(pos);
        s.g.quaternion.setFromUnitVectors(fwd, d);
        s.g.scale.setScalar(scale);
        s.trail.scale.set(1, len, 1);
        s.trail.position.z = -len / 2;
      };

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
        let x = (hit.x + W / 2) / S;
        let y = (hit.z + H / 2) / S;
        const dx = x - cfg.cx;
        const dy = y - cfg.cy;
        const d = Math.hypot(dx, dy);
        if (d > cfg.R) {
          x = cfg.cx + (dx / d) * cfg.R;
          y = cfg.cy + (dy / d) * cfg.R;
        }
        return [x, y];
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

      /* ---------------- mũi tên mép màn hình chỉ hướng khẩu súng / điểm laze (người trốn) ---------------- */
      const edge = document.createElement('div');
      edge.className = 'an-edge';
      edge.innerHTML = '<i></i>';
      edge.style.display = 'none';
      o.host.appendChild(edge);
      const ndc = new Vector3();

      /* ---------------- camera ---------------- */
      const camHider = new Vector3(0, Math.sin(PITCH_HIDER), Math.cos(PITCH_HIDER));
      const camPos = new Vector3();
      const focus = new Vector3(0, 0, 0);
      const curPos = new Vector3();
      const curFocus = new Vector3();
      let camInit = false;
      let hiderDist = HIDER_DIST;
      const wideDist = k.fit(Rs + 1.2, Rs + 1.2, PITCH_HIDER);
      const sunOff = new Vector3(-10, 26, 12);
      const sunAim = new Vector3(0, 0, 0);
      const vic = new Vector3();
      const side = new Vector3();
      let fxDone = 0;
      let impactFor = -1;
      let lastTrail = 0;

      return {
        frame(dt, time) {
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);
          const iSeeker = f.role.seeker === o.meId;
          const ents = f.ents.current;
          const myEnt = !iSeeker && f.role.alive ? f.role.ent : -1;
          const kc = f.killCam.current;
          const kcT = kc ? Math.max(0, Math.min(1, (now - kc.start) / kc.ms)) : 0;
          const afterImpact = !!kc && kcT >= KC_IMPACT;
          // trong kill cam mọi thứ chạy chậm
          const cdt = kc ? dt * 0.25 : dt;

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
            const victim = !!kc && kc.ent === i;
            e.c.update(cdt, { speed: Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S)), dead: victim && afterImpact, time, pose: 'run' });
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

          // khẩu súng bay quanh đảo + tia laze (thợ săn thấy ngay điểm rọi của mình; mọi người thấy theo server)
          const kp = f.seekerPos.current;
          const phi = iSeeker ? f.orbit.current : kp ? kp[0] : f.orbit.current;
          const ax = iSeeker ? f.aim.current?.[0] : kp?.[1];
          const ay = iSeeker ? f.aim.current?.[1] : kp?.[2];
          const hunting = f.phase === 'u' && !!kp;
          gun.visible = !!kp && f.phase !== 'r';
          gunAt(phi, src);
          gun.position.copy(src);
          const stun = !!kp?.[4];
          const aiming = hunting && ax != null && ay != null;
          if (aiming) {
            dst.set(wx(ax), 0.05, wz(ay));
            dir.subVectors(dst, src).normalize();
            gun.quaternion.setFromUnitVectors(fwd, dir);
            // tia laze đi từ đầu nòng súng (cách thân súng ~2 đơn vị) tới điểm rọi trên sàn
            bStart.copy(src).addScaledVector(dir, 2.05);
            beam.subVectors(dst, bStart);
            const blen = beam.length();
            laser.visible = true;
            laser.scale.set(1, blen, 1);
            laser.position.copy(bStart).addScaledVector(beam, 0.5);
            laser.quaternion.setFromUnitVectors(up, beam.normalize());
            dot.visible = ring.visible = cross.visible = true;
            dot.position.copy(dst);
            ring.position.set(dst.x, 0.07, dst.z);
            cross.position.set(dst.x, 0.08, dst.z);
            ring.scale.setScalar(1 + 0.05 * Math.sin(time * 10));
            laserMat.opacity = stun ? 0.2 : 0.85;
            dotMat.opacity = stun ? 0.1 : 0.28;
            ringMat.opacity = stun ? 0.3 : 0.95;
          } else {
            laser.visible = false;
            dot.visible = ring.visible = cross.visible = false;
            // chưa rọi: súng hướng vào tâm đảo
            dir.set(-src.x, 0, -src.z).normalize();
            gun.quaternion.setFromUnitVectors(fwd, dir);
          }

          // đạn đang bay (thời gian bay do server quyết); viên đạn của lần trúng được thay bằng kill cam
          const liveIds = new Set<number>();
          if (!kc) {
            for (const b of f.bullets.current) {
              const u = (now - b.at) / b.fl;
              if (u < 0 || u > 1.05) continue;
              liveIds.add(b.id);
              let sl = slugs.get(b.id);
              if (!sl) {
                sl = makeSlug();
                slugs.set(b.id, sl);
              }
              gunAt(b.phi, bStart);
              bEnd.set(wx(b.x), 0.6, wz(b.y));
              dir.subVectors(bEnd, bStart).normalize();
              bStart.addScaledVector(dir, 2.05);
              const uu = Math.min(1, u);
              bPos.lerpVectors(bStart, bEnd, uu);
              bPos.y += Math.sin(uu * Math.PI) * 0.5;
              placeSlug(sl, bPos, dir, Math.min(2.2, bPos.distanceTo(bStart)), 1.2);
            }
          }
          for (const [id, sl] of slugs) {
            if (!liveIds.has(id)) {
              scene.remove(sl.g);
              slugs.delete(id);
            }
          }

          // hiệu ứng trúng / trượt
          const fxs = f.fx.current;
          while (fxDone < fxs.length) {
            const ev = fxs[fxDone++];
            const x = wx(ev.x);
            const z = wz(ev.y);
            if (ev.kind === 'kill') {
              // nổ thật diễn ra ở cuối đoạn quay chậm (xem bên dưới); ở đây chỉ tạo bụi ban đầu
              k.effects.burst(x, 0.3, z, { count: k.count(10), palette: ['#ffd166', '#ffffff'], speed: 2, life: 0.4, size: 0.14 });
            } else if (ev.kind === 'miss') {
              k.effects.burst(x, 0.8, z, { count: k.count(26), palette: ['#ffffff', '#c9d2e8', '#9aa3c7'], speed: 3, life: 0.7, size: 0.28, additive: false });
              k.effects.ring(x, z, '#c9d2e8', 0.5, 3);
            } else {
              k.effects.burst(x, 0.3, z, { count: k.count(14), palette: ['#d9c08a', '#f1d9a0', '#ffffff'], speed: 2.2, life: 0.5, size: 0.2, additive: false });
            }
          }

          /* ---------------- kill cam quay chậm ---------------- */
          kcSlug.g.visible = false;
          let kcMode = false;
          if (kc) {
            kcMode = true;
            const vEnt = chars[kc.ent];
            const vx0 = vEnt.shown ? vEnt.x : wx(kc.x);
            const vz0 = vEnt.shown ? vEnt.z : wz(kc.y);
            gunAt(kc.phi, bStart);
            bEnd.set(vx0, 0.9, vz0);
            dir.subVectors(bEnd, bStart).normalize();
            bStart.addScaledVector(dir, 2.05);
            const u = Math.min(1, kcT / KC_IMPACT);
            const total = bStart.distanceTo(bEnd);
            if (kcT < KC_IMPACT) {
              bPos.lerpVectors(bStart, bEnd, u);
              placeSlug(kcSlug, bPos, dir, Math.min(3.2, total * u), 1.8);
              if (time - lastTrail > 0.06) {
                lastTrail = time;
                k.effects.burst(bPos.x, bPos.y, bPos.z, { count: k.count(3), palette: ['#ffb02e', '#ffffff', '#9aa3c7'], speed: 0.6, life: 0.7, size: 0.16 });
              }
              side.set(-dir.z, 0, dir.x);
              // camera đuổi theo viên đạn, cuối đoạn chuyển sang nhìn nạn nhân
              camPos.copy(bPos).addScaledVector(dir, -3.4).addScaledVector(side, 0.9);
              camPos.y += 1.2;
              focus.copy(bPos).addScaledVector(dir, 2.4);
              vic.set(vx0, 1.0, vz0);
              focus.lerp(vic, smooth(0.45, 1, u));
            } else {
              if (impactFor !== kc.start) {
                impactFor = kc.start;
                k.effects.burst(vx0, 1, vz0, { count: k.count(46), palette: ['#ff2d55', '#ffd166', '#ffffff'], speed: 5, life: 0.9, size: 0.24 });
                k.effects.ring(vx0, vz0, '#ff2d55', 0.7, 4.5);
                k.shake(0.3);
              }
              const a = Math.atan2(dir.z, dir.x) + 2.2 + (kcT - KC_IMPACT) * 2.2;
              camPos.set(vx0 + Math.cos(a) * 4.4, 2.3, vz0 + Math.sin(a) * 4.4);
              focus.set(vx0, 0.9, vz0);
            }
          }

          // mũi tên mép màn hình cho người trốn: chỉ hướng khẩu súng / điểm laze nếu ra ngoài tầm nhìn
          let showEdge = false;
          if (!iSeeker && f.phase === 'u' && !kc && gun.visible) {
            ndc.copy(aiming ? dst : src).project(k.engine.camera);
            const behind = ndc.z > 1;
            let nx = behind ? -ndc.x : ndc.x;
            let ny = behind ? -ndc.y : ndc.y;
            if (behind || Math.abs(nx) > 0.9 || Math.abs(ny) > 0.86) {
              const sc = Math.max(Math.abs(nx) / 0.9, Math.abs(ny) / 0.86, 1e-3);
              nx /= sc;
              ny /= sc;
              edge.style.left = `${(nx * 0.5 + 0.5) * 100}%`;
              edge.style.top = `${(-ny * 0.5 + 0.5) * 100}%`;
              edge.style.transform = `translate(-50%,-50%) rotate(${(Math.atan2(-ny, nx) * 180) / Math.PI}deg)`;
              showEdge = true;
            }
          }
          edge.style.display = showEdge ? 'block' : 'none';

          if (!kcMode) {
            if (iSeeker) {
              // camera thợ săn: bay trên vòng tròn quanh đảo, nhìn xéo xuống 45° về tâm
              focus.set(0, 0, 0);
              camPos.set(Math.cos(phi) * dh, dv, Math.sin(phi) * dh);
            } else {
              // camera người trốn: bám theo nhân vật của mình (đã chết / chưa có thì lùi ra xem toàn đảo)
              const followed = myEnt >= 0 && !!ents?.[myEnt];
              const want = followed ? HIDER_DIST : wideDist;
              hiderDist += (want - hiderDist) * (1 - Math.exp(-dt * 2.5));
              if (followed) focus.set(chars[myEnt].x, 0.6, chars[myEnt].z + 0.5);
              else focus.set(0, 0, 0.3);
              camPos.copy(focus).addScaledVector(camHider, hiderDist);
            }
          }
          if (!camInit) {
            curPos.copy(camPos);
            curFocus.copy(focus);
            camInit = true;
          }
          const rate = kcMode ? 7 : iSeeker ? 30 : 6;
          const ck = 1 - Math.exp(-dt * rate);
          curPos.lerp(camPos, ck);
          curFocus.lerp(focus, ck);
          k.look(curPos, curFocus);
          k.sun.target.position.copy(sunAim);
          k.sun.position.copy(sunAim).add(sunOff);
        },
        dispose() {
          o.host.removeEventListener('pointermove', onMove);
          o.host.removeEventListener('pointerdown', onDown);
          edge.remove();
        },
      };
    },
  );
}
