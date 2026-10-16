// SINH TỒN BẦY KHỈ — điều phối màn hình: sảnh chính → phòng → trận → tổng kết.

import './styles.css';
import { GameModel } from '@shared/monkey/client';
import { CLASSES, MK_CHAY, MK_DOT, MK_NAU, MK_NEM, MK_NO, MK_TRANG, ULT_KILLS } from '@shared/monkey/content';
import { CODE_LEN, GAME_TITLE, MAX_PLAYERS, NAME_MAX } from '@shared/monkey/config';
import { ST_MOVE, ST_THROW, ST_WIND, type BoardEntry, type LobbyPlayer, type SMsg } from '@shared/monkey/proto';
import * as A from './audio';
import { Game } from './game';
import { Input } from './input';
import { net } from './net';
import { Fx } from './render/fx';
import { Avatar } from './render/avatars';
import { MonkeyRenderer } from './render/monkeys';
import { Stage, blobTex as blobTexture, resolveQuality } from './render/scene';
import { MAPS, MAP_RANDOM, isMapChoice, setActiveMap } from '@shared/monkey/map';
import { keyLabel, onSettings, sessionGet, sessionSet, settings, store } from './settings';
import { CLASS_ICON, clear, clsColor, clsIcon, fmt, h, timeStr, toast } from './ui/dom';
import { openSettings } from './ui/settingsUi';
import { openShop } from './ui/shop';

const app = document.getElementById('app')!;
/** Windows có "tắt touchpad khi đang gõ phím": giữ WASD là touchpad bị khoá → không xoay được camera */
export const TOUCHPAD_TIP = 'Có vẻ <b>Windows đang khoá touchpad khi bạn giữ phím</b> nên không xoay được camera lúc chạy. Sửa: Cài đặt Windows → Bluetooth &amp; thiết bị → Touchpad → <b>Độ nhạy touchpad: Nhạy nhất</b> (hoặc dùng chuột rời). Tạm thời có thể xoay bằng phím <span class="k">←</span> <span class="k">→</span>.';
const canvas = document.getElementById('stage') as HTMLCanvasElement;

/* ======================= 3D DÙNG CHUNG ======================= */
let stage: Stage;
try {
  stage = new Stage(canvas);
} catch (e) {
  app.append(h('div', { class: 'home' }, h('div', { class: 'card' }, h('h2', null, 'Không khởi tạo được WebGL'), h('p', null, 'Hãy bật "Tăng tốc phần cứng" trong cài đặt trình duyệt hoặc thử trình duyệt khác (Chrome/Edge/Firefox mới).'))));
  throw e;
}
const monkeys = new MonkeyRenderer();
const fx = new Fx(stage.q.particles);
stage.scene.add(monkeys.group, fx.group);
monkeys.detail = stage.q.detail;
stage.onQuality = (l) => {
  const q = stage.q;
  fx.setLimit(q.particles);
  monkeys.detail = q.detail;
  void l;
};
onSettings(() => {
  const want = resolveQuality(settings.quality);
  if (want !== stage.q.level) stage.applyQuality(want);
  A.applyVolumes();
});
const input = new Input(canvas);

/* ======================= TRẠNG THÁI ======================= */
let name = store('monkey-name') ?? '';
let myCls = Number(store('monkey-cls') ?? 0) || 0;
if (!(myCls >= 0 && myCls < CLASSES.length)) myCls = 0;
let screen: 'home' | 'lobby' | 'game' | 'over' = 'home';
let room: { code: string; phase: string; solo: boolean; host: number; players: LobbyPlayer[]; map: string } | null = null;
/** bản đồ muốn chơi (dùng khi tạo phòng / chơi đơn) */
let myMap = store('monkey-map') ?? MAP_RANDOM;
if (!isMapChoice(myMap)) myMap = MAP_RANDOM;
let meIdx = -1;
let game: Game | null = null;
let lb: { solo: BoardEntry[]; team: BoardEntry[] } = { solo: [], team: [] };
let lbTab: 'solo' | 'team' = 'solo';
let lastOver: Extract<SMsg, { t: 'over' }> | null = null;
let modalClose: (() => void) | null = null;
let pendingJoin = new URLSearchParams(location.search).get('room');

