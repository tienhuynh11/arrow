// Kiểm thử lõi game thẻ tướng: engine trận (deterministic), gacha (tỉ lệ + pity), ải, AFK, thể lực.
// Chạy: cd server && npx tsx test/heroesCore.test.ts
import { Battle, simulate, heroUnit, advantage, type BattleEvent, type BattleSetup, type UnitInit } from '../../shared/heroes/battle.js';
import { ARENA_LEN, BOSS_MOVE, BOSS_RANGE, FRONT_X, ALLY_SEP, MIN_SEP, MOVE_EVENT_EVERY, ROLE_MOVE, ROLE_RANGE, ROW_GAP, startX, statOf } from '../../shared/heroes/combat.js';
import { arenaReward, arenaSetup, botSquad, ratingDelta } from '../../shared/heroes/arena.js';
import { AFK_CAP_MS, BATTLE_MAX_TICKS, STAMINA_MAX, rowOfSlot } from '../../shared/heroes/config.js';
import { monsterStatsAt, powerOf, statsAt } from '../../shared/heroes/formulas.js';
import { BANNER_BY_ID, NEW_PITY, SSR_PITY, UR_PITY, summon, type PityState } from '../../shared/heroes/gacha.js';
import { GEAR_BY_ID, GEAR_DEFS, MAX_GEAR_LEVEL, STARTER_GEAR, enhanceCost, gearStats, rollGearDrops, salvageStones, sumGear } from '../../shared/heroes/gear.js';
import { HEROES, STARTER_HEROES } from '../../shared/heroes/heroes.js';
import { mulberry32 } from '../../shared/heroes/rng.js';
import { SKILL_LIST, skillOf } from '../../shared/heroes/skills.js';
import { STAGES, afkReward, staminaNow, stageSetup, starsOf } from '../../shared/heroes/stages.js';
import type { OwnedHero, Role, Stats } from '../../shared/heroes/types.js';
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
import { MAX_ACCOUNT_LEVEL, SQUAD_COUNT, SQUAD_SIZE } from '../../shared/heroes/config.js';
import { LEVEL_UNLOCKS, SLOT_GEMS, SLOT_LEVEL, SQUAD_LEVEL, levelReward, slotsByLevel, slotsOpen, squadsOpen, unlocksBetween } from '../../shared/heroes/progression.js';
import { ACHIEVEMENTS, ACH_BY_ID, achBadge, achClaimable, type AchState } from '../../shared/heroes/achievements.js';
import { newState, openSlotIds, padSquad, levelClaimable, opBattle } from '../src/heroes/rules.js';
import { achProgress, achList, claimableLevels } from '../src/heroes/progress.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};

const owned = (id: string, level = 1, star = 1): OwnedHero => ({ id, level, star, shards: 0 });
const STARTER3 = STARTER_HEROES.slice(0, 3); // tài khoản mới: 3 tướng đầu vào đội hình
const starterTeam = (level = 1) => STARTER3.map((id, i) => heroUnit(owned(id, level), i));

console.log('— dữ liệu —');
ok(HEROES.length === 12, '12 tướng');
ok(HEROES.every((h) => h.skills.every((s) => !!skillOf(s))), 'mọi tướng trỏ tới kỹ năng có thật');
ok(STAGES.length === 30 && STAGES[29].boss, '30 ải, ải cuối là boss');
ok(STAGES.every((s) => s.waves.length === 1 && s.waves[0].length >= 3 && s.waves[0].length <= 6), 'mỗi ải đúng 1 đợt, 3–6 quái');
ok(STAGES.every((s) => s.boss === (s.n === 5 || s.n === 10) && (!s.boss || s.waves[0][0] === 'mk_chua')), 'boss ở ải 5 và 10 mỗi chương (mk_chua ở ô đầu)');
ok(STAGES.find((s) => s.id === '1-5')!.diff < STAGES.find((s) => s.id === '1-10')!.diff * 0 + 100 && STAGES.find((s) => s.id === '3-5')!.diff < STAGES.find((s) => s.id === '3-10')!.diff, 'boss ải 5 nhẹ hơn boss ải 10 cùng chương (3)');
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
      const team = STARTER3.map((id, i) => heroUnit(owned(id, lv, Math.min(5, 1 + Math.floor(lv / 12))), i));
      if (simulate(stageSetup(st, team, 100 + st.index), [], true).win) break;
    }
    need.push(lv);
  }
  console.log('  cấp cần thiết theo ải:', need.join(' '));
  ok(need[0] === 1, 'ải 1-1 thắng ngay ở cấp 1');
  ok(need.every((n) => n <= 60), 'mọi ải thắng được ở cấp ≤ 60 với đội tân binh');
  ok(need[29] > need[0] + 15, 'độ khó tăng dần qua chiến dịch');
  const avg = (from: number, to: number) => need.slice(from, to).reduce((x, y) => x + y, 0) / (to - from);
  ok(avg(0, 10) < avg(10, 20) && avg(10, 20) < avg(20, 30), `cấp trung bình mỗi chương tăng dần (${avg(0, 10).toFixed(1)} < ${avg(10, 20).toFixed(1)} < ${avg(20, 30).toFixed(1)})`);
  ok([1, 2].every((c) => need[c * 10 + 4] > need[c * 10 + 3] && need[c * 10 + 9] > need[c * 10 + 8]) && need[4] > need[3] && need[9] > need[8], 'ải boss (5 và 10) là bước nhảy rõ rệt so với ải ngay trước nhưng vẫn thắng được');
  ok(need[9] <= 30 && need[4] <= 12, 'boss chương 1 vẫn trong tầm với đội đang lên cấp (ải 1-5 ≤ 12, 1-10 ≤ 30)');
}

