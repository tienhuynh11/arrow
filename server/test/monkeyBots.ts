// Bot WebSocket THẬT cho SINH TỒN BẦY KHỈ: nhiều phòng song song, độ trễ giả lập, đo băng thông/RSS/CPU.
// cd server && npx tsx test/monkeyBots.ts <cổng=8787> <số phòng=1> <người/phòng=2> <giây=60> [rtt ms=0]
import { WebSocket } from 'ws';
import { GameModel } from '../../shared/monkey/client.js';
import { MONKEY_WS_PATH } from '../../shared/monkey/config.js';
import { PLAYER_SPAWNS } from '../../shared/monkey/map.js';
import { SnapData, decodeSnap, encodeCmds, type SMsg } from '../../shared/monkey/proto.js';
import type { Cmd } from '../../shared/monkey/sim.js';
import { BotBrain } from './monkeyBot.js';

const PORT = Number(process.argv[2] ?? 8787);
const ROOMS = Number(process.argv[3] ?? 1);
const PER = Number(process.argv[4] ?? 2);
const SECS = Number(process.argv[5] ?? 60);
const RTT = Number(process.argv[6] ?? 0);
const URL = `ws://localhost:${PORT}${MONKEY_WS_PATH}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const delay = (fn: () => void) => (RTT > 0 ? setTimeout(fn, RTT / 2) : fn());

interface Bot {
  ws: WebSocket;
  idx: number;
  model: GameModel | null;
  brain: BotBrain;
  bytes: number;
  snaps: number;
  over: any;
  wave: number;
  code: string;
  firstDown: number;
}

async function mkBot(i: number): Promise<Bot> {
  const ws = new WebSocket(URL);
  const b: Bot = { ws, idx: -1, model: null, brain: new BotBrain(i * 7 + 1, 0.6), bytes: 0, snaps: 0, over: null, wave: 0, code: '', firstDown: -1 };
  const snap = new SnapData();
  ws.on('message', (d: Buffer, bin: boolean) => delay(() => {
    b.bytes += d.byteLength;
    if (bin) {
      b.snaps++;
      if (b.model && decodeSnap(new DataView(d.buffer, d.byteOffset, d.byteLength), snap)) b.model.onSnap(snap, performance.now());
      return;
    }
    const m = JSON.parse(String(d)) as SMsg;
    if (m.t === 'joined') { b.idx = m.idx; b.code = m.code; }
    else if (m.t === 'start') {
      const me = m.players.find((p) => p.idx === b.idx)!;
      const sp = PLAYER_SPAWNS[b.idx];
      b.model = new GameModel(b.idx, me.cls, sp.x, sp.z);
      b.model.rttMs = RTT || 5;
    } else if (m.t === 'wave') b.wave = m.n;
    else if (m.t === 'over') b.over = m;
    else if (m.t === 'ev' && m.k === 'down' && m.i === b.idx && b.firstDown < 0) b.firstDown = Date.now();
    else if (m.t === 'err') console.log('err', m.m);
  }));
  await new Promise((r) => ws.on('open', r));
  return b;
}

const send = (b: Bot, m: unknown) => delay(() => b.ws.readyState === 1 && b.ws.send(JSON.stringify(m)));

async function health() {
  const r = await fetch(`http://localhost:${PORT}/monkey/health`);
  return r.json() as Promise<any>;
}

const h0 = await health();
const all: Bot[][] = [];
for (let r = 0; r < ROOMS; r++) {
  const bots: Bot[] = [];
  const host = await mkBot(r * 10);
  bots.push(host);
  send(host, { t: 'create', name: `R${r}B0`, cls: 0, solo: PER === 1 });
  while (!host.code) await wait(20);
  for (let i = 1; i < PER; i++) {
    const b = await mkBot(r * 10 + i);
    bots.push(b);
    send(b, { t: 'join', code: host.code, name: `R${r}B${i}`, cls: i % 4 });
  }
  await wait(300);
  for (const b of bots.slice(1)) send(b, { t: 'ready', r: true });
  await wait(300);
  if (PER > 1) send(host, { t: 'start' });
  all.push(bots);
}
const startAt = Date.now();
const cmds: Cmd[] = [];
let maxTick = 0;
let peakRss = 0;
let lastBr = 0;
const tick = setInterval(() => {
  const now = performance.now();
  for (const bots of all) for (const b of bots) {
    if (!b.model || b.over) continue;
    const inp = b.brain.think(b.model, now);
    cmds.length = 0;
    b.model.frame(now, inp.mx, inp.mz, inp.yaw, inp.pitch, inp.btn, cmds);
    if (cmds.length) {
      const buf = encodeCmds(cmds, 0, Math.min(cmds.length, 12));
      delay(() => b.ws.readyState === 1 && b.ws.send(buf));
    }
    if (b.brain.wantBreakReady && now - lastBr > 1500) { lastBr = now; send(b, { t: 'bready', r: true }); }
  }
}, 1000 / 60);
const mon = setInterval(async () => {
  try {
    const h = await health();
    maxTick = Math.max(maxTick, h.maxTickMs);
    peakRss = Math.max(peakRss, h.rss);
  } catch { /* */ }
}, 1000);
const cpu0 = process.cpuUsage();
while (Date.now() - startAt < SECS * 1000 && !all.every((bs) => bs.every((b) => b.over))) await wait(250);
clearInterval(tick);
clearInterval(mon);
const el = (Date.now() - startAt) / 1000;
const h1 = await health();
const bots = all.flat();
const kbps = bots.reduce((a, b) => a + b.bytes, 0) / bots.length / el / 1024;
const corr = bots.map((b) => b.model?.maxCorrection ?? 0);
console.log(JSON.stringify({
  rooms: ROOMS, perRoom: PER, rtt: RTT, secs: +el.toFixed(0),
  waves: all.map((bs) => bs[0].over?.wave ?? bs[0].wave),
  over: all.map((bs) => !!bs[0].over),
  firstDownS: bots.map((b) => (b.firstDown < 0 ? -1 : Math.round((b.firstDown - startAt) / 1000))),
  kBpsPerClient: +kbps.toFixed(1),
  snapsPerSec: +(bots.reduce((a, b) => a + b.snaps, 0) / bots.length / el).toFixed(1),
  maxCorrectionM: +Math.max(...corr).toFixed(3),
  rssStartMB: +(h0.rss / 1048576).toFixed(1), rssPeakMB: +(peakRss / 1048576).toFixed(1), rssEndMB: +(h1.rss / 1048576).toFixed(1),
  serverMaxTickMs: maxTick,
  botCpuMs: Math.round((process.cpuUsage(cpu0).user) / 1000),
}));
for (const b of bots) b.ws.close();
await wait(300);
process.exit(0);
