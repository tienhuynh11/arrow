import {
  ACESFilmicToneMapping,
  BasicShadowMap,
  NeutralToneMapping,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { lowerTier, type Tier } from './quality';

export interface Engine {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly tier: Tier;
  readonly width: number;
  readonly height: number;
  start(frame: (dt: number, time: number) => void): void;
  onTierChange(cb: (tier: Tier) => void): void;
  onResize(cb: (width: number, height: number) => void): void;
  dispose(): void;
}

const AVG_FRAMES = 90;
const WARMUP_FRAMES = 60; // khung đầu còn biên dịch shader, không tính
const SLOW_FRAME_MS = 1000 / 45;

function eachMaterial(obj: Object3D, fn: (m: Material) => void) {
  const mat = (obj as Object3D & { material?: Material | Material[] }).material;
  if (Array.isArray(mat)) mat.forEach(fn);
  else if (mat) fn(mat);
}

function disposeMaterial(m: Material) {
  for (const v of Object.values(m as unknown as Record<string, unknown>)) {
    if (v && typeof v === 'object' && (v as Texture).isTexture) (v as Texture).dispose();
  }
  m.dispose();
}

/**
 * Lớp 3D dùng chung: renderer, camera, co giãn theo khung, và đo FPS để tự hạ
 * mức đồ hoạ khi máy yếu (tắt bóng đổ, giảm độ phân giải).
 */
export function createEngine(host: HTMLElement, startTier: Tier, onLost: () => void, vivid = false): Engine {
  const renderer = new WebGLRenderer({
    antialias: startTier !== 'low',
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.className = 'g3d-canvas';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 200);

  let tier = startTier;
  let width = 0;
  let height = 0;
  const tierListeners: ((t: Tier) => void)[] = [];
  const resizeListeners: ((w: number, h: number) => void)[] = [];

  const applyTier = () => {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(tier === 'high' ? Math.min(dpr, 2) : tier === 'medium' ? Math.min(dpr, 1.5) : 1);
    renderer.shadowMap.enabled = tier !== 'low';
    renderer.shadowMap.type = tier === 'high' ? PCFSoftShadowMap : BasicShadowMap;
    renderer.toneMapping = tier === 'low' ? NoToneMapping : vivid ? NeutralToneMapping : ACESFilmicToneMapping;
  };

  const resize = () => {
    width = host.clientWidth;
    height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    for (const cb of resizeListeners) cb(width, height);
  };

  applyTier();
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let frames = 0;
  let warm = 0;
  let spent = 0;
  let lastDowngrade = 0;

  const watchFps = (dtMs: number) => {
    if (document.hidden || warm++ < WARMUP_FRAMES) return;
    spent += dtMs;
    if (++frames < AVG_FRAMES) return;
    const avg = spent / frames;
    frames = 0;
    spent = 0;
    const now = performance.now();
    if (avg <= SLOW_FRAME_MS || now - lastDowngrade < 2500) return;

    const next = lowerTier(tier);
    if (!next) return;
    tier = next;
    lastDowngrade = now;
    warm = 0;
    applyTier();
    resize();
    // bật/tắt bóng đổ lúc đang chạy thì phải cho shader biên dịch lại
    scene.traverse((o) => eachMaterial(o, (m) => (m.needsUpdate = true)));
    for (const cb of tierListeners) cb(tier);
  };

  const handleLost = (e: Event) => {
    e.preventDefault();
    onLost();
  };
  renderer.domElement.addEventListener('webglcontextlost', handleLost);

  let last = 0;

  return {
    renderer,
    scene,
    camera,
    get tier() {
      return tier;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    start(frame) {
      renderer.setAnimationLoop((time: number) => {
        const dtMs = last ? Math.min(time - last, 100) : 16;
        last = time;
        watchFps(dtMs);
        frame(dtMs / 1000, time / 1000);
        renderer.render(scene, camera);
      });
    },
    onTierChange(cb) {
      tierListeners.push(cb);
    },
    onResize(cb) {
      resizeListeners.push(cb);
      if (width && height) cb(width, height);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleLost);
      scene.traverse((o) => {
        (o as Object3D & { geometry?: BufferGeometry }).geometry?.dispose();
        eachMaterial(o, disposeMaterial);
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
