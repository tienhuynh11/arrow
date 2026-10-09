/**
 * Đấu trường tròn của GHẾ ÂM NHẠC, dùng chung cho server (chốt vị trí) và client (dự đoán chính mình).
 * Toạ độ tính từ tâm sân (0,0). Chạy tự do mọi hướng theo hướng màn hình.
 */
export interface ChairCfg {
  /** bán kính sân */
  r: number;
  /** bán kính thân người */
  body: number;
  speed: number;
}

export function stepChair(cfg: ChairCfg, p: { x: number; y: number }, dx: number, dy: number, dt: number) {
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

/**
 * Lúc nhạc phát: mọi người chạy vòng tròn quanh ghế THEO MỘT HƯỚNG cố định (ngược chiều kim đồng hồ trên sân),
 * giữ nguyên làn của mình. `k` là hệ số tốc độ (chậm lại / bình thường / nhanh hơn).
 */
export function trackStep(speed: number, p: { x: number; y: number }, lane: number, k: number, dt: number) {
  if (dt <= 0) return;
  const a = Math.atan2(p.y, p.x) + ((speed * k) / lane) * dt;
  p.x = Math.cos(a) * lane;
  p.y = Math.sin(a) * lane;
}

/** hệ số tốc độ theo phím: ↑ → W D nhanh hơn, ↓ ← S A chậm lại, không bấm thì bình thường */
export const trackFactor = (dx: number, dy: number) => (dy < 0 || dx > 0 ? 1.3 : dy > 0 || dx < 0 ? 0.55 : 1);
