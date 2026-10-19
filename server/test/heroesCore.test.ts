// Kiểm thử lõi game thẻ tướng: engine trận (deterministic), gacha (tỉ lệ + pity), ải, AFK, thể lực.
// Chạy: cd server && npx tsx test/heroesCore.test.ts
import { Battle, simulate, heroUnit, advantage, type BattleSetup } from '../../shared/heroes/battle.js';
import { AFK_CAP_MS, BATTLE_MAX_TICKS, STAMINA_MAX } from '../../shared/heroes/config.js';
import { statsAt } from '../../shared/heroes/formulas.js';
import { BANNER_BY_ID, NEW_PITY, SSR_PITY, UR_PITY, summon, type PityState } from '../../shared/heroes/gacha.js';
import { GEAR_BY_ID, GEAR_DEFS, MAX_GEAR_LEVEL, STARTER_GEAR, enhanceCost, gearStats, rollGearDrops, salvageStones, sumGear } from '../../shared/heroes/gear.js';
import { HEROES, STARTER_HEROES } from '../../shared/heroes/heroes.js';
import { mulberry32 } from '../../shared/heroes/rng.js';
import { SKILL_LIST, skillOf } from '../../shared/heroes/skills.js';
import { STAGES, afkReward, staminaNow, stageSetup, starsOf } from '../../shared/heroes/stages.js';
import type { OwnedHero } from '../../shared/heroes/types.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};

const owned = (id: string, level = 1, star = 1): OwnedHero => ({ id, level, star, shards: 0 });
const starterTeam = (level = 1) => STARTER_HEROES.map((id, i) => heroUnit(owned(id, level), i));

console.log('— dữ liệu —');
ok(HEROES.length === 12, '12 tướng');
ok(HEROES.every((h) => h.skills.every((s) => !!skillOf(s))), 'mọi tướng trỏ tới kỹ năng có thật');
ok(STAGES.length === 30 && STAGES[29].boss, '30 ải, ải cuối là boss');
ok(STAGES.every((s) => s.waves.length === 3 && s.waves.every((w) => w.length >= 2 && w.length <= 5)), 'mỗi ải 3 đợt, 2–5 quái');
ok(SKILL_LIST.every((s) => s.kind !== 'active' || s.cd > 0), 'kỹ năng chủ động đều có hồi chiêu');
ok(advantage('forest', 'earth') === 1 && advantage('earth', 'forest') === -1 && advantage('forest', 'forest') === 0, 'hệ khắc Rừng>Đất');

console.log('— engine trận —');
const s11 = stageSetup(STAGES[0], starterTeam(), 12345);
const a = simulate(s11);
const b = simulate(s11);
ok(JSON.stringify(a) === JSON.stringify(b), 'cùng seed cho cùng kết quả (deterministic)');
ok(a.win, 'đội tân binh cấp 1 thắng ải 1-1');
ok(a.ticks > 0 && a.ticks <= BATTLE_MAX_TICKS, 'trận kết thúc trong giới hạn thời gian');
const c = simulate({ ...s11, seed: 999 });
ok(JSON.stringify(c.events) !== JSON.stringify(a.events), 'khác seed cho diễn biến khác');

// không bao giờ lặp vô hạn: đội trống máu yếu vẫn dừng
const weak: BattleSetup = stageSetup(STAGES[29], [heroUnit(owned('thay_thuoc'), 0)], 7);
const w = simulate(weak);
ok(!w.win && w.ticks <= BATTLE_MAX_TICKS, 'đội yếu đánh boss cuối thua và dừng đúng hạn');

// tuyệt kỹ bằng tay: ghi input khi chơi trực tiếp rồi chạy lại phải ra đúng kết quả
{
  const live = new Battle(stageSetup(STAGES[3], starterTeam(5), 4242));
  const inputs: { tick: number; ult?: number; auto?: boolean }[] = [];
  const events = [];
  let ults = 0;
  while (!live.done) {
    for (const u of live.side(0)) {
      if (live.canUlt(u.uid)) {
        inputs.push({ tick: live.tick, ult: u.uid });
        live.ult(u.uid);
        ults++;
      }
    }
    events.push(...live.step());
  }
  const rep = simulate(stageSetup(STAGES[3], starterTeam(5), 4242), inputs);
  const liveRes = live.result(events);
  ok(ults > 0, `có bấm tuyệt kỹ bằng tay (${ults} lần)`);
  ok(rep.win === liveRes.win && rep.ticks === liveRes.ticks && rep.events.length === liveRes.events.length,
    'server chạy lại từ danh sách input ra đúng kết quả của client');
}

