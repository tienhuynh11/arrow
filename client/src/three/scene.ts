import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MeshLambertMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
  type ColorRepresentation,
  type Texture,
} from 'three';
import { createEngine, type Engine } from './engine';
import { createCharacterKit, type CharacterKit } from './character';
import { Effects } from './effects';
import { initialTier, TIER_LABEL, type Tier } from './quality';
import { buildStage, STAGES, type StageOptions } from './stage';

export interface LitParams {
  color?: ColorRepresentation;
  flatShading?: boolean;
  emissive?: ColorRepresentation;
  emissiveIntensity?: number;
  map?: Texture | null;
  transparent?: boolean;
  opacity?: number;
}

export type LitMaterial = MeshStandardMaterial | MeshLambertMaterial;

export interface SceneHooks {
  onQuality?(label: string): void;
  onFail?(): void;
}

export interface SceneOptions {
  background?: string;
  /** khoảng sương mù [gần, xa] */
  fog?: [number, number];
  sun?: [number, number, number];
  /** nửa cạnh vùng đổ bóng của mặt trời */
  shadowBox?: number;
  /** trời sáng + đồi + mây kiểu game show (thay cho nền tối). Đèn, sương mù, tone màu theo bảng màu của sân */
  stage?: StageOptions;
}

/** Bộ công cụ mỗi cảnh minigame nhận được — mọi thứ lặp lại giữa các game nằm ở đây. */
export interface SceneKit {
  engine: Engine;
  /** bắt đầu ở mức đồ hoạ NHẸ */
  low: boolean;
  lit(p: LitParams): LitMaterial;
  kit: CharacterKit;
  effects: Effects;
  sun: DirectionalLight;
  /** số hạt/hiệu ứng theo mức đồ hoạ hiện tại */
  count(high: number): number;
  shake(amount: number): void;
  /** đặt camera (có cộng rung) và hướng nhìn */
  look(position: Vector3, target: Vector3): void;
  /** đặt một nhãn HTML đè đúng lên một điểm trong cảnh */
  label(el: HTMLElement | null | undefined, x: number, y: number, z: number): void;
  /** texture vẽ bằng canvas 2D — 0 byte ảnh tải về */
  texture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture;
  /** khoảng cách camera để một vùng rộng 2·halfW × sâu 2·halfD vừa khít khung hình */
  fit(halfW: number, halfD: number, pitch: number): number;
  onTier(cb: (tier: Tier) => void): void;
}

export interface SceneBody {
  frame(dt: number, time: number): void;
  dispose?(): void;
}

/**
 * Dựng khung chung cho một cảnh 3D (renderer, trời, đèn, bóng đổ, nhân vật, hiệu ứng)
 * rồi giao cho `build` phần riêng của từng minigame.
 */
