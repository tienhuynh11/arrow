import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type ColorRepresentation,
  type Texture,
} from 'three';
import { createEngine } from './engine';
import { createCharacterKit, type Character3D } from './character';
import { Effects } from './effects';
import { initialTier, TIER_LABEL } from './quality';
import type { BombConfig, BombPos } from '../games/bomb/useBombGame';

/** Những gì cảnh 3D cần đọc mỗi khung hình - lấy thẳng từ hook useBombGame. */
export interface BombFrameState {
  holder: string | null;
  ratio: number;
  lives: Record<string, number>;
  blastAt: Record<string, number>;
  tagAt: number;
  positions: { current: Record<string, BombPos> };
  predict(serverNow: number): void;
  posOf(id: string): { x: number; y: number } | undefined;
  serverNow(): number;
}

export interface BombSceneOptions {
  host: HTMLElement;
  cfg: BombConfig;
  players: { id: string; color: string }[];
  meId: string;
  read: () => BombFrameState;
  labels: Map<string, HTMLElement | null>;
  onQuality?: (label: string) => void;
  onFail?: () => void;
}

/** 10 đơn vị của server = 1 đơn vị thế giới 3D */
const S = 0.1;
const CAMERA_PITCH = (56 * Math.PI) / 180;
/** cột thấp để không che nhân vật đứng phía sau */
const PILLAR_H = 0.9;
/** phóng to nhân vật cho dễ nhìn - thuần hình ảnh, không đổi hitbox */
const CHAR_SCALE = 1.35;

interface LitParams {
  color?: ColorRepresentation;
  flatShading?: boolean;
  emissive?: ColorRepresentation;
  emissiveIntensity?: number;
  map?: Texture | null;
}

interface CharEntry {
  c: Character3D;
  shown: Vector3;
  prev: Vector3;
  placed: boolean;
  lastBlast: number;
}

