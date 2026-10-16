// WebSocket riêng của game (`${BASE}ws`): JSON điều khiển + nhị phân (lệnh/snapshot), đồng bộ đồng hồ,
// tự nối lại và tự vào lại phòng bằng token.

import type { CMsg, SMsg } from '@shared/monkey/proto';
import { encodeCmds, MAX_CMDS_PER_MSG } from '@shared/monkey/proto';
import type { Cmd } from '@shared/monkey/sim';

const WS_URL =
  (import.meta.env.VITE_MONKEY_WS_URL as string | undefined) ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${import.meta.env.BASE_URL}ws`;

type JsonFn = (m: SMsg) => void;
type BinFn = (v: DataView) => void;

export class Net {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  onJson: JsonFn = () => {};
  onBin: BinFn = () => {};
  onStatus: (up: boolean) => void = () => {};
  connected = false;
  rtt = 0;
  private bestRtt = 1e9;
  offset = 0;
  private pingTimer = 0;
  private retry = 0;
  bytesIn = 0;
  private pendingCmds: Cmd[] = [];
  private lastCmdSend = 0;

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.bestRtt = 1e9;
      this.onStatus(true);
      for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 150);
      this.pingTimer = window.setInterval(() => this.ping(), 2000);
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.bytesIn += ev.data.length;
        let m: SMsg;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === 'pong') {
          const rtt = performance.now() - m.c;
          this.rtt += (rtt - this.rtt) * (this.rtt === 0 ? 1 : 0.3);
          if (rtt <= this.bestRtt * 1.2) {
            this.bestRtt = Math.min(this.bestRtt, rtt);
            this.offset = m.st + rtt / 2 - Date.now();
          }
          return;
        }
        this.onJson(m);
      } else {
        const buf = ev.data as ArrayBuffer;
        this.bytesIn += buf.byteLength;
        this.onBin(new DataView(buf));
      }
    };
    ws.onclose = () => {
      this.connected = false;
      window.clearInterval(this.pingTimer);
      this.onStatus(false);
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry() {
    this.retry++;
    setTimeout(() => this.connect(), Math.min(5000, 600 * this.retry));
  }

  private ping() {
    this.send({ t: 'ping', c: performance.now() });
  }

  send(m: CMsg) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (m.t !== 'ping') this.queue.push(s);
  }

  /** gom lệnh: gửi khi đủ 2 lệnh hoặc quá 30ms (≈30 gói/giây) */
  queueCmds(cmds: Cmd[], now: number) {
    for (const c of cmds) this.pendingCmds.push(c);
    if (this.pendingCmds.length >= 2 || (this.pendingCmds.length > 0 && now - this.lastCmdSend > 30)) this.flushCmds(now);
  }

  flushCmds(now: number) {
    const ws = this.ws;
    const list = this.pendingCmds;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      list.length = 0;
      return;
    }
    let i = 0;
    while (i < list.length) {
      const n = Math.min(MAX_CMDS_PER_MSG, list.length - i);
      ws.send(encodeCmds(list, i, n));
      i += n;
    }
    list.length = 0;
    this.lastCmdSend = now;
  }

  get serverNow() {
    return Date.now() + this.offset;
  }
}

export const net = new Net();
