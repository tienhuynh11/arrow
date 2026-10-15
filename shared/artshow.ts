// ĐẠI HỘI HỌA SĨ: dữ liệu + luật dùng chung cho server và client (không phụ thuộc gì khác).
// Tranh là danh sách NÉT, không phải ảnh bitmap. Mỗi nét = [màu, độ dày, [x0,y0,x1,y1,...]] toàn số nguyên.

/** hệ toạ độ tranh (số nguyên): x 0..ART_W, y 0..ART_H, tỉ lệ 4:3 */
export const ART_W = 1000;
export const ART_H = 750;

export const ART_PAPER = '#fffdf6';
/** 10 màu bút; chỉ số 10 = tẩy (tô màu giấy). Server chỉ chấp nhận chỉ số, không bao giờ nhận chuỗi màu từ client. */
export const ART_COLORS = [
  '#1b1b2f', '#e63946', '#ff9f1c', '#ffd23f', '#2ecc71',
  '#1fb5a8', '#3a86ff', '#8e44ad', '#ff7eb6', '#8d5a3b',
] as const;
export const ART_ERASER = 10;
/** 3 độ dày (đơn vị toạ độ tranh); tẩy to gấp ERASER_MUL */
export const ART_WIDTHS = [5, 11, 22] as const;
export const ERASER_MUL = 2.2;

/* ---- giới hạn cứng (server kiểm lại từng cái) ---- */
export const MAX_STROKES = 150;
export const MAX_PTS_PER_STROKE = 160;
export const MAX_TOTAL_PTS = 1500;
/** kích thước JSON tối đa của một tranh */
export const MAX_DRAWING_BYTES = 16_000;
/** số nét tối đa trong MỘT tin nhắn cập nhật */
export const MAX_STROKES_PER_MSG = 160;

export type ArtStroke = [number, number, number[]];

export const strokeWidthOf = (c: number, w: number) => ART_WIDTHS[w] * (c === ART_ERASER ? ERASER_MUL : 1);
export const strokeColorOf = (c: number) => (c === ART_ERASER ? ART_PAPER : ART_COLORS[c]);

export const drawingBytes = (s: ArtStroke[]) => JSON.stringify(s).length;
export const totalPoints = (s: ArtStroke[]) => s.reduce((n, x) => n + x[2].length / 2, 0);

/** Kiểm + chuẩn hoá một nét: ép số nguyên, kẹp vào khung, cắt bớt; trả null nếu không dùng được. */
export function cleanStroke(raw: unknown): ArtStroke | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const [c, w, p] = raw as [unknown, unknown, unknown];
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > ART_ERASER) return null;
  if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w >= ART_WIDTHS.length) return null;
  if (!Array.isArray(p) || p.length < 2 || p.length > MAX_PTS_PER_STROKE * 2 || p.length % 2 !== 0) return null;
  const out: number[] = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i];
    const y = p[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    out[i] = Math.max(0, Math.min(ART_W, Math.round(x)));
    out[i + 1] = Math.max(0, Math.min(ART_H, Math.round(y)));
  }
  return [c, w, out];
}

/** Ghép `tail` (đã kiểm) vào `base` từ vị trí n. Trả mảng mới hoặc null nếu vượt giới hạn. */
export function mergeStrokes(base: ArtStroke[], n: number, tail: ArtStroke[]): ArtStroke[] | null {
  if (!Number.isInteger(n) || n < 0 || n > base.length) return null;
  const next = base.slice(0, n).concat(tail);
  if (next.length > MAX_STROKES || totalPoints(next) > MAX_TOTAL_PTS || drawingBytes(next) > MAX_DRAWING_BYTES) return null;
  return next;
}

/* ---- làm gọn nét (Ramer–Douglas–Peucker) ---- */
function sqSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  let dx = bx - ax;
  let dy = by - ay;
  let t = 0;
  const l2 = dx * dx + dy * dy;
  if (l2 > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  dx = ax + t * dx - px;
  dy = ay + t * dy - py;
  return dx * dx + dy * dy;
}

