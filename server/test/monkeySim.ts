// Mô phỏng THỜI GIAN ẢO cả hệ thống SINH TỒN BẦY KHỈ: MonkeyRoom thật + N client GameModel thật,
// nối qua "mạng ảo" có độ trễ/giật cấu hình được, giữ thứ tự như TCP. Chạy nhanh hơn thời gian thực nhiều lần.

import { AI_MS } from '../../shared/monkey/config.js';
import { GameModel } from '../../shared/monkey/client.js';
import { PLAYER_SPAWNS } from '../../shared/monkey/map.js';
import { SnapData, decodeCmds, decodeSnap, encodeCmds, type SMsg } from '../../shared/monkey/proto.js';
import type { Cmd } from '../../shared/monkey/sim.js';
import { MonkeyRoom, type MConn, type MPlayer } from '../src/monkey/room.js';
import { BotBrain } from './monkeyBot.js';

export interface SimCfg {
  players: number;
  classes?: number[];
  rtt: number;
  jitter?: number;
  seconds: number;
  skill?: number;
  seed?: number;
  /** dừng khi hết ván */
  untilOver?: boolean;
  /** gọi mỗi tick server (đo đạc) */
  onTick?: (room: MonkeyRoom, clients: SimClient[], now: number) => void;
  onRoom?: (room: MonkeyRoom) => void;
  onModel?: (cl: SimClient) => void;
}

export interface SimClient {
  idx: number;
  model: GameModel | null;
  brain: BotBrain;
  bytesIn: number;
  snaps: number;
  over: SMsg | null;
  waves: SMsg[];
  events: SMsg[];
  /** thời điểm gục lần đầu (ms ảo) */
  firstDown: number;
}

export interface SimResult {
  room: MonkeyRoom;
  clients: SimClient[];
  wave: number;
  overAt: number;
  simMs: number;
  avgTickMs: number;
  maxTickMs: number;
  bytesPerClientPerSec: number;
  maxCorrection: number;
  corrections: number;
  predictedHits: number;
  serverHits: number;
  peakMonkeys: number;
}

