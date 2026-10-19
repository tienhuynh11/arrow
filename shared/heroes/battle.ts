// Engine trận đánh ATB — THUẦN và deterministic (số nguyên + PRNG có seed).
// Chạy giống hệt ở client (để có hình ảnh, tua x3) và server (chạy lại để chấm thắng/thua, chống gian lận).
// Engine chỉ xuất danh sách sự kiện; lớp 3D chỉ phát lại danh sách đó.

import { ALLY_SEP, BACK_MARGIN, MELEE_MAX_RANGE, MIN_SEP, MOVE_EVENT_EVERY, moveOf, rangeOf, startX, statOf } from './combat.js';
import { BATTLE_MAX_TICKS, FRONT_SLOTS } from './config.js';
import { statsAt } from './formulas.js';
import { addStats } from './gear.js';
import { heroOf } from './heroes.js';
import { mulberry32, type Rng } from './rng.js';
import { skillOf } from './skills.js';
import type { EffectType, Element, OwnedHero, Role, SkillDef, Stats } from './types.js';

/** thanh hành động đầy ở mức này; spd 100 => 40 tick (2 giây) một lượt */
export const GAUGE_MAX = 4000;
export const ENERGY_MAX = 100;
const ENERGY_ON_ACT = 20;
const ENERGY_ON_HIT = 10;
const ADV_MULT = 120;
const DIS_MULT = 80;
/** nghỉ giữa hai đợt quái (tick) để trình diễn kịp */
const WAVE_PAUSE = 30;
const MAX_INPUTS = 400;

/* ------------------------------ DỮ LIỆU VÀO ------------------------------ */
export interface UnitInit {
  /** id HeroDef hoặc MonsterDef (client dùng để chọn model) */
  key: string;
  name: string;
  /** 0 = người chơi, 1 = quái */
  side: 0 | 1;
  /** 0-1 hàng trước, 2-4 hàng sau */
  slot: number;
  element: Element;
  role: Role;
  stats: Stats;
  /** [đòn thường, kỹ năng, tuyệt kỹ] */
  skills: [string, string, string];
  boss?: boolean;
  /** ghi đè tầm đánh / tốc độ đi (đơn vị, mặc định theo vai trò — combat.ts); chủ yếu để thử nghiệm */
  range?: number;
  moveSpd?: number;
}
export interface BattleSetup {
  seed: number;
  player: UnitInit[];
  /** các đợt quái; mỗi đợt tối đa 5 con */
  waves: UnitInit[][];
}
/** hành động của người chơi. `tick` = b.tick lúc bấm (trước khi gọi step). */
export interface BattleInput {
  tick: number;
  /** bấm tuyệt kỹ cho uid này */
  ult?: number;
  /** bật/tắt Auto */
  auto?: boolean;
}

/** dựng đơn vị chiến đấu từ tướng của người chơi */
export function heroUnit(o: OwnedHero, slot: number, bonus?: Stats): UnitInit {
  const d = heroOf(o.id);
  const base = statsAt(d.role, d.rarity, o.level, o.star);
  // `bonus` = tổng chỉ số từ trang bị đang mặc (xem gear.ts sumGear)
  const stats = bonus ? addStats(base, bonus) : base;
  return { key: d.id, name: d.name, side: 0, slot, element: d.element, role: d.role, stats, skills: d.skills };
}

/* ------------------------------ SỰ KIỆN ------------------------------ */
export type BattleEvent =
  | { t: number; k: 'wave'; n: number; units: number[]; /** x xuất phát của từng đơn vị trong `units` */ xs?: number[] }
  | { t: number; k: 'act'; u: number; s: string; tg: number[]; /** x của người ra đòn */ ax: number; /** x của từng mục tiêu (cùng thứ tự `tg`) */ tx: number[] }
  | { t: number; k: 'move'; u: number; x: number }
  | { t: number; k: 'dmg'; u: number; tg: number; n: number; crit: boolean; adv: number; hp: number }
  | { t: number; k: 'heal'; u: number; tg: number; n: number; hp: number }
  | { t: number; k: 'fx'; u: number; tg: number; type: EffectType; dur: number }
  | { t: number; k: 'die'; u: number }
  | { t: number; k: 'end'; win: boolean };

