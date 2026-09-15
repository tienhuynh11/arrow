import {
  Component,
  createContext,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { webglSupported } from '../three/quality';
import { actions } from '../state/store';

// File này KHÔNG import three: chunk 3D chỉ được tải khi thật sự vào game.

export interface Scene3DCallbacks {
  onQuality(label: string): void;
  onFail(): void;
}

const Callbacks = createContext<Scene3DCallbacks>({ onQuality: () => {}, onFail: () => {} });

/** Bắt lỗi của cảnh 3D (tải chunk thất bại, lỗi dựng cảnh…) để hiện thông báo thay vì trắng màn hình. */
class Guard3D extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Unsupported({ lost }: { lost: boolean }) {
  return (
    <div className="g3d-unsupported" role="alert">
      <div className="g3d-unsupported-icon" aria-hidden="true">
        🖥️
      </div>
      <b>{lost ? 'Đồ hoạ 3D vừa gặp lỗi' : 'Máy của bạn không chạy được đồ hoạ 3D'}</b>
      <span>
        Arrow Party cần WebGL để vẽ minigame. Hãy bật "tăng tốc phần cứng" trong cài đặt trình duyệt, cập nhật trình duyệt
        hoặc driver card đồ hoạ, hoặc dùng Chrome / Edge / Firefox bản mới.
      </span>
      {lost && (
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          TẢI LẠI TRANG
        </button>
      )}
    </div>
  );
}

/**
 * Khung cho cảnh 3D (tải lười) của một minigame. Không còn bản 2D:
 * máy không có WebGL, hoặc 3D gặp lỗi giữa chừng → hiện thông báo hướng dẫn.
 */
export function Scene3D({ render }: { render: () => ReactNode }) {
  const [failed, setFailed] = useState(false);
  const supported = webglSupported();

  useEffect(() => () => actions.setQuality3d(null), []);

  const callbacks = useRef<Scene3DCallbacks>({
    onQuality: (label) => actions.setQuality3d(label),
    onFail: () => setFailed(true),
  });

  if (!supported || failed) return <Unsupported lost={supported && failed} />;
  return (
    <Callbacks.Provider value={callbacks.current}>
      <Guard3D onError={() => setFailed(true)}>
        <Suspense fallback={<div className="g3d-loading">Đang tải đồ hoạ 3D…</div>}>{render()}</Suspense>
      </Guard3D>
    </Callbacks.Provider>
  );
}

/**
 * Dựng một cảnh 3D gắn vào `hostRef`, dựng lại khi `deps` đổi, tự dọn khi rời game.
 * Lỗi lúc dựng (không tạo được WebGL context…) → báo lên để hiện thông báo.
 */
export function useScene(
  hostRef: RefObject<HTMLElement>,
  create: (host: HTMLElement, callbacks: Scene3DCallbacks) => { dispose(): void },
  deps: unknown[],
) {
  const callbacks = useContext(Callbacks);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: { dispose(): void } | null = null;
    try {
      scene = create(host, callbacks);
    } catch (err) {
      console.error('[3d] không dựng được cảnh', err);
      callbacks.onFail();
    }
    return () => scene?.dispose();
  }, deps);
}

/** Giữ bản mới nhất của một giá trị trong ref, để vòng lặp 3D đọc mà không phải dựng lại cảnh. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