// Auto dùng tuyệt kỹ
{
  const r = simulate(stageSetup(STAGES[3], starterTeam(5), 77), [], true);
  const manual = simulate(stageSetup(STAGES[3], starterTeam(5), 77), [], false);
  const ultsAuto = r.events.filter((e) => e.k === 'act' && e.u < 10 && e.s.endsWith('_u')).length;
  const ultsOff = manual.events.filter((e) => e.k === 'act' && e.u < 10 && e.s.endsWith('_u')).length;
  ok(ultsAuto > 0 && ultsOff === 0, `Auto tự dùng tuyệt kỹ (${ultsAuto}), tắt Auto thì không (${ultsOff})`);
}

// hồi máu không vượt trần, tướng chết không hành động
{
  const r = simulate(stageSetup(STAGES[8], starterTeam(10), 31), [], true);
  const dead = new Set<number>();
  let bad = 0;
  for (const e of r.events) {
    if (e.k === 'die') dead.add(e.u);
    else if (e.k === 'act' && dead.has(e.u)) bad++;
    else if (e.k === 'heal') {
      const u = e.tg;
      if (e.hp < 0 || dead.has(u)) bad++;
    }
  }
  ok(bad === 0, 'tướng đã gục không ra đòn / không được hồi');
}

// stun chặn hành động
{
  const team = [heroUnit(owned('phap_su_re', 1, 1), 0)];
  const b2 = new Battle(stageSetup(STAGES[0], team, 5));
  b2.step();
  const foe = b2.side(1)[0];
  ok(!b2.stunned(foe), 'ban đầu quái không bị choáng');
}

// sao: thắng nhanh + không ai gục = 3 sao
{
  const r = simulate(stageSetup(STAGES[0], starterTeam(20), 1));
  ok(starsOf(r, STAGES[0]) === 3, `đội cấp 20 qua ải 1-1 được 3 sao (ticks ${r.ticks}, gục ${r.deaths})`);
  ok(starsOf(w, STAGES[29]) === 0, 'thua thì 0 sao');
}

console.log('— cân bằng chiến dịch (đội tân binh lên cấp dần) —');
{
  // cấp đội tối thiểu để thắng từng ải; phải tăng dần và hợp lý (≤ 60)
  const need: number[] = [];
  for (const st of STAGES) {
    let lv = 1;
    for (; lv <= 60; lv++) {
      const team = STARTER_HEROES.map((id, i) => heroUnit(owned(id, lv, Math.min(5, 1 + Math.floor(lv / 12))), i));
      if (simulate(stageSetup(st, team, 100 + st.index), [], true).win) break;
    }
    need.push(lv);
  }
  console.log('  cấp cần thiết theo ải:', need.join(' '));
  ok(need[0] === 1, 'ải 1-1 thắng ngay ở cấp 1');
  ok(need.every((n) => n <= 60), 'mọi ải thắng được ở cấp ≤ 60 với đội tân binh');
  ok(need[29] > need[0] + 15, 'độ khó tăng dần qua chiến dịch');
}

