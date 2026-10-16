// Các bản đồ của SINH TỒN BẦY KHỈ. Vật cản chỉ gồm hình tròn (cột, cây, đá) và hộp thẳng trục (tường, thùng, nước…)
// để va chạm + bắn tia rẻ và xác định.
//
// "Bản đồ đang dùng" là trạng thái cấp module: client và server gọi setActiveMap() trước khi mô phỏng.
// Server chạy nhiều phòng trong một tiến trình → mỗi phòng gọi setActiveMap(this.mapDef) ở đầu mỗi tick
// và mỗi lần xử lý lệnh (chỉ là vài phép gán, rất rẻ). ARENA/CIRCLES/BOXES/SPAWNS/PLAYER_SPAWNS là
// live binding (export let) nên mã cũ import trực tiếp vẫn thấy bản đồ hiện tại.

export const PLAYER_R = 0.42;
/** nửa cạnh sân lớn nhất trong mọi bản đồ (cấp phát lưới cố định ở server) */
export const MAX_ARENA = 48;

export type CircleKind = 'pillar' | 'tree' | 'rock' | 'stump' | 'post' | 'barrel' | 'hay' | 'palm' | 'boulder';
export type BoxKind = 'wall' | 'crate' | 'altar' | 'hut' | 'water' | 'boat' | 'pier' | 'fence' | 'cliff' | 'cart' | 'scaffold';
export interface Circle { x: number; z: number; r: number; h: number; kind: CircleKind }
export interface Box { x: number; z: number; hx: number; hz: number; h: number; kind: BoxKind }
/** chỉ để vẽ (không va chạm): cầu, đường ray, dòng sông */
export interface Deco { x: number; z: number; hx: number; hz: number; kind: 'bridge' | 'rail' | 'river' }
export interface Pt { x: number; z: number }

export interface MapTheme {
  style: 'jungle' | 'village' | 'quarry';
  /** màu nền đất trong sân + 3 màu lốm đốm */
  ground: string;
  dots: [string, string, string];
  /** màu lối mòn "r,g,b" */
  path: string;
  /** đất ngoài sân + 2 màu lốm đốm */
  outer: string;
  outerDots: [string, string];
  skyTop: number;
  skyMid: number;
  skyLow: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  leaf: number;
  leaf2: number;
  /** đom đóm / bụi */
  mote: number;
}

export interface MapDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** nửa cạnh sân (m) */
  arena: number;
  circles: Circle[];
  boxes: Box[];
  deco: Deco[];
  /** cổng khỉ ùa vào (mép sân) */
  spawns: Pt[];
  /** chỗ đứng đầu trận của từng người chơi (theo idx, ≥ MAX_PLAYERS chỗ) */
  playerSpawns: Pt[];
  theme: MapTheme;
}

const C = (x: number, z: number, r: number, h: number, kind: CircleKind): Circle => ({ x, z, r, h, kind });
const B = (x: number, z: number, hx: number, hz: number, h: number, kind: BoxKind): Box => ({ x, z, hx, hz, h, kind });
const P = (x: number, z: number): Pt => ({ x, z });

/** xoay (x,z) k lần 90° quanh tâm */
function rot(x: number, z: number, k: number): [number, number] {
  return k === 0 ? [x, z] : k === 1 ? [-z, x] : k === 2 ? [-x, -z] : [z, -x];
}
/** nhân 4 theo đối xứng xoay 90° */
function rot4C(list: Circle[]): Circle[] {
  const out: Circle[] = [];
  for (let k = 0; k < 4; k++) for (const c of list) { const [x, z] = rot(c.x, c.z, k); out.push({ ...c, x, z }); }
  return out;
}
function rot4B(list: Box[]): Box[] {
  const out: Box[] = [];
  for (let k = 0; k < 4; k++) {
    for (const b of list) {
      const [x, z] = rot(b.x, b.z, k);
      out.push(k & 1 ? { ...b, x, z, hx: b.hz, hz: b.hx } : { ...b, x, z });
    }
  }
  return out;
}
function rot4P(list: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < 4; k++) for (const p of list) { const [x, z] = rot(p.x, p.z, k); out.push({ x, z }); }
  return out;
}