export function runSim(cfg: SimCfg): SimResult {
  let now = 1_000_000;
  const q: { at: number; seq: number; fn: () => void }[] = [];
  let qseq = 0;
  let rnd = (cfg.seed ?? 1) >>> 0;
  const rand = () => {
    rnd = (rnd * 1664525 + 1013904223) >>> 0;
    return rnd / 4294967296;
  };
  const oneWay = () => cfg.rtt / 2 + (cfg.jitter ? (rand() - 0.5) * 2 * cfg.jitter : 0);
  const sched = (at: number, fn: () => void) => {
    q.push({ at, seq: qseq++, fn });
  };

  const room = new MonkeyRoom('SIM00', cfg.players === 1);
  room.manual = true;
  room.clock = () => now;

  const clients: SimClient[] = [];
  const players: MPlayer[] = [];
  const lastDeliverC2S: number[] = [];
  const lastDeliverS2C: number[] = [];
  const snap = new SnapData();
  const cmdOut: Cmd[] = [];
  const cmdDec: Cmd[] = [];
  for (let i = 0; i < 16; i++) cmdDec.push({ seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0, vt: 0 });
  let serverHits = 0;

  for (let i = 0; i < cfg.players; i++) {
    const cl: SimClient = { idx: i, model: null, brain: new BotBrain((cfg.seed ?? 1) * 31 + i, cfg.skill ?? 0.6), bytesIn: 0, snaps: 0, over: null, waves: [], events: [], firstDown: -1 };
    clients.push(cl);
    lastDeliverS2C.push(0);
    lastDeliverC2S.push(0);
    const conn: MConn = {
      sent: 0,
      send(d) {
        const at = Math.max(now + oneWay(), lastDeliverS2C[i]);
        lastDeliverS2C[i] = at;
        const copy = typeof d === 'string' ? d : d.slice();
        sched(at, () => recv(cl, copy));
      },
      close() {},
    };
    const cls = cfg.classes?.[i] ?? i % 4;
    players.push(room.add(`BOT${i + 1}`, cls, conn));
  }

  function recv(cl: SimClient, d: string | Uint8Array) {
    if (typeof d === 'string') {
      cl.bytesIn += d.length;
      const m = JSON.parse(d) as SMsg;
      if (m.t === 'start') {
        const me = m.players.find((p) => p.idx === cl.idx)!;
        const sp = PLAYER_SPAWNS[cl.idx];
        cl.model = new GameModel(cl.idx, me.cls, sp.x, sp.z);
        cl.model.rttMs = cfg.rtt;
        cfg.onModel?.(cl);
      } else if (m.t === 'over') cl.over = m;
      else if (m.t === 'wave') cl.waves.push(m);
      else if (m.t === 'ev') {
        cl.events.push(m);
        if (m.k === 'down' && m.i === cl.idx && cl.firstDown < 0) cl.firstDown = now;
      }
      return;
    }
    cl.bytesIn += d.byteLength;
    cl.snaps++;
    if (!cl.model) return;
    const ok = decodeSnap(new DataView(d.buffer, d.byteOffset, d.byteLength), snap);
    if (!ok) throw new Error('snapshot hỏng');
    cl.model.onSnap(snap, now);
  }

  cfg.onRoom?.(room);
  room.begin();
  const wantMs = cfg.seconds * 1000;
  const end = now + wantMs;
  let nextServer = now + AI_MS;
  let nextFrame = now;
  let ticks = 0;
  let tickSum = 0;
  let tickMax = 0;
  let peak = 0;
  const FRAME = 1000 / 60;
  let lastBready = 0;

  while (now < end) {
    // sự kiện tới hạn
    const tNext = Math.min(nextServer, nextFrame, q.length ? Math.min(...q.map((e) => e.at)) : Infinity);
    now = Math.max(now, tNext);
    q.sort((a, b) => a.at - b.at || a.seq - b.seq);
    while (q.length && q[0].at <= now) q.shift()!.fn();
    if (now >= nextFrame) {
      nextFrame += FRAME;
      for (const cl of clients) {
        const m = cl.model;
        if (!m || cl.over) continue;
        const inp = cl.brain.think(m, now);
        cmdOut.length = 0;
        m.frame(now, inp.mx, inp.mz, inp.yaw, inp.pitch, inp.btn, cmdOut);
        if (cmdOut.length) {
          const buf = new Uint8Array(encodeCmds(cmdOut, 0, cmdOut.length));
          const at = Math.max(now + oneWay(), lastDeliverC2S[cl.idx]);
          lastDeliverC2S[cl.idx] = at;
          const p = players[cl.idx];
          sched(at, () => {
            const n = decodeCmds(new DataView(buf.buffer), cmdDec);
            if (n > 0) room.onCmds(p, cmdDec, n);
          });
        }
        if (cl.brain.wantBreakReady && now - lastBready > 2000) {
          lastBready = now;
          room.setBreakReady(players[cl.idx], true);
        }
      }
    }
    if (now >= nextServer) {
      nextServer += AI_MS;
      if (room.phase === 'play') {
        const t0 = performance.now();
        room.step();
        const dt = performance.now() - t0;
        ticks++;
        tickSum += dt;
        if (dt > tickMax) tickMax = dt;
        if (room.world) peak = Math.max(peak, room.world.count);
        cfg.onTick?.(room, clients, now);
      }
      if (cfg.untilOver !== false && room.phase === 'over' && q.length === 0) break;
    }
  }
  for (const p of players) serverHits += (p as any).statHits ?? 0;
  const simMs = now - 1_000_000;
  const bytes = clients.reduce((a, c) => a + c.bytesIn, 0);
  return {
    room,
    clients,
    wave: room.wave,
    overAt: simMs,
    simMs,
    avgTickMs: tickSum / Math.max(1, ticks),
    maxTickMs: tickMax,
    bytesPerClientPerSec: bytes / clients.length / (simMs / 1000),
    maxCorrection: Math.max(...clients.map((c) => c.model?.maxCorrection ?? 0)),
    corrections: clients.reduce((a, c) => a + (c.model?.corrections ?? 0), 0),
    predictedHits: clients.reduce((a, c) => a + (c.model?.predictedHits ?? 0), 0),
    serverHits,
    peakMonkeys: peak,
  };
}
