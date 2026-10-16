// Chạy mô phỏng thời gian ảo một ván SINH TỒN BẦY KHỈ với bot (không cần mạng thật).
// cd server && npx tsx test/monkeySimRun.ts <số người=1> <rtt ms=80> <giây=600> [seed=3] [skill=0.6]
import { runSim } from './monkeySim.js';

const n = Number(process.argv[2] ?? 1);
const rtt = Number(process.argv[3] ?? 80);
const secs = Number(process.argv[4] ?? 600);
const seed = Number(process.argv[5] ?? 3);
const skill = Number(process.argv[6] ?? 0.6);
const t0 = Date.now();
const r = runSim({ players: n, rtt, jitter: rtt * 0.15, seconds: secs, seed, skill });
const ps = r.room.players.filter(Boolean) as any[];
console.log(
  JSON.stringify({
    players: n,
    rtt,
    wave: r.wave,
    simS: Math.round(r.simMs / 1000),
    realS: +((Date.now() - t0) / 1000).toFixed(1),
    avgTickMs: +r.avgTickMs.toFixed(3),
    maxTickMs: +r.maxTickMs.toFixed(2),
    kBps: +(r.bytesPerClientPerSec / 1024).toFixed(1),
    maxCorr: +r.maxCorrection.toFixed(3),
    corrections: r.corrections,
    predHits: r.predictedHits,
    srvHits: ps.reduce((a, p) => a + p.statHits, 0),
    pellets: ps.reduce((a, p) => a + p.statPellets, 0),
    peakMonkeys: r.peakMonkeys,
    over: !!r.clients[0].over,
    firstDownS: r.clients.map((c) => (c.firstDown < 0 ? -1 : Math.round((c.firstDown - 1_000_000) / 1000))),
    kills: ps.map((p) => p.kills),
    tiers: ps.map((p) => p.st.tier),
  }),
);