/* ======================= MẠNG ======================= */
net.onStatus = (up) => {
  statusEl.className = `status${up ? ' up' : ''}`;
  statusText.textContent = up ? 'Đã kết nối máy chủ' : 'Đang kết nối…';
  if (up) {
    net.send({ t: 'lb' });
    const sess = sessionGet('monkey-session');
    if (sess) {
      try {
        const s = JSON.parse(sess);
        net.send({ t: 'rejoin', code: s.code, pid: s.pid, token: s.token });
      } catch {
        sessionSet('monkey-session', null);
      }
    }
  }
};
net.onJson = (m) => {
  switch (m.t) {
    case 'welcome':
      return;
    case 'err':
      toast(m.m);
      if (m.m.includes('khôi phục') || m.m.includes('không còn')) {
        sessionSet('monkey-session', null);
        if (screen !== 'home') goHome();
      }
      return;
    case 'lb':
      lb = { solo: m.solo, team: m.team };
      if (screen === 'home') renderHome();
      return;
    case 'joined':
      meIdx = m.idx;
      sessionSet('monkey-session', JSON.stringify({ code: m.code, pid: m.pid, token: m.token }));
      return;
    case 'room':
      room = { code: m.code, phase: m.phase, solo: m.solo, host: m.host, players: m.players, map: m.map };
      if (m.phase === 'lobby' && m.map !== MAP_RANDOM) stage.setMap(m.map); // xem trước bản đồ làm nền sảnh
      if (m.phase === 'lobby' && !m.solo && screen !== 'lobby') {
        endGame();
        screen = 'lobby';
        renderLobby();
      } else if (screen === 'lobby') renderLobby();
      if (game) game.players.forEach(() => {});
      return;
    case 'start':
      setActiveMap(m.map);
      stage.setMap(m.map);
      startGame(m.players);
      return;
    case 'paused':
      game?.model.resetClock();
      return;
    case 'over':
      lastOver = m;
      showOver(m);
      return;
    case 'left':
      sessionSet('monkey-session', null);
      goHome();
      return;
  }
  game?.onJson(m);
};
net.onBin = (v) => game?.onBin(v);
net.connect();

/* ======================= MÀN CHÍNH ======================= */
const statusText = h('span', null, 'Đang kết nối…');
const statusEl = h('div', { class: 'status' }, h('span', { class: 'dot' }), statusText);
document.body.append(statusEl);

function nameOk() {
  const n = name.trim();
  if (!n) {
    toast('Nhập tên trước đã!');
    (document.querySelector('.field input') as HTMLInputElement | null)?.focus();
    return false;
  }
  store('monkey-name', n);
  return true;
}

function characterPicker(onPick: (c: number) => void, cur: number) {
  const wrap = h('div');
  const grid = h('div', { class: 'classes' });
  const info = h('div', { class: 'clsinfo' });
  const draw = () => {
    clear(grid);
    CLASSES.forEach((c, i) => {
      grid.append(h('button', { class: `cls${i === cur ? ' on' : ''}`, onclick: () => { cur = i; onPick(i); A.sfxUi(); draw(); } }, clsIcon(i), h('b', null, c.name), h('span', null, c.role)));
    });
    const c = CLASSES[cur];
    clear(info);
    info.append(
      h('b', null, `${c.name} — `), c.desc, h('br'),
      h('span', { class: 'k' }, '♥'), `${c.hp} máu · ${c.passive}`, h('br'),
      h('span', { class: 'k' }, '🔫'), c.weapons.map((w) => w.short).join(' → '), h('br'),
      h('span', { class: 'k' }, keyLabel(settings.keys.skillG)), h('span', { title: c.g.desc }, `${c.g.icon} ${c.g.name} (${c.g.cost} xu) `),
      h('span', { class: 'k' }, keyLabel(settings.keys.skillX)), h('span', { title: c.x.desc }, `${c.x.icon} ${c.x.name} (${c.x.cost} xu) `),
      h('span', { class: 'k' }, keyLabel(settings.keys.ult)), h('span', { title: c.q.desc }, `${c.q.icon} ${c.q.name}`),
    );
  };
  draw();
  wrap.append(grid, info);
  return wrap;
}

/** chọn bản đồ: "Ngẫu nhiên" + từng bản đồ; editable = false → chỉ xem (người không phải chủ phòng) */
function mapPicker(cur: string, editable: boolean, onPick: (id: string) => void) {
  const wrap = h('div');
  const grid = h('div', { class: `maps${editable ? '' : ' ro'}` });
  const info = h('div', { class: 'mapinfo' });
  const opts = [
    { id: MAP_RANDOM, emoji: '🎲', name: 'Ngẫu nhiên', sub: 'bốc thăm', desc: 'Máy chủ bốc thăm một bản đồ khi bắt đầu trận.' },
    ...MAPS.map((m) => ({ id: m.id, emoji: m.emoji, name: m.name, sub: `${m.arena * 2}×${m.arena * 2} m`, desc: m.desc })),
  ];
  const draw = () => {
    clear(grid);
    for (const o of opts) {
      grid.append(h('button', { class: `mapc${o.id === cur ? ' on' : ''}`, title: o.desc, disabled: !editable && o.id !== cur, onclick: () => { if (!editable || o.id === cur) return; cur = o.id; onPick(o.id); A.sfxUi(); draw(); } }, h('i', null, o.emoji), h('b', null, o.name), h('span', null, o.sub)));
    }
    clear(info);
    info.append((opts.find((o) => o.id === cur) ?? opts[0]).desc);
  };
  draw();
  wrap.append(grid, info);
  return wrap;
}

function boardTable(list: BoardEntry[], hl?: BoardEntry | null) {
  if (!list.length) return h('div', { class: 'empty' }, 'Chưa có ai ghi danh — hãy là người đầu tiên!');
  const t = h('table', { class: 'lb' }, h('tr', null, h('th', null, '#'), h('th', null, 'NGƯỜI CHƠI'), h('th', { class: 'n' }, 'ĐỢT'), h('th', { class: 'n' }, 'ĐIỂM'), h('th', { class: 'n' }, 'HẠ')));
  list.forEach((e, i) => {
    const me = hl && e.at === hl.at && e.score === hl.score;
    t.append(h('tr', { class: me ? 'me' : '' },
      h('td', null, h('span', { class: 'medal' }, i + 1)),
      h('td', { class: 'names', title: e.names.join(', ') }, e.names.map((n, k) => `${CLASS_ICON[e.cls[k]] ?? ''}${n}`).join(' · ')),
      h('td', { class: 'n' }, e.wave),
      h('td', { class: 'n' }, fmt(e.score)),
      h('td', { class: 'n' }, e.kills)));
  });
  return t;
}

