// Client REST cho /heroes/api/* — kiểu lấy hết từ shared/heroes/api.ts.
// Token phiên lưu localStorage 'heroes-token'; hồ sơ `me` cache thành signal để UI tự cập nhật.
import { signal } from '@preact/signals';
import { HEROES_API } from '@shared/heroes/config';
import { levelUpPlan, starUpCost } from '@shared/heroes/formulas';
import {
  ApiError,
  ROUTES,
  type AfkClaimRes,
  type ArenaBattleReq,
  type ArenaBattleRes,
  type ArenaDefenseReq,
  type ArenaRes,
  type ArenaTopRes,
  type ArenaTopRow,
  type AuthRes,
  type BattleReq,
  type BattleRes,
  type BattleStartReq,
  type BattleStartRes,
  type GearEquipReq,
  type GearSalvageReq,
  type GearSalvageRes,
  type GearUnequipReq,
  type GearUpgradeReq,
  type GearUpgradeRes,
  type LeaderRow,
  type LevelUpReq,
  type LevelUpRes,
  type MeResponse,
  type MutateRes,
  type SetSquadReq,
  type SummonReq,
  type SummonRes,
  type QuestClaimReq,
  type QuestClaimRes,
  type ShopBuyReq,
  type ShopBuyRes,
  type SweepRes,
  type TowerBattleReq,
  type TowerBattleRes,
} from '@shared/heroes/api';
import { QUEST_BONUS, QUEST_BY_ID } from '@shared/heroes/quests';
import { SHOP_BY_ID } from '@shared/heroes/shop';
import { enhanceCost, GEAR_BY_ID, gearDefOf, salvageStones } from '@shared/heroes/gear';
import type { Wallet } from '@shared/heroes/types';
import { preloadHeroModels } from './render/gltf-model';
import { store } from './settings';

export { ApiError };

const TOKEN_KEY = 'heroes-token';
let token: string | null = store(TOKEN_KEY) || null;

/** hồ sơ hiện tại (null = chưa đăng nhập) */
export const me = signal<MeResponse | null>(null);
/** chênh lệch giờ server - giờ máy (ms), để đếm AFK/thể lực đúng */
export const clockOffset = signal(0);
export const hasToken = () => !!token;

function setToken(t: string | null) {
  token = t;
  store(TOKEN_KEY, t);
}

function applyMe(m: MeResponse): MeResponse {
  clockOffset.value = m.now - Date.now();
  me.value = m;
  preloadHeroModels(m.heroes.map((h) => h.id)); // tải sớm model glTF của tướng đang sở hữu
  return m;
}

/** giờ server ước lượng (ms epoch) */
export function serverNow(): number {
  return Date.now() + clockOffset.value;
}

