// chạy: cd server && npx tsx test/fishing.test.ts [--balance]
// Thử luật cắn câu, độ khó theo loại cá, giật cá/cooldown/miễn nhiễm, tính điểm,
// và cân bằng bot câu thường vs bot chỉ giật (đồng hồ giả, có độ trễ mạng).
import assert from 'node:assert/strict';
import { fishingGame as g, pickStealTarget } from '../src/games/fishing.js';
import {
  CAST_LOCK_MS,
  HOOK_MS,
  IMMUNE_MS,
  NIB_MS,
  SPECIES,
  STEAL_CD_MS,
  STEAL_MISS_PENALTY,
  STEAL_MISS_STUN_MS,
  STEAL_WINDOW_MS,
  STEP_MS,
  ST_BITE,
  ST_IDLE,
  ST_NIB,
  ST_REEL,
  ST_STUN,
  ST_WAIT,
  WAIT_MAX_MS,
  WAIT_MIN_MS,
  lakeSizes,
  makeBag,
  mulberry32,
  newReel,
  stepBar,
  stepReel,
  fishY,
  DURATION_MS,
  type ReelState,
} from '../../shared/fishing.js';
import { FishBot, type Strategy } from './fishingBot.js';

let failed = 0;
const t = (name: string, fn: () => void) => {
  try {
    fn();
    console.log('ok   ', name);
  } catch (e) {
    failed++;
    console.log('FAIL ', name, '\n', e);
  }
};

/* ---------- harness ---------- */
interface Sent {
  to: string;
  p: any;
}
function mkGame(n: number, clock = { v: 1_000_000 }) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const sent: Sent[] = [];
  const ctx = {
    playerIds: ids,
    startAt: clock.v + 1000,
    endAt: clock.v + 1000 + g.duration,
    now: () => clock.v,
    broadcast() {},
    send: (to: string, p: any) => void sent.push({ to, p }),
  };
  const cfg = g.createConfig(ctx);
  const st = g.createState(ctx, cfg);
  clock.v = ctx.startAt;
  g.onStart!(ctx, st, cfg);
  return { ctx, cfg, st, clock, sent, ids };
}
const adv = (G: ReturnType<typeof mkGame>, ms: number) => {
  const end = G.clock.v + ms;
  while (G.clock.v < end) {
    G.clock.v += STEP_MS;
    g.update(G.ctx, G.st, G.cfg);
  }
};
const inp = (G: ReturnType<typeof mkGame>, id: string, i: any) => g.handleInput(G.ctx, G.st, G.cfg, id, i);
const P = (G: ReturnType<typeof mkGame>, id: string) => G.st.byId.get(id)!;
const evs = (G: ReturnType<typeof mkGame>, to: string, type: string) => G.sent.filter((s) => s.to === to && s.p.type === type).map((s) => s.p);

/** quăng rồi tua tới đúng lúc phao nhúng (trong cửa sổ giật) */
function toBite(G: ReturnType<typeof mkGame>, id: string) {
  const p = P(G, id);
  inp(G, id, { type: 'fcast' });
  let guard = 0;
  while (p.st !== ST_BITE && guard++ < 400) adv(G, STEP_MS);
  assert.equal(p.st, ST_BITE);
  return p;
}

/* ---------- chia hồ ---------- */
t('chia hồ: 2..16 người, mỗi hồ 3-6 (trừ n<3), tổng đủ', () => {
  for (let n = 2; n <= 16; n++) {
    const s = lakeSizes(n);
    assert.equal(s.reduce((a, b) => a + b, 0), n);
    assert.ok(Math.max(...s) <= 6, `n=${n} ${s}`);
    if (n >= 7) assert.ok(Math.min(...s) >= 3 && Math.max(...s) - Math.min(...s) <= 1, `n=${n} ${s}`);
  }
  assert.deepEqual(lakeSizes(16), [4, 4, 4, 4]);
  assert.deepEqual(lakeSizes(7), [4, 3]);
});