export function createBombScene(opts: BombSceneOptions): { dispose(): void } {
  const { cfg, meId } = opts;
  const engine = createEngine(opts.host, initialTier(), () => opts.onFail?.());
  const { scene, camera } = engine;
  const lowStart = engine.tier === 'low';

  const AW = cfg.w * S;
  const AH = cfg.h * S;
  const wx = (x: number) => x * S - AW / 2;
  const wz = (y: number) => y * S - AH / 2;

  // vật liệu chọn một lần theo mức đồ hoạ lúc bắt đầu: máy yếu dùng Lambert rẻ hơn
  const lit = (p: LitParams) =>
    lowStart ? new MeshLambertMaterial(p) : new MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, ...p });
  const scaled = (hi: number) =>
    engine.tier === 'high' ? hi : engine.tier === 'medium' ? Math.round(hi * 0.65) : Math.round(hi * 0.35);

  /* ---------------- bầu trời + ánh sáng ---------------- */
  scene.background = new Color('#0b0d1f');
  scene.fog = new Fog('#0b0d1f', 26, 58);

  scene.add(new HemisphereLight('#c9dcff', '#2a1f3d', 1.1));
  const sun = new DirectionalLight('#fff1dc', 2.1);
  sun.position.set(7, 16, 9);
  sun.castShadow = !lowStart;
  sun.shadow.mapSize.set(engine.tier === 'high' ? 1024 : 512, engine.tier === 'high' ? 1024 : 512);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  /* ---------------- sàn đấu (texture vẽ bằng canvas, 0 byte asset) ---------------- */
  const floorTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 410;
    const g = c.getContext('2d')!;
    const cols = 16;
    const rows = 10;
    const tw = c.width / cols;
    const th = c.height / rows;
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        g.fillStyle = (r + q) % 2 ? '#262a4a' : '#2d3256';
        g.fillRect(q * tw, r * th, tw, th);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 2;
    for (let q = 1; q < cols; q++) {
      g.beginPath();
      g.moveTo(q * tw, 0);
      g.lineTo(q * tw, c.height);
      g.stroke();
    }
    for (let r = 1; r < rows; r++) {
      g.beginPath();
      g.moveTo(0, r * th);
      g.lineTo(c.width, r * th);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,159,67,0.4)';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c.width / 2, c.height / 2, 70, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(c.width / 2, 0);
    g.lineTo(c.width / 2, c.height);
    g.stroke();
    g.strokeStyle = 'rgba(255,209,102,0.5)';
    g.lineWidth = 8;
    g.strokeRect(6, 6, c.width - 12, c.height - 12);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = lowStart ? 1 : Math.min(4, engine.renderer.capabilities.getMaxAnisotropy());
    return tex;
  })();

  const sideMat = lit({ color: '#1a1d36' });
  const topMat = lit({ map: floorTexture });
  const floor = new Mesh(new BoxGeometry(AW, 0.4, AH), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  floor.position.y = -0.2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ground = new Mesh(new PlaneGeometry(140, 140), lit({ color: '#0e1026' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.41;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------------- tường bao có viền phát sáng ---------------- */
  const orange = new Color('#ff9f43');
  const red = new Color('#ff2d55');
  const trimMat = new MeshBasicMaterial({ color: orange });
  const wallMat = lit({ color: '#353b63', flatShading: true });
  const T = 0.35;
  const addWall = (x: number, z: number, w: number, d: number) => {
    const wall = new Mesh(new BoxGeometry(w, 0.55, d), wallMat);
    wall.position.set(x, 0.275, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    const trim = new Mesh(new BoxGeometry(w, 0.06, d), trimMat);
    trim.position.set(x, 0.58, z);
    scene.add(wall, trim);
  };
  addWall(0, -AH / 2 - T / 2, AW + T * 2, T);
  addWall(0, AH / 2 + T / 2, AW + T * 2, T);
  addWall(-AW / 2 - T / 2, 0, T, AH);
  addWall(AW / 2 + T / 2, 0, T, AH);

  /* ---------------- cột đá (đúng vị trí + bán kính va chạm của server) ---------------- */
  const gems: Mesh[] = [];
  const pillarMat = lit({ color: '#4b5580', flatShading: true });
  const capMat = lit({ color: '#626ea0', flatShading: true });
  const gemMat = new MeshBasicMaterial({ color: '#7df9ff' });
  for (const p of cfg.pillars) {
    const r = p.r * S;
    const column = new Mesh(new CylinderGeometry(r * 0.9, r, PILLAR_H, 8), pillarMat);
    column.position.set(wx(p.x), PILLAR_H / 2, wz(p.y));
    column.castShadow = true;
    column.receiveShadow = true;
    const cap = new Mesh(new DodecahedronGeometry(r * 0.58, 0), capMat);
    cap.position.set(wx(p.x), PILLAR_H + 0.08, wz(p.y));
    cap.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    cap.castShadow = true;
    const gem = new Mesh(new OctahedronGeometry(r * 0.26, 0), gemMat);
    gem.position.set(wx(p.x), PILLAR_H + 0.75, wz(p.y));
    gems.push(gem);
    scene.add(column, cap, gem);
  }

  /* ---------------- trang trí ngoài sân: đá + tinh thể trôi lơ lửng ---------------- */
  const rockMat = lit({ color: '#2e3456', flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.25;
    const size = 0.4 + Math.random() * 0.8;
    const rock = new Mesh(new DodecahedronGeometry(size, 0), rockMat);
    rock.position.set(
      Math.cos(a) * (AW / 2 + 2.4 + Math.random() * 4),
      size * 0.3 - 0.4,
      Math.sin(a) * (AH / 2 + 2.2 + Math.random() * 3),
    );
    rock.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    scene.add(rock);
  }
  const floaters: { mesh: Mesh; base: number; phase: number }[] = [];
  const floaterColors = ['#b388ff', '#4cc9f0', '#ff6bd6'];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const mesh = new Mesh(
      new OctahedronGeometry(0.22 + Math.random() * 0.2, 0),
      new MeshBasicMaterial({ color: floaterColors[i % floaterColors.length] }),
    );
    const base = 0.9 + Math.random() * 0.8;
    mesh.position.set(Math.cos(a) * (AW / 2 + 3.2), base, Math.sin(a) * (AH / 2 + 2.6));
    floaters.push({ mesh, base, phase: Math.random() * 6 });
    scene.add(mesh);
  }

  /* ---------------- nhân vật ---------------- */
  const kit = createCharacterKit(lowStart ? 'lambert' : 'standard');
  const first = opts.read();
  const chars = new Map<string, CharEntry>();
  for (const p of opts.players) {
    const c = kit.create(p.color, p.id === meId);
    c.setShadows(!lowStart);
    c.root.scale.setScalar(CHAR_SCALE);
    c.root.visible = false;
    scene.add(c.root);
    // ghi nhận các vụ nổ đã có sẵn để bật lại 3D giữa ván không phát lại hiệu ứng cũ
    chars.set(p.id, { c, shown: new Vector3(), prev: new Vector3(), placed: false, lastBlast: first.blastAt[p.id] ?? 0 });
  }

  /* ---------------- quả bom + vòng đỏ dưới chân người ôm ---------------- */
  const ringMat = new MeshBasicMaterial({ color: red, transparent: true, opacity: 0.8, depthWrite: false });
  const holderRing = new Mesh(new RingGeometry(0.5, 0.7, 36), ringMat);
  holderRing.rotation.x = -Math.PI / 2;
  holderRing.visible = false;
  scene.add(holderRing);

  const bomb = new Group();
  const bombMat = new MeshStandardMaterial({
    color: '#262b40',
    roughness: 0.35,
    metalness: 0.4,
    emissive: red,
    emissiveIntensity: 0,
  });
  const bombBody = new Mesh(new SphereGeometry(0.3, 16, 12), bombMat);
  bombBody.castShadow = true;
  const bombCap = new Mesh(new CylinderGeometry(0.1, 0.12, 0.1, 10), lit({ color: '#8e97bd' }));
  bombCap.position.y = 0.3;
  const fuse = new Mesh(new CylinderGeometry(0.022, 0.022, 0.24, 6), new MeshBasicMaterial({ color: '#c9a227' }));
  fuse.position.set(0.06, 0.44, 0);
  fuse.rotation.z = -0.5;
  const spark = new Mesh(new SphereGeometry(0.075, 8, 6), new MeshBasicMaterial({ color: '#ffcf5a' }));
  spark.position.set(0.12, 0.56, 0);
  bomb.add(bombBody, bombCap, fuse, spark);
  bomb.visible = false;
  scene.add(bomb);

  // đèn điểm tốn hiệu năng nên chỉ bật ở mức VỪA/CAO
  const bombLight = new PointLight('#ff8a3d', 0, 5, 2);
  const flash = new PointLight('#ffb35a', 0, 14, 2);
  if (!lowStart) scene.add(bombLight, flash);

  const effects = new Effects(scene);

  /* ---------------- camera nhìn chéo từ trên xuống, luôn vừa khít sân ---------------- */
  const camDir = new Vector3(0, Math.sin(CAMERA_PITCH), Math.cos(CAMERA_PITCH));
  const lookAt = new Vector3(0, 0, 0.4);
  const focus = new Vector3().copy(lookAt);
  let camDist = 22;
  engine.onResize((w, h) => {
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (w / h));
    const fitWidth = (AW / 2 + 1.9) / Math.tan(hfov / 2);
    const fitDepth = ((AH / 2 + 2.6) / Math.tan(vfov / 2)) * Math.sin(CAMERA_PITCH);
    camDist = Math.max(fitWidth, fitDepth);
  });

  engine.onTierChange((tier) => {
    const shadows = tier !== 'low';
    sun.castShadow = shadows;
    for (const e of chars.values()) e.c.setShadows(shadows);
    if (!shadows) {
      bombLight.visible = false;
      flash.visible = false;
    }
    opts.onQuality?.(TIER_LABEL[tier]);
  });
  opts.onQuality?.(TIER_LABEL[engine.tier]);

  /* ---------------- vòng lặp ---------------- */
  let shake = 0;
  let lastTag = first.tagAt;
  let lastHolder: string | null = null;
  const bombPos = new Vector3(0, 2, 0);
  const flight = { active: false, from: new Vector3(), t: 0 };
  const target = new Vector3();
  const tmp = new Vector3();

  const explode = (at: Vector3) => {
    effects.burst(at.x, 1, at.z, {
      count: scaled(110),
      palette: ['#ff9f43', '#ffd166', '#ff2d55', '#fff3c4'],
      speed: 8,
      life: 1,
      size: 0.24,
    });
    if (engine.tier !== 'low') {
      effects.burst(at.x, 0.8, at.z, {
        count: scaled(40),
        palette: ['#5b5f7a', '#3b3f58', '#2a2d40'],
        speed: 2.6,
        life: 1.4,
        size: 0.5,
        additive: false,
        gravity: -1.6,
        drag: 2,
      });
    }
    effects.ring(at.x, at.z, '#ffb35a', 0.6, 6);
    flash.position.set(at.x, 1.6, at.z);
    flash.intensity = 22;
    shake = Math.max(shake, 0.45);
  };

  engine.start((dt, time) => {
    const f = opts.read();
    f.predict(f.serverNow());

    let meShown: Vector3 | null = null;

    for (const p of opts.players) {
      const e = chars.get(p.id);
      if (!e) continue;
      const pos = f.posOf(p.id);
      if (!pos) {
        e.c.root.visible = false;
        continue;
      }

      const tx = wx(pos.x);
      const tz = wz(pos.y);
      if (!e.placed || p.id === meId) {
        e.shown.set(tx, 0, tz);
        if (!e.placed) e.prev.copy(e.shown);
        e.placed = true;
      } else {
        // server gửi vị trí ~16 lần/giây: nội suy để người khác chạy mượt
        const k = 1 - Math.exp(-dt * 14);
        e.shown.x += (tx - e.shown.x) * k;
        e.shown.z += (tz - e.shown.z) * k;
      }

      const step = Math.max(dt, 1e-3);
      const vx = (e.shown.x - e.prev.x) / step;
      const vz = (e.shown.z - e.prev.z) / step;
      e.prev.copy(e.shown);
      const server = f.positions.current[p.id];
      const dead = (f.lives[p.id] ?? cfg.lives) <= 0 || !!server?.out;
      const speed = dead ? 0 : Math.min(1, Math.hypot(vx, vz) / (cfg.speed * S));

      e.c.root.position.copy(e.shown);
      if (!dead) e.c.face(vx, vz, dt);
      e.c.update(dt, { speed, dead, safe: !!server?.safe && !dead, holder: f.holder === p.id, time });
      if (p.id === meId) meShown = e.shown;

      const blastTime = f.blastAt[p.id] ?? 0;
      if (blastTime > e.lastBlast) {
        e.lastBlast = blastTime;
        explode(e.shown);
      }

      // nhãn tên là HTML đặt theo toạ độ chiếu, nên chữ tiếng Việt vẫn nét
      const label = opts.labels.get(p.id);
      if (label) {
        tmp.set(e.shown.x, (f.holder === p.id ? 2.95 : 2.15) * CHAR_SCALE, e.shown.z).project(camera);
        const onScreen = tmp.z < 1;
        label.style.opacity = onScreen ? '1' : '0';
        label.style.transform = `translate3d(${(tmp.x * 0.5 + 0.5) * engine.width}px, ${
          (-tmp.y * 0.5 + 0.5) * engine.height
        }px, 0) translate(-50%, -100%)`;
      }
    }

    const holder = f.holder ? chars.get(f.holder) : undefined;
    const hot = f.ratio < 0.3;
    const pulseSpeed = 4 + 20 * (1 - f.ratio) ** 2;

    if (holder && holder.placed) {
      target.set(holder.shown.x, 2.18 * CHAR_SCALE + Math.sin(time * 6) * 0.05, holder.shown.z);

      if (f.holder !== lastHolder) {
        if (lastHolder && bomb.visible) {
          flight.active = true;
          flight.from.copy(bombPos);
          flight.t = 0;
        } else {
          bombPos.copy(target);
        }
        lastHolder = f.holder;
      }

      if (flight.active) {
        // bom bay vòng cung sang người vừa bị chạm
        flight.t += dt / 0.26;
        const k = Math.min(1, flight.t);
        bombPos.lerpVectors(flight.from, target, k);
        bombPos.y += Math.sin(k * Math.PI) * 1.3;
        if (k >= 1) flight.active = false;
      } else {
        bombPos.copy(target);
      }

      bomb.visible = true;
      bomb.position.copy(bombPos);
      bomb.rotation.y += dt * 1.2;
      const pulse = Math.abs(Math.sin(time * pulseSpeed));
      bomb.scale.setScalar(CHAR_SCALE * (hot ? 1 + 0.14 * pulse : 1 + 0.04 * Math.sin(time * 4)));
      bombMat.emissiveIntensity = hot ? 0.35 + 0.75 * pulse : 0;
      spark.scale.setScalar(0.7 + Math.random() * 0.6);

      holderRing.visible = true;
      holderRing.position.set(holder.shown.x, 0.03, holder.shown.z);
      holderRing.scale.setScalar(CHAR_SCALE * (1 + 0.12 * Math.sin(time * 8)));
      ringMat.opacity = hot ? 0.55 + 0.45 * pulse : 0.75;

      bombLight.position.copy(bombPos);
      bombLight.intensity = hot ? 2.2 + 2 * pulse : 1.2;
    } else {
      bomb.visible = false;
      holderRing.visible = false;
      bombLight.intensity = 0;
    }

    if (f.tagAt > lastTag) {
      lastTag = f.tagAt;
      if (holder) {
        effects.burst(holder.shown.x, 1.3, holder.shown.z, {
          count: scaled(26),
          palette: ['#ffffff', '#ffd166', '#7df9ff'],
          speed: 4.5,
          life: 0.45,
          size: 0.14,
        });
        shake = Math.max(shake, 0.12);
      }
    }

    // viền tường chớp đỏ khi ngòi sắp cháy hết
    if (f.holder && f.ratio < 0.25) trimMat.color.lerpColors(orange, red, 0.5 + 0.5 * Math.sin(time * 14));
    else trimMat.color.copy(orange);

    for (const g of gems) g.rotation.y += dt * 1.4;
    for (const fl of floaters) {
      fl.mesh.rotation.y += dt * 0.8;
      fl.mesh.position.y = fl.base + Math.sin(time * 1.5 + fl.phase) * 0.18;
    }

    effects.update(dt);
    flash.intensity *= Math.exp(-dt * 7);

    // camera khẽ bám theo nhân vật của mình + rung khi có va chạm/nổ
    if (meShown) tmp.set(meShown.x * 0.12, 0, meShown.z * 0.1);
    else tmp.set(0, 0, 0);
    focus.lerp(tmp.add(lookAt), 1 - Math.exp(-dt * 3));
    shake *= Math.exp(-dt * 6);
    camera.position
      .copy(focus)
      .addScaledVector(camDir, camDist)
      .add(tmp.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    camera.lookAt(focus);
  });

  return {
    dispose() {
      effects.dispose();
      kit.dispose();
      engine.dispose();
    },
  };
}
