// Bot WS cho CÂU CÁ TRANH TÀI (chạy server thật, đo gói tin).
// chạy: cd server && FORCE_GAMES=fishing PORT=8860 npx tsx src/index.ts   (terminal khác)
//       npx tsx test/fishingBots.ts <soBot> [cổng=8860] [maPhong]
import { WebSocket } from 'ws';
import { FishBot, type Strategy } from './fishingBot.js';

const N = Number(process.argv[2] ?? 4);
const PORT = Number(process.argv[3] ?? 8860);
const JOIN = process.argv[4] ?? '';
const WS = `ws://localhost:${PORT}/arrow/ws`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = `[${N} bot]`;

interface Bot {
  ws: WebSocket;
  id: string;
  fb: FishBot | null;
  offset: number;
  bestRtt: number;
  strat: Strategy;
  skill: number;
  seat: number;
  upMsgs: number;
}
const bots: Bot[] = [];
let code = JOIN;
let cfg: any = null;
let t0 = 0;
let startAt = 0;
let scoreRows: any = null;
const kinds: Record<string, { n: number; b: number }> = {};
let totalBytes = 0;
let totalMsgs = 0;
let errors = 0;

for (let i = 0; i < N; i++) {
  const ws = new WebSocket(WS);
  const strat: Strategy = i % 5 === 4 ? 'thief' : i % 3 === 0 ? 'hybrid' : 'fisher';
  const b: Bot = { ws, id: '', fb: null, offset: 0, bestRtt: 1e9, strat, skill: 0.45 + ((i * 37) % 50) / 100, seat: -1, upMsgs: 0 };
  ws.on('message', (d) => {
    const raw = String(d);
    const m = JSON.parse(raw);
    if (m.t === 'time:pong') {
      const rtt = Date.now() - m.clientSent;
      if (rtt <= b.bestRtt) {
        b.bestRtt = rtt;
        b.offset = m.serverTime + rtt / 2 - Date.now();
      }
      return;
    }
    if (m.t === 'error') {
      errors++;
      console.log(tag, 'server báo lỗi:', m.message);
    }
    if (m.t === 'room:joined') {
      b.id = m.playerId;
      if (i === 0 && !JOIN) code = m.code;
    } else if (m.t === 'game:start') {
      cfg = m.config;
      startAt = m.startAt;
      t0 = Date.now();
      const lake = cfg.lakes.findIndex((l: string[]) => l.includes(b.id));
      b.seat = cfg.lakes[lake].indexOf(b.id);
      b.fb = new FishBot({
        seat: b.seat,
        strat: b.strat,
        skill: b.skill,
        seed: 1000 + i,
        send: (input) => {
          b.upMsgs++;
          ws.send(JSON.stringify({ t: 'game:input', gameId: 'fishing', input }));
        },
      });
    } else if (m.t === 'game:event') {
      const p = m.payload;
      if (i === 0) {
        totalMsgs++;
        totalBytes += raw.length;
        const k = (kinds[p.type] ??= { n: 0, b: 0 });
        k.n++;
        k.b += raw.length;
      }
      b.fb?.onEvent(p, Date.now() + b.offset);
    } else if (m.t === 'game:score' && i === 0) {
      scoreRows = m.rows;
    }
  });
  await new Promise((r) => ws.on('open', r));
  for (let q = 0; q < 4; q++) {
    ws.send(JSON.stringify({ t: 'time:ping', clientSent: Date.now(), rtt: 0 }));
    await wait(40);
  }
  if (i === 0 && !JOIN) ws.send(JSON.stringify({ t: 'room:create', name: 'BOT0', maxPlayers: 16 }));
  else {
    while (!code) await wait(50);
    ws.send(JSON.stringify({ t: 'room:join', code, name: `BOT${i}` }));
    await wait(100);
    ws.send(JSON.stringify({ t: 'room:ready', ready: true }));
  }
  bots.push(b);
  await wait(80);
}
await wait(300);
if (!JOIN) bots[0].ws.send(JSON.stringify({ t: 'game:start' }));

const iv = setInterval(() => {
  for (const b of bots) {
    const now = Date.now() + b.offset;
    if (now >= startAt + 400) b.fb?.step(now);
  }
}, 25);

await new Promise<void>((resolve) => {
  const chk = setInterval(() => {
    if (scoreRows) {
      clearInterval(chk);
      resolve();
    }
  }, 500);
  setTimeout(() => {
    console.log(tag, 'HẾT GIỜ CHỜ');
    clearInterval(chk);
    resolve();
  }, 150_000);
});
clearInterval(iv);

const secs = (Date.now() - t0) / 1000;
console.log(tag, 'chia hồ:', cfg?.lakes.map((l: string[]) => l.length).join('+'), `(${cfg?.lakes.length} hồ), ván thật ${secs.toFixed(1)}s (gồm đếm ngược)`);
console.log(tag, `gói xuống của bot0: ${totalMsgs} gói, ${(totalBytes / 1024).toFixed(1)}KB = ${(totalBytes / secs / 1024).toFixed(2)}KB/s, ${(totalMsgs / secs).toFixed(1)} gói/s ->`, Object.entries(kinds).map(([k, v]) => `${k}:${v.n}(${(v.b / v.n).toFixed(0)}B)`).join(' '));
const up = bots.reduce((s, b) => s + b.upMsgs, 0);
console.log(tag, `gói lên: tổng ${up}, TB ${(up / bots.length / (secs - 15)).toFixed(1)} gói/s/người (giới hạn 80), lỗi ${errors}`);
if (scoreRows) {
  const rows = scoreRows as { playerId: string; rank: number; raw: number; detail: string }[];
  const stat: Record<string, number[]> = {};
  for (const b of bots) {
    const r = rows.find((x) => x.playerId === b.id);
    (stat[b.strat] ??= []).push(r?.raw ?? -1);
  }
  console.log(tag, 'điểm TB theo chiến thuật:', Object.entries(stat).map(([k, v]) => `${k}=${(v.reduce((a, c) => a + c, 0) / v.length).toFixed(0)}(n${v.length})`).join(' '));
  console.log(tag, 'bảng điểm:', rows.slice(0, 4).map((r) => `#${r.rank} ${r.raw} ${r.detail}`).join(' || '));
}
for (const b of bots) b.ws.close();
await wait(200);
process.exit(0);
