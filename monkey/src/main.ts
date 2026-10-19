// SINH TỒN BẦY KHỈ — bộ định tuyến màn hình: đăng nhập → sảnh (hub) / màn khách → phòng → trận → thắng | tổng kết.
// Các màn nằm trong ui/screens/*; file này giữ phần dùng chung: 3D nền, mạng, trận (toàn màn hình, chat, tạm dừng,
// cửa hàng, cảm ứng), cảnh trưng bày và vòng lặp.

import './styles.css';
import './ui/screens/screens.css';
import './ui/vltk.css';
import { GameModel } from '@shared/monkey/client';
import { CLASSES, MK_CHAY, MK_DOT, MK_NAU, MK_NEM, MK_NO, MK_TRANG } from '@shared/monkey/content';
import { GAME_TITLE } from '@shared/monkey/config';
import { ST_MOVE, ST_THROW, ST_WIND, type SMsg } from '@shared/monkey/proto';
import { P_U1, P_U2, P_W1, P_W2 } from '@shared/monkey/sim';
import { MAP_RANDOM, isMapChoice, setActiveMap } from '@shared/monkey/map';
import { STAGE_BY_ID } from '@shared/monkey/progression';
import { api, onMe, setLoggedOutHandler } from './api';
import * as A from './audio';
import { Game } from './game';
import { Input } from './input';
import { net } from './net';
import { Fx } from './render/fx';
import { Avatar } from './render/avatars';
import { MonkeyRenderer } from './render/monkeys';
import { Stage, blobTex as blobTexture, resolveQuality } from './render/scene';
import { onSettings, sessionGet, sessionSet, settings, store } from './settings';
import { h, toast } from './ui/dom';
import { openSettings } from './ui/settingsUi';
import { openShop } from './ui/shop';
import { Chat } from './ui/chat';
import { S, closeModal, confirmBox, modal, nav, send } from './ui/screens/ctx';
import { renderHome } from './ui/screens/home';
import { renderLogin } from './ui/screens/login';
import { hubWinOpen, renderHub } from './ui/screens/hub';
import { disposeCharsTab } from './ui/screens/hub/chars';
import { renderLobby } from './ui/screens/lobby';
import { clearResultTimers, showOver, showVictory, snapGear } from './ui/screens/results';
import { showHelp } from './ui/screens/help';

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
S.name = store('monkey-name') ?? '';
S.myCls = Number(store('monkey-cls') ?? 0) || 0;
if (!(S.myCls >= 0 && S.myCls < CLASSES.length)) S.myCls = 0;
S.myMap = store('monkey-map') ?? MAP_RANDOM;
if (!isMapChoice(S.myMap)) S.myMap = MAP_RANDOM;
S.pendingJoin = new URLSearchParams(location.search).get('room');
let game: Game | null = null;

/* ======================= ĐIỀU HƯỚNG ======================= */
/** rời sảnh: trả WebGL của khung xem 3D nhân vật */
function leaveHub() {
  disposeCharsTab();
}
/** màn "nhà" phù hợp: đã đăng nhập → sảnh, chưa → màn khách */
function goBase() {
  chat.clear();
  endGame();
  clearResultTimers();
  S.room = null;
  S.meIdx = -1;
  net.send({ t: 'lb' });
  if (api.loggedIn) {
    renderHub();
    api.refresh().catch(() => {});
  } else renderHome();
  input.enabled = false;
}

nav.login = () => { leaveHub(); input.enabled = false; renderLogin(); };
nav.home = () => { leaveHub(); input.enabled = false; renderHome(); };
nav.hub = (tab) => { input.enabled = false; renderHub(tab); };
nav.lobby = () => { leaveHub(); input.enabled = false; renderLobby(); };
nav.help = () => showHelp();
nav.settings = () => modal(openSettings(() => (S.modalClose = null)));
nav.goFullscreen = () => goFullscreen();
nav.toggleFullscreen = () => {
  fsDeclined = false;
  sessionSet('monkey-fs', 'yes');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
};
nav.logout = () => {
  confirmBox('Đăng xuất?', 'Bạn sẽ quay lại màn đăng nhập. Đồ đạc vẫn lưu trên máy chủ.', 'ĐĂNG XUẤT', async () => {
    await api.logout();
    wsToken = null;
    net.reconnect();
    toast('Đã đăng xuất', true);
    nav.login();
  });
};
setLoggedOutHandler(() => {
  wsToken = null;
  if (S.screen === 'hub') nav.login();
  toast('Phiên đăng nhập đã hết hạn — đăng nhập lại nhé');
});