t('config: mỗi người đúng một hồ', () => {
  const G = mkGame(16);
  const all = G.cfg.lakes.flat();
  assert.equal(new Set(all).size, 16);
  assert.equal(G.cfg.lakes.length, 4);
});

/* ---------- túi cá ---------- */
t('túi cá: có đủ loại, xác định theo seed, rác + cá hiếm', () => {
  const a = makeBag(mulberry32(7));
  const b = makeBag(mulberry32(7));
  assert.deepEqual(a, b);
  let legend = 0;
  let total = 0;
  const cnt = SPECIES.map(() => 0);
  for (let s = 0; s < 2000; s++) {
    const bag = makeBag(mulberry32(s));
    for (const x of bag) {
      cnt[x]++;
      total++;
    }
    if (bag.includes(4)) legend++;
  }
  assert.ok(legend / 2000 > 0.5 && legend / 2000 < 0.7);
  for (let i = 0; i < SPECIES.length; i++) assert.ok(cnt[i] > 0, SPECIES[i].name);
  const ev = cnt.reduce((s, c, i) => s + c * SPECIES[i].value, 0) / total;
  console.log(`     giá trị kỳ vọng mỗi lần cắn: ${ev.toFixed(1)} điểm`);
  assert.ok(ev > 12 && ev < 22);
  assert.ok(SPECIES.filter((x) => x.tier === 'trash').every((x) => x.cls === 0), 'rác dùng lớp 0 để không lộ');
});

/* ---------- luật cắn câu ---------- */
t('cắn: quăng → chờ ≥ WAIT_MIN, phao rung rồi nhúng; không cắn sớm', () => {
  for (let k = 0; k < 40; k++) {
    const G = mkGame(2);
    inp(G, 'p0', { type: 'fcast' });
    const p = P(G, 'p0');
    assert.equal(p.st, ST_WAIT);
    const wait = p.biteAt - G.clock.v;
    assert.ok(wait >= WAIT_MIN_MS + NIB_MS - 1 && wait <= WAIT_MAX_MS + NIB_MS + 1, String(wait));
    adv(G, WAIT_MIN_MS - STEP_MS);
    assert.ok(p.st === ST_WAIT);
    assert.equal(evs(G, 'p0', 'bite').length, 0);
    let guard = 0;
    while (p.st !== ST_BITE && guard++ < 400) adv(G, STEP_MS);
    assert.equal(p.st, ST_BITE);
    const b = evs(G, 'p0', 'bite');
    assert.equal(b.length, 1);
    assert.ok(b[0].cls >= 0 && b[0].cls <= 4 && Number.isInteger(b[0].seed));
    // cá cắn là bí mật: không gửi loài cho client
    assert.equal(b[0].sp, undefined);
    assert.equal(b[0].item, undefined);
    const lake = evs(G, 'p1', 'st');
    assert.ok(lake.some((e) => e.s === ST_NIB) && lake.some((e) => e.s === ST_BITE));
  }
});

t('cắn: giật sớm (lúc chờ / phao rung) → cá sợ, bị khoá ngắn; không quăng ngay được', () => {
  const G = mkGame(2);
  inp(G, 'p0', { type: 'fcast' });
  adv(G, 300);
  inp(G, 'p0', { type: 'fhook', at: G.clock.v });
  const p = P(G, 'p0');
  assert.equal(p.st, ST_IDLE);
  assert.equal(evs(G, 'p0', 'esc')[0].why, 'early');
  inp(G, 'p0', { type: 'fcast' });
  assert.equal(p.st, ST_IDLE, 'còn khoá');
  adv(G, 700);
  inp(G, 'p0', { type: 'fcast' });
  assert.equal(p.st, ST_WAIT);
});

