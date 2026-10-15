import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';
import {
  CAST_LOCK_MS,
  DURATION_MS,
  FAIL_LOCK_MS,
  HOOK_MS,
  IMMUNE_MS,
  LAG_TICKS,
  LAND_LOCK_MS,
  NIB_MS,
  REEL_MAX_TICKS,
  SPECIES,
  STEAL_CD_MS,
  STEAL_CHANCE_LANDED,
  STEAL_CHANCE_REELING,
  STEAL_MISS_PENALTY,
  STEAL_MISS_STUN_MS,
  STEAL_REEL_MIN_MS,
  STEAL_SHARE,
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
  resetReel,
  stepReel,
  type ReelState,
} from '../../../shared/fishing.js';

/**
 * CÂU CÁ TRANH TÀI (id fishing) - mỗi hồ 3-6 người, nhiều hồ chạy song song.
 * Server quyết mọi kết quả: loài cá (túi cá có seed riêng từng người, chỉ lộ lúc cá cắn),
 * ván kéo cá (mô phỏng lại từ lệnh giữ/nhả có dấu tick của client, chậm LAG_TICKS), giật cá, điểm.
 * Client dự đoán ván kéo của chính mình bằng cùng hàm trong shared/fishing.ts.
 */
interface Config {
  lakes: string[][];
  durationMs: number;
}

const HOLD_CAP = 318;
const SNAP_MS = 200;
const RS_MS = 250;
const NO_TARGET_CD_MS = 350;

interface Pl {
  id: string;
  lake: number;
  seat: number;
  rng: () => number;
  bag: number[];
  bagPos: number;
  st: number;
  readyAt: number;
  nibAt: number;
  biteAt: number;
  /** loài cá đang cắn / đang kéo (đã bốc khỏi túi nên không thể "làm lại" bằng cách bỏ lỡ) */
  item: number;
  cls: number;
  seed: number;
  reel: ReelState;
  t0: number;
  tick: number;
  hi: number;
  hn: number;
  hk: Int16Array;
  hv: Uint8Array;
  nextRs: number;
  stunUntil: number;
  heldUntil: number;
  heldSp: number;
  immuneUntil: number;
  stealReadyAt: number;
  pts: number;
  caught: number[];
  stealOk: number;
  stealMiss: number;
  robbed: number;
  lostFish: number;
}

interface Lake {
  players: Pl[];
  rng: () => number;
  /** điểm "rơi vãi" do giật cá (nạn nhân mất nhiều hơn kẻ giật nhận) + tiền phạt giật hụt; cuối ván chia đều cả hồ để điểm trung bình không phụ thuộc cỡ hồ */
  burn: number;
}

interface State {
  lakes: Lake[];
  byId: Map<string, Pl>;
  nextSnap: number;
  done: boolean;
}

const emit = (ctx: { send(id: string, p: any): void }, lake: Lake, payload: any) => {
  for (const q of lake.players) ctx.send(q.id, payload);
};

function drawItem(p: Pl): number {
  if (p.bagPos >= p.bag.length) {
    p.bag = makeBag(p.rng);
    p.bagPos = 0;
  }
  return p.bag[p.bagPos++];
}

const stateEvent = (ctx: { send(id: string, p: any): void }, lake: Lake, p: Pl, s: number) =>
  emit(ctx, lake, { type: 'st', l: p.lake, i: p.seat, s });

function setIdle(ctx: { send(id: string, p: any): void }, lake: Lake, p: Pl, lockMs: number, now: number) {
  p.st = ST_IDLE;
  p.readyAt = now + lockMs;
  stateEvent(ctx, lake, p, ST_IDLE);
}

function snapshot(lake: Lake, li: number, now: number) {
  return {
    type: 'sn',
    l: li,
    r: lake.players.map((p) => [
      p.st,
      p.st === ST_REEL ? Math.round(p.reel.p * 100) : 0,
      p.pts,
      Math.max(0, Math.ceil((p.immuneUntil - now) / 100)),
      Math.max(0, Math.ceil((p.stealReadyAt - now) / 100)),
      p.heldUntil > now ? p.heldSp : -1,
      Math.max(0, Math.ceil((p.heldUntil - now) / 100)),
    ]),
  };
}

function startReel(p: Pl, at: number) {
  p.st = ST_REEL;
  p.t0 = at;
  p.tick = 0;
  p.hi = -1;
  p.hn = 0;
  p.nextRs = at + RS_MS;
  resetReel(p.reel);
}