export interface BattleResult {
  win: boolean;
  ticks: number;
  events: BattleEvent[];
  /** số tướng của người chơi đã gục */
  deaths: number;
  /** % máu còn lại của cả đội (0-100) */
  hpPct: number;
}

/* ------------------------------ ĐƠN VỊ ------------------------------ */
interface Eff {
  type: EffectType;
  value: number;
  until: number;
}
export interface Unit {
  uid: number;
  init: UnitInit;
  hp: number;
  maxHp: number;
  energy: number;
  gauge: number;
  /** hồi chiêu còn lại của kỹ năng chủ động (tick) */
  cd: number;
  alive: boolean;
  /** vị trí trên trục trận đánh (số nguyên, 0..ARENA_LEN) */
  x: number;
  /** tầm đánh + tốc độ đi (đơn vị / tick) */
  range: number;
  moveSpd: number;
  /** x đã phát trong sự kiện 'move' gần nhất */
  sentX: number;
  shield: number;
  shieldUntil: number;
  effs: Eff[];
}

/** hướng tiến: phe người chơi sang phải (+1), quái sang trái (-1) */
const dir_ = (u: Unit): 1 | -1 => (u.init.side === 0 ? 1 : -1);

const BEATS: Record<Element, Element> = { forest: 'earth', earth: 'water', water: 'forest', light: 'dark', dark: 'light' };
/** 1 = lợi thế, -1 = bất lợi, 0 = ngang */
export function advantage(att: Element, def: Element): number {
  if (BEATS[att] === def) return 1;
  if (BEATS[def] === att) return -1;
  return 0;
}

export class Battle {
  tick = 0;
  /** mọi đơn vị còn/ đã từng hiện diện (người chơi trước, rồi quái theo đợt) */
  units: Unit[] = [];
  wave = -1;
  auto = false;
  done = false;
  win = false;
  readonly setup: BattleSetup;
  private rng: Rng;
  private lockUntil = 0;
  private ultQueue: number[] = [];

  constructor(setup: BattleSetup) {
    this.setup = setup;
    this.rng = mulberry32(setup.seed);
    setup.player.forEach((init, i) => this.units.push(this.makeUnit(i, init)));
  }

  private makeUnit(uid: number, init: UnitInit): Unit {
    const x = startX(init.side, init.slot);
    return {
      uid, init, hp: init.stats.hp, maxHp: init.stats.hp, energy: 0,
      gauge: this.rng.int(GAUGE_MAX / 2), cd: 0, alive: true,
      x, sentX: x, range: rangeOf(init.role, init.boss, init.range), moveSpd: moveOf(init.role, init.boss, init.moveSpd),
      shield: 0, shieldUntil: 0, effs: [],
    };
  }

