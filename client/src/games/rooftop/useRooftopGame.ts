import { useCallback, useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import {
  F_ANCHOR,
  F_CHARGE,
  F_DODGE,
  F_DOWN,
  F_FALL,
  F_HELD,
  F_HOLD,
  F_LIFT,
  F_OUT,
  F_STUN,
  F_THROWN,
  newBody,
  stepBody,
  CHARGE_LEAD,
  type RtBody,
  type RtConfig,
} from '@shared/rooftop';
import type { GameProps } from '../types';

/** [x, y, z, face, cờ, vx, vy, wobble, grip] */
export type RtPos = number[];

export type RtFx =
  | { kind: 'fx'; k: string; a: string; b?: string; c?: string; x: number; y: number; z: number; hk?: string; idx?: number; counter?: boolean; force?: number; dx?: number; dy?: number; heavy?: boolean }
  | { kind: 'fall'; playerId: string; by: string; how: string }
  | { kind: 'out'; playerId: string };

export interface FeedItem {
  id: number;
  text: string;
  tone: 'fun' | 'info' | 'bad';
}

const HARD = F_DOWN | F_HELD | F_FALL | F_OUT | F_THROWN | F_LIFT | F_ANCHOR | F_HOLD | F_DODGE | F_CHARGE;
const PITCH_MIN = -0.17; // ~-10°
const PITCH_MAX = 0.78; // ~45°
const LOCK_RANGE = 10;
const LOCK_DROP = 16;
const ASSIST_RANGE = 2.4;
const ASSIST_ARC = 0.96; // ±55°
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * Trạng thái + điều khiển của ĐẤU VẬT TRÊN NÓC NHÀ.
 * Chuột xoay camera (Pointer Lock) · W A S D đi theo hướng camera · chuột trái đấm · chuột phải/E túm · Space nhảy/nhấc · Shift nhấc.
 * Vật lý do server chốt; client chỉ dự đoán vị trí của chính mình (cùng hàm stepBody với server) và nội suy người khác.
 */
export function useRooftopGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as RtConfig;
  const nameOf = useRef<Record<string, string>>({});
  nameOf.current = Object.fromEntries(players.map((p) => [p.id, p.name]));

  const positions = useRef<Record<string, RtPos>>({});
  const recvAt = useRef(0);
  const hold = useRef<Record<string, string>>({});
  const fx = useRef<RtFx[]>([]);
  const cam = useRef({ yaw: cfg.spawns[meId]?.[2] ?? 0, pitch: 0.25 });
  /** hướng thân = hướng đánh mong muốn (client tính, server nhận qua trường yaw) */
  const bodyYaw = useRef(cfg.spawns[meId]?.[2] ?? 0);
  const lockId = useRef('');
  const [lockName, setLockName] = useState('');
  const body = useRef<RtBody>(newBody(cfg.spawns[meId]?.[0] ?? 0, cfg.spawns[meId]?.[1] ?? 0));
  const synced = useRef(false);
  const lastPredict = useRef(0);

  const keys = useRef({ f: 0, b: 0, l: 0, r: 0, e: false, shift: false, rmb: false, dodgeHeld: false });
  const pulse = useRef({ jump: false, punch: false, dodge: false });
  const lmb = useRef<{ down: number; timer: number }>({ down: 0, timer: 0 });
  const chargeOn = useRef(false);
  const sent = useRef({ dx: 0, dy: 0, yaw: 0, grab: false, lift: false, charge: false, at: 0 });
  const mouseHeld = useRef(false);
  const locked = useRef(false);
  const lockFailed = useRef(false);
  const jumpLocal = useRef(-1e9);
  const el = useRef<HTMLElement | null>(null);
  const touchBtn = useRef({ grab: false });
  const enemies = () =>
    Object.entries(positions.current).filter(([id, p]) => id !== meId && !(p[4] & (F_OUT | F_FALL)));
  const angTo = (x: number, y: number) => Math.atan2(x - body.current.x, y - body.current.y);
  const distTo = (x: number, y: number) => Math.hypot(x - body.current.x, y - body.current.y);
  /** khoá mục tiêu kiểu Wukong: cycle=false chọn người gần nhất trong nón nhìn của camera; cycle=true chuyển sang người kế bên */
  const pickLock = (cycle: boolean) => {
    const c = enemies()
      .map(([id, p]) => ({ id, d: distTo(p[0], p[1]), delta: angDiff(cam.current.yaw, angTo(p[0], p[1])) }))
      .filter((e) => e.d <= LOCK_RANGE);
    if (!c.length) return '';
    if (cycle && lockId.current) {
      c.sort((a, b) => a.delta - b.delta);
      const i = c.findIndex((e) => e.id === lockId.current);
      return c[(i + 1) % c.length].id;
    }
    const cone = c.filter((e) => Math.abs(e.delta) < 1.2);
    const pool = cone.length ? cone : c;
    pool.sort((a, b) => a.d + Math.abs(a.delta) * 2 - (b.d + Math.abs(b.delta) * 2));
    return pool[0].id;
  };
  const toggleLock = (cycle = false) => {
    if (lockId.current && !cycle) lockId.current = '';
    else lockId.current = pickLock(cycle);
    setLockName(lockId.current ? nameOf.current[lockId.current] ?? '' : '');
  };
  /** hỗ trợ ngắm mềm: chỉ xoay HƯỚNG đánh về đối thủ gần nhất trong nón ±55° (không dịch nhân vật) */
  const assist = () => {
    const lk = lockId.current && positions.current[lockId.current];
    if (lk) {
      bodyYaw.current = angTo(lk[0], lk[1]);
      return;
    }
    let best: RtPos | null = null;
    let bd = ASSIST_RANGE;
    for (const [, p] of enemies()) {
      const d = distTo(p[0], p[1]);
      if (d < bd && Math.abs(angDiff(bodyYaw.current, angTo(p[0], p[1]))) < ASSIST_ARC) {
        best = p;
        bd = d;
      }
    }
    if (best) bodyYaw.current = angTo(best[0], best[1]);
  };
  /** chuột trái: nhấn nhanh = đấm nhanh; giữ lâu (sau CHARGE_LEAD ms) = tích lực, thả ra = đấm mạnh */
  const lmbDown = () => {
    if (lmb.current.down) return;
    lmb.current.down = performance.now();
    assist();
    lmb.current.timer = window.setTimeout(() => {
      assist();
      chargeOn.current = true;
      flushRef.current(true);
    }, CHARGE_LEAD);
  };
  const lmbUp = () => {
    if (!lmb.current.down) return;
    window.clearTimeout(lmb.current.timer);
    lmb.current.down = 0;
    assist();
    if (chargeOn.current) chargeOn.current = false;
    else pulse.current.punch = true;
    flushRef.current(true);
  };
  const flushRef = useRef<(force?: boolean) => void>(() => {});

  const [lockedUi, setLockedUi] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedId = useRef(1);
  const [shout, setShout] = useState<{ id: number; text: string } | null>(null);
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [hud, setHud] = useState({ alive: players.length, grip: 100, out: false, hold: false, held: false, down: false, winner: false });
  const aliveRef = useRef(players.length);
  const outRef = useRef(new Set<string>());

  const say = (text: string, tone: FeedItem['tone'] = 'fun') => {
    const id = feedId.current++;
    setFeed((f) => [...f.slice(-4), { id, text, tone }]);
    window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 5200);
  };
  const shoutBig = (text: string) => {
    const id = feedId.current++;
    setShout({ id, text });
    window.setTimeout(() => setShout((s) => (s && s.id === id ? null : s)), 1100);
  };
  const nm = (id?: string) => (id ? nameOf.current[id] ?? '???' : '???');

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.pos;
      hold.current = p.hold ?? {};
      recvAt.current = performance.now();
      const mine: RtPos | undefined = p.pos[meId];
      if (mine) {
        const b = body.current;
        const fl = mine[4];
        const err = Math.hypot(mine[0] - b.x, mine[1] - b.y);
        if (!synced.current || err > 2.4 || Math.abs(mine[2] - b.z) > 2) {
          b.x = mine[0];
          b.y = mine[1];
          b.z = mine[2];
          b.vx = mine[5];
          b.vy = mine[6];
          b.vz = 0;
          synced.current = true;
        } else if (!(fl & HARD) && err > 0.9) {
          b.x += (mine[0] - b.x) * 0.35;
          b.y += (mine[1] - b.y) * 0.35;
        }
      }
    } else if (p.type === 'fx') {
      fx.current.push({ kind: 'fx', k: p.k, a: p.a, b: p.b, c: p.c, x: p.x, y: p.y, z: p.z, hk: p.kind, idx: p.idx, counter: p.counter, force: p.force, dx: p.dx, dy: p.dy, heavy: p.heavy });
      switch (p.k) {
        case 'hit':
          if (p.counter) {
            shoutBig('PHẢN CÔNG!');
            say(`${nm(p.a)} phản công trúng ${nm(p.b)}!`);
          } else if (p.kind === 'heavy') {
            if (p.a === meId || p.b === meId) shoutBig('ĐẤM MẠNH!');
          } else if (p.idx === 2 && (p.a === meId || p.b === meId)) shoutBig('COMBO!');
          else if (p.b === meId) shoutBig('ÚI!');
          if (p.b === meId) sfx.miss();
          else if (p.a === meId) sfx.tick();
          break;
        case 'dodged':
          if (p.a === meId) shoutBig('NÉ!');
          else say(`${nm(p.a)} né cú đấm của ${nm(p.b)}!`, 'info');
          break;
        case 'whiff':
          say(`${nm(p.a)} đấm hụt, loạng choạng!`);
          if (p.a === meId) shoutBig('ĐẤM HỤT!');
          break;
        case 'grab':
          if (p.b === meId) shoutBig('BỊ TÚM!');
          break;
        case 'throw':
          say(`${nm(p.a)} quăng ${nm(p.b)}!`);
          if (p.b === meId) shoutBig('BAY NÀO!');
          break;
        case 'bowl':
          shoutBig('STRIKE!');
          say(`STRIKE! ${nm(p.a)} bay trúng ${nm(p.b)}`);
          break;
        case 'ledge':
          say(`${nm(p.a)} bám mép xe, suýt rơi!`, 'info');
          break;
        case 'free':
          say(`${nm(p.a)} vùng thoát khỏi ${nm(p.b)}`, 'info');
          break;
        case 'tired':
          say(`${nm(p.a)} mỏi tay, thả người ra`, 'info');
          break;
      }
    } else if (p.type === 'fall') {
      fx.current.push({ kind: 'fall', playerId: p.playerId, by: p.by, how: p.how });
      const who = nm(p.playerId);
      const by = nm(p.by);
      const how: string = p.how;
      if (how === 'self') {
        say(`${who} TỰ RƠI! 🤦`, 'bad');
        shoutBig('TỰ RƠI!');
      } else if (how === 'wrong') {
        say(`KÉO NHẦM! ${who} kéo ${by} rơi theo`, 'bad');
        shoutBig('KÉO NHẦM!');
      } else if (how === 'punch') say(`${by} đấm ${who} văng khỏi xe!`, 'bad');
      else if (how === 'throw') say(`${by} quăng ${who} xuống đường!`, 'bad');
      else if (how === 'bowl') say(`${who} bị ${by} làm "bowling" rơi!`, 'bad');
      else if (how === 'drag') say(`${by} kéo ${who} ra mép rồi... rơi!`, 'bad');
      if (p.playerId === meId) sfx.miss();
    } else if (p.type === 'out') {
      if (!outRef.current.has(p.playerId)) {
        outRef.current.add(p.playerId);
        aliveRef.current = Math.max(0, players.length - outRef.current.size);
      }
      fx.current.push({ kind: 'out', playerId: p.playerId });
    }
  });

  // nóc xe thu hẹp theo lịch cố định trong config: báo trước 3 giây
  useEffect(() => {
    const at = startAt + cfg.shrinkAt - 3000;
    const wait = at - net.now();
    if (wait < -3000) return;
    const id = window.setTimeout(() => {
      shoutBig('NÓC XE SẬP DẦN!');
      setBanner({ id: -1, text: 'NÓC XE SẮP SẬP DẦN TỪ MÉP VÀO · lan can biến mất, dồn về giữa!' });
      window.setTimeout(() => setBanner(null), 5000);
    }, Math.max(0, wait));
    return () => window.clearTimeout(id);
  }, [startAt, cfg.shrinkAt]);

  /* ---------- gửi input ---------- */
  const moveVec = () => {
    const k = keys.current;
    const fwd = k.f - k.b;
    const right = k.r - k.l;
    const yaw = cam.current.yaw; // di chuyển theo hướng CAMERA
    let dx = fwd * Math.sin(yaw) + right * Math.cos(yaw);
    let dy = fwd * Math.cos(yaw) - right * Math.sin(yaw);
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    return { dx, dy };
  };
  const grabNow = () => keys.current.e || keys.current.rmb || touchBtn.current.grab;
  const flush = useCallback(
    (force = false) => {
      const now = performance.now();
      const { dx, dy } = moveVec();
      const yaw = bodyYaw.current; // gửi hướng thân / hướng đánh
      const grab = grabNow();
      const lift = keys.current.shift;
      const s = sent.current;
      const pj = pulse.current.jump;
      const pp = pulse.current.punch;
      const pd = pulse.current.dodge;
      const changed =
        Math.abs(dx - s.dx) > 0.02 ||
        Math.abs(dy - s.dy) > 0.02 ||
        Math.abs(yaw - s.yaw) > 0.03 ||
        grab !== s.grab ||
        lift !== s.lift ||
        pj ||
        pp ||
        pd ||
        chargeOn.current !== !!s.charge;
      if (!force && !changed && now - s.at < 280) return;
      if (now - s.at < 38 && !force) return; // ≤ ~26 gói/giây
      net.input(gameId, {
        type: 'brawl',
        dx: Math.round(dx * 100) / 100,
        dy: Math.round(dy * 100) / 100,
        yaw: Math.round(yaw * 100) / 100,
        grab,
        lift,
        charge: chargeOn.current || undefined,
        dodge: pd || undefined,
        jump: pj || undefined,
        punch: pp || undefined,
      });
      pulse.current = { jump: false, punch: false, dodge: false };
      sent.current = { dx, dy, yaw, grab, lift, charge: chargeOn.current, at: now };
    },
    [gameId],
  );

  flushRef.current = flush;

  useEffect(() => {
    if (!live) return;
    const setKey = (code: string, on: boolean, e: KeyboardEvent) => {
      const k = keys.current;
      switch (code) {
        case 'KeyW':
        case 'ArrowUp':
          k.f = on ? 1 : 0;
          return true;
        case 'KeyS':
        case 'ArrowDown':
          k.b = on ? 1 : 0;
          return true;
        case 'KeyA':
        case 'ArrowLeft':
          k.l = on ? 1 : 0;
          return true;
        case 'KeyD':
        case 'ArrowRight':
          k.r = on ? 1 : 0;
          return true;
        case 'KeyE':
          if (on && !k.e) assist();
          k.e = on;
          return true;
        case 'Tab':
        case 'KeyF':
          if (on && !e.repeat) toggleLock(e.code === 'Tab');
          return true;
        case 'ControlLeft':
        case 'ControlRight':
        case 'KeyQ':
          if (on && !k.dodgeHeld) {
            pulse.current.dodge = true;
            flush();
          }
          k.dodgeHeld = on;
          return true;
        case 'ShiftLeft':
        case 'ShiftRight':
          k.shift = on;
          return true;
      }
      return false;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          pulse.current.jump = true;
          jumpLocal.current = performance.now();
          flush();
        }
        return;
      }
      if (setKey(e.code, true, e)) {
        e.preventDefault();
        flush();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (setKey(e.code, false, e)) flush();
    };
    const reset = () => {
      keys.current = { f: 0, b: 0, l: 0, r: 0, e: false, shift: false, rmb: false, dodgeHeld: false };
      lmbUp();
      touchBtn.current.grab = false;
      mouseHeld.current = false;
      flush(true);
    };
    const beat = window.setInterval(() => flush(), 40);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', reset);
      window.clearInterval(beat);
    };
  }, [live, flush]);

  /* ---------- chuột / cảm ứng trên khung game ---------- */
  const attach = useCallback(
    (host: HTMLElement | null) => {
      el.current = host;
      if (!host) return;
      const rotate = (dx: number, dy: number, k = 1) => {
        const c = cam.current;
        if (!lockId.current) {
          c.yaw += dx * 0.0026 * k; // đang khoá mục tiêu thì camera tự giữ sau lưng, chuột chỉ chỉnh độ cao
          if (c.yaw > Math.PI) c.yaw -= Math.PI * 2;
          if (c.yaw < -Math.PI) c.yaw += Math.PI * 2;
        }
        c.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, c.pitch + dy * 0.0021 * k));
      };
      const onLockError = () => {
        lockFailed.current = true; // không khoá được chuột: click vẫn đấm/túm, giữ nút + kéo chuột để xoay
        setLockedUi(true);
      };
      const onLockChange = () => {
        const on = document.pointerLockElement === host;
        locked.current = on;
        if (on) lockFailed.current = false;
        setLockedUi(on);
        if (!on) {
          keys.current.rmb = false;
          lmbUp();
          flush(true);
        }
      };
      const onMove = (e: MouseEvent) => {
        if (locked.current) rotate(e.movementX, e.movementY);
        else if (lockFailed.current && e.buttons !== 0) rotate(e.movementX, e.movementY);
      };
      const onDown = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        if (!locked.current && !lockFailed.current) {
          mouseHeld.current = true;
          try {
            const r = host.requestPointerLock?.() as unknown;
            if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
          } catch {
            /* không khoá được: vẫn kéo chuột để xoay */
          }
          return;
        }
        if (e.button === 1) {
          e.preventDefault();
          toggleLock();
        } else if (e.button === 0) {
          lmbDown();
        } else if (e.button === 2) {
          if (!keys.current.rmb) assist();
          keys.current.rmb = true;
          flush();
        }
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        mouseHeld.current = false;
        if (e.button === 0) lmbUp();
        if (e.button === 2) {
          keys.current.rmb = false;
          flush();
        }
      };
      const noMenu = (e: Event) => e.preventDefault();

      // cảm ứng: kéo ngón tay (không phải cần điều khiển / nút) để xoay camera
      let touchId = -1;
      let lx = 0;
      let ly = 0;
      const tDown = (e: PointerEvent) => {
        if (e.pointerType !== 'touch' || touchId !== -1) return;
        if ((e.target as HTMLElement).closest('.rt-tbtn')) return;
        touchId = e.pointerId;
        lx = e.clientX;
        ly = e.clientY;
      };
      const tMove = (e: PointerEvent) => {
        if (e.pointerId !== touchId) return;
        rotate(e.clientX - lx, e.clientY - ly, 1.5);
        lx = e.clientX;
        ly = e.clientY;
      };
      const tUp = (e: PointerEvent) => {
        if (e.pointerId === touchId) touchId = -1;
      };

      document.addEventListener('pointerlockchange', onLockChange);
      document.addEventListener('pointerlockerror', onLockError);
      document.addEventListener('mousemove', onMove);
      host.addEventListener('pointerdown', onDown);
      window.addEventListener('pointerup', onUp);
      host.addEventListener('contextmenu', noMenu);
      host.addEventListener('pointerdown', tDown);
      host.addEventListener('pointermove', tMove);
      window.addEventListener('pointerup', tUp);
      window.addEventListener('pointercancel', tUp);
      host.style.touchAction = 'none';
      return () => {
        document.removeEventListener('pointerlockchange', onLockChange);
        document.removeEventListener('pointerlockerror', onLockError);
        document.removeEventListener('mousemove', onMove);
        host.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        host.removeEventListener('contextmenu', noMenu);
        host.removeEventListener('pointerdown', tDown);
        host.removeEventListener('pointermove', tMove);
        window.removeEventListener('pointerup', tUp);
        window.removeEventListener('pointercancel', tUp);
        if (document.pointerLockElement === host) document.exitPointerLock();
      };
    },
    [flush],
  );
  const detach = useRef<(() => void) | null>(null);
  const bindHost = useCallback(
    (host: HTMLElement | null) => {
      detach.current?.();
      detach.current = (attach(host) as unknown as (() => void) | undefined) ?? null;
    },
    [attach],
  );

  useEffect(
    () => () => {
      detach.current?.();
      if (document.pointerLockElement) document.exitPointerLock();
    },
    [],
  );

  /** nút cảm ứng ĐẤM / TÚM */
  const touch = {
    punch: lmbDown,
    punchUp: lmbUp,
    dodge: () => {
      pulse.current.dodge = true;
      flush();
    },
    lock: () => toggleLock(false),
    grab: (on: boolean) => {
      if (on && !touchBtn.current.grab) assist();
      touchBtn.current.grab = on;
      flush();
    },
  };

  /** kiểu action RPG: thân tự quay theo hướng chạy (đứng yên thì giữ nguyên); khoá mục tiêu thì luôn nhìn mục tiêu */
  const updateBody = (dt: number) => {
    const me = positions.current[meId];
    if (!me || dt <= 0) return;
    if (lockId.current) {
      const t = positions.current[lockId.current];
      if (!t || t[4] & (F_OUT | F_FALL) || distTo(t[0], t[1]) > LOCK_DROP) {
        lockId.current = '';
        setLockName('');
      }
    }
    if (me[4] & (F_DOWN | F_HELD | F_FALL | F_OUT | F_THROWN)) {
      bodyYaw.current += angDiff(bodyYaw.current, me[3]) * Math.min(1, dt * 12); // server quyết hướng thân
      return;
    }
    const lk = lockId.current ? positions.current[lockId.current] : null;
    let want = bodyYaw.current;
    if (lk) {
      want = angTo(lk[0], lk[1]);
      const c = cam.current;
      c.yaw += angDiff(c.yaw, want) * (1 - Math.exp(-dt * 3.5)); // camera tự đứng sau lưng, hướng về mục tiêu
    } else {
      const { dx, dy } = moveVec();
      if (Math.hypot(dx, dy) > 0.1) want = Math.atan2(dx, dy);
    }
    bodyYaw.current += angDiff(bodyYaw.current, want) * Math.min(1, dt * 14);
    if (bodyYaw.current > Math.PI) bodyYaw.current -= Math.PI * 2;
    if (bodyYaw.current < -Math.PI) bodyYaw.current += Math.PI * 2;
  };

  /* ---------- dự đoán bản thân ---------- */
  const predict = (serverNow: number) => {
    const dtMs = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) : 0;
    lastPredict.current = serverNow;
    updateBody(dtMs / 1000);
    const mine = positions.current[meId];
    if (!synced.current || !mine || dtMs <= 0) return;
    const b = body.current;
    const fl = mine[4];
    const dt = dtMs / 1000;
    if (fl & HARD) {
      // trạng thái do server quyết: bám theo bản ghi mới nhất (có ngoại suy)
      const since = Math.min(0.12, (performance.now() - recvAt.current) / 1000);
      const tx = mine[0] + mine[5] * since;
      const ty = mine[1] + mine[6] * since;
      const k = 1 - Math.exp(-dt * 22);
      b.x += (tx - b.x) * k;
      b.y += (ty - b.y) * k;
      b.z += (mine[2] - b.z) * k;
      b.vx = mine[5];
      b.vy = mine[6];
      b.vz = 0;
      return;
    }
    const t = serverNow - startAt;
    if (t < 0) return;
    const steps = Math.ceil(dt / 0.034);
    const sdt = dt / steps;
    const { dx, dy } = moveVec();
    const stun = !!(fl & F_STUN);
    for (let i = 0; i < steps; i++) {
      const wantJump = performance.now() - jumpLocal.current < 150 && !stun;
      if (stepBody(cfg, b, dx, dy, sdt, { speedMul: stun ? 0.55 : 1, accelMul: stun ? 0.5 : 1, t, jump: wantJump })) jumpLocal.current = -1e9;
    }
  };

  /** vị trí hiển thị của một người */
  const posOf = (id: string) => {
    const p = positions.current[id];
    if (!p) return undefined;
    if (id === meId && synced.current && !(p[4] & F_OUT)) {
      const b = body.current;
      return { x: b.x, y: b.y, z: b.z, face: p[3], flags: p[4], vx: b.vx, vy: b.vy, wob: p[7] };
    }
    const since = Math.min(0.12, (performance.now() - recvAt.current) / 1000);
    return { x: p[0] + p[5] * since, y: p[1] + p[6] * since, z: p[2], face: p[3], flags: p[4], vx: p[5], vy: p[6], wob: p[7] };
  };

  // HUD gọn: vài lần mỗi giây
  useEffect(() => {
    const iv = window.setInterval(() => {
      const m = positions.current[meId];
      const fl = m ? m[4] : 0;
      const next = {
        alive: aliveRef.current,
        grip: m ? m[8] : 100,
        out: !!(fl & F_OUT) || outRef.current.has(meId),
        hold: !!(fl & F_HOLD),
        held: !!(fl & F_HELD),
        down: !!(fl & F_DOWN),
        winner: aliveRef.current <= 1 && !outRef.current.has(meId) && players.length > 1,
      };
      setHud((h) => (JSON.stringify(h) === JSON.stringify(next) ? h : next));
    }, 200);
    return () => window.clearInterval(iv);
  }, [meId, players.length]);

  return {
    cfg,
    startAt,
    positions,
    hold,
    fx,
    cam,
    bodyYaw,
    lockId,
    lockName,
    predict,
    posOf,
    serverNow: () => net.now(),
    bindHost,
    touch,
    locked: lockedUi,
    feed,
    shout,
    banner,
    hud,
    total: players.length,
  };
}

export type RooftopGameState = ReturnType<typeof useRooftopGame>;
