// Bot WebSocket thật cho CƯỚP KHO BÁU: chạy 1 server dev (FORCE_GAMES=treasure PORT=8840) rồi
//   cd server && npx tsx test/treasureBots.ts <soNguoi> [port] [pidServer]
// Chứng minh: chia đấu trường, nhặt/nộp/cướp qua mạng thật, kết thúc ván, bảng điểm, gói tin/RAM/CPU.
import { WebSocket } from 'ws';
import { execSync } from 'node:child_process';
import { TreasureClient } from '../../shared/treasureClient.js';
import { ACT_R, MAXI, STEP_MS } from '../../shared/treasure.js';

const N = Number(process.argv[2] ?? 4);
const PORT = Number(process.argv[3] ?? 8840);
const PID = Number(process.argv[4] ?? 0);
const URL = `ws://localhost:${PORT}/arrow/ws`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function proc(pid: number) {
  if (!pid) return { rss: 0, cpu: 0 };
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64; (Get-Process -Id ${pid}).CPU"`, { encoding: 'utf8' }).trim().split(/\r?\n/);
    return { rss: Number(out[0]) / 1048576, cpu: Number(String(out[1]).replace(',', '.')) };
  } catch {
    return { rss: 0, cpu: 0 };
  }
}

interface Bot {
  ws: WebSocket;
  id: string;
  offset: number;
  bestRtt: number;
  cl: TreasureClient | null;
  startAt: number;
  arena: number;
  seat: number;
  thief: boolean;
  cap: number;
  nextAct: number;
  lastX: number;
  lastY: number;
  stuck: number;
  detour: number;
  detDx: number;
  detDy: number;
  bytesIn: number;
  msgsIn: number;
  msgsOut: number;
}

const stats = { picks: 0, deliveries: 0, steals: 0, shoves: 0, waves: 0, snaps: 0, ended: false, startMsg: null as any, errors: [] as string[], scoreRows: null as any };
const bots: Bot[] = [];

function connect(): Promise<Bot> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const bot: Bot = {
      ws, id: '', offset: 0, bestRtt: 1e9, cl: null, startAt: 0, arena: -1, seat: -1, thief: bots.length % 2 === 0, cap: 3 + Math.floor(Math.random() * 6),
      nextAct: 0, lastX: 0, lastY: 0, stuck: 0, detour: 0, detDx: 0, detDy: 0, bytesIn: 0, msgsIn: 0, msgsOut: 0,
    };
    ws.on('open', () => {
      for (let i = 0; i < 6; i++) setTimeout(() => ws.send(JSON.stringify({ t: 'time:ping', clientSent: Date.now() })), i * 100);
      resolve(bot);
    });
    ws.on('message', (data) => {
      const raw = String(data);
      bot.bytesIn += raw.length;
      bot.msgsIn++;
      const m = JSON.parse(raw);
      if (m.t === 'time:pong') {
        const rtt = Date.now() - m.clientSent;
        if (rtt <= bot.bestRtt) {
          bot.bestRtt = rtt;
          bot.offset = m.serverTime + rtt / 2 - Date.now();
        }
      } else if (m.t === 'room:joined') bot.id = m.playerId;
      else if (m.t === 'error') stats.errors.push(m.message);
      else if (m.t === 'game:start') {
        stats.startMsg = m;
        const cfg = m.config;
        bot.startAt = m.startAt;
        bot.arena = cfg.arenas.findIndex((a: any) => a.ids.includes(bot.id));
        const ac = cfg.arenas[bot.arena];
        bot.seat = ac.ids.indexOf(bot.id);
        bot.cl = new TreasureClient(m.startAt, bot.arena, ac.ids, bot.seat, ac.w, ac.h);
      } else if (m.t === 'game:event') {
        const p = m.payload;
        if (bot.cl && p.a === bot.arena) {
          bot.cl.onMessage(p, Date.now() + bot.offset);
          if (bot.seat === 0) {
            if (p.type === 's') stats.snaps++;
            else if (p.type === 'p') stats.picks += p.ids.length;
            else if (p.type === 'd') stats.deliveries++;
            else if (p.type === 'h') stats.steals++;
            else if (p.type === 'b' && p.v >= 0) stats.shoves++;
            else if (p.type === 'c') stats.waves++;
          }
        }
      } else if (m.t === 'game:score') stats.scoreRows = m.rows;
      else if (m.t === 'game:end') stats.ended = true;
    });
    ws.on('error', () => {});
  });
}

const send = (bot: Bot, msg: any) => {
  bot.msgsOut++;
  if (bot.ws.readyState === WebSocket.OPEN) bot.ws.send(JSON.stringify(msg));
};