  /* ---- truy vấn ---- */
  unit(uid: number): Unit | undefined {
    return this.units.find((u) => u.uid === uid);
  }
  side(side: 0 | 1): Unit[] {
    return this.units.filter((u) => u.init.side === side && u.alive);
  }
  private effSum(u: Unit, type: EffectType): number {
    let s = 0;
    for (const e of u.effs) if (e.type === type && e.until > this.tick) s += e.value;
    return s;
  }
  stunned(u: Unit): boolean {
    return u.effs.some((e) => e.type === 'stun' && e.until > this.tick);
  }
  private atkOf(u: Unit): number {
    return Math.floor((u.init.stats.atk * (100 + this.effSum(u, 'atkUp'))) / 100);
  }
  private defOf(u: Unit): number {
    const m = Math.max(10, 100 + this.effSum(u, 'defUp') - this.effSum(u, 'defDown'));
    return Math.floor((u.init.stats.def * m) / 100);
  }
  /** vị trí hiện tại của một đơn vị (-1 nếu không có) */
  pos(uid: number): number {
    return this.unit(uid)?.x ?? -1;
  }
  /** ảnh chụp vị trí mọi đơn vị còn sống (client dùng để dựng cảnh lúc bắt đầu / khôi phục) */
  snapshot(): { uid: number; side: 0 | 1; slot: number; x: number; range: number }[] {
    return this.units.filter((u) => u.alive).map((u) => ({ uid: u.uid, side: u.init.side, slot: u.init.slot, x: u.x, range: u.range }));
  }
  /** địch gần nhất theo |dx| (hòa → ô thấp hơn → uid thấp hơn) */
  private nearestFoe(u: Unit): Unit | undefined {
    let best: Unit | undefined;
    let bd = 0;
    for (const f of this.units) {
      if (!f.alive || f.init.side === u.init.side) continue;
      const d = Math.abs(f.x - u.x);
      if (!best || d < bd || (d === bd && (f.init.slot < best.init.slot || (f.init.slot === best.init.slot && f.uid < best.uid)))) {
        best = f;
        bd = d;
      }
    }
    return best;
  }
  /** có địch trong tầm đánh không (chỉ khi đó thanh hành động mới đầy và mới ra đòn) */
  private inRange(u: Unit): boolean {
    const f = this.nearestFoe(u);
    return !!f && Math.abs(f.x - u.x) <= u.range;
  }
  private spdOf(u: Unit): number {
    return Math.floor((u.init.stats.spd * (100 + this.effSum(u, 'spdUp'))) / 100);
  }
  /** người chơi có thể bấm tuyệt kỹ cho tướng này ngay lúc này không */
  canUlt(uid: number): boolean {
    const u = this.unit(uid);
    return !!u && !this.done && u.alive && u.init.side === 0 && u.energy >= ENERGY_MAX && !this.stunned(u) && this.tick >= this.lockUntil;
  }

  /* ---- đầu vào ---- */
  ult(uid: number): void {
    if (!this.ultQueue.includes(uid)) this.ultQueue.push(uid);
  }
  setAuto(on: boolean): void {
    this.auto = on;
  }

