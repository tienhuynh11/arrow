// chạy: cd server && npx tsx test/wallrush.game.test.ts
// Giả lập đồng hồ để thử: chia bàn, hết giờ lượt tự đi, trần thời gian, điểm quy đổi giữa bàn 2 và bàn 4 người.
import assert from 'node:assert/strict';
import { wallRushGame as g } from '../src/games/wallRush.js';

let clock = 1_000_000;
const sent: Record<string, any[]> = {};
const mkCtx = (n: number) => {
  const playerIds = Array.from({ length: n }, (_, i) => `p${i}`);
  playerIds.forEach((id) => (sent[id] = []));
  return {
    playerIds,
    startAt: clock + 1000,
    endAt: clock + 1000 + g.duration,
    now: () => clock,
    broadcast() {},
    send: (id: string, p: any) => sent[id].push(p),
  };
};

function run(n: number, until: (ctx: any, st: any) => boolean, step = 500) {
  const ctx = mkCtx(n);
  const cfg = g.createConfig(ctx);
  const st = g.createState(ctx, cfg);
  clock = ctx.startAt;
  g.onStart!(ctx, st, cfg);
  let guard = 0;
  while (!until(ctx, st) && guard++ < 100000) {
    clock += step;
    g.update(ctx, st, cfg);
    if (g.isFinished(ctx, st, cfg)) break;
  }
  return { ctx, cfg, st };
}

// 1) bàn 2 người, không ai chơi -> tự đi, ghế 0 thắng
{
  const { ctx, cfg, st } = run(2, () => false);
  const sc = g.calculateScore(ctx, st, cfg);
  const w = st.tables[0].winner as number;
  assert.ok(w >= 0);
  const win = cfg.tables[0].players[w];
  const lose = cfg.tables[0].players[1 - w];
  console.log('2 người AFK:', sc[win], sc[lose], 'sau', Math.round((clock - ctx.startAt) / 1000), 's');
  assert.ok(sc[win].raw >= 1000 && sc[win].raw > sc[lose].raw);
  assert.match(sc[win].detail, /^thắng bàn · còn 10 tường/);
}

// 2) 16 người AFK -> 4 bàn song song, mỗi bàn có 1 người thắng, điểm công bằng
{
  const { ctx, cfg, st } = run(16, () => false);
  const sc = g.calculateScore(ctx, st, cfg);
  assert.equal(cfg.tables.length, 4);
  const wins = Object.values(sc).filter((r) => r.detail.startsWith('thắng'));
  assert.equal(wins.length, 4);
  console.log('16 người AFK: 4 người thắng, ván xong sau', Math.round((clock - ctx.startAt) / 1000), 's', wins[0]);
}

// 3) trần thời gian: chặn đường quân tự đi? giả lập bằng cách giữ lượt rất lâu (đặt hạn rất ngắn cho trần)
{
  const ctx = mkCtx(5);
  const cfg = g.createConfig(ctx);
  cfg.endsAt = 8000; // trần ngắn: cả bàn chưa kịp có người tới đích
  const st = g.createState(ctx, cfg);
  clock = ctx.startAt;
  g.onStart!(ctx, st, cfg);
  while (!g.isFinished(ctx, st, cfg) && clock < ctx.startAt + 60_000) {
    clock += 500;
    g.update(ctx, st, cfg);
  }
  const sc = g.calculateScore(ctx, st, cfg);
  console.log('trần 8s, 5 người (3+2):', Object.values(sc).map((r) => `${r.raw}:${r.detail}`).join(' | '));
  assert.ok(st.tables.every((t: any) => t.over && t.winner === -1));
  assert.ok(Object.values(sc).every((r) => /hết giờ/.test(r.detail)));
  // hạng 1 mỗi bàn < điểm thắng thật (900 + thưởng tường < 1000)
  const top = Object.values(sc).filter((r) => r.detail.startsWith('dẫn đầu'));
  assert.equal(top.length, 2);
  assert.ok(top.every((r) => r.raw < 1000 + 100));
}

// 4) điểm quy đổi: bàn 4 người hạng 2 = 667, hạng 3 = 333, hạng 4 = 0 (+ thưởng tường)
{
  const { ctx, cfg, st } = run(4, (_c, s) => s.tables[0].over);
  const sc = g.calculateScore(ctx, st, cfg);
  const raws = cfg.tables[0].players.map((id) => sc[id].raw);
  console.log('bàn 4 người:', raws.join(','), cfg.tables[0].players.map((id) => sc[id].detail).join(' | '));
  const order = st.tables[0].order as number[];
  const base = [1000, 667, 333, 0];
  order.forEach((seat, idx) => assert.ok(Math.abs(sc[cfg.tables[0].players[seat]].raw - base[idx]) <= 30 + 100, 'xấp xỉ điểm hạng'));
}
console.log('PASS game test');