/** chỗ đứng đầu trận theo idx người chơi: 4 chỗ trong (r≈5 m) + vòng 6 chỗ ngoài (r = 7 m) — đủ MAX_PLAYERS = 10 */
const CENTER_SPAWNS = [
  P(-3.5, -3.5), P(3.5, -3.5), P(-3.5, 3.5), P(3.5, 3.5),
  P(0, 7), P(0, -7), P(6.06, 3.5), P(-6.06, -3.5), P(6.06, -3.5), P(-6.06, 3.5),
];

/* ======================= ĐỀN RỪNG ======================= */
const RUNG: MapDef = {
  id: 'rung',
  name: 'Đền Rừng',
  emoji: '🌴',
  desc: 'Tàn tích đền đá giữa rừng rậm. Vòng tường đổ có 4 khe, cột đá và chòi canh ở góc.',
  arena: 46,
  circles: [
    ...rot4C([
      C(-9, -9, 0.9, 6.5, 'pillar'), // 4 cột đền quanh bàn thờ
      C(-20, -4, 0.8, 2.2, 'pillar'), // cột gãy cạnh khe tường
      C(-30, -9, 0.6, 9, 'tree'),
      C(-13, -31, 0.6, 9, 'tree'),
      C(-33, -26, 0.6, 9, 'tree'),
      C(-16, 17, 1.5, 1.4, 'rock'),
      C(-36, 18, 1.3, 1.2, 'rock'),
      C(-38, 4, 1.1, 1.0, 'rock'),
      C(7, 37, 0.7, 0.7, 'stump'),
      C(-25, 25, 0.8, 2.6, 'pillar'),
    ]),
  ],
  boxes: [
    B(0, 0, 1.6, 1.6, 1.2, 'altar'),
    ...rot4B([
      // tường đổ vòng trong (có khe đi qua)
      B(-6.5, -19, 3.4, 0.5, 2.4, 'wall'),
      B(8, -19, 2.2, 0.5, 1.6, 'wall'),
      // tàn tích vòng ngoài
      B(-30, 14, 0.5, 3, 2.0, 'wall'),
      B(-12, -39, 3, 0.5, 1.8, 'wall'),
      // cụm thùng gỗ
      B(-26, -18, 0.6, 0.6, 1.2, 'crate'),
      B(-24.7, -18, 0.6, 0.6, 1.2, 'crate'),
      B(-25.4, -16.7, 0.6, 0.6, 1.2, 'crate'),
      // chòi canh ở góc
      B(-38, -38, 2.2, 2.2, 3.4, 'hut'),
    ]),
  ],
  deco: [],
  spawns: rot4P([P(-44.5, 0), P(-43.5, -22), P(-43.5, 24)]),
  playerSpawns: CENTER_SPAWNS,
  theme: {
    style: 'jungle',
    ground: '#4f7a2f',
    dots: ['#5f8f36', '#446b28', '#6c9c3e'],
    path: '150,112,70',
    outer: '#3f6a26',
    outerDots: ['#4b7a2e', '#36601f'],
    skyTop: 0x4d8cdb,
    skyMid: 0xfacc8c,
    skyLow: 0x8cb38c,
    fog: 0xb8c9a0,
    fogNear: 45,
    fogFar: 135,
    hemiSky: 0xdcefff,
    hemiGround: 0x46602c,
    leaf: 0x3f8a3a,
    leaf2: 0x2f7330,
    mote: 0xfff3a0,
  },
};

