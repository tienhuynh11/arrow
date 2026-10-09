import type { GameDefinition, PlayerResult } from './types.js';
import type { GameInput } from '../../../shared/protocol.js';

interface Config {
  /** bề ngang đường chạy (x ∈ [-w/2, w/2]); y là quãng đã chạy, 0 → finishY */
  w: number;
  cols: number;
  doorW: number;
  rows: number;
  rowY: number[];
  /** nửa bề dày của một hàng cửa */
  half: number;
  finishY: number;
  speed: number;
  radius: number;
  knock: number;
  stun: number;
  endsAt: number;
  spawns: Record<string, [number, number]>;
}

interface PState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  moveAt: number;
  stunUntil: number;
  /** giờ về đích (ms từ lúc bắt đầu), 0 = chưa về */
  finishedAt: number;
  /** số hàng cửa đã vượt qua hẳn */
  passed: number;
  /** điểm cạnh tranh (qua hàng cửa sớm) */
  pts: number;
  /** hết giờ tăng tốc của người tìm ra cửa */
  boostUntil: number;
}

interface State {
  /** BÍ MẬT: cửa nào là cửa thật — chỉ server biết, không bao giờ nằm trong config */
  real: boolean[];
  /** cửa thật đã bị ai đó đẩy mở (mở cho tất cả) */
  open: boolean[];
  /** giờ (ms tuyệt đối) cửa thật tự đóng sầm lại */
  openUntil: number[];
  /** cửa giả đã có người thử (gợi ý cho người đang tụt lùi); xoá khi hàng đó đổi cửa thật */
  tried: boolean[];
  /** mỗi hàng đã có bao nhiêu người qua */
  rowPassed: number[];
  players: Record<string, PState>;
  firstFinish: number;
  dirty: boolean;
  lastTick: number;
  lastBroadcast: number;
  lastSnap: number;
}

const COLS = 6;
const REAL_PER_ROW = 1;
const DOOR_W = 12;
const W = COLS * DOOR_W;
const ROWS = 8;
const FIRST_ROW = 70;
const ROW_GAP = 75;
const HALF = 2.5;
const RADIUS = 3;
const SPEED = 28;
const KNOCK = 16;
const STUN_MS = 550;
/** cửa thật chỉ mở chừng này ms rồi đóng sầm và đổi chỗ */
const OPEN_MS = 3200;
const PASS_PTS = [3, 2, 1];
const FIND_PTS = 1;
const BOOST_MS = 2500;
const BOOST_MUL = 1.35;
/** tụt lùi từ chừng này hàng so với người dẫn đầu thì được hỗ trợ */
const BEHIND_ROWS = 2;
const BEHIND_SPEED = 1.12;
const BEHIND_STUN = 0.6;
const SHOVE = 5;
const SLAM_R = 5;
const HOLD_TIMEOUT = 900;
const DURATION = 75_000;
/** có người về đích rồi thì những người còn lại chỉ còn chừng này giây */
const LAST_CALL_MS = 25_000;
const FINISH_Y = FIRST_ROW + (ROWS - 1) * ROW_GAP + 55;

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const colOf = (x: number) => Math.max(0, Math.min(COLS - 1, Math.floor((x + W / 2) / DOOR_W)));

