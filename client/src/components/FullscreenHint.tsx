import { useState } from 'react';
import { useFullscreen } from '../utils/fullscreen';

// ẩn rồi thì cả phiên không hiện lại nữa
let dismissed = false;

/** Lời nhắc bật toàn màn hình, có nút bật ngay (cần thao tác của người dùng nên không tự bật được). */
export default function FullscreenHint({ compact = false }: { compact?: boolean }) {
  const fs = useFullscreen();
  const [hidden, setHidden] = useState(dismissed);
  if (!fs.supported || fs.active || hidden) return null;

  return (
    <div className={`fs-hint ${compact ? 'compact' : ''}`} role="note">
      <span className="fs-hint-icon" aria-hidden="true">
        ⛶
      </span>
      <span className="fs-hint-text">
        Chọn chế độ <b>toàn màn hình</b> để có trải nghiệm tốt nhất
      </span>
      <button
        type="button"
        className="btn primary fs-hint-btn"
        onClick={(e) => {
          e.currentTarget.blur();
          fs.toggle();
        }}
      >
        TOÀN MÀN HÌNH (F)
      </button>
      <button
        type="button"
        className="fs-hint-close"
        aria-label="Ẩn lời nhắc"
        onClick={(e) => {
          e.currentTarget.blur();
          dismissed = true;
          setHidden(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