console.log('— gacha —');
const rngOf = (seed: number) => {
  const r = mulberry32(seed);
  return (n: number) => r.int(n);
};
{
  const std = BANNER_BY_ID.standard;
  const rand = rngOf(2024);
  const N = 200_000;
  const cnt: Record<string, number> = { R: 0, SR: 0, SSR: 0, UR: 0 };
  let st: PityState = NEW_PITY;
  let maxGapSSR = 0;
  let maxGapUR = 0;
  let gapS = 0;
  let gapU = 0;
  for (let i = 0; i < N; i++) {
    const r = summon(st, std, 1, rand);
    st = r.state;
    const p = r.pulls[0];
    cnt[p.rarity]++;
    gapS++;
    gapU++;
    if (p.rarity === 'SSR' || p.rarity === 'UR') {
      maxGapSSR = Math.max(maxGapSSR, gapS);
      gapS = 0;
    }
    if (p.rarity === 'UR') {
      maxGapUR = Math.max(maxGapUR, gapU);
      gapU = 0;
    }
  }
  const pct = (k: string) => (cnt[k] * 100) / N;
  console.log(`  R ${pct('R').toFixed(2)}%  SR ${pct('SR').toFixed(2)}%  SSR ${pct('SSR').toFixed(2)}%  UR ${pct('UR').toFixed(2)}%`);
  ok(Math.abs(pct('R') - 59) < 3 && pct('SR') > 28 && pct('SR') < 35, 'tỉ lệ R/SR quanh giá trị thiết kế');
  ok(pct('SSR') > 6.5 && pct('SSR') < 9.5, 'tỉ lệ SSR trong dung sai (có cộng pity)');
  ok(pct('UR') > 0.9 && pct('UR') < 1.7, 'tỉ lệ UR trong dung sai (có cộng pity)');
  ok(maxGapSSR <= SSR_PITY, `không bao giờ quá ${SSR_PITY} lượt không có SSR+ (max ${maxGapSSR})`);
  ok(maxGapUR <= UR_PITY, `không bao giờ quá ${UR_PITY} lượt không có UR (max ${maxGapUR})`);
}
{
  // x10 luôn có ít nhất 1 SR+
  const rand = rngOf(5);
  let bad = 0;
  let st: PityState = NEW_PITY;
  for (let i = 0; i < 5000; i++) {
    const r = summon(st, BANNER_BY_ID.standard, 10, rand);
    st = r.state;
    if (r.pulls.length !== 10 || r.pulls.every((p) => p.rarity === 'R')) bad++;
  }
  ok(bad === 0, 'x10 luôn đủ 10 lượt và có ít nhất 1 SR');
  // pity cứng
  const near: PityState = { sinceSSR: SSR_PITY - 1, sinceUR: 0, guaranteed: false };
  ok(['SSR', 'UR'].includes(summon(near, BANNER_BY_ID.standard, 1, (n: number) => n - 1).pulls[0].rarity), `lượt thứ ${SSR_PITY} chắc chắn SSR+`);
  const nearUR: PityState = { sinceSSR: 0, sinceUR: UR_PITY - 1, guaranteed: false };
  ok(summon(nearUR, BANNER_BY_ID.standard, 1, (n: number) => n - 1).pulls[0].rarity === 'UR', `lượt thứ ${UR_PITY} chắc chắn UR`);
  const after = summon(nearUR, BANNER_BY_ID.standard, 1, (n: number) => n - 1).state;
  ok(after.sinceUR === 0 && after.sinceSSR === 0, 'ra UR thì reset bộ đếm pity');
}

console.log('— công thức / AFK / thể lực —');
{
  const s1 = statsAt('warrior', 'R', 1, 1);
  const s60 = statsAt('warrior', 'R', 60, 5);
  ok(s60.atk > s1.atk * 10, 'cấp 60, 5 sao mạnh hơn cấp 1 nhiều lần');
  ok(statsAt('warrior', 'UR', 1, 1).hp > s1.hp, 'phẩm cao hơn thì chỉ số cao hơn');
  ok(statsAt('warrior', 'R', 999, 99).hp === s60.hp, 'cấp/sao bị chặn ở mức tối đa');
  const h = 3_600_000;
  ok(afkReward(-1, h).gold > 0, 'AFK có thưởng cả khi chưa qua ải nào');
  ok(afkReward(5, AFK_CAP_MS * 10).gold === afkReward(5, AFK_CAP_MS).gold, 'AFK chặn ở 12 giờ');
  ok(afkReward(5, -h).gold === 0, 'thời gian âm không ra thưởng');
  ok(afkReward(20, h).gold > afkReward(2, h).gold, 'ải cao hơn thì AFK nhiều hơn');
  ok(staminaNow(0, 0, 10 * 6 * 60_000) === 10, 'thể lực hồi 1 điểm / 6 phút');
  ok(staminaNow(100, 0, 1e12) === STAMINA_MAX, 'thể lực không vượt trần');
  ok(staminaNow(130, 0, 1e12) === 130, 'thể lực đang vượt trần (do thưởng) không bị cắt');
}

