// Atlas khuôn mặt vẽ bằng canvas MỘT LẦN (không file ảnh): 8 biểu cảm xếp 4 cột x 2 hàng.
// Mỗi mô hình chỉ giữ một bản clone texture (chung ảnh nguồn) và đổi offset khi đổi trạng thái -> rất rẻ.
import * as THREE from 'three';

/** chỉ số ô biểu cảm */
export const FACE = { idle: 0, blink: 1, attack: 2, cast: 3, hit: 4, die: 5, win: 6, wink: 7 } as const;
export type FaceCell = (typeof FACE)[keyof typeof FACE];

export const CELL_W = 192;
export const CELL_H = 112;
const INK = '#1b1f33';
const BROW = '#3a2a22';
const MOUTH = '#6b1f2a';
const EX = [56, 136]; // x hai mắt
const EY = 55;
const BY = 28; // y lông mày

const bases = new Map<string, THREE.CanvasTexture>();

function line(c: CanvasRenderingContext2D, pts: number[][], w: number, col: string) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.stroke();
}
function ell(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, col: string) {
  c.fillStyle = col;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}
function arc(c: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number, w: number, col: string) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(x, y, r, a0, a1);
  c.stroke();
}
function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  c.fillStyle = col;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.32;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

function eyeOpen(c: CanvasRenderingContext2D, x: number, sx: number, k = 1) {
  ell(c, x, EY, 15 * k, 20 * k, INK);
  ell(c, x + 5 * sx * 0 + 4, EY - 8 * k, 6 * k, 6.5 * k, '#fff');
  ell(c, x - 4, EY + 8 * k, 3 * k, 3 * k, '#fff');
}
function eyeSparkle(c: CanvasRenderingContext2D, x: number) {
  ell(c, x, EY, 17, 22, INK);
  star(c, x, EY - 1, 14, '#fff7b0');
  ell(c, x + 6, EY - 9, 4.5, 4.5, '#fff');
  star(c, x + 20, EY - 24, 7, '#ffe14d');
}
function eyeHappy(c: CanvasRenderingContext2D, x: number) {
  arc(c, x, EY + 9, 14, Math.PI * 1.1, Math.PI * 1.9, 6, INK);
}
function eyeBlink(c: CanvasRenderingContext2D, x: number) {
  arc(c, x, EY - 4, 14, Math.PI * 0.12, Math.PI * 0.88, 5, INK);
}
function brow(c: CanvasRenderingContext2D, x: number, sx: number, dy: number, tilt: number) {
  // sx = -1 mắt trái (đầu trong ở bên phải). tilt < 0: đầu trong nhướn lên (lo/ngạc nhiên)
  line(c, [[x - sx * 14, BY + dy + tilt], [x, BY + dy - 2], [x + sx * 14, BY + dy - tilt]], 5.5, BROW);
}