function endReel(ctx: any, lake: Lake, p: Pl, now: number, result: 1 | -1) {
  const sp = SPECIES[p.item];
  if (result === 1) {
    p.pts = Math.max(0, p.pts + sp.value);
    p.caught[p.item]++;
    p.heldSp = p.item;
    p.heldUntil = sp.value > 0 ? now + STEAL_WINDOW_MS : 0;
    emit(ctx, lake, { type: 'land', l: p.lake, i: p.seat, sp: p.item, v: sp.value, u: p.heldUntil });
    setIdle(ctx, lake, p, LAND_LOCK_MS, now);
  } else {
    p.lostFish++;
    emit(ctx, lake, { type: 'esc', l: p.lake, i: p.seat, why: 'reel' });
    setIdle(ctx, lake, p, FAIL_LOCK_MS, now);
  }
}

/** cho các test: chọn mục tiêu giật. kind 'l' = cá vừa lên bờ, 'r' = cá đang kéo */
export function pickStealTarget(lake: Lake, thief: Pl, now: number, to?: string): { v: Pl; kind: 'l' | 'r' } | null {
  let best: Pl | null = null;
  let bestKind: 'l' | 'r' = 'l';
  let bestScore = -1;
  for (const v of lake.players) {
    if (v === thief || now < v.immuneUntil) continue;
    if (to && v.id !== to) continue;
    if (v.heldUntil > now && SPECIES[v.heldSp].value > 0) {
      const sc = 1000 + SPECIES[v.heldSp].value;
      if (sc > bestScore) {
        best = v;
        bestKind = 'l';
        bestScore = sc;
      }
    } else if (v.st === ST_REEL && now - v.t0 >= STEAL_REEL_MIN_MS) {
      const sc = v.reel.p * 100;
      if (sc > bestScore) {
        best = v;
        bestKind = 'r';
        bestScore = sc;
      }
    }
  }
  return best ? { v: best, kind: bestKind } : null;
}

function trySteal(ctx: any, state: State, lake: Lake, thief: Pl, now: number, to?: string) {
  if (thief.st === ST_REEL || now < thief.stealReadyAt || now < thief.stunUntil) return;
  const tg = pickStealTarget(lake, thief, now, to);
  if (!tg) {
    thief.stealReadyAt = now + NO_TARGET_CD_MS;
    ctx.send(thief.id, { type: 'ns' });
    return;
  }
  const v = tg.v;
  thief.stealReadyAt = now + STEAL_CD_MS;
  if (thief.st === ST_WAIT || thief.st === ST_NIB || thief.st === ST_BITE) {
    // bỏ cần để lao đi giật: mất lượt chờ cá của mình
    if (thief.st === ST_BITE) thief.lostFish++;
    thief.st = ST_IDLE;
    thief.readyAt = now + CAST_LOCK_MS;
  }
  const ok = lake.rng() < (tg.kind === 'l' ? STEAL_CHANCE_LANDED : STEAL_CHANCE_REELING);
  if (ok) {
    const sp = tg.kind === 'l' ? v.heldSp : v.item;
    const val = SPECIES[sp].value;
    let gain: number;
    if (tg.kind === 'l') {
      const lost = Math.min(v.pts, val);
      v.pts -= lost;
      v.heldUntil = 0;
      gain = Math.round(val * STEAL_SHARE);
      lake.burn += lost - gain;
    } else {
      // cá còn đang kéo: kẻ giật nhận trọn "hàng chưa biết" - kể cả rác
      gain = val > 0 ? Math.round(val * STEAL_SHARE) : val;
      if (val > 0) lake.burn += val - gain;
      v.st = ST_IDLE;
      v.readyAt = now + LAND_LOCK_MS;
      v.lostFish++;
    }
    thief.pts = Math.max(0, thief.pts + gain);
    thief.stealOk++;
    v.robbed++;
    v.immuneUntil = now + IMMUNE_MS;
    if (thief.st !== ST_IDLE) thief.st = ST_IDLE;
    emit(ctx, lake, { type: 'stl', l: thief.lake, by: thief.seat, from: v.seat, ok: 1, k: tg.kind, sp, g: gain, im: v.immuneUntil });
    stateEvent(ctx, lake, thief, ST_IDLE);
    if (tg.kind === 'r') stateEvent(ctx, lake, v, ST_IDLE);
  } else {
    thief.stealMiss++;
    const fine = Math.min(thief.pts, STEAL_MISS_PENALTY);
    thief.pts -= fine;
    lake.burn += fine;
    thief.st = ST_STUN;
    thief.stunUntil = now + STEAL_MISS_STUN_MS;
    emit(ctx, lake, { type: 'stl', l: thief.lake, by: thief.seat, from: v.seat, ok: 0, k: tg.kind, sp: -1, g: -STEAL_MISS_PENALTY, im: 0 });
    stateEvent(ctx, lake, thief, ST_STUN);
  }
}