function renderHome() {
  closeModal();
  clear(app);
  screen = 'home';
  input.enabled = false;
  const nameIn = h('input', { maxlength: String(NAME_MAX), placeholder: 'Tên của bạn', value: name, autocomplete: 'off' }) as HTMLInputElement;
  nameIn.addEventListener('input', () => { name = nameIn.value; });
  const codeIn = h('input', { maxlength: String(CODE_LEN), placeholder: 'MÃ', value: pendingJoin ?? '' }) as HTMLInputElement;
  const join = () => {
    A.initAudio();
    if (!nameOk()) return;
    const code = codeIn.value.trim().toUpperCase();
    if (code.length < 4) return toast('Mã phòng gồm 5 ký tự');
    net.send({ t: 'join', code, name: name.trim(), cls: myCls });
  };
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  const lbBox = h('div');
  const drawLb = () => {
    clear(lbBox);
    lbBox.append(
      h('div', { class: 'tabs' },
        h('button', { class: lbTab === 'solo' ? 'on' : '', onclick: () => { lbTab = 'solo'; drawLb(); } }, 'MỘT MÌNH'),
        h('button', { class: lbTab === 'team' ? 'on' : '', onclick: () => { lbTab = 'team'; drawLb(); } }, 'ĐỒNG ĐỘI')),
      boardTable((lbTab === 'solo' ? lb.solo : lb.team).slice(0, 10)),
    );
  };
  drawLb();
  app.append(h('div', { class: 'home' },
    h('div', null,
      h('h1', { class: 'logo' }, 'SINH TỒN', h('small', null, 'BẦY KHỈ 🐒')),
      h('p', { class: 'tag' }, 'Bắn súng sinh tồn co-op 1–4 người. Bầy khỉ ùa ra từ rừng mỗi đợt một đông — hạ khỉ kiếm xu, nâng cấp súng, dùng kỹ năng nhân vật và đỡ đồng đội dậy. Trụ được bao nhiêu đợt?'),
      h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Tên'), nameIn),
        h('div', { class: 'field' }, h('label', null, 'Chọn nhân vật')),
        characterPicker((c) => { myCls = c; store('monkey-cls', String(c)); }, myCls),
        h('div', { class: 'field' }, h('label', null, 'Bản đồ')),
        mapPicker(myMap, true, (id) => { myMap = id; store('monkey-map', id); }),
        h('div', { class: 'row' },
          h('button', { class: 'btn big grow', onclick: () => { A.initAudio(); if (nameOk()) net.send({ t: 'create', name: name.trim(), cls: myCls, solo: true, map: myMap }); } }, '▶ CHƠI MỘT MÌNH'),
          h('button', { class: 'btn green big grow', onclick: () => { A.initAudio(); if (nameOk()) net.send({ t: 'create', name: name.trim(), cls: myCls, solo: false, map: myMap }); } }, '👥 TẠO PHÒNG')),
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('div', { class: 'grow', style: 'font-size:13px;color:var(--dim)' }, 'Có mã phòng của bạn bè?'),
          h('div', { class: 'join' }, codeIn, h('button', { class: 'btn ghost', onclick: join }, 'VÀO PHÒNG'))))),
    h('div', { class: 'side' },
      h('div', { class: 'card' }, h('h3', { style: 'margin:0 0 10px;letter-spacing:.12em;font-size:13px;color:var(--dim)' }, '🏆 BẢNG XẾP HẠNG'), lbBox),
      h('div', { class: 'foot' },
        h('button', { class: 'btn ghost grow', onclick: () => { A.initAudio(); showHelp(); } }, '❓ CÁCH CHƠI'),
        h('button', { class: 'btn ghost grow', onclick: () => { A.initAudio(); modal(openSettings(() => (modalClose = null))); } }, '⚙ CÀI ĐẶT')))));
  if (!name) setTimeout(() => nameIn.focus(), 50);
  if (pendingJoin && name) {
    pendingJoin = null;
    setTimeout(join, 400);
  }
}

function modal(close: () => void) {
  modalClose = close;
}
function closeModal() {
  if (modalClose) {
    const c = modalClose;
    modalClose = null;
    c();
  }
}

