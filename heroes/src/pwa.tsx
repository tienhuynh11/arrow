// PWA phía client: đăng ký service worker (chỉ bản build), toast "Có bản mới", gợi ý "Cài game về máy".
import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';
import { sfx } from './audio';

/** sự kiện cài đặt của Chrome/Android (chưa có trong lib.dom) */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const needRefresh = signal(false);
export const installEvt = signal<InstallPromptEvent | null>(null);

/** đang chạy như app đã cài (standalone) thì không cần gợi ý cài nữa */
export const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isIOS = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const installed = signal(isStandalone());
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

/** gọi một lần lúc khởi động; không làm gì ở dev server */
export function initPwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // không bật popup mặc định: chỉ hiện nút trong Cài đặt
    installEvt.value = e as InstallPromptEvent;
  });
  addEventListener('appinstalled', () => {
    installed.value = true;
    installEvt.value = null;
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    onNeedRefresh() {
      needRefresh.value = true;
    },
    onRegisteredSW(_url, reg) {
      // người chơi mở app lâu: kiểm tra bản mới mỗi giờ
      if (reg) setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
}

export async function promptInstall() {
  const e = installEvt.value;
  if (!e) return;
  await e.prompt();
  await e.userChoice.catch(() => null);
  installEvt.value = null;
}

/** toast cố định ở đáy: bản mới đã tải xong, bấm Cập nhật để tải lại */
export function UpdateToast() {
  if (!needRefresh.value) return null;
  return (
    <div class="upd-toast" role="status">
      <span>Có bản mới</span>
      <button
        type="button"
        class="btn green small"
        onClick={() => {
          sfx('tap');
          void updateSW?.(true);
        }}
      >
        Cập nhật
      </button>
      <button type="button" class="upd-x" aria-label="Để sau" onClick={() => (needRefresh.value = false)}>
        ×
      </button>
    </div>
  );
}

/** mục trong Cài đặt: nút cài (Android/Chrome) hoặc hướng dẫn "Thêm vào Màn hình chính" (iOS) */
export function InstallHint() {
  if (installed.value) return null;
  if (installEvt.value) {
    return (
      <div class="set-row col">
        <b>Cài game về máy</b>
        <button type="button" class="btn blue small" onClick={() => void promptInstall()}>
          Cài đặt ứng dụng
        </button>
        <small>Mở nhanh từ màn hình chính, chạy toàn màn hình.</small>
      </div>
    );
  }
  if (isIOS()) {
    return (
      <div class="set-row col">
        <b>Cài game về máy</b>
        <small>Trong Safari, bấm nút Chia sẻ rồi chọn “Thêm vào Màn hình chính”.</small>
      </div>
    );
  }
  return null;
}