export const doorDashGame: GameDefinition<Config, State> = {
  id: 'door',
  name: 'CỬA BÍ MẬT',
  instructions:
    'Mỗi hàng chỉ MỘT cửa thật, mở được vài giây rồi đóng sầm và đổi chỗ; cửa giả văng bạn lại và choáng cả người đứng gần. người tìm ra cửa được +1 điểm và tăng tốc 2,5s, ai tụt lùi 2 hàng thì chạy nhanh hơn. Qua hàng sớm được 3/2/1 điểm, chạm nhau sẽ bị húc; nhiều điểm và về đích sớm thắng.',
  controls: [{ keys: ['←', '↑', '→', '↓'], desc: 'Giữ để chạy · đâm cửa để thử, cửa thật chỉ mở vài giây · húc người khác để chen' }],
  duration: DURATION + 1500,
  minPlayers: 1,
  maxPlayers: 16,

  createConfig(ctx) {
    const n = ctx.playerIds.length;
    // xếp hàng ngang ở vạch xuất phát, tối đa 8 người một hàng
    const perRow = Math.min(8, n);
    const spacing = Math.min(9, (W - 14) / Math.max(1, perRow - 1 || 1));
    const spawns: Record<string, [number, number]> = {};
    shuffle([...ctx.playerIds]).forEach((id, i) => {
      const r = Math.floor(i / 8);
      const inRow = Math.min(8, n - r * 8);
      const c = i % 8;
      spawns[id] = [(c - (inRow - 1) / 2) * spacing, 8 + r * 8];
    });
    return {
      w: W,
      cols: COLS,
      doorW: DOOR_W,
      rows: ROWS,
      rowY: Array.from({ length: ROWS }, (_, i) => FIRST_ROW + i * ROW_GAP),
      half: HALF,
      finishY: FINISH_Y,
      speed: SPEED,
      radius: RADIUS,
      knock: KNOCK,
      stun: STUN_MS,
      endsAt: DURATION,
      spawns,
    };
  },

  createState(ctx, config) {
    // mỗi hàng đúng REAL_PER_ROW cửa thật, vị trí ngẫu nhiên
    const real: boolean[] = [];
    for (let r = 0; r < ROWS; r++) {
      const row = shuffle(Array.from({ length: COLS }, (_, c) => c < REAL_PER_ROW));
      real.push(...row);
    }
    const players: Record<string, PState> = {};
    for (const id of ctx.playerIds) {
      const [x, y] = config.spawns[id];
      players[id] = { x, y, dx: 0, dy: 0, moveAt: 0, stunUntil: 0, finishedAt: 0, passed: 0, pts: 0, boostUntil: 0 };
    }
    return {
      real,
      open: new Array(ROWS * COLS).fill(false),
      openUntil: new Array(ROWS * COLS).fill(0),
      tried: new Array(ROWS * COLS).fill(false),
      rowPassed: new Array(ROWS).fill(0),
      players,
      firstFinish: 0,
      dirty: true,
      lastTick: ctx.startAt,
      lastBroadcast: 0,
      lastSnap: 0,
    };
  },

  handleInput(ctx, state, _config, playerId, input: GameInput) {
    if (input.type !== 'moveXY') return;
    const p = state.players[playerId];
    if (!p || p.finishedAt) return;
    p.dx = Math.max(-1, Math.min(1, Math.round(Number(input.dx) || 0)));
    // dy > 0 = chạy về phía đích
    p.dy = Math.max(-1, Math.min(1, Math.round(Number(input.dy) || 0)));
    p.moveAt = ctx.now();
  },

  update(ctx, state, config) {
    const now = ctx.now();
    const rel = now - ctx.startAt;
    const dt = Math.min(now - state.lastTick, 200) / 1000;
    state.lastTick = now;
    const { w, radius: R, half } = config;
    const maxX = w / 2 - R;

    /** hàng cửa đang chắn nếu đứng ở (x, y) */
    const blockedRow = (x: number, y: number) => {
      for (let r = 0; r < config.rows; r++) {
        const front = config.rowY[r] - half - R;
        const back = config.rowY[r] + half + R;
        if (y > front && y < back && !state.open[r * COLS + colOf(x)]) return r;
      }
      return -1;
    };

    // cửa thật hết giờ: đóng sầm, đổi sang cột khác trong hàng, người kẹt trong khung bị đẩy ra
    for (let slot = 0; slot < state.open.length; slot++) {
      if (!state.open[slot] || now < state.openUntil[slot]) continue;
      const r = Math.floor(slot / COLS);
      const c = slot % COLS;
      state.open[slot] = false;
      state.real[slot] = false;
      let nc = Math.floor(Math.random() * (COLS - 1));
      if (nc >= c) nc++;
      state.real[r * COLS + nc] = true;
      for (let i = 0; i < COLS; i++) state.tried[r * COLS + i] = false;
      state.dirty = true;
      ctx.broadcast({ type: 'shut', row: r, col: c });
      for (const id of ctx.playerIds) {
        const p = state.players[id];
        if (p.finishedAt || colOf(p.x) !== c) continue;
        const front = config.rowY[r] - half - R;
        const back = config.rowY[r] + half + R;
        if (p.y <= front || p.y >= back) continue;
        if (p.y >= config.rowY[r]) p.y = back + 0.05;
        else {
          p.y = Math.max(0, front - 0.05);
          p.stunUntil = now + config.stun;
          p.dx = p.dy = 0;
        }
      }
    }

    const lead = Math.max(...ctx.playerIds.map((i) => state.players[i].passed));
    const mulOf = (p: PState) => (now < p.boostUntil ? BOOST_MUL : 1) * (lead - p.passed >= BEHIND_ROWS ? BEHIND_SPEED : 1);

    for (const id of ctx.playerIds) {
      const p = state.players[id];
      if (p.finishedAt || now < ctx.startAt) continue;
      if (now < p.stunUntil) continue;

      if (now - p.moveAt > HOLD_TIMEOUT) {
        p.dx = 0;
        p.dy = 0;
      }
      if (dt <= 0 || (p.dx === 0 && p.dy === 0)) continue;
      const len = Math.hypot(p.dx, p.dy) || 1;
      const sp = config.speed * mulOf(p);
      const nx = Math.max(-maxX, Math.min(maxX, p.x + (p.dx / len) * sp * dt));
      const ny = Math.max(0, p.y + (p.dy / len) * sp * dt);

      if (blockedRow(nx, ny) < 0) {
        p.x = nx;
        p.y = ny;
      } else {
        const r = blockedRow(p.x, ny);
        if (r >= 0) {
          const front = config.rowY[r] - half - R;
          // chỉ "đâm" cửa khi đang chạy tới từ phía trước
          if (p.dy > 0 && p.y <= front + 0.001) {
            p.y = front - 0.01;
            const c = colOf(p.x);
            const slot = r * COLS + c;
            if (state.real[slot]) {
              state.open[slot] = true;
              state.openUntil[slot] = now + OPEN_MS;
              // người tìm ra cửa: tăng tốc ngắn + điểm thưởng
              p.boostUntil = now + BOOST_MS;
              p.pts += FIND_PTS;
              state.dirty = true;
              ctx.broadcast({ type: 'door', row: r, col: c, by: id, ms: OPEN_MS, boost: BOOST_MS, pts: FIND_PTS });
            } else {
              p.y = Math.max(0, p.y - config.knock);
              p.stunUntil = now + config.stun * (lead - p.passed >= BEHIND_ROWS ? BEHIND_STUN : 1);
              state.tried[slot] = true;
              state.dirty = true;
              p.dx = p.dy = 0;
              ctx.broadcast({ type: 'bump', row: r, col: c, by: id });
              // cửa giả đóng sầm: người đứng sát bên cũng bị hất lùi và choáng nhẹ
              for (const oid of ctx.playerIds) {
                const o = state.players[oid];
                if (oid === id || o.finishedAt || now < o.stunUntil) continue;
                if (Math.abs(o.x - p.x) < SLAM_R && o.y > p.y - 2 && o.y < p.y + SLAM_R) {
                  o.y = Math.max(0, o.y - SHOVE);
                  o.stunUntil = now + config.stun / 2;
                  o.dx = o.dy = 0;
                }
              }
            }
          }
          // trượt dọc theo cửa
          if (blockedRow(nx, p.y) < 0) p.x = nx;
        } else {
          p.y = ny; // chỉ bị chặn khi đi ngang (đang đứng trong khung cửa)
        }
      }

      while (p.passed < config.rows && p.y > config.rowY[p.passed] + half + R) {
        const r = p.passed++;
        const rank = state.rowPassed[r]++;
        const pts = PASS_PTS[rank] ?? 0;
        if (pts) {
          p.pts += pts;
          ctx.broadcast({ type: 'pass', playerId: id, row: r, pts });
        }
      }

      if (p.y >= config.finishY) {
        p.y = config.finishY;
        p.finishedAt = Math.max(1, rel);
        p.dx = p.dy = 0;
        if (!state.firstFinish) state.firstFinish = now;
        ctx.broadcast({ type: 'finish', playerId: id, at: p.finishedAt });
      }
    }

    // húc nhau: hai người chồng lên nhau thì bị tách ra, người đang lao tới đẩy mạnh hơn
    const ids = ctx.playerIds.filter((i) => !state.players[i].finishedAt);
    const D = R * 1.6;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = state.players[ids[i]];
        const b = state.players[ids[j]];
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const d = Math.hypot(ex, ey);
        if (d >= D) continue;
        const ux = d > 0.001 ? ex / d : i % 2 ? 1 : -1;
        const uy = d > 0.001 ? ey / d : 0;
        const push = D - d;
        const aMov = a.dx !== 0 || a.dy !== 0;
        const bMov = b.dx !== 0 || b.dy !== 0;
        const wa = aMov && !bMov ? 0.15 : bMov && !aMov ? 0.85 : 0.5;
        const movePlayer = (p: PState, mx: number, my: number) => {
          const nx = Math.max(-maxX, Math.min(maxX, p.x + mx));
          const ny = Math.max(0, p.y + my);
          if (blockedRow(nx, ny) < 0) {
            p.x = nx;
            p.y = ny;
          } else if (blockedRow(nx, p.y) < 0) p.x = nx;
          else if (blockedRow(p.x, ny) < 0) p.y = ny;
        };
        // wa = phần dịch của a (người lao vào thì ít bị đẩy hơn)
        movePlayer(a, -ux * push * wa, -uy * push * wa);
        movePlayer(b, ux * push * (1 - wa), uy * push * (1 - wa));
      }
    }

    if (now - state.lastBroadcast < 60) return;
    state.lastBroadcast = now;
    const positions: Record<string, { x: number; y: number; s: boolean; f: number; p: number; k: number; b: boolean }> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      positions[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, s: now < p.stunUntil, f: p.finishedAt, p: p.pts, k: Math.round(mulOf(p) * 100) / 100, b: lead - p.passed >= BEHIND_ROWS };
    }
    const payload: Record<string, unknown> = { type: 'pos', positions };
    // cửa nào đang mở chỉ gửi khi đổi (và nhắc lại mỗi giây cho ai vào lại giữa ván)
    if ((state.dirty && now - state.lastSnap > 100) || now - state.lastSnap > 1000) {
      payload.open = state.open.map((o) => (o ? '1' : '0')).join('');
      payload.tried = state.tried.map((o) => (o ? '1' : '0')).join('');
      state.dirty = false;
      state.lastSnap = now;
    }
    ctx.broadcast(payload);
  },

  isFinished(ctx, state, config) {
    const now = ctx.now();
    if (now - ctx.startAt >= config.endsAt) return true;
    if (state.firstFinish && now - state.firstFinish >= LAST_CALL_MS) return true;
    return ctx.playerIds.every((id) => state.players[id].finishedAt > 0);
  },

  calculateScore(ctx, state, config) {
    const out: Record<string, PlayerResult> = {};
    for (const id of ctx.playerIds) {
      const p = state.players[id];
      const base = p.pts * 1500;
      if (p.finishedAt) {
        out[id] = {
          raw: base + 8000 + Math.max(0, Math.floor((90_000 - p.finishedAt) / 10)),
          detail: `${p.pts} điểm cửa · về đích sau ${(p.finishedAt / 1000).toFixed(1)}s`,
        };
      } else {
        out[id] = { raw: base + Math.floor(p.y), detail: `${p.pts} điểm cửa · qua ${p.passed}/${config.rows} hàng` };
      }
    }
    return out;
  },
};