function showHelp() {
  const k = settings.keys;
  const root = h('div', { class: 'modal' });
  const close = () => { root.remove(); modalClose = null; };
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  const li = (a: string, b: string) => h('div', { class: 'set' }, h('div', { class: 'lbl' }, a), h('div', { style: 'font-weight:900;color:var(--banana)' }, b));
  root.append(h('div', { class: 'card' },
    h('h2', null, 'CÁCH CHƠI', h('button', { class: 'btn ghost sm', onclick: close }, 'Đóng ✕')),
    h('p', { style: 'color:var(--dim);line-height:1.6;margin-top:0' },
      'Mỗi đợt, khỉ ùa vào đền từ 10 cổng rừng. Hạ khỉ để nhận xu (đồng đội được chia 30%). Hết đợt được nghỉ ngắn để mua sắm. Mỗi 5 đợt có VUA KHỈ ĐỘT: nó đập đất tạo SÓNG XUNG KÍCH — hãy NHẢY để né. Máu về 0 thì bạn GỤC: đồng đội đứng cạnh giữ phím đỡ dậy trong 3 giây (Y sĩ nhanh gấp đôi). Gục quá 25 giây là tử trận và chỉ hồi sinh khi đội qua đợt. Cả đội gục là thua.'),
    h('h3', null, 'Các loài khỉ'),
    h('div', { style: 'color:var(--dim);font-size:13.5px;line-height:1.7' },
      '🟤 Khỉ Nâu — thường · 🟠 Khỉ Chạy — rất nhanh, máu ít · 🟢 Khỉ Ném Chuối — đứng xa ném (né được) · 🔴 Khỉ Đỏ Nổ — áp sát rồi phát nổ (có vòng đỏ cảnh báo); bắn chết nó gần bầy khỉ khác thì nổ lây · ⚪ Khỉ Trắng — vồ từ xa · ⚫ Khỉ Đột — trâu, đập đất diện rộng · 👑 Vua Khỉ Đột — boss mỗi 5 đợt'),
    h('h3', null, 'Phím'),
    li('Di chuyển', `${keyLabel(k.forward)} ${keyLabel(k.left)} ${keyLabel(k.back)} ${keyLabel(k.right)}`),
    li('Bắn / Ngắm', 'Chuột trái / Chuột phải'),
    li('Nhảy · Chạy nhanh · Nạp đạn', `${keyLabel(k.jump)} · ${keyLabel(k.sprint)} · ${keyLabel(k.reload)}`),
    li('Đỡ đồng đội dậy (giữ)', keyLabel(k.use)),
    li('Kỹ năng 1 · Kỹ năng 2 · Tuyệt chiêu', `${keyLabel(k.skillG)} · ${keyLabel(k.skillX)} · ${keyLabel(k.ult)}`),
    li('Nâng súng · Nâng máu · Cửa hàng', `${keyLabel(k.buyWeapon)} · ${keyLabel(k.buyHp)} · ${keyLabel(k.shop)}`),
    li('Bảng điểm · Tạm dừng', `${keyLabel(k.scores)} (giữ) · Esc`),
    li('Xoay camera bằng phím (dự phòng)', `${keyLabel(k.turnLeft)} ${keyLabel(k.turnRight)} ${keyLabel(k.lookUp)} ${keyLabel(k.lookDown)}`),
    h('p', { style: 'color:var(--dim);font-size:13px' }, 'Dùng touchpad trên laptop mà chạy (giữ W A S D) thì không xoay được camera? Đó là Windows tự khoá touchpad khi gõ phím: vào Cài đặt Windows → Bluetooth & thiết bị → Touchpad → Độ nhạy touchpad → "Nhạy nhất", hoặc dùng chuột rời, hoặc xoay bằng phím mũi tên.'),
    h('p', { style: 'color:var(--dim);font-size:13px' }, `Tuyệt chiêu sạc đầy sau ${ULT_KILLS} con khỉ. Mỗi nhân vật có dòng súng 5 bậc riêng (nâng bằng phím V).`)));
  app.append(root);
  modal(close);
}

