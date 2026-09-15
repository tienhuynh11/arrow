import { useCallback, useEffect, useState } from 'react';

// Safari cũ vẫn dùng tiền tố webkit
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as FsDocument;

const currentElement = () => doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;

export const fullscreenSupported = () =>
  typeof document !== 'undefined' &&
  !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled) &&
  !!(document.documentElement.requestFullscreen || (document.documentElement as FsElement).webkitRequestFullscreen);

export async function toggleFullscreen() {
  try {
    if (currentElement()) {
      await (doc().exitFullscreen?.() ?? doc().webkitExitFullscreen?.());
      return;
    }
    // phóng cả trang (không chỉ khung game) để thông báo, nút tắt tiếng… vẫn hiện
    const root = document.documentElement as FsElement;
    await (root.requestFullscreen?.({ navigationUI: 'hide' }) ?? root.webkitRequestFullscreen?.());
  } catch {
    /* trình duyệt từ chối (không phải thao tác của người dùng, iframe bị chặn…) — bỏ qua */
  }
}

export function useFullscreen() {
  const [active, setActive] = useState(() => !!currentElement());

  useEffect(() => {
    const sync = () => setActive(!!currentElement());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  return { supported: fullscreenSupported(), active, toggle: useCallback(() => void toggleFullscreen(), []) };
}
