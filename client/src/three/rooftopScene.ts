import {
  BoxGeometry,
  Color,
  ConeGeometry,
  SphereGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { runScene, type SceneHooks } from './scene';
import { createFighterKit, type Fighter } from './fighterRig';
import { createRooftopFx, type FxChar } from './rooftopFx';
import {
  F_DOWN,
  F_OUT,
  F_PUNCH,
  F_STUN,
  RT_CHARS,
  SB_ARMOR,
  SB_HASTE,
  SB_RAGE,
  SB_SHIELD,
  SPEED,
  type RtChar,
  type RtConfig,
} from '@shared/rooftop';
import type { BananaPos, RtFx, RtPos } from '../games/rooftop/useRooftopGame';

export interface RooftopFrame {
  cfg: RtConfig;
  startAt: number;
  positions: { current: Record<string, RtPos> };
  fx: { current: RtFx[] };
  bananas: { current: Map<number, BananaPos> };
  stamps: { current: { punch: number; skill: number; which: 1 | 2 } };
  cam: { current: { yaw: number; pitch: number } };
  bodyYaw: { current: number };
  lockId: { current: string };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number; z: number; face: number; flags: number; vx: number; vy: number; wob: number; hp: number; sb: number } | undefined;
  serverNow(): number;
}

export interface RooftopSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  players: { id: string; color: string }[];
  meId: string;
  read: () => RooftopFrame;
  labels: Map<string, HTMLElement | null>;
  /** nhãn HTML cho số sát thương / tên chiêu */
  popups: HTMLElement[];
  overlay: () => HTMLElement | null;
}

const ROAD_Y = -3.45;
const PASTEL = ['#ffb3c7', '#ffd48a', '#a8e6cf', '#9ec9ff', '#d5b3ff', '#fff2a1', '#ffa07a', '#8fe0d8'];
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/**
 * Cảnh TĨNH: xe tải đậu trên đường phố, nóc xe là sàn đấu. Phần nền (đường, cây, cột đèn, nhà, biển báo) dựng một lần
 * bằng vài InstancedMesh và không bao giờ cập nhật lại; mỗi khung chỉ có nhân vật + hạt hiệu ứng + nóc xe thu hẹp.
 */