/* ======================= LÀNG VEN SÔNG ======================= */
// Sông chảy ngang phía bắc (z 22..28), qua được bằng 3 cây cầu (x = -26, 0, 26) → điểm nghẽn.
// Nước chặn bước đi nhưng thấp (0.35 m) nên đạn bay qua được.
const RZ = 25; // tâm sông
const RH = 3; // nửa bề rộng sông
const BR = [-26, 0, 26]; // cầu
const BW = 2.2; // nửa bề rộng khe cầu
const LANG: MapDef = {
  id: 'lang',
  name: 'Làng Ven Sông',
  emoji: '🛶',
  desc: 'Làng nhà sàn bên sông. Ba cây cầu là điểm nghẽn, thuyền và bến gỗ làm chỗ nấp.',
  arena: 46,
  circles: [
    // cột đèn lồng quanh giếng làng
    ...rot4C([C(-7, -7, 0.35, 3.2, 'post')]),
    // dừa
    C(-24, -22, 0.5, 8, 'palm'), C(24, -22, 0.5, 8, 'palm'), C(-40, -30, 0.5, 8, 'palm'), C(40, -30, 0.5, 8, 'palm'),
    C(-26, 2, 0.5, 8, 'palm'), C(26, -1, 0.5, 8, 'palm'), C(-5, 15, 0.5, 8, 'palm'), C(-40, 15, 0.5, 8, 'palm'), C(40, 15, 0.5, 8, 'palm'),
    C(-30, 40, 0.5, 8, 'palm'), C(30, 40, 0.5, 8, 'palm'), C(-6, -40, 0.5, 8, 'palm'),
    // thùng phuy
    C(-12.8, -5.4, 0.45, 1.0, 'barrel'), C(-12.8, -6.5, 0.45, 1.0, 'barrel'), C(19.2, -6.2, 0.45, 1.0, 'barrel'),
    C(-18.2, 13.4, 0.45, 1.0, 'barrel'), C(5.5, 19.5, 0.45, 1.0, 'barrel'), C(18, 33, 0.45, 1.0, 'barrel'),
    // đụn rơm
    C(-24, -36, 1.2, 1.6, 'hay'), C(26, -37, 1.2, 1.6, 'hay'), C(-2, -22, 1.2, 1.6, 'hay'), C(-30, -4, 1.2, 1.6, 'hay'), C(34, -6, 1.2, 1.6, 'hay'),
    // đá ven sông
    C(-17, 20.4, 0.9, 0.8, 'rock'), C(17, 20.6, 0.9, 0.8, 'rock'), C(-38, 30, 1.0, 0.9, 'rock'), C(8, 30.4, 0.9, 0.8, 'rock'),
  ],
  boxes: [
    B(0, 0, 1.6, 1.6, 1.2, 'altar'),
    // sông (chia đoạn chừa khe cầu)
    B((-46 + BR[0] - BW) / 2, RZ, (BR[0] - BW + 46) / 2, RH, 0.35, 'water'),
    B((BR[0] + BW + BR[1] - BW) / 2, RZ, (BR[1] - BW - BR[0] - BW) / 2, RH, 0.35, 'water'),
    B((BR[1] + BW + BR[2] - BW) / 2, RZ, (BR[2] - BW - BR[1] - BW) / 2, RH, 0.35, 'water'),
    B((BR[2] + BW + 46) / 2, RZ, (46 - BR[2] - BW) / 2, RH, 0.35, 'water'),
    // lan can cầu
    ...BR.flatMap((x) => [B(x - BW + 0.15, RZ, 0.15, RH + 0.2, 1.0, 'fence'), B(x + BW - 0.15, RZ, 0.15, RH + 0.2, 1.0, 'fence')]),
    // bến gỗ chìa ra sông
    B(-37, RZ - 1.25, 1.0, 1.75, 0.45, 'pier'), B(13, RZ + 1.25, 1.0, 1.75, 0.45, 'pier'), B(37, RZ - 1.25, 1.0, 1.75, 0.45, 'pier'),
    // thuyền đậu dưới sông
    B(-33.5, RZ - 0.6, 2.0, 0.75, 0.9, 'boat'), B(9.5, RZ + 0.8, 2.0, 0.75, 0.9, 'boat'), B(-13, RZ, 2.0, 0.75, 0.9, 'boat'),
    // thuyền kéo lên bờ (chỗ nấp)
    B(-34, 18.4, 2.0, 0.75, 0.9, 'boat'), B(8, 18.4, 2.0, 0.75, 0.9, 'boat'), B(-12, 31.6, 2.0, 0.75, 0.9, 'boat'), B(36, 31.6, 2.0, 0.75, 0.9, 'boat'),
    // nhà sàn bờ nam
    B(-16, -9, 2.4, 2.4, 3.6, 'hut'), B(16, -9, 2.4, 2.4, 3.6, 'hut'), B(-15, 10, 2.4, 2.4, 3.6, 'hut'), B(15, 10, 2.4, 2.4, 3.6, 'hut'),
    B(-33, -15, 2.4, 2.4, 3.6, 'hut'), B(33, -15, 2.4, 2.4, 3.6, 'hut'), B(-8, -31, 2.4, 2.4, 3.6, 'hut'), B(10, -33, 2.4, 2.4, 3.6, 'hut'),
    B(-36, 6, 2.4, 2.4, 3.6, 'hut'), B(36, 4, 2.4, 2.4, 3.6, 'hut'),
    // nhà sàn bờ bắc
    B(-14, 38, 2.4, 2.4, 3.6, 'hut'), B(14, 38, 2.4, 2.4, 3.6, 'hut'), B(-36, 37, 2.4, 2.4, 3.6, 'hut'), B(36, 38, 2.4, 2.4, 3.6, 'hut'),
    // hàng rào ruộng
    B(-28, -26, 4, 0.15, 1.0, 'fence'), B(28, -26, 4, 0.15, 1.0, 'fence'), B(-18, -40, 0.15, 3, 1.0, 'fence'), B(18, -40, 0.15, 3, 1.0, 'fence'),
    B(-24, 8, 0.15, 3.5, 1.0, 'fence'), B(24, 8, 0.15, 3.5, 1.0, 'fence'),
    // thùng hàng ở bến
    B(-31, 20.2, 0.6, 0.6, 1.2, 'crate'), B(-29.8, 20.2, 0.6, 0.6, 1.2, 'crate'), B(21, 20.2, 0.6, 0.6, 1.2, 'crate'), B(31, 30.4, 0.6, 0.6, 1.2, 'crate'),
    B(-2, -12, 0.6, 0.6, 1.2, 'crate'), B(3, 12, 0.6, 0.6, 1.2, 'crate'),
  ],
  deco: [
    { x: 0, z: RZ, hx: 46 + 40, hz: RH, kind: 'river' },
    ...BR.map((x): Deco => ({ x, z: RZ, hx: BW, hz: RH + 0.4, kind: 'bridge' })),
  ],
  spawns: [
    // nam
    P(-30, -44.5), P(-6, -44.5), P(6, -44.5), P(30, -44.5),
    // tây / đông (bờ nam)
    P(-44.5, -22), P(-44.5, 0), P(-44.5, 13), P(44.5, -22), P(44.5, -2), P(44.5, 13),
    // bắc sông
    P(-22, 44.5), P(0, 44.5), P(22, 44.5), P(-44.5, 36), P(44.5, 34),
  ],
  playerSpawns: CENTER_SPAWNS,
  theme: {
    style: 'village',
    ground: '#6f8f3c',
    dots: ['#7fa046', '#5f7f32', '#8aa850'],
    path: '176,150,104',
    outer: '#5a7f36',
    outerDots: ['#668c3c', '#4d702e'],
    skyTop: 0x5fa8e8,
    skyMid: 0xffe2b0,
    skyLow: 0x9cc2a8,
    fog: 0xc6d8c8,
    fogNear: 48,
    fogFar: 140,
    hemiSky: 0xe8f4ff,
    hemiGround: 0x58703a,
    leaf: 0x4f9a3e,
    leaf2: 0x3a8034,
    mote: 0xffffff,
  },
};

