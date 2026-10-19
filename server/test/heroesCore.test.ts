// Kiểm thử lõi game thẻ tướng: engine trận (deterministic), gacha (tỉ lệ + pity), ải, AFK, thể lực.
// Chạy: cd server && npx tsx test/heroesCore.test.ts
import { Battle, simulate, heroUnit, advantage, type BattleSetup } from '../../shared/heroes/battle.js';
import { arenaReward, arenaSetup, botSquad, ratingDelta } from '../../shared/heroes/arena.js';
import { AFK_CAP_MS, BATTLE_MAX_TICKS, STAMINA_MAX } from '../../shared/heroes/config.js';
import { statsAt } from '../../shared/heroes/formulas.js';
import { BANNER_BY_ID, NEW_PITY, SSR_PITY, UR_PITY, summon, type PityState } from '../../shared/heroes/gacha.js';
import { GEAR_BY_ID, GEAR_DEFS, MAX_GEAR_LEVEL, STARTER_GEAR, enhanceCost, gearStats, rollGearDrops, salvageStones, sumGear } from '../../shared/heroes/gear.js';
import { HEROES, STARTER_HEROES } from '../../shared/heroes/heroes.js';
import { mulberry32 } from '../../shared/heroes/rng.js';
import { SKILL_LIST, skillOf } from '../../shared/heroes/skills.js';
import { STAGES, afkReward, staminaNow, stageSetup, starsOf } from '../../shared/heroes/stages.js';
import type { OwnedHero } from '../../shared/heroes/types.js';
import { MONSTERS } from '../../shared/heroes/stages.js';
import { QUEST_DEFS, dayKey, nextDayStart } from '../../shared/heroes/quests.js';
import { SHOP_ITEMS } from '../../shared/heroes/shop.js';
import { TOWER_MAX_FLOOR, towerReward, towerStage } from '../../shared/heroes/tower.js';
import { levelCapOf } from '../../shared/heroes/formulas.js';
import {
  BOSS_ATTACKS_PER_DAY, BOSS_CYCLE_DAYS, BOSS_UID, GUILD_MAX_LEVEL, GUILD_MAX_MEMBERS, bossAttackReward, bossCycle, bossDamage, bossHpMax, bossLevel, bossName, bossSetup,
  guildCheckinReward, guildXpToNext,
} from '../../shared/heroes/guild.js';
import { EVENT_KINDS, SEED_EVENT } from '../../shared/heroes/events.js';
import { LOGIN7, LOGIN7_GRANT_HERO_DAY, MILESTONES, MILESTONE_BY_ID, STARTER_SUMMON, newbieBadge, newbieDone, type NewbieView } from '../../shared/heroes/newbie.js';
import { HERO_BY_ID } from '../../shared/heroes/heroes.js';

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

console.log('— Tháp / mốc ngày —');
{
  ok(JSON.stringify(towerStage(37)) === JSON.stringify(towerStage(37)) && towerStage(1).id === 't-1' && towerStage(100).id === 't-100', 'towerStage deterministic, id t-N');
  ok(towerStage(0).n === 1 && towerStage(999).n === TOWER_MAX_FLOOR, 'towerStage chặn tầng ngoài 1..100');
  let valid = true, mon = true, sizes = true, bossOk = true;
  let prevGold = -1, mono = true;
  for (let f = 1; f <= TOWER_MAX_FLOOR; f++) {
    const st = towerStage(f);
    if (st.n !== f || st.index !== f - 1 || st.waves.length !== (f % 10 === 0 ? 3 : 2) || st.chapter < 1 || st.chapter > 3 || st.level < 1 || st.level > 60 || st.diff <= 0) valid = false;
    for (const w of st.waves) {
      if (w.length < 2 || w.length > 5) sizes = false;
      for (const m of w) if (!MONSTERS.some((x) => x.id === m)) mon = false;
    }
    if (st.boss !== (f % 10 === 0) || (st.boss && st.waves[st.waves.length - 1][0] !== 'mk_chua')) bossOk = false;
    const r = towerReward(f);
    if (r.gold <= prevGold) mono = false;
    prevGold = r.gold;
  }
  ok(valid, '100 tầng đều dựng StageDef hợp lệ (đợt, chương, cấp, độ khó)');
  ok(sizes && mon, 'mọi đợt 2..5 quái, quái đều có trong MONSTERS');
  ok(bossOk, 'tầng bội 10 là boss (3 đợt, đợt cuối có mk_chua)');
  ok(mono, 'vàng thưởng tăng dần theo tầng');
  ok(towerReward(5).gearRolls === 1 && towerReward(10).gearRolls === 2 && towerReward(7).gearRolls === 0 && towerReward(10).stones === 10 && towerReward(5).gems === 50 && towerReward(10).gems === 100, 'thưởng mốc tầng 5/10');
  const d17 = Date.UTC(2030, 0, 15, 17, 0, 0);
  ok(dayKey(d17 - 1) + 1 === dayKey(d17) && dayKey(d17) === dayKey(d17 + 86_399_999) && dayKey(d17 + 86_400_000) === dayKey(d17) + 1, 'dayKey đổi đúng lúc 17:00 UTC (00:00 giờ VN)');
  ok(nextDayStart(d17 - 1) === d17 && nextDayStart(d17) === d17 + 86_400_000 && nextDayStart(d17 + 5000) === d17 + 86_400_000, 'nextDayStart = đầu ngày kế tiếp');
  ok(QUEST_DEFS.length >= 5 && new Set(QUEST_DEFS.map((q) => q.id)).size === QUEST_DEFS.length && SHOP_ITEMS.every((i) => i.limit > 0), 'định nghĩa nhiệm vụ / cửa hàng hợp lệ');
}

