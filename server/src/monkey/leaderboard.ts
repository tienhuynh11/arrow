// Bảng xếp hạng SINH TỒN BẦY KHỈ: file JSON nhỏ, ghi nguyên tử, giới hạn số dòng. Không cần DB.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BoardEntry } from '../../../shared/monkey/proto.js';

const FILE = resolve(process.env.MONKEY_DATA_DIR ?? join(process.cwd(), 'data', 'monkey'), 'leaderboard.json');
const KEEP = 60; // mỗi bảng (solo / đội) giữ tối đa

interface Store { solo: BoardEntry[]; team: BoardEntry[] }

let store: Store | null = null;
let dirty = false;
let timer: NodeJS.Timeout | null = null;

function load(): Store {
  if (store) return store;
  store = { solo: [], team: [] };
  try {
    if (existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, 'utf8'));
      if (Array.isArray(raw?.solo)) store.solo = raw.solo.filter(valid).slice(0, KEEP);
      if (Array.isArray(raw?.team)) store.team = raw.team.filter(valid).slice(0, KEEP);
    }
  } catch (e) {
    console.warn('[monkey] không đọc được bảng xếp hạng:', (e as Error).message);
  }
  return store;
}

function valid(e: any): e is BoardEntry {
  return e && Array.isArray(e.names) && typeof e.wave === 'number' && typeof e.score === 'number';
}

const cmp = (a: BoardEntry, b: BoardEntry) => b.wave - a.wave || b.score - a.score || a.at - b.at;

function flushSoon() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (!dirty || !store) return;
    dirty = false;
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(store));
      renameSync(tmp, FILE);
    } catch (e) {
      console.warn('[monkey] không ghi được bảng xếp hạng:', (e as Error).message);
    }
  }, 1500);
  timer.unref?.();
}

/** thêm một ván; trả thứ hạng (1-based) hoặc 0 nếu không lọt bảng */
export function submitRun(e: BoardEntry): number {
  const s = load();
  const list = e.players <= 1 ? s.solo : s.team;
  list.push(e);
  list.sort(cmp);
  const rank = list.indexOf(e) + 1;
  if (list.length > KEEP) list.length = KEEP;
  if (rank > KEEP) return 0;
  flushSoon();
  return rank;
}

export function topRuns(solo: boolean, n = 10): BoardEntry[] {
  const s = load();
  return (solo ? s.solo : s.team).slice(0, n);
}