/* ======================= MỎ ĐÁ ======================= */
// Vách đá xếp hình chong chóng quanh kho chuối giữa mỏ → 4 hẻm vào, giàn gỗ chắn giữa hẻm.
const MO: MapDef = {
  id: 'mo',
  name: 'Mỏ Đá',
  emoji: '⛏️',
  desc: 'Mỏ đá giữa vách núi. Hẻm hẹp, giàn giáo gỗ và xe goòng — dễ bị dồn vào góc.',
  arena: 48,
  circles: [
    ...rot4C([
      C(-7, -7, 0.35, 3.2, 'post'),
      C(-19, -15, 2.4, 4.5, 'boulder'),
      C(-30, -10, 2.8, 4.5, 'boulder'),
      C(-36, -26, 2.2, 3.8, 'boulder'),
      C(-16, -36, 1.3, 1.2, 'rock'),
      C(-24, -4, 1.2, 1.1, 'rock'),
      C(-11, -11, 0.9, 0.9, 'rock'),
      C(-28, 22, 1.6, 2.4, 'boulder'),
    ]),
  ],
  boxes: [
    B(0, 0, 1.6, 1.6, 1.2, 'altar'),
    ...rot4B([
      B(-11, -19, 5, 1.6, 5.5, 'cliff'),
      B(4, -19, 1.6, 1.6, 4, 'scaffold'),
      B(-26, -34, 4, 1.8, 6, 'cliff'),
      B(-8, -33, 0.7, 1.2, 1.3, 'cart'),
      B(-8, -30.4, 0.7, 1.2, 1.3, 'cart'),
      B(-38, -38, 2, 2, 4.2, 'scaffold'),
      B(-30, 4, 0.6, 0.6, 1.2, 'crate'),
      B(-30, 5.3, 0.6, 0.6, 1.2, 'crate'),
      B(-28.8, 4.6, 0.6, 0.6, 1.2, 'crate'),
    ]),
  ],
  deco: rot4B([B(-8, -31.5, 0.6, 9, 0, 'cart')]).map((b): Deco => ({ x: b.x, z: b.z, hx: b.hx, hz: b.hz, kind: 'rail' })),
  spawns: rot4P([P(-46.5, -4), P(-46.5, 22), P(-46, -46)]),
  playerSpawns: CENTER_SPAWNS,
  theme: {
    style: 'quarry',
    ground: '#8a7a62',
    dots: ['#97876c', '#7a6b55', '#a39276'],
    path: '110,96,80',
    outer: '#6e6250',
    outerDots: ['#7a6d5a', '#615645'],
    skyTop: 0x6a8fb8,
    skyMid: 0xf0c090,
    skyLow: 0x9a8a78,
    fog: 0xc4b49a,
    fogNear: 45,
    fogFar: 135,
    hemiSky: 0xfff0dc,
    hemiGround: 0x6a5a44,
    leaf: 0x5a7a34,
    leaf2: 0x4a6a2c,
    mote: 0xffe0b0,
  },
};

