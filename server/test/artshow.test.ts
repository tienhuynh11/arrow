// chạy: cd server && npx tsx test/artshow.test.ts
// Thử: validate nét, giới hạn byte/nét/điểm, chống tự bình chọn, tính điểm + hoà, dọn dữ liệu, người rớt mạng.
import assert from 'node:assert/strict';
import { artShowGame as g } from '../src/games/artShow.js';
import {
  ART_H,
  ART_TOPICS,
  ART_W,
  MAX_DRAWING_BYTES,
  MAX_PTS_PER_STROKE,
  MAX_STROKES,
  cleanStroke,
  drawingBytes,
  mergeStrokes,
  rdp,
  simplifyStroke,
  type ArtStroke,
} from '../../shared/artshow.js';

let clock = 1_000_000;
let sent: Record<string, any[]> = {};
let bc: any[] = [];
const mkCtx = (n: number) => {
  const playerIds = Array.from({ length: n }, (_, i) => `p${i}`);
  sent = {};
  bc = [];
  playerIds.forEach((id) => (sent[id] = []));
  return {
    playerIds,
    startAt: clock + 1000,
    endAt: clock + 1000 + g.duration,
    now: () => clock,
    broadcast: (p: any) => bc.push(p),
    send: (id: string, p: any) => sent[id].push(p),
  };
};
const line = (c = 0, w = 1, n = 5): ArtStroke => [c, w, Array.from({ length: n * 2 }, (_, i) => 10 + i * 7)];
const draw = (ctx: any, st: any, cfg: any, id: string, strokes: ArtStroke[], f = 0) =>
  g.handleInput(ctx, st, cfg, id, { type: 'adraw', n: 0, s: strokes, ...(f ? { f: 1 } : {}) } as any);

function setup(n: number, drawers = n) {
  const ctx = mkCtx(n);
  const cfg = g.createConfig(ctx);
  const st = g.createState(ctx, cfg);
  clock = ctx.startAt;
  g.onStart!(ctx, st, cfg);
  for (let i = 0; i < drawers; i++) draw(ctx, st, cfg, `p${i}`, [line(i % 10)]);
  clock = st.drawEnd + 100;
  for (let i = 0; i < drawers; i++) draw(ctx, st, cfg, `p${i}`, [line(i % 10)], 1);
  if (drawers < n) clock = st.drawEnd + cfg.graceMs + 1; // người không nộp: chờ hết ân hạn
  g.update(ctx, st, cfg);
  return { ctx, cfg, st };
}

// 0) cấu hình / chủ đề
assert.ok(ART_TOPICS.length >= 60 && ART_TOPICS.length <= 80, `topics ${ART_TOPICS.length}`);
assert.equal(new Set(ART_TOPICS).size, ART_TOPICS.length, 'topics trùng');
assert.equal(g.minPlayers, 3);

// 1) cleanStroke
assert.equal(cleanStroke('x'), null);
assert.equal(cleanStroke([11, 0, [1, 1]]), null, 'màu ngoài whitelist');
assert.equal(cleanStroke([0, 3, [1, 1]]), null, 'độ dày ngoài whitelist');
assert.equal(cleanStroke(['#fff', 0, [1, 1]]), null, 'màu chuỗi bị từ chối');
assert.equal(cleanStroke([0, 0, [1]]), null, 'lẻ toạ độ');
assert.equal(cleanStroke([0, 0, [1, 'a']]), null, 'toạ độ chuỗi');
assert.equal(cleanStroke([0, 0, [1, NaN]]), null, 'NaN');
assert.equal(cleanStroke([0, 0, [1, Infinity]]), null, 'Infinity');
assert.equal(cleanStroke([0, 0, ['<script>', 1]]), null, 'XSS chuỗi');
assert.equal(cleanStroke([0, 0, new Array((MAX_PTS_PER_STROKE + 1) * 2).fill(1)]), null, 'quá nhiều điểm');
assert.deepEqual(cleanStroke([2, 1, [-50, 99999, 3.6, 4.2]]), [2, 1, [0, ART_H, 4, 4]], 'kẹp khung + làm tròn');
assert.deepEqual(cleanStroke([0, 0, [5, 5]]), [0, 0, [5, 5]], 'chấm 1 điểm');