async function req<T>(route: string, method: 'GET' | 'POST' = 'GET', body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${HEROES_API}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* không phải JSON */
  }
  if (!res.ok || (data && typeof data.error === 'string')) {
    const msg = (data && typeof data.error === 'string' && data.error) || `Lỗi máy chủ (${res.status})`;
    if (res.status === 401 && auth && token) {
      // token hết hạn / bị thu hồi -> về màn đăng nhập
      setToken(null);
      me.value = null;
    }
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

async function mutate<T extends MutateRes>(route: string, body: unknown): Promise<T> {
  const r = await req<T>(route, 'POST', body);
  applyMe(r.me);
  return r;
}

/* ---- nâng cấp "lạc quan": cập nhật màn hình NGAY, gửi server nối đuôi theo thứ tự, đối chiếu khi xong ---- */
let pending = 0;
let chain: Promise<unknown> = Promise.resolve();
function optimistic<T extends MutateRes>(patch: (m: MeResponse) => MeResponse | null, route: string, body: unknown): Promise<T> {
  const cur = me.value;
  const next = cur && patch(cur);
  if (next) me.value = next;
  pending++;
  const p = chain.then(() => req<T>(route, 'POST', body));
  chain = p.then(() => undefined, () => undefined);
  return p.then(
    (r) => {
      if (--pending === 0) applyMe(r.me); // còn yêu cầu đang chờ thì giữ số lạc quan, tránh nhảy lùi
      return r;
    },
    async (e) => {
      if (--pending === 0) await api.refresh().catch(() => null); // lỗi: trả về số thật của server
      throw e;
    },
  );
}

function walletDelta(w: Wallet, d: Partial<Wallet>, sign: 1 | -1): Wallet {
  return {
    gold: w.gold + sign * (d.gold ?? 0),
    gems: w.gems + sign * (d.gems ?? 0),
    tickets: w.tickets + sign * (d.tickets ?? 0),
    exp: w.exp + sign * (d.exp ?? 0),
    stones: w.stones + sign * (d.stones ?? 0),
  };
}
const COST_KEYS = ['gold', 'gems', 'tickets', 'exp', 'stones'] as const;

export const api = {
  async register(username: string, password: string) {
    const r = await req<AuthRes>(ROUTES.register, 'POST', { username, password }, false);
    setToken(r.token);
    return applyMe(r.me);
  },
  async login(username: string, password: string) {
    const r = await req<AuthRes>(ROUTES.login, 'POST', { username, password }, false);
    setToken(r.token);
    return applyMe(r.me);
  },
  async logout() {
    try {
      if (token) await req(ROUTES.logout, 'POST', {});
    } catch {
      /* vẫn đăng xuất cục bộ */
    }
    setToken(null);
    me.value = null;
  },
  async refresh() {
    if (!token) return null;
    return applyMe(await req<MeResponse>(ROUTES.me));
  },

  summon: (banner: string, count: 1 | 10, pay: 'tickets' | 'gems', key: string) =>
    mutate<SummonRes>(ROUTES.summon, { banner, count, pay, key } satisfies SummonReq),
  levelUp: (hero: string, times = 1) =>
    optimistic<LevelUpRes>(
      (m) => {
        const o = m.heroes.find((h) => h.id === hero);
        if (!o) return null;
        const p = levelUpPlan(o.level, o.star, m.wallet.gold, m.wallet.exp, times);
        if (p.n === 0) return null;
        return {
          ...m,
          wallet: { ...m.wallet, gold: m.wallet.gold - p.gold, exp: m.wallet.exp - p.exp },
          heroes: m.heroes.map((h) => (h.id === hero ? { ...h, level: h.level + p.n } : h)),
        };
      },
      ROUTES.levelUp,
      { hero, times } satisfies LevelUpReq,
    ),
  starUp: (hero: string) =>
    optimistic<MutateRes>(
      (m) => {
        const o = m.heroes.find((h) => h.id === hero);
        const need = o ? starUpCost(o.star) : null;
        if (!o || need === null || o.shards < need) return null;
        return { ...m, heroes: m.heroes.map((h) => (h.id === hero ? { ...h, star: h.star + 1, shards: h.shards - need } : h)) };
      },
      ROUTES.starUp,
      { hero },
    ),
  /* ---- trang bị (lạc quan giống levelUp: đổi số ngay, server đối chiếu sau) ---- */
  gearEquip: (uid: number, hero: string) =>
    optimistic<MutateRes>(
      (m) => {
        const it = m.gear.find((g) => g.uid === uid);
        if (!it) return null;
        const slot = GEAR_BY_ID[it.def]?.slot;
        return {
          ...m,
          gear: m.gear.map((g) => {
            if (g.uid === uid) return { ...g, hero };
            // món cũ cùng ô của tướng này về kho
            if (g.hero === hero && GEAR_BY_ID[g.def]?.slot === slot) return { ...g, hero: null };
            return g;
          }),
        };
      },
      ROUTES.gearEquip,
      { uid, hero } satisfies GearEquipReq,
    ),
  gearUnequip: (uid: number) =>
    optimistic<MutateRes>(
      (m) => (m.gear.some((g) => g.uid === uid) ? { ...m, gear: m.gear.map((g) => (g.uid === uid ? { ...g, hero: null } : g)) } : null),
      ROUTES.gearUnequip,
      { uid } satisfies GearUnequipReq,
    ),
  gearUpgrade: (uid: number, times = 1) =>
    optimistic<GearUpgradeRes>(
      (m) => {
        const it = m.gear.find((g) => g.uid === uid);
        if (!it) return null;
        const rar = gearDefOf(it.def).rarity;
        let { gold, stones } = m.wallet;
        let lv = it.level;
        for (let i = 0; i < times; i++) {
          const c = enhanceCost(rar, lv);
          if (!c || c.gold > gold || c.stones > stones) break;
          gold -= c.gold;
          stones -= c.stones;
          lv++;
        }
        if (lv === it.level) return null;
        return { ...m, wallet: { ...m.wallet, gold, stones }, gear: m.gear.map((g) => (g.uid === uid ? { ...g, level: lv } : g)) };
      },
      ROUTES.gearUpgrade,
      { uid, times } satisfies GearUpgradeReq,
    ),
  gearSalvage: (uids: number[]) =>
    optimistic<GearSalvageRes>(
      (m) => {
        const set = new Set(uids);
        const gone = m.gear.filter((g) => set.has(g.uid) && !g.hero);
        if (!gone.length) return null;
        const stones = gone.reduce((a, g) => a + salvageStones(gearDefOf(g.def).rarity, g.level), 0);
        const dead = new Set(gone.map((g) => g.uid));
        return { ...m, wallet: { ...m.wallet, stones: m.wallet.stones + stones }, gear: m.gear.filter((g) => !dead.has(g.uid)) };
      },
      ROUTES.gearSalvage,
      { uids } satisfies GearSalvageReq,
    ),
  setSquad: (squad: number, slots: string[], active = true) =>
    mutate<MutateRes>(ROUTES.setSquad, { squad, slots, active } satisfies SetSquadReq),
  battleStart: (stage: string) => req<BattleStartRes>(ROUTES.battleStart, 'POST', { stage } satisfies BattleStartReq),
  battle: (r: BattleReq) => mutate<BattleRes>(ROUTES.battle, r),
  sweep: (stage: string, times: number) => mutate<SweepRes>(ROUTES.sweep, { stage, times }),
  afkClaim: () => mutate<AfkClaimRes>(ROUTES.afkClaim, {}),
  /* ---- tháp: dùng seed của battleStart('tower') ---- */
  towerBattle: (r: TowerBattleReq) => mutate<TowerBattleRes>(ROUTES.towerBattle, r),
  /* ---- nhiệm vụ: cộng thưởng + đánh dấu đã nhận ngay, server đối chiếu sau (lỗi thì tải lại) ---- */
  questClaim: (id: string) =>
    optimistic<QuestClaimRes>(
      (m) => {
        const q = m.quests;
        if (!q) return null;
        if (id === 'bonus') {
          if (q.bonusClaimed || !q.list.every((x) => x.claimed)) return null;
          return { ...m, wallet: walletDelta(m.wallet, QUEST_BONUS, 1), quests: { ...q, bonusClaimed: true } };
        }
        const def = QUEST_BY_ID[id];
        const st = q.list.find((x) => x.id === id);
        if (!def || !st || st.claimed || st.progress < def.target) return null;
        return {
          ...m,
          wallet: walletDelta(m.wallet, def.reward, 1),
          quests: { ...q, list: q.list.map((x) => (x.id === id ? { ...x, claimed: true } : x)) },
        };
      },
      ROUTES.questClaim,
      { id } satisfies QuestClaimReq,
    ),
  /* ---- cửa hàng: trừ tiền + tăng bộ đếm ngay (rương trang bị thì chờ server báo món rớt) ---- */
  shopBuy: (item: string, times = 1, hero?: string) =>
    optimistic<ShopBuyRes>(
      (m) => {
        const it = SHOP_BY_ID[item];
        if (!it) return null;
        const bought = m.shop?.[item] ?? 0;
        let n = Math.min(times, it.limit - bought);
        for (const k of COST_KEYS) {
          const c = it.cost[k] ?? 0;
          if (c > 0) n = Math.min(n, Math.floor(m.wallet[k] / c));
        }
        if (n <= 0) return null;
        let next: MeResponse = { ...m, shop: { ...(m.shop ?? {}), [item]: bought + n } };
        next.wallet = walletDelta(m.wallet, Object.fromEntries(COST_KEYS.map((k) => [k, (it.cost[k] ?? 0) * n])) as Partial<Wallet>, -1);
        const g = it.give;
        if (g.kind === 'wallet') {
          next.wallet = walletDelta(next.wallet, Object.fromEntries(COST_KEYS.map((k) => [k, (g.give[k] ?? 0) * n])) as Partial<Wallet>, 1);
        } else if (g.kind === 'stamina') {
          next = { ...next, profile: { ...next.profile, stamina: next.profile.stamina + g.amount * n } };
        } else if (g.kind === 'shards') {
          if (!hero || !m.heroes.some((h) => h.id === hero)) return null;
          next = { ...next, heroes: next.heroes.map((h) => (h.id === hero ? { ...h, shards: h.shards + g.amount * n } : h)) };
        }
        return next;
      },
      ROUTES.shopBuy,
      { item, times, hero } satisfies ShopBuyReq,
    ),
  /* ---- đấu trường: GET danh sách đối thủ; đội phòng thủ + trận đánh cập nhật hồ sơ; seed của battleStart('arena') ---- */
  arena: () => req<ArenaRes>(ROUTES.arena),
  arenaDefense: (squad: number) => mutate<MutateRes>(ROUTES.arenaDefense, { squad } satisfies ArenaDefenseReq),
  arenaBattle: (r: ArenaBattleReq) => mutate<ArenaBattleRes>(ROUTES.arenaBattle, r),
  async arenaTop(): Promise<ArenaTopRow[]> {
    const r = await req<ArenaTopRes | ArenaTopRow[]>(ROUTES.arenaTop);
    return Array.isArray(r) ? r : (r?.rows ?? []);
  },
  async leaderboard(): Promise<LeaderRow[]> {
    const r = await req<LeaderRow[] | { rows?: LeaderRow[] }>(ROUTES.leaderboard);
    return Array.isArray(r) ? r : (r?.rows ?? []);
  },
};
