// Khung mô phỏng mạng (đồng hồ ảo) nối server thật (fartGame) với các FartCore (client thật) - không cần trình duyệt.
import { fartGame } from '../src/games/fart.js';
import type { GameContext } from '../src/games/types.js';
import { FartCore } from '../../shared/raftClient.js';
import { HoldBot } from './fartBot.js';

export interface NetProfile {
  name: string;
  /** RTT trung bình (ms) */
  rtt: number;
  /** jitter một chiều ± (ms) */
  jitter: number;
  /** xác suất mỗi gói bị "mất" -> TCP gửi lại: trễ thêm ~ retransmit ms */
  loss: number;
  retransmit?: number;
}

interface Item {
  at: number;
  seq: number;
  fn: () => void;
}

export interface Harness {
  server: { calls: number; ms: number };
  bytesDown: Record<string, number>;
  msgsDown: Record<string, number>;
  bytesUp: Record<string, number>;
  msgsUp: Record<string, number>;
  clients: Record<string, { core: FartCore; id: string }>;
  state: any;
  config: any;
  ctx: GameContext;
  run(seconds: number, onFrame?: (id: string, core: FartCore, mono: number) => void): void;
  now: number;
  startAt: number;
  fartLog: { ti: number; s: number; n: number; t: number; a: number; p: number }[];
  samples: Record<string, { mono: number; x: number; y: number; a: number; tick: number; frac: number }[]>;
}

export function makeHarness(playerIds: string[], profile: NetProfile, opts: { clients?: boolean; seed?: number } = {}): Harness {
  const withClients = opts.clients !== false;
  let rngS = (opts.seed ?? 7) >>> 0;
  const rnd = () => {
    rngS = (Math.imul(rngS, 1664525) + 1013904223) >>> 0;
    return rngS / 4294967296;
  };
  const BASE = 1_700_000_000_000;
  let vnow = BASE;
  const startAt = BASE + 3000;
  const queue: Item[] = [];
  let seq = 0;
  const lastAt: Record<string, number> = {};
  const push = (link: string, delay: number, fn: () => void) => {
    let at = vnow + delay;
    if (rnd() < profile.loss) at += profile.retransmit ?? 200;
    at = Math.max(at, lastAt[link] ?? 0);
    lastAt[link] = at;
    queue.push({ at, seq: seq++, fn });
  };
  const oneWay = () => Math.max(1, profile.rtt / 2 + (rnd() * 2 - 1) * profile.jitter);

  const H: Harness = {
    server: { calls: 0, ms: 0 },
    bytesDown: {},
    msgsDown: {},
    bytesUp: {},
    msgsUp: {},
    clients: {},
    state: null,
    config: null,
    ctx: null as any,
    now: 0,
    startAt,
    fartLog: [],
    samples: {},
    run: null as any,
  };

  const deliver = (id: string, payload: any) => {
    const s = JSON.stringify(payload);
    const k = payload.k ?? '?';
    H.bytesDown[k] = (H.bytesDown[k] ?? 0) + s.length;
    H.msgsDown[k] = (H.msgsDown[k] ?? 0) + 1;
    if (payload.k === 'f' && id === H.config.teams[payload.ti][0]) {
      H.fartLog.push({ ti: payload.ti, s: payload.s, n: payload.n, t: payload.t, a: payload.a, p: payload.p });
    }
    if (!withClients) return;
    push('d' + id, oneWay(), () => H.clients[id]?.core.onMessage(JSON.parse(s)));
  };

  const ctx: GameContext = {
    playerIds,
    startAt,
    endAt: startAt + fartGame.duration,
    now: () => vnow,
    broadcast: (p) => {
      for (const id of playerIds) deliver(id, p);
    },
    send: (id, p) => deliver(id, p),
  };
  H.ctx = ctx;
  const config = fartGame.createConfig(ctx);
  const state = fartGame.createState(ctx, config);
  H.config = config;
  H.state = state;

  if (withClients) {
    for (const id of playerIds) {
      const clockErr = (rnd() * 2 - 1) * 12;
      const core = new FartCore(config, id, startAt, (input) => {
        const s = JSON.stringify(input);
        H.bytesUp[input.type] = (H.bytesUp[input.type] ?? 0) + s.length;
        H.msgsUp[input.type] = (H.msgsUp[input.type] ?? 0) + 1;
        push('u' + id, oneWay(), () => {
          const t0 = performance.now();
          fartGame.handleInput(ctx, state, config, id, JSON.parse(s));
          H.server.ms += performance.now() - t0;
        });
      });
      (core as any)._clockErr = clockErr;
      H.clients[id] = { core, id };
      H.samples[id] = [];
    }
  }

  H.run = (seconds, onFrame) => {
    const end = vnow + seconds * 1000;
    let nextServer = vnow;
    const FR = 1000 / 60;
    const nextFrame: Record<string, number> = {};
    for (const id of playerIds) nextFrame[id] = vnow + rnd() * FR;
    for (;;) {
      let tNext = nextServer;
      if (withClients) for (const id of playerIds) if (nextFrame[id] < tNext) tNext = nextFrame[id];
      if (queue.length) {
        let mi = 0;
        for (let i = 1; i < queue.length; i++) {
          if (queue[i].at < queue[mi].at || (queue[i].at === queue[mi].at && queue[i].seq < queue[mi].seq)) mi = i;
        }
        if (queue[mi].at <= tNext) {
          const it = queue.splice(mi, 1)[0];
          vnow = Math.max(vnow, it.at);
          it.fn();
          continue;
        }
      }
      if (tNext > end) break;
      vnow = tNext;
      if (vnow >= nextServer) {
        const t0 = performance.now();
        fartGame.update(ctx, state, config);
        H.server.ms += performance.now() - t0;
        H.server.calls++;
        nextServer += 50;
      }
      if (withClients) {
        for (const id of playerIds) {
          if (nextFrame[id] <= vnow) {
            const c = H.clients[id].core;
            c.frame(vnow, vnow + (c as any)._clockErr);
            if (vnow >= startAt) {
              H.samples[id].push({ mono: vnow, x: c.px, y: c.py, a: c.pa, tick: c.tick, frac: c.frac });
              onFrame?.(id, c, vnow);
            }
            nextFrame[id] += FR;
          }
        }
      }
      H.now = vnow;
      if (fartGame.isFinished(ctx, state, config)) break;
    }
    H.now = vnow;
  };
  return H;
}

/** bot GIỮ/BUÔNG: HoldBot quyết định, core áp dụng (đúng đường đi của người chơi thật) */
export function botDriver(seed = 1) {
  const bots: Record<string, HoldBot> = {};
  let k = 0;
  return (id: string, core: FartCore, mono: number) => {
    if (core.tick < 0) return;
    const b = (bots[id] ??= new HoldBot(seed * 97 + k++));
    const e = b.step(core.c, core.sim.S, core.tick);
    if (!e) return;
    core.setAimWorld(e.a);
    if (e.down && !core.holding) core.press(mono);
    else if (!e.down && core.holding) core.release();
  };
}
