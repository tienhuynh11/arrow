// Đo độ khớp "client thấy trúng" ↔ "server xác nhận trúng" theo từng viên đạn ở nhiều mức RTT.
// cd server && npx tsx test/monkeyLag.ts [giây=180]
import { runSim } from './monkeySim.js';

const secs = Number(process.argv[2] ?? 180);
for (const rtt of [0, 80, 150, 250]) {
  const pred = new Map<string, number>();
  const srv = new Map<string, number>();
  const vts = new Map<string, number>();
  const deadAt = new Map<string, Uint8Array>();
  let roomRef: any = null;
  let holds = 0;
  const r = runSim({
    players: 2, rtt, jitter: rtt * 0.15, seconds: secs, seed: 11, skill: 0.6,
    onRoom: (room) => { roomRef = room; room.onPellet = (i, seq, k, slot, vt) => { const key = `${i}:${seq}:${k}`; srv.set(key, slot); vts.set(key, vt); if (slot < 0) deadAt.set(key, roomRef.world.alive.slice()); }; },
    onModel: (cl) => { cl.model!.onPredPellet = (seq, k, slot) => pred.set(`${cl.idx}:${seq}:${k}`, slot); },
  });
  for (const c of r.clients) holds += c.model?.holdFrames ?? 0;
  let both = 0, predOnly = 0, srvOnly = 0, diff = 0, n = 0, predDead = 0;
  for (const [key, ps] of pred) {
    const ss = srv.get(key);
    if (ss === undefined) continue;
    n++;
    if (ps >= 0 && ss >= 0) { if (ps === ss) both++; else diff++; }
    else if (ps >= 0) { predOnly++; if (deadAt.get(key) && !deadAt.get(key)![ps]) predDead++; }
    else if (ss >= 0) srvOnly++;
  }
  const ph = both + predOnly + diff;
  console.log(`RTT ${String(rtt).padStart(3)}ms: viên=${n} client-trúng=${ph} server-xác-nhận-cùng-con=${both} (${((both / Math.max(1, ph)) * 100).toFixed(1)}%) khác-con=${diff} client-trúng-server-trượt=${predOnly} (trong đó khỉ đã chết ở server=${predDead}) server-trúng-client-trượt=${srvOnly} khung-giữ-vị-trí=${holds} sửa-vị-trí=${r.corrections} lệch-max=${r.maxCorrection.toFixed(3)}m`);
}