export function createRooftopScene(o: RooftopSceneOptions) {
  const first = o.read();
  const cfg = first.cfg;
  const L = cfg.L;
  const HALF_W = cfg.hw;
  const total = o.players.length;

  return runScene(
    o.host,
    o.hooks,
    {
      stage: { name: 'day', area: [40, 60], groundY: ROAD_Y, ground: false },
      sun: [-9, 22, 10],
      shadowBox: 13,
      fog: [60, 230],
    },
    (k) => {
      const { scene } = k.engine;
      const dummy = new Object3D();
      const rand = seeded(2024);
      const disposables: { dispose(): void }[] = [];
      const own = <T extends { dispose(): void }>(x: T): T => {
        disposables.push(x);
        return x;
      };
      const geoBox = own(new BoxGeometry(1, 1, 1));
      const geoCyl = own(new CylinderGeometry(1, 1, 1, 8));
      const geoCone = own(new ConeGeometry(1, 1, 8));
      const geoSph = own(new SphereGeometry(1, 10, 8));

      /* ---------------- đất + đường (tĩnh) ---------------- */
      const grass = new Mesh(own(new PlaneGeometry(500, 500)), own(new MeshBasicMaterial({ color: '#76db58' })));
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(0, ROAD_Y - 0.06, -100);
      scene.add(grass);
      const road = new Mesh(own(new PlaneGeometry(40, 500)), own(new MeshBasicMaterial({ color: '#4a4f5c' })));
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, ROAD_Y, -100);
      scene.add(road);

      /* ---------------- nền tĩnh: InstancedMesh ---------------- */
      const mats = {
        white: own(new MeshBasicMaterial({ color: '#ffffff' })),
        lamp: k.lit({ color: '#6b7488' }),
        lampHead: own(new MeshBasicMaterial({ color: '#fff3a8' })),
        trunk: k.lit({ color: '#8a5a35' }),
        tinted: k.lit({ color: '#ffffff' }),
      };
      disposables.push(...Object.values(mats));
      const col = new Color();
      type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number; c?: string };
      const stat = (geo: BoxGeometry | CylinderGeometry | ConeGeometry, mat: MeshBasicMaterial | Mesh['material'], items: Item[]) => {
        const m = new InstancedMesh(geo, mat as Mesh['material'], items.length);
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z);
          dummy.scale.set(it.sx, it.sy, it.sz);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          if (it.c) m.setColorAt(i, col.set(it.c));
        });
        m.instanceMatrix.needsUpdate = true;
        m.frustumCulled = false;
        scene.add(m);
        return m;
      };
      const zs = [-90, -60, -30, 0, 30, 60];
      const dashes: Item[] = [];
      for (const s of [-1, 1]) for (let z = -120; z < 60; z += 8) dashes.push({ x: s * 11.5, y: ROAD_Y + 0.03, z, sx: 0.28, sy: 0.02, sz: 3.2 });
      stat(geoBox, mats.white, dashes);
      const poles: Item[] = [];
      const heads: Item[] = [];
      const trunks: Item[] = [];
      const crowns: Item[] = [];
      const builds: Item[] = [];
      for (const s of [-1, 1]) {
        for (const z of [-80, -40, 0, 40]) {
          poles.push({ x: s * 18.8, y: ROAD_Y + 3.2, z, sx: 0.14, sy: 6.4, sz: 0.14 });
          heads.push({ x: s * 18.0, y: ROAD_Y + 6.4, z, sx: 1.6, sy: 0.18, sz: 0.5 });
        }
        for (const zb of zs) {
          for (let i = 0; i < 2; i++) {
            const x = s * (21 + rand() * 5);
            const z = zb - i * 14 - rand() * 6;
            const h = 3 + rand() * 2.5;
            trunks.push({ x, y: ROAD_Y + 0.9, z, sx: 0.28, sy: 1.8, sz: 0.28 });
            crowns.push({ x, y: ROAD_Y + 1.8 + h / 2, z, sx: 1.5 + rand() * 0.8, sy: h, sz: 1.5 + rand() * 0.8, c: rand() > 0.5 ? '#3fbf5a' : '#58d36b' });
          }
          const h = 8 + rand() * 24;
          builds.push({ x: s * (30 + rand() * 12), y: ROAD_Y + h / 2, z: zb - 8 - rand() * 6, sx: 8 + rand() * 7, sy: h, sz: 11 + rand() * 5, c: PASTEL[Math.floor(rand() * PASTEL.length)] });
        }
      }
      stat(geoCyl, mats.lamp, poles);
      stat(geoBox, mats.lampHead, heads);
      stat(geoCyl, mats.trunk, trunks);
      stat(geoCone, mats.tinted, crowns);
      stat(geoBox, mats.tinted, builds);
      const sPost: Item[] = [];
      const sBoard: Item[] = [];
      for (const s of [-1, 1]) {
        sPost.push({ x: s * 16.6, y: ROAD_Y + 1.6, z: -20, sx: 0.1, sy: 3.2, sz: 0.1 });
        sBoard.push({ x: s * 16.6, y: ROAD_Y + 3.0, z: -20, sx: 1.5, sy: 1.1, sz: 0.1, c: s > 0 ? '#2f80ed' : '#ffb627' });
      }
      stat(geoBox, mats.lamp, sPost);
      stat(geoBox, mats.tinted, sBoard);

      /* ---------------- xe tải đậu ---------------- */
      const veh = new Group();
      scene.add(veh);
      const roofTex = k.texture(256, 512, (g, w, h) => {
        g.fillStyle = '#cfd6e4';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(80,95,125,0.35)';
        g.lineWidth = 3;
        for (let y = 0; y <= h; y += h / 8) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        for (let x = 0; x <= w; x += w / 3) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        }
        const b = 22;
        for (let i = 0; i < Math.max(w, h) / 20; i++) {
          g.fillStyle = i % 2 ? '#222' : '#ffcf33';
          g.fillRect(i * 20, 0, 20, b);
          g.fillRect(i * 20, h - b, 20, b);
          g.fillRect(0, i * 20, b, 20);
          g.fillRect(w - b, i * 20, b, 20);
        }
      });
      const side = k.lit({ color: '#b8c0d4' });
      disposables.push(side);
      const roof = new Mesh(geoBox, [side, side, k.lit({ map: roofTex }), side, side, side]);
      roof.scale.set(HALF_W * 2, 0.4, L);
      roof.position.set(0, -0.2, 0);
      roof.receiveShadow = true;
      veh.add(roof);
      const mk = (color: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, basic = false) => {
        const m = new Mesh(geoBox, basic ? own(new MeshBasicMaterial({ color })) : k.lit({ color }));
        m.scale.set(sx, sy, sz);
        m.position.set(x, y, z);
        veh.add(m);
        return m;
      };
      mk('#3a7bd5', HALF_W * 2 - 0.15, 2.7, L, 0, -1.75, 0);
      mk('#ffb627', HALF_W * 2 - 0.05, 0.35, L + 0.02, 0, -1.0, 0);
      mk('#2b2f3d', HALF_W * 2 - 0.9, 0.5, L + 3.6, 0, -3.3, -1.8);
      mk('#ef5b4b', HALF_W * 2 - 0.1, 3.9, 3.4, 0, -1.15, -(L / 2 + 1.7));
      mk('#bfe8ff', HALF_W * 2 - 0.5, 0.7, 0.12, 0, 0.4, -(L / 2 + 3.45));
      const wheelGeo = own(new CylinderGeometry(0.9, 0.9, 0.7, 14));
      wheelGeo.rotateZ(Math.PI / 2);
      const wheels = new InstancedMesh(wheelGeo, k.lit({ color: '#20232e' }), 8);
      let wi = 0;
      for (const z of [L / 2 - 1.4, 0.2, -L / 2 + 1.4, -(L / 2 + 2.3)]) {
        for (const s of [-1, 1]) {
          dummy.position.set(s * (HALF_W - 0.25), ROAD_Y + 0.9, z);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          wheels.setMatrixAt(wi++, dummy.matrix);
        }
      }
      wheels.count = wi;
      veh.add(wheels);

      /* lan can kín bao quanh nóc xe (tường vô hình ở phía server): một InstancedMesh duy nhất */
      const sides: { x0: number; z0: number; x1: number; z1: number }[] = [
        { x0: -HALF_W, z0: -L / 2, x1: -HALF_W, z1: L / 2 },
        { x0: HALF_W, z0: -L / 2, x1: HALF_W, z1: L / 2 },
        { x0: -HALF_W, z0: L / 2, x1: HALF_W, z1: L / 2 },
        { x0: -HALF_W, z0: -L / 2, x1: HALF_W, z1: -L / 2 },
      ];
      const lenOf = (sd: (typeof sides)[number]) => Math.hypot(sd.x1 - sd.x0, sd.z1 - sd.z0);
      const nPosts = sides.reduce((n, sd) => n + 2 + Math.floor(lenOf(sd) / 1.8), 0);
      const rails = new InstancedMesh(geoBox, k.lit({ color: '#ffcf33' }), nPosts + 8);
      let ri = 0;
      const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
        dummy.position.set(x, y, z);
        dummy.scale.set(sx, sy, sz);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        rails.setMatrixAt(ri++, dummy.matrix);
      };
      for (const sd of sides) {
        const len = lenOf(sd);
        const alongX = Math.abs(sd.x1 - sd.x0) > 0.01;
        const cx = (sd.x0 + sd.x1) / 2;
        const cz = (sd.z0 + sd.z1) / 2;
        put(cx, 0.82, cz, alongX ? len : 0.1, 0.1, alongX ? 0.1 : len);
        put(cx, 0.45, cz, alongX ? len : 0.1, 0.07, alongX ? 0.07 : len);
        const cnt = 2 + Math.floor(len / 1.8);
        for (let i = 0; i < cnt; i++) {
          const kk = i / (cnt - 1);
          put(sd.x0 + (sd.x1 - sd.x0) * kk, 0.42, sd.z0 + (sd.z1 - sd.z0) * kk, 0.12, 0.84, 0.12);
        }
      }
      rails.count = ri;
      rails.frustumCulled = false;
      veh.add(rails);

      const popups = o.popups;
      const fxLib = createRooftopFx({ k, scene, meId: o.meId, popups, overlay: o.overlay });
      disposables.push(fxLib);
      const auraMats = fxLib.auraMats;

      // vỏ chuối: dùng lại 8 mesh, bay vòng cung khi vừa ném
      const bananaMat = own(new MeshBasicMaterial({ color: '#ffe14d' }));
      const bananaMeshes: Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const m = new Mesh(geoBox, bananaMat);
        m.scale.set(0.5, 0.12, 0.2);
        m.visible = false;
        scene.add(m);
        bananaMeshes.push(m);
      }

      /* ---------------- nhân vật: bộ rig riêng có khớp (fighterRig) ---------------- */
      const fighterKit = createFighterKit(k);
      disposables.push(fighterKit);
      interface Entry {
        f: Fighter;
        pivot: Group;
        x: number;
        y: number;
        z: number;
        yaw: number;
        placed: boolean;
        hitAt: number;
        freeze: number;
        koAt: number;
        aura: Mesh;
        ch: RtChar;
        lastPunch: boolean;
        punchIdx: number;
        punchAt: number;
        localUntil: number;
        localSkillUntil: number;
        prevZ: number;
      }
      const chars = new Map<string, Entry>();
      let stampPunch = 0;
      let stampSkill = 0;
      o.players.forEach((p) => {
        const ch = RT_CHARS[cfg.chars[p.id] ?? 0];
        const f = fighterKit.create(ch.id, p.color, p.id === o.meId);
        f.setShadows(!k.low);
        const pivot = new Group();
        pivot.visible = false;
        pivot.scale.setScalar(ch.scale);
        pivot.add(f.root);
        const aura = new Mesh(geoSph, auraMats.shield);
        aura.scale.set(1.15, 1.25, 1.15);
        aura.position.y = 1.0;
        aura.visible = false;
        pivot.add(aura);
        veh.add(pivot);
        chars.set(p.id, { f, pivot, x: 0, y: 0, z: 0, yaw: 0, placed: false, hitAt: -1e9, freeze: 0, koAt: -1, aura, ch, lastPunch: false, punchIdx: 0, punchAt: -1e9, localUntil: 0, localSkillUntil: 0, prevZ: 0 });
      });
      k.onTier((tier) => {
        for (const e of chars.values()) e.f.setShadows(tier !== 'low');
      });
      const outSet = new Set<string>();
      const fxList: FxChar[] = o.players.map((p) => ({ id: p.id, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, sb: 0, out: false, scale: 1, ch: RT_CHARS[cfg.chars[p.id] ?? 0] }));
      const SKILL_DUR: Record<string, number> = { bull1: 0.6, bull2: 0.75, bear1: 0.8, bear2: 0.5, fox1: 0.4, fox2: 0.5, turtle1: 0.5, turtle2: 1.6, monkey1: 0.9, monkey2: 0.5, tiger1: 0.45, tiger2: 0.7, rooster1: 0.65, rooster2: 0.55 };
      const skillDur = (ev: any) => SKILL_DUR[(ev.ch ?? '') + (ev.s ?? 1)] ?? 0.55;
      const spawn0 = cfg.spawns[o.meId] ?? [0, 0, 0];
      const focus = new Vector3(spawn0[0], 0, -spawn0[1]);
      const camPos = new Vector3();
      const lookAt = new Vector3();
      const sunOff = new Vector3(-9, 22, 10);
      let camDist = 5.6;
      const lockMark = new Mesh(own(new ConeGeometry(0.22, 0.45, 4)), own(new MeshBasicMaterial({ color: '#ff3b3b' })));
      lockMark.rotation.x = Math.PI;
      lockMark.visible = false;
      scene.add(lockMark);

      const burst = (x: number, y: number, z: number, n: number, palette: string[], speed = 3.5, life = 0.7, grav = 8) =>
        k.effects.burst(x, y, -z, { count: k.count(n), palette, speed, life, size: 0.2, gravity: grav });
      const spring = (a: number, v: number, dt: number, kk: number, cc: number): [number, number] => {
        v += (-kk * a - cc * v) * dt;
        return [a + v * dt, v];
      };

      return {
        frame(dt, time) {
          dt = Math.min(dt, 0.05);
          const f = o.read();
          const now = f.serverNow();
          f.predict(now);

          /* danh sách nhân vật cho hiệu ứng (toạ độ server) */
          let li = 0;
          for (const p of o.players) {
            const at = f.posOf(p.id);
            const e = chars.get(p.id)!;
            const fc = fxList[li++];
            if (!at) continue;
            fc.x = e.placed ? e.x : at.x;
            fc.y = e.placed ? e.y : at.y;
            fc.z = at.z;
            fc.yaw = at.face;
            fc.vx = at.vx;
            fc.vy = at.vy;
            fc.sb = at.sb;
            fc.out = outSet.has(p.id) || !!(at.flags & F_OUT);
            fc.scale = e.ch.scale;
          }
          fxLib.update(dt, time, fxList);

          // vỏ chuối: bay vòng cung rồi nằm trên sàn
          let bi = 0;
          const tNow = performance.now();
          for (const bn of f.bananas.current.values()) {
            if (bi >= bananaMeshes.length) break;
            const m = bananaMeshes[bi++];
            m.visible = true;
            const age = (tNow - bn.born) / 1000;
            if (bn.fx !== undefined && age < 0.4) {
              const u = age / 0.4;
              m.position.set(bn.fx + (bn.x - bn.fx) * u, 0.5 + 1.8 * 4 * u * (1 - u), -(bn.fy! + (bn.y - bn.fy!) * u));
              m.rotation.set(u * 9, u * 7, 0);
            } else {
              m.position.set(bn.x, 0.08 + Math.sin(time * 4 + bn.x) * 0.02, -bn.y);
              m.rotation.set(0, bn.x * 3.1, 0);
            }
          }
          for (; bi < bananaMeshes.length; bi++) bananaMeshes[bi].visible = false;

          /* ---------------- sự kiện từ server ---------------- */
          const list = f.fx.current;
          while (list.length) {
            const ev = list.shift()!;
            if (ev.kind === 'out') {
              outSet.add(ev.playerId);
              const e = chars.get(ev.playerId);
              const fc = fxList.find((x) => x.id === ev.playerId);
              if (e) {
                e.koAt = time;
                fxLib.onKo(fc, ev.x ?? 0, ev.y ?? 0);
              }
              continue;
            }
            fxLib.onFx(ev);
            const va = chars.get(ev.a);
            const vb = ev.b ? chars.get(ev.b) : undefined;
            if (ev.k === 'hit' && vb) {
              const big = ev.tag === 'combo' || ev.tag === 'charge' || ev.tag === 'slam' || ev.tag === 'kick' || ev.tag === 'pounce' || !!ev.counter;
              vb.hitAt = time;
              vb.freeze = time + (big ? 0.11 : 0.05);
              vb.f.hit(ev.dx ?? 0, -(ev.dy ?? 0), ev.force ?? 4); // bị đánh: ngả / giật theo HƯỚNG LỰC
              if (va) va.freeze = time + (big ? 0.08 : 0.04);
            } else if (ev.k === 'skill' && va) {
              if (!(ev.a === o.meId && time < va.localSkillUntil)) va.f.skill(ev.ch + ev.s, skillDur(ev));
            }
          }

          /* ---------------- nhân vật ---------------- */
          const aliveCount = total - outSet.size;
          let meX = focus.x;
          let meY = focus.y;
          let meZ = focus.z;
          let meOut = outSet.has(o.meId);
          for (const p of o.players) {
            const e = chars.get(p.id)!;
            const at = f.posOf(p.id);
            if (!at) {
              e.pivot.visible = false;
              continue;
            }
            const fl = at.flags;
            const isMe = p.id === o.meId;
            const out = !!(fl & F_OUT) || outSet.has(p.id);
            if (!e.placed) {
              e.x = at.x;
              e.y = at.y;
              e.z = at.z;
              e.yaw = Math.PI - at.face;
              e.placed = true;
              e.prevZ = at.z;
            } else {
              const far = Math.hypot(at.x - e.x, at.y - e.y) > 2.5;
              const kk = far || isMe ? 1 : 1 - Math.exp(-dt * 18);
              e.x += (at.x - e.x) * kk;
              e.y += (at.y - e.y) * kk;
              e.z += (at.z - e.z) * (far || isMe ? 1 : 1 - Math.exp(-dt * 24));
            }
            const down = !!(fl & F_DOWN);
            const stunned = !!(fl & F_STUN) || time - e.hitAt < 0.5;
            const grounded = e.z < 0.08;
            const spd = Math.hypot(at.vx, at.vy);

            // thân theo hướng client tính (chạy / khoá mục tiêu / hướng đánh), không chờ server, trừ lúc choáng / ngã
            // hướng server (sin y, cos y) ↔ mặt nhân vật trong cảnh ở yaw a nhìn (sin a, cos a) với a = π - y
            const ownYaw = isMe && !(fl & (F_STUN | F_DOWN | F_OUT)) && time - e.hitAt >= 0.5;
            const wantYaw = ownYaw ? Math.PI - f.bodyYaw.current : Math.PI - at.face;
            e.yaw += angDiff(e.yaw, wantYaw) * (ownYaw ? 1 - Math.exp(-dt * 60) : 1 - Math.exp(-dt * 18));

            /* ---- hoạt hình thủ tục (fighterRig): đứng / chạy / nhảy / đấm / skill / bị đánh / ngã ---- */
            const punching = !!(fl & F_PUNCH);
            // nhân vật của mình: ra đòn NGAY khi bấm (không chờ server)
            if (isMe) {
              if (f.stamps.current.punch !== stampPunch) {
                stampPunch = f.stamps.current.punch;
                if (time > e.localUntil && !down) {
                  e.punchIdx = time - e.punchAt < 0.9 ? (e.punchIdx + 1) % 3 : 0;
                  e.punchAt = time;
                  e.f.punch(e.punchIdx);
                  e.localUntil = time + 0.2;
                }
              }
              if (f.stamps.current.skill !== stampSkill) {
                stampSkill = f.stamps.current.skill;
                const pm = f.positions.current[o.meId];
                const which = f.stamps.current.which;
                if (pm && pm[8 + which] === 0 && !down) {
                  e.f.skill(e.ch.id + which, SKILL_DUR[e.ch.id + which] ?? 0.55);
                  e.localSkillUntil = time + 0.35;
                }
              }
            }
            if (punching && !e.lastPunch && !(isMe && time < e.localUntil + 0.3)) {
              e.punchIdx = time - e.punchAt < 0.9 ? (e.punchIdx + 1) % 3 : 0;
              e.punchAt = time;
              e.f.punch(e.punchIdx);
            }
            e.lastPunch = punching;
            const dtA = time < e.freeze ? dt * 0.05 : dt;
            e.f.setYaw(e.yaw);
            e.f.update(dtA, {
              time,
              vx: at.vx,
              vz: -at.vy,
              yaw: e.yaw,
              grounded,
              vy: (e.z - e.prevZ) / Math.max(dt, 1e-3),
              stunned,
              down,
              out,
              cheer: aliveCount <= 1 && !out && total > 1,
              wob: at.wob,
            });
            e.prevZ = e.z;
            const piv = e.pivot;
            piv.position.set(e.x, e.z, -e.y);
            // KO: bay lên xoay tròn rồi tan
            if (out && e.koAt >= 0) {
              const u = (time - e.koAt) / 1.3;
              piv.position.y = e.z + Math.max(0, Math.min(1, u)) * 4.5;
              piv.rotation.y = u * 10;
              piv.scale.setScalar(e.ch.scale * Math.max(0.01, 1 - Math.max(0, u - 0.4) / 0.6));
            } else {
              piv.rotation.y = 0;
              piv.scale.setScalar(e.ch.scale);
            }
            piv.visible = !out || (e.koAt >= 0 && time - e.koAt < 1.3);

            // hào quang kỹ năng
            const sb = at.sb;
            const aura = sb & SB_SHIELD ? auraMats.shield : sb & SB_ARMOR ? auraMats.armor : sb & SB_RAGE ? auraMats.rage : sb & SB_HASTE ? auraMats.haste : null;
            e.aura.visible = !!aura && !out;
            if (aura) e.aura.material = aura;

            const lab = o.labels.get(p.id);
            if (!out) {
              k.label(lab, e.x, e.z + 2.1 * e.ch.scale + 0.3, -e.y);
              if (lab) lab.style.setProperty('--hp', String(Math.max(0, Math.min(100, (at.hp / e.ch.hp) * 100))));
            } else if (lab) lab.style.opacity = '0';
            if (isMe) {
              meX = e.x;
              meY = e.z;
              meZ = -e.y;
              meOut = out;
            }
          }

          /* ---------------- camera góc nhìn thứ ba bằng chuột ---------------- */
          const c = f.cam.current;
          // pivot ở ngực nhân vật (nhân vật nằm giữa khung hình); đang khoá mục tiêu thì pivot lệch nhẹ về phía mục tiêu
          let tx = meOut ? 0 : meX;
          const ty = meOut ? 0.4 : meY;
          let tz = meOut ? 0 : meZ;
          const lockE = !meOut && f.lockId.current ? chars.get(f.lockId.current) : undefined;
          if (lockE) {
            tx += (lockE.x - tx) * 0.2;
            tz += (-lockE.y - tz) * 0.2;
          }
          const lk2 = 1 - Math.exp(-dt * 12);
          focus.x += (tx - focus.x) * lk2;
          focus.y += (ty - focus.y) * lk2;
          focus.z += (tz - focus.z) * lk2;
          camDist += ((meOut ? 13 : lockE ? 6.4 : 5.6) - camDist) * (1 - Math.exp(-dt * 3));
          const cp = Math.cos(c.pitch);
          const sp2 = Math.sin(c.pitch);
          const fx3 = Math.sin(c.yaw);
          const fz3 = -Math.cos(c.yaw);
          camPos.set(focus.x - fx3 * camDist * cp, Math.max(0.5, focus.y + 1.3 + camDist * sp2), focus.z - fz3 * camDist * cp);
          lookAt.set(focus.x, focus.y + 1.3, focus.z);
          // marker khoá mục tiêu
          lockMark.visible = !!lockE;
          if (lockE) lockMark.position.set(lockE.x, lockE.z + 2.9 + Math.sin(time * 5) * 0.08, -lockE.y);
          k.look(camPos, lookAt);

          k.sun.target.position.copy(focus);
          k.sun.position.copy(focus).add(sunOff);
        },
        dispose() {
          for (const d of disposables) d.dispose();
        },
      };
    },
  );
}