console.log('— cân bằng Tháp (báo cáo, không ép chặt) —');
{
  const teamAt = (lv: number, star: number) => STARTER_HEROES.map((id, i) => heroUnit(owned(id, lv, star), i));
  const floors = [1, 5, 10, 20, 30, 40, 50, 60, 80, 100];
  const need: Record<number, number> = {};
  for (const f of floors) {
    let lv = 1;
    for (; lv <= 60; lv++) {
      if (simulate(stageSetup(towerStage(f), teamAt(lv, Math.min(5, 1 + Math.floor(lv / 12))), 500 + f), [], true).win) break;
    }
    need[f] = lv;
  }
  console.log('  cấp tối thiểu của đội khởi đầu (sao theo cấp) để qua tầng:', floors.map((f) => `${f}:${need[f] > 60 ? '>60' : need[f]}`).join('  '));
  const wins100 = [1, 2, 3, 4, 5].filter((k) => simulate(stageSetup(towerStage(100), teamAt(60, 5), 900 + k), [], true).win).length;
  const wins10 = [1, 2, 3].filter((k) => simulate(stageSetup(towerStage(10), teamAt(1, 1), 700 + k), [], true).win).length;
  console.log(`  đội cấp 60, 5 sao, không trang bị thắng tầng 100: ${wins100}/5 seed; đội cấp 1 thắng tầng 10: ${wins10}/3 seed`);
  if (wins100 > 0) console.log('  CẢNH BÁO: tầng 100 bị đội cấp 60 5 sao không đồ hạ được (quá dễ)');
  if (need[10] > 40) console.log('  CẢNH BÁO: tầng 10 cần cấp > 40 (quá khó)');
  ok(need[1] <= 5, 'tầng 1 dễ (đội khởi đầu cấp ≤ 5 là qua)');
  ok(need[100] >= need[10], 'tầng cao khó hơn tầng thấp');
}

