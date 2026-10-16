// Một phòng SINH TỒN BẦY KHỈ: sảnh (chọn lớp, sẵn sàng) → trận (đợt/nghỉ) → tổng kết.
// Người chơi: xử lý lệnh NGAY khi tới (bước sim 60Hz xác định, bù trễ khi bắn).
// Khỉ + kinh tế + đợt: vòng 20Hz; snapshot nhị phân mã hoá một lần, gửi chung cả phòng.

import { randomUUID } from 'node:crypto';
import { AI_HZ, AI_MS, LAG_COMP_TICKS, MAX_PLAYERS, TICK_HZ } from '../../../shared/monkey/config.js';
import {
  BLEED_SECS,
  BREAK_SECS,
  CLASSES,
  FIRST_BREAK_SECS,
  HP_TIER_BONUS,
  HP_TIER_COST,
  MAX_HP_TIER,
  MAX_TIER,
  MK_DOT,
  MK_NO,
  MK_VUA,
  MONKEYS,
  REVIVE_HP,
  REVIVE_RANGE,
  REVIVE_SECS,
  START_CASH,
  TEAM_SHARE,
  ULT_KILLS,
  bodyY,
  bossHp,
  maxHpOf,
  waveBonus,
  waveSpec,
  weaponOf,
  type WaveSpec,
} from '../../../shared/monkey/content.js';
import { MAPS, MAP_RANDOM, PLAYER_SPAWNS, collide, isMapChoice, rayWorld, mapById, setActiveMap, type MapDef } from '../../../shared/monkey/map.js';
import { isin, icos } from '../../../shared/monkey/math.js';
import {
  BIN_SNAP,
  EN_BARRICADE,
  EN_FLARE,
  EN_PICKUP,
  EN_POD,
  EN_TURRET,
  FX_BUILD,
  FX_HEAL,
  FX_PLAYERHIT,
  FX_REPAIR,
  FX_STOMP,
  PF_ADS,
  PF_BRACE,
  PF_GROUND,
  PF_ON,
  PF_REVIVING,
  PF_SPRINT,
  PH_BREAK,
  PH_FIGHT,
  PH_OVER,
  PJ_GRENADE,
  ST_STUN,
  Writer,
  type BoardEntry,
  type EndStat,
  type LobbyPlayer,
  type SMsg,
} from '../../../shared/monkey/proto.js';
import {
  B_ADS,
  B_USE,
  F_FIRED,
  P_C,
  P_G,
  P_Q,
  P_V,
  P_X,
  aimDir,
  isSprinting,
  newState,
  pelletDirs,
  shotOrigin,
  step,
  type Cmd,
  type PState,
} from '../../../shared/monkey/sim.js';
import { submitRun, topRuns } from './leaderboard.js';
import { CAUSE_SHOT, CAUSE_SKILL, MonkeyWorld, type WorldHost } from './world.js';

export interface MConn {
  send(data: string | Uint8Array): void;
  close(): void;
  /** byte đã gửi (đo băng thông) */
  sent: number;
}

const CMD_RATE = 62; // lệnh/giây được phép (dư 2 cho đồng hồ lệch)
const CMD_BURST = 40;

export class MPlayer {
  idx: number;
  pid = randomUUID();
  token = randomUUID();
  name: string;
  cls: number;
  ready = false;
  conn: MConn | null;
  discAt = 0;
  st: PState;
  hp = 100;
  maxHp = 100;
  hpTier = 0;
  shield = 0;
  cash = START_CASH;
  kills = 0;
  ultKills = 0;
  dmg = 0;
  revives = 0;
  earned = 0;
  downs = 0;
  credit = CMD_BURST;
  creditAt = 0;
  ack = 0;
  btn = 0;
  cdG = 0;
  cdX = 0;
  bleedUntil = 0;
  reviveProg = 0;
  reviveTick = -100;
  reviving = false;
  selfRevives = 0;
  autoReviveAt = 0;
  tauntUntil = 0;
  rageUntil = 0;
  lastHurt = 0;
  breakReady = false;
  needKey = true;
  regenAcc = 0;
  /** đo kiểm: số viên đạn bắn ra / số viên server xác nhận trúng */
  statPellets = 0;
  /** số lệnh đã chạy (đo kiểm chống tăng tốc) */
  cmdsRun = 0;
  statHits = 0;

  constructor(idx: number, name: string, cls: number, conn: MConn) {
    this.idx = idx;
    this.name = name;
    this.cls = cls;
    this.conn = conn;
    this.st = newState(cls, 0, 0);
  }

  send(m: SMsg) {
    if (this.conn) {
      const s = JSON.stringify(m);
      this.conn.send(s);
    }
  }
}

export class MonkeyRoom implements WorldHost {
  readonly code: string;
  readonly solo: boolean;
  phase: 'lobby' | 'play' | 'over' = 'lobby';
  players: (MPlayer | null)[] = [null, null, null, null];
  host = 0;
  /** lựa chọn bản đồ trong sảnh (id hoặc 'random') */
  mapChoice: string = MAP_RANDOM;
  /** bản đồ đã chốt cho ván hiện tại (đặt làm bản đồ hiện hành ở đầu mỗi tick / lệnh) */
  mapDef: MapDef = MAPS[0];
  world: MonkeyWorld | null = null;
  private loop: NodeJS.Timeout | null = null;
  private w = new Writer(8192);
  private wk = new Writer(8192);
  /* đợt */
  wPhase = 0;
  wave = 0;
  phaseEnds = 0;
  toSpawn = 0;
  spawnAcc = 0;
  spec: WaveSpec | null = null;
  startedPlayers = 1;
  score = 0;
  startedAt = 0;
  /** nguồn thời gian (test mô phỏng thay bằng đồng hồ ảo) */
  clock: () => number = Date.now;
  /** true = không tự chạy vòng lặp (test gọi step()) */
  manual = false;
  /** đo đạc */
  bytesOut = 0;
  ticks = 0;
  tickMs = 0;
  private dirs = new Float64Array(64);
  private org = new Float64Array(3);
  private tmp2 = new Float64Array(2);
  private nextTickAt = 0;
  onEmpty: (() => void) | null = null;
  /** đo kiểm (test): kết quả từng viên đạn ở server */
  onPellet: ((idx: number, seq: number, k: number, slot: number, vt: number) => void) | null = null;

  constructor(code: string, solo: boolean) {
    this.code = code;
    this.solo = solo;
  }

