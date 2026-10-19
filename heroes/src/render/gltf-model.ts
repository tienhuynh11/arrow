// Mô hình glTF (Quaternius CC0) cho một số tướng; tướng còn lại vẫn dùng mô hình procedural.
// - Mỗi file glTF/texture chỉ tải MỘT lần (cache), mọi thể hiện dùng SkeletonUtils.clone nên dùng chung hình khối.
// - createHeroModel() vẫn đồng bộ: wrapper hiện mô hình procedural ngay, tải xong thì đổi sang glTF (giữ trạng thái).
// - Thêm tướng glTF mới = thêm một mục vào GLTF_HEROES (+ file trong public/models, ghi vào ASSETS.md).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { HeroAnim, HeroModel, HeroPalette } from './hero-model';
import { gradient } from './procedural-model';

/** độ sáng nhân vào texture glTF (>1 được vì màu là số thực) */
const GLTF_BRIGHT = 2.3;
let gltfGradTex: THREE.DataTexture | null = null;
/** dải toon 3 bậc cho model glTF: bậc tối nhất còn ~80% thay vì 43% như model dựng bằng code */
function gltfGradient(): THREE.DataTexture {
  if (!gltfGradTex) {
    gltfGradTex = new THREE.DataTexture(new Uint8Array([205, 235, 255]), 3, 1, THREE.RedFormat);
    gltfGradTex.minFilter = gltfGradTex.magFilter = THREE.NearestFilter;
    gltfGradTex.needsUpdate = true;
  }
  return gltfGradTex;
}

/* ------------------------------ CẤU HÌNH ------------------------------ */
const BASE = import.meta.env.BASE_URL;

export interface GltfHeroCfg {
  url: string;
  /** tên vật liệu trong glTF -> ảnh PNG (glTF không nhúng ảnh nên gán lúc chạy) */
  textures: Record<string, string>;
  /** tên mesh là vũ khí: không tính vào chiều cao chuẩn hoá */
  weapons: string[];
  /** hệ số phóng xương Head cho dáng chibi (đầu to) */
  headScale: number;
  /** chiều cao thân (không kể vũ khí) sau chuẩn hoá, đơn vị thế giới */
  height: number;
  /** clip theo trạng thái (không kèm tiền tố `CharacterArmature|`); lấy clip đầu tiên có thật, 'cast' chọn ngẫu nhiên trong danh sách */
  clips: Record<HeroAnim, string[]>;
  /** tốc độ phát clip (trận đánh cần đòn ngắn hơn clip gốc) */
  speed: Partial<Record<HeroAnim, number>>;
}

/** model glTF đang BẬT (rỗng = mọi tướng dùng chibi dựng bằng code). Thêm tướng = thêm một mục theo mẫu GLTF_SAMPLE bên dưới. */
export const GLTF_HEROES: Record<string, GltfHeroCfg> = {};

/** mẫu cấu hình (đã thử với Quaternius RPG Characters, tạm tắt vì phong cách không hợp; file model đã xoá khỏi public/) */
export const GLTF_SAMPLE: Record<string, GltfHeroCfg> = {
  linh_rung: {
    url: `${BASE}models/warrior.glb`,
    textures: {
      Warrior_Texture: `${BASE}models/tex/warrior.png`,
      Warrior_Sword_Texture: `${BASE}models/tex/warrior_sword.png`,
    },
    weapons: ['Warrior_Sword'],
    headScale: 1.55,
    height: 1.95,
    clips: {
      idle: ['Idle_Weapon', 'Idle'],
      attack: ['Sword_Attack'],
      cast: ['Sword_AttackFast'],
      hit: ['RecieveHit'],
      die: ['Death'],
      win: ['Punch', 'Idle'],
    },
    speed: { attack: 1.4, cast: 1.4, hit: 1.3, die: 1, win: 1 },
  },
  phap_su_re: {
    url: `${BASE}models/wizard.glb`,
    textures: {
      Wizard_Texture: `${BASE}models/tex/wizard.png`,
      Wizard_Staff_Texture: `${BASE}models/tex/wizard_staff.png`,
    },
    weapons: ['Wizard_Staff'],
    headScale: 1.55,
    height: 1.95,
    clips: {
      idle: ['Idle_Weapon', 'Idle'],
      attack: ['Staff_Attack'],
      cast: ['Spell1', 'Spell2'],
      hit: ['RecieveHit'],
      die: ['Death'],
      win: ['Punch', 'Idle'],
    },
    speed: { attack: 1.2, cast: 1.6, hit: 1.3, die: 1, win: 1 },
  },
};

export const hasGltfHero = (id: string) => id in GLTF_HEROES;

