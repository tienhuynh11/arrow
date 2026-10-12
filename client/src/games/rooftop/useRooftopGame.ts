import { useCallback, useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import {
  F_CAST,
  F_DOWN,
  F_OUT,
  F_STUN,
  RT_CHARS,
  SB_DASH,
  SB_HASTE,
  SB_PECK,
  SB_RAGE,
  SB_SPIN,
  CAST_MOVE_MUL,
  newBody,
  stepBody,
  type RtBody,
  type RtConfig,
} from '@shared/rooftop';
import type { GameProps } from '../types';

/** [x, y, z, face, cờ, vx, vy, wobble, hp, cd1(×0,1s), cd2, trạng thái kỹ năng] */
export type RtPos = number[];

/** sự kiện từ server cho cảnh 3D (fx: k = loại, a = người gây, b = người dính, còn lại tuỳ loại) */
export type RtFx = { kind: 'fx'; k: string; a: string; x: number; y: number; z: number; [key: string]: any } | { kind: 'out'; playerId: string; x?: number; y?: number };

export interface FeedItem {
  id: number;
  text: string;
  tone: 'fun' | 'info' | 'bad';
}

export interface BananaPos {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
  born: number;
}

const HARD = F_DOWN | F_OUT;
const PITCH_MIN = -0.17; // ~-10°
const PITCH_MAX = 0.78; // ~45°
const LOCK_RANGE = 10;
const LOCK_DROP = 16;
const ASSIST_RANGE = 2.4;
const ASSIST_ARC = 0.96; // ±55°
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * Trạng thái + điều khiển của ĐẤU VẬT TRÊN NÓC NHÀ (camera kiểu action RPG).
 * Chuột xoay camera quanh nhân vật · W A S D đi theo hướng camera, thân tự quay theo hướng chạy · chuột trái đánh thường ·
 * R / X (hoặc 1 / 2) kỹ năng · Space nhảy · chuột giữa / Tab khoá mục tiêu.
 * Vật lý do server chốt; client chỉ dự đoán vị trí của chính mình (cùng hàm stepBody với server) và nội suy người khác.
 */
export function useRooftopGame({ gameId, config, startAt, players, meId, live }: GameProps) {
  const cfg = config as RtConfig;
  const nameOf = useRef<Record<string, string>>({});
  nameOf.current = Object.fromEntries(players.map((p) => [p.id, p.name]));

  const positions = useRef<Record<string, RtPos>>({});
  const recvAt = useRef(0);
  const fx = useRef<RtFx[]>([]);
  const cam = useRef({ yaw: cfg.spawns[meId]?.[2] ?? 0, pitch: 0.25 });
  /** hướng thân = hướng đánh mong muốn (client tính, server nhận qua trường yaw) */
  const bodyYaw = useRef(cfg.spawns[meId]?.[2] ?? 0);
  const lockId = useRef('');
  const [lockName, setLockName] = useState('');
  const body = useRef<RtBody>(newBody(cfg.spawns[meId]?.[0] ?? 0, cfg.spawns[meId]?.[1] ?? 0));
  const synced = useRef(false);
  const lastPredict = useRef(0);
  const bananas = useRef(new Map<number, BananaPos>());
  /** dấu thời gian đánh / skill của chính mình để cảnh 3D ra đòn ngay (không chờ server) */
  const stamps = useRef<{ punch: number; skill: number; which: 1 | 2 }>({ punch: 0, skill: 0, which: 1 });
  const myChar = RT_CHARS[cfg.chars[meId] ?? 0];

  const keys = useRef({ f: 0, b: 0, l: 0, r: 0 });
  const pulse = useRef({ jump: false, punch: false, skill1: false, skill2: false });
  const sent = useRef({ dx: 0, dy: 0, yaw: 0, at: 0 });
  const locked = useRef(false);
  const lockFailed = useRef(false);
  const jumpLocal = useRef(-1e9);
  const flushRef = useRef<(force?: boolean) => void>(() => {});

  const [lockedUi, setLockedUi] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedId = useRef(1);
  const [shout, setShout] = useState<{ id: number; text: string } | null>(null);
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [hud, setHud] = useState({ alive: players.length, out: false, winner: false, hp: myChar.hp, maxHp: myChar.hp, cd1: 0, cd2: 0 });
  const [intro, setIntro] = useState(true);
  const [pressure, setPressure] = useState(false);
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

  /* ---------- khoá mục tiêu + ngắm mềm ---------- */
  const enemies = () => Object.entries(positions.current).filter(([id, p]) => id !== meId && !(p[4] & F_OUT));
  const angTo = (x: number, y: number) => Math.atan2(x - body.current.x, y - body.current.y);
  const distTo = (x: number, y: number) => Math.hypot(x - body.current.x, y - body.current.y);
  /** cycle=false chọn người gần nhất trong nón nhìn của camera; cycle=true chuyển sang người kế bên */
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

  useGameEvents(gameId, (p) => {
    if (p.type === 'pos') {
      positions.current = p.pos;
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
      fx.current.push({ ...p, kind: 'fx' });
      switch (p.k) {
        case 'hit':
          if (p.counter) {
            shoutBig('PHẢN CÔNG!');
            say(`${nm(p.a)} phản công trúng ${nm(p.b)}!`);
          } else if (p.tag === 'link' && p.a === meId) shoutBig('NỐI CHIÊU!');
          else if (p.idx === 2 && p.kind === 'quick' && (p.a === meId || p.b === meId)) shoutBig('COMBO!');
          else if (p.b === meId) shoutBig('ÚI!');
          if (p.b === meId) sfx.miss();
          else if (p.a === meId) sfx.tick();
          break;
        case 'skill': {
          const ch = RT_CHARS.find((c) => c.id === p.ch);
          const sk = ch?.skills[(p.s ?? 1) - 1];
          if (sk) say(`${ch!.emoji} ${nm(p.a)}: ${sk.name.toUpperCase()}!`, 'info');
          break;
        }
        case 'dodged':
          if (p.a === meId) shoutBig('NÉ!');
          else say(`${nm(p.a)} né đòn của ${nm(p.b)}!`, 'info');
          break;
        case 'whiff':
          say(`${nm(p.a)} đánh hụt, loạng choạng!`);
          if (p.a === meId) shoutBig('ĐÁNH HỤT!');
          break;
        case 'wallpunch':
          say(`${nm(p.a)} TỰ ĐẬP vào tường! 🤦`, 'bad');
          if (p.a === meId) shoutBig('TỰ ĐẬP!');
          break;
        case 'reflect':
          say(`${nm(p.a)} phản đòn bằng mai khiên!`, 'info');
          break;
        case 'slip':
          say(`${nm(p.a)} trượt vỏ chuối! 🍌`);
          if (p.a === meId) shoutBig('TRƠN!');
          break;
      }
    } else if (p.type === 'banana') {
      if (p.op === 'add') bananas.current.set(p.id, { x: p.x, y: p.y, fx: p.fx, fy: p.fy, born: performance.now() });
      else bananas.current.delete(p.id);
    } else if (p.type === 'ko') {
      const who = nm(p.playerId);
      const by = nm(p.by);
      const how: string = p.how;
      if (p.by) say(`${by} hạ ${who}! 💀`, 'bad');
      else if (how === 'pressure') say(`${who} gục vì áp lực cuối trận`, 'bad');
      else say(`${who} TỰ ĐẬP KO! 🤦`, 'bad');
      if (p.playerId === meId) {
        shoutBig('KO!');
        sfx.miss();
      }
      if (!outRef.current.has(p.playerId)) {
        outRef.current.add(p.playerId);
        aliveRef.current = Math.max(0, players.length - outRef.current.size);
      }
      fx.current.push({ kind: 'out', playerId: p.playerId, x: p.x, y: p.y });
    }
  });

  // vào ván: thông báo nhân vật thú; áp lực cuối trận có banner báo trước 3 giây
  useEffect(() => {
    const t1 = window.setTimeout(() => setIntro(false), Math.max(0, startAt - net.now()) + 5500);
    const at = startAt + cfg.pressureAt - 3000;
    const wait = at - net.now();
    let t2 = 0;
    if (wait > -3000) {
      t2 = window.setTimeout(() => {
        shoutBig('ÁP LỰC CUỐI TRẬN!');
        setPressure(true);
        setBanner({ id: -1, text: 'ÁP LỰC CUỐI TRẬN · mọi người mất máu dần, càng lúc càng nhanh!' });
        window.setTimeout(() => setBanner(null), 5000);
      }, Math.max(0, wait));
    }
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [startAt, cfg.pressureAt]);

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
  const flush = useCallback(
    (force = false) => {
      const now = performance.now();
      const { dx, dy } = moveVec();
      const yaw = bodyYaw.current; // gửi hướng thân / hướng đánh
      const s = sent.current;
      const pl = pulse.current;
      const pulses = pl.jump || pl.punch || pl.skill1 || pl.skill2;
      const changed = Math.abs(dx - s.dx) > 0.02 || Math.abs(dy - s.dy) > 0.02 || Math.abs(yaw - s.yaw) > 0.03 || pulses;
      if (!force && !changed && now - s.at < 280) return;
      if (now - s.at < 38 && !force) return; // ≤ ~26 gói/giây
      net.input(gameId, {
        type: 'brawl',
        dx: Math.round(dx * 100) / 100,
        dy: Math.round(dy * 100) / 100,
        yaw: Math.round(yaw * 100) / 100,
        jump: pl.jump || undefined,
        punch: pl.punch || undefined,
        skill1: pl.skill1 || undefined,
        skill2: pl.skill2 || undefined,
      });
      pulse.current = { jump: false, punch: false, skill1: false, skill2: false };
      sent.current = { dx, dy, yaw, at: now };
    },
    [gameId],
  );
  flushRef.current = flush;

  const doPunch = () => {
    assist();
    pulse.current.punch = true;
    stamps.current.punch++;
    flush(true);
  };
  const doSkill = (n: 1 | 2) => {
    assist();
    pulse.current[n === 1 ? 'skill1' : 'skill2'] = true;
    stamps.current.which = n;
    stamps.current.skill++;
    flush(true);
  };

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
        case 'Tab':
        case 'KeyF':
          if (on && !e.repeat) toggleLock(code === 'Tab');
          return true;
        case 'KeyR':
        case 'Digit1':
          if (on && !e.repeat) doSkill(1);
          return true;
        case 'KeyX':
        case 'Digit2':
          if (on && !e.repeat) doSkill(2);
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
      keys.current = { f: 0, b: 0, l: 0, r: 0 };
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
        lockFailed.current = true; // không khoá được chuột: click vẫn đánh, giữ nút + kéo chuột để xoay
        setLockedUi(true);
      };
      const onLockChange = () => {
        const on = document.pointerLockElement === host;
        locked.current = on;
        if (on) lockFailed.current = false;
        setLockedUi(on);
      };
      const onMove = (e: MouseEvent) => {
        if (locked.current) rotate(e.movementX, e.movementY);
        else if (lockFailed.current && e.buttons !== 0) rotate(e.movementX, e.movementY);
      };
      const onDown = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        if (!locked.current && !lockFailed.current) {
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
        } else if (e.button === 0) doPunch();
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

  /** nút cảm ứng ĐÁNH / KỸ NĂNG 1 / KỸ NĂNG 2 / KHOÁ */
  const touch = {
    punch: doPunch,
    skill: doSkill,
    lock: () => toggleLock(false),
  };

  /* ---------- hướng thân kiểu action RPG ---------- */
  /** thân tự quay theo hướng chạy (đứng yên thì giữ nguyên); khoá mục tiêu thì luôn nhìn mục tiêu */
  const updateBody = (dt: number) => {
    const me = positions.current[meId];
    if (!me || dt <= 0) return;
    if (lockId.current) {
      const t = positions.current[lockId.current];
      if (!t || t[4] & F_OUT || distTo(t[0], t[1]) > LOCK_DROP) {
        lockId.current = '';
        setLockName('');
      }
    }
    if (me[4] & (F_DOWN | F_OUT)) {
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
    if (fl & HARD || (mine[11] ?? 0) & SB_DASH) {
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
    const sb = mine[11] ?? 0;
    const spMul =
      myChar.speed * (sb & SB_HASTE ? 1.35 : 1) * (sb & SB_RAGE ? 1.25 : 1) * (sb & SB_SPIN ? 0.6 : 1) * (sb & SB_PECK ? 0.6 : 1) * (fl & F_CAST ? CAST_MOVE_MUL : 1) * (stun ? 0.55 : 1);
    for (let i = 0; i < steps; i++) {
      const wantJump = performance.now() - jumpLocal.current < 150 && !stun;
      if (stepBody(cfg, b, dx, dy, sdt, { speedMul: spMul, accelMul: stun ? 0.5 : 1, jump: wantJump })) jumpLocal.current = -1e9;
    }
  };

  /** vị trí hiển thị của một người */
  const posOf = (id: string) => {
    const p = positions.current[id];
    if (!p) return undefined;
    if (id === meId && synced.current && !(p[4] & F_OUT)) {
      const b = body.current;
      return { x: b.x, y: b.y, z: b.z, face: p[3], flags: p[4], vx: b.vx, vy: b.vy, wob: p[7], hp: p[8], sb: p[11] ?? 0 };
    }
    const since = Math.min(0.12, (performance.now() - recvAt.current) / 1000);
    return { x: p[0] + p[5] * since, y: p[1] + p[6] * since, z: p[2], face: p[3], flags: p[4], vx: p[5], vy: p[6], wob: p[7], hp: p[8], sb: p[11] ?? 0 };
  };

  // HUD gọn: vài lần mỗi giây
  useEffect(() => {
    const iv = window.setInterval(() => {
      const m = positions.current[meId];
      const fl = m ? m[4] : 0;
      const next = {
        alive: aliveRef.current,
        out: !!(fl & F_OUT) || outRef.current.has(meId),
        winner: aliveRef.current <= 1 && !outRef.current.has(meId) && players.length > 1,
        hp: m ? m[8] : myChar.hp,
        maxHp: myChar.hp,
        cd1: m ? m[9] / 10 : 0,
        cd2: m ? m[10] / 10 : 0,
      };
      setHud((h) => (JSON.stringify(h) === JSON.stringify(next) ? h : next));
    }, 150);
    return () => window.clearInterval(iv);
  }, [meId, players.length]);

  return {
    cfg,
    startAt,
    positions,
    bananas,
    stamps,
    myChar,
    intro,
    pressure,
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