  /* ======================= SẢNH ======================= */
  get count() {
    let n = 0;
    for (const p of this.players) if (p) n++;
    return n;
  }
  get online() {
    let n = 0;
    for (const p of this.players) if (p?.conn) n++;
    return n;
  }

  canJoin(): string | null {
    if (this.solo) return 'Phòng chơi đơn';
    if (this.phase !== 'lobby') return 'Phòng đang chơi';
    if (this.count >= MAX_PLAYERS) return 'Phòng đã đủ 4 người';
    return null;
  }

  add(name: string, cls: number, conn: MConn): MPlayer {
    const idx = this.players.findIndex((p) => !p);
    const p = new MPlayer(idx, name, cls, conn);
    this.players[idx] = p;
    if (this.count === 1) this.host = idx;
    p.send({ t: 'joined', code: this.code, pid: p.pid, token: p.token, idx, solo: this.solo });
    this.broadcastRoom();
    return p;
  }

  rejoin(pid: string, token: string, conn: MConn): MPlayer | null {
    const p = this.players.find((q) => q && q.pid === pid && q.token === token);
    if (!p) return null;
    if (p.conn && p.conn !== conn) p.conn.close();
    p.conn = conn;
    p.needKey = true;
    p.ack = 0;
    p.credit = CMD_BURST;
    p.send({ t: 'joined', code: this.code, pid: p.pid, token: p.token, idx: p.idx, solo: this.solo });
    this.broadcastRoom();
    if (this.phase === 'play') {
      p.send(this.startMsg());
      p.send(this.waveMsg());
    }
    return p;
  }

  leave(p: MPlayer) {
    if (this.phase === 'play') {
      // giữ nhân vật tới hết ván (bạn có thể quay lại), chỉ bỏ kết nối
      p.conn = null;
      p.discAt = this.clock();
    } else {
      this.players[p.idx] = null;
    }
    this.fixHost();
    this.broadcastRoom();
    this.checkEmpty();
  }

  disconnected(p: MPlayer) {
    p.conn = null;
    p.discAt = this.clock();
    this.fixHost();
    this.broadcastRoom();
    // sảnh: giữ chỗ 10 giây cho người rớt mạng
    if (this.phase !== 'play') {
      setTimeout(() => {
        if (!p.conn && this.players[p.idx] === p && this.phase !== 'play') {
          this.players[p.idx] = null;
          this.fixHost();
          this.broadcastRoom();
          this.checkEmpty();
        }
      }, 10000).unref?.();
    }
    this.checkEmpty();
  }

  private fixHost() {
    const h = this.players[this.host];
    if (h && h.conn) return;
    const nh = this.players.find((p) => p && p.conn);
    if (nh) this.host = nh.idx;
  }

  private checkEmpty() {
    if (this.online === 0) this.onEmpty?.();
  }

  setClass(p: MPlayer, cls: number) {
    if (this.phase !== 'lobby') return;
    if (!(cls >= 0 && cls < CLASSES.length)) return;
    p.cls = cls | 0;
    this.broadcastRoom();
  }

  /** chủ phòng đổi bản đồ trong sảnh */
  setMap(by: MPlayer, id: unknown) {
    if (this.phase !== 'lobby' || by.idx !== this.host || !isMapChoice(id) || id === this.mapChoice) return;
    this.mapChoice = id;
    this.broadcastRoom();
  }

  setReady(p: MPlayer, r: boolean) {
    if (this.phase !== 'lobby') return;
    p.ready = r;
    this.broadcastRoom();
  }

  lobbyPlayers(): LobbyPlayer[] {
    const out: LobbyPlayer[] = [];
    for (const p of this.players) if (p) out.push({ idx: p.idx, name: p.name, cls: p.cls, ready: p.ready, on: !!p.conn });
    return out;
  }

  broadcastRoom() {
    const m: SMsg = { t: 'room', code: this.code, phase: this.phase, solo: this.solo, host: this.host, players: this.lobbyPlayers(), map: this.mapChoice };
    this.broadcast(m);
  }

  broadcast(m: SMsg) {
    const s = JSON.stringify(m);
    for (const p of this.players) if (p?.conn) { p.conn.send(s); this.bytesOut += s.length; }
  }

  /* ======================= BẮT ĐẦU ======================= */
  start(by: MPlayer): string | null {
    if (this.phase !== 'lobby') return 'Trận đã bắt đầu';
    if (by.idx !== this.host) return 'Chỉ chủ phòng mới bắt đầu được';
    for (const p of this.players) if (p && p.idx !== this.host && p.conn && !p.ready) return 'Còn người chưa sẵn sàng';
    // bỏ người đã rời trong sảnh
    for (const p of this.players) if (p && !p.conn) this.players[p.idx] = null;
    this.begin();
    return null;
  }

  begin() {
    this.phase = 'play';
    // chốt bản đồ (ngẫu nhiên được bốc ở đây) rồi đặt làm bản đồ hiện hành trước khi dựng thế giới
    // MONKEY_MAP=lang ép bản đồ (chạy thử/chụp ảnh)
    const forced = process.env.MONKEY_MAP;
    const choice = forced && isMapChoice(forced) ? forced : this.mapChoice;
    this.mapDef = choice === MAP_RANDOM ? MAPS[Math.floor(Math.random() * MAPS.length)] : mapById(choice);
    setActiveMap(this.mapDef);
    this.world = new MonkeyWorld(this, (Math.random() * 0xffffffff) >>> 0);
    this.startedPlayers = Math.max(1, this.count);
    this.score = 0;
    // chỉ để chạy thử/chụp ảnh: MONKEY_START_WAVE=8 bắt đầu thẳng từ đợt 8 (kèm xu tương ứng)
    const sw = Math.max(1, Math.min(60, Number(process.env.MONKEY_START_WAVE) || 1));
    this.wave = sw - 1;
    this.startedAt = this.clock();
    for (const p of this.players) {
      if (!p) continue;
      const sp = PLAYER_SPAWNS[p.idx];
      p.st = newState(p.cls, sp.x, sp.z);
      p.st.yaw = (Math.round((Math.atan2(sp.x, sp.z) / (Math.PI * 2)) * 65536) & 0xffff);
      p.hpTier = 0;
      p.maxHp = maxHpOf(p.cls, 0);
      p.hp = p.maxHp;
      p.shield = 0;
      p.cash = START_CASH + (sw - 1) * 180;
      p.kills = p.ultKills = p.dmg = p.revives = p.earned = p.downs = 0;
      p.cdG = p.cdX = 0;
      p.ack = 0;
      p.credit = CMD_BURST;
      p.creditAt = this.clock();
      p.selfRevives = this.solo ? 1 : 0;
      p.autoReviveAt = 0;
      p.tauntUntil = p.rageUntil = 0;
      p.needKey = false;
      p.breakReady = false;
      p.ready = false;
    }
    this.world.players = this.players.filter((p): p is MPlayer => !!p);
    this.broadcastRoom();
    this.broadcast(this.startMsg());
    this.startBreak(FIRST_BREAK_SECS);
    this.paused = false;
    this.nextTickAt = this.clock() + AI_MS;
    if (!this.manual) this.loop = setInterval(() => this.pump(), 10);
  }

