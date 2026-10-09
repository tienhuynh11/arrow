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
  /** bán kính sân */
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
