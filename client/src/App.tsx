import { useEffect, useState } from 'react';
import { net } from './network/net';
import { useStore } from './state/store';
import { sfx } from './utils/sound';
import { useFullscreen } from './utils/fullscreen';
import Home from './screens/Home';
import Lobby from './screens/Lobby';
import Match from './screens/Match';
import Final from './screens/Final';
import Toasts from './components/Toasts';

/** phím dùng để chơi — trong trận không được làm cuộn trang */
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown']);

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export default function App() {
  const room = useStore((s) => s.room);
  const error = useStore((s) => s.error);
  const final = useStore((s) => s.final);
  const connected = useStore((s) => s.connected);
  const [muted, setMuted] = useState(sfx.isMuted());
  const fs = useFullscreen();

  useEffect(() => {
    // mỗi lần (tái) kết nối, store tự khôi phục phiên chơi đã lưu (xem net.onStatus trong store)
    net.connect();
  }, []);

  const inMatch = !!room && room.phase !== 'lobby' && !(room.phase === 'final' && final);

  // Trong trận: khoá cuộn trang để khung game luôn nằm gọn trong màn hình
  useEffect(() => {
    if (!inMatch) return;
    document.body.classList.add('in-match');
    window.scrollTo(0, 0);
    const stopScroll = (e: KeyboardEvent) => {
      if (GAME_KEYS.has(e.code) && !isTyping(e.target)) e.preventDefault();
    };
    window.addEventListener('keydown', stopScroll);
    return () => {
      document.body.classList.remove('in-match');
      window.removeEventListener('keydown', stopScroll);
    };
  }, [inMatch]);

  // phím F bật/tắt toàn màn hình ở mọi màn (trừ lúc đang gõ tên, mã phòng)
  useEffect(() => {
    if (!fs.supported) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      fs.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fs.supported, fs.toggle]);

  let screen = <Home />;
  if (room) {
    if (room.phase === 'lobby') screen = <Lobby room={room} />;
    else if (room.phase === 'final' && final) screen = <Final room={room} final={final} />;
    else screen = <Match room={room} />;
  }

  return (
    <div className="app">
      {fs.supported && (
        <button
          className="screen-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            fs.toggle();
          }}
          title={fs.active ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)'}
          aria-label={fs.active ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {fs.active ? (
              <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
            ) : (
              <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
            )}
          </svg>
        </button>
      )}
      <button
        className="mute"
        onClick={(e) => {
          // bỏ focus, nếu không phím Space trong game sẽ bấm lại nút này
          e.currentTarget.blur();
          setMuted(sfx.toggleMute());
        }}
        title={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      {!connected && room && <div className="offline-banner">Mất kết nối (đang thử kết nối lại…)</div>}
      {error && <div className="error-banner">{error}</div>}
      {screen}
      <Toasts />
    </div>
  );
}