export const MAPS: MapDef[] = [RUNG, LANG, MO];
/** lựa chọn "ngẫu nhiên" trong sảnh (server chốt bản đồ khi bắt đầu) */
export const MAP_RANDOM = 'random';

export function mapById(id: string | undefined | null): MapDef {
  for (const m of MAPS) if (m.id === id) return m;
  return MAPS[0];
}
export function isMapChoice(v: unknown): v is string {
  return v === MAP_RANDOM || MAPS.some((m) => m.id === v);
}

/* ---------- bản đồ đang dùng (live binding) ---------- */
export let MAP: MapDef = MAPS[0];
export let ARENA = MAP.arena;
export let CIRCLES: Circle[] = MAP.circles;
export let BOXES: Box[] = MAP.boxes;
export let SPAWNS: Pt[] = MAP.spawns;
export let PLAYER_SPAWNS: Pt[] = MAP.playerSpawns;

/** đặt bản đồ đang dùng cho va chạm/bắn tia (nhận id hoặc chính MapDef); trả MapDef */
export function setActiveMap(m: MapDef | string): MapDef {
  const d = typeof m === 'string' ? mapById(m) : m;
  if (d === MAP) return d;
  MAP = d;
  ARENA = d.arena;
  CIRCLES = d.circles;
  BOXES = d.boxes;
  SPAWNS = d.spawns;
  PLAYER_SPAWNS = d.playerSpawns;
  return d;
}

/**
 * Đẩy một hình tròn (x,z,r) ra khỏi mọi vật cản + giữ trong sân.
 * Ghi kết quả vào out[0], out[1]. Xác định, không cấp phát.
 */
