// Giao diện mô hình tướng/quái cho lớp 3D. Mọi nơi (trận đánh, chân dung, hub, chi tiết tướng) CHỈ dùng
// createHeroModel() — khi có glTF (GLTFLoader + AnimationMixer, xương đầu phóng to, gắn phụ kiện) chỉ cần
// đăng ký một nhà máy mới bằng registerModelFactory() mà không sửa nơi gọi.
import type * as THREE from 'three';
import { HERO_BY_ID } from '@shared/heroes/heroes';
import type { HeroDef } from '@shared/heroes/types';
import { HERO_STYLE } from './hero-extras';
import { createGltfHero, hasGltfHero } from './gltf-model';
import { createProceduralModel, monsterLook, type ProcLook } from './procedural-model';
import type { QualityState } from './quality';

export type HeroAnim = 'idle' | 'attack' | 'cast' | 'hit' | 'die' | 'win';

export interface HeroPalette {
  body: string;
  accent: string;
}

export interface HeroModel {
  /** nhóm 3D gốc, chân đứng ở y=0, mặt hướng +z */
  readonly object3d: THREE.Object3D;
  /** chiều cao (đơn vị thế giới) để đặt thanh máu / số nổi */
  readonly height: number;
  /** phát hoạt hình; 'die' và 'win' giữ nguyên, các loại còn lại tự về 'idle' */
  play(anim: HeroAnim): void;
  update(dt: number): void;
  setPalette(p: Partial<HeroPalette>): void;
  dispose(): void;
}

export interface ModelOptions {
  /** viền hoạt hình; mặc định theo preset chất lượng */
  outlines?: boolean;
}

type Factory = (src: HeroDef | string, opts: ModelOptions) => HeroModel | null;
const factories: Factory[] = [];

/** đăng ký nhà máy mô hình (glTF...) — được thử trước mô hình procedural; trả null để bỏ qua */
export function registerModelFactory(f: Factory) {
  factories.unshift(f);
}

/** `src` là HeroDef, id tướng hoặc khoá quái (mk_*) */
export function createHeroModel(src: HeroDef | string, opts: ModelOptions = {}): HeroModel {
  for (const f of factories) {
    const m = f(src, opts);
    if (m) return m;
  }
  const outlines = opts.outlines ?? true;
  let look: ProcLook;
  if (typeof src !== 'string') look = heroLook(src);
  else if (src.startsWith('mk_')) look = monsterLook(src);
  else {
    const d = HERO_BY_ID[src];
    look = d ? heroLook(d) : monsterLook('mk_con');
  }
  // tướng có glTF: wrapper hiện procedural ngay rồi tự đổi sang glTF khi tải xong
  const id = typeof src === 'string' ? src : src.id;
  if (hasGltfHero(id)) return createGltfHero(id, look.scale, outlines, () => createProceduralModel(look, outlines));
  return createProceduralModel(look, outlines);
}

export { onHeroModelReady, preloadHeroModels } from './gltf-model';

function heroLook(d: HeroDef): ProcLook {
  const st = HERO_STYLE[d.id];
  const props = st?.drop ? d.look.props.filter((p) => !st.drop!.includes(p)) : d.look.props;
  return {
    body: d.look.body, accent: d.look.accent, skin: '#ffd9b8', props, scale: d.rarity === 'UR' ? 1.12 : 1, monkey: false,
    hair: st?.hair, extra: st?.add,
  };
}

export function outlinesOf(q: QualityState): boolean {
  return q.outlines;
}
