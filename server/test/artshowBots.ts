// Bot WebSocket thật cho ĐẠI HỘI HỌA SĨ. Chạy: cd server && npx tsx test/artshowBots.ts <số người> <port>
// Tự bật server (FORCE_GAMES=artshow), cho N bot vẽ + bình chọn ngẫu nhiên, đo RSS/CPU server và băng thông, rồi tắt.
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';
import { simplifyStroke, mergeStrokes, type ArtStroke, MAX_DRAWING_BYTES } from '../../shared/artshow.js';

const N = Number(process.argv[2] ?? 3);
const PORT = Number(process.argv[3] ?? 8850);
const WS_URL = `ws://localhost:${PORT}/ws`;

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), FORCE_GAMES: 'artshow' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const psSample = () => {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `$p=Get-Process -Id ${server.pid}; "$($p.WorkingSet64) $($p.TotalProcessorTime.TotalSeconds)"`],
      { encoding: 'utf8' },
    );
    const [ws, cpu] = out.trim().split(/\s+/).map(Number);
    return { rssMB: ws / 1048576, cpu };
  } catch {
    return { rssMB: 0, cpu: 0 };
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Bot {
  i: number;
  ws: WebSocket;
  id: string;
  code: string;
  tx: number;
  rx: number;
  txMsgs: number;
  rxMsgs: number;
  gameId: string;
  startAt: number;
  mine: number;
  n: number;
  selfRejected: number;
  voted: boolean;
  res: any;
  my: any;
  scoreRows: any;
  ended: boolean;
  endAt: number;
  phase: string;
  picsGot: number;
}

const bots: Bot[] = [];
const mk = (i: number): Promise<Bot> =>
  new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const b: Bot = { i, ws, id: '', code: '', tx: 0, rx: 0, txMsgs: 0, rxMsgs: 0, gameId: '', startAt: 0, mine: -2, n: 0, selfRejected: 0, voted: false, res: null, my: null, scoreRows: null, ended: false, endAt: 0, phase: '', picsGot: 0 };
    ws.on('open', () => resolve(b));
    ws.on('message', (d) => {
      b.rx += (d as Buffer).length;
      b.rxMsgs++;
      const m = JSON.parse(String(d));
      if (m.t === 'room:joined') {
        b.id = m.playerId;
        b.code = m.code;
      } else if (m.t === 'game:start') {
        b.gameId = m.gameId;
        b.startAt = m.startAt;
        b.endAt = m.endAt;
      } else if (m.t === 'game:event') {
        const p = m.payload;
        if (p.type === 'mine') b.mine = p.k;
        else if (p.type === 'ph') {
          b.phase = p.ph;
          if (p.n) b.n = p.n;
        } else if (p.type === 'pic') b.picsGot++;
        else if (p.type === 'my') b.my = p;
        else if (p.type === 'res') b.res = p;
      } else if (m.t === 'game:score') b.scoreRows = m.rows;
      else if (m.t === 'game:end') b.ended = true;
      else if (m.t === 'error') console.log(`bot${i} error: ${m.message}`);
    });
    ws.on('error', () => {});
  });

const send = (b: Bot, o: any) => {
  const s = JSON.stringify(o);
  b.tx += s.length;
  b.txMsgs++;
  b.ws.send(s);
};
const input = (b: Bot, input: any) => send(b, { t: 'game:input', gameId: 'artshow', input });

/** sinh một nét tay vẽ ngoằn ngoèo ~ 60-140 điểm thô rồi làm gọn như client */
function genStroke(): ArtStroke {
  let x = rnd(50, 950);
  let y = rnd(50, 700);
  let a = rnd(0, 6.28);
  const n = Math.floor(rnd(60, 140));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    a += rnd(-0.35, 0.35);
    x = Math.max(0, Math.min(1000, x + Math.cos(a) * rnd(3, 9)));
    y = Math.max(0, Math.min(750, y + Math.sin(a) * rnd(3, 9)));
    pts.push(x, y);
  }
  return [Math.floor(rnd(0, 10)), Math.floor(rnd(0, 3)), simplifyStroke(pts)];
}

async function playBot(b: Bot, drawMs: number, tDraw0: number) {
  let strokes: ArtStroke[] = [];
  let sync = 0;
  let lastFull = Date.now();
  let lastSend = 0;
  const end = tDraw0 + drawMs;
  while (Date.now() < end) {
    await sleep(rnd(500, 1400)); // ~ một nét mỗi 1 giây
    const s = genStroke();
    const next = mergeStrokes(strokes, strokes.length, [s]);
    if (next) strokes = next;
    if (Date.now() - lastFull > 7000) {
      input(b, { type: 'adraw', n: 0, s: strokes });
      lastFull = Date.now();
      sync = strokes.length;
    } else if (Date.now() - lastSend > 1200) {
      input(b, { type: 'adraw', n: sync, s: strokes.slice(sync) });
      sync = strokes.length;
    }
    lastSend = Date.now();
    // thỉnh thoảng undo
    if (Math.random() < 0.08 && strokes.length) {
      strokes = strokes.slice(0, -1);
      sync = Math.min(sync, strokes.length);
    }
  }
  await sleep(Math.max(0, end - Date.now()));
  input(b, { type: 'adraw', n: 0, s: strokes, f: 1 });
  return strokes;
}