export const fishingGame: GameDefinition<Config, State> = {
  id: 'fishing',
  name: 'CÂU CÁ TRANH TÀI',
  instructions:
    'Quăng cần, chờ phao nhúng rồi GIẬT cần đúng lúc, sau đó GIỮ/NHẢ để giữ thanh xanh bám theo con cá. Cá hiếm nhiều điểm nhưng giãy rất mạnh, coi chừng câu nhầm giày cũ, lon rỗng bị trừ điểm. Có thể GIẬT cá của người cùng hồ đang kéo hoặc vừa lên bờ, nhưng giật hụt sẽ bị choáng và trừ điểm!',
  controls: [
    { keys: ['SPACE'], desc: 'QUĂNG cần · bấm lại khi phao NHÚNG để giật cần · rồi GIỮ để kéo cá, NHẢ để thanh tụt xuống' },
    { keys: ['F'], desc: 'GIẬT cá người khác (đang kéo hoặc vừa lên bờ), hồi chiêu 6s, hụt thì choáng' },
    { keys: ['CLICK'], desc: 'Chuột / chạm vào hồ = SPACE · bấm vào tên đối thủ để giật đúng người đó' },
  ],
  duration: DURATION_MS + 1500,
  minPlayers: 2,
  maxPlayers: 16,

  createConfig(ctx) {
    const ids = [...ctx.playerIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const lakes: string[][] = [];
    let at = 0;
    for (const sz of lakeSizes(ids.length)) {
      lakes.push(ids.slice(at, at + sz));
      at += sz;
    }
    return { lakes, durationMs: DURATION_MS };
  },

  createState(ctx, config) {
    const byId = new Map<string, Pl>();
    const lakes = config.lakes.map((ids, li) => {
      const lake: Lake = { players: [], burn: 0, rng: mulberry32((Math.random() * 4294967296) >>> 0) };
      ids.forEach((id, seat) => {
        const rng = mulberry32((Math.random() * 4294967296) >>> 0);
        const p: Pl = {
          id,
          lake: li,
          seat,
          rng,
          bag: makeBag(rng),
          bagPos: 0,
          st: ST_IDLE,
          readyAt: 0,
          nibAt: 0,
          biteAt: 0,
          item: 0,
          cls: 0,
          seed: 0,
          reel: newReel(),
          t0: 0,
          tick: 0,
          hi: -1,
          hn: 0,
          hk: new Int16Array(HOLD_CAP + 2),
          hv: new Uint8Array(HOLD_CAP + 2),
          nextRs: 0,
          stunUntil: 0,
          heldUntil: 0,
          heldSp: 0,
          immuneUntil: 0,
          stealReadyAt: 0,
          pts: 0,
          caught: SPECIES.map(() => 0),
          stealOk: 0,
          stealMiss: 0,
          robbed: 0,
          lostFish: 0,
        };
        lake.players.push(p);
        byId.set(id, p);
      });
      return lake;
    });
    return { lakes, byId, nextSnap: 0, done: false };
  },

  onStart(ctx, state) {
    const now = ctx.now();
    state.lakes.forEach((l, li) => emit(ctx, l, snapshot(l, li, now)));
    state.nextSnap = now + SNAP_MS;
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    const now = ctx.now();
    if (now < ctx.startAt || state.done) return;
    const p = state.byId.get(playerId);
    if (!p) return;
    const lake = state.lakes[p.lake];

    switch (input.type) {
      case 'fcast': {
        if (p.st === ST_STUN && now >= p.stunUntil) p.st = ST_IDLE;
        if (p.st !== ST_IDLE || now < p.readyAt) return;
        p.st = ST_WAIT;
        p.nibAt = now + WAIT_MIN_MS + p.rng() * (WAIT_MAX_MS - WAIT_MIN_MS);
        p.biteAt = p.nibAt + NIB_MS;
        stateEvent(ctx, lake, p, ST_WAIT);
        return;
      }
      case 'fhook': {
        if (p.st === ST_WAIT || p.st === ST_NIB) {
          // giật sớm: cá sợ bỏ đi
          setIdle(ctx, lake, p, FAIL_LOCK_MS, now);
          ctx.send(p.id, { type: 'esc', l: p.lake, i: p.seat, why: 'early' });
          return;
        }
        if (p.st !== ST_BITE) return;
        let at = Number(input.at);
        if (!Number.isFinite(at)) at = now;
        at = Math.min(at, now);
        if (at < p.biteAt) at = p.biteAt;
        if (at > p.biteAt + HOOK_MS) return;
        startReel(p, at);
        stateEvent(ctx, lake, p, ST_REEL);
        return;
      }
      case 'fhold': {
        if (p.st !== ST_REEL) return;
        const h = input.h ? 1 : 0;
        const cur = Math.floor((now - p.t0) / STEP_MS);
        let k = Math.floor(Number(input.k));
        if (!Number.isFinite(k)) k = cur;
        if (k < p.tick) k = p.tick;
        if (k > cur + 2) k = cur + 2;
        const n = p.hn;
        if (n > 0 && p.hk[n - 1] > k) k = p.hk[n - 1];
        if (n > 0 && p.hk[n - 1] === k) {
          p.hv[n - 1] = h;
          return;
        }
        if ((n > 0 ? p.hv[n - 1] : 0) === h || n >= HOLD_CAP) return;
        p.hk[n] = k;
        p.hv[n] = h;
        p.hn = n + 1;
        return;
      }
      case 'fsteal':
        trySteal(ctx, state, lake, p, now, typeof input.to === 'string' ? input.to : undefined);
        return;
    }
  },

  update(ctx, state) {
    const now = ctx.now();
    if (now < ctx.startAt || state.done) return;
    for (const lake of state.lakes) {
      for (const p of lake.players) {
        switch (p.st) {
          case ST_STUN:
            if (now >= p.stunUntil) setIdle(ctx, lake, p, 0, now);
            break;
          case ST_WAIT:
            if (now >= p.nibAt) {
              p.st = ST_NIB;
              stateEvent(ctx, lake, p, ST_NIB);
            }
            break;
          case ST_NIB:
            if (now >= p.biteAt) {
              p.item = drawItem(p);
              p.cls = SPECIES[p.item].cls;
              p.seed = (p.rng() * 4294967296) >>> 0;
              p.st = ST_BITE;
              stateEvent(ctx, lake, p, ST_BITE);
              ctx.send(p.id, { type: 'bite', at: p.biteAt, cls: p.cls, seed: p.seed });
            }
            break;
          case ST_BITE:
            if (now > p.biteAt + HOOK_MS + 180) {
              p.lostFish++;
              ctx.send(p.id, { type: 'esc', l: p.lake, i: p.seat, why: 'late' });
              setIdle(ctx, lake, p, FAIL_LOCK_MS, now);
            }
            break;
          case ST_REEL: {
            const target = Math.floor((now - p.t0) / STEP_MS) - LAG_TICKS;
            let res = 0;
            while (p.tick < target && res === 0) {
              while (p.hi + 1 < p.hn && p.hk[p.hi + 1] <= p.tick) p.hi++;
              const hold = p.hi >= 0 && p.hv[p.hi] === 1;
              res = stepReel(p.reel, hold, p.cls, p.seed, p.tick);
              p.tick++;
            }
            if (res === 0 && p.tick >= REEL_MAX_TICKS) res = -1;
            if (res !== 0) endReel(ctx, lake, p, now, res as 1 | -1);
            else if (now >= p.nextRs) {
              p.nextRs = now + RS_MS;
              ctx.send(p.id, {
                type: 'rs',
                k: p.tick,
                y: Math.round(p.reel.y * 1000),
                v: Math.round(p.reel.v * 1000),
                p: Math.round(p.reel.p * 1000),
              });
            }
            break;
          }
        }
      }
    }
    if (now >= state.nextSnap) {
      state.nextSnap = now + SNAP_MS;
      state.lakes.forEach((l, li) => emit(ctx, l, snapshot(l, li, now)));
    }
  },

  isFinished(ctx, state) {
    return ctx.now() - ctx.startAt >= DURATION_MS;
  },

  calculateScore(ctx, state) {
    const out: Record<string, PlayerResult> = {};
    const share = state.lakes.map((l) => Math.round(l.burn / Math.max(1, l.players.length)));
    for (const p of state.byId.values()) {
      const fish = p.caught.reduce((s, n, i) => s + (SPECIES[i].value > 0 ? n : 0), 0);
      const trash = p.caught.reduce((s, n, i) => s + (SPECIES[i].value <= 0 ? n : 0), 0);
      const best = SPECIES.reduce((b, s, i) => (p.caught[i] > 0 && s.value > (b >= 0 ? SPECIES[b].value : -1e9) ? i : b), -1);
      const parts = [`🐟 ${fish} cá`];
      if (best >= 0 && SPECIES[best].value >= 30) parts.push(`${SPECIES[best].emoji} ${SPECIES[best].name}`);
      if (trash) parts.push(`🗑️ ${trash} rác`);
      if (p.stealOk || p.stealMiss) parts.push(`🪝 giật ${p.stealOk}/${p.stealOk + p.stealMiss}`);
      if (p.robbed) parts.push(`😭 mất cá ${p.robbed}`);
      const back = share[p.lake] ?? 0;
      if (back > 0) parts.push(`🎁 +${back} cá rơi vãi`);
      out[p.id] = { raw: p.pts + back, detail: parts.join(' · ') };
    }
    for (const id of ctx.playerIds) out[id] ??= { raw: 0, detail: 'không xuống hồ' };
    // giải phóng dữ liệu ván
    state.done = true;
    state.byId.clear();
    state.lakes.length = 0;
    return out;
  },
};