/* ======================= PHÒNG CHỜ ======================= */
function renderLobby() {
  if (!room) return;
  closeModal();
  clear(app);
  input.enabled = false;
  const r = room;
  const isHost = r.host === meIdx;
  const me = r.players.find((p) => p.idx === meIdx);
  const slots = h('div', { class: 'slots' });
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = r.players.find((q) => q.idx === i);
    if (!p) {
      slots.append(h('div', { class: 'slot' }, h('div', { style: 'opacity:.4;font-size:28px' }, '🐒'), h('div', { style: 'color:var(--dim);font-size:12px' }, 'Đang chờ…')));
      continue;
    }
    const st = !p.on ? h('div', { class: 'st off' }, 'MẤT KẾT NỐI') : p.idx === r.host ? h('div', { class: 'st host' }, 'CHỦ PHÒNG') : p.ready ? h('div', { class: 'st ok' }, 'SẴN SÀNG') : h('div', { class: 'st' }, 'CHƯA SẴN SÀNG');
    slots.append(h('div', { class: `slot filled${p.idx === meIdx ? ' me' : ''}` }, clsIcon(p.cls, 48), h('div', { class: 'nm' }, p.name), h('div', { style: `font-size:12px;color:${clsColor(p.cls)};font-weight:800` }, CLASSES[p.cls].name), st));
  }
  const notReady = r.players.filter((p) => p.idx !== r.host && p.on && !p.ready);
  const link = `${location.origin}${location.pathname}?room=${r.code}`;
  app.append(h('div', { class: 'lobby' }, h('div', { class: 'card' },
    h('div', { class: 'code' },
      h('div', null, h('div', { style: 'font-size:12px;letter-spacing:.14em;color:var(--dim);font-weight:800' }, 'MÃ PHÒNG'), h('div', { class: 'v' }, r.code)),
      h('button', { class: 'btn ghost sm', onclick: () => { navigator.clipboard?.writeText(r.code).then(() => toast('Đã chép mã phòng', true)).catch(() => {}); } }, '📋 Chép mã'),
      h('button', { class: 'btn ghost sm', onclick: () => { navigator.clipboard?.writeText(link).then(() => toast('Đã chép đường dẫn mời', true)).catch(() => {}); } }, '🔗 Chép link mời'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', onclick: () => { net.send({ t: 'leave' }); } }, '← Rời phòng')),
    slots,
    h('div', { class: 'field' }, h('label', null, 'Nhân vật của bạn')),
    characterPicker((c) => { myCls = c; store('monkey-cls', String(c)); net.send({ t: 'cls', cls: c }); }, me?.cls ?? myCls),
    h('div', { class: 'field' }, h('label', null, isHost ? 'Bản đồ' : 'Bản đồ (chủ phòng chọn)')),
    mapPicker(r.map, isHost, (id) => net.send({ t: 'map', id })),
    h('div', { class: 'row' },
      h('div', { class: 'grow', style: 'color:var(--dim);font-size:13px' },
        isHost ? (notReady.length ? `Đang chờ: ${notReady.map((p) => p.name).join(', ')}` : r.players.length === 1 ? 'Chơi một mình được — hoặc gửi mã cho bạn bè (tối đa 4 người).' : 'Mọi người đã sẵn sàng!') : 'Chủ phòng sẽ bắt đầu khi mọi người sẵn sàng.'),
      isHost
        ? h('button', { class: 'btn green big', disabled: notReady.length > 0, onclick: () => { A.initAudio(); goFullscreen(); net.send({ t: 'start' }); } }, '▶ BẮT ĐẦU')
        : h('button', { class: `btn big ${me?.ready ? 'ghost' : 'green'}`, onclick: () => { A.initAudio(); if (!me?.ready) goFullscreen(); net.send({ t: 'ready', r: !me?.ready }); } }, me?.ready ? 'HUỶ SẴN SÀNG' : '✔ SẴN SÀNG')))));
}

/* ======================= TRẬN ======================= */
let touchUi: HTMLElement | null = null;
let shopOpen = false;
let pauseEl: HTMLElement | null = null;

function startGame(players: { idx: number; name: string; cls: number }[]) {
  closeModal();
  endGame();
  clear(app);
  lastOver = null;
  screen = 'game';
  document.body.classList.add('ingame');
  game = new Game({ stage, monkeys, fx }, input, players, meIdx);
  buildTouch();
  applyMode(input.touch);
  enterPlay();
}

/* ---------- bắt buộc toàn màn hình + khoá chuột ---------- */
/** vào toàn màn hình sẵn từ sảnh (nút Bắt đầu / Sẵn sàng là cử chỉ người dùng) */
function goFullscreen() {
  if (document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
/** máy hỗ trợ toàn màn hình (iPhone không có) thì bắt buộc phải vào toàn màn hình mới điều khiển được */
const fsOk = () => !document.fullscreenEnabled || !!document.fullscreenElement;
input.gate = fsOk;
const inGameFree = () => !!game && screen === 'game' && !pauseEl && !shopOpen && !modalClose;

/** gọi trong cú bấm của người chơi: xin toàn màn hình rồi khoá chuột (cả hai cần cử chỉ người dùng) */
function enterPlay() {
  if (!fsOk()) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(
      () => { if (inGameFree() && !input.touch) input.lock(); },
      () => {},
    );
  }
  if (!input.touch) input.lock();
  refreshPrompt();
}

function refreshPrompt() {
  if (!game || screen !== 'game') return;
  const free = !pauseEl && !shopOpen;
  if (free && !fsOk()) game.hud.setClickPrompt(true, '⛶ Bấm vào màn hình để vào TOÀN MÀN HÌNH và chơi');
  else game.hud.setClickPrompt(free && !input.touch && !document.pointerLockElement);
}

// bấm bất kỳ đâu trên màn chơi (kể cả lúc khoá chuột vừa bị trình duyệt từ chối) → vào lại
document.addEventListener('pointerdown', (e) => {
  if (!inGameFree()) return;
  if ((e.target as HTMLElement | null)?.closest('button, input, select, a, .card')) return;
  if (!fsOk() || (!input.touch && !document.pointerLockElement)) enterPlay();
}, true);
document.addEventListener('fullscreenchange', () => {
  // thoát toàn màn hình giữa trận → tạm dừng, chỉ chơi tiếp được khi vào lại
  if (!fsOk() && inGameFree()) showPause();
  refreshPrompt();
});
document.addEventListener('pointerlockerror', () => refreshPrompt());

/** đổi giữa chuột và cảm ứng ngay trong trận (laptop màn cảm ứng dùng được cả hai) */
function applyMode(touch: boolean) {
  document.body.classList.toggle('touchmode', touch);
  touchUi?.classList.toggle('hidden', !touch);
  refreshPrompt();
}
input.onMode = (t) => applyMode(t);
document.body.classList.toggle('touchmode', input.touch);

input.onAction = (a) => {
  if (a === 'touchpad') {
    game?.hud.showHint(TOUCHPAD_TIP, 15000);
    return;
  }
  if (!game || screen !== 'game') return;
  if (a === 'shop') toggleShop();
  else if (a === 'scoresOn') game.hud.showScores(true, game.model);
  else if (a === 'scoresOff') game.hud.showScores(false, null);
  else if (a === 'pause') {
    if (!shopOpen && !modalClose) showPause();
  }
};

function toggleShop() {
  if (!game) return;
  if (shopOpen) {
    closeModal();
    return;
  }
  shopOpen = true;
  input.unlock();
  input.enabled = false;
  input.resetKeys();
  const g = game;
  modal(openShop(g.model, (item) => net.send({ t: 'buy', item }), (r) => g.setBreakReady(r), () => g.isBreakReady(), () => {
    shopOpen = false;
    modalClose = null;
    if (game && screen === 'game') {
      input.enabled = true;
      enterPlay();
    }
  }));
}

function showPause() {
  if (pauseEl || !game) return;
  input.enabled = false;
  input.resetKeys();
  if (room?.solo) net.send({ t: 'pause', p: true });
  const resume = () => {
    if (room?.solo) net.send({ t: 'pause', p: false });
    pauseEl?.remove();
    pauseEl = null;
    document.removeEventListener('keydown', onEsc, true);
    if (game && screen === 'game') {
      input.enabled = true;
      enterPlay();
    }
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && !modalClose) { e.preventDefault(); resume(); }
  };
  document.addEventListener('keydown', onEsc, true);
  pauseEl = h('div', { class: 'modal' }, h('div', { class: 'card', style: 'width:min(380px,100%);text-align:center' },
    h('h2', { style: 'justify-content:center' }, 'TẠM DỪNG'),
    h('p', { style: 'color:var(--dim);margin-top:0' }, room?.solo ? 'Trận đã dừng lại — khỉ đứng im chờ bạn.' : 'Trận vẫn tiếp diễn với đồng đội (chơi nhiều người không dừng được).'),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('button', { class: 'btn green big', onclick: resume }, '▶ TIẾP TỤC'),
      h('button', { class: 'btn ghost', onclick: () => modal(openSettings(() => (modalClose = null))) }, '⚙ CÀI ĐẶT'),
      h('button', { class: 'btn ghost', onclick: () => showHelp() }, '❓ CÁCH CHƠI'),
      h('button', { class: 'btn red', onclick: () => { resume(); net.send({ t: 'leave' }); } }, '✕ RỜI TRẬN'))));
  app.append(pauseEl);
}

