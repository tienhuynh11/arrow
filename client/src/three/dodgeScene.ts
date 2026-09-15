import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  Shape,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { runScene, tileTexture, type SceneHooks } from './scene';
import type { Character3D } from './character';
import type { ObstacleKind } from '../games/dodge/useDodgeGame';
import type { DodgeConfig, DodgePos } from '../games/dodge/useDodgeGame';

export interface DodgeFrame {
  cfg: DodgeConfig;
  startAt: number;
  lives: Record<string, number>;
  hitAt: Record<string, number>;
  positions: { current: Record<string, DodgePos> };
  predict(serverNow: number): void;
  xOf(id: string): number;
  serverNow(): number;
}

export interface DodgeSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => DodgeFrame;
  labels: Map<string, HTMLElement | null>;
}

/** 1 đơn vị ngang của server = S đơn vị thế giới 3D (sân rộng 100 → 14) */
const S = 0.14;
/** vật thể xuất phát xa phía trước và trên cao, lao dần tới hàng người chơi ở z = 0 */
const FAR_Z = -16;
const SKY_Y = 3;
const HIT_Y = 0.95;
const PITCH = (36 * Math.PI) / 180;

interface Live {
  group: Group;
  reticle: Mesh;
  reticleMat: MeshBasicMaterial;
  kind: ObstacleKind;
  landed: boolean;
}