// 2) merge + giới hạn
{
  const big: ArtStroke[] = [];
  while (big.length < MAX_STROKES) big.push(line(0, 0, 3));
  assert.ok(mergeStrokes([], 0, big), 'đúng giới hạn nét');
  assert.equal(mergeStrokes(big, big.length, [line()]), null, 'vượt số nét');
  const fat: ArtStroke[] = Array.from({ length: 20 }, () => [0, 0, Array.from({ length: 300 }, (_, i) => (i * 37) % ART_W)] as ArtStroke);
  assert.ok(drawingBytes(fat) > MAX_DRAWING_BYTES);
  assert.equal(mergeStrokes([], 0, fat), null, 'vượt byte/điểm');
  assert.equal(mergeStrokes([line()], 5, []), null, 'n lệch');
  assert.equal(mergeStrokes([line()], -1, []), null);
  assert.equal(mergeStrokes([line(), line()], 1, [line(3)])!.length, 2, 'thay đuôi (undo + nét mới)');
}

// 3) RDP: giảm điểm nhưng giữ hình
{
  const pts: number[] = [];
  for (let i = 0; i <= 300; i++) pts.push(i * 3, 100); // đường thẳng 301 điểm
  assert.equal(rdp(pts, 1).length, 4);
  const circ: number[] = [];
  for (let i = 0; i < 600; i++) circ.push(500 + 300 * Math.cos(i / 95), 375 + 300 * Math.sin(i / 95));
  const s = simplifyStroke(circ);
  assert.ok(s.length / 2 <= MAX_PTS_PER_STROKE && s.length > 20);
}

// 4) handleInput: giới hạn byte ở server (nhiều nét to) và rate limit
{
  const ctx = mkCtx(3);
  const cfg = g.createConfig(ctx);
  const st = g.createState(ctx, cfg);
  clock = ctx.startAt;
  g.onStart!(ctx, st, cfg);
  const huge = Array.from({ length: 150 }, () => [0, 0, Array.from({ length: 320 }, (_, i) => (i * 13) % 900)]);
  draw(ctx, st, cfg, 'p0', huge as any);
  assert.equal(st.drawings.get('p0'), undefined, 'tranh quá nặng bị từ chối');
  g.handleInput(ctx, st, cfg, 'p0', { type: 'adraw', n: 0, s: new Array(500).fill(line()) } as any);
  assert.equal(st.drawings.get('p0'), undefined, 'quá 160 nét/tin');
  g.handleInput(ctx, st, cfg, 'p0', { type: 'adraw', n: 0, s: 'abc' } as any);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'adraw', n: 0 } as any);
  g.handleInput(ctx, st, cfg, 'ghost', { type: 'adraw', n: 0, s: [line()] } as any);
  assert.equal(st.drawings.get('ghost'), undefined, 'người ngoài ván');
  for (let i = 0; i < 20; i++) draw(ctx, st, cfg, 'p1', [line(i % 10)]);
  assert.ok(st.budget.get('p1').n <= 20);
  // tối đa 8 tin/giây: tin thứ 9 trở đi không ghi đè
  const before = JSON.stringify(st.drawings.get('p1'));
  draw(ctx, st, cfg, 'p1', [line(9), line(8)]);
  assert.equal(JSON.stringify(st.drawings.get('p1')), before, 'rate limit tin vẽ');
  // vote trong pha vẽ bị bỏ qua
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: 0, c: 'm' } as any);
  assert.equal(st.mainVote.size, 0);
}

// 5) hết giờ vẽ: tranh trễ bị từ chối, pha vote chỉ có tranh có nét, ẩn danh
{
  const { ctx, cfg, st } = setup(4, 3); // p3 không vẽ
  assert.equal(st.phase, 'vote');
  assert.equal(st.order.length, 3);
  assert.ok(!st.order.includes('p3'));
  const pics = bc.filter((m) => m.type === 'pic');
  assert.equal(pics.length, 3);
  assert.ok(!JSON.stringify(bc.filter((m) => m.type !== 'res')).includes('p0'), 'không lộ id tác giả khi bình chọn');
  draw(ctx, st, cfg, 'p0', [line(1), line(2)]);
  assert.equal(st.drawings.get('p0')!.length, 1, 'tranh nộp sau khi sang pha vote bị bỏ');
  // mỗi người nhận số tranh của mình
  for (const id of ['p0', 'p1', 'p2']) {
    const m = sent[id].find((x) => x.type === 'mine');
    assert.equal(st.order[m.k], id);
  }
  assert.equal(sent.p3.find((x) => x.type === 'mine').k, -1);
}

