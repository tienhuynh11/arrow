// Bot WebSocket thật cho XE TĂNG: chạy 1 server dev (FORCE_GAMES=tanks PORT=8816) rồi
//   cd server && npx tsx test/tankBots.ts <soNguoi> [port] [pidServer] [chiaSe=0]
// Chứng minh: chia đấu trường, di chuyển/va tường, đạn nảy và hạ xe, vật phẩm, chuyển vòng, kết thúc ván, gói tin/RAM/CPU.
import { WebSocket } from 'ws';
import { execSync } from 'node:child_process';
import { TankClient } from '../../shared/tankClient.js';
import { ANG_N, STEP_MS, angDiff, traceRay } from '../../shared/tank.js';

const N = Number(process.argv[2] ?? 4);
const PORT = Number(process.argv[3] ?? 8816);
const PID = Number(process.argv[4] ?? 0);
const URL = `ws://localhost:${PORT}/arrow/ws`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rssMB(pid: number) {
  if (!pid) return 0;
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64; (Get-Process -Id ${pid}).CPU"`, { encoding: 'utf8' }).trim().split(/\r?\n/);
    return { rss: Number(out[0]) / 1048576, cpu: Number(String(out[1]).replace(',', '.')) };
  } catch {
    return { rss: 0, cpu: 0 };
  }
}

interface Bot {
  ws: WebSocket;
  name: string;
  id: string;
  offset: number;
  bestRtt: number;
  cl: TankClient | null;
  startAt: number;
  arena: number;
  seat: number;
  nextThink: number;
  wMove: number;
  nextFire: number;
  rx: number;
  bytesIn: number;
  msgsIn: number;
  msgsOut: number;
  hunter: boolean;
  px: Float64Array;
  py: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
}

const stats = {
  fires: 0, kills: 0, shieldPops: 0, lasers: 0, picks: 0, items: 0, rounds: new Set<string>(), overs: [] as any[], bounces: 0,
  starts: 0, snaps: 0, scoreRows: null as any, ended: false, startMsg: null as any, errors: [] as string[],
};

const bots: Bot[] = [];
const ray = new Float64Array(8);

function connect(name: string): Promise<Bot> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const bot: Bot = {
      ws, name, id: '', offset: 0, bestRtt: 1e9, cl: null, startAt: 0, arena: -1, seat: -1, nextThink: 0, wMove: 1, nextFire: 0, rx: 0,
      bytesIn: 0, msgsIn: 0, msgsOut: 0, hunter: bots.length % 2 === 0,
      px: new Float64Array(8), py: new Float64Array(8), vx: new Float64Array(8), vy: new Float64Array(8),
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
        stats.starts++;
        stats.startMsg = m;
        const cfg = m.config;
        bot.startAt = m.startAt;
        bot.arena = cfg.arenas.findIndex((a: any) => a.ids.includes(bot.id));
        const ac = cfg.arenas[bot.arena];
        bot.seat = ac.ids.indexOf(bot.id);
        bot.cl = new TankClient(m.startAt, bot.arena, ac.ids, bot.seat, ac.w, ac.h);
      } else if (m.t === 'game:event') {
        const p = m.payload;
        if (bot.cl && p.a === bot.arena) {
          const isFirst = bot === bots[0];
          bot.cl.onMessage(p, Date.now() + bot.offset);
          if (bot.seat === 0) {
            // thống kê trên 1 bot/đấu trường
            if (p.type === 's') stats.snaps++;
            else if (p.type === 'f') stats.fires++;
            else if (p.type === 'x') stats.kills++;
            else if (p.type === 'z') stats.shieldPops++;
            else if (p.type === 'l') stats.lasers++;
            else if (p.type === 'p') stats.picks++;
            else if (p.type === 'i') stats.items++;
            else if (p.type === 'R') stats.rounds.add(`${p.a}:${p.r}`);
            else if (p.type === 'o') stats.overs.push({ a: p.a, r: p.r, w: p.w, sc: p.sc });
          }
          void isFirst;
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
  const T = Math.floor((now - bot.startAt) / STEP_MS);
  if (cl.round < 0 || T < cl.fs || !cl.alive[bot.seat] || cl.over) return { turn: 0, move: 0, fire: false };
  let turn = 0;
  let move = bot.wMove;
  let fire = false;
  let best = -1;
  let bd = 1e18;
  for (let j = 0; j < cl.n; j++) {
    bot.vx[j] = bot.vx[j] * 0.9 + 0.1 * (cl.rx[j] - bot.px[j]);
    bot.vy[j] = bot.vy[j] * 0.9 + 0.1 * (cl.ry[j] - bot.py[j]);
    bot.px[j] = cl.rx[j];
    bot.py[j] = cl.ry[j];
    if (j === bot.seat || !cl.alive[j]) continue;
    const dx = cl.rx[j] - cl.rx[bot.seat];
    const dy = cl.ry[j] - cl.ry[bot.seat];
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = j; }
  }
  if (now >= bot.nextThink) {
    bot.nextThink = now + 300 + Math.random() * 800;
    bot.wMove = Math.random() < 0.65 ? 1 : Math.random() < 0.5 ? 0 : -1;
    if (!bot.hunter) turn = Math.floor(Math.random() * 3) - 1;
  }
  if (bot.hunter && best >= 0) {
    const dist = Math.sqrt(bd);
    const lead = Math.min(40, dist / 3.33);
    const aim = Math.round((Math.atan2(cl.ry[best] + bot.vy[best] * lead - w.y[bot.seat], cl.rx[best] + bot.vx[best] * lead - w.x[bot.seat]) * ANG_N) / (Math.PI * 2)) & (ANG_N - 1);
    const diff = angDiff(w.ang[bot.seat], aim);
    turn = diff > 10 ? 1 : diff < -10 ? -1 : 0;
    move = Math.abs(diff) < 80 && dist > 70 ? bot.wMove || 1 : dist < 45 ? -1 : bot.wMove;
    const np = traceRay(w.maze, w.x[bot.seat], w.y[bot.seat], w.ang[bot.seat], dist, 0, ray);
    const clear = np === 2 && Math.hypot(ray[2] - w.x[bot.seat], ray[3] - w.y[bot.seat]) > dist - 2;
    if (clear && Math.abs(diff) <= 14 && now >= bot.nextFire) {
      fire = true;
      bot.nextFire = now + 300 + Math.random() * 400;
    }
  } else if (!bot.hunter) {
    if (turn === 0) turn = bot.nextThink - now < 100 ? 1 : 0;
    if (now >= bot.nextFire && Math.random() < 0.15) {
      fire = true;
      bot.nextFire = now + 700 + Math.random() * 1500;
    }
  }
  return { turn, move, fire };
}