  private startMsg(): SMsg {
    return {
      t: 'start',
      seed: 0,
      players: this.players.filter((p): p is MPlayer => !!p).map((p) => ({ idx: p.idx, name: p.name, cls: p.cls })),
      tick: this.world?.tick ?? 0,
      map: this.mapDef.id,
    };
  }

  private waveMsg(): SMsg {
    const tick = this.world?.tick ?? 0;
    return {
      t: 'wave',
      n: this.wave,
      phase: this.wPhase === PH_FIGHT ? 'fight' : 'break',
      ends: this.clock() + Math.max(0, this.phaseEnds - tick) * AI_MS,
      total: this.spec?.total ?? 0,
      boss: !!this.spec?.boss,
      ready: this.players.filter((p) => p?.breakReady).map((p) => p!.idx),
    };
  }

  /** bơm tick cố định 20Hz (setInterval 10ms + bù trễ, không trôi) */
  private pump() {
    const now = this.clock();
    if (this.paused) {
      this.nextTickAt = now + AI_MS; // thế giới đứng yên, không dồn tick khi chạy tiếp
      return;
    }
    let n = 0;
    while (now >= this.nextTickAt && n < 4) {
      if (this.disposed || this.phase !== 'play' || !this.world) return;
      this.nextTickAt += AI_MS;
      try {
        this.tick();
      } catch (e) {
        // lỗi trong một phòng không được làm sập cả tiến trình (minigame chạy chung)
        console.error('[monkey] lỗi tick phòng', this.code, e);
        this.dispose();
        return;
      }
      n++;
    }
    if (now - this.nextTickAt > 1000) this.nextTickAt = now + AI_MS; // máy bị treo lâu: bỏ nhịp
  }

  /* ======================= ĐỢT ======================= */
  private startBreak(secs: number) {
    this.wPhase = PH_BREAK;
    this.phaseEnds = (this.world?.tick ?? 0) + secs * AI_HZ;
    for (const p of this.players) if (p) p.breakReady = false;
    this.broadcast(this.waveMsg());
  }

  private startWave() {
    const w = this.world!;
    this.wave++;
    this.wPhase = PH_FIGHT;
    const alivePlayers = Math.max(1, this.players.filter((p) => p && (p.conn || p.st.down === 0)).length);
    this.spec = waveSpec(this.wave, alivePlayers);
    this.toSpawn = this.spec.total;
    this.spawnAcc = this.spec.every; // thả con đầu ngay
    w.skillMul = 1 + 0.09 * (this.wave - 1);
    w.bossSummon = this.wave <= 5 ? 3 : this.wave <= 10 ? 4 : 5;
    if (this.spec.boss) {
      w.pickSpawn(this.tmp2);
      const s = w.spawn(MK_VUA, this.tmp2[0], this.tmp2[1], 1, this.spec.dmgMul, 1, bossHp(this.wave, alivePlayers));
      if (s >= 0) this.broadcast({ t: 'ev', k: 'boss', v: this.wave });
    }
    this.broadcast(this.waveMsg());
  }

  private waveCleared() {
    // chơi một mình không được chia xu từ đồng đội → thưởng đợt cao hơn
    const bonus = Math.round(waveBonus(this.wave) * (this.solo ? 1.5 : 1));
    this.score += bonus * 2;
    for (const p of this.players) {
      if (!p) continue;
      p.cash += bonus;
      p.earned += bonus;
      if (p.st.down === 1) this.revive(p, -1, REVIVE_HP);
      else if (p.st.down === 2) {
        const sp = PLAYER_SPAWNS[p.idx];
        p.st.x = sp.x;
        p.st.z = sp.z;
        p.st.vx = p.st.vz = p.st.vy = p.st.y = 0;
        p.st.ground = 1;
        p.st.down = 0;
        p.hp = Math.round(p.maxHp * 0.5);
        p.reviveProg = 0;
        this.broadcast({ t: 'ev', k: 'respawn', i: p.idx });
      }
      if (this.solo && this.spec?.boss) p.selfRevives = Math.min(2, p.selfRevives + 1);
    }
    this.broadcast({ t: 'ev', k: 'clear', v: this.wave, j: bonus });
    this.startBreak(BREAK_SECS);
  }

  setBreakReady(p: MPlayer, r: boolean) {
    if (this.phase !== 'play' || this.wPhase !== PH_BREAK) return;
    p.breakReady = r;
    const w = this.world!;
    const live = this.players.filter((q) => q && q.conn);
    if (live.length > 0 && live.every((q) => q!.breakReady)) {
      this.phaseEnds = Math.min(this.phaseEnds, w.tick + 3 * AI_HZ);
    }
    this.broadcast(this.waveMsg());
  }

  private pickType(): number {
    const ws = this.spec!.weights;
    let sum = 0;
    for (const x of ws) sum += x;
    let r = this.world!.rng() * sum;
    for (let i = 0; i < ws.length; i++) {
      r -= ws[i];
      if (r <= 0) return i;
    }
    return 0;
  }

  /* ======================= VÒNG 20Hz ======================= */
  /** chạy một tick (test mô phỏng) */
  step() {
    if (this.phase === 'play') this.tick();
  }

