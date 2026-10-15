// Chạy: cd server && npx tsx test/treasure.test.ts [quick]
import {
  BASE_R, IMMUNE_TICKS, MAXC, PR, RING, SPEED_MUL, STEAL_CD, TreasureWorld, arenaDims, splitArenas, stealSplit,
} from '../../shared/treasure.js';
import { treasureGame } from '../src/games/treasure.js';
import { PH_PLAY, T_DEFAULT, TreasureArena } from '../src/games/treasureArena.js';
import { mulberry32 } from '../../shared/tank.js';
import { runTSim, type TSimCfg } from './treasureSim.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};
const quick = process.argv.includes('quick');

console.log('\n[1] Bảng cân bằng tốc độ (mang càng nhiều càng chậm)');
{
  const row = Array.from({ length: MAXC + 1 }, (_, l) => `${l}:${Math.round(SPEED_MUL[l] * 100)}%`).join(' ');
  console.log('  · ' + row);
  let mono = true;
  for (let l = 1; l <= MAXC; l++) if (!(SPEED_MUL[l] < SPEED_MUL[l - 1])) mono = false;
  ok(mono && SPEED_MUL[0] === 1, 'tốc độ giảm đều theo số đang mang, tay không = 100%');
  ok(SPEED_MUL[MAXC] > 0.4 && SPEED_MUL[MAXC] < 0.45, `mang đầy ${MAXC} → còn ${(SPEED_MUL[MAXC] * 100).toFixed(0)}% (không bị đứng hình)`);
  const sp = (l: number) => (160 * SPEED_MUL[l]).toFixed(0);
  console.log(`  · tốc độ thực: tay không ${sp(0)} · 3 viên ${sp(3)} · 5 viên ${sp(5)} · 10 viên ${sp(10)} đơn vị/giây`);
  const w = new TreasureWorld();
  for (const n of [2, 3, 4, 5, 6]) {
    const [W, H] = arenaDims(n);
    w.setup(n, W, H);
    let md = 1e9;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) md = Math.min(md, Math.hypot(w.bx[i] - w.bx[j], w.by[i] - w.by[j]));
    const toC = Math.hypot(w.bx[0] - W / 2, w.by[0] - H / 2);
    ok(md > BASE_R * 3, `${n} người: căn cứ cách nhau tối thiểu ${md.toFixed(0)}; căn cứ→giữa sân ${toC.toFixed(0)} (${(toC / 160).toFixed(1)}s tay không)`);
  }
}

console.log('\n[2] Mô phỏng xác định');
{
  const run = () => {
    const w = new TreasureWorld();
    w.setup(4, 860, 560);
    const rng = mulberry32(7);
    let h = 0;
    for (let t = 0; t < 5000; t++) {
      for (let i = 0; i < 4; i++) {
        if (t % 37 === 0) w.load[i] = Math.floor(rng() * 11);
        w.step(i, Math.floor(rng() * 3) - 1, Math.floor(rng() * 3) - 1);
      }
      for (let i = 0; i < 4; i++) h = (Math.imul(h ^ Math.floor(w.x[i] * 1000), 16777619) ^ Math.floor(w.y[i] * 1000)) >>> 0;
    }
    return h;
  };
  ok(run() === run(), 'cùng chuỗi input → cùng quỹ đạo từng bit');
  const w = new TreasureWorld();
  w.setup(3, 760, 500);
  let inside = true;
  const rng = mulberry32(3);
  for (let t = 0; t < 20000; t++) {
    w.step(0, Math.floor(rng() * 3) - 1, Math.floor(rng() * 3) - 1);
    if (w.x[0] < PR - 1e-9 || w.x[0] > 760 - PR + 1e-9 || w.y[0] < PR - 1e-9 || w.y[0] > 500 - PR + 1e-9) inside = false;
    for (let p = 0; p < 4; p++) if (Math.hypot(w.x[0] - w.px[p], w.y[0] - w.py[p]) < 26 + PR - 1e-6) inside = false;
  }
  ok(inside, 'không ra ngoài sân và không chui vào cột đá (20000 bước ngẫu nhiên)');
}

console.log('\n[3] Chia đấu trường');
for (const [n, want] of [[2, [2]], [3, [3]], [6, [6]], [7, [4, 3]], [10, [5, 5]], [13, [5, 4, 4]], [16, [6, 5, 5]]] as [number, number[]][]) {
  const got = splitArenas(n);
  ok(JSON.stringify(got) === JSON.stringify(want), `${n} người → ${got.join('+')}`);
}