/* ======================= MẠNG ======================= */
/** token đã gửi qua WS ({t:'auth'}) cho kết nối hiện tại */
let wsToken: string | null = null;
function syncWsAuth() {
  const t = api.token;
  if (!net.connected || !t || t === wsToken) return;
  wsToken = t;
  send({ t: 'auth', token: t });
}
onMe(() => syncWsAuth());

net.onStatus = (up) => {
  statusEl.className = `status${up ? ' up' : ''}`;
  statusText.textContent = up ? 'Đã kết nối máy chủ' : 'Đang kết nối…';
  if (!up) {
    wsToken = null;
    return;
  }
  // xác thực TRƯỚC khi vào lại phòng (server gắn tài khoản vào phiên)
  syncWsAuth();
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
};
net.onJson = (m) => {
  switch (m.t) {
    case 'welcome':
      return;
    case 'authed':
      S.authedName = m.username;
      return;
    case 'err':
      toast(m.m);
      if (m.m.includes('khôi phục') || m.m.includes('không còn')) {
        sessionSet('monkey-session', null);
        if (S.screen === 'lobby' || S.screen === 'game' || S.screen === 'over' || S.screen === 'victory') goBase();
      }
      return;
    case 'lb':
      S.lb = { solo: m.solo, team: m.team };
      if (S.screen === 'home') renderHome();
      else if (hubWinOpen('endless') && !S.modalClose) renderHub();
      return;
    case 'joined':
      S.meIdx = m.idx;
      sessionSet('monkey-session', JSON.stringify({ code: m.code, pid: m.pid, token: m.token }));
      return;
    case 'room':
      S.room = {
        code: m.code, phase: m.phase, solo: m.solo, host: m.host, players: m.players, map: m.map,
        mode: m.mode ?? 'endless', stage: m.stage || null, stages: Array.isArray(m.stages) ? m.stages : null,
      };
      if (m.phase === 'lobby' && m.map !== MAP_RANDOM) stage.setMap(m.map); // xem trước bản đồ làm nền sảnh
      if (m.phase === 'lobby' && !m.solo && S.screen !== 'lobby') {
        endGame();
        clearResultTimers();
        nav.lobby();
      } else if (S.screen === 'lobby') renderLobby();
      return;
    case 'start':
      setActiveMap(m.map);
      stage.setMap(m.map);
      if (m.stage) S.lastStage = m.stage;
      startGame(m);
      return;
    case 'chat':
      chat.add(m.i, m.n, m.m);
      if (!chat.isOpen) A.sfxUi();
      return;
    case 'paused':
      game?.model.resetClock();
      return;
    case 'over':
      stopForResults();
      showOver(m);
      return;
    case 'victory':
      stopForResults();
      showVictory(m);
      return;
    case 'left': {
      sessionSet('monkey-session', null);
      const after = S.afterLeave;
      S.afterLeave = null;
      goBase();
      if (after) after();
      return;
    }
  }
  game?.onJson(m);
};
net.onBin = (v) => game?.onBin(v);
net.connect();

const statusText = h('span', null, 'Đang kết nối…');
const statusEl = h('div', { class: 'status' }, h('span', { class: 'dot' }), statusText);
document.body.append(statusEl);

/* ======================= TRẬN ======================= */
let touchUi: HTMLElement | null = null;
let shopOpen = false;
let pauseEl: HTMLElement | null = null;