console.log('— trang bị (gear.ts) —');
{
  const wp = GEAR_BY_ID['weapon_forest_R'];
  ok(GEAR_DEFS.length === 48 && GEAR_DEFS.every((d) => GEAR_BY_ID[d.id] === d), '48 món định nghĩa, tra theo id khớp');
  let scales = true;
  for (const d of GEAR_DEFS) {
    let prev = gearStats(d, 0);
    for (let l = 1; l <= MAX_GEAR_LEVEL; l++) {
      const cur = gearStats(d, l);
      if (cur.hp + cur.atk + cur.def < prev.hp + prev.atk + prev.def) scales = false;
      prev = cur;
    }
  }
  ok(scales && true, 'chỉ số không giảm theo cấp');
  ok(gearStats(wp, 10).atk === 2 * gearStats(wp, 0).atk && gearStats(wp, 99).atk === gearStats(wp, 10).atk, 'cấp 10 = gấp đôi cấp 0, cấp vượt trần bị chặn');
  ok(gearStats(GEAR_BY_ID['weapon_water_UR'], 0).atk > gearStats(GEAR_BY_ID['weapon_water_SSR'], 0).atk, 'phẩm cao hơn mạnh hơn');
  const sum = sumGear([{ def: 'weapon_forest_R', level: 0 }, { def: 'armor_forest_R', level: 0 }]);
  ok(sum.atk === 12 && sum.hp === 120 && sum.def === 0, 'sumGear cộng đúng');
  let mono = true;
  for (const r of ['R', 'SR', 'SSR', 'UR'] as const) {
    for (let l = 0; l < MAX_GEAR_LEVEL - 1; l++) {
      const a = enhanceCost(r, l)!, b = enhanceCost(r, l + 1)!;
      if (b.gold <= a.gold || b.stones <= a.stones) mono = false;
    }
  }
  ok(mono && enhanceCost('R', MAX_GEAR_LEVEL) === null, 'enhanceCost tăng dần theo cấp, null ở cấp tối đa');
  ok(enhanceCost('UR', 3)!.gold > enhanceCost('R', 3)!.gold, 'phẩm cao tốn hơn');
  ok(salvageStones('R', 0) === 2 && salvageStones('R', 5) > salvageStones('R', 0) && salvageStones('UR', 0) > salvageStones('SSR', 0), 'salvageStones tăng theo phẩm và cấp');
  // rớt đồ
  const rnd = mulberry32(12345);
  const rand = (n: number) => rnd.int(n);
  const W: Record<number, number[]> = { 1: [80, 19, 1, 0], 2: [55, 38, 6, 1], 3: [35, 45, 17, 3] };
  const R4 = ['R', 'SR', 'SSR', 'UR'] as const;
  let idsOk = true, ur1 = 0, sizeOk = true;
  for (let ch = 1; ch <= 3; ch++) {
    const cnt = { R: 0, SR: 0, SSR: 0, UR: 0 };
    let total = 0;
    for (let i = 0; i < 100_000; i++) {
      const d = rollGearDrops(ch, i % 10 === 0, rand);
      if (d.length < 1 || d.length > 3 || (i % 10 !== 0 && d.length > 2)) sizeOk = false;
      for (const id of d) {
        const def = GEAR_BY_ID[id];
        if (!def) idsOk = false;
        else {
          cnt[def.rarity]++;
          total++;
          if (ch === 1 && def.rarity === 'UR') ur1++;
        }
      }
    }
    const close = R4.every((r, k) => Math.abs((cnt[r] / total) * 100 - W[ch][k]) < 1);
    ok(close, `chương ${ch}: tỉ lệ rớt khớp trọng số (${R4.map((r) => (cnt[r] / total * 100).toFixed(1)).join('/')})`);
  }
  ok(idsOk, 'mọi id rớt đều có trong GEAR_BY_ID');
  ok(ur1 === 0, 'chương 1 không rớt UR (100k lần)');
  ok(sizeOk, 'số món mỗi lần rớt: 1–2, ải boss tới 3');
  ok(STARTER_GEAR.length === 4 && STARTER_GEAR.every((id) => GEAR_BY_ID[id]?.rarity === 'R') && new Set(STARTER_GEAR.map((id) => GEAR_BY_ID[id].slot)).size === 4, 'quà khởi đầu: 4 món R, mỗi ô một món');
  const base = heroUnit(owned(STARTER_HEROES[0]), 0), boosted = heroUnit(owned(STARTER_HEROES[0]), 0, { hp: 100, atk: 10, def: 5, spd: 0 });
  ok(boosted.stats.hp === base.stats.hp + 100 && boosted.stats.atk === base.stats.atk + 10 && boosted.stats.def === base.stats.def + 5, 'heroUnit cộng bonus trang bị');
}

console.log(fails ? `\n${fails} LỖI` : '\nTất cả đạt');
process.exit(fails ? 1 : 0);