console.log('\n[4] Luật: cướp / miễn nhiễm / hồi chiêu / rơi đồ / nộp điểm');
{
  const sent: any[] = [];
  const A = new TreasureArena(0, ['a', 'b', 'c'], (p) => sent.push(p), { ...T_DEFAULT, lagComp: false });
  A.w.tick = 0;
  A.start();
  A.advance(A.fs + 2);
  A.iAct.fill(0);
  A.iCount = 0;
  ok(A.phase === PH_PLAY, 'sau đếm ngược chuyển sang chơi');
  const w = A.w;
  const place = (i: number, x: number, y: number) => {
    w.x[i] = x;
    w.y[i] = y;
    for (let k = 0; k < RING; k++) w.recordAt(i, k);
  };
  place(0, 380, 250);
  place(1, 400, 250);
  place(2, 60, 60);
  w.load[1] = 6;
  A.supply = 6;
  const S0 = w.tick;
  A.applyInput(0, S0 + 1, 1, 0, 0, 1, 6);
  ok(sent.filter((m) => m.type === 'h').length === 1, 'bấm cướp trong tầm → cướp thành công');
  const sp = stealSplit(6);
  ok(sp.lost === 3 && sp.drop === 1, `đang mang 6 → bị lấy ${sp.lost}, rơi ${sp.drop}`);
  ok(w.load[1] === 3 && w.load[0] === 2 && A.iCount === 1, `người cướp +2, nạn nhân còn 3, 1 viên rơi ra đất (a=${w.load[0]} b=${w.load[1]} đất=${A.iCount})`);
  let sum = A.iCount;
  for (let i = 0; i < 3; i++) sum += w.load[i] + A.dep[i];
  ok(sum === 6, 'bảo toàn số kho báu');
  A.applyInput(0, w.tick + 1, 2, 0, 0, 2, 6);
  ok(sent.filter((m) => m.type === 'h').length === 1, 'đang hồi chiêu → không cướp thêm');
  A.advance(w.tick + STEAL_CD + 2);
  place(0, 380, 250);
  place(1, 400, 250);
  ok(A.immune[1] > w.tick, 'nạn nhân vẫn đang miễn nhiễm');
  A.applyInput(0, w.tick + 1, 3, 0, 0, 3, 6);
  ok(sent.filter((m) => m.type === 'h').length === 1 && sent.filter((m) => m.type === 'b' && m.v === 1).length === 1, 'miễn nhiễm → bị ĐẨY chứ không bị cướp');
  ok(Math.hypot(w.x[1] - 380, w.y[1] - 250) > 36, 'nạn nhân bị đẩy ra xa');
  A.advance(w.tick + IMMUNE_TICKS + 2);
  place(0, 380, 250);
  place(1, 395, 250);
  A.applyInput(0, w.tick + 1, 4, 0, 0, 4, 6);
  ok(sent.filter((m) => m.type === 'h').length === 2, 'hết miễn nhiễm → cướp lại được');
  A.advance(w.tick + STEAL_CD + 2);
  place(0, 100, 400);
  place(1, 700, 100);
  const nb = sent.filter((m) => m.type === 'b').length;
  A.applyInput(0, w.tick + 1, 5, 0, 0, 5, 6);
  ok(sent.filter((m) => m.type === 'b').length === nb + 1, 'đánh trượt chỉ phát sự kiện vung tay');
  const L = w.load[1];
  place(1, w.bx[1], w.by[1]);
  A.advance(w.tick + 2);
  ok(A.dep[1] === L && w.load[1] === 0, `về căn cứ → nộp ${L} viên, hết mang`);
  w.load[2] = 5;
  A.supply += 5;
  place(2, 60, 60);
  A.advance(A.endT + 3);
  ok(A.dep[2] === 0 && sent.some((m) => m.type === 'o' && m.lost[2] === 5), 'hết giờ: đồ đang mang không được tính');

  const B = new TreasureArena(0, ['a', 'b'], () => {}, { ...T_DEFAULT, lagComp: false });
  B.start();
  B.advance(B.fs + 1);
  B.iAct.fill(0);
  B.iCount = 0;
  B.w.load[1] = 10;
  B.supply = 19;
  B.w.load[0] = 9;
  const pl = (i: number, x: number, y: number) => {
    B.w.x[i] = x;
    B.w.y[i] = y;
    for (let k = 0; k < RING; k++) B.w.recordAt(i, k);
  };
  pl(0, 300, 250);
  pl(1, 310, 250);
  B.applyInput(0, B.w.tick + 1, 1, 0, 0, 1, 6);
  ok(B.w.load[0] === MAXC && B.w.load[0] + B.w.load[1] + B.iCount === 19, `người cướp không vượt trần ${MAXC}, phần dư rơi xuống đất (a=${B.w.load[0]} b=${B.w.load[1]} đất=${B.iCount})`);
}

