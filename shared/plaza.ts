/**
 * Quảng trường của GIẢ DẠNG NPC: sân rộng có vài vật cản rải rác (đài phun nước, ghế đá, cây…).
 * Dùng lại hàm chạy/va chạm/tầm nhìn của codeArena (cùng kiểu bản đồ hộp chữ nhật).
 */
import type { CodeMap } from './codeArena.js';
export { stepCode, freeAt, los } from './codeArena.js';

export function makePlaza(): CodeMap {
  const W = 360;
  const H = 240;
  // một góc phần tư rồi lật 4 phía cho đối xứng; thêm đài phun nước ở giữa
  const quarter = [
    { x: 70, y: 52, w: 36, d: 12 },
    { x: 118, y: 92, w: 14, d: 34 },
    { x: 42, y: 100, w: 18, d: 18 },
    { x: 150, y: 40, w: 20, d: 20 },
  ];
  const boxes: CodeMap['boxes'] = [{ x: W / 2, y: H / 2, w: 40, d: 40 }];
  for (const b of quarter) {
    for (const fx of [false, true]) {
      for (const fy of [false, true]) {
        boxes.push({ x: fx ? W - b.x : b.x, y: fy ? H - b.y : b.y, w: b.w, d: b.d });
      }
    }
  }
  return { w: W, h: H, radius: 4.2, boxes };
}