t('cắn: bỏ lỡ cửa sổ giật → mất cá VÀ loài đã bị bốc (không làm lại được)', () => {
  const G = mkGame(2);
  const p = P(G, 'p0');
  const bagBefore = p.bag.slice();
  toBite(G, 'p0');
  assert.equal(p.bagPos, 1);
  adv(G, HOOK_MS + 400);
  assert.equal(p.st, ST_IDLE);
  assert.equal(evs(G, 'p0', 'esc').at(-1).why, 'late');
  adv(G, 800);
  toBite(G, 'p0');
  assert.equal(p.bagPos, 2, 'lần cắn sau bốc con kế tiếp');
  assert.ok(bagBefore.length >= 2);
});

t('cắn: giật đúng lúc → vào ván kéo', () => {
  const G = mkGame(2);
  const p = toBite(G, 'p0');
  inp(G, 'p0', { type: 'fhook', at: G.clock.v - 30 });
  assert.equal(p.st, ST_REEL);
  assert.ok(p.t0 >= p.biteAt && p.t0 <= G.clock.v);
});

/* ---------- ván kéo cá: độ khó ---------- */
function reelRate(cls: number, skill: number, games = 400): { rate: number; secs: number } {
  let ok = 0;
  let ticks = 0;
  for (let s = 0; s < games; s++) {
    const bot = new FishBot({ seat: 0, strat: 'fisher', skill, seed: s + 1, send: () => {} }) as any;
    const r: ReelState = newReel();
    bot.reel = r;
    bot.cls = cls;
    bot.seed = s * 7919 + 13;
    bot.hold = false;
    let res = 0;
    let tk = 0;
    for (; tk < 300 && res === 0; tk++) {
      const want = bot.decide(tk);
      res = stepReel(r, want, cls, bot.seed, tk);
    }
    if (res === 1) ok++;
    ticks += tk;
  }
  return { rate: ok / games, secs: (ticks / games) * 0.05 };
}

t('độ khó: càng hiếm càng khó kéo (bot giỏi / vừa / vụng)', () => {
  console.log('     lớp : giỏi(0.9)  vừa(0.6)  vụng(0.3)   [tỉ lệ kéo được, giây TB]');
  const rows: number[][] = [];
  for (let cls = 0; cls < 5; cls++) {
    const a = reelRate(cls, 0.9);
    const b = reelRate(cls, 0.6);
    const c = reelRate(cls, 0.3);
    rows.push([a.rate, b.rate, c.rate]);
    console.log(`     ${cls}   : ${(a.rate * 100).toFixed(0)}% ${a.secs.toFixed(1)}s   ${(b.rate * 100).toFixed(0)}% ${b.secs.toFixed(1)}s   ${(c.rate * 100).toFixed(0)}% ${c.secs.toFixed(1)}s`);
  }
  for (let k = 0; k < 3; k++) for (let cls = 1; cls < 5; cls++) assert.ok(rows[cls][k] <= rows[cls - 1][k] + 0.03, `cls ${cls} skill ${k}`);
  assert.ok(rows[0][0] > 0.9, 'cá thường dễ với người giỏi');
  assert.ok(rows[0][1] > 0.9, 'cá thường dễ với người vừa');
  assert.ok(rows[4][1] < rows[0][1] - 0.25, 'huyền thoại khó rõ rệt');
  assert.ok(rows[4][0] > 0.2, 'huyền thoại vẫn kéo được nếu giỏi');
});

t('mô phỏng: server và client tính cùng kết quả khi cùng chuỗi giữ/nhả', () => {
  const a = newReel();
  const b = newReel();
  const rng = mulberry32(5);
  for (let tk = 0; tk < 200; tk++) {
    const h = rng() < 0.5;
    const ra = stepReel(a, h, 2, 1234, tk);
    const rb = stepReel(b, h, 2, 1234, tk);
    assert.equal(ra, rb);
    assert.equal(a.y, b.y);
    assert.equal(a.p, b.p);
    if (ra) break;
  }
  const o = { y: 0.5, v: 0 };
  for (let i = 0; i < 100; i++) stepBar(o, true, 0);
  assert.ok(o.y > 0.85 && o.y <= 0.87);
  for (let i = 0; i < 200; i++) stepBar(o, false, 0);
  assert.ok(o.y < 0.15 && o.y >= 0.14);
  const f = Array.from({ length: 300 }, (_, i) => fishY(9, 4, i));
  assert.ok(f.every((v) => v >= 0.05 && v <= 0.95));
});