function startGame(msg: Extract<SMsg, { t: 'start' }>) {
  const players = msg.players;
  const stageId = msg.stage;
  const sdef = stageId ? STAGE_BY_ID[stageId] : undefined;
  closeModal();
  leaveHub();
  endGame();
  clearResultTimers();
  app.replaceChildren();
  S.screen = 'game';
  document.body.classList.add('ingame');
  snapGear();
  game = new Game({ stage, monkeys, fx }, input, players, S.meIdx, {
    economy: msg.economy !== false,
    waves: msg.waves ?? sdef?.waves,
    stageName: sdef ? (sdef.event ? sdef.name : `${sdef.id} ${sdef.name}`) : undefined,
    loot: msg.loot,
  });
  game.hud.onSystem = (t, c) => chat.system(t, c);
  game.onInspectKey = () => toggleInspect();
  if (!game.opts.economy) chat.system('Vượt ải: chỉ dùng đồ mang theo · gục hẳn = mất đồ (trừ Túi an toàn).', '#f2cc6a');
  // ải: độ khó + luật vào waveSpec phía client cho khớp server
  if (stageId && STAGE_BY_ID[stageId]) game.model.stage = STAGE_BY_ID[stageId];
  buildTouch();
  applyMode(input.touch);
  enterPlay();
}

/** hết trận (thua / thắng): dừng điều khiển, gỡ nút cảm ứng + tạm dừng; cảnh vẫn vẽ phía sau */
function stopForResults() {
  inspectExit?.();
  closeModal();
  game?.stop();
  touchUi?.remove();
  touchUi = null;
  pauseEl?.remove();
  pauseEl = null;
  shopOpen = false;
}

/* ---------- bắt buộc toàn màn hình + khoá chuột ---------- */
/** vào toàn màn hình sẵn từ sảnh (nút Bắt đầu / Sẵn sàng là cử chỉ người dùng) */
function goFullscreen() {
  if (fsDeclined) return;
  if (document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
/** người chơi bấm "Để sau" ở lời mời toàn màn hình → chơi trong cửa sổ, không ép nữa (nhớ trong phiên) */
let fsDeclined = sessionGet('monkey-fs') === 'no';
/** chưa từ chối thì cần toàn màn hình mới điều khiển (iPhone không hỗ trợ → bỏ qua) */
const fsOk = () => fsDeclined || !document.fullscreenEnabled || !!document.fullscreenElement;

/** lời mời toàn màn hình khi mới vào trang */
function askFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement || sessionGet('monkey-fs')) return;
  const el = h('div', { class: 'modal fsask' }, h('div', { class: 'card', style: 'width:min(420px,100%);text-align:center' },
    h('div', { style: 'font-size:46px;line-height:1' }, '⛶'),
    h('h2', { style: 'justify-content:center' }, 'CHƠI TOÀN MÀN HÌNH'),
    h('p', { style: 'color:var(--dim);margin-top:0' }, 'Để có trải nghiệm tốt nhất (khung nhìn rộng, chuột không lọt ra ngoài), hãy chơi ở chế độ toàn màn hình. Nhấn Esc để thoát bất cứ lúc nào.'),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('button', { class: 'btn green big', onclick: () => {
        sessionSet('monkey-fs', 'yes');
        fsDeclined = false;
        el.remove();
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      } }, '⛶ VÀO TOÀN MÀN HÌNH'),
      h('button', { class: 'btn ghost', onclick: () => {
        sessionSet('monkey-fs', 'no');
        fsDeclined = true;
        el.remove();
      } }, 'Để sau — chơi trong cửa sổ'))));
  document.body.append(el);
}
input.gate = fsOk;
const inGameFree = () => !!game && S.screen === 'game' && !pauseEl && !shopOpen && !S.modalClose;

/* ---------- chat (Enter) ---------- */
const chat = new Chat();
chat.onSend = (m) => net.send({ t: 'chat', m });
chat.onToggle = (open) => {
  if (!game || S.screen !== 'game') return;
  if (open) {
    // đang gõ: tắt điều khiển (chuột vẫn khoá, nhưng không bắn/chạy); Esc của trình duyệt cũng không mở menu tạm dừng
    input.enabled = false;
    input.resetKeys();
  } else if (!pauseEl && !shopOpen && !S.modalClose) {
    input.enabled = true;
    refreshPrompt();
  }
};
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || chat.isOpen || e.repeat) return;
  if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
  if (S.screen === 'lobby' && !S.modalClose) {
    e.preventDefault();
    chat.open();
  } else if (inGameFree()) {
    e.preventDefault();
    chat.open();
  }
}, true);

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
  if (!game || S.screen !== 'game') return;
  const free = !pauseEl && !shopOpen;
  if (free && !fsOk()) game.hud.setClickPrompt(true, '⛶ Bấm vào màn hình để vào TOÀN MÀN HÌNH và chơi');
  else game.hud.setClickPrompt(free && !input.touch && !document.pointerLockElement);
}

