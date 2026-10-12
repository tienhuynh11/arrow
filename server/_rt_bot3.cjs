const WebSocket = require('ws');
const PORT = 8810; const N = +(process.env.N || 4); const IDLE = !!process.env.IDLE;
const bots = []; let code = ''; let cfg = null, gameId = 'rooftop', pos = {}, T = 0; const ev = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk(i) { return new Promise((res) => { const ws = new WebSocket(`ws://localhost:${PORT}/arrow/ws`); const b = { i, ws, id: '' }; bots.push(b);
  ws.on('open', () => ws.send(JSON.stringify(i === 0 ? { t: 'room:create', name: 'B0', maxPlayers: 16 } : { t: 'room:join', code, name: 'B' + i })));
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.t === 'room:joined') { b.id = m.playerId; if (i === 0) code = m.code; setTimeout(() => ws.send(JSON.stringify({ t: 'room:ready', ready: true })), 200); res(); }
    else if (m.t === 'game:start') { cfg = m.config; if (i === 0) console.log('INSTR', m.instructions.length); }
    else if (m.t === 'game:event' && i === 0) { const p = m.payload; if (p.type === 'pos') { pos = p.pos; T = p.t; } else ev.push({ ...p, T }); }
    else if (m.t === 'game:score' && i === 0) { console.log('SCORE', JSON.stringify(m.rows.map((r) => r.detail))); }
  }); }); }
const send = (b, o) => b.ws.readyState === 1 && b.ws.send(JSON.stringify({ t: 'game:input', gameId, input: { type: 'brawl', dx: 0, dy: 0, yaw: 0, ...o } }));
const P = (b) => pos[b.id];
const dist = (a, b) => Math.hypot(P(a)[0] - P(b)[0], P(a)[1] - P(b)[1]);
const yawTo = (a, b) => Math.atan2(P(b)[0] - P(a)[0], P(b)[1] - P(a)[1]);
const count = (type, k) => ev.filter((e) => e.type === type && (!k || e.k === k)).length;
(async () => {
  for (let i = 0; i < N; i++) await mk(i);
  await sleep(1500); bots[0].ws.send(JSON.stringify({ t: 'game:start' }));
  while (!bots.every((b) => pos[b.id])) await sleep(100);
  const { RT_CHARS } = { RT_CHARS: null };
  console.log('CHARS', bots.map((b) => cfg.chars[b.id]).join(','), 'L', cfg.L, 'hw', cfg.hw, 'pressureAt', cfg.pressureAt);
  await sleep(6500); // chờ hết hồi chiêu mở màn
  const start = Date.now();
  const hunter = bots[0]; let sk1 = 0;
  // skills: bắn skill1 hai lần liên tiếp để thấy hồi chiêu
  if (!IDLE) {
    let lastLog = 0;
    for (;;) {
      const alive = bots.filter((b) => !(P(b)[4] & 512));
      if (alive.length <= 1 || Date.now() - start > 140000) break;
      if (!(P(hunter)[4] & 512)) {
        let tg = null, bd = 1e9; for (const o of alive) { if (o === hunter) continue; const d = dist(hunter, o); if (d < bd) { bd = d; tg = o; } }
        const y = yawTo(hunter, tg);
        const t = Date.now() - start;
        if (bd > 1.3) send(hunter, { dx: Math.sin(y), dy: Math.cos(y), yaw: y });
        else {
          const r = Math.floor(t / 400) % 8;
          send(hunter, { yaw: y, punch: r % 2 === 0, skill1: r === 3 ? true : undefined, skill2: r === 5 ? true : undefined, grab: r === 7, lift: r === 7 });
        }
        if (t - lastLog > 8000) { lastLog = t; console.log('hp', bots.map((b) => P(b)[8]).join(' ')); }
      }
      // các bot khác thỉnh thoảng dùng skill
      for (const b of bots.slice(1)) if (!(P(b)[4] & 512)) { const tgt = hunter; const y = yawTo(b, tgt); send(b, { yaw: y, skill1: Math.random() < 0.03 || undefined, skill2: Math.random() < 0.02 || undefined, punch: dist(b, tgt) < 1.4 && Math.random() < 0.1 || undefined, dx: dist(b, tgt) > 1.4 ? Math.sin(y) : 0, dy: dist(b, tgt) > 1.4 ? Math.cos(y) : 0 }); }
      await sleep(50);
    }
  } else {
    for (;;) { for (const b of bots) send(b, {}); await sleep(100); if (bots.filter((b) => !(P(b)[4] & 512)).length <= 1 || Date.now() - start > 160000) break; }
  }
  await sleep(3500);
  const skills = ev.filter((e) => e.type === 'fx' && e.k === 'skill').reduce((m, e) => { m[e.ch + e.s] = (m[e.ch + e.s] || 0) + 1; return m; }, {});
  const hitsDmg = ev.filter((e) => e.type === 'fx' && e.k === 'hit' && e.dmg > 0).length;
  console.log('RESULT', JSON.stringify({ hits: hitsDmg, hitKinds: [...new Set(ev.filter((e) => e.k === 'hit').map((e) => e.tag))], skills, ko: ev.filter((e) => e.type === 'ko').map((e) => `${bots.findIndex((b) => b.id === e.playerId)}<${e.by ? bots.findIndex((b) => b.id === e.by) : '-'}:${e.how}@${e.T}`), wall: count('fx', 'wall'), fall: count('fall'), reflect: count('fx', 'reflect'), slip: count('fx', 'slip'), wrong: count('fx', 'wrong') }));
  process.exit(0);
})();
