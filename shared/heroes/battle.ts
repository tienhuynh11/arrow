// Engine trận đánh ATB — THUẦN và deterministic (số nguyên + PRNG có seed).
// Chạy giống hệt ở client (để có hình ảnh, tua x3) và server (chạy lại để chấm thắng/thua, chống gian lận).
// Engine chỉ xuất danh sách sự kiện; lớp 3D chỉ phát lại danh sách đó.

import { BATTLE_MAX_TICKS, FRONT_SLOTS } from './config.js';
import { statsAt } from './formulas.js';
import { heroOf } from './heroes.js';
import { mulberry32, type Rng } from './rng.js';
import { skillOf } from './skills.js';
import type { EffectType, Element, OwnedHero, Role, SkillDef, Stats } from './types.js';

/** thanh hành động đầy ở mức này; spd 100 => 40 tick (2 giây) một lượt */
export const GAUGE_MAX = 4000;
export const ENERGY_MAX = 100;
const ENERGY_ON_ACT = 20;
const ENERGY_ON_HIT = 10;
const CRIT_PCT = 10;
const CRIT_MULT = 150;
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
  const stats = bonus ? { hp: base.hp + bonus.hp, atk: base.atk + bonus.atk, def: base.def + bonus.def, spd: base.spd + bonus.spd } : base;
  return { key: d.id, name: d.name, side: 0, slot, element: d.element, role: d.role, stats, skills: d.skills };
}

/* ------------------------------ SỰ KIỆN ------------------------------ */
export type BattleEvent =
  | { t: number; k: 'wave'; n: number; units: number[] }
  | { t: number; k: 'act'; u: number; s: string; tg: number[] }
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
  shield: number;
  shieldUntil: number;
  effs: Eff[];
}

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
    return {
      uid, init, hp: init.stats.hp, maxHp: init.stats.hp, energy: 0,
      gauge: this.rng.int(GAUGE_MAX / 2), cd: 0, alive: true, shield: 0, shieldUntil: 0, effs: [],
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

    if (t >= this.lockUntil) {
      // đổ đầy thanh hành động
      for (const u of this.units) if (u.alive && !this.stunned(u)) u.gauge += this.spdOf(u);

      // tuyệt kỹ người chơi bấm
      const q = this.ultQueue;
      this.ultQueue = [];
      for (const uid of q) {
        const u = this.unit(uid);
        if (u && this.canUlt(uid)) this.cast(u, skillOf(u.init.skills[2]), out);
      }

      // tướng nào đầy thanh thì ra đòn (đầy nhiều hơn ra trước)
      const ready = this.units
        .filter((u) => u.alive && u.gauge >= GAUGE_MAX && !this.stunned(u))
        .sort((a, b) => b.gauge - a.gauge || a.uid - b.uid);
      for (const u of ready) {
        if (!u.alive || this.done || this.stunned(u)) continue;
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

  private spawnWave(n: number, out: BattleEvent[]): void {
    this.wave = n;
    const base = 10 + n * 10;
    const ids: number[] = [];
    this.setup.waves[n].forEach((init, i) => {
      const u = this.makeUnit(base + i, init);
      this.units.push(u);
      ids.push(u.uid);
    });
    this.lockUntil = this.tick + WAVE_PAUSE;
    out.push({ t: this.tick, k: 'wave', n, units: ids });
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
    switch (sk.target) {
      case 'enemy': {
        const front = foes.filter((f) => f.init.slot < FRONT_SLOTS).sort(bySlot);
        return [(front.length ? front : foes.sort(bySlot))[0]];
      }
      case 'enemyBack': {
        const back = foes.filter((f) => f.init.slot >= FRONT_SLOTS).sort(bySlot);
        return [(back.length ? back : foes.sort(bySlot))[0]];
      }
      case 'enemyLowest':
        return [foes.sort(ratio)[0]];
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
    out.push({ t: this.tick, k: 'act', u: u.uid, s: sk.id, tg: targets.map((x) => x.uid) });

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
    const crit = this.rng.int(100) < CRIT_PCT;
    let n = (this.atkOf(u) * sk.power) / 100;
    n = (n * (adv > 0 ? ADV_MULT : adv < 0 ? DIS_MULT : 100)) / 100;
    if (crit) n = (n * CRIT_MULT) / 100;
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