// bấm bất kỳ đâu trên màn chơi (kể cả lúc khoá chuột vừa bị trình duyệt từ chối) → vào lại
document.addEventListener('pointerdown', (e) => {
  if (!inGameFree() || game?.inspecting) return;
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
  if (!game || S.screen !== 'game') return;
  if (a === 'camera') { game.cycleCamera(); return; }
  if (a === 'inspect') { toggleInspect(); return; }
  if (a === 'shop') { if (game.opts.economy) toggleShop(); else game.hud.feed('🚫 Vượt ải không có cửa hàng — chỉ dùng đồ mang theo', 'bad'); }
  else if (a === 'scoresOn') game.hud.showScores(true, game.model);
  else if (a === 'scoresOff') game.hud.showScores(false, null);
  else if (a === 'pause') {
    // đang ngắm nghía: thoát chuột là chuyện bình thường, không tạm dừng
    if (game.inspecting) return;
    if (!shopOpen && !S.modalClose) showPause();
  }
};

/** ngắm nghía súng: nhả chuột để kéo xoay; I / Esc thoát */
function toggleInspect() {
  if (!game || S.screen !== 'game' || shopOpen || pauseEl || S.modalClose) return;
  const g = game;
  if (!g.inspecting) {
    g.setInspect(true);
    if (!g.inspecting) return;
    input.enabled = false;
    input.resetKeys();
    input.unlock();
    let lastX: number | null = null;
    const down = (e: PointerEvent) => { lastX = e.clientX; };
    const move = (e: PointerEvent) => { if (lastX !== null) { g.inspectDrag(e.clientX - lastX); lastX = e.clientX; } };
    const up = () => { lastX = null; g.inspectDrag(null); };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === settings.keys.inspect) { e.preventDefault(); e.stopPropagation(); exit(); }
    };
    const exit = () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', key, true);
      inspectExit = null;
      g.setInspect(false);
      if (game === g && S.screen === 'game') {
        input.enabled = true;
        enterPlay();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true);
    inspectExit = exit;
  } else inspectExit?.();
}
let inspectExit: (() => void) | null = null;

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
    S.modalClose = null;
    if (game && S.screen === 'game') {
      input.enabled = true;
      enterPlay();
    }
  }));
}