export function collide(x: number, z: number, r: number, out: Float64Array, bound = ARENA) {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < CIRCLES.length; i++) {
      const c = CIRCLES[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const k = (rr - d) / d;
          x += dx * k;
          z += dz * k;
        } else {
          x += rr;
        }
      }
    }
    for (let i = 0; i < BOXES.length; i++) {
      const b = BOXES[i];
      const px = x < b.x - b.hx ? b.x - b.hx : x > b.x + b.hx ? b.x + b.hx : x;
      const pz = z < b.z - b.hz ? b.z - b.hz : z > b.z + b.hz ? b.z + b.hz : z;
      const dx = x - px;
      const dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const k = (r - d) / d;
          x += dx * k;
          z += dz * k;
        } else {
          // tâm nằm trong hộp: đẩy ra cạnh gần nhất
          const ex = b.hx - Math.abs(x - b.x);
          const ez = b.hz - Math.abs(z - b.z);
          if (ex < ez) x = x < b.x ? b.x - b.hx - r : b.x + b.hx + r;
          else z = z < b.z ? b.z - b.hz - r : b.z + b.hz + r;
        }
      }
    }
  }
  const lim = bound - r;
  if (x < -lim) x = -lim;
  else if (x > lim) x = lim;
  if (z < -lim) z = -lim;
  else if (z > lim) z = lim;
  out[0] = x;
  out[1] = z;
}

/**
 * Tia 3D (o + d·t) chạm vật cản/mặt đất gần nhất trong [0, maxT]. Trả t (maxT nếu không chạm).
 * d không cần chuẩn hoá (t tính theo độ dài d).
 */
export function rayWorld(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number) {
  let best = maxT;
  if (dy < -1e-9) {
    const tg = -oy / dy;
    if (tg >= 0 && tg < best) best = tg;
  }
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    for (let i = 0; i < CIRCLES.length; i++) {
      const c = CIRCLES[i];
      const fx = ox - c.x;
      const fz = oz - c.z;
      const b = fx * dx + fz * dz;
      const cc = fx * fx + fz * fz - c.r * c.r;
      if (cc <= 0) continue; // đang đứng trong (hiếm) → bỏ qua
      const disc = b * b - a * cc;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a;
      if (t < 0 || t >= best) continue;
      const y = oy + dy * t;
      if (y >= 0 && y <= c.h) best = t;
    }
  }
  for (let i = 0; i < BOXES.length; i++) {
    const bx = BOXES[i];
    let t0 = 0;
    let t1 = best;
    // slab x
    if (Math.abs(dx) < 1e-12) {
      if (ox < bx.x - bx.hx || ox > bx.x + bx.hx) continue;
    } else {
      let ta = (bx.x - bx.hx - ox) / dx;
      let tb = (bx.x + bx.hx - ox) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-12) {
      if (oz < bx.z - bx.hz || oz > bx.z + bx.hz) continue;
    } else {
      let ta = (bx.z - bx.hz - oz) / dz;
      let tb = (bx.z + bx.hz - oz) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-12) {
      if (oy < 0 || oy > bx.h) continue;
    } else {
      let ta = (0 - oy) / dy;
      let tb = (bx.h - oy) / dy;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (t0 < best) best = t0;
  }
  return best;
}

/** đoạn thẳng 2D có bị vật cản che không (pad = nới bán kính vật cản) */
export function losBlocked(x0: number, z0: number, x1: number, z1: number, pad: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return false;
  for (let i = 0; i < CIRCLES.length; i++) {
    const c = CIRCLES[i];
    const r = c.r + pad;
    let t = ((c.x - x0) * dx + (c.z - z0) * dz) / a;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x0 + dx * t - c.x;
    const pz = z0 + dz * t - c.z;
    if (px * px + pz * pz < r * r) return true;
  }
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    const minx = b.x - b.hx - pad;
    const maxx = b.x + b.hx + pad;
    const minz = b.z - b.hz - pad;
    const maxz = b.z + b.hz + pad;
    let t0 = 0;
    let t1 = 1;
    if (Math.abs(dx) < 1e-12) {
      if (x0 < minx || x0 > maxx) continue;
    } else {
      let ta = (minx - x0) / dx;
      let tb = (maxx - x0) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-12) {
      if (z0 < minz || z0 > maxz) continue;
    } else {
      let ta = (minz - z0) / dz;
      let tb = (maxz - z0) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}