async function main() {
  await sleep(2500);
  for (let i = 0; i < N; i++) bots.push(await mk(i));
  const host = bots[0];
  send(host, { t: 'room:create', name: 'Bot0', maxPlayers: 16, gameIds: ['artshow'] });
  await sleep(500);
  for (let i = 1; i < N; i++) {
    send(bots[i], { t: 'room:join', code: host.code, name: `Bot${i}` });
    await sleep(80);
  }
  await sleep(500);
  for (let i = 1; i < N; i++) send(bots[i], { t: 'room:ready', ready: true });
  await sleep(500);
  send(host, { t: 'game:start' });

  const samples: { t: number; rssMB: number; cpu: number }[] = [];
  const t0 = Date.now();
  const sampler = setInterval(() => samples.push({ t: Date.now() - t0, ...psSample() }), 5000);
  samples.push({ t: 0, ...psSample() });

  // chờ game:start
  while (!host.gameId) await sleep(100);
  const startLocal = host.startAt; // giờ server ~ giờ máy (cùng máy)
  await sleep(Math.max(0, startLocal - Date.now()) + 200);
  const tDraw0 = Date.now();
  await Promise.all(bots.map((b) => playBot(b, 55000 - 200, tDraw0)));

  // pha vote: chờ nhận tranh rồi mỗi bot bầu ngẫu nhiên ở thời điểm ngẫu nhiên
  while (bots.some((b) => b.phase !== 'vote' && b.phase !== 'result')) await sleep(100);
  const voteStart = Date.now();
  await Promise.all(
    bots.map(async (b) => {
      await sleep(rnd(500, 12000));
      if (b.phase !== 'vote' || b.n < 2) return;
      if (b.i % 5 === 4) {
        // thử tự bầu: phải bị từ chối
        const before = JSON.stringify(b.my);
        input(b, { type: 'avote', k: b.mine, c: 'm' });
        await sleep(300);
        if (JSON.stringify(b.my) === before) b.selfRejected++;
      }
      let k: number;
      do k = Math.floor(rnd(0, b.n));
      while (k === b.mine);
      input(b, { type: 'avote', k, c: 'm' });
      let k2: number;
      do k2 = Math.floor(rnd(0, b.n));
      while (k2 === b.mine);
      if (Math.random() < 0.7) input(b, { type: 'avote', k: k2, c: Math.random() < 0.5 ? 'h' : 't' });
      b.voted = true;
    }),
  );

  // chờ hết trận
  const deadline = Date.now() + 60000;
  while (!bots.every((b) => b.ended) && Date.now() < deadline) await sleep(200);
  clearInterval(sampler);
  samples.push({ t: Date.now() - t0, ...psSample() });

  const r = host.res;
  const ok = bots.every((b) => b.res && b.scoreRows);
  console.log(`\n=== ${N} bot, cổng ${PORT} ===`);
  console.log(`tất cả nhận kết quả + bảng điểm: ${ok}; game:end: ${bots.every((b) => b.ended)}`);
  console.log(`số tranh trong bình chọn: ${host.n}; mỗi bot nhận đủ tranh: ${bots.every((b) => b.picsGot >= host.n)}`);
  console.log(`thời gian pha vote thực: ${((Date.now() - voteStart) / 1000).toFixed(1)}s (tính từ lúc bắt đầu vote tới hết trận)`);
  console.log(`tự bầu bị từ chối: ${bots.reduce((a, b) => a + b.selfRejected, 0)} bot thử`);
  if (r) console.log(`thắng: k=${JSON.stringify(r.win)} · hài: ${JSON.stringify(r.fun)} · thảm: ${JSON.stringify(r.fail)} · hàng đầu: ${JSON.stringify(r.rows.slice(0, 3))}`);
  const tx = bots.map((b) => b.tx);
  const rx = bots.map((b) => b.rx);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  console.log(`băng thông mỗi bot (cả ván): gửi TB ${(sum(tx) / N / 1024).toFixed(1)} KB (max ${(Math.max(...tx) / 1024).toFixed(1)}), nhận TB ${(sum(rx) / N / 1024).toFixed(1)} KB (max ${(Math.max(...rx) / 1024).toFixed(1)})`);
  console.log(`tin gửi/bot TB ${(sum(bots.map((b) => b.txMsgs)) / N).toFixed(0)}, tin nhận/bot TB ${(sum(bots.map((b) => b.rxMsgs)) / N).toFixed(0)}; tổng gửi lên server ${(sum(tx) / 1024).toFixed(0)} KB, server phát ra ${(sum(rx) / 1024).toFixed(0)} KB`);
  const rss = samples.map((s) => s.rssMB);
  const cpuSec = samples[samples.length - 1].cpu - samples[0].cpu;
  console.log(`server RSS: đầu ${rss[0].toFixed(0)} MB, đỉnh ${Math.max(...rss).toFixed(0)} MB, cuối ${rss[rss.length - 1].toFixed(0)} MB; CPU ${cpuSec.toFixed(2)}s trong ${((Date.now() - t0) / 1000).toFixed(0)}s (${((cpuSec / ((Date.now() - t0) / 1000)) * 100).toFixed(1)}% 1 lõi)`);
  console.log(`MAX_DRAWING_BYTES = ${MAX_DRAWING_BYTES}`);
  bots.forEach((b) => b.ws.close());
  server.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