console.log('— vị trí / tầm đánh / di chuyển / tốc đánh —');
{
  // đơn vị thử nghiệm: máu rất lớn, chỉ số đặt tay, kỹ năng quái (đòn thường + chủ động + tuyệt kỹ)
  const tu = (side: 0 | 1, slot: number, role: Role, st: Partial<Stats> = {}, over: Partial<UnitInit> = {}): UnitInit => ({
    key: 'test', name: 'T', side, slot, element: 'forest', role,
    stats: { hp: 1_000_000, atk: 100, def: 0, spd: 100, ...st }, skills: ['m_basic', 'm_a1', 'm_ult'], ...over,
  });
  const run = (setup: BattleSetup, ticks: number, each?: (b: Battle, ev: BattleEvent[]) => void) => {
    const b = new Battle(setup);
    const events: BattleEvent[] = [];
    for (let i = 0; i < ticks && !b.done; i++) {
      const ev = b.step();
      events.push(...ev);
      each?.(b, ev);
    }
    return { b, events };
  };
  const acts = (events: BattleEvent[], uid: number) => events.filter((e) => e.k === 'act' && e.u === uid);

  // ---- vị trí ban đầu ----
  const b0 = new Battle(stageSetup(STAGES[0], starterTeam(), 1));
  const snap0 = b0.snapshot();
  ok(snap0.every((u) => u.side === 0 && u.x === startX(0, u.slot) && Math.abs(u.x - (FRONT_X - rowOfSlot(u.slot) * ROW_GAP)) === 225) && snap0.length === 3, 'vị trí ban đầu người chơi: hàng trước 3600, mỗi hàng sau lùi 900, mỗi ô lệch ±225 quanh hàng');
  const ev1 = b0.step();
  const wv = ev1.find((e) => e.k === 'wave');
  ok(!!wv && wv.k === 'wave' && wv.xs!.length === wv.units.length && wv.units.every((uid, i) => b0.pos(uid) >= 0 && wv.xs![i] === startX(1, b0.unit(uid)!.init.slot) && wv.xs![i] === ARENA_LEN - startX(0, b0.unit(uid)!.init.slot)), 'quái xuất phát đối xứng (ARENA_LEN - x), sự kiện wave mang theo xs');
  const frontP = Math.max(...b0.side(0).map((u) => u.x));
  const frontE = Math.min(...b0.side(1).map((u) => u.x));
  ok(frontE - frontP >= 4150 && frontE - frontP <= 4350, `hai hàng trước cách xa nhau ~4350 (sau tick 1: ${frontE - frontP})`);
  {
    // so le: mọi cặp đồng minh ban đầu cách nhau ≥ ALLY_SEP, hai ô cùng hàng khác x
    const all = [0, 1, 2, 3, 4, 5].map((sl) => startX(0, sl)).sort((a, c) => a - c);
    ok(all.every((x, i) => i === 0 || x - all[i - 1] >= ALLY_SEP) && startX(0, 0) !== startX(0, 1) && startX(0, 2) !== startX(0, 3), `6 ô xuất phát cách nhau ≥ ${ALLY_SEP}, hai ô cùng hàng khác x`);
    ok(b0.pos(9999) === -1, 'pos(uid lạ) = -1');
  }
  ok(statOf(statsAt('warrior', 'R', 1, 1), 'aspd') === 100 && ROLE_RANGE.archer > ROLE_RANGE.mage && ROLE_RANGE.mage > ROLE_RANGE.healer && ROLE_RANGE.healer > ROLE_RANGE.warrior && ROLE_MOVE.warrior >= ROLE_MOVE.tank, 'bảng tầm đánh: xạ thủ > pháp sư > hồi máu > cận chiến; chiến binh đi nhanh hơn đỡ đòn');

  // ---- di chuyển đơn điệu, không xuyên qua nhau ----
  {
    const setup = stageSetup(STAGES[9], starterTeam(10), 33);
    const last = new Map<number, number>();
    let mono = true, sep = true, inBounds = true, firstDmg = -1;
    const { events } = run(setup, 400, (b, ev) => {
      if (firstDmg < 0 && ev.some((e) => e.k === 'dmg')) firstDmg = b.tick;
      let pMax = -1, eMin = ARENA_LEN + 1;
      for (const u of b.units) {
        if (!u.alive) continue;
        const prev = last.get(u.uid);
        if (prev !== undefined && (u.init.side === 0 ? u.x < prev : u.x > prev)) mono = false;
        last.set(u.uid, u.x);
        if (u.x < 0 || u.x > ARENA_LEN) inBounds = false;
        if (u.init.side === 0) pMax = Math.max(pMax, u.x);
        else eMin = Math.min(eMin, u.x);
      }
      if (pMax >= 0 && eMin <= ARENA_LEN && eMin - pMax < MIN_SEP) sep = false;
    });
    ok(mono, 'mỗi đơn vị chỉ đi TỚI phía địch (x đơn điệu), không lùi');
    ok(sep && inBounds, `không bao giờ xuyên qua tuyến địch (cách ≥ ${MIN_SEP}) và luôn trong sân`);
    ok(firstDmg > 31, `chưa ai trúng đòn trong lúc tiến lại gần (đòn đầu ở tick ${firstDmg})`);
    const mv = events.filter((e) => e.k === 'move');
    ok(mv.length > 0, 'có sự kiện move');
  }

  // ---- cận chiến gặp nhau đúng thời điểm dự kiến ----
  const meleeDuel = (seed: number) => run({ seed, player: [tu(0, 0, 'warrior')], waves: [[tu(1, 0, 'warrior', { atk: 1 })]] }, 400);
  {
    const { events, b } = meleeDuel(5);
    const first = acts(events, 0)[0] as Extract<BattleEvent, { k: 'act' }>;
    // hai bên cùng tiến ROLE_MOVE.warrior mỗi tick tới khi cách nhau đúng tầm: ceil((ARENA_LEN - 2 * startX(0, 0) - 900) / (2 * 40)) tick
    const meet = Math.ceil((ARENA_LEN - 2 * startX(0, 0) - ROLE_RANGE.warrior) / (2 * ROLE_MOVE.warrior));
    ok(!!first && first.t >= meet && first.t <= meet + 41, `cận chiến vào tầm ở tick ${meet}, ra đòn đầu ở tick ${first?.t} (≤ ${meet + 41})`);
    ok(Math.abs(b.pos(0) - b.pos(10)) === ROLE_RANGE.warrior && first.ax === first.tx[0] - ROLE_RANGE.warrior, `hai cận chiến dừng đúng tầm ${ROLE_RANGE.warrior} và act mang ax/tx`);
    ok(meleeDuel(5).events.length === events.length, 'trận thử lặp lại cho cùng số sự kiện');
  }

  // ---- đồng minh giãn cách (ALLY_SEP), tất định ----
  {
    const mk = () => ({ seed: 9, player: [tu(0, 0, 'warrior'), tu(0, 1, 'warrior')], waves: [[tu(1, 0, 'tank', { atk: 1 })]] });
    const r1 = run(mk(), 200);
    const r2 = run(mk(), 200);
    const xs = r1.b.side(0).map((u) => u.x);
    ok(xs.length === 2 && Math.abs(xs[0] - xs[1]) >= ALLY_SEP, `hai chiến binh cùng hàng đứng cách nhau ≥ ${ALLY_SEP} sau khi vào tầm (${Math.abs(xs[0] - xs[1])})`);
    ok(r1.events.length === r2.events.length && JSON.stringify(r1.events) === JSON.stringify(r2.events), 'giãn cách đồng minh tất định');
  }

  // ---- đánh xa ra đòn sớm hơn cận chiến ----
  {
    const firstOf = (role: Role) => {
      const { events } = run({ seed: 5, player: [tu(0, 0, role)], waves: [[tu(1, 0, 'warrior', { atk: 1 })]] }, 400);
      return (acts(events, 0)[0] as Extract<BattleEvent, { k: 'act' }>).t;
    };
    const tm = firstOf('warrior'), ta = firstOf('archer'), tg = firstOf('mage');
    ok(ta < tm && tg < tm && ta <= tg, `xạ thủ (tick ${ta}) và pháp sư (${tg}) ra đòn sớm hơn chiến binh (${tm})`);
  }

  // ---- ngoài tầm thì không ra đòn, trong tầm thì có ----
  {
    const frozen = (range: number) => run({ seed: 3, player: [tu(0, 0, 'warrior', {}, { moveSpd: 0, range })], waves: [[tu(1, 0, 'warrior', { atk: 1 }, { moveSpd: 0, range })]] }, 600);
    ok(acts(frozen(4000).events, 0).length === 0 && acts(frozen(4000).events, 10).length === 0, 'đứng yên, cách 4800 > tầm 4000: cả hai không ra đòn nào');
    ok(acts(frozen(4900).events, 0).length > 5 && acts(frozen(4900).events, 10).length > 5, 'đứng yên, tầm 4900 ≥ khoảng cách: cả hai ra đòn đều');
    // mọi đòn đơn mục tiêu gây sát thương đều nằm trong tầm của người đánh
    const { b, events } = run(stageSetup(STAGES[14], starterTeam(15), 77), BATTLE_MAX_TICKS);
    let outRange = 0, singles = 0;
    for (const e of events) {
      if (e.k !== 'act') continue;
      const sk = skillOf(e.s);
      if (sk.type !== 'dmg' || sk.target === 'enemyAll') continue;
      singles++;
      if (Math.abs(e.ax - e.tx[0]) > b.unit(e.u)!.range) outRange++;
    }
    ok(singles > 20 && outRange === 0, `${singles} đòn đơn mục tiêu, đều trong tầm người đánh`);
  }

  // ---- đánh xa đứng sau tuyến cận chiến ----
  {
    const setup: BattleSetup = { seed: 8, player: [tu(0, 0, 'tank', { hp: 10_000_000 }), tu(0, 4, 'mage', { hp: 10_000_000 })], waves: [[tu(1, 0, 'tank', { atk: 1 }, { moveSpd: 0 })]] };
    let behind = true;
    run(setup, 300, (b) => {
      if (b.unit(1)!.x > b.unit(0)!.x) behind = false;
    });
    ok(behind, 'pháp sư không bao giờ vượt qua tuyến cận chiến của phe mình');
  }

  // ---- tốc đánh ----
  {
    const count = (aspd: number | undefined) => {
      const { events } = run({ seed: 11, player: [tu(0, 0, 'warrior', aspd === undefined ? {} : { aspd }, { moveSpd: 0, range: 6000 })], waves: [[tu(1, 0, 'warrior', { atk: 1 }, { moveSpd: 0, range: 6000 })]] }, 2000);
      return acts(events, 0).length;
    };
    const a100 = count(100), a150 = count(150), a200 = count(200), aDef = count(undefined);
    console.log(`  tốc đánh: số đòn trong 2000 tick — aspd 100: ${a100}, 150: ${a150}, 200: ${a200}`);
    ok(a100 === aDef, 'thiếu aspd = mặc định 100');
    ok(Math.abs(a150 / a100 - 1.5) <= 0.1 && Math.abs(a200 / a100 - 2) <= 0.1, 'aspd tỉ lệ thuận với số đòn (±10%)');
  }

  // ---- bạo kích / sát thương bạo kích ----
  {
    const six = (st: Partial<Stats>) => ({ seed: 21, player: [0, 1, 2, 3, 4, 5].map((s) => tu(0, s, 'warrior', { aspd: 800, ...st }, { moveSpd: 0, range: 7000 })), waves: [[tu(1, 0, 'warrior', { atk: 1 }, { moveSpd: 0, range: 7000 })]] });
    const dmgs = (st: Partial<Stats>) => run(six(st), 3000).events.filter((e): e is Extract<BattleEvent, { k: 'dmg' }> => e.k === 'dmg' && e.u < 6);
    const rate = (st: Partial<Stats>) => {
      const d = dmgs(st);
      return { n: d.length, r: d.filter((e) => e.crit).length / d.length };
    };
    const c0 = rate({ crit: 0 }), c50 = rate({ crit: 50 }), c100 = rate({ crit: 100 }), cDef = rate({});
    console.log(`  bạo kích: crit 0 → ${(c0.r * 100).toFixed(1)}%, 50 → ${(c50.r * 100).toFixed(1)}%, 100 → ${(c100.r * 100).toFixed(1)}%, mặc định → ${(cDef.r * 100).toFixed(1)}% (${c50.n} đòn)`);
    ok(c50.n > 3000 && c0.r === 0 && c100.r === 1 && Math.abs(c50.r - 0.5) < 0.03 && Math.abs(cDef.r - 0.1) < 0.03, 'tỉ lệ bạo kích khớp chỉ số crit (mẫu lớn), mặc định 10%');
    const total = (st: Partial<Stats>) => dmgs({ crit: 100, ...st }).reduce((a2, e) => a2 + e.n, 0);
    const d150 = total({ critDmg: 150 }), d300 = total({ critDmg: 300 });
    ok(Math.abs(d300 / d150 - 2) < 0.03, `critDmg 300 gây gấp đôi critDmg 150 khi luôn bạo kích (${(d300 / d150).toFixed(3)}x)`);
    ok(total({}) === d150, 'thiếu critDmg = mặc định 150');
  }

  // ---- hút máu ----
  {
    const fight = (ls: number | undefined) => run({
      seed: 4,
      player: [tu(0, 0, 'warrior', { hp: 100_000, atk: 400, ...(ls === undefined ? {} : { lifesteal: ls }) }, { moveSpd: 0, range: 6000 })],
      waves: [[tu(1, 0, 'warrior', { atk: 300 }, { moveSpd: 0, range: 6000 })]],
    }, 1200);
    const f50 = fight(50), f0 = fight(undefined);
    const self = (evs: BattleEvent[]) => evs.filter((e): e is Extract<BattleEvent, { k: 'heal' }> => e.k === 'heal' && e.u === 0 && e.tg === 0);
    const heals = self(f50.events);
    let sum = 0, okEach = true;
    for (const h of heals) {
      sum += h.n;
      const d = f50.events.filter((e): e is Extract<BattleEvent, { k: 'dmg' }> => e.k === 'dmg' && e.u === 0 && e.t === h.t);
      if (!d.length || h.n > Math.floor(d[d.length - 1].n / 2) || h.hp > 100_000) okEach = false;
    }
    const dealt = f50.events.reduce((a2, e) => a2 + (e.k === 'dmg' && e.u === 0 ? e.n : 0), 0);
    ok(heals.length > 5 && okEach && sum <= Math.floor(dealt / 2) && self(f0.events).length === 0, `hút máu 50%: ${heals.length} lần hồi tổng ${sum} (≤ nửa ${dealt} sát thương gây ra); không có chỉ số thì không hồi`);
    ok(f50.b.unit(0)!.hp > f0.b.unit(0)!.hp, `người hút máu còn nhiều máu hơn (${f50.b.unit(0)!.hp} > ${f0.b.unit(0)!.hp})`);
  }

  // ---- tất định + phát lại ----
  {
    const setup = stageSetup(STAGES[8], starterTeam(10), 2024);
    const r1 = simulate(setup, [], true), r2 = simulate(setup, [], true);
    const moves = (r: { events: BattleEvent[] }) => JSON.stringify(r.events.filter((e) => e.k === 'move'));
    ok(moves(r1) === moves(r2) && moves(r1).length > 2 && JSON.stringify(r1) === JSON.stringify(r2), 'vị trí (sự kiện move) và toàn bộ trận giống hệt qua hai lần chạy');
    // hai Battle chạy song song, so ảnh chụp vị trí mỗi 7 tick
    const ba = new Battle(setup), bb = new Battle(setup);
    ba.setAuto(true);
    bb.setAuto(true);
    let same = true;
    while (!ba.done) {
      ba.step();
      bb.step();
      if (ba.tick % 7 === 0 && JSON.stringify(ba.snapshot()) !== JSON.stringify(bb.snapshot())) same = false;
    }
    ok(same && ba.done === bb.done && ba.tick === bb.tick, 'ảnh chụp vị trí giống nhau từng tick giữa hai Battle');
    // chơi tay (input) rồi simulate phát lại: sự kiện + vị trí cuối trùng khớp
    const live = new Battle(stageSetup(STAGES[3], starterTeam(5), 4242));
    const inputs: { tick: number; ult?: number }[] = [];
    const evs: BattleEvent[] = [];
    while (!live.done) {
      for (const u of live.side(0)) if (live.canUlt(u.uid)) {
        inputs.push({ tick: live.tick, ult: u.uid });
        live.ult(u.uid);
      }
      evs.push(...live.step());
    }
    const rep = simulate(stageSetup(STAGES[3], starterTeam(5), 4242), inputs);
    ok(inputs.length > 0 && JSON.stringify(rep.events) === JSON.stringify(evs), `phát lại simulate(input) trùng khớp TỪNG sự kiện với chạy trực tiếp (${inputs.length} lần bấm, ${evs.length} sự kiện)`);
  }

  // ---- tuyệt kỹ bằng tay khi đang tiến lại gần ----
  {
    const b = new Battle(stageSetup(STAGES[0], starterTeam(5), 9));
    for (let i = 0; i < 40; i++) b.step();
    const ULT = 1; // Lính Rừng: tuyệt kỹ gây sát thương diện rộng
    ok(!b.units.some((u) => u.hp < u.maxHp), 'tick 40: hai bên vẫn đang tiến, chưa ai mất máu');
    b.unit(ULT)!.energy = 100;
    ok(b.canUlt(ULT), 'đủ năng lượng thì bấm được tuyệt kỹ dù chưa giáp mặt');
    b.ult(ULT);
    const ev = b.step();
    const ult = ev.find((e) => e.k === 'act' && e.u === ULT);
    ok(!!ult && ult.k === 'act' && skillOf(ult.s).kind === 'ult' && ev.some((e) => e.k === 'dmg' && e.u === ULT), 'tuyệt kỹ bấm lúc đang tiến vẫn tung ra và gây sát thương');
  }

  // ---- luôn kết thúc, số sự kiện move bị chặn ----
  {
    const stuck = simulate({ seed: 1, player: [tu(0, 0, 'healer', {}, { moveSpd: 0, range: 100 })], waves: [[tu(1, 0, 'healer', {}, { moveSpd: 0, range: 100 })]] }, [], true);
    ok(!stuck.win && stuck.ticks === BATTLE_MAX_TICKS && stuck.events[stuck.events.length - 1].k === 'end', 'hai bên không thể chạm nhau: hết giờ = thua, dừng đúng BATTLE_MAX_TICKS');
    const full = simulate(stageSetup(STAGES[29], starterTeam(40), 5), [], true);
    const per = new Map<number, number>();
    for (const e of full.events) if (e.k === 'move') per.set(e.u, (per.get(e.u) ?? 0) + 1);
    const cap = Math.ceil(full.ticks / MOVE_EVENT_EVERY) + 2;
    ok(per.size > 0 && [...per.values()].every((n) => n <= cap), `sự kiện move mỗi đơn vị ≤ ticks/${MOVE_EVENT_EVERY}+2 (tối đa ${Math.max(...per.values())} / ${cap})`);
    ok(full.events.filter((e) => e.k === 'move').every((e) => e.k === 'move' && e.x >= 0 && e.x <= ARENA_LEN && Number.isInteger(e.x)), 'toạ độ move là số nguyên trong sân');
    const bossB = new Battle(bossSetup(1, 0, 1, starterTeam(10)));
    bossB.step();
    ok(bossB.unit(BOSS_UID)!.range === BOSS_RANGE && bossB.unit(BOSS_UID)!.moveSpd === BOSS_MOVE && BOSS_MOVE < ROLE_MOVE.tank, 'boss: tầm 1100, đi chậm hơn đỡ đòn');
  }

  // ---- chỉ số mặc định + trang bị ----
  {
    const arch = statsAt('archer', 'R', 1, 1), tank = statsAt('tank', 'R', 1, 1), arch5 = statsAt('archer', 'R', 1, 5);
    ok(statOf(arch, 'aspd') > statOf(tank, 'aspd') && statOf(arch, 'crit') > statOf(tank, 'crit'), 'xạ thủ đánh nhanh/bạo kích hơn đỡ đòn');
    ok(statOf(arch5, 'aspd') > statOf(arch, 'aspd') && statOf(arch5, 'crit') > statOf(arch, 'crit') && statOf(arch5, 'critDmg') > statOf(arch, 'critDmg'), 'lên sao tăng nhẹ tốc đánh / bạo kích / sát thương bạo kích');
    ok(powerOf({ ...arch, aspd: 130 }) > powerOf(arch) && powerOf({ hp: 1, atk: 1, def: 1, spd: 1 }) === powerOf({ hp: 1, atk: 1, def: 1, spd: 1, aspd: 100, crit: 10, critDmg: 150, lifesteal: 0 }), 'lực chiến có thêm một phần nhỏ cho tốc đánh (mặc định không đổi)');
    const m = monsterStatsAt('archer', 10, 100);
    ok(statOf(m, 'aspd') === statOf(statsAt('archer', 'R', 10, 1), 'aspd'), 'quái có chỉ số chiến đấu theo vai trò');
    const hero = owned('linh_rung');
    const base = heroUnit(hero, 0);
    const wUR = heroUnit(hero, 0, sumGear([{ def: 'weapon_forest_UR', level: 0 }]));
    const wUR10 = heroUnit(hero, 0, sumGear([{ def: 'weapon_forest_UR', level: 10 }]));
    ok(statOf(wUR.stats, 'aspd') === statOf(base.stats, 'aspd') + 12 && statOf(wUR10.stats, 'aspd') === statOf(base.stats, 'aspd') + 24 && wUR.stats.atk > base.stats.atk, 'vũ khí UR cộng +12 tốc đánh (cấp 10: +24) vào đơn vị ra trận');
    const acc = heroUnit(hero, 0, sumGear([{ def: 'accessory_water_SSR', level: 0 }, { def: 'helmet_earth_UR', level: 0 }]));
    ok(statOf(acc.stats, 'crit') === statOf(base.stats, 'crit') + 6 && statOf(acc.stats, 'lifesteal') === 2, 'phụ kiện SSR +6 bạo kích, mũ UR +2 hút máu');
    ok(statOf(heroUnit(hero, 0, sumGear([{ def: 'weapon_forest_R', level: 3 }, { def: 'accessory_forest_R', level: 3 }])).stats, 'aspd') === statOf(base.stats, 'aspd'), 'phẩm R không cộng chỉ số mới');
    // cùng seed, vũ khí tốc đánh cao ra nhiều đòn hơn
    const cnt = (u: UnitInit) => acts(run({ seed: 6, player: [{ ...u, range: 6000, moveSpd: 0 }], waves: [[tu(1, 0, 'warrior', { atk: 1 }, { moveSpd: 0, range: 6000 })]] }, 1600).events, 0).length;
    ok(cnt(wUR10) > cnt(base), `tướng cầm vũ khí UR cấp 10 ra đòn nhiều hơn (${cnt(wUR10)} > ${cnt(base)} đòn / 1600 tick)`);
  }

  // ---- server (opBattle) chấm đúng như client chạy ----
  {
    const st = newState(1, Date.now());
    const seed = 31337;
    const units = st.squads[0].map((id, slot) => (id ? heroUnit(st.heroes[id], slot, sumGear([])) : null)).filter((u): u is UnitInit => !!u);
    const client = simulate(stageSetup(STAGES[0], units, seed), [], true);
    opBattle(st, '1-1', 0, seed, [], true, () => 0);
    ok(st.runs[0].ticks === client.ticks && st.runs[0].win === client.win && client.win, `opBattle chấm trùng kết quả client (thắng, ${client.ticks} tick)`);
  }

  // ---- đấu trường ----
  {
    const bot = (rating: number, n = 0) => botSquad(n, rating).map((h, i) => heroUnit(h, i));
    let winStarter = 0, winWeak = 0;
    for (let n = 0; n < 6; n++) {
      if (simulate(arenaSetup(starterTeam(1), bot(1000, n), 100 + n), [], true).win) winStarter++;
      if (simulate(arenaSetup([heroUnit(owned('thay_thuoc'), 0)], bot(1000, n), 200 + n), [], true).win) winWeak++;
    }
    console.log(`  [cân bằng] đấu trường, bot 1000 điểm (6 bot): đội khởi đầu cấp 1 thắng ${winStarter}/6; 1 thầy thuốc cấp 1 thắng ${winWeak}/6`);
    ok(winStarter >= 4, 'đội khởi đầu thắng đa số bot 1000 điểm');
    ok(winWeak === 0, 'đội yếu (1 thầy thuốc cấp 1) vẫn thua bot 1000 điểm');
  }
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
    if (st.n !== f || st.index !== f - 1 || st.waves.length !== 1 || st.chapter < 1 || st.chapter > 3 || st.level < 1 || st.level > 60 || st.diff <= 0) valid = false;
    for (const w of st.waves) {
      if (w.length < 3 || w.length > 6) sizes = false;
      for (const m of w) if (!MONSTERS.some((x) => x.id === m)) mon = false;
    }
    if (st.boss !== (f % 10 === 0) || (st.boss && st.waves[0][0] !== 'mk_chua')) bossOk = false;
    const r = towerReward(f);
    if (r.gold <= prevGold) mono = false;
    prevGold = r.gold;
  }
  ok(valid, '100 tầng đều dựng StageDef hợp lệ (đợt, chương, cấp, độ khó)');
  ok(sizes && mon, 'mỗi tầng 1 đợt 3..6 quái, quái đều có trong MONSTERS');
  ok(bossOk, 'tầng bội 10 là boss (mk_chua ở ô đầu)');
  ok(mono, 'vàng thưởng tăng dần theo tầng');
  ok(towerReward(5).gearRolls === 1 && towerReward(10).gearRolls === 2 && towerReward(7).gearRolls === 0 && towerReward(10).stones === 10 && towerReward(5).gems === 50 && towerReward(10).gems === 100, 'thưởng mốc tầng 5/10');
  const d17 = Date.UTC(2030, 0, 15, 17, 0, 0);
  ok(dayKey(d17 - 1) + 1 === dayKey(d17) && dayKey(d17) === dayKey(d17 + 86_399_999) && dayKey(d17 + 86_400_000) === dayKey(d17) + 1, 'dayKey đổi đúng lúc 17:00 UTC (00:00 giờ VN)');
  ok(nextDayStart(d17 - 1) === d17 && nextDayStart(d17) === d17 + 86_400_000 && nextDayStart(d17 + 5000) === d17 + 86_400_000, 'nextDayStart = đầu ngày kế tiếp');
  ok(QUEST_DEFS.length >= 5 && new Set(QUEST_DEFS.map((q) => q.id)).size === QUEST_DEFS.length && SHOP_ITEMS.every((i) => i.limit > 0), 'định nghĩa nhiệm vụ / cửa hàng hợp lệ');
}