/* ---------- server: ván kéo end-to-end với lệnh giữ/nhả ---------- */
function reelWith(G: ReturnType<typeof mkGame>, id: string, holdAll: boolean | null) {
  const p = toBite(G, id);
  inp(G, id, { type: 'fhook', at: G.clock.v });
  if (holdAll !== null) inp(G, id, { type: 'fhold', h: holdAll ? 1 : 0, k: 0 });
  return p;
}

t('kéo: không bấm gì → cá thoát (rác/cá), có sự kiện esc', () => {
  const G = mkGame(2);
  const p = reelWith(G, 'p0', null);
  adv(G, 25_000);
  assert.equal(p.st, ST_IDLE);
  assert.equal(p.lostFish + p.caught.reduce((a, b) => a + b, 0) >= 1, true);
});

t('kéo: lệnh k trong quá khứ / tương lai xa bị kẹp, spam không phình bộ nhớ', () => {
  const G = mkGame(2);
  const p = reelWith(G, 'p0', null);
  for (let i = 0; i < 2000; i++) inp(G, 'p0', { type: 'fhold', h: (i & 1) as 0 | 1, k: i % 2 ? -999 : 99999 });
  assert.ok(p.hn <= 318);
  for (let i = 1; i < p.hn; i++) assert.ok(p.hk[i] >= p.hk[i - 1]);
});

t('kéo: bot giỏi kéo lên được cá thường và điểm cộng đúng giá', () => {
  // chạy nhiều lần, ép loài = Cá rô (cls 0)
  let caught = 0;
  for (let k = 0; k < 20; k++) {
    const G = mkGame(2);
    const p = P(G, 'p0');
    p.bag = [0, 0, 0, 0];
    p.bagPos = 0;
    const bot = new FishBot({ seat: 0, strat: 'fisher', skill: 0.95, seed: k + 1, send: (i) => inp(G, 'p0', i) });
    const cut = G.sent.length;
    inp(G, 'p0', { type: 'fcast' });
    bot.mode = 'wait';
    let guard = 0;
    while (p.pts === 0 && guard++ < 400) {
      G.clock.v += STEP_MS;
      g.update(G.ctx, G.st, G.cfg);
      for (const s of G.sent.splice(cut)) if (s.to === 'p0') bot.onEvent(s.p, G.clock.v);
      bot.step(G.clock.v);
    }
    if (p.pts === 10) caught++;
    assert.ok(p.pts === 0 || p.pts === 10);
  }
  assert.ok(caught >= 18, `kéo được ${caught}/20`);
});

/* ---------- giật cá ---------- */
function setupSteal(rngVal: number) {
  const G = mkGame(3);
  G.st.lakes[0].rng = () => rngVal;
  const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => P(G, id));
  return { G, a, b, c };
}
const land = (G: ReturnType<typeof mkGame>, p: any, sp: number) => {
  p.heldSp = sp;
  p.heldUntil = G.clock.v + STEAL_WINDOW_MS;
  p.pts += SPECIES[sp].value;
};

t('giật: cá vừa lên bờ bị cướp (50% giá trị), nạn nhân mất đủ, được miễn nhiễm', () => {
  const { G, a, b } = setupSteal(0);
  land(G, b, 3); // cá mập 50
  inp(G, a.id, { type: 'fsteal', to: b.id });
  assert.equal(a.pts, 25);
  assert.equal(b.pts, 0);
  assert.equal(b.heldUntil, 0);
  assert.equal(a.stealOk, 1);
  assert.ok(b.immuneUntil > G.clock.v);
  const ev = evs(G, a.id, 'stl')[0];
  assert.equal(ev.ok, 1);
  assert.equal(ev.k, 'l');
  assert.equal(ev.sp, 3);
});

