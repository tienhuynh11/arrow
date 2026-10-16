// Chọn Store khi khởi động: PgStore nếu có DATABASE_URL, ngược lại MemStore.
// Lỗi kết nối/migrate → ghi cảnh báo to và chuyển sang MemStore (game vẫn chạy, chỉ là không lưu lâu dài).
// KHÔNG BAO GIỜ log DATABASE_URL hay mật khẩu.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemStore } from './memStore.js';
import { PgStore } from './pgStore.js';
import type { Store } from './store.js';

export { StoreError } from './store.js';
export type { Store, RunResult, TeamRun, AccountRow } from './store.js';

let store: Store = new MemStore();
let ready: Promise<Store> | null = null;

/**
 * Nạp server/.env cho chạy local: chỉ khi file tồn tại, và không ghi đè biến đã có.
 * Định dạng KEY=VALUE mỗi dòng, bỏ qua dòng trống / dòng bắt đầu bằng #, bỏ nháy bao quanh.
 */
export function loadDotEnv(file?: string) {
  const candidates = file ? [file] : [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'server', '.env')];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return false;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

/** store hiện tại (có thể chưa migrate xong — route nên dùng storeReady()) */
export function getStore(): Store {
  return store;
}

/** chờ khởi tạo xong rồi trả store (an toàn gọi trước cả initStore) */
export function storeReady(): Promise<Store> {
  return ready ?? initStore();
}

/** thay store đang dùng (test) */
export function useStore(s: Store) {
  store = s;
  ready = Promise.resolve(s);
}

/** gọi một lần lúc server khởi động; không bao giờ reject */
export function initStore(): Promise<Store> {
  if (ready) return ready;
  ready = (async () => {
    loadDotEnv();
    const url = process.env.DATABASE_URL;
    if (url) {
      const pgs = new PgStore({ connectionString: url });
      store = pgs;
      try {
        await pgs.init();
        console.log('[monkey-db] dùng Postgres (đã migrate)');
        return store;
      } catch (e) {
        console.warn('==================================================================');
        console.warn('[monkey-db] ⚠️  KHÔNG KẾT NỐI ĐƯỢC POSTGRES — chuyển sang lưu trong RAM.');
        console.warn('[monkey-db]    Tài khoản và tiến trình SẼ MẤT khi server khởi động lại!');
        console.warn('[monkey-db]    Lỗi:', safeMsg(e));
        console.warn('==================================================================');
        pgs.close().catch(() => {});
      }
    } else {
      console.log('[monkey-db] không có DATABASE_URL — dùng store trong RAM (mất khi khởi động lại)');
    }
    const mem = new MemStore();
    await mem.init();
    store = mem;
    return store;
  })();
  return ready;
}

/** thông báo lỗi không lộ chuỗi kết nối */
function safeMsg(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/postgres(?:ql)?:\/\/\S+/gi, '<DATABASE_URL>').slice(0, 300);
}
