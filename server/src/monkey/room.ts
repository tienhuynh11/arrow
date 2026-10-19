// Một phòng SINH TỒN BẦY KHỈ: sảnh (chọn lớp, sẵn sàng) → trận (đợt/nghỉ) → tổng kết.
// Người chơi: xử lý lệnh NGAY khi tới (bước sim 60Hz xác định, bù trễ khi bắn).
// Khỉ + kinh tế + đợt: vòng 20Hz; snapshot nhị phân mã hoá một lần, gửi chung cả phòng.

import { randomUUID } from 'node:crypto';
import type { RunReward, RunRewardItem } from '../../../shared/monkey/api.js';
import { AI_HZ, AI_MS, CHAT_MAX, LAG_COMP_TICKS, MAX_PLAYERS, TICK_HZ } from '../../../shared/monkey/config.js';
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
  teamShare,
  ULT_KILLS,
  bodyY,
  bossHp,
  maxHpOf,
  waveBonus,
  waveSpec,
  weaponOf,
  type WaveSpec,
  type WeaponDef,
} from '../../../shared/monkey/content.js';
import type { ConsumableEffect, ExtractResult, GroundLoot, LootDrop } from '../../../shared/monkey/gear.js';
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
  MAX_MAG,
  SPD_Q,
  ST_STUN,
  Writer,
  type EndStat,
  type LobbyPlayer,
  type QuickSlot,
  type RoomMode,
  type SMsg,
  type StartPlayer,
} from '../../../shared/monkey/proto.js';
import {
  B_ADS,
  B_USE,
  F_FIRED,
  P_C,
  P_G,
  P_K,
  P_Q,
  P_V,
  P_U1,
  P_U2,
  P_X,
  aimDir,
  curWeapon,
  isSprinting,
  newState,
  pelletDirs,
  shotOrigin,
  step,
  type Cmd,
  type PState,
} from '../../../shared/monkey/sim.js';
import {
  BASE_KNIFE_DMG,
  EVENT_STAGES,
  STAGES,
  STAGE_BY_ID,
  rollDrops,
  rollKillLoots,
  simModsOf,
  skillCostMul,
  skillPower,
  stageUnlocked,
  type ItemInst,
  type Loadout,
  type SkillKey,
  type StageDef,
  type Stats,
} from '../../../shared/monkey/progression.js';
import type { StatKey2 } from '../../../shared/monkey/gear.js';
import { getStore } from './db/index.js';
import { cryptoRng } from './db/rules.js';
import type { ExtractRun, RunResult, Store } from './db/store.js';
import { submitRun, topRuns } from './leaderboard.js';
import { CAUSE_SHOT, CAUSE_SKILL, MonkeyWorld, type WorldHost } from './world.js';

/** dao: tầm (m, tính tới mép thân khỉ), nửa góc nón, hồi chiêu (giây), góc coi là "sau lưng" */
export const KNIFE_RANGE = 2.2;
export const KNIFE_HALF_DEG = 50;
export const KNIFE_CD = 0.6;
export const KNIFE_BACK_DEG = 120;
/** chờ ghi kết quả trận tối đa bao lâu trước khi gửi tổng kết (ms) */
export const REWARD_WAIT_MS = 4000;
/* ---- ải: mang đồ vào, nhặt đồ rơi ---- */
/** túi đồ trên đất: tối đa cùng lúc, tự biến mất sau (giây), bán kính nhặt gốc (m) */
export const LOOT_CAP = 40;
export const LOOT_SECS = 60;
export const LOOT_PICK_R = 1.6;
/** ba lô trận: tối đa số món */
export const BAG_CAP = 20;
/** giãn cách giữa 2 lần dùng vật phẩm (giây) */
export const USE_CD = 0.8;
/** chí mạng: hệ số gốc (+ critDmg) */
export const CRIT_BASE = 1.5;