// 6) chống tự bình chọn + vote hợp lệ + đổi phiếu + hết hạn
{
  const { ctx, cfg, st } = setup(4);
  const kOf = (id: string) => st.keyOf.get(id) as number;
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p0'), c: 'm' } as any);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p0'), c: 'h' } as any);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p0'), c: 't' } as any);
  assert.equal(st.mainVote.size, 0, 'cấm tự bầu chính');
  assert.equal(st.subVote.size, 0, 'cấm tự bầu phụ');
  for (const bad of [-2, 99, 1.5, NaN, '1', null]) g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: bad, c: 'm' } as any);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p1'), c: 'x' } as any);
  assert.equal(st.mainVote.size, 0);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p1'), c: 'm' } as any);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p2'), c: 'm' } as any); // đổi phiếu
  assert.equal(st.mainVote.get('p0'), kOf('p2'));
  assert.equal(st.mainVote.size, 1);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p1'), c: 'h' } as any);
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: kOf('p3'), c: 't' } as any); // phụ chỉ 1 phiếu: thay
  assert.deepEqual(st.subVote.get('p0'), { c: 't', k: kOf('p3') });
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: -1, c: 'm' } as any);
  assert.equal(st.mainVote.size, 0, 'bỏ phiếu');
  // sau hạn: bị bỏ
  clock = st.voteEnd + 10;
  g.handleInput(ctx, st, cfg, 'p1', { type: 'avote', k: kOf('p2'), c: 'm' } as any);
  assert.equal(st.mainVote.has('p1'), false);
}

// 7) tính điểm: thắng rõ, giải phụ, người không bầu không mất điểm
{
  const { ctx, cfg, st } = setup(4);
  const k = (id: string) => st.keyOf.get(id) as number;
  const v = (who: string, id: string, c: string) => g.handleInput(ctx, st, cfg, who, { type: 'avote', k: k(id), c } as any);
  v('p0', 'p1', 'm');
  v('p2', 'p1', 'm');
  v('p3', 'p1', 'm');
  v('p1', 'p2', 'm'); // p1 bầu p2; p2 nhận 1
  v('p0', 'p3', 'h');
  v('p1', 'p3', 'h');
  v('p2', 'p0', 't');
  clock = st.voteEnd + 1;
  g.update(ctx, st, cfg);
  assert.equal(st.phase, 'result');
  const res = bc.find((m) => m.type === 'res');
  assert.deepEqual(res.win, [k('p1')]);
  assert.deepEqual(res.fun, [k('p3')]);
  assert.deepEqual(res.fail, [k('p0')]);
  clock = st.resultEnd + 1;
  assert.ok(g.isFinished(ctx, st, cfg));
  const sc = g.calculateScore(ctx, st, cfg);
  assert.equal(sc.p1.raw, 300);
  assert.equal(sc.p2.raw, 100);
  assert.equal(sc.p3.raw, 30);
  assert.equal(sc.p0.raw, 20);
  assert.ok(sc.p1.raw > sc.p2.raw && sc.p2.raw > sc.p3.raw && sc.p3.raw > sc.p0.raw);
  // dọn dữ liệu
  assert.equal(st.drawings.size, 0);
  assert.equal(st.mainVote.size + st.subVote.size + st.order.length + st.keyOf.size, 0);
}

// 8) hoà: cùng số phiếu → cùng raw (Room xếp cùng hạng); giải phụ chia cho tất cả người hoà
{
  const { ctx, cfg, st } = setup(4);
  const k = (id: string) => st.keyOf.get(id) as number;
  const v = (who: string, id: string, c: string) => g.handleInput(ctx, st, cfg, who, { type: 'avote', k: k(id), c } as any);
  v('p0', 'p1', 'm');
  v('p1', 'p2', 'm');
  v('p2', 'p1', 'h');
  v('p3', 'p2', 'h');
  clock = st.voteEnd + 1;
  g.update(ctx, st, cfg);
  const res = bc.find((m) => m.type === 'res');
  assert.equal(res.win.length, 2, 'hoà phiếu chính');
  assert.equal(res.fun.length, 2, 'hoà giải hài');
  const sc = g.calculateScore(ctx, st, cfg);
  assert.equal(sc.p1.raw, sc.p2.raw);
  assert.equal(sc.p1.raw, 130);
  assert.equal(sc.p0.raw, 0);
  assert.equal(sc.p3.raw, 0);
}

// 9) không ai bình chọn: không ai thắng, không ai bị trừ; vote tự kết thúc theo giờ
{
  const { ctx, cfg, st } = setup(5);
  clock = st.voteEnd + 1;
  g.update(ctx, st, cfg);
  const res = bc.find((m) => m.type === 'res');
  assert.deepEqual(res.win, []);
  const sc = g.calculateScore(ctx, st, cfg);
  for (const id of ctx.playerIds) assert.equal(sc[id].raw, 0);
}