document.addEventListener('pointerlockchange', () => refreshPrompt());

function buildTouch() {
  if (!game) return;
  const g = game;
  const knob = h('div', { class: 'knob' });
  const base = h('div', { class: 'base' }, knob);
  const zl = h('div', { class: 'zone zl' });
  const zr = h('div', { class: 'zone zr' });
  const btn = (label: string, cls: string, style: string) => h('button', { class: `tb ${cls}`, style }, label);
  const fire = btn('🔫', 'fire', 'right:18px;bottom:96px');
  const jump = btn('⤒', '', 'right:116px;bottom:18px');
  const reload = btn('R', 'small', 'right:24px;bottom:194px');
  const use = btn('🤝', '', 'right:116px;bottom:100px');
  const sg = btn(CLASSES[g.model.pred.cls].g.icon, 'small', 'right:196px;bottom:18px');
  const sx = btn(CLASSES[g.model.pred.cls].x.icon, 'small', 'right:196px;bottom:72px');
  const sq = btn(CLASSES[g.model.pred.cls].q.icon, 'small', 'right:24px;bottom:30px');
  const shop = btn('🛒', 'small', 'left:12px;top:180px');
  const pause = btn('⏸', 'small', 'left:12px;top:236px');
  const upW = btn('🔫⬆', 'small', 'left:64px;top:180px');
  const upH = btn('❤️⬆', 'small', 'left:64px;top:236px');
  touchUi = h('div', { class: 'touch', style: `--ts:${settings.touchScale}` }, zl, zr, base, fire, jump, reload, use, sg, sx, sq, shop, pause, upW, upH);
  app.append(touchUi);
  input.bindTouch(zl, zr, knob, base);
  input.holdButton(fire, (v) => (input.touchFire = v));
  input.holdButton(jump, (v) => (input.touchJump = v));
  input.holdButton(use, (v) => (input.touchUse = v));
  input.tapButton(reload, () => input.pressReload());
  input.tapButton(sg, () => g.pressSkill('g'));
  input.tapButton(sx, () => g.pressSkill('x'));
  input.tapButton(sq, () => g.pressSkill('q'));
  input.tapButton(shop, () => toggleShop());
  input.tapButton(pause, () => showPause());
  input.tapButton(upW, () => net.send({ t: 'buy', item: 'weapon' }));
  input.tapButton(upH, () => net.send({ t: 'buy', item: 'hp' }));
}

function endGame() {
  document.body.classList.remove('ingame');
  if (game) {
    game.destroy();
    game = null;
  }
  touchUi?.remove();
  touchUi = null;
  pauseEl?.remove();
  pauseEl = null;
  shopOpen = false;
}