export function runScene(
  host: HTMLElement,
  hooks: SceneHooks,
  options: SceneOptions,
  build: (k: SceneKit) => SceneBody,
): { dispose(): void } {
  const pal = options.stage ? STAGES[options.stage.name] : null;
  const engine = createEngine(host, initialTier(), () => hooks.onFail?.(), !!pal);
  const { scene, camera } = engine;
  const low = engine.tier === 'low';

  const bg = pal?.fog ?? options.background ?? '#0b0d1f';
  scene.background = new Color(bg);
  const [fogNear, fogFar] = options.fog ?? (pal ? [55, 190] : [28, 70]);
  scene.fog = new Fog(bg, fogNear, fogFar);

  scene.add(new HemisphereLight(pal?.hemiSky ?? '#c9dcff', pal?.hemiGround ?? '#2a1f3d', pal?.hemiIntensity ?? 1.1));
  const sun = new DirectionalLight(pal?.sun ?? '#fff1dc', pal?.sunIntensity ?? 2.1);
  const [sx, sy, sz] = options.sun ?? [7, 16, 9];
  sun.position.set(sx, sy, sz);
  sun.castShadow = !low;
  const mapSize = engine.tier === 'high' ? 1024 : 512;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const box = options.shadowBox ?? 14;
  Object.assign(sun.shadow.camera, { left: -box, right: box, top: box, bottom: -box, near: 1, far: 70 });
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const kit = createCharacterKit(low ? 'lambert' : 'standard');
  const effects = new Effects(scene);
  const tierListeners: ((t: Tier) => void)[] = [];
  const textures: Texture[] = [];
  let shakeAmount = 0;
  const projected = new Vector3();

  const k: SceneKit = {
    engine,
    low,
    kit,
    effects,
    sun,
    lit: (p) =>
      low ? new MeshLambertMaterial(p) : new MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, ...p }),
    count: (high) =>
      engine.tier === 'high' ? high : engine.tier === 'medium' ? Math.round(high * 0.65) : Math.round(high * 0.35),
    shake: (amount) => {
      shakeAmount = Math.max(shakeAmount, amount);
    },
    look: (position, target) => {
      camera.position.set(
        position.x + (Math.random() - 0.5) * shakeAmount,
        position.y + (Math.random() - 0.5) * shakeAmount,
        position.z + (Math.random() - 0.5) * shakeAmount,
      );
      camera.lookAt(target);
    },
    label: (el, x, y, z) => {
      if (!el) return;
      projected.set(x, y, z).project(camera);
      const visible = projected.z < 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2;
      el.style.opacity = visible ? '' : '0';
      el.style.transform = `translate3d(${(projected.x * 0.5 + 0.5) * engine.width}px, ${
        (-projected.y * 0.5 + 0.5) * engine.height
      }px, 0) translate(-50%, -100%)`;
    },
    texture: (w, h, draw) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      draw(canvas.getContext('2d')!, w, h);
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = low ? 1 : Math.min(4, engine.renderer.capabilities.getMaxAnisotropy());
      textures.push(tex);
      return tex;
    },
    fit: (halfW, halfD, pitch) => {
      const vfov = (camera.fov * Math.PI) / 180;
      const aspect = engine.width && engine.height ? engine.width / engine.height : 16 / 9;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      return Math.max(halfW / Math.tan(hfov / 2), (halfD / Math.tan(vfov / 2)) * Math.sin(pitch));
    },
    onTier: (cb) => {
      tierListeners.push(cb);
    },
  };

  engine.onTierChange((tier) => {
    sun.castShadow = tier !== 'low';
    for (const cb of tierListeners) cb(tier);
    hooks.onQuality?.(TIER_LABEL[tier]);
  });
  hooks.onQuality?.(TIER_LABEL[engine.tier]);

  const stage = options.stage ? buildStage(scene, options.stage, low) : null;
  const body = build(k);

  engine.start((dt, time) => {
    body.frame(dt, time);
    stage?.update(dt);
    effects.update(dt);
    shakeAmount *= Math.exp(-dt * 6);
  });

  return {
    dispose() {
      body.dispose?.();
      stage?.dispose();
      effects.dispose();
      kit.dispose();
      for (const t of textures) t.dispose();
      engine.dispose();
    },
  };
}

/** Sàn đấu kẻ ô bằng canvas, dùng lại cho nhiều game. */
export function tileTexture(
  k: SceneKit,
  cols: number,
  rows: number,
  colors: [string, string] = ['#262a4a', '#2d3256'],
  border = 'rgba(255,209,102,0.5)',
) {
  return k.texture(64 * cols, 64 * rows, (g, w, h) => {
    const tw = w / cols;
    const th = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        g.fillStyle = (r + q) % 2 ? colors[0] : colors[1];
        g.fillRect(q * tw, r * th, tw, th);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 2;
    for (let q = 1; q < cols; q++) {
      g.beginPath();
      g.moveTo(q * tw, 0);
      g.lineTo(q * tw, h);
      g.stroke();
    }
    for (let r = 1; r < rows; r++) {
      g.beginPath();
      g.moveTo(0, r * th);
      g.lineTo(w, r * th);
      g.stroke();
    }
    g.strokeStyle = border;
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
  });
}