t('giật: cá đã quá cửa sổ không giật được; miễn nhiễm chặn giật liên tục', () => {
  const { G, a, c, b } = setupSteal(0);
  land(G, b, 3);
  adv(G, STEAL_WINDOW_MS + 100);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.pts, 0);
  assert.equal(evs(G, a.id, 'ns').length, 1, 'không có mục tiêu');
  // giật thành công một lần rồi người thứ hai không giật được tiếp trong miễn nhiễm
  land(G, b, 3);
  adv(G, 400);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealOk, 1);
  land(G, b, 4);
  inp(G, c.id, { type: 'fsteal' });
  assert.equal(c.pts, 0, 'đang miễn nhiễm');
  assert.equal(b.pts, 150);
  adv(G, IMMUNE_MS + 100);
  land(G, b, 1);
  b.pts += 0;
  inp(G, c.id, { type: 'fsteal' });
  assert.equal(c.stealOk, 1);
});

t('giật: cooldown 6s cho cả thành công lẫn hụt; không tự giật mình', () => {
  const { G, a, b, c } = setupSteal(0);
  land(G, b, 3);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealOk, 1);
  land(G, c, 3);
  adv(G, STEAL_CD_MS - 500);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealOk, 1, 'chưa hết hồi chiêu');
  adv(G, 700);
  land(G, c, 3);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealOk, 2);
  const t1 = pickStealTarget(G.st.lakes[0], a, G.clock.v, a.id);
  assert.equal(t1, null);
});

t('giật hụt: bị trừ điểm + choáng, không quăng được, hồi chiêu vẫn tính', () => {
  const { G, a, b } = setupSteal(0.999);
  a.pts = 20;
  land(G, b, 3);
  inp(G, a.id, { type: 'fsteal', to: b.id });
  assert.equal(a.stealMiss, 1);
  assert.equal(a.pts, 20 - STEAL_MISS_PENALTY);
  assert.equal(a.st, ST_STUN);
  assert.equal(b.pts, 50);
  assert.equal(b.immuneUntil, 0, 'giật hụt không làm nạn nhân miễn nhiễm');
  inp(G, a.id, { type: 'fcast' });
  assert.equal(a.st, ST_STUN);
  adv(G, STEAL_MISS_STUN_MS + 150);
  assert.equal(a.st, ST_IDLE);
  inp(G, a.id, { type: 'fcast' });
  assert.equal(a.st, ST_WAIT);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealMiss, 1, 'còn hồi chiêu');
});

t('giật: không giật cá rác (không có lợi); giật khi đang kéo thì nhận cả rác', () => {
  const { G, a, b } = setupSteal(0);
  land(G, b, 5); // giày cũ
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(evs(G, a.id, 'ns').length, 1);
  // b đang kéo một chiếc giày (kẻ giật không biết)
  a.pts = 30;
  b.st = ST_REEL;
  b.t0 = G.clock.v - 2000;
  b.item = 5;
  b.reel.p = 0.8;
  b.heldUntil = 0;
  adv(G, 400);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealOk, 1);
  assert.equal(a.pts, 30 - 8, 'ôm trọn giày cũ');
  assert.equal(b.st, ST_IDLE);
  assert.ok(b.immuneUntil > G.clock.v);
});

t('giật: kẻ giật cá đang kéo khi cá còn mới cắn thì chưa được; đang kéo thì không giật', () => {
  const { G, a, b } = setupSteal(0);
  b.st = ST_REEL;
  b.t0 = G.clock.v;
  b.item = 3;
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealOk, 0);
  a.st = ST_REEL;
  a.t0 = G.clock.v;
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.stealOk, 0);
});

t('giật: bỏ cần đang chờ để lao đi giật (mất lượt chờ)', () => {
  const { G, a, b } = setupSteal(0);
  land(G, b, 1);
  inp(G, a.id, { type: 'fcast' });
  assert.equal(a.st, ST_WAIT);
  inp(G, a.id, { type: 'fsteal' });
  assert.equal(a.st, ST_IDLE);
  assert.equal(a.stealOk, 1);
});