console.log('— cân bằng Tháp (báo cáo, không ép chặt) —');
{
  const teamAt = (lv: number, star: number) => STARTER3.map((id, i) => heroUnit(owned(id, lv, star), i));
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
  ok(need[10] <= 22, 'tầng 10 cần đội khởi đầu cấp ≤ ~20');
  ok(wins100 === 0 && need[100] > 60, 'tầng 100 không qua được bằng đội cấp 60, 5 sao, không trang bị');
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
  ok(bossHpMax(1) === 5_000_000 && bossHpMax(10) > bossHpMax(9) && bossHpMax(2) > bossHpMax(1), 'bossHpMax tăng theo cấp bang');
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

console.log('— Cấp tài khoản / ô đội hình / thành tựu (hàm thuần) —');
{
  ok(SQUAD_SIZE === 6 && SQUAD_COUNT === 3 && SLOT_LEVEL.length === SQUAD_SIZE && SLOT_GEMS.length === SQUAD_SIZE, 'hằng số: 6 ô, 3 đội, bảng cấp/giá đủ 6 ô');
  ok(SLOT_LEVEL.every((v, i) => i === 0 || v >= SLOT_LEVEL[i - 1]), 'SLOT_LEVEL không giảm (mở đúng thứ tự)');
  const exp: [number, number][] = [[1, 3], [4, 3], [5, 4], [9, 4], [10, 5], [17, 5], [18, 6], [60, 6]];
  ok(exp.every(([l, n]) => slotsByLevel(l) === n && slotsOpen(l, 0) === n), 'slotsByLevel/slotsOpen theo cấp: 1→3, 5→4, 10→5, 18→6 (biên ±1)');
  ok(slotsOpen(1, 4) === 4 && slotsOpen(1, 6) === 6 && slotsOpen(5, 3) === 4 && slotsOpen(10, 4) === 5 && slotsOpen(1, 99) === 6 && slotsOpen(0, 0) === 3, 'slotsOpen = max(theo cấp, đã mua), trần 6, tối thiểu 3');
  ok(squadsOpen(1) === 1 && squadsOpen(7) === 1 && squadsOpen(8) === 2 && squadsOpen(14) === 2 && squadsOpen(15) === 3 && squadsOpen(60) === 3 && SQUAD_LEVEL[0] === 1, 'squadsOpen: đội 2 từ cấp 8, đội 3 từ cấp 15');
  let mono = true;
  for (let l = 3; l <= MAX_ACCOUNT_LEVEL; l++) if ((levelReward(l).gold ?? 0) <= (levelReward(l - 1).gold ?? 0)) mono = false;
  ok(mono, 'levelReward: vàng tăng dần theo cấp');
  ok(levelReward(5).gems! > 0 && levelReward(5).tickets === 1 && levelReward(10).tickets === 3 && levelReward(10).stones === 20 && !levelReward(6).gems, 'levelReward: mốc 5 có kim cương + vé, mốc 10 lớn hơn, cấp thường không có kim cương');
  ok(Object.values(levelReward(MAX_ACCOUNT_LEVEL)).every((v) => Number.isInteger(v) && v > 0), 'levelReward: số nguyên dương');
  ok(unlocksBetween(1, 1).length === 0 && unlocksBetween(1, 5).map((u) => u.level).join() === '5' && unlocksBetween(4, 10).map((u) => u.level).join() === '5,8,10' && unlocksBetween(5, 5).length === 0, 'unlocksBetween: (from, to]');
  ok(LEVEL_UNLOCKS.every((u, i) => i === 0 || u.level > LEVEL_UNLOCKS[i - 1].level), 'LEVEL_UNLOCKS tăng dần theo cấp');

  // ---- thành tựu: dữ liệu ----
  ok(new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length && ACHIEVEMENTS.every((a) => ACH_BY_ID[a.id] === a), 'ACHIEVEMENTS: id duy nhất, ACH_BY_ID khớp');
  ok(ACHIEVEMENTS.every((a) => a.tiers.length >= 1 && a.tiers.every((t, i) => t.target >= 1 && (i === 0 || t.target > a.tiers[i - 1].target))), 'mọi thành tựu: bậc có target tăng NGHIÊM NGẶT');
  const okReward = ACHIEVEMENTS.every((a) => a.tiers.every((t) => {
    const w = Object.values(t.reward.wallet ?? {});
    return w.every((v) => Number.isInteger(v) && (v as number) > 0) &&
      (!t.reward.shards || (!!HERO_BY_ID[t.reward.shards.hero] && t.reward.shards.n > 0)) &&
      (t.reward.gear ?? []).every((g) => !!GEAR_BY_ID[g]) && (w.length > 0 || !!t.reward.shards || !!t.reward.gear?.length);
  }));
  ok(okReward, 'thưởng mọi bậc hợp lệ (ví nguyên dương, tướng/trang bị có thật, không rỗng)');

  // ---- achClaimable / achBadge ----
  const d = ACH_BY_ID.a_tower; // 10/30/60/100
  const st = (progress: number, claimed: number): AchState => ({ id: d.id, progress, claimed });
  ok(achClaimable(d, st(9, 0)) === -1 && achClaimable(d, st(10, 0)) === 0 && achClaimable(d, st(500, 0)) === 0 && achClaimable(d, st(500, 1)) === 1, 'achClaimable: chỉ bậc KẾ TIẾP, đủ tiến trình');
  ok(achClaimable(d, st(500, 4)) === -1 && achClaimable(d, st(29, 1)) === -1, 'achClaimable: đã nhận hết / chưa đủ bậc kế → -1');
  const list: AchState[] = [st(10, 0), { id: 'a_guild', progress: 1, claimed: 1 }, { id: 'a_level', progress: 3, claimed: 0 }, { id: 'khong-co', progress: 9999, claimed: 0 }, { id: 'a_stage', progress: 30, claimed: 1 }];
  ok(achBadge(list) === 2 && achBadge([]) === 0, 'achBadge đếm thành tựu có bậc nhận ngay (bỏ id lạ / đã nhận hết / chưa đạt)');

  // ---- openSlotIds / padSquad / levelClaimable ----
  const s = newState(1, 0);
  ok(JSON.stringify(s.squads[0]) === JSON.stringify([...STARTER_HEROES.slice(0, 3), '', '', '']) && s.squads[1].length === 6 && s.levelClaimed === 1 && s.slotsBought === 0 && Object.keys(s.ach).length === 0, 'newState: 3 tướng đầu ở ô 0..2, đội 6 ô, levelClaimed 1, chưa mua ô, chưa có thành tựu');
  s.squads[0] = ['a', 'b', 'c', 'd', 'e', 'f'];
  ok(openSlotIds(s, 0).join() === 'a,b,c,,,' && padSquad(['x']).length === 6 && padSquad(undefined).length === 6, 'openSlotIds: cấp 1 chỉ giữ ô 0..2; padSquad đệm đủ 6');
  s.level = 5;
  ok(openSlotIds(s, 0).join() === 'a,b,c,d,,', 'openSlotIds: cấp 5 mở ô 3');
  s.level = 1;
  s.slotsBought = 5;
  ok(openSlotIds(s, 0).join() === 'a,b,c,d,e,', 'openSlotIds: đã mua 5 ô');
  s.squads[0] = ['a', 'b'];
  ok(openSlotIds(s, 0).length === 6 && openSlotIds(s, 0).join() === 'a,b,,,,', 'openSlotIds chịu được đội cũ ngắn hơn 6');
  ok(levelClaimable({ level: 1, levelClaimed: 1 }) === 0 && levelClaimable({ level: 12, levelClaimed: 1 }) === 11 && levelClaimable({ level: 3, levelClaimed: 9 }) === 0 && levelClaimable({ level: 99, levelClaimed: 1 }) === MAX_ACCOUNT_LEVEL - 1, 'levelClaimable không âm, chặn ở cấp tối đa');
  ok(claimableLevels({ level: 4, levelClaimed: 1 }).join() === '2,3,4' && claimableLevels({ level: 1, levelClaimed: 1 }).length === 0, 'claimableLevels: claimedUpTo+1..level');

  // ---- achProgress: mọi loại ----
  const g = newState(2, 0);
  const cnt = (ids: readonly string[], rarity: string) => ids.filter((id) => HERO_BY_ID[id]?.rarity === rarity).length;
  const urIds = HEROES.filter((h) => h.rarity === 'UR').map((h) => h.id);
  const ssrIds = HEROES.filter((h) => h.rarity === 'SSR').map((h) => h.id);
  ok(urIds.length >= 1 && ssrIds.length >= 2, 'có ≥1 tướng UR và ≥2 SSR để thử');
  const base: Record<string, number> = {};
  for (const a of ACHIEVEMENTS) base[a.kind] = achProgress(g, a.kind);
  ok(base.stage === 0 && base.stars === 0 && base.bossClear === 0 && base.heroCount === STARTER_HEROES.length && base.level === 1 && base.gearCount === 0 && base.pulls === 0 && base.tower === 0 && base.arenaWins === 0 && base.guild === 0 && base.loginDays === 0, 'tiến trình ban đầu của tài khoản mới');
  g.progress['1-1'] = { stage: '1-1', stars: 3, clears: 1 };
  g.progress['1-5'] = { stage: '1-5', stars: 2, clears: 1 };
  g.progress['1-10'] = { stage: '1-10', stars: 1, clears: 1 };
  g.progress['2-5'] = { stage: '2-5', stars: 0, clears: 2 }; // 0 sao: không tính
  g.progress['2-3'] = { stage: '2-3', stars: 1, clears: 1 };
  ok(achProgress(g, 'stage') === 13 && achProgress(g, 'stars') === 7 && achProgress(g, 'bossClear') === 2, 'stage = index cao nhất đã qua + 1 (2-3 → 13), stars = Σ sao, bossClear chỉ đếm ải 5/10 đã qua (2-5 0 sao bỏ)');
  g.heroes[urIds[0]] = { id: urIds[0], level: 33, star: 4, shards: 0 };
  g.heroes[ssrIds[1]] = { id: ssrIds[1], level: 5, star: 1, shards: 0 };
  g.heroes[ssrIds[0]] = { id: ssrIds[0], level: 2, star: 5, shards: 0 };
  const own = Object.keys(g.heroes);
  ok(achProgress(g, 'heroCount') === own.length && achProgress(g, 'urCount') === cnt(own, 'UR') && achProgress(g, 'ssrCount') === cnt(own, 'UR') + cnt(own, 'SSR') && achProgress(g, 'urCount') >= 1 && achProgress(g, 'ssrCount') >= 3 && achProgress(g, 'heroLevel') === 33 && achProgress(g, 'heroStar') === 5, 'heroCount / urCount / ssrCount (SSR hoặc UR) / heroLevel / heroStar = max');
  g.level = 27;
  g.gear = [
    { uid: 1, def: 'weapon_earth_UR', level: 7, hero: null }, { uid: 2, def: 'armor_forest_R', level: 2, hero: null }, { uid: 3, def: 'helmet_water_UR', level: 10, hero: 'x' },
  ];
  ok(achProgress(g, 'level') === 27 && achProgress(g, 'gearCount') === 3 && achProgress(g, 'gearUR') === 2 && achProgress(g, 'gearMax') === 10, 'level / gearCount / gearUR (phẩm UR) / gearMax = cấp cao nhất');
  g.newbie.pullsTotal = 42;
  g.towerFloor = 17;
  g.arenaWins = 6;
  g.arenaRating = 1234;
  g.guildId = 3;
  g.newbie.loginClaimed = 5;
  ok(achProgress(g, 'pulls') === 42 && achProgress(g, 'tower') === 17 && achProgress(g, 'arenaWins') === 6 && achProgress(g, 'arenaRating') === 1234 && achProgress(g, 'guild') === 1 && achProgress(g, 'loginDays') === 5 && achProgress(g, 'bossDamage') === 0, 'pulls / tower / arenaWins / arenaRating(hiện tại) / guild / loginDays / bossDamage(=0)');
  const al = achList(g);
  ok(al.length === ACHIEVEMENTS.length && al.every((a) => a.claimed === 0) && al.find((a) => a.id === 'a_tower')!.progress === 17, 'achList: đủ mọi thành tựu, claimed 0');
  g.ach.a_tower = 99;
  ok(achList(g).find((a) => a.id === 'a_tower')!.claimed === ACH_BY_ID.a_tower.tiers.length, 'achList chặn claimed ở số bậc');
}

console.log(fails ? `\n${fails} LỖI` : '\nTất cả đạt');
process.exit(fails ? 1 : 0);