console.log('— đấu trường —');
{
  const ratings = [0, 100, 400, 800, 1000, 1500, 2000, 3000];
  let bounds = true;
  let mono = true;
  for (const mine of ratings) {
    for (const their of ratings) {
      const w = ratingDelta(true, mine, their);
      const l = ratingDelta(false, mine, their);
      if (w < 10 || w > 50 || l > -5 || l < -30) bounds = false;
      if (ratingDelta(true, mine, their + 50) < w || ratingDelta(false, mine, their + 50) < l) mono = false; // đối thủ mạnh hơn → thắng được nhiều hơn, thua mất ít hơn
    }
  }
  ok(bounds, 'ratingDelta: thắng ∈ [10,50], thua ∈ [-30,-5]');
  ok(mono, 'ratingDelta đơn điệu theo điểm đối thủ');
  ok(ratingDelta(true, 1000, 1000) === 25 && ratingDelta(false, 1000, 1000) === -15, 'ratingDelta cân bằng: +25 / -15');
  ok(arenaReward(true).gold > arenaReward(false).gold && arenaReward(false).gems === 0, 'arenaReward thắng > thua');
  let botOk = true;
  for (let r = 0; r <= 3000; r += 25) {
    for (const n of [0, 1, 2, 3, 4, 17, 99]) {
      const sq = botSquad(n, r);
      const ids = new Set(sq.map((h) => h.id));
      if (sq.length < 1 || sq.length > 5 || ids.size !== sq.length || sq.some((h) => !HEROES.some((d) => d.id === h.id) || h.level < 1 || h.level > 60 || h.star < 1 || h.star > 5)) botOk = false;
      if (JSON.stringify(sq) !== JSON.stringify(botSquad(n, r))) botOk = false;
    }
  }
  ok(botOk, 'botSquad hợp lệ + deterministic với điểm 0..3000 (1..5 tướng khác nhau, cấp ≤ 60)');
  ok(botSquad(0, 3000)[0].level === 60 && botSquad(0, 0)[0].level === 1, 'botSquad: cấp tăng theo điểm, chặn 1..60');
  const atk = starterTeam(5);
  const def = starterTeam(3);
  const setup = arenaSetup(atk, def, 77);
  ok(setup.seed === 77 && setup.player === atk && setup.waves.length === 1 && setup.waves[0].length === def.length && setup.waves[0].every((u) => u.side === 1) && atk.every((u) => u.side === 0), 'arenaSetup: đội phòng thủ side 1 một đợt, người tấn công side 0');
  ok(def.every((u) => u.side === 0), 'arenaSetup không sửa đội phòng thủ gốc');
  const run = (seed: number) => simulate(arenaSetup(starterTeam(20), starterTeam(1), seed), [], true);
  ok(run(5).win && JSON.stringify(run(5).events) === JSON.stringify(run(5).events), 'trận đấu trường deterministic, đội cấp cao thắng');
  ok(!simulate(arenaSetup(starterTeam(1), starterTeam(40), 5), [], true).win, 'đội yếu thua đội phòng thủ mạnh (hết giờ/gục = thua)');
}