  private tick() {
    if (!this.world) return;
    setActiveMap(this.mapDef); // nhiều phòng chung một tiến trình
    const t0 = performance.now();
    const w = this.world;
    w.update();
    const tick = w.tick;
    const spec = this.spec;

    // ---- đợt ----
    if (this.wPhase === PH_BREAK) {
      if (tick >= this.phaseEnds) this.startWave();
    } else if (this.wPhase === PH_FIGHT && spec) {
      this.spawnAcc += 1 / AI_HZ;
      let guard = 0;
      while (this.toSpawn > 0 && this.spawnAcc >= spec.every && w.count < spec.maxAlive && guard++ < 4) {
        this.spawnAcc -= spec.every;
        w.pickSpawn(this.tmp2);
        const type = this.pickType();
        if (w.spawn(type, this.tmp2[0], this.tmp2[1], spec.hpMul, spec.dmgMul, spec.spdMul) >= 0) this.toSpawn--;
        else break;
      }
      if (this.spawnAcc > spec.every * 2) this.spawnAcc = spec.every * 2;
      if (this.toSpawn === 0 && w.count === 0) this.waveCleared();
    }

    // ---- người chơi ----
    let standing = 0;
    for (const p of this.players) {
      if (!p) continue;
      if (p.st.down === 0) {
        standing++;
        // hồi máu: y sĩ luôn hồi; ai cũng tự hồi sau 5 giây không bị đánh
        const cls = CLASSES[p.cls];
        let regen = cls.regen;
        if (tick - p.lastHurt > 5 * AI_HZ) regen += 4;
        if (regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + regen / AI_HZ);
        if (p.rageUntil && tick > p.rageUntil) { p.rageUntil = 0; p.shield = 0; }
      } else if (p.st.down === 1) {
        if (tick - p.reviveTick > 3) p.reviveProg = Math.max(0, p.reviveProg - 0.02);
        if (p.autoReviveAt && tick >= p.autoReviveAt) {
          p.autoReviveAt = 0;
          p.selfRevives--;
          this.revive(p, p.idx, 0.6);
          standing++;
        } else if (tick >= p.bleedUntil) {
          p.st.down = 2;
          p.reviveProg = 0;
          this.broadcast({ t: 'ev', k: 'dead', i: p.idx });
        }
      }
      p.reviving = false;
    }
    // cả đội gục → hết ván
    if (this.wPhase === PH_FIGHT && standing === 0) {
      this.sendSnapshot();
      this.gameOver();
      return;
    }

    this.sendSnapshot();
    this.ticks++;
    this.tickMs = performance.now() - t0;

    // không còn ai kết nối trong 60 giây → giải tán
    if (this.online === 0) {
      const last = Math.max(...this.players.map((p) => (p ? p.discAt : 0)));
      if (this.clock() - last > 60000) this.dispose();
    }
  }

  /* ======================= TẠM DỪNG (chỉ chơi đơn) ======================= */
  paused = false;
  setPaused(on: boolean) {
    if (!this.solo || this.phase !== 'play' || this.paused === on) return;
    this.paused = on;
    this.broadcast({ t: 'paused', p: on });
    // hạn giờ đợt tính theo đồng hồ thật → gửi lại sau khi chạy tiếp
    if (!on) this.broadcast(this.waveMsg());
  }

  /* ======================= LỆNH NGƯỜI CHƠI ======================= */
  onCmds(p: MPlayer, cmds: Cmd[], n: number) {
    if (this.phase !== 'play' || !this.world || this.paused) return;
    setActiveMap(this.mapDef);
    const now = this.clock();
    p.credit = Math.min(CMD_BURST, p.credit + ((now - p.creditAt) / 1000) * CMD_RATE);
    p.creditAt = now;
    for (let i = 0; i < n; i++) {
      const c = cmds[i];
      if (c.seq <= p.ack) continue; // trùng
      if (p.credit < 1) break; // nhanh hơn thời gian thực → bỏ (client sẽ được hoà giải)
      p.credit -= 1;
      p.cmdsRun++;
      this.applyCmd(p, c);
    }
  }

  private applyCmd(p: MPlayer, c: Cmd) {
    const w = this.world!;
    const f = step(p.st, c);
    p.ack = c.seq;
    p.btn = c.btn;
    if (f & F_FIRED) this.fireShot(p, c);
    if (p.st.down === 0) {
      if (c.btn & P_G) this.useG(p);
      if (c.btn & P_X) this.useX(p);
      if (c.btn & P_Q) this.useQ(p);
      if (c.btn & P_V) this.buy(p, 'weapon');
      if (c.btn & P_C) this.buy(p, 'hp');
      if (c.btn & B_USE) this.tryRevive(p, w.tick);
    }
  }

  private fireShot(p: MPlayer, c: Cmd) {
    const w = this.world!;
    const wd = weaponOf(p.cls, p.st.tier);
    const cls = CLASSES[p.cls];
    const mul = cls.dmgMul * (p.st.braceT > 0 ? cls.buff.dmg : 1);
    shotOrigin(p.st, this.org);
    const n = pelletDirs(p.st, c, p.idx, this.dirs);
    // thời điểm người bắn nhìn thấy: kẹp trong [now - LAG_COMP, now]
    let vt = c.vt / 16;
    const now = w.tick;
    if (!(vt <= now)) vt = now;
    if (vt < now - LAG_COMP_TICKS) vt = now - LAG_COMP_TICKS;
    const ox = this.org[0], oy = this.org[1], oz = this.org[2];
    let firstDist = wd.range;
    for (let k = 0; k < n; k++) {
      const dx = this.dirs[k * 3], dy = this.dirs[k * 3 + 1], dz = this.dirs[k * 3 + 2];
      const hits = w.traceRewind(ox, oy, oz, dx, dy, dz, wd.range, vt, 1 + wd.pierce);
      const end = hits > 0 ? w.rayT[0] : w.rayObs;
      p.statPellets++;
      if (hits > 0) p.statHits++;
      this.onPellet?.(p.idx, c.seq, k, hits > 0 ? w.raySlot[0] : -1, vt);
      if (k === 0) firstDist = end;
      for (let h = 0; h < hits; h++) {
        const sl = w.raySlot[h];
        const dist = w.rayT[h];
        let dmg = wd.dmg * mul;
        if (dist > wd.falloff) dmg *= 1 - 0.6 * Math.min(1, (dist - wd.falloff) / Math.max(1, wd.range - wd.falloff));
        if (w.rayCrit[h]) dmg *= cls.headMul;
        if (h > 0) dmg *= 0.7; // xuyên giảm sát thương
        p.dmg += Math.min(dmg, Math.max(0, w.hp[sl]));
        w.damage(sl, dmg, p.idx, w.rayCrit[h], CAUSE_SHOT);
      }
      if (wd.splashR > 0) {
        // pháo chuối: nổ tại điểm chạm
        const t = end;
        const ex = ox + dx * t, ez = oz + dz * t;
        w.explode(ex, ez, wd.splashR * cls.splashMul, wd.splashDmg * mul, p.idx, 0);
      }
    }
    w.addShot(p.idx, p.st.yaw, p.st.pitch, firstDist);
  }