/* ---------- điểm ---------- */
t('điểm: không âm, kèm chi tiết; dọn dữ liệu sau calculateScore', () => {
  const G = mkGame(4);
  const p = P(G, 'p0');
  p.caught[5] = 2;
  p.caught[0] = 3;
  p.caught[4] = 1;
  p.pts = 130;
  p.stealOk = 2;
  p.stealMiss = 1;
  P(G, 'p1').pts = 0;
  G.st.lakes[0].burn = 8;
  const r = g.calculateScore(G.ctx, G.st, G.cfg);
  assert.equal(r.p0.raw, 130 + 2);
  assert.match(r.p0.detail, /4 cá/);
  assert.match(r.p0.detail, /Rồng vàng/);
  assert.match(r.p0.detail, /2 rác/);
  assert.match(r.p0.detail, /giật 2\/3/);
  assert.match(r.p0.detail, /\+2 cá rơi vãi/);
  assert.equal(r.p1.raw, 2, 'chia đều phần rơi vãi');
  assert.equal(G.st.byId.size, 0);
  assert.equal(G.st.lakes.length, 0);
});

t('điểm: không bao giờ âm dù câu rác liên tục', () => {
  const G = mkGame(2);
  const p = P(G, 'p0');
  p.item = 5;
  p.cls = 0;
  p.reel.p = 1;
  p.st = ST_REEL;
  p.t0 = G.clock.v - 100_000;
  p.tick = 0;
  adv(G, 3000);
  assert.ok(p.pts >= 0);
});

t('isFinished: đúng sau DURATION', () => {
  const G = mkGame(2);
  assert.equal(g.isFinished(G.ctx, G.st, G.cfg), false);
  G.clock.v += DURATION_MS;
  assert.equal(g.isFinished(G.ctx, G.st, G.cfg), true);
  assert.ok(g.duration > DURATION_MS);
});

