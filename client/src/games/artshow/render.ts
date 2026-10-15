import { ART_H, ART_PAPER, ART_W, ART_ERASER, strokeColorOf, strokeWidthOf, type ArtStroke } from '@shared/artshow';

/** Vẽ một nét: đi qua trung điểm các điểm (đường cong bậc hai) cho mượt, đầu/cuối bo tròn. */
export function paintStroke(g: CanvasRenderingContext2D, s: ArtStroke) {
  const [c, w, p] = s;
  const n = p.length / 2;
  const col = strokeColorOf(c);
  const lw = strokeWidthOf(c, w);
  let same = true;
  for (let i = 1; i < n && same; i++) if (p[2 * i] !== p[0] || p[2 * i + 1] !== p[1]) same = false;
  if (same) {
    g.fillStyle = col;
    g.beginPath();
    g.arc(p[0], p[1], lw / 2, 0, Math.PI * 2);
    g.fill();
    return;
  }
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(p[0], p[1]);
  if (n === 2) {
    g.lineTo(p[2], p[3]);
  } else {
    let mx = (p[0] + p[2]) / 2;
    let my = (p[1] + p[3]) / 2;
    g.lineTo(mx, my);
    for (let i = 1; i < n - 1; i++) {
      const nx = (p[2 * i] + p[2 * i + 2]) / 2;
      const ny = (p[2 * i + 1] + p[2 * i + 3]) / 2;
      g.quadraticCurveTo(p[2 * i], p[2 * i + 1], nx, ny);
      mx = nx;
      my = ny;
    }
    g.lineTo(p[2 * n - 2], p[2 * n - 1]);
  }
  g.stroke();
}

/** Đặt kích thước bộ đệm của canvas theo bề rộng CSS và trả về ctx đã scale về hệ toạ độ tranh (1000×750). */
export function setupCanvas(cv: HTMLCanvasElement, cssW: number, maxDpr = 2): CanvasRenderingContext2D | null {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.round((w * ART_H) / ART_W);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const g = cv.getContext('2d');
  if (!g) return null;
  g.setTransform(w / ART_W, 0, 0, w / ART_W, 0, 0);
  return g;
}

export function paintAll(g: CanvasRenderingContext2D, strokes: ArtStroke[]) {
  g.fillStyle = ART_PAPER;
  g.fillRect(0, 0, ART_W, ART_H);
  for (const s of strokes) paintStroke(g, s);
}

export { ART_ERASER };
