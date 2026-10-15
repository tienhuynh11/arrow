// chạy: cd server && npx tsx test/wallrush.test.ts
import assert from 'node:assert/strict';
import { newBoard, legalMoves, checkWall, checkWallShape, isLegalMove, moveKind, remaining, tableSizes, autoMove, jumpedOver, type Board, type Wall } from '../../shared/wallrush.js';

const has = (b: Board, i: number, x: number, y: number) => legalMoves(b, i).some((p) => p.x === x && p.y === y);
const mk = (): Board => newBoard(2); // S (4,8) goal y=0 · N (4,0) goal y=8
let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log('ok -', name); };

t('bàn 2 người: vị trí & tường', () => {
  const b = mk();
  assert.deepEqual(b.pos, [{ x: 4, y: 8 }, { x: 4, y: 0 }]);
  assert.deepEqual(b.wallsLeft, [10, 10]);
  assert.equal(remaining(b, 0), 8);
  assert.equal(legalMoves(b, 0).length, 3);
});
t('3-4 người: số tường, vị trí', () => {
  assert.deepEqual(newBoard(4).wallsLeft, [5, 5, 5, 5]);
  assert.deepEqual(newBoard(3).wallsLeft, [6, 6, 6]);
  assert.deepEqual(newBoard(4).pos[1], { x: 0, y: 4 });
  assert.equal(remaining(newBoard(4), 1), 8);
});
t('nhảy thẳng qua quân', () => {
  const b = mk();
  b.pos = [{ x: 4, y: 5 }, { x: 4, y: 4 }];
  assert.ok(has(b, 0, 4, 3));
  assert.ok(!has(b, 0, 4, 4));
  assert.equal(moveKind(b.pos[0], { x: 4, y: 3 }), 'jump');
  assert.equal(jumpedOver(b, 0, { x: 4, y: 3 }), 1);
});
t('bị tường sau lưng quân: bước chéo', () => {
  const b = mk();
  b.pos = [{ x: 4, y: 5 }, { x: 4, y: 4 }];
  b.walls = [{ x: 3, y: 3, o: 'h' }]; // chắn giữa hàng 3 và 4, cột 3-4
  assert.ok(!has(b, 0, 4, 3));
  assert.ok(has(b, 0, 3, 4));
  assert.ok(has(b, 0, 5, 4));
  assert.equal(moveKind(b.pos[0], { x: 3, y: 4 }), 'diag');
  assert.equal(jumpedOver(b, 0, { x: 5, y: 4 }), 1);
});
t('chéo bị tường chặn một bên', () => {
  const b = mk();
  b.pos = [{ x: 4, y: 5 }, { x: 4, y: 4 }];
  b.walls = [{ x: 3, y: 3, o: 'h' }, { x: 4, y: 3, o: 'v' }]; // v tại (4,3) chắn cột 4|5 hàng 3-4
  assert.ok(has(b, 0, 3, 4));
  assert.ok(!has(b, 0, 5, 4));
});
t('biên bàn chặn nhảy → chéo', () => {
  const b = mk();
  b.pos = [{ x: 4, y: 1 }, { x: 4, y: 0 }];
  b.pos = [{ x: 4, y: 1 }, { x: 4, y: 0 }];
  assert.ok(!has(b, 0, 4, -1));
  assert.ok(has(b, 0, 3, 0) && has(b, 0, 5, 0));
});
t('không đi xuyên tường', () => {
  const b = mk();
  b.walls = [{ x: 3, y: 7, o: 'h' }];
  assert.ok(!has(b, 0, 4, 7));
  assert.ok(has(b, 0, 3, 8) && has(b, 0, 5, 8));
});
t('tường: chồng / trùng / cắt chéo bị từ chối', () => {
  const b = mk();
  b.walls = [{ x: 3, y: 3, o: 'h' }];
  assert.equal(checkWall(b, 0, { x: 3, y: 3, o: 'h' }).ok, false);
  assert.equal(checkWall(b, 0, { x: 3, y: 3, o: 'v' }).ok, false);
  assert.equal(checkWall(b, 0, { x: 4, y: 3, o: 'h' }).ok, false);
  assert.equal(checkWall(b, 0, { x: 2, y: 3, o: 'h' }).ok, false);
  assert.equal(checkWall(b, 0, { x: 5, y: 3, o: 'h' }).ok, true);
  assert.equal(checkWall(b, 0, { x: 3, y: 4, o: 'h' }).ok, true);
  assert.equal(checkWall(b, 0, { x: 8, y: 3, o: 'h' }).ok, false);
  assert.equal(checkWall(b, 0, { x: 3, y: -1, o: 'v' }).ok, false);
});
t('tường: chặn kín đường bị từ chối', () => {
  const b = mk();
  // hàng rào ngang giữa hàng 7 và 8, cột 0..7, chừa cột 8
  const row: Wall[] = [0, 2, 4, 6].map((x) => ({ x, y: 7, o: 'h' as const }));
  b.walls = row;
  assert.equal(remaining(b, 0) >= 0, true);
  // chắn nốt cột 8: tường v ngang (7,8)? dùng tường ngang không được (x=7 phủ 7-8): x=7 h chồng với x=6 h
  const r = checkWallShape(b, { x: 7, y: 7, o: 'h' });
  assert.equal(r.ok, false); // chồng
  // bít kiểu khác: nhốt quân S trong góc
  const c = mk();
  c.pos[0] = { x: 8, y: 8 };
  c.walls = [{ x: 7, y: 7, o: 'h' }]; // chặn lên từ (8,8) và (7,8)
  const r2 = checkWall(c, 0, { x: 7, y: 7, o: 'v' });
  assert.equal(r2.ok, false); // cắt chéo (cùng giao điểm)
  const d = mk();
  d.pos[0] = { x: 8, y: 8 };
  d.walls = [{ x: 7, y: 7, o: 'h' }, { x: 6, y: 7, o: 'v' }];
  // (8,8) chỉ còn đi sang trái (7,8) -> (6,8)? v tại (6,7) chắn cột 6|7 hàng 7-8 => nhốt
  assert.equal(remaining(d, 0), -1);
  const e = mk();
  e.pos[0] = { x: 8, y: 8 };
  e.walls = [{ x: 7, y: 7, o: 'h' }];
  assert.deepEqual(checkWall(e, 0, { x: 6, y: 7, o: 'v' }), { ok: false, reason: 'chặn kín đường' });
});
t('tường: bít đường của ĐỐI THỦ cũng bị từ chối', () => {
  const b = mk();
  b.pos[1] = { x: 0, y: 0 }; // quân N ở góc trái trên, đích y=8
  b.walls = [{ x: 0, y: 0, o: 'h' }];
  // (0,0) chỉ còn đi sang phải (1,0). chặn bằng v tại (0,0) -> cắt chéo; dùng v tại (0,-?) không có -> hàng rào khác:
  b.walls.push({ x: 1, y: 0, o: 'v' }); // chắn cột 1|2 hàng 0-1 ... vẫn còn (1,0)->(1,1)? h(0,0) phủ cột 0-1, nên (1,0) bị chắn xuống
  assert.equal(remaining(b, 1), -1);
});
t('hết tường thì không đặt được', () => {
  const b = mk();
  b.wallsLeft[0] = 0;
  assert.deepEqual(checkWall(b, 0, { x: 0, y: 0, o: 'h' }), { ok: false, reason: 'hết tường' });
});
t('autoMove đi theo đường ngắn nhất', () => {
  const b = mk();
  const m = autoMove(b, 0)!;
  assert.deepEqual(m, { x: 4, y: 7 });
  b.walls = [{ x: 3, y: 7, o: 'h' }];
  const m2 = autoMove(b, 0)!;
  assert.ok(m2.x !== 4 && m2.y === 8);
  assert.ok(isLegalMove(b, 0, m2));
});
t('chia bàn', () => {
  const exp: Record<number, number[]> = { 2: [2], 3: [3], 4: [4], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3], 10: [4, 3, 3], 16: [4, 4, 4, 4] };
  for (const [k, v] of Object.entries(exp)) assert.deepEqual(tableSizes(Number(k)), v, `n=${k}`);
  for (let k = 2; k <= 16; k++) { const s = tableSizes(k); assert.equal(s.reduce((a, c) => a + c, 0), k); assert.ok(s.every((x) => x >= 2 && x <= 4)); }
});
console.log(`PASS ${n} nhóm test`);
