// File này KHÔNG import three: màn hình game gọi nó để quyết định có tải 3D hay không.

export type Tier = 'high' | 'medium' | 'low';

export const TIER_LABEL: Record<Tier, string> = { high: 'CAO', medium: 'VỪA', low: 'NHẸ' };

let supported: boolean | null = null;

export function webglSupported(): boolean {
  if (supported !== null) return supported;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    supported = !!gl;
    // trả context thăm dò lại ngay, trình duyệt giới hạn số context đang mở
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}

/**
 * Đoán mức đồ hoạ ban đầu theo cấu hình máy. Chỉ là điểm xuất phát:
 * engine còn đo FPS thật và tự hạ mức nếu máy không kéo nổi.
 * Có thể ép mức bằng localStorage `arrow-3d-quality` = high | medium | low.
 */
export function initialTier(): Tier {
  try {
    const forced = localStorage.getItem('arrow-3d-quality');
    if (forced === 'high' || forced === 'medium' || forced === 'low') return forced;
  } catch {
    /* bỏ qua */
  }
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (mobile || cores <= 4 || memory <= 4) return 'low';
  if (cores <= 8) return 'medium';
  return 'high';
}

export const lowerTier = (t: Tier): Tier | null => (t === 'high' ? 'medium' : t === 'medium' ? 'low' : null);