console.log('— bang hội: boss —');
{
  const team = (lv: number) => STARTER_HEROES.map((id, i) => heroUnit(owned(id, lv, Math.max(1, Math.ceil((lv - 20) / 10))), i));
  ok(levelCapOf(Math.max(1, Math.ceil((60 - 20) / 10))) >= 60, 'star dùng cho cấp 60 đủ trần cấp');
  const s1 = bossSetup(3, 1, 999, team(10));
  const s2 = bossSetup(3, 1, 999, team(10));
  ok(JSON.stringify(s1) === JSON.stringify(s2) && s1.seed === 999 && s1.waves.length === 1 && s1.waves[0].length === 1, 'bossSetup deterministic, một boss một đợt');
  const boss = s1.waves[0][0];
  ok(boss.boss === true && boss.slot === 0 && boss.side === 1 && boss.name === bossName(1), 'boss: side 1, ô 0, cờ boss, tên theo chu kỳ');
  ok(bossSetup(1, 0, 1, team(1)).waves[0][0].stats.atk < bossSetup(10, 0, 1, team(1)).waves[0][0].stats.atk, 'boss mạnh dần theo cấp bang');
  const r = simulate(s1, [], true);
  const sumDmg = (pred: (tg: number) => boolean) => r.events.reduce((a2, e) => a2 + (e.k === 'dmg' && pred(e.tg) ? e.n : 0), 0);
  const onBoss = sumDmg((tg) => tg === BOSS_UID);
  ok(bossDamage(r.events) === onBoss && onBoss > 0, 'bossDamage = tổng dmg có tg = BOSS_UID (> 0)');
  ok(sumDmg((tg) => tg !== BOSS_UID) > 0 && bossDamage(r.events) < sumDmg(() => true), 'bossDamage bỏ qua sát thương lên người chơi');
  ok(bossDamage([{ t: 0, k: 'heal', u: BOSS_UID, tg: BOSS_UID, n: 5, hp: 1 }, { t: 0, k: 'die', u: 1 }]) === 0 && bossDamage([]) === 0, 'bossDamage chỉ cộng sự kiện dmg');
  ok(JSON.stringify(simulate(s1, [], true).events) === JSON.stringify(r.events), 'trận boss deterministic theo seed');
  ok(r.ticks > 0 && r.ticks <= BATTLE_MAX_TICKS, 'trận boss kết thúc trong giới hạn tick (hết giờ/gục là bình thường)');

  // chu kỳ: biên ngày VN (17:00 UTC) và biên 7 ngày
  const C0 = Date.UTC(2030, 0, 15, 17, 0, 0);
  ok(bossCycle(C0) === Math.floor(dayKey(C0) / BOSS_CYCLE_DAYS), 'bossCycle theo dayKey / 7');
  let flips = 0;
  for (let d = 0; d < 21; d++) if (bossCycle(C0 + (d + 1) * 86_400_000) !== bossCycle(C0 + d * 86_400_000)) flips++;
  ok(flips === 3, 'đổi chu kỳ đúng mỗi 7 ngày (3 lần trong 21 ngày)');
  const firstDayOfCycle = Array.from({ length: 21 }, (_, d) => C0 + d * 86_400_000).find((ms) => dayKey(ms) % BOSS_CYCLE_DAYS === 0)!;
  ok(bossCycle(firstDayOfCycle) === bossCycle(firstDayOfCycle - 1) + 1 && bossCycle(firstDayOfCycle + 6 * 86_400_000 + 3_600_000) === bossCycle(firstDayOfCycle), 'biên chu kỳ: 23:59 hôm trước = chu kỳ cũ, 00:00 = chu kỳ mới');
  ok(bossName(0) !== bossName(1) && bossName(3) === bossName(0), 'bossName xoay vòng');
  ok(bossHpMax(1) === 3_000_000 && bossHpMax(10) > bossHpMax(9) && bossHpMax(2) > bossHpMax(1), 'bossHpMax tăng theo cấp bang');
  ok(bossLevel(1) === 24 && bossLevel(10) === 60 && bossLevel(GUILD_MAX_LEVEL) <= 60, 'bossLevel chặn 60');
  let mono = true;
  for (let l = 1; l < GUILD_MAX_LEVEL; l++) {
    if (!(guildXpToNext(l + 1) > guildXpToNext(l))) mono = false;
    const a2 = guildCheckinReward(l);
    const b2 = guildCheckinReward(l + 1);
    if (!((b2.gold ?? 0) > (a2.gold ?? 0) && (b2.stones ?? 0) >= (a2.stones ?? 0) && (b2.tickets ?? 0) >= (a2.tickets ?? 0))) mono = false;
  }
  ok(mono, 'guildXpToNext / thưởng điểm danh tăng dần theo cấp');
  ok(bossAttackReward(0).gold! >= 300 && bossAttackReward(1e9).gold! <= 3300 && (bossAttackReward(20_000).stones ?? 0) === 2 && (bossAttackReward(19_999).stones ?? 0) === 0, 'bossAttackReward: có sàn/trần, đá từ 20k');

  // ---- báo cáo cân bằng (in ra; cảnh báo nếu lệch) ----
  console.log('  [cân bằng] sát thương MỘT trận boss của đội khởi đầu (4 tướng, auto, TB 3 seed) — theo cấp bang 1..10 của boss');
  const fightDmg = (lv: number, gl: number) => {
    let sum = 0;
    for (const seed of [1, 2, 3]) sum += bossDamage(simulate(bossSetup(gl, 0, seed, team(lv)), [], true).events);
    return Math.round(sum / 3);
  };
  const table: Record<number, Record<number, number>> = {};
  for (const lv of [1, 20, 40, 60]) {
    table[lv] = {};
    for (let gl = 1; gl <= 10; gl++) table[lv][gl] = fightDmg(lv, gl);
    console.log(`    tướng cấp ${String(lv).padStart(2)}: ` + Object.values(table[lv]).map((d) => String(d).padStart(7)).join(' '));
  }
  console.log('    bossHpMax(1..10): ' + Array.from({ length: 10 }, (_, i) => String(Math.round(bossHpMax(i + 1))).padStart(8)).join(' '));
  const weekFull = GUILD_MAX_MEMBERS * BOSS_ATTACKS_PER_DAY * BOSS_CYCLE_DAYS * table[60][1];
  const oneSquadDays = bossHpMax(1) / (BOSS_ATTACKS_PER_DAY * table[1][1]);
  console.log(`    bang đầy ${GUILD_MAX_MEMBERS} người cấp 60 đánh boss bang cấp 1 cả tuần: ${weekFull} sát thương / ${bossHpMax(1)} máu (${(weekFull / bossHpMax(1)).toFixed(2)}x)`);
  console.log(`    MỘT đội cấp 1 hạ boss bang cấp 1 mất ${oneSquadDays.toFixed(1)} ngày (${BOSS_ATTACKS_PER_DAY} lượt/ngày × ${table[1][1]})`);
  if (weekFull < bossHpMax(1)) console.log('  ⚠ CẢNH BÁO: bang đầy 30 người cấp 60 KHÔNG hạ nổi boss cấp 1 trong tuần');
  if (oneSquadDays < 3) console.log('  ⚠ CẢNH BÁO: MỘT đội cấp 1 hạ được boss cấp 1 dưới 3 ngày');
  ok(Object.values(table).every((row) => Object.values(row).every((d) => d > 0)), 'mọi cấp đều gây được sát thương lên boss');
  ok(table[60][1] >= table[1][1], 'đội cấp cao gây sát thương không thấp hơn đội cấp 1');
  ok(EVENT_KINDS.length === 8 && SEED_EVENT.objectives.every((o) => (EVENT_KINDS as readonly string[]).includes(o.kind)), 'EVENT_KINDS đủ 8 loại, sự kiện mẫu dùng loại hợp lệ');
}