function drawCell(c: CanvasRenderingContext2D, cell: number, cheeks: boolean) {
  if (cheeks) {
    const a = cell === 4 ? 0.8 : 0.55;
    ell(c, 25, 82, 13, 8, `rgba(255,110,135,${a})`);
    ell(c, 167, 82, 13, 8, `rgba(255,110,135,${a})`);
  }
  const [lx, rx] = EX;
  switch (cell) {
    case FACE.idle:
      eyeOpen(c, lx, 1);
      eyeOpen(c, rx, -1);
      brow(c, lx, -1, 0, -1);
      brow(c, rx, 1, 0, -1);
      arc(c, 96, 82, 11, Math.PI * 0.15, Math.PI * 0.85, 5, MOUTH);
      break;
    case FACE.blink:
      eyeBlink(c, lx);
      eyeBlink(c, rx);
      arc(c, 96, 82, 11, Math.PI * 0.15, Math.PI * 0.85, 5, MOUTH);
      break;
    case FACE.attack: {
      // mắt nhỏ quyết tâm, mày cau, nghiến răng
      eyeOpen(c, lx, 1, 0.85);
      eyeOpen(c, rx, -1, 0.85);
      line(c, [[lx - 18, BY - 4], [lx + 16, BY + 10]], 7, BROW);
      line(c, [[rx + 18, BY - 4], [rx - 16, BY + 10]], 7, BROW);
      c.fillStyle = '#fff';
      c.strokeStyle = INK;
      c.lineWidth = 4;
      c.beginPath();
      c.roundRect(80, 80, 32, 15, 5);
      c.fill();
      c.stroke();
      line(c, [[96, 80], [96, 95]], 2.5, INK);
      break;
    }
    case FACE.cast:
      eyeSparkle(c, lx);
      eyeSparkle(c, rx);
      brow(c, lx, -1, -7, -2);
      brow(c, rx, 1, -7, -2);
      ell(c, 96, 90, 12, 14, MOUTH);
      ell(c, 96, 98, 8, 6, '#ff8aa0');
      break;
    case FACE.hit:
      // mắt ><
      line(c, [[lx - 13, EY - 13], [lx + 9, EY], [lx - 13, EY + 13]], 6.5, INK);
      line(c, [[rx + 13, EY - 13], [rx - 9, EY], [rx + 13, EY + 13]], 6.5, INK);
      brow(c, lx, -1, 2, -4);
      brow(c, rx, 1, 2, -4);
      // miệng "á!" răng cưa
      line(c, [[74, 84], [82, 94], [89, 82], [97, 94], [105, 82], [112, 94], [120, 84]], 5.5, MOUTH);
      // giọt mồ hôi
      ell(c, 178, 30, 5, 8, '#8fd8ff');
      break;
    case FACE.die:
      for (const x of EX) {
        line(c, [[x - 12, EY - 12], [x + 12, EY + 12]], 6.5, INK);
        line(c, [[x + 12, EY - 12], [x - 12, EY + 12]], 6.5, INK);
      }
      line(c, [[78, 82], [114, 82]], 5, MOUTH);
      // lè lưỡi
      c.fillStyle = '#ff7f9c';
      c.strokeStyle = MOUTH;
      c.lineWidth = 3.5;
      c.beginPath();
      c.roundRect(98, 80, 18, 24, 8);
      c.fill();
      c.stroke();
      break;
    case FACE.win:
      eyeHappy(c, lx);
      eyeHappy(c, rx);
      brow(c, lx, -1, -6, -2);
      brow(c, rx, 1, -6, -2);
      // miệng cười toe: nửa trên phẳng, nửa dưới tròn
      c.fillStyle = MOUTH;
      c.beginPath();
      c.moveTo(66, 76);
      c.lineTo(126, 76);
      c.bezierCurveTo(126, 104, 66, 104, 66, 76);
      c.closePath();
      c.fill();
      c.fillStyle = '#fff';
      c.fillRect(72, 76, 48, 7);
      ell(c, 96, 96, 12, 6, '#ff8aa0');
      break;
    case FACE.wink:
      eyeOpen(c, lx, 1);
      eyeHappy(c, rx);
      brow(c, lx, -1, 0, -1);
      brow(c, rx, 1, -4, -1);
      arc(c, 96, 80, 12, Math.PI * 0.12, Math.PI * 0.88, 5, MOUTH);
      // lè lưỡi tinh nghịch
      c.fillStyle = '#ff7f9c';
      c.strokeStyle = MOUTH;
      c.lineWidth = 3;
      c.beginPath();
      c.roundRect(100, 88, 14, 14, 6);
      c.fill();
      c.stroke();
      break;
  }
}

/** texture gốc dùng chung. `cheeks=false` cho mặt khỉ (không má hồng) */
export function faceBase(cheeks: boolean): THREE.CanvasTexture {
  const key = cheeks ? 'h' : 'm';
  let t = bases.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = CELL_W * 4;
  cv.height = CELL_H * 2;
  const c = cv.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    c.save();
    c.translate((i % 4) * CELL_W, Math.floor(i / 4) * CELL_H);
    c.beginPath();
    c.rect(0, 0, CELL_W, CELL_H);
    c.clip();
    drawCell(c, i, cheeks);
    c.restore();
  }
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  bases.set(key, t);
  return t;
}

/** bản clone riêng cho một mô hình (offset/repeat riêng, chung ảnh nguồn trên GPU) */
export function faceTexture(cheeks: boolean): THREE.Texture {
  const t = faceBase(cheeks).clone();
  t.repeat.set(0.25, 0.5);
  t.needsUpdate = true;
  return t;
}

export function setFaceCell(t: THREE.Texture, cell: number) {
  t.offset.set((cell % 4) * 0.25, cell < 4 ? 0.5 : 0);
}
