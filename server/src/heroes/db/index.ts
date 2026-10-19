// Chọn HeroStore: bám theo store của Bầy Khỉ (cùng DATABASE_URL, cùng pool, cùng schema).
// PgStore của Bầy Khỉ → HeroPgStore trên chính pool đó; ngược lại (không DB / lỗi kết nối) → HeroMemStore.
// KHÔNG BAO GIỜ log DATABASE_URL hay mật khẩu.

import { storeReady } from '../../monkey/db/index.js';
import { PgStore } from '../../monkey/db/pgStore.js';
import { HeroMemStore } from './memStore.js';
import { HeroPgStore } from './pgStore.js';
import type { HeroStore } from './store.js';

export { StoreError } from './store.js';
export type { HeroStore, HState } from './store.js';

let ready: Promise<HeroStore> | null = null;

/** thay store đang dùng (test) */
export function useHeroStore(s: HeroStore) {
  ready = Promise.resolve(s);
}

/** chờ khởi tạo xong rồi trả store; lần đầu sẽ migrate bảng h_* (không bao giờ reject) */
export function heroStoreReady(): Promise<HeroStore> {
  return (ready ??= (async () => {
    const base = await storeReady();
    if (base instanceof PgStore) {
      // tiền tố schema là trường private của PgStore — đọc có chủ đích để dùng chung schema (test dùng schema tạm)
      const hs = new HeroPgStore(base.pool, (base as unknown as { S: string }).S);
      try {
        await hs.init();
        console.log('[heroes-db] dùng Postgres (đã migrate)');
        return hs as HeroStore;
      } catch (e) {
        const m = (e instanceof Error ? e.message : String(e)).replace(/postgres(?:ql)?:\/\/\S+/gi, '<DATABASE_URL>').slice(0, 300);
        console.warn('[heroes-db] ⚠️  KHÔNG MIGRATE ĐƯỢC BẢNG h_* — chuyển sang lưu trong RAM (tiến trình Thẻ Tướng sẽ mất khi khởi động lại). Lỗi:', m);
      }
    }
    const mem = new HeroMemStore();
    await mem.init();
    return mem as HeroStore;
  })());
}