  /* ---- vòng lặp ---- */
  /** tiến một tick; trả về các sự kiện phát sinh */
  step(): BattleEvent[] {
    const out: BattleEvent[] = [];
    if (this.done) return out;
    this.tick++;
    const t = this.tick;

    if (this.wave < 0) this.spawnWave(0, out);

    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.cd > 0) u.cd--;
      if (u.shield > 0 && u.shieldUntil <= t) u.shield = 0;
    }

    // di chuyển (cả lúc chờ đợt quái: hai bên tiến lại gần nhau)
    this.moveAll(out);

    if (t >= this.lockUntil) {
      // đổ đầy thanh hành động: chỉ khi có địch trong tầm; tốc độ = spd * tốc đánh / 100
      for (const u of this.units) {
        if (u.alive && !this.stunned(u) && this.inRange(u)) u.gauge += Math.floor((this.spdOf(u) * statOf(u.init.stats, 'aspd')) / 100);
      }

      // tuyệt kỹ người chơi bấm
      const q = this.ultQueue;
      this.ultQueue = [];
      for (const uid of q) {
        const u = this.unit(uid);
        if (u && this.canUlt(uid)) this.cast(u, skillOf(u.init.skills[2]), out);
      }

      // tướng nào đầy thanh thì ra đòn (đầy nhiều hơn ra trước)
      const ready = this.units
        .filter((u) => u.alive && u.gauge >= GAUGE_MAX && !this.stunned(u) && this.inRange(u))
        .sort((a, b) => b.gauge - a.gauge || a.uid - b.uid);
      for (const u of ready) {
        if (!u.alive || this.done || this.stunned(u) || !this.inRange(u)) continue;
        u.gauge -= GAUGE_MAX;
        const wantUlt = u.energy >= ENERGY_MAX && (u.init.side === 1 || this.auto);
        const [b, a, ul] = u.init.skills;
        const id = wantUlt ? ul : u.cd === 0 ? a : b;
        this.cast(u, skillOf(id), out);
        if (this.checkEnd(out)) break;
      }
    } else {
      this.ultQueue = [];
    }

    this.checkEnd(out);
    if (!this.done && t >= BATTLE_MAX_TICKS) this.finish(false, out);
    return out;
  }

  /** mỗi tick: đơn vị chọn địch gần nhất, nếu ngoài tầm thì tiến lại (không xuyên qua địch, tướng đánh xa đứng sau tuyến cận chiến) */
  private moveAll(out: BattleEvent[]): void {
    const t = this.tick;
    for (const u of this.units) {
      if (!u.alive) continue;
      let moved = false;
      if (u.moveSpd > 0 && !this.stunned(u)) {
        const f = this.nearestFoe(u);
        const dir = dir_(u);
        if (f && (f.x - u.x) * dir > u.range) {
          let step = Math.min(u.moveSpd, (f.x - u.x) * dir - u.range);
          let frontPos = -1;
          let hasMelee = false;
          for (const o of this.units) {
            if (!o.alive) continue;
            if (o.init.side !== u.init.side) {
              // không áp sát địch phía trước quá MIN_SEP
              const ahead = (o.x - u.x) * dir;
              if (ahead > 0) step = Math.min(step, ahead - MIN_SEP);
            } else if (o !== u && o.range <= MELEE_MAX_RANGE) {
              hasMelee = true;
              frontPos = Math.max(frontPos, o.x * dir);
            }
          }
          // đánh xa đứng sau tuyến cận chiến của phe mình (hết cận chiến thì được tiến)
          if (u.range > MELEE_MAX_RANGE && hasMelee) step = Math.min(step, frontPos - BACK_MARGIN - u.x * dir);
          if (step > 0) {
            u.x += dir * step;
            moved = true;
          }
        }
      }
      // đã vào tầm mà còn dính sát đồng minh (< ALLY_SEP): trong mỗi cặp dính nhau, bên uid LỚN hơn bị đẩy lên trước bên uid nhỏ (thứ tự cố định, không nhảy qua nhảy lại), CHỈ tiến về phía địch
      // => đơn điệu, bị chặn bởi MIN_SEP với địch và BACK_MARGIN với tuyến cận chiến, nên không dao động và luôn dừng
      if (!moved && u.moveSpd > 0 && !this.stunned(u)) {
        const f = this.nearestFoe(u);
        if (f && (f.x - u.x) * dir_(u) <= u.range) moved = this.spreadAlly(u);
      }
      if (u.x !== u.sentX && (!moved || t % MOVE_EVENT_EVERY === 0)) {
        u.sentX = u.x;
        out.push({ t, k: 'move', u: u.uid, x: u.x });
      }
    }
  }

  /** đẩy u lên trước để cách mọi đồng minh uid nhỏ hơn ≥ ALLY_SEP; trả true nếu đã nhích */
  private spreadAlly(u: Unit): boolean {
    const dir = dir_(u);
    let want = u.x * dir;
    let frontPos = -1;
    let hasMelee = false;
    for (const o of this.units) {
      if (!o.alive || o === u) continue;
      if (o.init.side !== u.init.side) {
        continue;
      }
      if (o.range <= MELEE_MAX_RANGE) {
        hasMelee = true;
        frontPos = Math.max(frontPos, o.x * dir);
      }
      const d = (o.x - u.x) * dir;
      if (o.uid < u.uid && Math.abs(d) < ALLY_SEP) want = Math.max(want, o.x * dir + ALLY_SEP);
    }
    let step = Math.min(u.moveSpd, want - u.x * dir);
    if (step <= 0) return false;
    for (const o of this.units) {
      if (!o.alive || o.init.side === u.init.side) continue;
      const ahead = (o.x - u.x) * dir;
      if (ahead > 0) step = Math.min(step, ahead - MIN_SEP);
    }
    if (u.range > MELEE_MAX_RANGE && hasMelee) step = Math.min(step, frontPos - BACK_MARGIN - u.x * dir);
    if (step <= 0) return false;
    u.x += dir * step;
    return true;
  }

  private spawnWave(n: number, out: BattleEvent[]): void {
    this.wave = n;
    const base = 10 + n * 10;
    const ids: number[] = [];
    const xs: number[] = [];
    // đợt mới: phe người chơi về đội hình xuất phát (hai bên lại cách xa nhau)
    if (n > 0) {
      for (const u of this.units) {
        if (!u.alive || u.init.side !== 0) continue;
        u.x = startX(0, u.init.slot);
        if (u.x !== u.sentX) {
          u.sentX = u.x;
          out.push({ t: this.tick, k: 'move', u: u.uid, x: u.x });
        }
      }
    }
    this.setup.waves[n].forEach((init, i) => {
      const u = this.makeUnit(base + i, init);
      this.units.push(u);
      ids.push(u.uid);
      xs.push(u.x);
    });
    this.lockUntil = this.tick + WAVE_PAUSE;
    out.push({ t: this.tick, k: 'wave', n, units: ids, xs });
  }

  /** hết đợt/hết đội thì xử lý; trả true nếu trận đã kết thúc */
  private checkEnd(out: BattleEvent[]): boolean {
    if (this.done) return true;
    if (this.side(0).length === 0) return this.finish(false, out);
    if (this.side(1).length === 0) {
      if (this.wave + 1 >= this.setup.waves.length) return this.finish(true, out);
      this.spawnWave(this.wave + 1, out);
    }
    return false;
  }
  private finish(win: boolean, out: BattleEvent[]): boolean {
    this.done = true;
    this.win = win;
    out.push({ t: this.tick, k: 'end', win });
    return true;
  }

  /* ---- ra đòn ---- */
  private pickTargets(u: Unit, sk: SkillDef): Unit[] {
    const foes = this.side(u.init.side === 0 ? 1 : 0);
    const allies = this.side(u.init.side);
    const bySlot = (a: Unit, b: Unit) => a.init.slot - b.init.slot || a.uid - b.uid;
    const ratio = (a: Unit, b: Unit) => a.hp * b.maxHp - b.hp * a.maxHp || a.uid - b.uid;
    const dist = (a: Unit) => Math.abs(a.x - u.x);
    const byDist = (a: Unit, b: Unit) => dist(a) - dist(b) || bySlot(a, b);
    // đòn đơn mục tiêu chỉ nhắm địch TRONG TẦM (không ai trong tầm, ví dụ tuyệt kỹ bấm lúc đang tiến: lấy mọi địch)
    const inR = foes.filter((f) => dist(f) <= u.range);
    const pool = inR.length ? inR : foes;
    switch (sk.target) {
      case 'enemy':
        return [pool.sort(byDist)[0]];
      case 'enemyBack': {
        const back = pool.filter((f) => f.init.slot >= FRONT_SLOTS).sort(bySlot);
        return [(back.length ? back : pool.sort(byDist))[0]];
      }
      case 'enemyLowest':
        return [pool.sort(ratio)[0]];
      case 'enemyAll':
        return foes.sort(bySlot);
      case 'self':
        return [u];
      case 'allyLowest':
        return [allies.sort(ratio)[0]];
      case 'allyAll':
        return allies.sort(bySlot);
    }
  }

  private cast(u: Unit, sk: SkillDef, out: BattleEvent[]): void {
    const targets = this.pickTargets(u, sk).filter(Boolean);
    if (!targets.length) return;
    if (sk.kind === 'ult') u.energy = 0;
    else {
      u.energy = Math.min(ENERGY_MAX, u.energy + ENERGY_ON_ACT);
      if (sk.kind === 'active') u.cd = sk.cd;
    }
    out.push({ t: this.tick, k: 'act', u: u.uid, s: sk.id, tg: targets.map((x) => x.uid), ax: u.x, tx: targets.map((x) => x.x) });

    for (const tg of targets) {
      if (sk.type === 'dmg') this.hit(u, tg, sk, out);
      else if (sk.type === 'heal') {
        const n = Math.floor((this.atkOf(u) * sk.power) / 100);
        tg.hp = Math.min(tg.maxHp, tg.hp + n);
        out.push({ t: this.tick, k: 'heal', u: u.uid, tg: tg.uid, n, hp: tg.hp });
      }
      if (tg.alive) for (const e of sk.effects) this.applyEffect(u, tg, e.type, e.value, e.dur, out);
    }
  }

  private hit(u: Unit, tg: Unit, sk: SkillDef, out: BattleEvent[]): void {
    const adv = advantage(u.init.element, tg.init.element);
    const crit = this.rng.int(100) < statOf(u.init.stats, 'crit');
    let n = (this.atkOf(u) * sk.power) / 100;
    n = (n * (adv > 0 ? ADV_MULT : adv < 0 ? DIS_MULT : 100)) / 100;
    if (crit) n = (n * statOf(u.init.stats, 'critDmg')) / 100;
    n = Math.max(1, Math.floor((n * 200) / (200 + this.defOf(tg))));
    if (tg.shield > 0) {
      const ab = Math.min(tg.shield, n);
      tg.shield -= ab;
      n -= ab;
    }
    tg.hp = Math.max(0, tg.hp - n);
    out.push({ t: this.tick, k: 'dmg', u: u.uid, tg: tg.uid, n, crit, adv, hp: tg.hp });
    if (tg.hp <= 0) {
      tg.alive = false;
      out.push({ t: this.tick, k: 'die', u: tg.uid });
    } else tg.energy = Math.min(ENERGY_MAX, tg.energy + ENERGY_ON_HIT);
    // hút máu: hồi cho người đánh một phần sát thương gây ra
    const ls = Math.floor((n * statOf(u.init.stats, 'lifesteal')) / 100);
    if (ls > 0 && u.alive && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + ls);
      out.push({ t: this.tick, k: 'heal', u: u.uid, tg: u.uid, n: ls, hp: u.hp });
    }
  }

  private applyEffect(src: Unit, tg: Unit, type: EffectType, value: number, dur: number, out: BattleEvent[]): void {
    const until = this.tick + dur;
    if (type === 'shield') {
      tg.shield += Math.floor((this.atkOf(src) * value) / 100);
      tg.shieldUntil = Math.max(tg.shieldUntil, until);
    } else {
      const cur = tg.effs.find((e) => e.type === type);
      if (cur) {
        cur.value = Math.max(cur.value, value);
        cur.until = Math.max(cur.until, until);
      } else tg.effs.push({ type, value, until });
      tg.effs = tg.effs.filter((e) => e.until > this.tick);
    }
    out.push({ t: this.tick, k: 'fx', u: src.uid, tg: tg.uid, type, dur });
  }

  /** tổng kết (dùng khi trận đã xong) */
  result(events: BattleEvent[]): BattleResult {
    const players = this.units.filter((u) => u.init.side === 0);
    const maxHp = players.reduce((s, u) => s + u.maxHp, 0) || 1;
    const hp = players.reduce((s, u) => s + u.hp, 0);
    return {
      win: this.win, ticks: this.tick, events,
      deaths: players.filter((u) => !u.alive).length,
      hpPct: Math.floor((hp * 100) / maxHp),
    };
  }
}

/** chạy lại cả trận từ đầu với danh sách hành động của người chơi (server dùng để chấm) */
export function simulate(setup: BattleSetup, inputs: BattleInput[] = [], auto = false): BattleResult {
  const b = new Battle(setup);
  b.setAuto(auto);
  const list = inputs.slice(0, MAX_INPUTS).sort((a, c) => a.tick - c.tick);
  let i = 0;
  const events: BattleEvent[] = [];
  while (!b.done) {
    while (i < list.length && list[i].tick <= b.tick) {
      const inp = list[i++];
      if (inp.auto !== undefined) b.setAuto(inp.auto);
      if (inp.ult !== undefined) b.ult(inp.ult);
    }
    events.push(...b.step());
  }
  return b.result(events);
}