async function main() {
  for (let i = 0; i < N; i++) bots.push(await connect(`BOT${i + 1}`));
  await wait(700);
  const host = bots[0];
  host.ws.send(JSON.stringify({ t: 'room:create', name: 'BOT1', maxPlayers: 16, gameIds: ['tanks'] }));
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
  const before = rssMB(PID);
  const t0 = Date.now();
  host.ws.send(JSON.stringify({ t: 'game:start' }));
  console.log(`[bot] ${N} bot đã vào phòng ${code}, bắt đầu ván`);

  // vòng 60Hz: mỗi bot lái bằng đúng TankClient
  const timer = setInterval(() => {
    for (const b of bots) {
      if (!b.cl) continue;
      const now = Date.now() + b.offset;
      const k = think(b, now);
      const msg = b.cl.setKeys(k.turn, k.move, k.fire, now);
      if (msg) send(b, { t: 'game:input', gameId: 'tanks', input: msg });
      const rep = b.cl.poll(now);
      if (rep) send(b, { t: 'game:input', gameId: 'tanks', input: rep });
      b.cl.frame(now);
      b.cl.fx.length = 0;
    }
  }, 1000 / 60);

  let peak = before;
  let samples = 0;
  const watch = setInterval(() => {
    const r = rssMB(PID);
    if (typeof r === 'object' && typeof peak === 'object' && r.rss > peak.rss) peak = r;
    samples++;
  }, 5000);

  const deadline = Date.now() + 15000 + 235000 + 20000;
  while (!stats.ended && Date.now() < deadline) await wait(500);
  clearInterval(timer);
  clearInterval(watch);
  const after = rssMB(PID);
  const secs = (Date.now() - t0) / 1000;
  await wait(500);

  const cfg = stats.startMsg?.config;
  console.log('\n===== KẾT QUẢ BOT =====');
  console.log('đấu trường:', cfg.arenas.map((a: any, i: number) => `#${i + 1}: ${a.ids.length} xe, mê cung ${a.w}x${a.h}`).join(' | '));
  console.log(`vòng đã chơi (đấu trường:vòng): ${[...stats.rounds].sort().join(', ')}`);
  console.log(`kết quả vòng:`, stats.overs.map((o) => `ĐT${o.a + 1} v${o.r + 1} thắng ghế ${o.w}`).join('; '));
  console.log(`sự kiện (đếm ở ghế 0 mỗi đấu trường): bắn ${stats.fires} · hạ ${stats.kills} · khiên hấp thụ ${stats.shieldPops} · laze ${stats.lasers} · nhặt vật phẩm ${stats.picks}/${stats.items} xuất hiện`);
  console.log(`game:end nhận được: ${stats.ended}; lỗi: ${stats.errors.join('|') || 'không'}`);
  if (stats.scoreRows) console.log('bảng điểm:', stats.scoreRows.slice(0, 16).map((r: any) => `${r.rank}.${r.detail}(${r.points}đ)`).join(' · '));
  const inB = bots.reduce((s, b) => s + b.bytesIn, 0) / bots.length / secs;
  const inM = bots.reduce((s, b) => s + b.msgsIn, 0) / bots.length / secs;
  const outM = bots.reduce((s, b) => s + b.msgsOut, 0) / bots.length / secs;
  console.log(`mạng mỗi người: nhận ${(inB / 1024).toFixed(2)} KB/s (${inM.toFixed(1)} gói/s) · gửi ${outM.toFixed(1)} gói/s (giới hạn server 80/s) trong ${secs.toFixed(0)}s`);
  if (PID && typeof before === 'object' && typeof after === 'object' && typeof peak === 'object') {
    console.log(`server RSS: trước ván ${before.rss.toFixed(1)}MB → đỉnh ${peak.rss.toFixed(1)}MB → sau ván ${after.rss.toFixed(1)}MB; CPU server dùng ${(after.cpu - before.cpu).toFixed(2)}s / ${secs.toFixed(0)}s = ${(((after.cpu - before.cpu) / secs) * 100).toFixed(2)}% 1 lõi`);
  }
  for (const b of bots) b.ws.close();
  process.exit(0);
}
main();
