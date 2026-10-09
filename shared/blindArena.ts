/**
 * Đấu trường tròn của ĐẤU TRƯỜNG MÙ, dùng chung cho server (chốt di chuyển + bắn) và client (dự đoán chính mình).
 * Toạ độ tính từ tâm sân (0,0). Góc `a`: hướng ngắm = (sin a, cos a) theo (x, y).
 */
export interface BlindBody {
  x: number;
  y: number;
  a: number;
}

export interface BlindCfg {
  /** bán kính sân HIỆN TẠI (callers truyền bản đã thu theo vòng, xem blindRadius) */
  r: number;
  /** bán kính thân người */
  body: number;
  speed: number;
  /** bán kính trúng đạn quanh tâm người bị bắn */
  hit: number;
}

/**
 * Chạy tự do theo hướng màn hình: dx +1 sang phải, dy +1 xuống (về phía camera). Hướng súng `p.a` do chuột đặt riêng.
 */
export function stepBlind(cfg: BlindCfg, p: BlindBody, dx: number, dy: number, dt: number) {
  if (dt <= 0) return;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    p.x += (dx / len) * cfg.speed * dt;
    p.y += (dy / len) * cfg.speed * dt;
  }
  const lim = cfg.r - cfg.body;
  const d = Math.hypot(p.x, p.y);
  if (d > lim) {
    p.x = (p.x / d) * lim;
    p.y = (p.y / d) * lim;
  }
}

/** tia bắn từ `from` theo hướng a: trả về người bị trúng gần nhất (nếu có) và độ dài tia tới mép sân hoặc tới người đó */
export function shoot(
  cfg: BlindCfg,
  from: BlindBody,
  targets: { id: string; x: number; y: number }[],
): { hit: string | null; len: number } {
  const dx = Math.sin(from.a);
  const dy = Math.cos(from.a);
  let hit: string | null = null;
  let best = Infinity;
  for (const t of targets) {
    const ox = t.x - from.x;
    const oy = t.y - from.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perp = Math.abs(ox * dy - oy * dx);
    if (perp > cfg.hit) continue;
    if (along < best) {
      best = along;
      hit = t.id;
    }
  }
  if (hit) return { hit, len: best };
  // tới mép sân: giải |from + k·d| = r
  const b = from.x * dx + from.y * dy;
  const c = from.x * from.x + from.y * from.y - cfg.r * cfg.r;
  const k = -b + Math.sqrt(Math.max(0, b * b - c));
  return { hit: null, len: k };
}

/** thời gian sân co lại từ bán kính vòng trước sang vòng này, tính từ đầu vòng */
export const BLIND_SHRINK_MS = 2200;

/** bảng bán kính theo vòng: giảm đều từ r0 xuống rMin ở vòng cuối */
export function blindRadii(rounds: number, r0 = 105, rMin = 42): number[] {
  const out: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t = rounds > 1 ? i / (rounds - 1) : 0;
    out.push(Math.round((r0 - (r0 - rMin) * t) * 10) / 10);
  }
  return out;
}

/** bán kính sân tại `offMs` ms kể từ đầu vòng `round`: co mượt (smoothstep) từ vòng trước sang vòng này */
export function blindRadius(radii: number[], round: number, offMs: number): number {
  const cur = radii[Math.max(0, Math.min(radii.length - 1, round))];
  const prev = round > 0 ? radii[Math.min(radii.length - 1, round - 1)] : cur;
  const t = Math.max(0, Math.min(1, offMs / BLIND_SHRINK_MS));
  return prev + (cur - prev) * (t * t * (3 - 2 * t));
}
