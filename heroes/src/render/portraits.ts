// Chân dung thẻ: MỘT renderer ngoài màn hình duy nhất vẽ từng tướng ra ảnh (dataURL) rồi cache theo id+phẩm.
// Mọi thẻ chỉ hiển thị <img>, nên không bao giờ tạo thêm WebGL context cho từng thẻ.
import { signal, type Signal } from '@preact/signals';
import * as THREE from 'three';
import type { Rarity } from '@shared/heroes/types';
import { createHeroModel, onHeroModelReady } from './hero-model';
import { brightLights } from './live';

export const RARITY_GLOW: Record<Rarity, number> = { R: 0x8fb0d6, SR: 0xb57cff, SSR: 0xffc83d, UR: 0xff6ad5 };
const SIZE = 240;

let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
let scene: THREE.Scene | null = null;
let cam: THREE.PerspectiveCamera | null = null;
let disc: THREE.Mesh | null = null;
let ring: THREE.Mesh | null = null;

function ensure(): boolean {
  if (failed) return false;
  if (renderer) return true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    brightLights(scene);
    cam = new THREE.PerspectiveCamera(27, 1, 0.1, 40);
    cam.position.set(0.5, 1.0, 5.2);
    cam.lookAt(0, 0.72, 0);
    disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    disc.position.y = 0.01;
    ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.98, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.position.y = 0.012;
    scene.add(disc, ring);
    return true;
  } catch {
    failed = true;
    renderer = null;
    return false;
  }
}

const cache = new Map<string, Signal<string>>();
const queue: { key: string; id: string; rarity: Rarity; sig: Signal<string>; redo?: boolean }[] = [];

// model glTF của một tướng vừa tải xong: vẽ lại các thẻ đã có ảnh (ảnh cũ là mô hình procedural)
onHeroModelReady((id) => {
  for (const [key, sig] of cache) {
    const [hid, rarity] = key.split('|');
    if (hid !== id || !sig.value || sig.value === 'none') continue; // đang chờ trong hàng đợi thì sẽ tự dùng glTF
    queue.push({ key, id: hid, rarity: rarity as Rarity, sig, redo: true });
  }
  pump();
});
let pumping = false;

function renderOne(id: string, rarity: Rarity): string {
  if (!ensure() || !renderer || !scene || !cam || !disc || !ring) return '';
  const color = RARITY_GLOW[rarity];
  (disc.material as THREE.MeshBasicMaterial).color.setHex(color);
  (ring.material as THREE.MeshBasicMaterial).color.setHex(color);
  const model = createHeroModel(id, { outlines: true });
  model.object3d.rotation.y = 0.35;
  model.update(0.25);
  scene.add(model.object3d);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(model.object3d);
  model.dispose();
  return url;
}

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const it = queue.shift();
    if (!it) {
      pumping = false;
      return;
    }
    try {
      const url = renderOne(it.id, it.rarity);
      // vẽ lại (redo) mà thất bại thì giữ ảnh cũ thay vì ghi đè bằng 'none'
      if (url || !it.redo) it.sig.value = url || 'none';
    } catch (e) {
      console.error(e);
      if (!it.redo) it.sig.value = 'none';
    }
    // mỗi khung vẽ một ảnh để không giật
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** signal chứa dataURL ảnh ('' = đang chờ vẽ, 'none' = không vẽ được) */
export function portraitOf(id: string, rarity: Rarity = 'R'): Signal<string> {
  const key = `${id}|${rarity}`;
  let s = cache.get(key);
  if (!s) {
    s = signal('');
    cache.set(key, s);
    queue.push({ key, id, rarity, sig: s });
    pump();
  }
  return s;
}