// 10) cả phòng bầu xong → rút ngắn; người rớt mạng (không bầu) không kẹt ván
{
  const { ctx, cfg, st } = setup(3);
  const orig = st.voteEnd;
  const k = (id: string) => st.keyOf.get(id) as number;
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: k('p1'), c: 'm' } as any);
  g.handleInput(ctx, st, cfg, 'p1', { type: 'avote', k: k('p2'), c: 'm' } as any);
  assert.equal(st.voteEnd, orig, 'chưa đủ người');
  g.handleInput(ctx, st, cfg, 'p2', { type: 'avote', k: k('p0'), c: 'm' } as any);
  assert.ok(st.voteEnd < orig && st.voteEnd <= clock + 3000, 'rút ngắn');
}

// 11) <2 tranh: bỏ pha bình chọn, không treo
{
  const { ctx, cfg, st } = setup(3, 1);
  assert.equal(st.phase, 'result');
  assert.ok(bc.find((m) => m.type === 'res'));
  clock = st.resultEnd + 1;
  assert.ok(g.isFinished(ctx, st, cfg));
  const sc = g.calculateScore(ctx, st, cfg);
  assert.equal(sc.p0.raw, 0);
}

// 12) hết giờ vẽ mà chưa ai nộp bản cuối: vẫn sang vote sau thời gian ân hạn (dùng bản sao lưu)
{
  const ctx = mkCtx(3);
  const cfg = g.createConfig(ctx);
  const st = g.createState(ctx, cfg);
  clock = ctx.startAt;
  g.onStart!(ctx, st, cfg);
  for (let i = 0; i < 3; i++) draw(ctx, st, cfg, `p${i}`, [line(i)]); // chỉ bản sao lưu, không f
  clock = st.drawEnd + 100;
  g.update(ctx, st, cfg);
  assert.equal(st.phase, 'draw');
  clock = st.drawEnd + cfgGrace(cfg) + 1;
  g.update(ctx, st, cfg);
  assert.equal(st.phase, 'vote');
  assert.equal(st.order.length, 3);
}
function cfgGrace(c: any) {
  return c.graceMs as number;
}

// 13) đồng bộ lại (async): vào lại giữa pha vote nhận đủ tranh + phiếu của mình; pha vẽ nhận lại tranh
{
  const { ctx, cfg, st } = setup(3);
  const k = (id: string) => st.keyOf.get(id) as number;
  g.handleInput(ctx, st, cfg, 'p0', { type: 'avote', k: k('p1'), c: 'm' } as any);
  sent.p0 = [];
  clock += 2000;
  g.handleInput(ctx, st, cfg, 'p0', { type: 'async' } as any);
  assert.equal(sent.p0.filter((m) => m.type === 'pic').length, 3);
  assert.equal(sent.p0.find((m) => m.type === 'my').m, k('p1'));
  assert.equal(sent.p0.find((m) => m.type === 'ph').ph, 'vote');
  const n0 = sent.p0.length;
  g.handleInput(ctx, st, cfg, 'p0', { type: 'async' } as any);
  assert.equal(sent.p0.length, n0, 'async bị giới hạn 1 lần/giây');

  const c2 = mkCtx(3);
  const cfg2 = g.createConfig(c2);
  const st2 = g.createState(c2, cfg2);
  clock = c2.startAt;
  g.onStart!(c2, st2, cfg2);
  draw(c2, st2, cfg2, 'p0', [line(), line(2)]);
  clock += 1500;
  g.handleInput(c2, st2, cfg2, 'p0', { type: 'async' } as any);
  assert.equal(sent.p0.find((m) => m.type === 'mydraw').s.length, 2);
}

// 14) kích thước thông điệp: tranh nặng nhất cho phép vẫn nằm trong 64 KB của ws
{
  const s: ArtStroke[] = [];
  while (s.length < MAX_STROKES) s.push([0, 0, Array.from({ length: 20 }, (_, i) => 900 + (i % 9))]);
  const merged = mergeStrokes([], 0, s);
  const msg = JSON.stringify({ t: 'game:input', gameId: 'artshow', input: { type: 'adraw', n: 0, s: merged ?? s } });
  assert.ok(msg.length < 64 * 1024, `msg ${msg.length}`);
}

console.log('artshow: tất cả test đạt');
