// Vòng lặp vẽ 3D dùng chung cho hub / chi tiết tướng / trận đánh: MỘT WebGL context mỗi màn hình,
// tự dừng khi tab ẩn, giới hạn FPS theo preset, trả context khi dispose().
import * as THREE from 'three';
import { currentPreset, type QualityState } from './quality';

export interface LiveScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** dt tính bằng giây (đã kẹp), t là thời gian chạy tổng */
  update(dt: number, t: number): void;
  /** gọi khi kích thước canvas đổi (aspect đã cập nhật vào camera) */
  resize?(w: number, h: number): void;
  /** sau mỗi khung vẽ (chiếu toạ độ lên màn hình cho HUD...) */
  afterRender?(): void;
  dispose?(): void;
}

export interface LiveHandle {
  readonly ok: boolean;
  readonly quality: QualityState;
  stop(): void;
}

export function runLive(canvas: HTMLCanvasElement, ls: LiveScene, maxFps?: number): LiveHandle {
  const q = currentPreset();
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: q.level !== 'low', alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(q.dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  } catch {
    renderer = null;
  }
  let raf = 0;
  let last = 0;
  let t = 0;
  let stopped = false;
  const minGap = 1000 / Math.min(maxFps ?? 60, q.fps) - 1.5;

  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (!renderer || document.hidden) {
      last = 0;
      return;
    }
    if (last && now - last < minGap) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 4 || h < 4) return;
    const pw = Math.round(w * renderer.getPixelRatio());
    const ph = Math.round(h * renderer.getPixelRatio());
    if (canvas.width !== pw || canvas.height !== ph) {
      renderer.setSize(w, h, false);
      ls.camera.aspect = w / h;
      ls.camera.updateProjectionMatrix();
      ls.resize?.(w, h);
    }
    ls.update(dt, t);
    renderer.render(ls.scene, ls.camera);
    ls.afterRender?.();
  };
  raf = requestAnimationFrame(frame);

  return {
    ok: !!renderer,
    quality: q,
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      ls.dispose?.();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = null;
    },
  };
}

/** texture bóng tròn giả dưới chân (không dùng đổ bóng thật) */
let blob: THREE.CanvasTexture | null = null;
export function blobTexture(): THREE.CanvasTexture {
  if (!blob) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 3, 32, 32, 32);
    gr.addColorStop(0, 'rgba(20,40,20,0.5)');
    gr.addColorStop(1, 'rgba(20,40,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    blob = new THREE.CanvasTexture(c);
  }
  return blob;
}
let blobGeo: THREE.PlaneGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
/** mesh bóng tròn dùng chung vật liệu/hình khối */
export function makeBlob(size = 1.3): THREE.Mesh {
  blobGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  blobMat ??= new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.scale.setScalar(size);
  m.position.y = 0.02;
  m.renderOrder = 1;
  return m;
}

/** ánh sáng nền sáng, vui mắt dùng chung */
export function brightLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9bd27a, 1.9));
  const sun = new THREE.DirectionalLight(0xfff3d6, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 0.8);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
}