/** độ dày viền (đơn vị thế giới) và màu viền — khớp OUTLINE của mô hình procedural */
const OUTLINE_W = 0.006;
const OUTLINE_COLOR = 0x1a2140;
const FADE = 0.12;
const HUD_HEIGHT = 1.95; // trùng chiều cao mô hình procedural để thanh máu / số nổi giữ nguyên vị trí

/* ------------------------------ TẢI + CACHE ------------------------------ */
interface Asset {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  tex: Map<string, THREE.Texture>;
  /** hệ số thu phóng về chiều cao chuẩn + dịch y để chân đứng ở y=0 (đơn vị gốc, trước khi nhân scale) */
  scale: number;
  yOff: number;
  /** độ dày viền theo hệ toạ độ cục bộ của từng mesh (theo tên) */
  thick: Map<string, number>;
}

const ready = new Map<string, Asset>();
const loading = new Map<string, Promise<Asset | null>>();
const warned = new Set<string>();
const listeners = new Set<(id: string) => void>();

let gltfLoader: GLTFLoader | null = null;
let texLoader: THREE.TextureLoader | null = null;
const texCache = new Map<string, Promise<THREE.Texture>>();

/** texture dùng chung toàn app: KHÔNG bao giờ dispose khi một thể hiện bị huỷ */
function loadTex(url: string): Promise<THREE.Texture> {
  let p = texCache.get(url);
  if (!p) {
    texLoader ??= new THREE.TextureLoader();
    p = texLoader.loadAsync(url).then((t) => {
      t.flipY = false; // glTF dùng UV gốc trên-trái
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    texCache.set(url, p);
  }
  return p;
}

/** đăng ký callback khi mô hình glTF của một tướng tải xong (portraits dùng để vẽ lại thẻ); trả hàm huỷ đăng ký */
export function onHeroModelReady(cb: (id: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function warnOnce(id: string, e: unknown) {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[heroes] không tải được model glTF của "${id}", dùng mô hình procedural`, e);
}

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;
const isSkinned = (o: THREE.Object3D): o is THREE.SkinnedMesh => (o as THREE.SkinnedMesh).isSkinnedMesh === true;

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (isMesh(o)) out.push(o);
  });
  return out;
}

function setHead(root: THREE.Object3D, k: number) {
  root.getObjectByName('Head')?.scale.setScalar(k);
}

/** đo chiều cao thân (bỏ vũ khí) khi đã phóng đầu, tính hệ số chuẩn hoá + độ dày viền cục bộ */
function measure(src: THREE.Group, cfg: GltfHeroCfg): Pick<Asset, 'scale' | 'yOff' | 'thick'> {
  const probe = cloneSkinned(src) as THREE.Group;
  setHead(probe, cfg.headScale);
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const meshes = meshesOf(probe);
  for (const m of meshes) {
    if (cfg.weapons.includes(m.name)) continue;
    if (isSkinned(m)) {
      m.skeleton.update();
      m.computeBoundingBox();
      if (!m.boundingBox) continue;
      tmp.copy(m.boundingBox);
    } else {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox!);
    }
    tmp.applyMatrix4(m.matrixWorld);
    box.union(tmp);
  }
  let h = box.max.y - box.min.y;
  if (!Number.isFinite(h) || h <= 1e-6) {
    h = 3; // số đo thủ công của Quaternius (≈3 đơn vị) nếu đo hỏng
    box.min.y = 0;
  }
  const scale = cfg.height / h;
  const thick = new Map<string, number>();
  for (const m of meshes) {
    const ws = Math.max(1e-6, m.matrixWorld.getMaxScaleOnAxis() * scale);
    thick.set(m.name, OUTLINE_W / ws);
  }
  return { scale, yOff: -box.min.y, thick };
}

async function load(id: string): Promise<Asset | null> {
  const cfg = GLTF_HEROES[id];
  try {
    gltfLoader ??= new GLTFLoader();
    const [gltf, texList] = await Promise.all([
      gltfLoader.loadAsync(cfg.url),
      Promise.all(Object.entries(cfg.textures).map(async ([name, url]) => [name, await loadTex(url)] as const)),
    ]);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of gltf.animations) {
      // bỏ track scale để không đè hệ số phóng đầu; bỏ tiền tố "CharacterArmature|"
      c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale'));
      clips.set(c.name.split('|').pop()!, c);
    }
    const m = measure(gltf.scene, cfg);
    const asset: Asset = { scene: gltf.scene, clips, tex: new Map(texList), ...m };
    ready.set(id, asset);
    for (const cb of listeners) cb(id);
    return asset;
  } catch (e) {
    warnOnce(id, e);
    return null;
  }
}

function startLoad(id: string): Promise<Asset | null> {
  const got = ready.get(id);
  if (got) return Promise.resolve(got);
  let p = loading.get(id);
  if (!p && hasGltfHero(id)) {
    p = load(id);
    loading.set(id, p);
  }
  return p ?? Promise.resolve(null);
}

/** bắt đầu tải sớm model của các tướng (id không có glTF thì bỏ qua) */
export function preloadHeroModels(ids: string[]): void {
  for (const id of ids) if (hasGltfHero(id) && !ready.has(id) && !loading.has(id)) void startLoad(id);
}

/* ------------------------------ VIỀN ------------------------------ */
// Vỏ quay mặt trong, đẩy đỉnh ra theo pháp tuyến SAU khi skinning (nên bám theo xương). Vật liệu dùng chung theo độ dày.
const outlineCache = new Map<string, THREE.MeshBasicMaterial>();
function outlineMat(t: number): THREE.MeshBasicMaterial {
  const key = t.toPrecision(3);
  let m = outlineCache.get(key);
  if (!m) {
    const mat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uOutline = { value: t };
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'uniform float uOutline;\nvoid main() {')
        .replace(
          '#include <skinning_vertex>',
          '#include <skinning_vertex>\n#ifdef USE_SKINNING\n\ttransformed += normalize(objectNormal) * uOutline;\n#else\n\ttransformed += normalize(normal) * uOutline;\n#endif',
        );
    };
    mat.customProgramCacheKey = () => 'heroGltfOutline';
    outlineCache.set(key, mat);
    m = mat;
  }
  return m;
}

/* ------------------------------ MỘT THỂ HIỆN GLTF ------------------------------ */
const shown = (o: THREE.Object3D | null) => {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
};

function makeInstance(id: string, asset: Asset, baseScale: number, outlines: boolean): HeroModel {
  const cfg = GLTF_HEROES[id];
  const body = cloneSkinned(asset.scene) as THREE.Group;
  setHead(body, cfg.headScale);
  body.position.y = asset.yOff;
  const holder = new THREE.Group();
  holder.scale.setScalar(asset.scale);
  holder.add(body);
  const root = new THREE.Group();
  root.add(holder);
  root.scale.setScalar(baseScale);

  // vật liệu riêng mỗi thể hiện (để nháy khi trúng đòn) nhưng texture dùng chung; khớp theo TÊN vật liệu
  const mats = new Map<string, THREE.MeshToonMaterial>();
  const matFor = (name: string, orig: THREE.Material): THREE.MeshToonMaterial => {
    let m = mats.get(name);
    if (!m) {
      const map = asset.tex.get(name) ?? null;
      const col = (orig as THREE.MeshStandardMaterial).color;
      // bảng màu gốc của Quaternius khá đậm: nhân sáng + dải toon có mức tối thiểu cao hơn để hợp giao diện tươi sáng
      m = new THREE.MeshToonMaterial({ color: map || !col ? new THREE.Color(GLTF_BRIGHT, GLTF_BRIGHT, GLTF_BRIGHT) : col, map, gradientMap: gltfGradient() });
      mats.set(name, m);
    }
    return m;
  };
  const skeletons: THREE.Skeleton[] = [];
  for (const mesh of meshesOf(body)) {
    const orig = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    mesh.material = matFor(orig.name, orig);
    mesh.frustumCulled = false; // hộp bao theo tư thế gốc, bỏ cắt để không biến mất khi đang diễn
    if (isSkinned(mesh)) skeletons.push(mesh.skeleton);
    // mesh có xương (thân/áo choàng mỏng): vỏ viền đè lên bề mặt làm áo tối đen → bỏ viền ở đây, chỉ viền phần cứng (mặt, vai, vũ khí)
    if (outlines && !isSkinned(mesh)) {
      const om = outlineMat(asset.thick.get(mesh.name) ?? 0.0004);
      let hull: THREE.Mesh;
      if (isSkinned(mesh)) {
        const sk = new THREE.SkinnedMesh(mesh.geometry, om);
        sk.bind(mesh.skeleton, mesh.bindMatrix);
        sk.position.copy(mesh.position);
        sk.quaternion.copy(mesh.quaternion);
        sk.scale.copy(mesh.scale);
        hull = sk;
        mesh.parent?.add(sk);
      } else {
        hull = new THREE.Mesh(mesh.geometry, om);
        mesh.add(hull);
      }
      hull.frustumCulled = false;
    }
  }

  /* --- hoạt hình --- */
  const mixer = new THREE.AnimationMixer(body);
  const pick = (names: string[]): THREE.AnimationAction | null => {
    for (const n of names) {
      const c = asset.clips.get(n);
      if (c) return mixer.clipAction(c);
    }
    return null;
  };
  const idleA = pick(cfg.clips.idle);
  const attackA = pick(cfg.clips.attack);
  const hitA = pick(cfg.clips.hit);
  const dieA = pick(cfg.clips.die);
  const winA = pick(cfg.clips.win) ?? idleA;
  const castAs = cfg.clips.cast.map((n) => pick([n])).filter((a): a is THREE.AnimationAction => !!a);

  let cur: THREE.AnimationAction | null = null;
  let base: 'idle' | 'win' | 'die' = 'idle';
  const fadeTo = (next: THREE.AnimationAction | null, loop: boolean, speed: number) => {
    if (!next) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = speed;
    if (cur && cur !== next) next.crossFadeFrom(cur, FADE, false);
    else next.fadeIn(FADE);
    next.play();
    cur = next;
  };
  const resting = () => (base === 'win' ? winA : idleA);
  mixer.addEventListener('finished', (e) => {
    // đòn một lần xong -> hoà trộn về tư thế nghỉ
    if (base === 'die' || (e as unknown as { action: THREE.AnimationAction }).action !== cur) return;
    fadeTo(resting(), true, 1);
  });

  fadeTo(idleA, true, 1);
  if (idleA) idleA.time = Math.random() * idleA.getClip().duration; // lệch pha để đội hình không đồng bộ
  mixer.update(0);

  /* --- nháy trắng khi trúng đòn / chết --- */
  let flashT = 0;
  let flashOn = false;
  const setFlash = (v: number) => {
    const on = v > 0;
    if (on === flashOn && !on) return;
    flashOn = on;
    for (const m of mats.values()) m.emissive.setRGB(v, v, v);
  };

  let dieT = 0;
  const sp = (a: HeroAnim) => cfg.speed[a] ?? 1;

  return {
    object3d: root,
    height: HUD_HEIGHT * baseScale,
    play(a: HeroAnim) {
      if (a === 'die') {
        base = 'die';
        dieT = 0;
        fadeTo(dieA, false, sp('die'));
        flashT = 0.15;
        setFlash(0.6);
      } else if (base === 'die') {
        return;
      } else if (a === 'idle') {
        base = 'idle';
        fadeTo(idleA, true, 1);
      } else if (a === 'win') {
        base = 'win';
        fadeTo(winA, true, sp('win'));
      } else if (a === 'hit') {
        fadeTo(hitA, false, sp('hit'));
        flashT = 0.13;
        setFlash(0.7);
      } else if (a === 'attack') {
        fadeTo(attackA, false, sp('attack'));
      } else if (castAs.length) {
        fadeTo(castAs[(Math.random() * castAs.length) | 0], false, sp('cast'));
      }
    },
    update(dt: number) {
      if (!shown(root)) return; // đang ẩn: không tốn CPU cho mixer
      if (base === 'die') {
        dieT += dt;
        const sh = Math.min(1, Math.max(0, (dieT - 1.2) / 0.5));
        root.scale.setScalar(baseScale * Math.max(0.001, 1 - sh));
        if (sh >= 1) {
          root.visible = false;
          return;
        }
      }
      mixer.update(dt);
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) setFlash(0);
      }
    },
    setPalette(_p: Partial<HeroPalette>) {
      /* màu lấy từ texture, không đổi theo palette */
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(body);
      for (const s of skeletons) s.dispose();
      // chỉ vật liệu của thể hiện này; geometry, texture và vật liệu viền là dùng chung nên giữ lại
      for (const m of mats.values()) m.dispose();
    },
  };
}

/* ------------------------------ WRAPPER ĐỒNG BỘ ------------------------------ */
/**
 * Trả về ngay một HeroModel: nếu asset đã có thì dựng glTF luôn, chưa có thì hiện mô hình procedural (makeFallback)
 * và đổi sang glTF khi tải xong — object3d bên ngoài là nhóm cố định nên vị trí/xoay/scale do nơi gọi đặt được giữ nguyên.
 */
export function createGltfHero(id: string, baseScale: number, outlines: boolean, makeFallback: () => HeroModel): HeroModel {
  const outer = new THREE.Group();
  let impl: HeroModel;
  let disposed = false;
  let last: HeroAnim = 'idle'; // trạng thái bền gần nhất (idle/win/die) để giữ lại khi đổi mô hình
  const a0 = ready.get(id);
  if (a0) impl = makeInstance(id, a0, baseScale, outlines);
  else {
    impl = makeFallback();
    void startLoad(id).then((a) => {
      if (disposed || !a) return;
      const next = makeInstance(id, a, baseScale, outlines);
      outer.remove(impl.object3d);
      impl.dispose();
      impl = next;
      outer.add(next.object3d);
      if (last !== 'idle') next.play(last);
    });
  }
  outer.add(impl.object3d);
  return {
    object3d: outer,
    get height() {
      return impl.height;
    },
    play(a: HeroAnim) {
      if (a === 'idle' || a === 'win' || a === 'die') last = a;
      impl.play(a);
    },
    update(dt: number) {
      impl.update(dt);
    },
    setPalette(p: Partial<HeroPalette>) {
      impl.setPalette(p);
    },
    dispose() {
      disposed = true;
      impl.dispose();
    },
  };
}
