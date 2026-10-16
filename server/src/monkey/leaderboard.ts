// Bảng xếp hạng SINH TỒN BẦY KHỈ: ghi vào Store (bảng runs — Postgres hoặc RAM), không còn file JSON.
// Tin 'over' cần bảng NGAY (đồng bộ) → giữ bản đệm trong RAM, làm mới từ Store sau mỗi lần ghi.

import type { LeaderRow } from '../../../shared/monkey/api.js';
import type { BoardEntry } from '../../../shared/monkey/proto.js';
import type { Store, TeamRun } from './db/store.js';

const KEEP = 15;
const cache: { solo: BoardEntry[]; team: BoardEntry[] } = { solo: [], team: [] };
let loaded = false;

const cmp = (a: BoardEntry, b: BoardEntry) => b.wave - a.wave || b.score - a.score || a.at - b.at;

export function rowToEntry(r: LeaderRow): BoardEntry {
  return { names: r.names, cls: r.cls, wave: r.wave, score: r.score, kills: r.kills, players: r.names.length, at: r.at };
}

/** đọc lại bảng vô tận từ Store vào bản đệm */
export async function refreshBoard(store: Store): Promise<{ solo: BoardEntry[]; team: BoardEntry[] }> {
  try {
    const [solo, team] = await Promise.all([store.leaderboard('endless', true, KEEP), store.leaderboard('endless', false, KEEP)]);
    cache.solo = solo.map(rowToEntry);
    cache.team = team.map(rowToEntry);
    loaded = true;
  } catch (e) {
    console.warn('[monkey] không đọc được bảng xếp hạng:', (e as Error).message);
  }
  return cache;
}

/** bảng hiện có trong bản đệm (đồng bộ); lần đầu kích hoạt nạp nền */
export function topRuns(store: Store, solo: boolean, n = 10): BoardEntry[] {
  if (!loaded) {
    loaded = true;
    void refreshBoard(store);
  }
  return (solo ? cache.solo : cache.team).slice(0, n);
}

/**
 * Ghi một ván vào Store (chạy nền) và chèn ngay vào bản đệm nếu là vô tận.
 * Trả thứ hạng tạm tính (1-based, 0 = không lọt bảng) và promise của lần ghi.
 */
export function submitRun(store: Store, t: TeamRun, at: number): { rank: number; done: Promise<void> } {
  let rank = 0;
  if (t.stage === 'endless') {
    const e: BoardEntry = { names: t.names, cls: t.cls, wave: t.wave, score: t.score, kills: t.kills, players: t.names.length, at };
    const list = t.solo ? cache.solo : cache.team;
    list.push(e);
    list.sort(cmp);
    rank = list.indexOf(e) + 1;
    if (list.length > KEEP) list.length = KEEP;
    if (rank > KEEP) rank = 0;
  }
  const done = store
    .recordTeamRun(t, new Date(at))
    .then(() => (t.stage === 'endless' ? refreshBoard(store).then(() => undefined) : undefined))
    .catch((e) => console.warn('[monkey] không ghi được bảng xếp hạng:', (e as Error).message));
  return { rank, done };
}