/** bộ đồ mang vào ải (tính sẵn lúc bắt đầu trận) */
export interface StageKit {
  weapons: WeaponDef[];
  quick: { itemId: string; count: number; effect: ConsumableEffect }[];
  /** uid đồ mang vào (mất nếu chết) */
  carried: number[];
}
/** túi đồ trên đất (server giữ kèm món + hạn) */
interface LootBag extends GroundLoot { drop: LootDrop; until: number }
const NO_STATS: Stats = {};
const NO_CLEARED: ReadonlySet<string> = new Set();
const ALL_STAGES: StageDef[] = [...STAGES, ...EVENT_STAGES];
const guestReward = (idx: number): RunReward => ({ idx, reward: null, levelUps: 0, newLevel: 0, firstClear: false });

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
  chatCredit?: number;
  chatAt?: number;
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
  /* ---- tài khoản (khách: accountId undefined) ---- */
  accountId?: number;
  level = 0;
  /** trang bị đã nạp sẵn (null = khách / chưa tải xong → mặc định) */
  loadout: Loadout | null = null;
  /** nhân vật mà loadout được tải cho (cấp kỹ năng theo nhân vật) */
  loadoutCls = -1;
  cleared: ReadonlySet<string> = NO_CLEARED;
  /** đang tải dữ liệu tài khoản */
  loading: Promise<void> | null = null;
  fetchSeq = 0;
  /** dao: được chém lại từ tick AI này */
  knifeAt = 0;
  /* ---- ải ---- */
  kit: StageKit | null = null;
  /** số vật phẩm còn lại theo ô nhanh */
  quickLeft: number[] = [];
  /** itemId → số đã dùng */
  used: Record<string, number> = {};
  /** ba lô trận (giữ được nếu sống tới khi thắng) */
  bag: LootDrop[] = [];
  /** chết hẳn trong ải: bị loại, mất đồ mang theo */
  out = false;
  useAt = 0;
  /** tick tự dùng thuốc hồi sinh (0 = không) */
  itemReviveAt = 0;
  shieldUntil = 0;
  bagFullAt = 0;

  constructor(idx: number, name: string, cls: number, conn: MConn, accountId?: number) {
    this.idx = idx;
    this.name = name;
    this.cls = cls;
    this.conn = conn;
    this.accountId = accountId;
    this.st = newState(cls, 0, 0);
  }

  get guest() {
    return this.accountId === undefined;
  }
  /** chỉ số đồ đã chặn trần */
  get stats(): Stats {
    return this.loadout?.stats ?? NO_STATS;
  }
  stat(k: StatKey2 | 'cashGain'): number {
    return (this.loadout?.stats as Partial<Record<string, number>> | undefined)?.[k] ?? 0;
  }
  /** cấp kỹ năng (1..5) của nhân vật đang chơi */
  skillLv(k: SkillKey): number {
    return this.loadout && this.loadoutCls === this.cls ? this.loadout.skills[k] ?? 1 : 1;
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
  players: (MPlayer | null)[] = new Array<MPlayer | null>(MAX_PLAYERS).fill(null);
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

  /** chế độ: vô tận / vượt ải */
  mode: RoomMode = 'endless';
  /** ải đang chọn trong sảnh (mode 'stage') */
  stageId: string = STAGES[0].id;
  /** ải của ván đang chơi (null = vô tận) */
  stageDef: StageDef | null = null;
  /** đợt đầu tiên của ván (ải: startWave; vô tận: 1 hoặc MONKEY_START_WAVE) */
  firstWave = 1;
  /** tăng mỗi ván — kết quả ghi DB về muộn của ván cũ không được gửi nhầm */
  runId = 0;
  /** promise ghi kết quả ván gần nhất (test chờ) */
  settling: Promise<void> | null = null;
  private _store: Store | null;

  constructor(code: string, solo: boolean, store?: Store) {
    this.code = code;
    this.solo = solo;
    this._store = store ?? null;
  }

  get store(): Store {
    return this._store ?? getStore();
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

  canJoin(guest = false): string | null {
    if (this.solo) return 'Phòng chơi đơn';
    if (guest && this.mode === 'stage') return 'Phòng vượt ải chỉ dành cho người đã đăng nhập';
    if (this.phase !== 'lobby') return 'Phòng đang chơi';
    if (this.count >= MAX_PLAYERS) return `Phòng đã đủ ${MAX_PLAYERS} người`;
    return null;
  }

  add(name: string, cls: number, conn: MConn, accountId?: number): MPlayer {
    const idx = this.players.findIndex((p) => !p);
    const p = new MPlayer(idx, name, cls, conn, accountId);
    this.players[idx] = p;
    if (this.count === 1) this.host = idx;
    p.send({ t: 'joined', code: this.code, pid: p.pid, token: p.token, idx, solo: this.solo });
    this.prefetch(p, true);
    this.broadcastRoom();
    return p;
  }

  /** nạp nền trang bị (+ ải đã qua, cấp nếu profile) của người có tài khoản; xong thì tính lại ải chơi được */
  prefetch(p: MPlayer, profile: boolean): Promise<void> | null {
    if (p.accountId === undefined) return null;
    const id = p.accountId;
    const cls = p.cls;
    const seq = ++p.fetchSeq;
    const st = this.store;
    const jobs: Promise<unknown>[] = [
      st.loadout(id, cls).then((l) => {
        if (p.fetchSeq === seq) { p.loadout = l; p.loadoutCls = cls; }
      }),
    ];
    if (profile) {
      jobs.push(st.clearedStages(id).then((c) => { p.cleared = c; }));
      jobs.push(st.me(id, new Date()).then((m) => { p.level = m.profile.level; }));
    }
    const job: Promise<void> = Promise.all(jobs)
      .then(() => undefined, (e) => console.warn('[monkey] không tải được dữ liệu người chơi', id, (e as Error).message))
      .finally(() => {
        if (p.loading === job) p.loading = null;
        if (this.players[p.idx] !== p || this.disposed) return;
        if (this.phase === 'lobby') this.fixStage();
        this.broadcastRoom();
      });
    p.loading = job;
    return job;
  }

  /** chờ mọi người tải xong dữ liệu tài khoản (tối đa ms) */
  async whenLoaded(ms = REWARD_WAIT_MS): Promise<void> {
    const ps = this.players.filter((q): q is MPlayer => !!q?.loading).map((q) => q.loading!);
    if (!ps.length) return;
    let t: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(ps), new Promise<void>((r) => { t = setTimeout(r, ms); t.unref?.(); })]);
    if (t) clearTimeout(t);
  }

  get loadingAny() {
    return this.players.some((q) => !!q?.loading);
  }

  /** ải mọi thành viên đều đã mở (khách coi như chưa qua ải nào) */
  playableStages(): string[] {
    const ps = this.players.filter((q): q is MPlayer => !!q);
    return ALL_STAGES.filter((st) => ps.every((q) => stageUnlocked(st.id, q.cleared))).map((st) => st.id);
  }

  /** ải đang chọn không còn hợp lệ (người mới vào chưa mở) → lùi về ải xa nhất mọi người cùng chơi được */
  private fixStage() {
    if (this.loadingAny) return;
    const ok = this.playableStages();
    if (ok.includes(this.stageId)) return;
    const chain = ok.filter((id) => !STAGE_BY_ID[id]?.event);
    this.stageId = chain[chain.length - 1] ?? STAGES[0].id;
  }

  /** chủ phòng đổi chế độ; trả lỗi (tiếng Việt) hoặc null */
  setMode(by: MPlayer, mode: unknown): string | null {
    if (this.phase !== 'lobby' || by.idx !== this.host) return 'Chỉ chủ phòng mới đổi được chế độ';
    if (mode !== 'endless' && mode !== 'stage') return 'Chế độ không hợp lệ';
    if (mode === 'stage' && this.players.some((q) => q?.guest)) return 'Mọi người trong phòng phải đăng nhập mới chơi vượt ải được';
    if (mode === this.mode) return null;
    this.mode = mode;
    if (mode === 'stage') this.fixStage();
    this.broadcastRoom();
    return null;
  }

  /** chủ phòng chọn ải (phải nằm trong giao các ải đã mở) */
  setStage(by: MPlayer, id: unknown): string | null {
    if (this.phase !== 'lobby' || by.idx !== this.host) return 'Chỉ chủ phòng mới chọn được ải';
    if (typeof id !== 'string' || !STAGE_BY_ID[id]) return 'Ải không tồn tại';
    if (!this.playableStages().includes(id)) return 'Có người trong phòng chưa mở ải này';
    if (id === this.stageId) return null;
    this.stageId = id;
    this.broadcastRoom();
    return null;
  }

  /** kiểm tra điều kiện vào trận (dữ liệu đã tải; ải: mọi người đăng nhập + đều đã mở ải) */
  private stageCheck(): string | null {
    if (this.loadingAny) return 'Đang tải dữ liệu người chơi, thử lại sau giây lát';
    if (this.mode !== 'stage') return null;
    if (this.players.some((q) => q?.guest)) return 'Mọi người trong phòng phải đăng nhập mới chơi vượt ải được';
    if (!STAGE_BY_ID[this.stageId] || !this.playableStages().includes(this.stageId)) return 'Có người trong phòng chưa mở ải này';
    return null;
  }

  /** chơi đơn: vào trận ngay khi đã tải xong dữ liệu tài khoản (đồng bộ nếu không cần chờ) */
  beginSolo(onErr: (m: string) => void) {
    const go = () => {
      if (this.disposed || this.phase !== 'lobby') return;
      for (const q of this.players) if (q?.loading) q.loading = null; // quá hạn chờ: dùng mặc định
      const err = this.stageCheck();
      if (err) return onErr(err);
      this.begin();
    };
    if (!this.loadingAny) return go();
    void this.whenLoaded().then(go);
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
    if (p.cls === (cls | 0)) return;
    p.cls = cls | 0;
    this.prefetch(p, false);
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
    for (const p of this.players) if (p) out.push({ idx: p.idx, name: p.name, cls: p.cls, ready: p.ready, on: !!p.conn, guest: p.guest, level: p.guest ? undefined : p.level });
    return out;
  }

  broadcastRoom() {
    const m: SMsg = { t: 'room', code: this.code, phase: this.phase, solo: this.solo, host: this.host, players: this.lobbyPlayers(), map: this.mapChoice,
      mode: this.mode, stage: this.stageId, stages: this.playableStages(),
    };
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
    const err = this.stageCheck();
    if (err) return err;
    this.begin();
    return null;
  }

  begin() {
    this.phase = 'play';
    this.runId++;
    this.stageDef = this.mode === 'stage' ? STAGE_BY_ID[this.stageId] ?? null : null;
    const sd = this.stageDef;
    // chốt bản đồ (ngẫu nhiên được bốc ở đây) rồi đặt làm bản đồ hiện hành trước khi dựng thế giới
    // MONKEY_MAP=lang ép bản đồ (chạy thử/chụp ảnh); ải luôn dùng bản đồ của ải
    const forced = process.env.MONKEY_MAP;
    const choice = sd ? sd.map : forced && isMapChoice(forced) ? forced : this.mapChoice;
    this.mapDef = choice === MAP_RANDOM ? MAPS[Math.floor(Math.random() * MAPS.length)] : mapById(choice);
    setActiveMap(this.mapDef);
    this.world = new MonkeyWorld(this, (Math.random() * 0xffffffff) >>> 0);
    this.startedPlayers = Math.max(1, this.count);
    this.score = 0;
    // chỉ để chạy thử/chụp ảnh: MONKEY_START_WAVE=8 bắt đầu thẳng từ đợt 8 (kèm xu tương ứng)
    // ải: bắt đầu từ startWave của ải (cùng công thức xu như MONKEY_START_WAVE)
    const sw = sd ? Math.max(1, sd.startWave) : Math.max(1, Math.min(60, Number(process.env.MONKEY_START_WAVE) || 1));
    this.firstWave = sw;
    this.wave = sw - 1;
    this.startedAt = this.clock();
    for (const p of this.players) {
      if (!p) continue;
      const sp = PLAYER_SPAWNS[p.idx];
      // đổi nhân vật mà kỹ năng chưa kịp tải lại → cấp kỹ năng mặc định
      if (p.loadout && p.loadoutCls !== p.cls) p.loadout = { ...p.loadout, skills: { g: 1, x: 1, q: 1 } };
      if (p.loadout) p.loadoutCls = p.cls;
      // ải: súng/vật phẩm mang vào từ trang bị; vô tận: dòng súng theo bậc
      p.kit = sd ? this.kitOf(p) : null;
      p.quickLeft = p.kit ? p.kit.quick.map((q) => q.count) : [];
      p.used = {};
      p.bag = [];
      p.out = false;
      p.useAt = p.shieldUntil = p.bagFullAt = p.itemReviveAt = 0;
      p.st = newState(p.cls, sp.x, sp.z, simModsOf(p.loadout), p.kit ? p.kit.weapons : null);
      p.st.yaw = (Math.round((Math.atan2(sp.x, sp.z) / (Math.PI * 2)) * 65536) & 0xffff);
      p.hpTier = 0;
      p.maxHp = this.maxHpFor(p);
      p.hp = p.maxHp;
      p.shield = 0;
      p.cash = sd ? 0 : START_CASH + (sw - 1) * 180;
      p.kills = p.ultKills = p.dmg = p.revives = p.earned = p.downs = 0;
      p.cdG = p.cdX = 0;
      p.knifeAt = 0;
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
    this.loot.length = 0;
    this.broadcastRoom();
    this.broadcast(this.startMsg());
    this.startBreak(FIRST_BREAK_SECS);
    this.paused = false;
    this.nextTickAt = this.clock() + AI_MS;
    if (!this.manual) this.loop = setInterval(() => this.pump(), 10);
  }

  private startMsg(): SMsg {
    const sd = this.stageDef;
    return {
      t: 'start',
      seed: 0,
      players: this.players.filter((p): p is MPlayer => !!p).map((p): StartPlayer => ({
        idx: p.idx, name: p.name, cls: p.cls, mods: p.st.mods, look: p.loadout?.look ?? {},
        ...(p.kit ? { weapons: p.kit.weapons, quick: p.kit.quick.map((q): QuickSlot => ({ itemId: q.itemId, count: q.count })) } : {}),
      })),
      tick: this.world?.tick ?? 0,
      map: this.mapDef.id,
      mode: sd ? 'stage' : 'endless',
      economy: this.economy,
      ...(sd ? { stage: sd.id, waves: sd.waves, mods: sd.mods, loot: this.loot.map(({ id, x, z, grade, itemId }) => ({ id, x, z, grade, itemId })) } : {}),
    };
  }

  /** có xu/cửa hàng không (ải: không — sức mạnh đến từ đồ mang vào) */
  get economy() {
    return !this.stageDef;
  }

  /** bộ đồ mang vào ải từ trang bị đã nạp (thiếu súng → súng bậc 0 của nhân vật) */
  kitOf(p: MPlayer): StageKit {
    const lo = p.loadout;
    const ws = (lo?.weapons?.length ? lo.weapons.slice(0, 2) : [weaponOf(p.cls, 0)]).map((w) => (w.mag > MAX_MAG ? { ...w, mag: MAX_MAG } : w));
    const quick = (lo?.quick ?? []).filter((q) => q && q.count > 0).slice(0, 2).map((q) => ({ itemId: q.itemId, count: Math.min(255, q.count | 0), effect: q.effect }));
    return { weapons: ws, quick, carried: [...(lo?.carried ?? [])] };
  }

  /** máu tối đa = nhân vật + bậc máu đã mua + đồ */
  private maxHpFor(p: MPlayer) {
    return maxHpOf(p.cls, p.hpTier) + Math.round(p.stat('hp'));
  }

  /** cộng xu kiếm được (có hệ số cashGain của đồ); ải không có xu */
  private gain(p: MPlayer, amount: number) {
    if (!this.economy) return;
    const cg = p.stat('cashGain');
    const a = cg > 0 ? Math.round(amount * (1 + cg)) : amount;
    p.cash += a;
    p.earned += a;
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
    const sd = this.stageDef ?? undefined;
    this.spec = waveSpec(this.wave, alivePlayers, sd);
    this.toSpawn = this.spec.total;
    this.spawnAcc = this.spec.every; // thả con đầu ngay
    w.skillMul = 1 + 0.09 * (this.wave - 1);
    w.bossSummon = this.wave <= 5 ? 3 : this.wave <= 10 ? 4 : 5;
    if (this.spec.boss) {
      w.pickSpawn(this.tmp2);
      const s = w.spawn(MK_VUA, this.tmp2[0], this.tmp2[1], 1, this.spec.dmgMul, 1, bossHp(this.wave, alivePlayers, sd));
      if (s >= 0) this.broadcast({ t: 'ev', k: 'boss', v: this.wave });
    }
    this.broadcast(this.waveMsg());
  }

  /** đợt cuối của ải (số tuyệt đối) */
  get lastWave() {
    return this.stageDef ? this.firstWave + this.stageDef.waves - 1 : Infinity;
  }

  private waveCleared() {
    // ải: vừa xong đợt cuối → thắng (tính sao trước khi hồi sinh người gục)
    if (this.stageDef && this.wave >= this.lastWave) {
      this.stageVictory();
      return;
    }
    // chơi một mình không được chia xu từ đồng đội → thưởng đợt cao hơn
    const bonus = Math.round(waveBonus(this.wave) * (this.solo ? 1.5 : 1));
    this.score += bonus * 2;
    for (const p of this.players) {
      if (!p) continue;
      this.gain(p, bonus);
      if (p.st.down === 1) this.revive(p, -1, REVIVE_HP);
      else if (p.st.down === 2 && !p.out) {
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
    this.broadcast({ t: 'ev', k: 'clear', v: this.wave, j: this.economy ? bonus : 0 });
    this.startBreak(BREAK_SECS);
  }

  /* ======================= CHAT ======================= */
  /** chat: tối đa ~3 tin / 2 giây mỗi người, bỏ ký tự điều khiển, cắt CHAT_MAX */
  chat(p: MPlayer, raw: unknown) {
    if (typeof raw !== 'string') return;
    const m = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!m) return;
    const now = this.clock();
    p.chatCredit = Math.min(3, (p.chatCredit ?? 3) + ((now - (p.chatAt ?? now)) / 1000) * 1.5);
    p.chatAt = now;
    if (p.chatCredit < 1) return;
    p.chatCredit -= 1;
    this.broadcast({ t: 'chat', i: p.idx, n: p.name, m });
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
      if (this.toSpawn === 0 && w.count === 0) {
        this.waveCleared();
        if (this.phase !== 'play') return; // vượt ải: thế giới đã giải phóng
      }
    }

    // ---- người chơi ----
    let standing = 0;
    for (const p of this.players) {
      if (!p) continue;
      if (p.st.down === 0) {
        standing++;
        // hồi máu: y sĩ luôn hồi; ai cũng tự hồi sau 5 giây không bị đánh
        const cls = CLASSES[p.cls];
        let regen = cls.regen + p.stat('regen');
        if (tick - p.lastHurt > 5 * AI_HZ) regen += 4;
        if (regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + regen / AI_HZ);
        if (p.rageUntil && tick > p.rageUntil) { p.rageUntil = 0; p.shield = 0; }
        if (p.shieldUntil && tick > p.shieldUntil) { p.shieldUntil = 0; if (!p.rageUntil) p.shield = 0; }
      } else if (p.st.down === 1) {
        if (tick - p.reviveTick > 3) p.reviveProg = Math.max(0, p.reviveProg - 0.02);
        if (p.itemReviveAt && tick >= p.itemReviveAt) {
          // thuốc hồi sinh ở ô nhanh: tự dùng
          p.itemReviveAt = 0;
          p.useAt = 0;
          const slot = this.reviveSlot(p);
          if (slot >= 0 && this.useQuick(p, slot)) standing++;
        } else if (p.autoReviveAt && tick >= p.autoReviveAt) {
          p.autoReviveAt = 0;
          p.selfRevives--;
          this.revive(p, p.idx, 0.6);
          standing++;
        } else if (tick >= p.bleedUntil) {
          p.st.down = 2;
          p.reviveProg = 0;
          this.broadcast({ t: 'ev', k: 'dead', i: p.idx });
          if (this.stageDef && !p.out) {
            // ải: chết hẳn = bị loại, mất đồ mang theo + ba lô (giữ túi an toàn)
            p.out = true;
            this.broadcast({ t: 'ev', k: 'out', i: p.idx, v: p.bag.length });
          }
        }
      }
      p.reviving = false;
    }
    if (this.stageDef) this.stepLoot(tick);
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
      if (c.btn & P_K) this.knife(p, c);
      if (c.btn & B_USE) this.tryRevive(p, w.tick);
    }
    // vật phẩm ô nhanh (cả khi đang gục: thuốc tự đứng dậy)
    if (p.kit && p.st.down !== 2 && (c.btn & (P_U1 | P_U2))) this.useQuick(p, c.btn & P_U1 ? 0 : 1);
  }

  /* ======================= VẬT PHẨM (ải, phím 3/4) ======================= */
  /** ô nhanh đang giữ thuốc hồi sinh còn hàng (-1 = không) */
  private reviveSlot(p: MPlayer): number {
    if (!p.kit) return -1;
    return p.kit.quick.findIndex((q, i) => q.effect.kind === 'revive' && (p.quickLeft[i] ?? 0) > 0);
  }

  /** dùng vật phẩm ô `slot`; trả true nếu đã dùng */
  useQuick(p: MPlayer, slot: number): boolean {
    const w = this.world;
    const q = p.kit?.quick[slot];
    if (!w || !q || p.out || (p.quickLeft[slot] ?? 0) <= 0 || w.tick < p.useAt) return false;
    const e = q.effect;
    const st = p.st;
    const downed = st.down === 1;
    // gục chỉ dùng được thuốc tự đứng dậy; thuốc tự đứng dậy chỉ dùng khi gục
    if (downed !== (e.kind === 'revive')) return false;
    switch (e.kind) {
      case 'heal':
        if (p.hp >= p.maxHp) return false;
        this.heal(p.idx, e.amount);
        w.addFx(FX_HEAL, st.x, st.z, p.idx, Math.min(65535, Math.round(e.amount)));
        break;
      case 'shield':
        p.shield = Math.max(p.shield, e.amount);
        p.shieldUntil = w.tick + Math.round(e.secs * AI_HZ);
        break;
      case 'speed':
        st.spdT = Math.round(e.secs * TICK_HZ);
        st.spdMul = Math.max(1, Math.min(255, Math.round(e.mul * SPD_Q))) / SPD_Q;
        break;
      case 'grenade': {
        shotOrigin(st, this.org);
        aimDir(st.yaw, Math.min(14000, st.pitch + 1800), this.dirs);
        w.spawnProjectile(PJ_GRENADE, p.idx, this.org[0], this.org[1], this.org[2], this.dirs[0] * 17 + st.vx * 0.5, this.dirs[1] * 17 + 3, this.dirs[2] * 17 + st.vz * 0.5, 1.1, e.dmg * (1 + p.stat('skillDmg')), e.radius);
        break;
      }
      case 'revive':
        this.revive(p, p.idx, 0.5);
        break;
      default:
        return false;
    }
    p.useAt = w.tick + Math.round(USE_CD * AI_HZ);
    p.quickLeft[slot]--;
    p.used[q.itemId] = (p.used[q.itemId] ?? 0) + 1;
    this.broadcast({ t: 'ev', k: 'use', i: p.idx, s: q.itemId, v: p.quickLeft[slot], j: slot });
    return true;
  }

  private fireShot(p: MPlayer, c: Cmd) {
    const w = this.world!;
    const wd = curWeapon(p.st);
    const cls = CLASSES[p.cls];
    const mul = cls.dmgMul * (p.st.braceT > 0 ? cls.buff.dmg : 1) * (1 + p.stat('dmg'));
    const headMul = cls.headMul * (1 + p.stat('headDmg'));
    const critP = p.stat('crit');
    const critMul = CRIT_BASE + p.stat('critDmg');
    let dealt = 0;
    shotOrigin(p.st, this.org);
    const n = pelletDirs(p.st, c, p.idx, this.dirs);
    const vt = this.viewTick(c);
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
        if (w.rayCrit[h]) dmg *= headMul;
        if (h > 0) dmg *= 0.7; // xuyên giảm sát thương
        // chí mạng (chỉ server tính; client thấy qua số sát thương trong snapshot)
        const crit = critP > 0 && w.rng() < critP;
        if (crit) dmg *= critMul;
        const real = Math.min(dmg, Math.max(0, w.hp[sl]));
        p.dmg += real;
        dealt += real;
        w.damage(sl, dmg, p.idx, w.rayCrit[h] || crit ? 1 : 0, CAUSE_SHOT);
      }
      if (wd.splashR > 0) {
        // pháo chuối: nổ tại điểm chạm
        const t = end;
        const ex = ox + dx * t, ez = oz + dz * t;
        w.explode(ex, ez, wd.splashR * cls.splashMul, wd.splashDmg * mul, p.idx, 0);
      }
    }
    w.addShot(p.idx, p.st.yaw, p.st.pitch, firstDist);
    this.lifesteal(p, dealt);
  }

  /** hút máu theo sát thương thật đã gây */
  private lifesteal(p: MPlayer, dealt: number) {
    const ls = p.stat('lifesteal');
    if (ls > 0 && dealt > 0) this.heal(p.idx, dealt * ls);
  }

  /** thời điểm người chơi nhìn thấy khỉ (lệnh c): kẹp trong [now - LAG_COMP, now] */
  private viewTick(c: Cmd) {
    const now = this.world!.tick;
    let vt = c.vt / 16;
    if (!(vt <= now)) vt = now;
    if (vt < now - LAG_COMP_TICKS) vt = now - LAG_COMP_TICKS;
    return vt;
  }

  /* ======================= DAO (phím F) ======================= */
  private knifeSlots: number[] = [];
  /** chém nón trước mặt, bù trễ như bắn; sau lưng khỉ ×2. Trả số khỉ trúng (-1 = đang hồi) */
  knife(p: MPlayer, c: Cmd): number {
    const w = this.world!;
    if (p.st.down !== 0 || w.tick < p.knifeAt) return -1;
    p.knifeAt = w.tick + Math.round(KNIFE_CD * AI_HZ);
    const st = p.st;
    const fx = isin(st.yaw), fz = icos(st.yaw);
    const n = w.meleeCone(st.x, st.y, st.z, fx, fz, KNIFE_RANGE, Math.cos((KNIFE_HALF_DEG * Math.PI) / 180), this.viewTick(c), 4);
    const kd = p.stat('knifeDmg');
    const base = (kd > 0 ? kd : BASE_KNIFE_DMG) * (1 + p.stat('dmg'));
    const backCos = Math.cos((KNIFE_BACK_DEG * Math.PI) / 180);
    const sl = this.knifeSlots;
    sl.length = 0;
    for (let h = 0; h < n; h++) sl.push(w.raySlot[h]);
    let backs = 0;
    let dealt = 0;
    for (const i of sl) {
      if (!w.alive[i]) continue;
      // góc giữa hướng khỉ nhìn và hướng từ khỉ tới người chém > 120° → đâm sau lưng
      const ax = st.x - w.x[i], az = st.z - w.z[i];
      const al = Math.sqrt(ax * ax + az * az) || 1;
      const back = (Math.sin(w.yaw[i]) * ax + Math.cos(w.yaw[i]) * az) / al < backCos;
      if (back) backs++;
      const dmg = base * (back ? 2 : 1);
      const real = Math.min(dmg, Math.max(0, w.hp[i]));
      p.dmg += real;
      dealt += real;
      w.damage(i, dmg, p.idx, back ? 1 : 0, CAUSE_SKILL);
    }
    this.lifesteal(p, dealt);
    this.broadcast({ t: 'ev', k: 'knife', i: p.idx, v: n, j: backs });
    return n;
  }

  /* ======================= KỸ NĂNG ======================= */
  private canSkill(p: MPlayer, cdUntil: number, cost: number): boolean {
    const w = this.world!;
    if (w.tick < cdUntil) return false;
    if (this.economy && p.cash < cost) {
      p.send({ t: 'ev', k: 'nocash', v: cost });
      return false;
    }
    return true;
  }

  /** giá xu kỹ năng theo cấp kỹ năng của người chơi */
  skillCost(p: MPlayer, k: 'g' | 'x') {
    if (!this.economy) return 0; // ải: kỹ năng miễn phí
    return Math.round(CLASSES[p.cls][k].cost * skillCostMul(p.skillLv(k)));
  }
  /** hồi chiêu (tick AI) theo cấp kỹ năng × (1 − giảm hồi chiêu của đồ) */
  private skillCd(p: MPlayer, k: 'g' | 'x') {
    return Math.round(CLASSES[p.cls][k].cd * skillCostMul(p.skillLv(k)) * (1 - Math.min(0.6, p.stat('cdr'))) * AI_HZ);
  }
  /** sức mạnh kỹ năng = cấp kỹ năng × (1 + sát thương kỹ năng của đồ) */
  private skillPw(p: MPlayer, k: SkillKey) {
    return skillPower(p.skillLv(k)) * (1 + p.stat('skillDmg'));
  }
  /** số khỉ cần hạ để sạc tuyệt chiêu (Q) theo cấp kỹ năng */
  ultNeed(p: MPlayer) {
    return Math.max(1, Math.round(ULT_KILLS * skillCostMul(p.skillLv('q'))));
  }

  private useG(p: MPlayer) {
    const w = this.world!;
    const cls = CLASSES[p.cls];
    const cost = this.skillCost(p, 'g');
    if (!this.canSkill(p, p.cdG, cost)) return;
    p.cash -= cost;
    p.cdG = w.tick + this.skillCd(p, 'g');
    const pw = this.skillPw(p, 'g');
    const sm = w.skillMul * pw;
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
        w.booms.push({ x: this.tmp2[0], z: this.tmp2[1], at: w.tick + Math.round(0.6 * AI_HZ), r: 5, dmg: 40 * sm, owner: p.idx, stun: 2.5 * pw });
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
        const wd = curWeapon(st);
        const per = wd.dmg * wd.pellets * cls.dmgMul * 2.2 * (1 + p.stat('skillDmg'));
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
    const cost = this.skillCost(p, 'x');
    if (!this.canSkill(p, p.cdX, cost)) return;
    const pw = this.skillPw(p, 'x');
    const st = p.st;
    const fx = isin(st.yaw), fz = icos(st.yaw);
    const yawRad = (st.yaw / 65536) * Math.PI * 2;
    switch (cls.id) {
      case 'chienbinh': {
        collide(st.x + fx * 2.6, st.z + fz * 2.6, 0.3, this.tmp2);
        w.addEnt(EN_BARRICADE, p.idx, this.tmp2[0], this.tmp2[1], yawRad, 30 * pw);
        w.addFx(FX_BUILD, this.tmp2[0], this.tmp2[1], EN_BARRICADE, 0);
        break;
      }
      case 'ysi': {
        w.addEnt(EN_POD, p.idx, st.x, st.z, 0, 12 * pw);
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
        w.addEnt(EN_TURRET, p.idx, this.tmp2[0], this.tmp2[1], yawRad, 45 * pw, this.turretPower(p) * pw);
        w.addFx(FX_BUILD, this.tmp2[0], this.tmp2[1], EN_TURRET, 0);
        break;
      }
      case 'dausi': {
        st.braceT = Math.round(5 * TICK_HZ * pw);
        break;
      }
      case 'xathu': {
        // mắt ưng: braceT = bắn không tốn đạn + tăng sát thương (xem ClassDef.buff)
        st.braceT = Math.round(6 * TICK_HZ * pw);
        break;
      }
      case 'phaothu': {
        // pháo cối: 5 quả rơi quanh điểm ngắm
        this.aimGround(st, 30, this.tmp2);
        const cx = this.tmp2[0], cz = this.tmp2[1];
        const sm = w.skillMul * pw;
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
        const sm = w.skillMul * pw;
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
        w.stunArea(st.x, st.z, 8, 2 * pw, fx, fz, 0.64);
        break;
      }
    }
    p.cash -= cost;
    p.cdX = w.tick + this.skillCd(p, 'x');
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
    if (p.ultKills < this.ultNeed(p)) return;
    p.ultKills = 0;
    const st = p.st;
    const cls = CLASSES[p.cls];
    const pw = this.skillPw(p, 'q');
    const sm = w.skillMul * pw;
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
        w.overclockUntil[p.idx] = w.tick + Math.round(12 * AI_HZ * pw);
        const fx = isin(st.yaw), fz = icos(st.yaw);
        collide(st.x - fx * 1.4, st.z - fz * 1.4, 0.5, this.tmp2);
        // trụ miễn phí (power âm = không tính vào giới hạn 2 trụ)
        const e = w.addEnt(EN_TURRET, p.idx, this.tmp2[0], this.tmp2[1], yawRad, 20 * pw, this.turretPower(p) * pw);
        e.born = -1; // trụ miễn phí: không tính vào giới hạn 2 trụ
        w.addFx(FX_BUILD, this.tmp2[0], this.tmp2[1], EN_TURRET, 1);
        break;
      }
      case 'dausi':
        p.tauntUntil = w.tick + Math.round(8 * AI_HZ * pw);
        p.rageUntil = w.tick + Math.round(8 * AI_HZ * pw);
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
        st.braceT = Math.round(8 * TICK_HZ * pw);
        st.fireCd = 0;
        break;
    }
    this.broadcast({ t: 'ev', k: 'ult', i: p.idx });
  }

  buy(p: MPlayer, item: 'weapon' | 'hp') {
    if (this.phase !== 'play' || p.st.down) return;
    const mods = this.stageDef?.mods;
    if (!this.economy || (mods && (mods.includes('noShop') || (item === 'weapon' && mods.includes('pistolOnly'))))) {
      return p.send({ t: 'ev', k: 'noshop', s: item });
    }
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
      p.maxHp = this.maxHpFor(p);
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
      this.gain(p, 25);
    }
  }

  private revive(p: MPlayer, by: number, frac: number) {
    p.st.down = 0;
    p.itemReviveAt = 0;
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
    let d = dmg * (1 - cls.armor) * (1 - p.stat('armor'));
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
      if (this.reviveSlot(p) >= 0) p.itemReviveAt = w.tick + Math.round(1.5 * AI_HZ);
      else if (this.solo && p.selfRevives > 0) p.autoReviveAt = w.tick + 5 * AI_HZ;
      this.broadcast({ t: 'ev', k: 'down', i: idx, v: p.selfRevives });
    }
  }

  killed(_slot: number, type: number, killer: number, _cause: number, x: number, z: number) {
    const def = MONKEYS[type];
    const w = this.world!;
    this.score += def.reward;
    if (type === MK_VUA) {
      for (const p of this.players) if (p) this.gain(p, def.reward);
      this.broadcast({ t: 'ev', k: 'bossdown', i: killer });
    } else if (killer >= 0 && killer < MAX_PLAYERS) {
      const share = Math.round(def.reward * teamShare(this.count));
      for (const p of this.players) {
        if (!p) continue;
        this.gain(p, p.idx === killer ? def.reward : share);
      }
    }
    const k = killer >= 0 && killer < MAX_PLAYERS ? this.players[killer] : null;
    if (k) { k.kills++; k.ultKills++; }
    // rơi vật phẩm: chuối hồi máu / túi xu (ải không có xu → chỉ chuối)
    if (w.rng() < (type === MK_DOT ? 0.35 : 0.035)) {
      const e = w.addEnt(EN_PICKUP, 255, x, z, 0, 20);
      e.cd = !this.economy || w.rng() < 0.55 ? 0 : 1;
    }
    // ải: rớt túi đồ (boss rớt cả chùm)
    if (this.stageDef) {
      const luck = k ? k.stat('luck') : 0;
      // boss: mỗi người trong đội một chùm 2–4 món
      const rolls = type === MK_VUA ? Math.max(1, this.count) : 1;
      for (let r = 0; r < rolls; r++) {
        const ds = rollKillLoots(type, this.stageDef, luck, this.rng);
        for (const d of ds) {
          const a = this.rng() * Math.PI * 2;
          const rad = type === MK_VUA ? 1 + this.rng() * 3 : 0;
          this.dropLoot(d, x + Math.sin(a) * rad, z + Math.cos(a) * rad);
        }
      }
    }
  }

  /* ======================= TÚI ĐỒ TRÊN ĐẤT (ải) ======================= */
  loot: LootBag[] = [];
  private nextLoot = 1;

  /** thả một túi đồ (đầy thì túi cũ nhất biến mất) */
  dropLoot(drop: LootDrop, x: number, z: number): GroundLoot | null {
    const w = this.world;
    if (!w) return null;
    collide(x, z, 0.3, this.tmp2);
    while (this.loot.length >= LOOT_CAP) this.removeLoot(0);
    const bag: LootBag = { id: this.nextLoot++ & 0xffffff, x: Math.round(this.tmp2[0] * 100) / 100, z: Math.round(this.tmp2[1] * 100) / 100, grade: drop.grade, itemId: drop.itemId, drop, until: w.tick + LOOT_SECS * AI_HZ };
    this.loot.push(bag);
    const g: GroundLoot = { id: bag.id, x: bag.x, z: bag.z, grade: bag.grade, itemId: bag.itemId };
    this.broadcast({ t: 'ev', k: 'loot', ...g });
    return g;
  }

  private removeLoot(k: number) {
    const [b] = this.loot.splice(k, 1);
    if (b) this.broadcast({ t: 'ev', k: 'unloot', v: b.id });
  }

  /** nhặt tự động (người còn đứng trong bán kính) + hết hạn */
  private stepLoot(tick: number) {
    for (let k = this.loot.length - 1; k >= 0; k--) {
      const b = this.loot[k];
      if (tick >= b.until) { this.removeLoot(k); continue; }
      for (const p of this.players) {
        if (!p || p.out || p.st.down !== 0) continue;
        const r = LOOT_PICK_R * (1 + Math.max(0, p.stat('pickup'))); // 'pickup' = +% tầm nhặt
        const dx = p.st.x - b.x, dz = p.st.z - b.z;
        if (dx * dx + dz * dz > r * r) continue;
        if (p.bag.length >= BAG_CAP) {
          if (tick >= p.bagFullAt) { p.bagFullAt = tick + 3 * AI_HZ; p.send({ t: 'ev', k: 'bagfull', i: p.idx }); }
          continue;
        }
        p.bag.push(b.drop);
        this.loot.splice(k, 1);
        this.broadcast({ t: 'ev', k: 'picked', i: p.idx, v: b.id, s: b.itemId, j: b.grade });
        this.broadcast({ t: 'ev', k: 'unloot', v: b.id });
        break;
      }
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
      for (const q of this.players) if (q) this.gain(q, 50);
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
      w.u8(Math.min(255, Math.floor((p.ultKills / this.ultNeed(p)) * 255)));
      w.u8(Math.min(255, Math.floor(p.reviveProg * 255)));
      w.u8(st.down === 1 ? Math.max(0, Math.ceil((p.bleedUntil - world.tick) / AI_HZ)) : 0);
      w.u32(Math.floor(p.cash));
      w.u16(Math.min(65535, p.kills));
      w.u8(st.wslot);
      w.u8(Math.min(255, st.swapT));
      w.u8(Math.min(255, st.ammoAlt));
      w.u16(Math.min(65535, st.spdT));
      w.u8(Math.max(0, Math.min(255, Math.round(st.spdMul * SPD_Q))));
      w.u8(Math.min(255, p.quickLeft[0] ?? 0));
      w.u8(Math.min(255, p.quickLeft[1] ?? 0));
      w.u8(Math.min(255, p.bag.length));
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
  private endStats(ps: MPlayer[]): EndStat[] {
    return ps.map((p) => ({
      idx: p.idx, name: p.name, cls: p.cls, kills: p.kills, dmg: Math.round(p.dmg), revives: p.revives, earned: Math.round(p.earned), downs: p.downs,
    }));
  }

  /** ghi kết quả một người có tài khoản (khách → reward null); không bao giờ reject. Ải: có `ex` → recordExtract */
  private recordFor(p: MPlayer, r: Omit<RunResult, 'accountId' | 'kills'>, ex?: ExtractResult): Promise<RunReward> {
    if (p.accountId === undefined) return Promise.resolve(ex ? { ...guestReward(p.idx), extract: ex } : guestReward(p.idx));
    const now = new Date(this.clock());
    const fail = (e: unknown): RunReward => {
      console.warn('[monkey] không ghi được kết quả trận', p.accountId, (e as Error).message);
      return ex ? { ...guestReward(p.idx), extract: ex } : guestReward(p.idx);
    };
    const markCleared = () => {
      if (r.won && r.stage !== 'endless' && !p.cleared.has(r.stage)) p.cleared = new Set([...p.cleared, r.stage]);
    };
    const items = (its: ItemInst[]): RunRewardItem[] => its.map((it) => ({ uid: it.uid, itemId: it.itemId, grade: it.grade, affixes: it.affixes, count: it.count }));
    if (ex) {
      const run: ExtractRun = { ...r, accountId: p.accountId, kills: p.kills, extract: ex, chest: r.reward };
      return this.store.recordExtract(run, now).then((res) => {
        p.level = res.newLevel;
        markCleared();
        const { items: _g, ...granted } = res.granted;
        return {
          idx: p.idx,
          reward: { ...granted, items: items(res.items) },
          levelUps: res.levelUps,
          newLevel: res.newLevel,
          firstClear: res.firstClear,
          extract: { ...ex, lost: res.lost },
          overflowGold: res.overflowGold,
        };
      }, fail);
    }
    const run: RunResult = { ...r, accountId: p.accountId, kills: p.kills };
    return this.store.recordRun(run, now).then(
      (res) => {
        p.level = res.newLevel;
        markCleared();
        // thưởng lần đầu qua ải do Store cộng — gộp vào để client hiển thị
        const fr = res.firstClear ? STAGE_BY_ID[r.stage]?.first : undefined;
        return {
          idx: p.idx,
          reward: {
            gold: (r.reward.gold ?? 0) + (fr?.gold ?? 0),
            xp: (r.reward.xp ?? 0) + (fr?.xp ?? 0),
            shards: (r.reward.shards ?? 0) + (fr?.shards ?? 0),
            books: (r.reward.books ?? 0) + (fr?.books ?? 0),
            items: items(res.items),
            ...(fr?.unlockChar !== undefined ? { unlockChar: fr.unlockChar } : {}),
          },
          levelUps: res.levelUps,
          newLevel: res.newLevel,
          firstClear: res.firstClear,
        };
      },
      fail,
    );
  }

  /**
   * Chờ các lần ghi (tối đa REWARD_WAIT_MS) rồi gửi tin tổng kết; lần nào chưa xong thì gửi reward null.
   * Không có ai đăng nhập → gửi ngay (đồng bộ).
   */
  private sendAfter(jobs: Promise<RunReward>[], ps: MPlayer[], mk: (rewards: RunReward[]) => SMsg) {
    const run = this.runId;
    if (!jobs.length || ps.every((p) => p.guest)) {
      this.broadcast(mk(ps.map((p) => guestReward(p.idx))));
      this.settling = Promise.all(jobs).then(() => undefined);
      return;
    }
    const got: (RunReward | null)[] = ps.map(() => null);
    const each = jobs.map((j, k) => j.then((r) => { got[k] = r; }));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((res) => { timer = setTimeout(res, REWARD_WAIT_MS); timer.unref?.(); });
    this.settling = Promise.race([Promise.all(each).then(() => undefined), timeout]).then(() => {
      if (timer) clearTimeout(timer);
      if (this.disposed || this.runId !== run) return;
      this.broadcast(mk(got.map((r, k) => r ?? guestReward(ps[k].idx))));
    });
  }

  /** dọn trận: dừng vòng lặp, chuyển 'over', giải phóng thế giới */
  private finishRun() {
    this.stopLoop();
    this.phase = 'over';
    this.wPhase = PH_OVER;
    this.broadcastRoom();
    // giải phóng thế giới (bộ nhớ) ngay khi hết ván
    this.world?.reset();
    this.world = null;
  }

  /** vượt ải: tính sao, tung đồ cho từng người, ghi DB (nền), gửi 'victory' */
  private stageVictory() {
    const sd = this.stageDef!;
    const secs = Math.round((this.clock() - this.startedAt) / 1000);
    const ps = this.players.filter((p): p is MPlayer => !!p);
    let hp = 0, max = 0, downs = 0;
    for (const p of ps) {
      hp += p.st.down ? 0 : Math.max(0, p.hp);
      max += p.maxHp;
      downs += p.downs;
    }
    const stars = 1 + (max > 0 && hp >= max * 0.5 ? 1 : 0) + (downs === 0 && secs <= sd.star3Secs ? 1 : 0);
    const kills = ps.reduce((a, p) => a + p.kills, 0);
    const score = Math.round(this.score);
    const stats = this.endStats(ps);
    const wave = this.wave;
    const cleared = Math.max(0, this.wave - this.firstWave + 1);
    // người sống tới cuối: giữ đồ + ba lô + rương ải; người đã chết: chỉ XP an ủi
    const jobs = ps.map((p) => {
      const ex = this.extractOf(p, true);
      return this.recordFor(p, {
        stage: sd.id, won: true, stars, wave, secs, score,
        reward: p.guest ? {} : ex.survived ? rollDrops(sd.drops, p.stat('luck'), stars, this.rng) : { xp: 20 * cleared },
      }, ex);
    });
    submitRun(this.store, { stage: sd.id, solo: this.startedPlayers <= 1, names: ps.map((p) => p.name), cls: ps.map((p) => p.cls), wave, score, kills, secs }, this.clock());
    this.broadcast({ t: 'ev', k: 'clear', v: wave, j: 0 });
    this.finishRun();
    this.sendAfter(jobs, ps, (rewards) => ({ t: 'victory', stage: sd.id, stars, secs, wave, rewards, stats, score, kills }));
    if (this.online === 0) this.dispose();
  }

  /** kết quả mang đồ của một người (ải): thắng + còn sống = giữ hết; chết/cả đội gục = mất đồ mang theo + ba lô */
  extractOf(p: MPlayer, won: boolean): ExtractResult {
    const survived = won && !p.out;
    const carried = p.kit?.carried ?? [];
    return {
      survived,
      kept: survived ? [...carried] : [],
      lost: survived ? [] : [...carried],
      looted: survived ? p.bag.map((d) => ({ ...d })) : [],
      usedConsumables: { ...p.used },
    };
  }

  /** nguồn ngẫu nhiên cho rớt đồ (crypto; test có thể thay) */
  rng: () => number = cryptoRng;

  private gameOver() {
    const secs = Math.round((this.clock() - this.startedAt) / 1000);
    const ps = this.players.filter((p): p is MPlayer => !!p);
    const kills = ps.reduce((a, p) => a + p.kills, 0);
    const score = Math.round(this.score);
    const sd = this.stageDef;
    const stage = sd ? sd.id : 'endless';
    let rank = 0;
    if (!sd && this.wave > 0) {
      rank = submitRun(this.store, { stage, solo: this.startedPlayers <= 1, names: ps.map((p) => p.name), cls: ps.map((p) => p.cls), wave: this.wave, score, kills, secs }, this.clock()).rank;
    }
    const stats = this.endStats(ps);
    // thưởng an ủi: theo số đợt đã vượt trong ván này
    const cleared = Math.max(0, this.wave - this.firstWave);
    // ải: cả đội gục = mọi người mất đồ mang theo (trừ túi an toàn), chỉ còn XP an ủi
    const jobs = ps.map((p) =>
      this.recordFor(p, { stage, won: false, stars: 0, wave: this.wave, secs, score, reward: sd ? { xp: 20 * cleared } : { gold: 15 * cleared, xp: 20 * cleared } }, sd ? this.extractOf(p, false) : undefined),
    );
    const wave = this.wave;
    const board = topRuns(this.store, this.startedPlayers <= 1, 10);
    this.finishRun();
    this.sendAfter(jobs, ps, (rewards) => ({
      t: 'over', wave, score, kills, rank, secs, stats, board,
      ...(ps.some((p) => !p.guest) ? { rewards } : {}),
      ...(sd ? { stage: sd.id } : {}),
    }));
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
    this.players = new Array<MPlayer | null>(MAX_PLAYERS).fill(null);
    this.onEmpty?.();
  }
}
