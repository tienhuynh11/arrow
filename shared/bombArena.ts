/**
 * Vật lý đấu trường ĐUỔI BẮT BOM, dùng chung cho server (chốt kết quả) và client (dự đoán vị trí của chính mình).
 * Sân phẳng có các khối hộp thấp/cao: khối thấp nhảy lên được, khối cao phải nhảy từ khối thấp, cột rất cao chỉ để núp.
 */
export interface ArenaBox {
  /** tâm khối (đơn vị sân) */
  x: number;
  y: number;
  /** kích thước theo x / y */
  w: number;
  d: number;
  /** độ cao mặt trên */
  h: number;
  /** kiểu vẽ: crate (thùng), block (bục), pillar (cột), wall (tường thấp), stage (bục sân khấu) */
  kind: 'crate' | 'block' | 'pillar' | 'wall' | 'stage';
}

export interface ArenaBody {
  x: number;
  y: number;
  /** độ cao chân */
  z: number;
  vz: number;
}

export interface ArenaCfg {
  w: number;
  h: number;
  playerRadius: number;
  boxes: ArenaBox[];
}

export const GRAVITY = 105;
export const JUMP_V = 41;
/** bước lên được khối thấp hơn mức này mà không cần nhảy */
export const STEP = 1.6;

/** điểm gần nhất của hình chữ nhật tới (px, py) */
const near = (b: ArenaBox, px: number, py: number) => ({
  x: Math.max(b.x - b.w / 2, Math.min(b.x + b.w / 2, px)),
  y: Math.max(b.y - b.d / 2, Math.min(b.y + b.d / 2, py)),
});

/** độ cao mặt đất tại chỗ đứng: khối cao nhất mà chân đang ở trên hoặc chỉ thấp hơn mặt một chút */
export function groundAt(cfg: ArenaCfg, x: number, y: number, z: number): number {
  let g = 0;
  const reach = cfg.playerRadius * 0.55;
  for (const b of cfg.boxes) {
    if (b.h <= g || z < b.h - STEP) continue;
    const n = near(b, x, y);
    if (Math.hypot(n.x - x, n.y - y) < reach) g = b.h;
  }
  return g;
}

/** đẩy vòng tròn ra khỏi những khối mà chân đang thấp hơn mặt (khối coi như tường) */
function pushOut(cfg: ArenaCfg, p: { x: number; y: number }, z: number) {
  const r = cfg.playerRadius;
  for (const b of cfg.boxes) {
    if (z >= b.h - STEP) continue;
    const n = near(b, p.x, p.y);
    const dx = p.x - n.x;
    const dy = p.y - n.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= r) continue;
    if (dist > 1e-4) {
      p.x = n.x + (dx / dist) * r;
      p.y = n.y + (dy / dist) * r;
    } else {
      // tâm nằm trong khối: đẩy ra theo cạnh gần nhất
      const left = p.x - (b.x - b.w / 2);
      const right = b.x + b.w / 2 - p.x;
      const top = p.y - (b.y - b.d / 2);
      const bottom = b.y + b.d / 2 - p.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = b.x - b.w / 2 - r;
      else if (m === right) p.x = b.x + b.w / 2 + r;
      else if (m === top) p.y = b.y - b.d / 2 - r;
      else p.y = b.y + b.d / 2 + r;
    }
  }
}

/** Một bước vật lý: chạy theo (dx,dy) đã chuẩn hoá, nhảy nếu được yêu cầu và đang đứng trên mặt. */
export function stepBody(cfg: ArenaCfg, b: ArenaBody, dx: number, dy: number, speed: number, jump: boolean, dt: number) {
  if (dt <= 0) return;
  const r = cfg.playerRadius;
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    b.x += (dx / len) * speed * dt;
    b.y += (dy / len) * speed * dt;
  }
  b.x = Math.max(r, Math.min(cfg.w - r, b.x));
  b.y = Math.max(r, Math.min(cfg.h - r, b.y));
  // va chạm vài lần để thoát khỏi góc giữa hai khối
  for (let i = 0; i < 2; i++) pushOut(cfg, b, b.z);
  b.x = Math.max(r, Math.min(cfg.w - r, b.x));
  b.y = Math.max(r, Math.min(cfg.h - r, b.y));

  const ground = groundAt(cfg, b.x, b.y, b.z);
  const grounded = b.z <= ground + 0.01 && b.vz <= 0;
  if (grounded) {
    b.z = ground;
    b.vz = 0;
    if (jump) b.vz = JUMP_V;
  }
  if (b.vz !== 0 || b.z > ground) {
    b.vz -= GRAVITY * dt;
    b.z += b.vz * dt;
    if (b.z <= ground && b.vz <= 0) {
      b.z = ground;
      b.vz = 0;
    }
  }
}