  /* ======================= KỸ NĂNG ======================= */
  private canSkill(p: MPlayer, cdUntil: number, cost: number): boolean {
    const w = this.world!;
    if (w.tick < cdUntil) return false;
    if (p.cash < cost) {
      p.send({ t: 'ev', k: 'nocash', v: cost });
      return false;
    }
    return true;
  }

  private useG(p: MPlayer) {
    const w = this.world!;
    const cls = CLASSES[p.cls];
    if (!this.canSkill(p, p.cdG, cls.g.cost)) return;
    p.cash -= cls.g.cost;
    p.cdG = w.tick + Math.round(cls.g.cd * AI_HZ);
    const sm = w.skillMul;
    const st = p.st;
    switch (cls.id) {
      case 'chienbinh': {
        shotOrigin(st, this.org);
        aimDir(st.yaw, Math.min(14000, st.pitch + 1800), this.dirs);
        w.spawnProjectile(PJ_GRENADE, p.idx, this.org[0], this.org[1], this.org[2], this.dirs[0] * 17 + st.vx * 0.5, this.dirs[1] * 17 + 3, this.dirs[2] * 17 + st.vz * 0.5, 1.1, 150 * sm);
        break;
      }
      case 'ysi': {
        this.heal(p.idx, 35 * sm);
        w.addFx(FX_HEAL, st.x, st.z, p.idx, 35);
        let best: MPlayer | null = null;
        let bd = 36;
        for (const q of this.players) {
          if (!q || q === p || q.st.down) continue;
          const d = (q.st.x - st.x) ** 2 + (q.st.z - st.z) ** 2;
          if (d < bd) { bd = d; best = q; }
        }
        if (best) { this.heal(best.idx, 35 * sm); w.addFx(FX_HEAL, best.st.x, best.st.z, best.idx, 35); }
        break;
      }
      case 'kysu': {
        for (const e of w.ents) {
          if (e.owner !== p.idx || (e.kind !== EN_TURRET && e.kind !== EN_BARRICADE)) continue;
          if ((e.x - st.x) ** 2 + (e.z - st.z) ** 2 > 100) continue;
          e.until = Math.min(w.tick + 60 * AI_HZ, e.until + 20 * AI_HZ);
          w.addFx(FX_REPAIR, e.x, e.z, 0, 0);
        }
        w.addFx(FX_REPAIR, st.x, st.z, 1, 0);
        break;
      }
      case 'dausi': {
        w.addFx(FX_STOMP, st.x, st.z, 50, p.idx);
        for (let i = 0; i < w.alive.length; i++) {
          if (!w.alive[i]) continue;
          const dx = w.x[i] - st.x, dz = w.z[i] - st.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 25) continue;
          const d = Math.sqrt(d2) || 1;
          w.kx[i] += (dx / d) * 11;
          w.kz[i] += (dz / d) * 11;
          if (w.type[i] !== MK_VUA) { w.st[i] = ST_STUN; w.stT[i] = 1; }
          p.dmg += 80 * sm;
          w.damage(i, 80 * sm, p.idx, 0, CAUSE_SKILL);
        }
        break;
      }
      case 'xathu': {
        // bom choáng: nổ hẹn giờ tại điểm ngắm
        this.aimGround(st, 22, this.tmp2);
        w.booms.push({ x: this.tmp2[0], z: this.tmp2[1], at: w.tick + Math.round(0.6 * AI_HZ), r: 5, dmg: 40 * sm, owner: p.idx, stun: 2.5 });
        break;
      }
      case 'phaothu': {
        // bom chùm: 3 lựu đạn toả hình quạt
        shotOrigin(st, this.org);
        for (let k = -1; k <= 1; k++) {
          aimDir((st.yaw + k * 2400) & 0xffff, Math.min(14000, st.pitch + 1800), this.dirs);
          w.spawnProjectile(PJ_GRENADE, p.idx, this.org[0], this.org[1], this.org[2], this.dirs[0] * 16 + st.vx * 0.5, this.dirs[1] * 16 + 3, this.dirs[2] * 16 + st.vz * 0.5, 1.1, 90 * sm);
        }
        break;
      }
      case 'caoboi': {
        // quạt súng: tự ngắm 6 khỉ gần nhất phía trước có tầm nhìn
        const wd = weaponOf(p.cls, st.tier);
        const per = wd.dmg * wd.pellets * cls.dmgMul * 2.2;
        const fx = isin(st.yaw), fz = icos(st.yaw);
        shotOrigin(st, this.org);
        const ox = this.org[0], oy = this.org[1], oz = this.org[2];
        const pick: number[] = [];
        const pd: number[] = [];
        for (let i = 0; i < w.alive.length; i++) {
          if (!w.alive[i]) continue;
          const dx = w.x[i] - st.x, dz = w.z[i] - st.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 22 * 22 || dx * fx + dz * fz < 0) continue;
          let k = pick.length;
          if (k >= 6 && d2 >= pd[5]) continue;
          if (k >= 6) { pick.pop(); pd.pop(); k = 5; }
          while (k > 0 && pd[k - 1] > d2) k--;
          pick.splice(k, 0, i);
          pd.splice(k, 0, d2);
        }
        for (const i of pick) {
          const ty = bodyY(w.type[i]);
          const dx = w.x[i] - ox, dy = ty - oy, dz = w.z[i] - oz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          if (rayWorld(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist) < dist - 0.6) continue; // bị che
          const yaw16 = Math.round((Math.atan2(dx, dz) / (Math.PI * 2)) * 65536) & 0xffff;
          const pitch16 = Math.round((Math.asin(dy / dist) / (Math.PI * 2)) * 65536);
          w.addShot(p.idx, yaw16, pitch16, dist);
          p.dmg += Math.min(per, Math.max(0, w.hp[i]));
          w.damage(i, per, p.idx, 0, CAUSE_SHOT);
        }
        break;
      }
    }
    this.broadcast({ t: 'ev', k: 'skill', i: p.idx, s: 'g' });
  }

  private useX(p: MPlayer) {
    const w = this.world!;
    const cls = CLASSES[p.cls];
    if (!this.canSkill(p, p.cdX, cls.x.cost)) return;
    const st = p.st;
    const fx = isin(st.yaw), fz = icos(st.yaw);
    const yawRad = (st.yaw / 65536) * Math.PI * 2;
    switch (cls.id) {
      case 'chienbinh': {
        collide(st.x + fx * 2.6, st.z + fz * 2.6, 0.3, this.tmp2);
        w.addEnt(EN_BARRICADE, p.idx, this.tmp2[0], this.tmp2[1], yawRad, 30);
        w.addFx(FX_BUILD, this.tmp2[0], this.tmp2[1], EN_BARRICADE, 0);
        break;
      }
      case 'ysi': {
        w.addEnt(EN_POD, p.idx, st.x, st.z, 0, 12);
        w.addFx(FX_BUILD, st.x, st.z, EN_POD, 0);
        break;
      }
      case 'kysu': {
        const mine = w.ents.filter((e) => e.kind === EN_TURRET && e.owner === p.idx && e.born >= 0);
        if (mine.length >= 2) {
          const old = mine[0];
          w.ents.splice(w.ents.indexOf(old), 1);
        }
        collide(st.x + fx * 1.6, st.z + fz * 1.6, 0.5, this.tmp2);
        w.addEnt(EN_TURRET, p.idx, this.tmp2[0], this.tmp2[1], yawRad, 45, this.turretPower(p));
        w.addFx(FX_BUILD, this.tmp2[0], this.tmp2[1], EN_TURRET, 0);
        break;
      }
      case 'dausi': {
        st.braceT = 5 * TICK_HZ;
        break;
      }
      case 'xathu': {
        // mắt ưng: braceT = bắn không tốn đạn + tăng sát thương (xem ClassDef.buff)
        st.braceT = 6 * TICK_HZ;
        break;
      }
      case 'phaothu': {
        // pháo cối: 5 quả rơi quanh điểm ngắm
        this.aimGround(st, 30, this.tmp2);
        const cx = this.tmp2[0], cz = this.tmp2[1];
        const sm = w.skillMul;
        for (let k = 0; k < 5; k++) {
          const a = k * 1.2566 + w.rng() * 0.5;
          const r = k === 0 ? 0 : 2.6;
          collide(cx + Math.sin(a) * r, cz + Math.cos(a) * r, 0.2, this.tmp2);
          w.booms.push({ x: this.tmp2[0], z: this.tmp2[1], at: w.tick + AI_HZ + k * 3, r: 3, dmg: 110 * sm, owner: p.idx });
        }
        break;
      }
      case 'caoboi': {
        // hất cát: nón 8m (nửa góc ~50°) — sát thương, đẩy lùi, choáng 2 giây
        const sm = w.skillMul;
        w.addFx(FX_STOMP, st.x + fx * 2, st.z + fz * 2, 40, p.idx);
        for (let i = 0; i < w.alive.length; i++) {
          if (!w.alive[i]) continue;
          const dx = w.x[i] - st.x, dz = w.z[i] - st.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 64) continue;
          const d = Math.sqrt(d2) || 1;
          if ((dx * fx + dz * fz) / d < 0.64) continue;
          w.kx[i] += (dx / d) * 9;
          w.kz[i] += (dz / d) * 9;
          p.dmg += 25 * sm;
          w.damage(i, 25 * sm, p.idx, 0, CAUSE_SKILL);
        }
        w.stunArea(st.x, st.z, 8, 2, fx, fz, 0.64);
        break;
      }
    }
    p.cash -= cls.x.cost;
    p.cdX = w.tick + Math.round(cls.x.cd * AI_HZ);
    this.broadcast({ t: 'ev', k: 'skill', i: p.idx, s: 'x' });
  }

  /** điểm trên mặt đất theo hướng ngắm (tối đa maxD m ngang, dừng ở vật cản) */
  private aimGround(st: PState, maxD: number, out: Float64Array) {
    shotOrigin(st, this.org);
    aimDir(st.yaw, st.pitch, this.dirs);
    const ox = this.org[0], oy = this.org[1], oz = this.org[2];
    const dx = this.dirs[0], dy = this.dirs[1], dz = this.dirs[2];
    const hl = Math.sqrt(dx * dx + dz * dz) || 1;
    let t = maxD / hl;
    if (dy < -0.01) t = Math.min(t, oy / -dy);
    t = Math.min(t, rayWorld(ox, oy, oz, dx, dy, dz, t));
    t = Math.max(t - 0.4, 0);
    collide(ox + dx * t, oz + dz * t, 0.3, out);
  }

  private turretPower(p: MPlayer) {
    return 11 * (1 + 0.35 * p.st.tier) * Math.sqrt(this.world!.skillMul);
  }

  private useQ(p: MPlayer) {
    const w = this.world!;
    if (p.ultKills < ULT_KILLS) return;
    p.ultKills = 0;
    const st = p.st;
    const cls = CLASSES[p.cls];
    const sm = w.skillMul;
    const yawRad = (st.yaw / 65536) * Math.PI * 2;
    switch (cls.id) {
      case 'chienbinh':
        w.addEnt(EN_FLARE, p.idx, st.x, st.z, yawRad, 1.2, 240 * sm);
        break;
      case 'ysi':
        for (const q of this.players) {
          if (!q) continue;
          if (q.st.down === 1) this.revive(q, p.idx, 1);
          else if (q.st.down === 0) q.hp = q.maxHp;
          w.addFx(FX_HEAL, q.st.x, q.st.z, q.idx, 200);
        }
        break;
      case 'kysu': {
        w.overclockUntil[p.idx] = w.tick + 12 * AI_HZ;
        const fx = isin(st.yaw), fz = icos(st.yaw);
        collide(st.x - fx * 1.4, st.z - fz * 1.4, 0.5, this.tmp2);
        // trụ miễn phí (power âm = không tính vào giới hạn 2 trụ)
        const e = w.addEnt(EN_TURRET, p.idx, this.tmp2[0], this.tmp2[1], yawRad, 20, this.turretPower(p));
        e.born = -1; // trụ miễn phí: không tính vào giới hạn 2 trụ
        w.addFx(FX_BUILD, this.tmp2[0], this.tmp2[1], EN_TURRET, 1);
        break;
      }
      case 'dausi':
        p.tauntUntil = w.tick + 8 * AI_HZ;
        p.rageUntil = w.tick + 8 * AI_HZ;
        p.shield = 100;
        for (let i = 0; i < w.alive.length; i++) {
          if (!w.alive[i]) continue;
          if ((w.x[i] - st.x) ** 2 + (w.z[i] - st.z) ** 2 < 18 * 18) w.tauntBy[i] = p.idx;
        }
        w.addFx(5, st.x, st.z, 1, p.idx);
        break;
      case 'xathu': {
        // phát bắn thần: một tia xuyên tối đa 16 khỉ tới khi chạm vật cản
        shotOrigin(st, this.org);
        aimDir(st.yaw, st.pitch, this.dirs);
        const ox = this.org[0], oy = this.org[1], oz = this.org[2];
        const hits = w.traceRewind(ox, oy, oz, this.dirs[0], this.dirs[1], this.dirs[2], 160, w.tick, 16);
        for (let h = 0; h < hits; h++) {
          const sl = w.raySlot[h];
          const dmg = 900 * sm * (w.rayCrit[h] ? 1.5 : 1);
          p.dmg += Math.min(dmg, Math.max(0, w.hp[sl]));
          w.damage(sl, dmg, p.idx, w.rayCrit[h], CAUSE_SKILL);
        }
        w.addShot(p.idx, st.yaw, st.pitch, Math.min(255, w.rayObs));
        break;
      }
      case 'phaothu': {
        // mưa pháo: 20 quả rải trong 4 giây quanh người
        for (let k = 0; k < 20; k++) {
          const a = w.rng() * Math.PI * 2;
          const r = 2 + Math.sqrt(w.rng()) * 14;
          collide(st.x + Math.sin(a) * r, st.z + Math.cos(a) * r, 0.2, this.tmp2);
          w.booms.push({ x: this.tmp2[0], z: this.tmp2[1], at: w.tick + 6 + k * 4, r: 3.6, dmg: 200 * sm, owner: p.idx });
        }
        w.addFx(5, st.x, st.z, 1, p.idx);
        break;
      }
      case 'caoboi':
        // thần tốc: braceT = bắn nhanh ×2,5, không tốn đạn, +20% sát thương (xem ClassDef.buff)
        st.braceT = 8 * TICK_HZ;
        st.fireCd = 0;
        break;
    }
    this.broadcast({ t: 'ev', k: 'ult', i: p.idx });
  }

  buy(p: MPlayer, item: 'weapon' | 'hp') {
    if (this.phase !== 'play' || p.st.down) return;
    if (item === 'weapon') {
      if (p.st.tier >= MAX_TIER) return;
      const cost = weaponOf(p.cls, p.st.tier + 1).cost;
      if (p.cash < cost) return p.send({ t: 'ev', k: 'nocash', v: cost });
      p.cash -= cost;
      p.st.tier++;
      p.st.ammo = weaponOf(p.cls, p.st.tier).mag;
      p.st.reloadT = 0;
      p.st.fireCd = 0;
      this.broadcast({ t: 'ev', k: 'buy', i: p.idx, s: 'weapon', v: p.st.tier });
    } else {
      if (p.hpTier >= MAX_HP_TIER) return;
      const cost = HP_TIER_COST[p.hpTier + 1];
      if (p.cash < cost) return p.send({ t: 'ev', k: 'nocash', v: cost });
      p.cash -= cost;
      p.hpTier++;
      p.maxHp = maxHpOf(p.cls, p.hpTier);
      p.hp = Math.min(p.maxHp, p.hp + HP_TIER_BONUS + 20);
      this.broadcast({ t: 'ev', k: 'buy', i: p.idx, s: 'hp', v: p.hpTier });
    }
  }

  /* ======================= ĐỠ DẬY ======================= */
  private tryRevive(p: MPlayer, tick: number) {
    let best: MPlayer | null = null;
    let bd = REVIVE_RANGE * REVIVE_RANGE;
    for (const q of this.players) {
      if (!q || q === p || q.st.down !== 1) continue;
      const d = (q.st.x - p.st.x) ** 2 + (q.st.z - p.st.z) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
    if (!best) return;
    p.reviving = true;
    best.reviveTick = tick;
    best.reviveProg += CLASSES[p.cls].reviveMul / (REVIVE_SECS * TICK_HZ);
    if (best.reviveProg >= 1) {
      this.revive(best, p.idx, REVIVE_HP);
      p.revives++;
      p.cash += 25;
      p.earned += 25;
    }
  }

  private revive(p: MPlayer, by: number, frac: number) {
    p.st.down = 0;
    p.hp = Math.max(1, Math.round(p.maxHp * frac));
    p.reviveProg = 0;
    p.autoReviveAt = 0;
    p.lastHurt = this.world?.tick ?? 0;
    this.broadcast({ t: 'ev', k: 'revived', i: p.idx, j: by });
  }

  /* ======================= WorldHost ======================= */
  hurt(idx: number, dmg: number, sx: number, sz: number, kind: number) {
    const p = this.players[idx];
    const w = this.world;
    if (!p || !w || p.st.down || this.wPhase !== PH_FIGHT) return;
    const cls = CLASSES[p.cls];
    let d = dmg * (1 - cls.armor);
    if (p.st.braceT > 0) d *= 1 - cls.buff.armor;
    if (kind === MK_NO && cls.id === 'phaothu') d *= 0.7; // pháo thủ kháng nổ
    if (p.rageUntil > w.tick) d *= 0.5;
    if (p.shield > 0) {
      const a = Math.min(p.shield, d);
      p.shield -= a;
      d -= a;
    }
    p.hp -= d;
    p.lastHurt = w.tick;
    w.addFx(FX_PLAYERHIT, sx, sz, idx, Math.min(65535, Math.round(dmg)) | (kind << 10));
    if (p.hp <= 0) {
      p.hp = 0;
      p.st.down = 1;
      p.st.reloadT = 0;
      p.downs++;
      p.bleedUntil = w.tick + BLEED_SECS * AI_HZ;
      p.reviveProg = 0;
      if (this.solo && p.selfRevives > 0) p.autoReviveAt = w.tick + 5 * AI_HZ;
      this.broadcast({ t: 'ev', k: 'down', i: idx, v: p.selfRevives });
    }
  }

  killed(_slot: number, type: number, killer: number, _cause: number, x: number, z: number) {
    const def = MONKEYS[type];
    const w = this.world!;
    this.score += def.reward;
    if (type === MK_VUA) {
      for (const p of this.players) if (p) { p.cash += def.reward; p.earned += def.reward; }
      this.broadcast({ t: 'ev', k: 'bossdown', i: killer });
    } else if (killer >= 0 && killer < 4) {
      const share = Math.round(def.reward * TEAM_SHARE);
      for (const p of this.players) {
        if (!p) continue;
        if (p.idx === killer) { p.cash += def.reward; p.earned += def.reward; }
        else { p.cash += share; p.earned += share; }
      }
    }
    const k = killer >= 0 && killer < 4 ? this.players[killer] : null;
    if (k) { k.kills++; k.ultKills++; }
    // rơi vật phẩm: chuối hồi máu / túi xu
    if (w.rng() < (type === MK_DOT ? 0.35 : 0.035)) {
      const e = w.addEnt(EN_PICKUP, 255, x, z, 0, 20);
      e.cd = w.rng() < 0.55 ? 0 : 1;
    }
  }

  heal(idx: number, amount: number) {
    const p = this.players[idx];
    if (!p || p.st.down) return;
    p.hp = Math.min(p.maxHp, p.hp + amount);
  }

  pickup(idx: number, kind: number) {
    const p = this.players[idx];
    if (!p) return;
    if (kind === 0) {
      this.heal(idx, p.maxHp * 0.3);
    } else {
      // túi xu chia cả đội
      for (const q of this.players) if (q) { q.cash += 50; q.earned += 50; }
    }
  }

  /* ======================= SNAPSHOT ======================= */
  private writeHeader(w: Writer, key: boolean) {
    const world = this.world!;
    w.reset();
    w.u8(BIN_SNAP);
    w.u32(world.tick);
    w.u8(key ? 1 : 0);
    w.u8(this.wPhase);
    w.u16(this.wave);
    w.u16(Math.min(65535, this.toSpawn + world.count));
    w.u16(world.bossRatio());
    const ps = this.players.filter((p): p is MPlayer => !!p);
    w.u8(ps.length);
    for (const p of ps) {
      const st = p.st;
      let fl = st.down & 3;
      if (st.ground) fl |= PF_GROUND;
      if (p.btn & B_ADS) fl |= PF_ADS;
      if (st.down === 0 && isSprinting(st, { seq: 0, mx: 0, mz: 127, yaw: 0, pitch: 0, btn: p.btn, vt: 0 }) && st.vx * st.vx + st.vz * st.vz > 30) fl |= PF_SPRINT;
      if (p.reviving) fl |= PF_REVIVING;
      if (p.conn) fl |= PF_ON;
      if (st.braceT > 0) fl |= PF_BRACE;
      w.u8(p.idx);
      w.u8(fl);
      w.u8(p.cls);
      w.u8((st.tier & 15) | (p.hpTier << 4));
      w.f32(st.x);
      w.f32(st.z);
      w.f32(st.y);
      w.f32(st.vx);
      w.f32(st.vz);
      w.f32(st.vy);
      w.u16(st.yaw);
      w.i16(st.pitch);
      w.u32(p.ack);
      w.u16(Math.ceil(p.hp));
      w.u16(p.maxHp);
      w.u16(Math.ceil(p.shield));
      w.u8(st.ammo);
      w.u16(st.fireCd);
      w.u8(Math.min(255, st.reloadT));
      w.u16(st.braceT);
      w.u8(Math.max(0, Math.min(255, Math.ceil((p.cdG - world.tick) / 2))));
      w.u8(Math.max(0, Math.min(255, Math.ceil((p.cdX - world.tick) / 2))));
      w.u8(Math.min(255, Math.floor((p.ultKills / ULT_KILLS) * 255)));
      w.u8(Math.min(255, Math.floor(p.reviveProg * 255)));
      w.u8(st.down === 1 ? Math.max(0, Math.ceil((p.bleedUntil - world.tick) / AI_HZ)) : 0);
      w.u32(Math.floor(p.cash));
      w.u16(Math.min(65535, p.kills));
    }
  }

  private sendSnapshot() {
    const world = this.world!;
    this.writeHeader(this.w, false);
    world.encodeMonkeys(this.w, false);
    const buf = this.w.bytes();
    let keyBuf: Uint8Array | null = null;
    for (const p of this.players) {
      if (!p?.conn) continue;
      if (p.needKey) {
        if (!keyBuf) {
          this.writeHeader(this.wk, true);
          world.encodeMonkeys(this.wk, true);
          keyBuf = this.wk.bytes();
        }
        p.conn.send(keyBuf);
        this.bytesOut += keyBuf.length;
        p.needKey = false;
      } else {
        p.conn.send(buf);
        this.bytesOut += buf.length;
      }
    }
    world.clearEvents();
  }

  /* ======================= KẾT THÚC ======================= */
  private gameOver() {
    const secs = Math.round((this.clock() - this.startedAt) / 1000);
    const ps = this.players.filter((p): p is MPlayer => !!p);
    const kills = ps.reduce((a, p) => a + p.kills, 0);
    const entry: BoardEntry = {
      names: ps.map((p) => p.name),
      cls: ps.map((p) => p.cls),
      wave: this.wave,
      score: Math.round(this.score),
      kills,
      players: this.startedPlayers,
      at: this.clock(),
    };
    const rank = this.wave > 0 ? submitRun(entry) : 0;
    const stats: EndStat[] = ps.map((p) => ({
      idx: p.idx, name: p.name, cls: p.cls, kills: p.kills, dmg: Math.round(p.dmg), revives: p.revives, earned: Math.round(p.earned), downs: p.downs,
    }));
    this.stopLoop();
    this.phase = 'over';
    this.wPhase = PH_OVER;
    this.broadcast({
      t: 'over', wave: this.wave, score: entry.score, kills, rank, secs, stats,
      board: topRuns(this.startedPlayers <= 1, 10),
    });
    this.broadcastRoom();
    // giải phóng thế giới (bộ nhớ) ngay khi hết ván
    this.world?.reset();
    this.world = null;
    // không còn ai xem tổng kết → giải tán phòng luôn
    if (this.online === 0) this.dispose();
  }

  /** về sảnh để chơi lại */
  again(p: MPlayer) {
    if (this.phase !== 'over') return;
    this.phase = 'lobby';
    for (const q of this.players) if (q && !q.conn) this.players[q.idx] = null;
    this.fixHost();
    for (const q of this.players) if (q) q.ready = false;
    this.broadcastRoom();
    if (this.solo && p.conn) this.begin();
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  disposed = false;
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.phase = 'over';
    this.stopLoop();
    this.world?.reset();
    this.world = null;
    for (const p of this.players) if (p?.conn) p.send({ t: 'left' });
    this.players = [null, null, null, null];
    this.onEmpty?.();
  }
}
