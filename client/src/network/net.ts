import type { ClientMessage, GameInput, ServerMessage } from '@shared/protocol';

type Listener = (msg: ServerMessage) => void;

/**
 * Mặc định nối vào ĐÚNG origin của trang, qua đường /ws mà Vite proxy sang
 * server game. Nhờ vậy localhost, LAN và ngrok đều chạy với một port duy nhất,
 * và trang HTTPS tự dùng wss:// nên không dính lỗi mixed content.
 * Khi deploy bản build tĩnh mà không có proxy thì đặt VITE_WS_URL để trỏ thẳng.
 */
const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${import.meta.env.BASE_URL}ws`;

/**
 * Thin WebSocket wrapper with clock synchronisation.
 *
 * Every gameplay timestamp we send is expressed in *server* time: we measure the
 * offset between the local clock and the server clock and add it to Date.now().
 * The server still clamps whatever we send, so a tampered offset cannot help.
 */
export class Net {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];
  private offset = 0;
  private bestRtt = Infinity;
  private syncTimer: number | null = null;

  rtt = 0;
  connected = false;
  onStatus: ((connected: boolean) => void) | null = null;

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.onStatus?.(true);
      // burst of pings first, then a slow heartbeat to track drift
      for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 180);
      this.syncTimer = window.setInterval(() => this.ping(), 5000);
      const pending = this.queue.splice(0);
      for (const m of pending) this.send(m);
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'time:pong') {
        const rtt = Date.now() - msg.clientSent;
        this.rtt = rtt;
        // the lowest-latency sample gives the most accurate offset
        if (rtt <= this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = msg.serverTime + rtt / 2 - Date.now();
        }
        return;
      }
      for (const fn of this.listeners) fn(msg);
    };

    ws.onclose = () => {
      this.connected = false;
      this.onStatus?.(false);
      if (this.syncTimer) window.clearInterval(this.syncTimer);
      this.bestRtt = Infinity;
      setTimeout(() => this.connect(), 1200); // auto reconnect
    };

    ws.onerror = () => ws.close();
  }

  private ping() {
    this.ws?.send(JSON.stringify({ t: 'time:ping', clientSent: Date.now(), rtt: this.rtt } satisfies ClientMessage));
  }

  /** current server time estimate */
  now(): number {
    return Date.now() + this.offset;
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  input(gameId: string, input: GameInput) {
    this.send({ t: 'game:input', gameId, input });
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const net = new Net();