console.log('— Tân thủ (dữ liệu + hàm thuần) —');
{
  ok(LOGIN7.length === 7 && LOGIN7.every((d, i) => d.day === i + 1), 'LOGIN7: đúng 7 ngày, theo thứ tự 1..7');
  const goodReward = (r: { wallet?: Record<string, number>; shards?: { hero: string; n: number }; gear?: string[] }) =>
    (!r.shards || (!!HERO_BY_ID[r.shards.hero] && r.shards.n > 0)) && (r.gear ?? []).every((g) => !!GEAR_BY_ID[g]) && Object.values(r.wallet ?? {}).every((v) => Number.isInteger(v) && v > 0);
  ok(LOGIN7.every((d) => goodReward(d.reward)), 'LOGIN7: tướng/trang bị trong thưởng đều tồn tại, ví là số nguyên dương');
  ok(LOGIN7_GRANT_HERO_DAY === 7 && LOGIN7[6].reward.shards?.hero === 'hau_vuong' && LOGIN7[6].reward.shards.n === 80 && HERO_BY_ID['hau_vuong'].rarity === 'UR', 'ngày 7 = 80 mảnh Hầu Vương (UR)');
  ok(new Set(MILESTONES.map((m) => m.id)).size === MILESTONES.length, 'MILESTONES: id không trùng');
  ok(MILESTONES.every((m) => MILESTONE_BY_ID[m.id] === m && m.target >= 1 && goodReward(m.reward)), 'MILESTONES: target ≥ 1, thưởng hợp lệ, MILESTONE_BY_ID khớp');
  ok(STARTER_SUMMON.count === 10 && BANNER_BY_ID[STARTER_SUMMON.banner] !== undefined, 'STARTER_SUMMON: 10 lượt, banner tồn tại');
  const view = (over: Partial<NewbieView> & { login?: Partial<NewbieView['login']> } = {}): NewbieView => ({
    login: { claimed: 0, canClaim: false, next: 1, ...over.login },
    milestones: over.milestones ?? MILESTONES.map((m) => ({ id: m.id, progress: 0, claimed: false })),
    starterUsed: over.starterUsed ?? true,
  });
  ok(newbieBadge(view()) === 0 && !newbieDone(view()), 'badge 0 khi không có gì nhận được; chưa done');
  ok(newbieBadge(view({ starterUsed: false })) === 1, 'badge +1 khi chưa dùng lượt quay khởi đầu');
  ok(newbieBadge(view({ login: { canClaim: true } })) === 1, 'badge +1 khi điểm danh nhận được');
  ok(newbieBadge(view({ login: { canClaim: true, next: 8, claimed: 7 } })) === 0, 'đã nhận đủ 7 ngày: canClaim cũng không tính');
  const ms = MILESTONES.map((m, i) => ({ id: m.id, progress: i < 3 ? m.target : 0, claimed: i === 0 }));
  ok(newbieBadge(view({ milestones: ms })) === 2, 'badge đếm mốc đủ điều kiện chưa nhận (bỏ mốc đã nhận)');
  const full = view({ login: { claimed: 7, next: 8 }, milestones: MILESTONES.map((m) => ({ id: m.id, progress: m.target, claimed: true })) });
  ok(newbieDone(full) && newbieBadge(full) === 0, 'newbieDone khi nhận hết mọi thứ');
  ok(!newbieDone({ ...full, starterUsed: false }) && !newbieDone({ ...full, login: { ...full.login, next: 7 } }) && !newbieDone({ ...full, milestones: full.milestones.map((m, i) => ({ ...m, claimed: i !== 0 })) }), 'newbieDone sai nếu còn lượt khởi đầu / ngày điểm danh / mốc chưa nhận');
}

console.log(fails ? `\n${fails} LỖI` : '\nTất cả đạt');
process.exit(fails ? 1 : 0);
