/** Bộ hình của HÃY CHỌN GIÁ ĐÚNG: vẽ bằng canvas 2D (0 byte ảnh), dùng chung cho sàn 3D và ô "hình cần tìm" ở HUD. */
export interface MmSymbol {
  /** màu chủ đạo của hình */
  hex: string;
  draw(g: CanvasRenderingContext2D, c: number, r: number): void;
}

const poly = (g: CanvasRenderingContext2D, c: number, pts: [number, number][]) => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(c + x, c + y) : g.moveTo(c + x, c + y)));
  g.closePath();
};

const star = (g: CanvasRenderingContext2D, c: number, r: number) => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  poly(g, c, pts);
};

export const MM_SYMBOLS: MmSymbol[] = [
  { hex: '#ffb703', draw: (g, c, r) => star(g, c, r) },
  {
    hex: '#ff4d6d',
    draw: (g, c, r) => {
      g.beginPath();
      g.moveTo(c, c + r * 0.9);
      g.bezierCurveTo(c - r * 1.5, c + r * 0.05, c - r * 0.7, c - r * 1.0, c, c - r * 0.35);
      g.bezierCurveTo(c + r * 0.7, c - r * 1.0, c + r * 1.5, c + r * 0.05, c, c + r * 0.9);
      g.closePath();
    },
  },
  { hex: '#38bdf8', draw: (g, c, r) => poly(g, c, [[0, -r], [r * 0.8, 0], [0, r], [-r * 0.8, 0]]) },
  {
    hex: '#3ddc84',
    draw: (g, c, r) => {
      g.beginPath();
      g.arc(c, c, r * 0.85, 0, Math.PI * 2);
    },
  },
  { hex: '#a78bfa', draw: (g, c, r) => poly(g, c, [[0, -r], [r * 0.95, r * 0.8], [-r * 0.95, r * 0.8]]) },
  {
    hex: '#ff8a3d',
    draw: (g, c, r) => {
      const a = r * 0.34;
      poly(g, c, [[-a, -r], [a, -r], [a, -a], [r, -a], [r, a], [a, a], [a, r], [-a, r], [-a, a], [-r, a], [-r, -a], [-a, -a]]);
    },
  },
  {
    hex: '#22d3c5',
    draw: (g, c, r) => {
      g.beginPath();
      g.arc(c, c, r * 0.9, 0.35 * Math.PI, 1.65 * Math.PI, false);
      g.arc(c + r * 0.38, c, r * 0.72, 1.55 * Math.PI, 0.45 * Math.PI, true);
      g.closePath();
    },
  },
  { hex: '#f472b6', draw: (g, c, r) => poly(g, c, [[-r, -r * 0.7], [r, -r * 0.7], [r, r * 0.7], [-r, r * 0.7]]) },
];

/** vẽ hình `id` vào canvas vuông cạnh `size`: nền trong suốt, viền trắng dày cho dễ nhìn từ xa */
export function drawSymbol(g: CanvasRenderingContext2D, id: number, size: number) {
  const s = MM_SYMBOLS[id] ?? MM_SYMBOLS[0];
  const c = size / 2;
  const r = size * 0.38;
  g.clearRect(0, 0, size, size);
  g.lineJoin = 'round';
  s.draw(g, c, r);
  g.lineWidth = size * 0.1;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = s.hex;
  g.fill();
}

/** dấu "?" của ô đã úp */
export function drawHidden(g: CanvasRenderingContext2D, size: number) {
  g.clearRect(0, 0, size, size);
  g.font = `900 ${size * 0.72}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = size * 0.1;
  g.lineJoin = 'round';
  g.strokeStyle = '#ffffff';
  g.strokeText('?', size / 2, size * 0.54);
  g.fillStyle = '#9aa4c8';
  g.fillText('?', size / 2, size * 0.54);
}