/* ======================= TỔNG KẾT ======================= */
function showOver(m: Extract<SMsg, { t: 'over' }>) {
  closeModal();
  game?.stop();
  A.sfxGameOver();
  screen = 'over';
  touchUi?.remove();
  touchUi = null;
  pauseEl?.remove();
  pauseEl = null;
  const solo = !!room?.solo;
  const mine = m.board.find((e) => e.score === m.score && e.wave === m.wave && e.kills === m.kills) ?? null;
  const tb = h('table', { class: 'lb' }, h('tr', null, h('th', null, 'NGƯỜI CHƠI'), h('th', { class: 'n' }, 'HẠ'), h('th', { class: 'n' }, 'SÁT THƯƠNG'), h('th', { class: 'n' }, 'ĐỠ DẬY'), h('th', { class: 'n' }, 'GỤC'), h('th', { class: 'n' }, 'XU KIẾM')));
  const best = Math.max(...m.stats.map((s) => s.kills));
  for (const s of m.stats) {
    tb.append(h('tr', { class: s.idx === meIdx ? 'me' : '' },
      h('td', null, `${CLASS_ICON[s.cls]} ${s.name}${s.kills === best && m.stats.length > 1 ? ' 🏅' : ''}`),
      h('td', { class: 'n' }, s.kills), h('td', { class: 'n' }, fmt(s.dmg)), h('td', { class: 'n' }, s.revives), h('td', { class: 'n' }, s.downs), h('td', { class: 'n' }, fmt(s.earned))));
  }
  const isHost = room ? room.host === meIdx : true;
  const el = h('div', { class: 'over' }, h('div', { class: 'card' },
    h('h1', { class: 'ttl' }, solo ? 'BẠN ĐÃ GỤC!' : 'CẢ ĐỘI ĐÃ GỤC!'),
    m.rank > 0 ? h('div', { class: 'rank' }, `🏆 Hạng #${m.rank} bảng ${solo ? 'Một mình' : 'Đồng đội'}`) : null,
    h('div', { class: 'big3' },
      h('div', null, h('b', null, m.wave), h('span', null, 'ĐỢT ĐẠT TỚI')),
      h('div', null, h('b', null, fmt(m.score)), h('span', null, 'ĐIỂM ĐỘI')),
      h('div', null, h('b', null, m.kills), h('span', null, 'KHỈ BỊ HẠ')),
      h('div', null, h('b', null, timeStr(m.secs)), h('span', null, 'THỜI GIAN SỐNG'))),
    h('div', { class: 'cols' },
      h('div', null, h('h3', { style: 'margin:0 0 8px;font-size:13px;letter-spacing:.12em;color:var(--dim)' }, 'THÀNH TÍCH'), tb),
      h('div', null, h('h3', { style: 'margin:0 0 8px;font-size:13px;letter-spacing:.12em;color:var(--dim)' }, `TOP 10 ${solo ? 'MỘT MÌNH' : 'ĐỒNG ĐỘI'}`), boardTable(m.board, mine))),
    h('div', { class: 'row', style: 'margin-top:16px;justify-content:center' },
      h('button', { class: 'btn green big', onclick: () => net.send({ t: 'again' }) }, solo ? '↻ CHƠI LẠI' : isHost ? '↻ VỀ PHÒNG CHỜ' : '↻ VỀ PHÒNG CHỜ'),
      h('button', { class: 'btn ghost big', onclick: () => net.send({ t: 'leave' }) }, '⌂ VỀ SẢNH'))));
  app.append(el);
}

function goHome() {
  endGame();
  room = null;
  meIdx = -1;
  lastOver = null;
  net.send({ t: 'lb' });
  renderHome();
}

/* ======================= CẢNH NỀN SẢNH ======================= */
// khỉ trang trí nhảy múa quanh bàn thờ (chỉ ở client)
const demo = new GameModel(0, 0, 0, 0);
const demoTypes = [MK_NAU, MK_CHAY, MK_NEM, MK_NO, MK_TRANG, MK_DOT, MK_NAU, MK_NAU, MK_CHAY, MK_NAU, MK_NEM, MK_NAU];
let lastFrame = performance.now();
function demoFrame(now: number) {
  const t = now / 1000;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  demoTypes.forEach((type, i) => {
    const a = t * 0.25 + (i / demoTypes.length) * Math.PI * 2;
    const r = 6.5 + Math.sin(t * 0.7 + i) * 1.5;
    demo.rmVisible[i] = 1;
    demo.mType[i] = type;
    demo.mHp[i] = 255;
    demo.mSt[i] = Math.sin(t * 0.9 + i * 1.7) > 0.85 ? ST_WIND : ST_MOVE;
    demo.rmX[i] = Math.cos(a) * r;
    demo.rmZ[i] = Math.sin(a) * r;
    demo.rmYaw[i] = Math.atan2(-Math.sin(a), Math.cos(a));
    demo.rmSpeed[i] = 2.2;
  });
  const cam = stage.camera;
  cam.fov = 55;
  cam.updateProjectionMatrix();
  const ca = t * 0.05;
  cam.position.set(Math.cos(ca) * 19, 7.5, Math.sin(ca) * 19);
  cam.lookAt(0, 1.4, 0);
  stage.followShadow(0, 0);
  monkeys.update(demo, t, dt, cam.position, cam.quaternion);
  fx.update(null, dt, t);
  stage.update(t, dt);
  stage.render();
}