console.log('\n[5] Chấm điểm công bằng giữa đấu trường lớn nhỏ');
{
  const ids7 = Array.from({ length: 7 }, (_, i) => `p${i}`);
  const now = 5_000_000;
  const ctx: any = { playerIds: ids7, startAt: now, endAt: now + 112000, now: () => now, broadcast() {}, send() {} };
  const cfg = treasureGame.createConfig(ctx);
  ok(cfg.arenas.length === 2 && cfg.arenas.map((a) => a.ids.length).join() === '4,3', 'ván 7 người chia 4+3');
  const st = treasureGame.createState(ctx, cfg);
  treasureGame.onStart!(ctx, st, cfg);
  for (const a of st.arenas) {
    a.advance(a.fs + 1);
    a.supply = 48;
    for (let i = 0; i < a.n; i++) a.dep[i] = 48 / a.n;
  }
  const res = treasureGame.calculateScore(ctx, st, cfg);
  const raws = ids7.map((id) => res[id].raw);
  ok(raws.every((r) => r === 1000), `nộp đúng phần chia đều → ai cũng 1000 điểm dù trường 4 hay 3 người (${raws.join(',')})`);
  ok(st.arenas.length === 0 && st.where.size === 0, 'calculateScore giải phóng dữ liệu ván');
}

console.log('\n[6] Mạng giả lập (code server thật + client thật)');
const base: TSimCfg = { n: 4, oneWayMs: 0, jitterMs: 0, stallRate: 0, stallMs: 0, lagComp: true, viewDelay: 6, seconds: quick ? 40 : 110, seed: 11, thieves: 2, clockErrMs: 0 };
for (const rtt of [0, 80, 150, 250]) {
  const r = runTSim({ ...base, oneWayMs: rtt / 2, jitterMs: rtt >= 80 ? rtt * 0.08 : 0, stallRate: rtt >= 150 ? 0.01 : 0, stallMs: 120, clockErrMs: rtt ? 8 : 0 });
  console.log(`  RTT ${rtt}ms: sai lệch người mình (so với server) mean ${r.ownErrMean.toFixed(2)} p99 ${r.ownErrP99.toFixed(1)} max ${r.ownErrMax.toFixed(1)} đv · người khác (nội suy) mean ${r.otherErrMean.toFixed(2)} max ${r.otherErrMax.toFixed(1)} · lệch so với server cùng lúc ${r.otherLagPxMean.toFixed(1)} đv (~${r.otherLagMsMean.toFixed(0)}ms) · hoà giải ${r.corrections} lần, lớn nhất ${r.maxCorrection.toFixed(1)}`);
  console.log(`          cướp ${r.stealTotal} · đẩy ${r.shoves} · trượt ${r.whiffs} · nhặt ${r.pickups} · nộp ${r.deposits} · điểm nộp [${r.deps.join(',')}] · phản hồi phím mean ${r.inputLatMsMean.toFixed(1)}ms max ${r.inputLatMsMax.toFixed(1)}ms`);
  console.log(`          mạng/người: xuống ${(r.downBytesPerSecPerClient / 1024).toFixed(2)} KB/s · snapshot ${r.snapsPerSec.toFixed(1)}/s · lên ${r.upMsgsPerSecPerClient.toFixed(1)} gói/s ${(r.upBytesPerSecPerClient / 1024).toFixed(2)} KB/s · CPU server ${r.serverMsPerSec.toFixed(2)} ms/s`);
  console.log(`          cướp theo màn hình người bấm: có nạn nhân trong tầm ${r.stealAttemptsVisible} lần → cướp được ${r.stealVisibleOk}, chỉ đẩy ${r.stealVisibleShoved}; không thấy ai trong tầm ${r.stealInvisible} lần → vẫn cướp được ${r.stealInvisibleHit}`);
  ok(r.invariantOk, `RTT ${rtt}: bảo toàn kho báu (nộp+mang+đất = nguồn cung) mọi lúc`);
  ok(r.syncOk, `RTT ${rtt}: điểm/cướp ở client khớp server khi hết ván ${r.syncWhy}`);
  const lim = rtt <= 80 ? 3 : rtt <= 150 ? 6 : 10;
  ok(r.ownErrP99 < lim, `RTT ${rtt}: p99 sai lệch người mình < ${lim} đv (${r.ownErrP99.toFixed(2)}; bán kính người chơi = 11)`);
  ok(r.inputLatMsMax <= 17, `RTT ${rtt}: phím phản hồi ngay trong khung hình kế tiếp (${r.inputLatMsMax.toFixed(1)}ms)`);
  ok(r.deposits > 0, `RTT ${rtt}: có người nộp điểm`);
}
console.log(fails ? `\n✘ ${fails} lỗi` : '\n✔ tất cả đạt');
process.exit(fails ? 1 : 0);