function think(bot: Bot, now: number) {
  const cl = bot.cl!;
  const w = cl.world;
  const me = bot.seat;
  const T = Math.floor((now - bot.startAt) / STEP_MS);
  if (!cl.synced || T < cl.fs || cl.over || T >= cl.endT) return { dx: 0, dy: 0, act: false };
  const mx = cl.rx[me];
  const my = cl.ry[me];
  let tgx = cl.W / 2;
  let tgy = cl.H / 2;
  let act = false;
  const load = w.load[me];
  let chase = -1;
  if (bot.thief) {
    let bd = 1e18;
    for (let j = 0; j < cl.n; j++) {
      if (j === me || cl.sload[j] <= 0 || cl.immune[j]) continue;
      const d = (cl.rx[j] - mx) ** 2 + (cl.ry[j] - my) ** 2;
      if (d < bd) { bd = d; chase = j; }
    }
    if (chase >= 0 && bd < 330 * 330 && load < 6) {
      tgx = cl.rx[chase];
      tgy = cl.ry[chase];
      if (bd < (ACT_R - 6) ** 2 && now >= bot.nextAct) {
        act = true;
        bot.nextAct = now + 700;
      }
    } else chase = -1;
  }
  if (chase < 0) {
    const late = T > cl.endT - 700;
    let best = -1;
    let bd = 1e18;
    for (let s = 0; s < MAXI; s++) {
      if (!cl.iAct[s] || cl.ihide[s]) continue;
      const d = (cl.ix[s] - mx) ** 2 + (cl.iy[s] - my) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (load >= bot.cap || (load > 0 && (best < 0 || late))) {
      tgx = w.bx[me];
      tgy = w.by[me];
    } else if (best >= 0 && !(late && load === 0 && bd > 200 * 200)) {
      tgx = cl.ix[best];
      tgy = cl.iy[best];
    }
  }
  let dx = tgx - mx > 5 ? 1 : tgx - mx < -5 ? -1 : 0;
  let dy = tgy - my > 5 ? 1 : tgy - my < -5 ? -1 : 0;
  if ((dx || dy) && Math.hypot(mx - bot.lastX, my - bot.lastY) < 0.4) bot.stuck++;
  else bot.stuck = Math.max(0, bot.stuck - 1);
  bot.lastX = mx;
  bot.lastY = my;
  if (bot.stuck > 12 && bot.detour <= 0) {
    bot.detour = 40;
    bot.detDx = Math.random() < 0.5 ? -dy : dy;
    bot.detDy = Math.random() < 0.5 ? dx : -dx;
    bot.stuck = 0;
  }
  if (bot.detour > 0) {
    bot.detour--;
    dx = bot.detDx;
    dy = bot.detDy;
  }
  return { dx, dy, act };
}

async function main() {
  for (let i = 0; i < N; i++) bots.push(await connect());
  await wait(700);
  const host = bots[0];
  host.ws.send(JSON.stringify({ t: 'room:create', name: 'BOT1', maxPlayers: 16, gameIds: ['treasure'] }));
  let code = '';
  host.ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'room:joined') code = m.code;
  });
  while (!code) await wait(50);
  for (let i = 1; i < N; i++) {
    bots[i].ws.send(JSON.stringify({ t: 'room:join', code, name: `BOT${i + 1}` }));
    await wait(80);
  }
  for (const b of bots) b.ws.send(JSON.stringify({ t: 'room:ready', ready: true }));
  await wait(600);
  const before = proc(PID);
  const t0 = Date.now();
  host.ws.send(JSON.stringify({ t: 'game:start' }));
  console.log(`[bot] ${N} bot đã vào phòng ${code}, bắt đầu ván`);

  const timer = setInterval(() => {
    for (const b of bots) {
      if (!b.cl) continue;
      const now = Date.now() + b.offset;
      const k = think(b, now);
      const msg = b.cl.setKeys(k.dx, k.dy, k.act, now);
      if (msg) send(b, { t: 'game:input', gameId: 'treasure', input: msg });
      const rep = b.cl.poll(now);
      if (rep) send(b, { t: 'game:input', gameId: 'treasure', input: rep });
      b.cl.frame(now);
      b.cl.fx.length = 0;
    }
  }, 1000 / 60);

  let peak = before;
  const watch = setInterval(() => {
    const r = proc(PID);
    if (r.rss > peak.rss) peak = r;
  }, 5000);

  const deadline = Date.now() + 15000 + 125000 + 20000;
  while (!stats.ended && Date.now() < deadline) await wait(500);
  clearInterval(timer);
  clearInterval(watch);
  const after = proc(PID);
  const secs = (Date.now() - t0) / 1000;
  await wait(500);

  const cfg = stats.startMsg?.config;
  console.log('\n===== KẾT QUẢ BOT =====');
  console.log('đấu trường:', cfg.arenas.map((a: any, i: number) => `#${i + 1}: ${a.ids.length} người, sân ${a.w}x${a.h}`).join(' | '));
  console.log(`sự kiện (đếm ở ghế 0 mỗi đấu trường): nhặt ${stats.picks} · nộp ${stats.deliveries} lần · cướp ${stats.steals} · đẩy ${stats.shoves} · đợt kho báu ${stats.waves}`);
  console.log(`game:end nhận được: ${stats.ended}; lỗi: ${stats.errors.join('|') || 'không'}`);
  if (stats.scoreRows) console.log('bảng điểm:', stats.scoreRows.slice(0, 16).map((r: any) => `${r.rank}.${r.detail}(${r.points}đ)`).join(' · '));
  const inB = bots.reduce((s, b) => s + b.bytesIn, 0) / bots.length / secs;
  const inM = bots.reduce((s, b) => s + b.msgsIn, 0) / bots.length / secs;
  const outM = bots.reduce((s, b) => s + b.msgsOut, 0) / bots.length / secs;
  console.log(`mạng mỗi người: nhận ${(inB / 1024).toFixed(2)} KB/s (${inM.toFixed(1)} gói/s) · gửi ${outM.toFixed(1)} gói/s (giới hạn server 80/s) trong ${secs.toFixed(0)}s`);
  if (PID) {
    console.log(`server RSS: trước ván ${before.rss.toFixed(1)}MB → đỉnh ${peak.rss.toFixed(1)}MB → sau ván ${after.rss.toFixed(1)}MB; CPU server dùng ${(after.cpu - before.cpu).toFixed(2)}s / ${secs.toFixed(0)}s = ${(((after.cpu - before.cpu) / secs) * 100).toFixed(2)}% 1 lõi`);
  }
  for (const b of bots) b.ws.close();
  process.exit(0);
}
main();