/** pts = [x0,y0,x1,y1,...]; trả mảng cùng dạng đã giản lược với sai số eps (đơn vị toạ độ tranh) */
export function rdp(pts: number[], eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const e2 = eps * eps;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    let best = -1;
    let bd = e2;
    for (let i = a + 1; i < b; i++) {
      const d = sqSegDist(pts[2 * i], pts[2 * i + 1], pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** Làm tròn + RDP, tăng sai số dần cho tới khi ≤ MAX_PTS_PER_STROKE điểm */
export function simplifyStroke(pts: number[], eps = 1.6): number[] {
  const r = pts.map((v) => Math.round(v));
  let e = eps;
  let out = rdp(r, e);
  while (out.length / 2 > MAX_PTS_PER_STROKE && e < 200) {
    e *= 1.5;
    out = rdp(r, e);
  }
  return out;
}

/* ---- bình chọn / điểm (server tính, test dùng lại) ---- */
export const VOTE_MAIN_POINTS = 100;
export const BONUS_FUNNY = 30;
export const BONUS_FAIL = 20;
export type VoteKind = 'm' | 'h' | 't';
export const VOTE_KINDS: readonly VoteKind[] = ['m', 'h', 't'];

/** Chủ đề vui nhộn (không bí mật, nằm trong config gửi về client) */
export const ART_TOPICS: readonly string[] = [
  'Con mèo đi làm văn phòng', 'Khủng long đi chợ', 'Siêu nhân bị cảm', 'Ông già Noel đi xe ôm',
  'Con gà đang tập gym', 'Ngôi nhà biết bay', 'Trà sữa khổng lồ tấn công thành phố', 'Người ngoài hành tinh ăn phở',
  'Chó đội mũ cối', 'Cá heo đi học', 'Bác sĩ cho robot khám bệnh', 'Cô tiên ở trọ',
  'Con ốc sên đua F1', 'Mặt trời đeo kính râm', 'Con voi đi xe đạp', 'Phù thuỷ bán bánh mì',
  'Bữa tiệc của các con ma', 'Hamburger biết nói', 'Con rồng ăn cay', 'Ông trăng đi du lịch',
  'Chú ếch làm ca sĩ', 'Thành phố dưới đáy biển', 'Gấu trúc đi xe máy', 'Lạc đà trong siêu thị',
  'Cây bút chì có cảm xúc', 'Vua sư tử đi cắt tóc', 'Con khỉ làm đầu bếp', 'Chiếc xe buýt biết bay',
  'Cầu vồng bị kẹt xe', 'Ma cà rồng sợ tỏi', 'Con cua đi dép', 'Siêu anh hùng phát cơm',
  'Bé xíu cưỡi chim cánh cụt', 'Núi lửa đang hắt xì', 'Chú hề buồn ngủ', 'Con bạch tuộc chơi đàn',
  'Đám mây đang khóc', 'Con heo bay lên vũ trụ', 'Hoàng tử ếch đi xem mắt', 'Chiếc dép bị lạc',
  'Công chúa và cục pin', 'Con cá sấu đánh răng', 'Phi hành gia câu cá', 'Cây thông Noel đi tập yoga',
  'Con thỏ lái máy bay', 'Ngày đầu tiên đi làm của zombie', 'Người tuyết ở sa mạc', 'Tôm hùm đi nghe nhạc',
  'Con rùa chạy marathon', 'Siêu thị của những chú chuột', 'Cây nấm biết đi', 'Ông địa đi leo núi',
  'Chiếc bánh sinh nhật bị cháy', 'Quái vật dưới gầm giường', 'Con vịt vàng khổng lồ', 'Tàu ngầm hình quả chuối',
  'Cô giáo robot', 'Gà trống thi hát', 'Con mèo thần tài', 'Bữa sáng của người khổng lồ',
  'Con hà mã nhảy dây', 'Ô tô đi bằng chân', 'Nhà hàng của các con thú', 'Con bò tập nhảy',
  'Chiếc ô thành tinh', 'Tôi khi hết tiền cuối tháng', 'Thần đèn bị mất đèn', 'Kỳ lân ăn kem',
  'Con nhện đan áo len', 'Hội nghị của các loài chim', 'Cây xanh đi bầu cử', 'Cá voi đội nón lá',
  'Cái tủ lạnh có chân', 'Chuột túi bán vé số', 'Đại chiến gà rán và pizza', 'Chú chó siêu mẫu',
  'Con ma sợ người', 'Giấc mơ của một cục kẹo',
];