/* ======================= TRƯNG BÀY (?showcase — chỉ để xem/chụp nhân vật) ======================= */
const SHOW = new URLSearchParams(location.search).get('showcase');
let showcaseFrame: ((now: number) => void) | null = null;
if (SHOW !== null) {
  app.style.display = 'none';
  statusEl.style.display = 'none';
  const blob = blobTexture();
  // ?showcase=cast: cả 7 nhân vật đứng thành hàng
  const cast = SHOW === 'cast';
  const avs = (cast ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3]).map((c) => {
    const a = new Avatar(c, blob, c % 4);
    a.setTier(cast ? [3, 2, 4, 3, 2, 1, 0][c] : [1, 3, 0, 2][c]);
    stage.scene.add(a.root, a.blob);
    return a;
  });
  const show = new GameModel(0, 0, 0, 0);
  (window as any).__show = avs;
  const types = [MK_NAU, MK_CHAY, MK_NEM, MK_NO, MK_TRANG, MK_DOT, 7, 6];
  const states = [ST_MOVE, ST_MOVE, ST_THROW, 5, ST_MOVE, ST_WIND, ST_MOVE, 7];
  let last = performance.now();
  showcaseFrame = (now: number) => {
    const t = now / 1000;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const mode = SHOW || 'all';
    avs.forEach((a, i) => {
      const x = cast ? -4.5 + i * 1.5 : -3 + i * 2;
      const z = 6.5;
      // mỗi người một tư thế: chạy ngang, chạy lùi, nạp đạn, ngắm bắn
      const run = mode === 'run';
      const px = run ? x + Math.sin(t * 1.2 + i) * 0.8 : x;
      a.update({
        x: px, y: i === 3 && !run ? Math.max(0, Math.sin(t * 3)) * 0.6 : 0, z, yaw: Math.PI + Math.sin(t * 0.5 + i) * 0.5, pitch: -0.1,
        dt, t, down: mode === 'down' && i === 0 ? 1 : 0, ads: i === 2, sprint: false, brace: i === 3 && mode === 'skill',
        rage: false, reviving: mode === 'down' && i === 1, reload: i === 1 && mode !== 'down' ? (t * 0.5) % 1 : -1,
      });
      if (mode === 'skill' && Math.floor(t * 10) % 25 === 0) a.skill((['throw', 'build', 'ult', 'stomp'] as const)[i % 4]);
      if (Math.floor(t * 10) % 13 === 0) a.kick();
    });
    types.forEach((type, i) => {
      show.rmVisible[i] = 1;
      show.mType[i] = type;
      show.mHp[i] = 255;
      const moving = states[i] === ST_MOVE;
      show.mSt[i] = moving ? ST_MOVE : (states[i] + 0) | 0;
      show.rmX[i] = (i < 6 ? -6.2 + i * 2.5 : i === 6 ? -2.5 : 3) * (i < 6 ? 1 : 1);
      show.rmZ[i] = (i < 6 ? 10 : 12.3) + (moving ? Math.sin(t * 1.5 + i) * 0.4 : 0);
      show.rmYaw[i] = Math.PI + (moving ? 0.6 : 0);
      show.rmSpeed[i] = moving ? (type === MK_CHAY ? 6 : type === MK_DOT ? 2.6 : 3.4) : 0;
    });
    const cam = stage.camera;
    cam.fov = 45;
    cam.updateProjectionMatrix();
    const close = mode === 'close';
    if (mode === 'side') {
      cam.position.set(-6.5, 1.1, 6.5);
      cam.lookAt(0, 0.9, 6.5);
    } else if (mode === 'cast') {
      cam.position.set(0, 2.6, 1.2);
      cam.lookAt(0, 0.85, 6.5);
    } else if (mode === 'front') {
      cam.position.set(0, 1.25, 3.2);
      cam.lookAt(0, 0.95, 6.5);
    } else {
      cam.position.set(0, close ? 1.9 : 2.8, close ? 3.6 : 0.5);
      cam.lookAt(0, close ? 1.1 : 1.2, close ? 7 : 9);
    }
    stage.followShadow(0, 2);
    monkeys.update(show, t, dt, cam.position, cam.quaternion);
    fx.update(null, dt, t);
    stage.update(t, dt);
    stage.render();
  };
}

/* ======================= VÒNG LẶP ======================= */
function loop(now: number) {
  requestAnimationFrame(loop);
  try {
    if (game && (screen === 'game' || screen === 'over')) game.frame(now);
    else if (showcaseFrame) showcaseFrame(now);
    else demoFrame(now);
  } catch (e) {
    console.error(e);
  }
}
requestAnimationFrame(loop);

renderHome();
document.title = GAME_TITLE;
void lastOver;

// móc kiểm thử (headless/console): đọc trạng thái input + trận, không ảnh hưởng gameplay
(window as any).__monkey = { input, get game() { return game; } };
