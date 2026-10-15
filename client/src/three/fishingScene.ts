import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type CanvasTexture,
} from 'three';
import { SPECIES, ST_BITE, ST_IDLE, ST_NIB, ST_REEL, ST_STUN, ST_WAIT } from '@shared/fishing';
import { runScene, type SceneHooks } from './scene';
import type { Character3D, Pose } from './character';
import type { FishingCore } from '../games/fishing/core';

export interface FishingSceneOptions {
  host: HTMLElement;
  hooks: SceneHooks;
  core: FishingCore;
  players: { id: string; color: string }[];
  meId: string;
  labels: Map<string, HTMLElement | null>;
  /** chế độ giảm đồ hoạ: bỏ bóng, cây cối, hạt nước, cá bơi nền, hạ độ phân giải */
  lite: boolean;
}

const R = 6.2;
const LINE_PTS = 14;
const TAU = Math.PI * 2;

interface Held {
  sprite: Sprite;
  t0: number;
  from: Vector3;
  until: number;
  trash: boolean;
}

interface Seat {
  id: string;
  i: number;
  color: string;
  char: Character3D;
  stand: Vector3;
  dir: Vector3;
  tan: Vector3;
  spot: Vector3;
  tip: Vector3;
  rod: Mesh;
  line: Line;
  linePos: Float32Array;
  bobber: Group;
  bobPos: Vector3;
  shadow: Mesh;
  exclaim: Sprite;
  shield: Mesh;
  held: Held | null;
  castT: number;
  castFrom: Vector3;
  pose: Pose;
  poseUntil: number;
  lastSt: number;
  ringAt: number;
  lastTag: string;
  tag: HTMLElement | null;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createFishingScene(o: FishingSceneOptions) {
  const core = o.core;
  const lite = o.lite;
  return runScene(o.host, o.hooks, { background: '#a8e0ff', fog: [34, 90], sun: [-8, 18, 10], shadowBox: 13 }, (k) => {
    const { scene, camera, renderer } = k.engine;
    if (lite) renderer.setPixelRatio(1);
    const n = Math.max(1, o.players.length);

    /* ---------------- mặt đất + hồ ---------------- */
    const grass = new Mesh(new CircleGeometry(40, 40), k.lit({ color: '#5fae4e' }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.06;
    grass.receiveShadow = true;
    scene.add(grass);

    const sand = new Mesh(new RingGeometry(R - 0.2, R + 3.4, 56), k.lit({ color: '#e3cc92' }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -0.03;
    sand.receiveShadow = true;
    scene.add(sand);

    const bed = new Mesh(new CircleGeometry(R + 0.1, 48), new MeshBasicMaterial({ color: '#0d4a63' }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -0.4;
    scene.add(bed);

    const waterTex = k.texture(256, 256, (g, w, h) => {
      g.fillStyle = '#3aaedc';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const x = hash(i) * w;
        const y = hash(i + 50) * h;
        g.beginPath();
        g.arc(x, y, 10 + hash(i + 9) * 22, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
    });
    waterTex.wrapS = waterTex.wrapT = RepeatWrapping;
    waterTex.repeat.set(2.6, 2.6);
    const waterMat = new MeshBasicMaterial({ map: waterTex, transparent: true, opacity: 0.86 });
    const water = new Mesh(new CircleGeometry(R, 56), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.0;
    scene.add(water);

    /* ---------------- cây quanh hồ (bỏ khi giảm đồ hoạ) ---------------- */
    if (!lite) {
      const trunkG = new CylinderGeometry(0.14, 0.2, 1.2, 6);
      const leafG = new ConeGeometry(0.9, 2.4, 7);
      const treeCount = 16;
      const trunks = new InstancedMesh(trunkG, k.lit({ color: '#8a5a2c' }), treeCount);
      const leaves = new InstancedMesh(leafG, k.lit({ color: '#2f8f46', flatShading: true }), treeCount);
      const m = new Matrix4();
      for (let i = 0; i < treeCount; i++) {
        const a = (i / treeCount) * TAU + hash(i) * 0.3;
        const d = R + 7.5 + hash(i + 7) * 5;
        const s = 0.8 + hash(i + 3) * 0.8;
        m.makeScale(s, s, s).setPosition(Math.cos(a) * d, 0.6 * s, Math.sin(a) * d * 0.9 - 2);
        trunks.setMatrixAt(i, m);
        m.makeScale(s, s, s).setPosition(Math.cos(a) * d, 2.1 * s, Math.sin(a) * d * 0.9 - 2);
        leaves.setMatrixAt(i, m);
      }
      scene.add(trunks, leaves);
    }

    /* ---------------- cá bơi dưới nước (nền) ---------------- */
    const AMBIENT = lite ? 0 : k.count(14);
    const ambGeo = new SphereGeometry(0.28, 8, 6);
    ambGeo.scale(1.8, 0.35, 0.8);
    const amb = new InstancedMesh(ambGeo, new MeshBasicMaterial({ color: '#0c5d7d', transparent: true, opacity: 0.55 }), Math.max(1, AMBIENT));
    amb.count = AMBIENT;
    amb.frustumCulled = false;
    scene.add(amb);
    const ambM = new Matrix4();
    const ambObj = new Object3D();

    /* ---------------- chỗ câu của từng người (người chơi ở dưới màn hình) ---------------- */
    const seatMat = k.lit({ color: '#a77340' });
    const postMat = k.lit({ color: '#6e4723' });
    const plankG = new BoxGeometry(1.25, 0.14, 3.6);
    const postG = new CylinderGeometry(0.08, 0.08, 0.7, 6);
    const rodMat = k.lit({ color: '#4b3321' });
    const rodG = new CylinderGeometry(0.025, 0.045, 2.4, 6);
    rodG.translate(0, 1.2, 0);
    const bobTopG = new SphereGeometry(0.16, 12, 8, 0, TAU, 0, Math.PI / 2);
    const bobBotG = new SphereGeometry(0.16, 12, 8, 0, TAU, Math.PI / 2, Math.PI / 2);
    const bobRed = new MeshBasicMaterial({ color: '#ff3b3b' });
    const bobWhite = new MeshBasicMaterial({ color: '#ffffff' });
    const lineMat = new LineBasicMaterial({ color: '#f4f4f4', transparent: true, opacity: 0.85 });
    const shadowG = new SphereGeometry(0.4, 10, 8);
    shadowG.scale(1.6, 0.25, 0.7);
    const shieldG = new SphereGeometry(0.95, 16, 12);

    const textures = new Map<string, CanvasTexture>();
    const emojiTex = (emoji: string, size = 128) => {
      let t = textures.get(emoji);
      if (!t) {
        t = k.texture(size, size, (g, w, h) => {
          g.font = `${Math.floor(w * 0.78)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(emoji, w / 2, h / 2 + h * 0.04);
        });
        textures.set(emoji, t);
      }
      return t;
    };
    const textTex = (text: string, color: string) => {
      const key = `t:${text}:${color}`;
      let t = textures.get(key);
      if (!t && textures.size < 120) {
        t = k.texture(256, 96, (g, w, h) => {
          g.font = '900 64px system-ui,"Segoe UI",sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = 12;
          g.strokeStyle = 'rgba(0,0,0,0.75)';
          g.strokeText(text, w / 2, h / 2);
          g.fillStyle = color;
          g.fillText(text, w / 2, h / 2);
        });
        textures.set(key, t);
      }
      return t ?? emojiTex('✨');
    };
    const sprites = new Set<Sprite>();
    const mkSprite = (tex: CanvasTexture, size: number) => {
      const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      s.scale.set(size, size, 1);
      s.renderOrder = 10;
      scene.add(s);
      sprites.add(s);
      return s;
    };
    const killSprite = (s: Sprite) => {
      scene.remove(s);
      s.material.dispose();
      sprites.delete(s);
    };

    interface Pop {
      s: Sprite;
      t: number;
      life: number;
      y0: number;
    }
    const pops: Pop[] = [];
    const popText = (text: string, color: string, at: Vector3, life = 1.3) => {
      const s = mkSprite(textTex(text, color), 1.5);
      s.scale.set(2.2, 0.82, 1);
      s.position.copy(at);
      pops.push({ s, t: 0, life, y0: at.y });
    };

    interface Fly {
      s: Sprite;
      t: number;
      dur: number;
      from: Vector3;
      to: Vector3;
      arc: number;
      done?: () => void;
    }
    const flies: Fly[] = [];

    const seats: Seat[] = o.players.map((p, i) => {
      // người chơi (mình) ở dưới màn hình, những người khác chia đều vòng quanh hồ
      const rel = (i - Math.max(0, core.seat) + n) % n;
      const ang = Math.PI / 2 + (rel * TAU) / n;
      const dir = new Vector3(-Math.cos(ang), 0, -Math.sin(ang)); // hướng vào tâm hồ
      const stand = new Vector3(Math.cos(ang) * (R + 0.55), 0.14, Math.sin(ang) * (R + 0.55));
      const tan = new Vector3(-dir.z, 0, dir.x);
      const dist = 3.1 + hash(i * 3 + 1) * 1.1;
      const spot = stand.clone().addScaledVector(dir, dist).addScaledVector(tan, (hash(i + 20) - 0.5) * 1.2);
      spot.y = 0.02;

      const dock = new Group();
      const plank = new Mesh(plankG, seatMat);
      plank.position.set(0, 0.0, 0);
      plank.receiveShadow = true;
      plank.castShadow = !lite;
      dock.add(plank);
      for (const [px, pz] of [
        [-0.5, 1.5],
        [0.5, 1.5],
        [-0.5, -1.5],
        [0.5, -1.5],
      ]) {
        const post = new Mesh(postG, postMat);
        post.position.set(px, -0.35, pz);
        dock.add(post);
      }
      dock.position.copy(stand).addScaledVector(dir, 0.55).setY(0);
      dock.rotation.y = Math.atan2(dir.x, dir.z);
      scene.add(dock);

      const char = k.kit.create(p.color, p.id === o.meId);
      char.setShadows(!lite && !k.low);
      char.setYaw(Math.atan2(dir.x, dir.z));
      char.root.position.copy(stand);
      char.root.scale.setScalar(p.id === o.meId ? 1.0 : 0.92);
      scene.add(char.root);

      const rod = new Mesh(rodG, rodMat);
      rod.position.copy(stand).addScaledVector(dir, 0.25).setY(0.85);
      scene.add(rod);

      const linePos = new Float32Array(LINE_PTS * 3);
      const lg = new BufferGeometry();
      lg.setAttribute('position', new BufferAttribute(linePos, 3));
      const line = new Line(lg, lineMat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);

      const bobber = new Group();
      bobber.add(new Mesh(bobTopG, bobRed), new Mesh(bobBotG, bobWhite));
      bobber.visible = false;
      scene.add(bobber);

      const shadow = new Mesh(shadowG, new MeshBasicMaterial({ color: '#06384d', transparent: true, opacity: 0.55 }));
      shadow.visible = false;
      shadow.position.y = -0.1;
      scene.add(shadow);

      const exclaim = mkSprite(emojiTex('❗', 96), 0.9);
      exclaim.visible = false;

      const shield = new Mesh(
        shieldG,
        new MeshBasicMaterial({ color: '#7fe9ff', transparent: true, opacity: 0.2, blending: AdditiveBlending, side: DoubleSide, depthWrite: false }),
      );
      shield.visible = false;
      scene.add(shield);

      return {
        id: p.id,
        i,
        color: p.color,
        char,
        stand,
        dir,
        tan,
        spot,
        tip: new Vector3(),
        rod,
        line,
        linePos,
        bobber,
        bobPos: spot.clone(),
        shadow,
        exclaim,
        shield,
        held: null,
        castT: -1,
        castFrom: new Vector3(),
        pose: 'idle',
        poseUntil: 0,
        lastSt: ST_IDLE,
        ringAt: 0,
        lastTag: '',
        tag: null,
      } satisfies Seat;
    });

    k.onTier((tier) => {
      for (const s of seats) s.char.setShadows(tier !== 'low' && !lite);
    });

    /* ---------------- camera ---------------- */
    const target = new Vector3(0, 0, 0.9);
    const camPos = new Vector3();
    const pitch = 0.98;
    const setCamera = () => {
      const d = k.fit(R + 2.9, R + 2.4, pitch) * 1.02;
      camPos.set(0, target.y + Math.sin(pitch) * d, target.z + Math.cos(pitch) * d);
    };
    setCamera();
    k.engine.onResize(setCamera);

    /* ---------------- tiện ích ---------------- */
    const tmp = new Vector3();
    const headOf = (s: Seat, out: Vector3) => out.copy(s.stand).setY(2.35);
    const tipOf = (s: Seat, out: Vector3, bend: number) =>
      out.copy(s.stand).addScaledVector(s.dir, 0.25 + 2.4 * Math.cos(0.7 - bend * 0.35)).setY(0.85 + 2.4 * Math.sin(0.7 - bend * 0.35));

    const splash = (x: number, z: number, big: boolean) => {
      k.effects.ring(x, z, '#ffffff', big ? 0.9 : 0.6, big ? 3.6 : 2.2);
      if (!lite) k.effects.burst(x, 0.1, z, { count: k.count(big ? 26 : 12), palette: ['#ffffff', '#bfe9ff', '#7fd0f5'], speed: big ? 4 : 2.4, life: 0.7, size: 0.12, gravity: 12 });
    };

    const setPose = (s: Seat, pose: Pose, sec: number) => {
      s.pose = pose;
      s.poseUntil = performance.now() / 1000 + sec;
    };

    const fly = (tex: CanvasTexture, size: number, from: Vector3, to: Vector3, dur: number, arc: number, done?: () => void) => {
      const sp = mkSprite(tex, size);
      sp.position.copy(from);
      flies.push({ s: sp, t: 0, dur, from: from.clone(), to: to.clone(), arc, done });
    };

    const showHeld = (s: Seat, spIdx: number, from: Vector3, until: number, nowMs: number) => {
      if (s.held) killSprite(s.held.sprite);
      const sp = SPECIES[spIdx];
      const sprite = mkSprite(emojiTex(sp.emoji), sp.tier === 'legend' ? 1.7 : sp.tier === 'rare' ? 1.4 : 1.1);
      sprite.position.copy(from);
      s.held = { sprite, t0: performance.now() / 1000, from: from.clone(), until: until > 0 ? until : nowMs + 1500, trash: sp.tier === 'trash' };
    };

    const handleFx = () => {
      const q = core.fx;
      if (!q.length) return;
      const nowMs = core.nowMs();
      for (const f of q) {
        const s = seats[f.seat];
        if (!s) continue;
        switch (f.k) {
          case 'cast':
            s.castT = 0;
            tipOf(s, s.castFrom, 0);
            splash(s.spot.x, s.spot.z, false);
            break;
          case 'nib':
            splash(s.spot.x, s.spot.z, false);
            break;
          case 'bite':
            splash(s.spot.x, s.spot.z, true);
            if (f.seat === core.seat) k.shake(0.12);
            break;
          case 'hook':
            splash(s.bobPos.x, s.bobPos.z, false);
            setPose(s, 'pull', 0.4);
            break;
          case 'early':
          case 'esc':
            setPose(s, 'sad', 1.1);
            splash(s.bobPos.x, s.bobPos.z, false);
            break;
          case 'land': {
            const sp = SPECIES[f.sp ?? 0];
            const head = headOf(s, new Vector3());
            splash(s.bobPos.x, s.bobPos.z, true);
            const row = core.rows[f.seat];
            const until = row?.heldUntil ?? 0;
            const from = s.bobPos.clone();
            if (sp.tier === 'trash') setPose(s, 'sad', 1.3);
            else setPose(s, 'cheer', 1.4);
            fly(emojiTex(sp.emoji), 1.2, from, head, 0.5, 2.6, () => {
              showHeld(s, f.sp ?? 0, head, until, core.nowMs());
              popText(sp.value > 0 ? `+${sp.value}` : sp.value < 0 ? `${sp.value}` : '0', sp.value > 0 ? '#ffe14d' : '#ff6b6b', tmp.copy(head).setY(3.1));
            });
            if (sp.tier === 'legend') {
              k.shake(0.25);
              if (!lite) k.effects.burst(head.x, head.y, head.z, { count: k.count(60), palette: ['#ffd23f', '#fff1a8', '#ff9f43'], speed: 5, life: 1.1, size: 0.16, gravity: 3 });
            } else if (sp.tier === 'rare' && !lite) k.effects.burst(head.x, head.y, head.z, { count: k.count(26), palette: ['#7fe9ff', '#ffffff'], speed: 3.2, life: 0.8, size: 0.13, gravity: 4 });
            break;
          }
          case 'steal': {
            const t = seats[f.to ?? 0];
            if (!t) break;
            const sp = SPECIES[f.sp ?? 0];
            setPose(s, 'punch', 0.5);
            setPose(t, 'sad', 1.2);
            const fromHead = headOf(t, new Vector3());
            const toHead = headOf(s, new Vector3());
            if (t.held) {
              killSprite(t.held.sprite);
              t.held = null;
            } else fromHead.copy(t.bobPos).setY(0.6);
            const idx = f.sp ?? 0;
            fly(emojiTex('🪝', 96), 0.9, toHead, fromHead, 0.22, 0.6);
            fly(emojiTex(sp.emoji), 1.3, fromHead, toHead, 0.55, 2.2, () => {
              showHeld(s, idx, toHead, 0, core.nowMs());
              s.held!.until = core.nowMs() + 1400;
            });
            if (!lite) k.effects.burst(fromHead.x, fromHead.y, fromHead.z, { count: k.count(26), palette: ['#ff5c7a', '#ffd23f', '#ffffff'], speed: 4, life: 0.7, size: 0.14, gravity: 8 });
            break;
          }
          case 'stealFail': {
            const t = seats[f.to ?? 0];
            setPose(s, 'hit', 2.4);
            if (t) fly(emojiTex('🪝', 96), 0.9, headOf(s, new Vector3()), headOf(t, new Vector3()), 0.25, 0.6);
            popText('💫 HỤT!', '#ffd23f', tmp.copy(s.stand).setY(2.9));
            if (!lite) k.effects.burst(s.stand.x, 2, s.stand.z, { count: k.count(18), palette: ['#ffd23f', '#ffffff'], speed: 2.6, life: 0.8, size: 0.14, gravity: 3 });
            break;
          }
        }
      }
      q.length = 0;
    };

    /* ---------------- vòng lặp ---------------- */
    const labelTags = new Map<string, HTMLElement | null>();

    return {
      frame(dt, time) {
        core.frame();
        handleFx();
        const nowMs = core.nowMs();
        const wallNow = performance.now() / 1000;

        if (!lite) waterTex.offset.set(time * 0.012, time * 0.008);

        // cá bơi nền
        for (let i = 0; i < AMBIENT; i++) {
          const sp = 0.12 + hash(i) * 0.18;
          const a = time * sp * (i % 2 ? 1 : -1) + hash(i + 5) * TAU;
          const rad = 1.2 + hash(i + 11) * (R - 2);
          ambObj.position.set(Math.cos(a) * rad, -0.15 - hash(i + 4) * 0.2, Math.sin(a) * rad);
          ambObj.rotation.set(0, -a + (i % 2 ? Math.PI / 2 : -Math.PI / 2), 0);
          const sc = 0.6 + hash(i + 17) * 0.8;
          ambObj.scale.set(sc, 1, sc);
          ambObj.updateMatrix();
          ambM.copy(ambObj.matrix);
          amb.setMatrixAt(i, ambM);
        }
        if (AMBIENT) amb.instanceMatrix.needsUpdate = true;

        for (const s of seats) {
          const st = core.stOf(s.i);
          const row = core.rows[s.i];
          const mine = s.i === core.seat;
          const stunned = st === ST_STUN;

          // ---- tư thế ----
          let pose: Pose = 'idle';
          if (st === ST_REEL) pose = 'pull';
          else if (stunned) pose = 'hit';
          else if (wallNow < s.poseUntil) pose = s.pose;
          else if (st === ST_BITE) pose = 'pull';
          s.char.update(dt, { speed: 0, dead: false, time, pose });

          // ---- cần câu ----
          let bend = 0;
          if (st === ST_REEL) {
            const prog = mine ? core.reel.p : (row?.prog ?? 0) / 100;
            bend = 0.5 + (1 - prog) * 0.6 + (mine && core.hold ? 0.25 : 0) + Math.sin(time * 18 + s.i) * 0.06;
          } else if (st === ST_NIB) bend = 0.1 + Math.sin(time * 30) * 0.06;
          else if (st === ST_BITE) bend = 0.45 + Math.sin(time * 40) * 0.08;
          // cần chỉ hướng ra hồ, ngẩng lên theo bend
          const pitchRod = 0.7 - bend * 0.35;
          s.rod.rotation.order = 'YXZ';
          s.rod.rotation.y = Math.atan2(s.dir.x, s.dir.z);
          s.rod.rotation.x = Math.PI / 2 - pitchRod;
          tipOf(s, s.tip, bend);

          // ---- phao ----
          const active = st === ST_WAIT || st === ST_NIB || st === ST_BITE || st === ST_REEL;
          let bx = s.spot.x;
          let by = 0.04;
          let bz = s.spot.z;
          let tension = 0.5;
          if (active) {
            if (s.castT >= 0) {
              s.castT += dt / 0.5;
              const u = Math.min(1, s.castT);
              bx = s.castFrom.x + (s.spot.x - s.castFrom.x) * u;
              bz = s.castFrom.z + (s.spot.z - s.castFrom.z) * u;
              by = s.castFrom.y + (0.04 - s.castFrom.y) * u + Math.sin(u * Math.PI) * 2.6;
              if (u >= 1) s.castT = -1;
            } else if (st === ST_WAIT) {
              by = 0.05 + Math.sin(time * 2 + s.i) * 0.025;
            } else if (st === ST_NIB) {
              by = 0.05 + Math.sin(time * 26) * 0.045;
              if (!lite && time - s.ringAt > 0.42) {
                s.ringAt = time;
                k.effects.ring(s.spot.x, s.spot.z, '#ffffff', 0.5, 1.4);
              }
            } else if (st === ST_BITE) {
              by = -0.12 + Math.sin(time * 36) * 0.05;
              tension = 0.15;
            } else if (st === ST_REEL) {
              const prog = mine ? core.reel.p : (row?.prog ?? 0) / 100;
              const pull = Math.min(1, Math.max(0, (prog - 0.2) / 0.8));
              bx = s.spot.x + (s.stand.x + s.dir.x * 0.9 - s.spot.x) * pull * 0.85;
              bz = s.spot.z + (s.stand.z + s.dir.z * 0.9 - s.spot.z) * pull * 0.85;
              // cá giãy: người chơi thấy đúng vị trí cá trong thanh kéo
              const lat = mine ? (core.fishAt(nowMs) - 0.5) * 3.2 : Math.sin(time * 5 + s.i * 2) * 0.9;
              bx += s.tan.x * lat;
              bz += s.tan.z * lat;
              by = 0.02 + Math.abs(Math.sin(time * 14)) * 0.05;
              tension = 0.03;
              if (!lite && time - s.ringAt > 0.38) {
                s.ringAt = time;
                k.effects.ring(bx, bz, '#bfe9ff', 0.45, 1.6);
              }
            }
          }
          s.bobPos.set(bx, by, bz);
          s.bobber.visible = active;
          s.bobber.position.copy(s.bobPos);
          s.line.visible = active;
          if (active) {
            const a = s.tip;
            const sag = tension * (1 + Math.sin(time * 3 + s.i) * 0.1);
            for (let p = 0; p < LINE_PTS; p++) {
              const u = p / (LINE_PTS - 1);
              s.linePos[p * 3] = a.x + (bx - a.x) * u;
              s.linePos[p * 3 + 1] = a.y + (by - a.y) * u - Math.sin(u * Math.PI) * sag * (1.3 + (a.y - by) * 0.2);
              s.linePos[p * 3 + 2] = a.z + (bz - a.z) * u;
            }
            (s.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
          }

          // ---- bóng cá dưới nước (mình thấy cá to nhỏ theo độ khó) ----
          const showShadow = st === ST_BITE || st === ST_REEL;
          s.shadow.visible = showShadow;
          if (showShadow) {
            s.shadow.position.set(bx + s.dir.x * 0.5, -0.12, bz + s.dir.z * 0.5);
            s.shadow.rotation.y = Math.atan2(s.dir.x, s.dir.z) + Math.PI / 2 + Math.sin(time * 9 + s.i) * 0.6;
            const big = mine ? 0.8 + core.cls * 0.28 : 1.1;
            s.shadow.scale.setScalar(big * (1 + Math.sin(time * 12) * 0.08));
          }

          // ---- dấu chấm than ----
          s.exclaim.visible = st === ST_BITE;
          if (st === ST_BITE) {
            headOf(s, s.exclaim.position).y += 0.7 + Math.abs(Math.sin(time * 14)) * 0.25;
          }

          // ---- khiên miễn nhiễm ----
          const imm = !!row && row.immuneUntil > nowMs;
          s.shield.visible = imm;
          if (imm) {
            s.shield.position.copy(s.stand).setY(1.0);
            s.shield.scale.setScalar(1 + Math.sin(time * 6) * 0.04);
          }

          // ---- cá đang giữ trên đầu ----
          const h = s.held;
          if (h) {
            const t = wallNow - h.t0;
            const base = headOf(s, tmp);
            if (nowMs > h.until || t > 5) {
              const fade = Math.max(0, 1 - (nowMs - h.until) / 260);
              h.sprite.material.opacity = fade;
              h.sprite.position.copy(base).setY(base.y + 0.3 - (1 - fade) * 0.6);
              if (fade <= 0) {
                killSprite(h.sprite);
                s.held = null;
              }
            } else {
              h.sprite.position.copy(base).setY(base.y + 0.45 + Math.sin(time * 5) * 0.08);
              h.sprite.material.opacity = 1;
            }
          }

          // ---- chuyển trạng thái (cho mình dùng để bắn hiệu ứng nếu server đổi bất ngờ) ----
          s.lastSt = st;

          // ---- nhãn ----
          const lab = o.labels.get(s.id);
          if (lab) {
            k.label(lab, s.stand.x, 2.45, s.stand.z);
            let tag = labelTags.get(s.id);
            if (tag === undefined) {
              tag = lab.querySelector<HTMLElement>('.fs-tag');
              labelTags.set(s.id, tag);
            }
            if (tag) {
              const txt = imm ? '🛡️' : stunned ? '💫' : st === ST_REEL ? '🎣' : st === ST_BITE ? '❗' : st === ST_WAIT || st === ST_NIB ? '🎣' : '';
              if (txt !== s.lastTag) {
                s.lastTag = txt;
                tag.textContent = txt;
              }
            }
          }
        }

        // ---- cá bay ----
        for (let i = flies.length - 1; i >= 0; i--) {
          const f = flies[i];
          f.t += dt / f.dur;
          const u = Math.min(1, f.t);
          f.s.position.set(
            f.from.x + (f.to.x - f.from.x) * u,
            f.from.y + (f.to.y - f.from.y) * u + Math.sin(u * Math.PI) * f.arc,
            f.from.z + (f.to.z - f.from.z) * u,
          );
          if (f.t >= 1) {
            killSprite(f.s);
            flies.splice(i, 1);
            f.done?.();
          }
        }
        // ---- chữ nổi ----
        for (let i = pops.length - 1; i >= 0; i--) {
          const p = pops[i];
          p.t += dt;
          const u = p.t / p.life;
          p.s.position.y = p.y0 + u * 1.1;
          p.s.material.opacity = u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4);
          const sc = u < 0.15 ? 0.6 + (u / 0.15) * 0.5 : 1.1;
          p.s.scale.set(2.2 * sc, 0.82 * sc, 1);
          if (u >= 1) {
            killSprite(p.s);
            pops.splice(i, 1);
          }
        }

        k.look(camPos, target);
      },
      dispose() {
        for (const s of [...sprites]) killSprite(s);
      },
    };
  });
}