/* ---------- mô phỏng cả ván với bot ---------- */
interface BotSpec {
  strat: Strategy;
  skill: number;
}
function playGame(n: number, specOf: (idx: number, lake: number, seat: number) => BotSpec, latMs = 80): { pts: number[]; spec: BotSpec[]; lakeOf: number[]; stats: any } {
  const G = mkGame(n);
  const spec: BotSpec[] = [];
  const bots = new Map<string, FishBot>();
  const lakeOf: number[] = [];
  const idx = new Map<string, number>();
  G.ids.forEach((id, i) => idx.set(id, i));
  const inq: { at: number; id: string; i: any }[] = [];
  const outq: { at: number; id: string; p: any }[] = [];
  G.cfg.lakes.forEach((ids: string[], li: number) =>
    ids.forEach((id: string, seat: number) => {
      const s = specOf(idx.get(id)!, li, seat);
      spec[idx.get(id)!] = s;
      lakeOf[idx.get(id)!] = li;
      bots.set(id, new FishBot({ seat, strat: s.strat, skill: s.skill, seed: Math.floor(Math.random() * 1e9), send: (i) => inq.push({ at: G.clock.v + latMs, id, i }) }));
    }),
  );
  G.ctx.send = (to: string, p: any) => void outq.push({ at: G.clock.v + latMs, id: to, p });
  (G.ctx as any).send = G.ctx.send;
  while (!g.isFinished(G.ctx, G.st, G.cfg)) {
    G.clock.v += STEP_MS;
    for (let i = 0; i < inq.length; ) {
      if (inq[i].at <= G.clock.v) {
        const q = inq.splice(i, 1)[0];
        g.handleInput(G.ctx, G.st, G.cfg, q.id, q.i);
      } else i++;
    }
    g.update(G.ctx, G.st, G.cfg);
    for (let i = 0; i < outq.length; ) {
      if (outq[i].at <= G.clock.v) {
        const q = outq.splice(i, 1)[0];
        bots.get(q.id)!.onEvent(q.p, G.clock.v);
      } else i++;
    }
    for (const b of bots.values()) b.step(G.clock.v);
  }
  const stats = { ok: 0, miss: 0 };
  for (const p of G.st.byId.values()) {
    stats.ok += p.stealOk;
    stats.miss += p.stealMiss;
  }
  const res = g.calculateScore(G.ctx, G.st, G.cfg);
  return { pts: G.ids.map((id) => res[id].raw), spec, lakeOf, stats };
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

t('cân bằng: lake 4 người, bot câu thường thắng bot chỉ giật (cùng kỹ năng)', () => {
  const N = 40;
  const fish: number[] = [];
  const thief: number[] = [];
  const hyb: number[] = [];
  let thiefWins = 0;
  for (let k = 0; k < N; k++) {
    // 1 kẻ giật + 3 người câu
    const r = playGame(4, (i) => ({ strat: i === 0 ? 'thief' : 'fisher', skill: 0.6 }));
    const idx = r.spec.findIndex((s) => s.strat === 'thief');
    thief.push(r.pts[idx]);
    const others = r.pts.filter((_, i) => i !== idx);
    fish.push(mean(others));
    if (r.pts[idx] > Math.max(...others)) thiefWins++;
    // 1 hybrid + 3 người câu
    const h = playGame(4, (i) => ({ strat: i === 0 ? 'hybrid' : 'fisher', skill: 0.6 }));
    const hi = h.spec.findIndex((s) => s.strat === 'hybrid');
    hyb.push(h.pts[hi]);
  }
  console.log(`     kẻ giật thuần: ${mean(thief).toFixed(0)} đ · người câu cạnh nó: ${mean(fish).toFixed(0)} đ · giật thắng cả hồ ${thiefWins}/${N}`);
  console.log(`     hybrid (câu + giật cá ≥16đ): ${mean(hyb).toFixed(0)} đ`);
  assert.ok(mean(thief) < mean(fish) * 0.7, 'giật thuần phải thua rõ');
  assert.ok(thiefWins / N < 0.15);
});

t('cân bằng: 4 người giật thuần cùng hồ vẫn thua 4 người câu thường (cả hai bên 0 cá ngoài)', () => {
  const N = 20;
  const th: number[] = [];
  for (let k = 0; k < N; k++) {
    const r = playGame(5, (i) => ({ strat: i < 3 ? 'thief' : 'fisher', skill: 0.6 }));
    th.push(mean(r.pts.filter((_, i) => r.spec[i].strat === 'thief')));
  }
  const fi = mean(Array.from({ length: N }, () => mean(playGame(5, () => ({ strat: 'fisher', skill: 0.6 })).pts)));
  console.log(`     3 kẻ giật + 2 người câu: kẻ giật TB ${mean(th).toFixed(0)} đ; hồ toàn người câu TB ${fi.toFixed(0)} đ`);
  assert.ok(mean(th) < fi * 0.7);
});

t('công bằng giữa hồ khác cỡ: điểm TB bot cùng kỹ năng ở hồ 3/4/5/6 chênh nhỏ', () => {
  const N = 25;
  const out: Record<number, number[]> = { 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const size of [2, 3, 4, 5, 6]) {
    for (let k = 0; k < N; k++) out[size].push(mean(playGame(size, () => ({ strat: 'hybrid', skill: 0.6 })).pts));
  }
  const ms = Object.entries(out).map(([s, a]) => [s, mean(a)] as const);
  console.log('     hybrid TB theo cỡ hồ: ' + ms.map(([s, m]) => `${s}→${m.toFixed(0)}`).join('  '));
  const vals = ms.map(([, m]) => m);
  assert.ok(Math.max(...vals) / Math.min(...vals) < 1.2, 'chênh lệch cỡ hồ dưới 20%');
});

if (failed) {
  console.log(`\n${failed} test lỗi`);
  process.exit(1);
}
console.log('\nTất cả test đạt');
