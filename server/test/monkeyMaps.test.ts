// Kiểm tra dữ liệu bản đồ SINH TỒN BẦY KHỈ: cổng khỉ / chỗ đứng người chơi không nằm trong vật cản,
// mọi cổng tới được người chơi qua flow field của server, khỉ thật sự đi tới nơi, và nhiều phòng
// khác bản đồ chạy xen kẽ trong một tiến trình không lẫn va chạm của nhau.
// Chạy: cd server && npx tsx test/monkeyMaps.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.MONKEY_DATA_DIR = mkdtempSync(join(tmpdir(), 'monkey-maps-'));
delete process.env.MONKEY_MAP;

import { MAX_PLAYERS } from '../../shared/monkey/config.js';
import { MK_NAU } from '../../shared/monkey/content.js';
import { MAP, MAPS, MAX_ARENA, PLAYER_R, collide, setActiveMap, type MapDef } from '../../shared/monkey/map.js';
import { newState, type Cmd } from '../../shared/monkey/sim.js';
import { MonkeyRoom, type MConn } from '../src/monkey/room.js';
import { MonkeyWorld, type WorldHost } from '../src/monkey/world.js';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${msg}`);
  if (!cond) fails++;
};
const noopHost = new Proxy({}, { get: () => () => {} }) as WorldHost;
const tmp = new Float64Array(2);

/** điểm (x,z) với bán kính r có bị vật cản / mép sân đẩy đi không */
function free(m: MapDef, x: number, z: number, r: number) {
  setActiveMap(m);
  collide(x, z, r, tmp);
  return Math.abs(tmp[0] - x) < 1e-9 && Math.abs(tmp[1] - z) < 1e-9;
}

console.log('\n[1] Dữ liệu bản đồ');
ok(new Set(MAPS.map((m) => m.id)).size === MAPS.length && MAPS.length >= 3, `${MAPS.length} bản đồ, id không trùng`);
for (const m of MAPS) {
  ok(m.arena >= 44 && m.arena <= MAX_ARENA, `${m.id}: nửa cạnh sân ${m.arena} m (≤ MAX_ARENA ${MAX_ARENA})`);
  ok(m.spawns.length >= 8 && m.playerSpawns.length >= MAX_PLAYERS, `${m.id}: ${m.spawns.length} cổng khỉ, ${m.playerSpawns.length} chỗ đứng (cần ≥ ${MAX_PLAYERS})`);
  const badS = m.spawns.filter((s) => !free(m, s.x, s.z, 0.6));
  ok(badS.length === 0, `${m.id}: cổng khỉ không nằm trong vật cản ${badS.length ? JSON.stringify(badS) : ''}`);
  const badP = m.playerSpawns.filter((s) => !free(m, s.x, s.z, PLAYER_R + 0.05));
  ok(badP.length === 0, `${m.id}: chỗ đứng người chơi trống ${badP.length ? JSON.stringify(badP) : ''}`);
  let minGap = 1e9;
  const ps = m.playerSpawns.slice(0, MAX_PLAYERS);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) minGap = Math.min(minGap, Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z));
  ok(minGap > PLAYER_R * 4, `${m.id}: ${MAX_PLAYERS} chỗ đứng không chồng lên nhau (gần nhất ${minGap.toFixed(2)} m)`);
  const edge = m.spawns.every((s) => Math.max(Math.abs(s.x), Math.abs(s.z)) > m.arena - 4);
  ok(edge, `${m.id}: cổng khỉ nằm sát mép sân`);
  const outside = [...m.circles, ...m.boxes].filter((o) => Math.abs(o.x) > m.arena || Math.abs(o.z) > m.arena);
  ok(outside.length === 0, `${m.id}: vật cản đều trong sân`);
}

console.log('\n[2] Flow field: mọi cổng đều tới được người chơi');
const FN = MAX_ARENA * 2;
const cell = (x: number, z: number) => Math.floor(z + MAX_ARENA) * FN + Math.floor(x + MAX_ARENA);
for (const m of MAPS) {
  setActiveMap(m);
  const w = new MonkeyWorld(noopHost, 1);
  w.players = m.playerSpawns.map((p, idx) => ({ idx, st: newState(0, p.x, p.z), tauntUntil: 0 }) as any);
  w.update(); // tick 1 dựng flow field
  const bad = m.spawns.filter((s) => w.ffDist[cell(s.x, s.z)] >= 65535);
  let maxD = 0;
  for (const s of m.spawns) maxD = Math.max(maxD, w.ffDist[cell(s.x, s.z)]);
  ok(bad.length === 0, `${m.id}: ${m.spawns.length - bad.length}/${m.spawns.length} cổng có đường (xa nhất ${maxD} ô) ${bad.length ? JSON.stringify(bad) : ''}`);
  w.reset?.();
}

console.log('\n[3] Khỉ từ mỗi cổng thật sự đi tới người chơi (≤ 40 giây)');
for (const m of MAPS) {
  setActiveMap(m);
  const stuck: string[] = [];
  let worst = 0;
  for (const s of m.spawns) {
    const w = new MonkeyWorld(noopHost, 7);
    const p0 = m.playerSpawns[0];
    w.players = [{ idx: 0, st: newState(0, p0.x, p0.z), tauntUntil: 0 } as any];
    const slot = w.spawn(MK_NAU, s.x, s.z, 1, 0, 1);
    let reached = -1;
    for (let t = 0; t < 800 && slot >= 0; t++) {
      w.update();
      if (Math.hypot(w.x[slot] - p0.x, w.z[slot] - p0.z) < 3) { reached = t; break; }
    }
    if (reached < 0) stuck.push(`(${s.x},${s.z})→(${w.x[slot].toFixed(1)},${w.z[slot].toFixed(1)})`);
    else worst = Math.max(worst, reached);
    w.reset?.();
  }
  ok(stuck.length === 0, `${m.id}: mọi khỉ tới nơi (chậm nhất ${(worst / 20).toFixed(1)} s) ${stuck.join(' ')}`);
}

console.log('\n[4] Hai phòng khác bản đồ chạy xen kẽ trong một tiến trình');
{
  const conn = (): MConn => ({ sent: 0, send() {}, close() {} });
  let now = 1000;
  const mk = (code: string, map: string) => {
    const r = new MonkeyRoom(code, false);
    r.manual = true;
    r.clock = () => now;
    r.mapChoice = map;
    const p = r.add('A', 0, conn());
    ok(r.start(p) === null, `${code}: bắt đầu trên bản đồ ${map}`);
    return { r, p };
  };
  const L = mk('LANG1', 'lang');
  const M = mk('MO001', 'mo');
  ok(L.r.mapDef.id === 'lang' && M.r.mapDef.id === 'mo', 'mỗi phòng giữ bản đồ của mình');
  // người chơi làng đi thẳng về phía bắc (x = 3.5, ngoài khe cầu) → phải bị sông chặn
  let seq = 1;
  const cmd = (): Cmd => ({ seq: seq++, mx: 0, mz: 127, yaw: 0, pitch: 0, btn: 0, vt: 0 });
  let seqM = 1;
  const cmdM = (): Cmd => ({ seq: seqM++, mx: 0, mz: 127, yaw: 0, pitch: 0, btn: 0, vt: 0 });
  let mapOk = true;
  for (let t = 0; t < 60 * 14; t++) {
    now += 1000 / 60;
    L.r.onCmds(L.p, [cmd()], 1);
    M.r.onCmds(M.p, [cmdM()], 1);
    if (t % 3 === 0) {
      L.r.step();
      if (MAP.id !== 'lang') mapOk = false;
      M.r.step();
      if (MAP.id !== 'mo') mapOk = false;
    }
  }
  ok(mapOk, 'bản đồ hiện hành đổi đúng theo phòng đang tick');
  const riverEdge = 25 - 3 - PLAYER_R + 0.01;
  ok(L.p.st.z <= riverEdge, `làng: bị sông chặn (z = ${L.p.st.z.toFixed(2)} ≤ ${riverEdge.toFixed(2)})`);
  ok(Math.abs(M.p.st.z) <= 48 && Math.abs(M.p.st.x) <= 48, `mỏ: vẫn trong sân 48 m (z = ${M.p.st.z.toFixed(2)})`);
  // chủ phòng đổi bản đồ trong sảnh; khách thì không được
  const S = new MonkeyRoom('LOBBY', false);
  S.manual = true;
  const h = S.add('H', 0, conn());
  const g = S.add('G', 1, conn());
  S.setMap(g, 'mo');
  ok(S.mapChoice === 'random', 'khách không đổi được bản đồ');
  S.setMap(h, 'khong-co');
  ok(S.mapChoice === 'random', 'id bản đồ lạ bị bỏ qua');
  S.setMap(h, 'mo');
  ok(S.mapChoice === 'mo', 'chủ phòng chọn Mỏ Đá');
  L.r.dispose();
  M.r.dispose();
  S.dispose();
}

console.log(fails ? `\n✘ ${fails} kiểm tra thất bại` : '\n✔ Bản đồ ổn');
process.exit(fails ? 1 : 0);