function showPause() {
  if (pauseEl || !game) return;
  input.enabled = false;
  input.resetKeys();
  const solo = S.room?.solo;
  if (solo) net.send({ t: 'pause', p: true });
  const resume = () => {
    if (solo) net.send({ t: 'pause', p: false });
    pauseEl?.remove();
    pauseEl = null;
    document.removeEventListener('keydown', onEsc, true);
    if (game && S.screen === 'game') {
      input.enabled = true;
      enterPlay();
    }
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && !S.modalClose) { e.preventDefault(); resume(); }
  };
  document.addEventListener('keydown', onEsc, true);
  pauseEl = h('div', { class: 'modal' }, h('div', { class: 'card', style: 'width:min(380px,100%);text-align:center' },
    h('h2', { style: 'justify-content:center' }, 'TẠM DỪNG'),
    h('p', { style: 'color:var(--dim);margin-top:0' }, solo ? 'Trận đã dừng lại — khỉ đứng im chờ bạn.' : 'Trận vẫn tiếp diễn với đồng đội (chơi nhiều người không dừng được).'),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('button', { class: 'btn green big', onclick: resume }, '▶ TIẾP TỤC'),
      h('button', { class: 'btn ghost', onclick: () => nav.settings() }, '⚙ CÀI ĐẶT'),
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
  const knife = btn('🔪', 'small', 'right:196px;bottom:126px');
  const eco = g.opts.economy;
  const shop = btn(eco ? '🛒' : '⇄', 'small', 'left:12px;top:180px');
  const pause = btn('⏸', 'small', 'left:12px;top:236px');
  const upW = btn(eco ? '🔫⬆' : '3', 'small', 'left:64px;top:180px');
  const upH = btn(eco ? '❤️⬆' : '4', 'small', 'left:64px;top:236px');
  const camB = btn('🎥', 'small', 'left:116px;top:236px');
  touchUi = h('div', { class: 'touch', style: `--ts:${settings.touchScale}` }, zl, zr, base, fire, jump, reload, use, sg, sx, sq, knife, shop, pause, upW, upH, camB);
  app.append(touchUi);
  input.bindTouch(zl, zr, knob, base);
  input.holdButton(fire, (v) => (input.touchFire = v));
  input.holdButton(jump, (v) => (input.touchJump = v));
  input.holdButton(use, (v) => (input.touchUse = v));
  input.tapButton(reload, () => input.pressReload());
  input.tapButton(sg, () => g.pressSkill('g'));
  input.tapButton(sx, () => g.pressSkill('x'));
  input.tapButton(sq, () => g.pressSkill('q'));
  input.tapButton(knife, () => g.pressKnife());
  input.tapButton(pause, () => showPause());
  input.tapButton(camB, () => g.cycleCamera());
  if (eco) {
    input.tapButton(shop, () => toggleShop());
    input.tapButton(upW, () => net.send({ t: 'buy', item: 'weapon' }));
    input.tapButton(upH, () => net.send({ t: 'buy', item: 'hp' }));
  } else {
    input.tapButton(shop, () => input.press(g.model.pred.wslot === 0 ? P_W2 : P_W1));
    input.tapButton(upW, () => input.press(P_U1));
    input.tapButton(upH, () => input.press(P_U2));
  }
}

function endGame() {
  inspectExit?.();
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
  // ?showcase=cast: cả 7 nhân vật đứng thành hàng; ?showcase=gear: mặc thử đồ
  const cast = SHOW === 'cast' || SHOW === 'gear';
  const gear = SHOW === 'gear';
  const looks = [
    { helmet: 'h_tre', armor: 'a_vai', knife: 'k_gam' }, { helmet: 'h_sat', armor: 'a_da', gun: 'g_ranlua' }, { helmet: 'h_ky', armor: 'a_thep', skin: 's_dem' },
    { helmet: 'h_xathu', armor: 'a_tre', knife: 'k_lua' }, { helmet: 'h_chuoi', skin: 's_vang', gun: 'g_vang' }, { skin: 's_hong', knife: 'k_matau' }, { skin: 's_rung', armor: 'a_thep', knife: 'k_tre' },
  ];
  const avs = (cast ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3]).map((c) => {
    const a = new Avatar(c, blob, c % 4, gear ? looks[c] : null);
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
      if (gear && Math.floor(t * 10 + i * 3) % 30 === 0) a.slash();
      if (Math.floor(t * 10) % 13 === 0) a.kick();
    });
    types.forEach((type, i) => {
      show.rmVisible[i] = 1;
      show.mType[i] = type;
      show.mHp[i] = 255;
      const moving = states[i] === ST_MOVE;
      show.mSt[i] = moving ? ST_MOVE : (states[i] + 0) | 0;
      show.rmX[i] = i < 6 ? -6.2 + i * 2.5 : i === 6 ? -2.5 : 3;
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
    } else if (mode === 'cast' || mode === 'gear') {
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
  const sc = S.screen;
  chat.setVisible(sc === 'lobby' || sc === 'game' || sc === 'over' || sc === 'victory');
  try {
    if (game && (sc === 'game' || sc === 'over' || sc === 'victory')) game.frame(now);
    else if (showcaseFrame) showcaseFrame(now);
    else demoFrame(now);
  } catch (e) {
    console.error(e);
  }
}
requestAnimationFrame(loop);

/* ======================= KHỞI ĐỘNG ======================= */
if (api.loggedIn) renderHub();
else renderLogin(S.pendingJoin ? `Bạn được mời vào phòng ${S.pendingJoin.toUpperCase()} — đăng nhập hoặc chơi khách để vào.` : undefined);
if (SHOW === null) askFullscreen();
document.title = GAME_TITLE;

// móc kiểm thử (headless/console): đọc trạng thái input + trận, không ảnh hưởng gameplay
(window as any).__monkey = { input, get game() { return game; }, api, S };
