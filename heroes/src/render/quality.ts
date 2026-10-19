// Preset chất lượng đồ hoạ (ý tưởng từ monkey/render/scene.ts): DPR tối đa 1.5, không đổ bóng thật.
import { quality, type Quality } from '../settings';

export type Level = 'high' | 'medium' | 'low';
export interface QualityState {
  level: Level;
  dpr: number;
  /** viền hoạt hình (vỏ phóng to) */
  outlines: boolean;
  /** số hạt hiệu ứng mỗi vụ nổ */
  particles: number;
  /** khung hình/giây tối đa */
  fps: number;
}

export function presetOf(level: Level): QualityState {
  const dev = Math.min(1.5, window.devicePixelRatio || 1);
  if (level === 'high') return { level, dpr: dev, outlines: true, particles: 8, fps: 60 };
  if (level === 'medium') return { level, dpr: Math.min(dev, 1.25), outlines: true, particles: 5, fps: 45 };
  return { level, dpr: Math.min(dev, 1), outlines: false, particles: 3, fps: 30 };
}

export function guessLevel(): Level {
  const touch = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as any).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (touch) return mem >= 6 && cores >= 8 ? 'medium' : 'low';
  if (cores <= 2 || mem <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

export function resolveQuality(q: Quality): Level {
  return q === 'auto' ? guessLevel() : q;
}

/** preset đang áp dụng theo cài đặt hiện tại */
export function currentPreset(): QualityState {
  return presetOf(resolveQuality(quality.value));
}
