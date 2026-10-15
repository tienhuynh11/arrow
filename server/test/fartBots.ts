// Bot WS cho XÌ HƠI CÙNG NHAU: dùng FartCore (client thật) nên có cả dự đoán/rollback.
// chạy: cd server && FORCE_GAMES=fart PORT=8815 npx tsx src/index.ts   (terminal khác)
//       npx tsx test/fartBots.ts <soBot> [cổng=8815]
import { WebSocket } from 'ws';
import { FartCore } from '../../shared/raftClient.js';
import * as R from '../../shared/raft.js';
import { HoldBot } from './fartBot.js';

const N = Number(process.argv[2] ?? 4);
const PORT = Number(process.argv[3] ?? 8815);
const WS = `ws://localhost:${PORT}/arrow/ws`;
const JOIN = process.argv[4] ?? ''; // có mã phòng: các bot chỉ vào phòng có sẵn (người thật/trình duyệt tạo và bấm bắt đầu)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = `[${N} bot]`;

interface Bot {
  ws: WebSocket;
  id: string;
  name: string;
  core: FartCore | null;
  offset: number;
  bestRtt: number;
  hb: HoldBot;
}
const bots: Bot[] = [];
let code = JOIN;
let t0 = 0;
let cfg: any = null;
let startAt = 0;
const kinds: Record<string, { n: number; b: number }> = {};
let totalBytes = 0;
let totalMsgs = 0;
const finLog: string[] = [];
let scoreRows: any = null;
const zoneHits: Record<string, number> = {};
let sinks = 0;
let respawns = 0;
let hitsAll = 0;
let rejected = 0;

for (let i = 0; i < N; i++) {
  const ws = new WebSocket(WS);
  const b: Bot = { ws, id: '', name: 'BOT' + i, core: null, offset: 0, bestRtt: 1e9, hb: new HoldBot(1000 + i * 7) };
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
    if (m.t === 'error') console.log(tag, 'server báo lỗi:', m.message);
    if (m.t === 'room:joined') {
      b.id = m.playerId;
      if (i === 0 && !JOIN) code = m.code;
    } else if (m.t === 'game:start') {
      cfg = m.config;
      startAt = m.startAt;
      t0 = Date.now();
      b.core = new FartCore(m.config, b.id, m.startAt, (input) => ws.send(JSON.stringify({ t: 'game:input', gameId: 'fart', input })));
    } else if (m.t === 'game:event') {
      const p = m.payload;
      if (i === 0) {
        totalMsgs++;
        totalBytes += raw.length;
        const k = (kinds[p.k] ??= { n: 0, b: 0 });
        k.n++;
        k.b += raw.length;
      }
      b.core?.onMessage(p);
      if (p.k === 'x') rejected++;
      if (p.k === 'fin' && i === 0) finLog.push(`bè ${p.ti + 1} về đích hạng ${p.r} lúc ${(((p.t * R.STEP_MS) / 1000)).toFixed(1)}s`);
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

let frames = 0;
const iv = setInterval(() => {
  const mono = performance.now();
  for (const b of bots) {
    const c = b.core;
    if (!c) continue;
    c.frame(mono, Date.now() + b.offset);
    frames++;
    for (const e of c.fx) {
      if (b === bots[0]) {
        if (e.kind === 'hit') {
          hitsAll++;
          const z = c.c.zones.find((zz) => c.sim.S[R.S_S] >= zz.s0 && c.sim.S[R.S_S] <= zz.s1)?.name ?? '?';
          zoneHits[z] = (zoneHits[z] ?? 0) + 1;
        } else if (e.kind === 'sink') sinks++;
        else if (e.kind === 'respawn') respawns++;
      }
    }
    c.fx.length = 0;
    const e = b.hb.step(c.c, c.sim.S, c.tick);
    if (e) {
      c.setAimWorld(e.a);
      if (e.down && !c.holding) c.press(mono);
      else if (!e.down && c.holding) c.release();
    }
  }
}, 16);

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
  }, 260_000);
});
clearInterval(iv);

const c0 = bots[0].core!;
console.log(tag, 'chia bè:', cfg.teams.map((t: string[]) => t.length).join('+'), `(${cfg.teams.length} bè)`);
console.log(tag, 'về đích:', finLog.join(' | ') || '(không bè nào về đích)');
console.log(tag, `thời lượng ván ${((Date.now() - t0) / 1000).toFixed(1)}s; bot0: va chạm ${hitsAll}, chìm ${sinks}, hồi sinh ${respawns}, va theo vùng ${JSON.stringify(zoneHits)}; gói bị từ chối ${rejected}`);
console.log(tag, `gói xuống của bot0: ${totalMsgs} gói, ${(totalBytes / 1024).toFixed(0)}KB / ${((Date.now() - t0) / 1000).toFixed(0)}s = ${(totalMsgs / ((Date.now() - t0) / 1000)).toFixed(1)} gói/s, ${(totalBytes / ((Date.now() - t0) / 1000) / 1024).toFixed(2)}KB/s ->`, Object.entries(kinds).map(([k, v]) => `${k}:${v.n}`).join(' '));
if (scoreRows) {
  const byDetail = new Map<string, number>();
  for (const r of scoreRows) byDetail.set(r.detail, (byDetail.get(r.detail) ?? 0) + 1);
  console.log(tag, 'bảng điểm:', [...byDetail.entries()].map(([d, n]) => `${d} (x${n})`).join(' || '));
}
console.log(tag, `client bot0: tick ${c0.tick}, frames ${frames}`);
for (const b of bots) b.ws.close();
await wait(200);
process.exit(0);