export function createDodgeScene(o: DodgeSceneOptions) {
  return runScene(o.host, o.hooks, { background: '#0a0b1d', fog: [24, 60], sun: [5, 18, 10], shadowBox: 12 }, (k) => {
    const { scene } = k.engine;
    const first = o.read();
    const cfg = first.cfg;
    const FW = cfg.width * S;
    const wx = (x: number) => (x - cfg.width / 2) * S;

    /* ---------------- sàn đứng + đường băng vật thể lao tới ---------------- */
    const platformTop = k.lit({ map: tileTexture(k, 14, 5, ['#232446', '#2a2b52'], 'rgba(255,107,214,0.55)') });
    const platformSide = k.lit({ color: '#171830' });
    const platform = new Mesh(new BoxGeometry(FW + 1.2, 0.4, 5), [
      platformSide,
      platformSide,
      platformTop,
      platformSide,
      platformSide,
      platformSide,
    ]);
    platform.position.set(0, -0.2, 0.9);
    platform.receiveShadow = true;
    scene.add(platform);

    const runwayTex = k.texture(256, 1024, (g, w, h) => {
      g.fillStyle = '#100d26';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,107,214,0.28)';
      g.lineWidth = 3;
      for (let y = 0; y < h; y += 64) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      g.strokeStyle = 'rgba(76,201,240,0.22)';
      for (let x = 0; x <= w; x += 32) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
    });
    runwayTex.wrapS = runwayTex.wrapT = RepeatWrapping;
    const runway = new Mesh(new PlaneGeometry(FW + 1.2, 30), k.lit({ map: runwayTex }));
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, -0.35, -15.5);
    scene.add(runway);

    // rào neon hai bên
    const railGeo = new BoxGeometry(0.25, 0.3, 34);
    for (const side of [-1, 1]) {
      const rail = new Mesh(railGeo, k.lit({ color: '#2b2d55' }));
      rail.position.set(side * (FW / 2 + 0.75), 0, -13);
      const strip = new Mesh(
        new BoxGeometry(0.1, 0.06, 34),
        new MeshBasicMaterial({ color: side < 0 ? '#ff6bd6' : '#4cc9f0' }),
      );
      strip.position.set(side * (FW / 2 + 0.75), 0.18, -13);
      scene.add(rail, strip);
    }

    // vạch nguy hiểm ngay trước hàng người chơi
    const dashTex = k.texture(512, 16, (g, w, h) => {
      for (let x = 0; x < w; x += 40) {
        g.fillStyle = '#ffd166';
        g.fillRect(x, 0, 22, h);
      }
    });
    const dash = new Mesh(new PlaneGeometry(FW, 0.12), new MeshBasicMaterial({ map: dashTex, transparent: true }));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.02, -0.95);
    scene.add(dash);

    // bầu trời sao: một Points duy nhất
    const starPos: number[] = [];
    for (let i = 0; i < 420; i++) {
      const a = Math.random() * Math.PI;
      const r = 40 + Math.random() * 20;
      starPos.push(Math.cos(a) * r, 4 + Math.random() * 30, -Math.sin(a) * r - 10);
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new Float32BufferAttribute(starPos, 3));
    scene.add(new Points(starGeo, new PointsMaterial({ color: '#dfe8ff', size: 0.16, sizeAttenuation: true })));

    /* ---------------- 8 vật thể lạ 3D (hình khối + vật liệu dùng chung) ---------------- */
    const starShape = new Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 0.5 : 0.22;
      if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    starShape.closePath();
    const starMesh = new ExtrudeGeometry(starShape, { depth: 0.16, bevelEnabled: false });
    starMesh.center();

    const G = {
      ufoDisc: new CylinderGeometry(0.5, 0.4, 0.14, 16),
      ufoDome: new SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      lamp: new SphereGeometry(0.05, 6, 4),
      sawDisc: new CylinderGeometry(0.42, 0.42, 0.06, 20),
      tooth: new ConeGeometry(0.07, 0.16, 4),
      hub: new CylinderGeometry(0.1, 0.1, 0.1, 10),
      blob: new IcosahedronGeometry(0.45, 1),
      crystal: new OctahedronGeometry(0.4, 0),
      ball: new SphereGeometry(0.45, 16, 12),
      iris: new SphereGeometry(0.2, 12, 8),
      pupil: new SphereGeometry(0.1, 8, 6),
      bomb: new SphereGeometry(0.4, 14, 10),
      cap: new CylinderGeometry(0.1, 0.12, 0.12, 8),
      spark: new SphereGeometry(0.08, 6, 4),
      star: starMesh,
      seg: new SphereGeometry(0.22, 10, 8),
      antenna: new CapsuleGeometry(0.02, 0.2, 2, 4),
      reticle: new RingGeometry(0.4, 0.5, 32),
    };
    const M = {
      ufo: k.lit({ color: '#7c9cff' }),
      dome: new MeshBasicMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.8 }),
      lamp: new MeshBasicMaterial({ color: '#fff27a' }),
      saw: k.lit({ color: '#d7dcf0' }),
      hole: new MeshBasicMaterial({ color: '#141a30' }),
      blob: k.lit({ color: '#3ddc97', flatShading: true }),
      crystal: k.lit({ color: '#b388ff', flatShading: true, emissive: '#5b2bb5', emissiveIntensity: 0.35 }),
      eye: k.lit({ color: '#fff1f6' }),
      iris: k.lit({ color: '#ff6bd6' }),
      pupil: new MeshBasicMaterial({ color: '#2b0f28' }),
      bomb: k.lit({ color: '#39415f' }),
      cap: k.lit({ color: '#8e97bd' }),
      spark: new MeshBasicMaterial({ color: '#ff9f43' }),
      star: k.lit({ color: '#ffd166', flatShading: true, emissive: '#ff9f00', emissiveIntensity: 0.25 }),
      worm: k.lit({ color: '#ff9f43', flatShading: true }),
      wormEye: new MeshBasicMaterial({ color: '#2b1400' }),
    };
    const castAll = (g: Group) => {
      if (k.low) return;
      g.traverse((c) => {
        if ((c as Mesh).isMesh) (c as Mesh).castShadow = true;
      });
    };

    const build = (kind: ObstacleKind): Group => {
      const g = new Group();
      const add = (geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0) => {
        const m = new Mesh(geo, mat);
        m.position.set(x, y, z);
        g.add(m);
        return m;
      };
      switch (kind) {
        case 'ufo': {
          add(G.ufoDisc, M.ufo);
          add(G.ufoDome, M.dome, 0, 0.06);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            add(G.lamp, M.lamp, Math.cos(a) * 0.42, -0.02, Math.sin(a) * 0.42);
          }
          g.userData.spinSelf = 2;
          break;
        }
        case 'saw': {
          const tilt = new Group();
          tilt.rotation.x = Math.PI / 2; // lưỡi cưa dựng đứng, quay mặt về phía người chơi
          const spinner = new Group();
          spinner.add(new Mesh(G.sawDisc, M.saw));
          const hub = new Mesh(G.hub, M.hole);
          spinner.add(hub);
          for (let i = 0; i < 12; i++) {
            const pivot = new Group();
            pivot.rotation.y = (i / 12) * Math.PI * 2;
            const tooth = new Mesh(G.tooth, M.saw);
            tooth.position.x = 0.47;
            tooth.rotation.z = -Math.PI / 2;
            pivot.add(tooth);
            spinner.add(pivot);
          }
          tilt.add(spinner);
          g.add(tilt);
          g.userData.spinner = spinner;
          break;
        }
        case 'blob':
          g.userData.wobble = add(G.blob, M.blob);
          break;
        case 'crystal': {
          const c = add(G.crystal, M.crystal);
          c.scale.set(0.8, 1.6, 0.8);
          g.userData.spinner = c;
          break;
        }
        case 'eye': {
          add(G.ball, M.eye);
          const look = new Group();
          const iris = new Mesh(G.iris, M.iris);
          iris.position.z = 0.32;
          const pupil = new Mesh(G.pupil, M.pupil);
          pupil.position.z = 0.44;
          look.add(iris, pupil);
          g.add(look);
          g.userData.look = look;
          break;
        }
        case 'bomb': {
          add(G.bomb, M.bomb);
          add(G.cap, M.cap, 0, 0.42);
          g.userData.spark = add(G.spark, M.spark, 0.1, 0.56);
          break;
        }
        case 'star':
          g.userData.spinner = add(G.star, M.star);
          break;
        case 'worm':
        default: {
          const segs = [add(G.seg, M.worm, -0.34), add(G.seg, M.worm, 0), add(G.seg, M.worm, 0.36)];
          segs[2].scale.setScalar(1.25);
          add(G.pupil, M.wormEye, 0.46, 0.08, 0.2);
          const antL = add(G.antenna, M.worm, 0.34, 0.36, 0.08);
          antL.rotation.z = -0.4;
          const antR = add(G.antenna, M.worm, 0.46, 0.36, -0.08);
          antR.rotation.z = -0.4;
          g.userData.segs = segs;
          break;
        }
      }
      castAll(g);
      return g;
    };

    const animate = (g: Group, t: number, spin: number) => {
      const ud = g.userData;
      if (ud.spinner) ud.spinner.rotation.y = spin;
      if (ud.spinSelf) g.rotation.y = t * ud.spinSelf;
      if (ud.wobble) {
        const w = Math.sin(t * 6) * 0.1;
        ud.wobble.scale.set(1 + w, 1 - w, 1 + w);
      }
      if (ud.spark) ud.spark.scale.setScalar(0.6 + Math.abs(Math.sin(t * 30)) * 0.8);
      if (ud.look) ud.look.rotation.y = Math.sin(t * 2) * 0.35;
      if (ud.segs) (ud.segs as Mesh[]).forEach((s, i) => (s.position.y = Math.sin(t * 8 + i * 1.3) * 0.09));
    };

    // tái sử dụng vật thể theo loại để không tạo/xoá liên tục
    const pool = new Map<ObstacleKind, Live[]>();
    const live = new Map<number, Live>();
    const acquire = (kind: ObstacleKind): Live => {
      const reused = pool.get(kind)?.pop();
      if (reused) {
        reused.landed = false;
        scene.add(reused.group, reused.reticle);
        return reused;
      }
      const reticleMat = new MeshBasicMaterial({
        color: '#ff4d6d',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      const reticle = new Mesh(G.reticle, reticleMat);
      reticle.rotation.x = -Math.PI / 2;
      const item: Live = { group: build(kind), reticle, reticleMat, kind, landed: false };
      scene.add(item.group, reticle);
      return item;
    };
    const release = (id: number) => {
      const item = live.get(id);
      if (!item) return;
      live.delete(id);
      scene.remove(item.group, item.reticle);
      if (!pool.has(item.kind)) pool.set(item.kind, []);
      pool.get(item.kind)!.push(item);
    };

    /* ---------------- nhân vật ---------------- */
    interface Entry {
      c: Character3D;
      x: number;
      prevX: number;
      placed: boolean;
      lastHit: number;
    }
    const chars = new Map<string, Entry>();
    for (const p of o.players) {
      const c = k.kit.create(p.color, p.id === o.meId);
      c.setShadows(!k.low);
      c.setYaw(Math.PI); // quay mặt về phía vật thể đang lao tới
      scene.add(c.root);
      chars.set(p.id, { c, x: 0, prevX: 0, placed: false, lastHit: first.hitAt[p.id] ?? 0 });
    }
    k.onTier((tier) => {
      for (const e of chars.values()) e.c.setShadows(tier !== 'low');
    });

    let cursor = 0;
    const camTarget = new Vector3(0, 0.9, -4);
    const camPos = new Vector3();
    const flashColor = new Color('#ffd166');
    const hotColor = new Color('#ff2d55');

    return {
      frame(dt, time) {
        const f = o.read();
        const now = f.serverNow();
        f.predict(now);
        const rel = now - f.startAt;
        const t = rel / 1000;
        const obs = f.cfg.obstacles;

        // bỏ các vật đã bay qua hẳn
        while (cursor < obs.length && 1 - (obs[cursor].t - rel) / obs[cursor].travel > 1.35) {
          release(obs[cursor].id);
          cursor += 1;
        }

        for (let i = cursor; i < obs.length; i++) {
          const ob = obs[i];
          const p = 1 - (ob.t - rel) / ob.travel;
          if (p < -0.05) break; // các vật sau còn xa hơn nữa
          let item = live.get(ob.id);
          if (!item) {
            item = acquire(ob.kind);
            live.set(ob.id, item);
          }
          const elapsed = (ob.travel * Math.min(p, 1)) / 1000;
          const x = wx(ob.x0 + ob.vx * elapsed);
          const landX = wx(ob.x0 + (ob.vx * ob.travel) / 1000);
          const size = ob.w * S;

          let y: number;
          let z: number;
          let s = size;
          if (p <= 1) {
            // bay vòng cung từ trên cao phía xa xuống tới hàng người chơi
            const q = Math.max(0, 1 - p);
            z = FAR_Z * q;
            y = HIT_Y + SKY_Y * q * q;
          } else {
            const over = p - 1;
            z = over * 12;
            y = HIT_Y - over * 2.5;
            s = size * Math.max(0, 1 - over * 3);
          }
          item.group.position.set(x, y, z);
          item.group.scale.setScalar(Math.max(0.001, s));
          animate(item.group, t + ob.id * 0.37, ((ob.spin * elapsed) / 180) * Math.PI);

          // vòng báo chỗ sắp đáp: hiện dần, chuyển đỏ khi sắp tới
          const warn = Math.max(0, Math.min(1, (p - 0.3) / 0.55));
          item.reticle.position.set(landX, 0.03, 0);
          item.reticle.scale.setScalar(size * (1.25 - warn * 0.25));
          item.reticleMat.opacity = p > 1 ? 0 : warn * 0.85;
          item.reticleMat.color.copy(flashColor).lerp(hotColor, warn);

          if (!item.landed && p >= 1) {
            item.landed = true;
            k.effects.burst(landX, 0.3, 0.2, {
              count: k.count(10),
              palette: ['#8a8fb3', '#c9cde6', '#ffd166'],
              speed: 3,
              life: 0.45,
              size: 0.12,
            });
          }
        }

        let meX = 0;
        for (const pl of o.players) {
          const e = chars.get(pl.id)!;
          const target = wx(f.xOf(pl.id));
          if (!e.placed || pl.id === o.meId) {
            e.x = target;
            if (!e.placed) e.prevX = target;
            e.placed = true;
          } else {
            e.x += (target - e.x) * (1 - Math.exp(-dt * 14));
          }
          const vx = (e.x - e.prevX) / Math.max(dt, 1e-3);
          e.prevX = e.x;
          const dead = (f.lives[pl.id] ?? f.cfg.lives) <= 0;
          const hurt = Date.now() - (f.hitAt[pl.id] ?? 0) < 450 || !!f.positions.current[pl.id]?.stunned;
          const speed = dead ? 0 : Math.min(1, Math.abs(vx) / (f.cfg.speed * S));

          e.c.root.position.set(e.x, 0, 0);
          if (!dead) e.c.face(vx, -1.6, dt); // mặt luôn hướng về phía trước, nghiêng theo hướng chạy
          e.c.update(dt, { speed, dead, time, pose: hurt ? 'hit' : 'run' });
          if (pl.id === o.meId) meX = e.x;

          const hit = f.hitAt[pl.id] ?? 0;
          if (hit > e.lastHit) {
            e.lastHit = hit;
            k.effects.burst(e.x, 1.1, 0, {
              count: k.count(28),
              palette: ['#ff2d55', '#ffffff', '#ff9f43'],
              speed: 5,
              life: 0.55,
              size: 0.16,
            });
            k.shake(pl.id === o.meId ? 0.4 : 0.1);
          }
          k.label(o.labels.get(pl.id), e.x, 2.25, 0);
        }

        // camera sau lưng, khẽ bám theo mình
        camTarget.x += (meX * 0.25 - camTarget.x) * (1 - Math.exp(-dt * 3));
        const dist = Math.max(k.fit(FW / 2 + 1.4, 6, PITCH), 12.5);
        camPos.set(camTarget.x, camTarget.y + Math.sin(PITCH) * dist, camTarget.z + Math.cos(PITCH) * dist);
        k.look(camPos, camTarget);
      },

      dispose() {
        for (const id of [...live.keys()]) release(id);
        for (const items of pool.values()) for (const item of items) item.reticleMat.dispose();
        for (const g of Object.values(G)) g.dispose();
        for (const m of Object.values(M)) m.dispose();
      },
    };
  });
}
