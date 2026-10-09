import { useEffect, useRef, useState } from 'react';
import type { CodeBox, CodeMap } from '@shared/codeArena';
import { plazaStep, type Plaza, type PlazaProp } from '@shared/plaza';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface AnConfig {
  w: number;
  h: number;
  radius: number;
  boxes: CodeBox[];
  props: PlazaProp[];
  cx: number;
  cy: number;
  R: number;
  ents: number;
  colors: string[];
  speed: number;
  orbitSpeed: number;
  order: string[];
  rounds: number;
  hideMs: number;
  huntMs: number;
  restMs: number;
  shotCdMs: number;
  stunMs: number;
  hitR: number;
  regenMs: number;
  killCamMs: number;
  endsAt: number;
}

export type AnPhase = 'h' | 'u' | 'r';
/** [x, y, hướng mặt] — thực thể ẩn danh: không có gì cho biết đâu là người thật */
export type AnEnt = [number, number, number] | null;

/** viên đạn đang bay: từ nòng súng (góc phi quanh đảo lúc bắn) tới (x, y) */
export interface AnBullet {
  id: number;
  x: number;
  y: number;
  phi: number;
  at: number;
  fl: number;
}

/** kill cam quay chậm: bắt đầu lúc 'start' (giờ server), kéo dài 'ms' */
export interface AnKillCam {
  ent: number;
  x: number;
  y: number;
  phi: number;
  start: number;
  ms: number;
  who: string;
}

export interface AnFx {
  kind: 'kill' | 'miss' | 'shot';
  at: number;
  x: number;
  y: number;
}

/**
 * Trạng thái + điều khiển của GIẢ DẠNG NPC. Thực thể nào là người thật KHÔNG có trong dữ liệu client:
 * người trốn chỉ biết thực thể của mình (`role.ent`), thợ săn không biết gì cho tới lúc kết thúc vòng.
 */
export function useActNaturalGame({ gameId, config, players, meId, live }: GameProps) {
  const cfg = config as AnConfig;
  const map: CodeMap = { w: cfg.w, h: cfg.h, radius: cfg.radius, boxes: cfg.boxes };
  const plaza: Plaza = { map, props: cfg.props, cx: cfg.cx, cy: cfg.cy, R: cfg.R };

  const ents = useRef<AnEnt[] | null>(null);
  /** [góc quanh bản đồ, điểm laze x, y (null = chưa rọi), đạn, choáng] — ai cũng nhận để vẽ tia laze */
  const seekerPos = useRef<[number, number | null, number | null, number, number] | null>(null);
  const me = useRef({ x: 0, y: 0 });
  /** thợ săn: góc bay quanh bản đồ (tự dự đoán) + điểm đang rọi laze */
  const orbit = useRef(Math.PI / 2);
  const aim = useRef<[number, number] | null>(null);
  const aimSent = useRef(0);
  const synced = useRef(false);
  const keys = useRef({ l: false, r: false, u: false, d: false });
  const sent = useRef({ dx: 0, dy: 0 });
  const lastPredict = useRef(0);
  const fx = useRef<AnFx[]>([]);
  const phaseAt = useRef(0);
  const shotLocal = useRef(0);
  const bullets = useRef<AnBullet[]>([]);
  const killCam = useRef<AnKillCam | null>(null);

  const [role, setRole] = useState<{ r: number; seeker: string; ent: number; alive: boolean }>({ r: 0, seeker: cfg.order[0], ent: -1, alive: true });
  const roleRef = useRef(role);
  const [phase, setPhase] = useState<AnPhase>('h');
  const phaseRef = useRef<AnPhase>('h');
  const [round, setRound] = useState(0);
  const [ammo, setAmmo] = useState(0);
  const [maxAmmo, setMaxAmmo] = useState(0);
  /** tăng mỗi lần có đạn bắn ra (để HUD chạy lại thanh hồi chiêu) */
  const [shotNo, setShotNo] = useState(0);
  const [msg, setMsg] = useState<{ id: number; text: string; kind: 'hit' | 'npc' | 'miss' } | null>(null);
  const [kcOn, setKcOn] = useState(false);
  const msgId = useRef(0);
  const [stunned, setStunned] = useState(false);
  const [reveal, setReveal] = useState<Record<number, string>>({});
  const [feed, setFeed] = useState<{ id: number; text: string; bad: boolean }[]>([]);
  const feedId = useRef(0);

  const addFeed = (text: string, bad = false) => {
    const id = ++feedId.current;
    setFeed((f) => [...f.slice(-3), { id, text, bad }]);
    window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 4200);
  };
  const flash = (text: string, kind: 'hit' | 'npc' | 'miss') => {
    const id = ++msgId.current;
    setMsg({ id, text, kind });
    window.setTimeout(() => setMsg((m) => (m && m.id === id ? null : m)), 1800);
  };
  const dropBullet = (id: number) => {
    bullets.current = bullets.current.filter((b) => b.id !== id);
  };
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '???';
  const isSeeker = () => roleRef.current.seeker === meId;

  useGameEvents(gameId, (p) => {
    if (p.type === 'p') {
      if (phaseRef.current !== p.ph) {
        phaseRef.current = p.ph;
        setPhase(p.ph);
      }
      if (p.e) ents.current = p.e;
      seekerPos.current = p.k;
      if (p.k) {
        setAmmo(p.k[3]);
        setStunned(!!p.k[4]);
        // góc bay: thợ săn tin vào dự đoán của mình, chỉ chỉnh lại khi lệch nhiều; người khác lấy theo server
        const d = Math.atan2(Math.sin(p.k[0] - orbit.current), Math.cos(p.k[0] - orbit.current));
        if (roleRef.current.seeker !== meId || Math.abs(d) > 0.35) orbit.current = p.k[0];
      }
      // đồng bộ vị trí của chính mình
      const r = roleRef.current;
      let sx: number | undefined;
      let sy: number | undefined;
      if (r.seeker !== meId && r.ent >= 0 && p.e && p.e[r.ent]) {
        sx = p.e[r.ent][0];
        sy = p.e[r.ent][1];
      }
      if (sx !== undefined && sy !== undefined && (!synced.current || Math.hypot(sx - me.current.x, sy - me.current.y) > 6)) {
        me.current = { x: sx, y: sy };
        synced.current = true;
      }
    } else if (p.type === 'role') {
      const next = { r: p.r, seeker: p.seeker, ent: p.ent, alive: p.alive };
      const prev = roleRef.current;
      roleRef.current = next;
      if (prev.r !== next.r || prev.ent !== next.ent || prev.seeker !== next.seeker || prev.alive !== next.alive) {
        setRole(next);
        if (prev.r !== next.r || prev.ent !== next.ent) synced.current = false;
      }
    } else if (p.type === 'round') {
      setRound(p.r);
      setAmmo(p.ammo);
      setMaxAmmo(p.max);
      bullets.current = [];
      killCam.current = null;
      setKcOn(false);
      setReveal({});
      phaseAt.current = p.at;
      ents.current = null;
      synced.current = false;
      roleRef.current = { ...roleRef.current, r: p.r, seeker: p.seeker };
      setRole(roleRef.current);
      sfx.start();
      addFeed(p.seeker === meId ? 'Bạn là THỢ SĂN vòng này!' : `${nameOf(p.seeker)} là thợ săn — hãy hoà vào đám NPC!`);
    } else if (p.type === 'hunt') {
      phaseAt.current = p.at;
      sfx.tick();
    } else if (p.type === 'kill') {
      fx.current.push({ kind: 'kill', at: Date.now(), x: p.x, y: p.y });
      const b = bullets.current.find((q) => q.id === p.id);
      killCam.current = { ent: p.ent, x: p.x, y: p.y, phi: b ? b.phi : orbit.current, start: p.at, ms: p.ms, who: p.who };
      dropBullet(p.id);
      setKcOn(true);
      window.setTimeout(() => sfx.miss(), p.ms * 0.72);
      window.setTimeout(() => {
        if (killCam.current && killCam.current.start === p.at) {
          killCam.current = null;
          setKcOn(false);
        }
      }, p.ms + 200);
      setAmmo(p.ammo);
      flash(roleRef.current.seeker === meId ? 'TRÚNG NGƯỜI THẬT!' : p.who === meId ? 'BẠN BỊ BẮN TRÚNG!' : `${nameOf(p.who)} BỊ HẠ!`, 'hit');
      addFeed(`${nameOf(p.who)} bị thợ săn tìm ra!`, true);
      if (p.who === meId) sfx.miss();
      else sfx.tick();
    } else if (p.type === 'miss') {
      fx.current.push({ kind: 'miss', at: Date.now(), x: p.x, y: p.y });
      dropBullet(p.id);
      flash(roleRef.current.seeker === meId ? 'NPC! mất đạn' : 'Bắn nhầm NPC!', 'npc');
      setAmmo(p.ammo);
      addFeed('Thợ săn bắn nhầm một NPC!');
      sfx.tap();
    } else if (p.type === 'shot') {
      fx.current.push({ kind: 'shot', at: Date.now(), x: p.x, y: p.y });
      dropBullet(p.id);
      if (roleRef.current.seeker === meId) flash('Trượt!', 'miss');
      setAmmo(p.ammo);
    } else if (p.type === 'bullet') {
      bullets.current.push({ id: p.id, x: p.x, y: p.y, phi: p.phi, at: p.at, fl: p.fl });
      setAmmo(p.ammo);
      setShotNo((n) => n + 1);
      sfx.tap();
    } else if (p.type === 'reveal') {
      phaseAt.current = p.at;
      bullets.current = [];
      killCam.current = null;
      setKcOn(false);
      setReveal(p.map);
    }
  });

  useEffect(() => {
    if (!live) return;
    const push = () => {
      const k = keys.current;
      const dx = (k.r ? 1 : 0) - (k.l ? 1 : 0);
      const dy = (k.d ? 1 : 0) - (k.u ? 1 : 0);
      if (dx === sent.current.dx && dy === sent.current.dy) return;
      sent.current = { dx, dy };
      net.input(gameId, { type: 'moveXY', dx, dy });
    };
    const set = (code: string, on: boolean) => {
      const k = keys.current;
      if (code === 'ArrowLeft' || code === 'KeyA') k.l = on;
      else if (code === 'ArrowRight' || code === 'KeyD') k.r = on;
      else if (code === 'ArrowUp' || code === 'KeyW') k.u = on;
      else if (code === 'ArrowDown' || code === 'KeyS') k.d = on;
      else return false;
      return true;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (set(e.code, true)) {
        e.preventDefault();
        push();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (set(e.code, false)) push();
    };
    const onBlur = () => {
      keys.current = { l: false, r: false, u: false, d: false };
      push();
    };
    const beat = window.setInterval(() => {
      const { dx, dy } = sent.current;
      if (dx || dy) net.input(gameId, { type: 'moveXY', dx, dy });
    }, 400);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      window.clearInterval(beat);
    };
  }, [gameId, live]);

  /** thợ săn rọi laze tới điểm (x, y) trên sàn: cập nhật ngay trên máy mình, gửi cho cả phòng ~15 lần/giây */
  const aimTo = (x: number, y: number) => {
    if (!isSeeker()) return;
    aim.current = [x, y];
    const now = Date.now();
    if (!live || phaseRef.current !== 'u' || now - aimSent.current < 66) return;
    aimSent.current = now;
    net.input(gameId, { type: 'aim', x, y });
  };

  /** thợ săn bắn vào điểm (x, y) trên sàn */
  const shoot = (x: number, y: number) => {
    if (!live || !isSeeker() || phaseRef.current !== 'u') return;
    const now = Date.now();
    if (now - shotLocal.current < cfg.shotCdMs) return;
    shotLocal.current = now;
    net.input(gameId, { type: 'shoot', x, y });
  };

  /** dự đoán vị trí của mình: người trốn đi bằng tốc độ NPC, thợ săn nhanh hơn và chỉ chạy được lúc săn */
  const predict = (serverNow: number) => {
    const dt = lastPredict.current ? Math.min(serverNow - lastPredict.current, 120) / 1000 : 0;
    lastPredict.current = serverNow;
    const r = roleRef.current;
    if (!live || killCam.current) return;
    const { dx, dy } = sent.current;
    if (r.seeker === meId) {
      // thợ săn không đứng trong sân: chỉ bay vòng quanh bản đồ
      if (phaseRef.current !== 'u' || seekerPos.current?.[4]) return;
      orbit.current += dx * cfg.orbitSpeed * dt;
    } else if (r.alive && r.ent >= 0 && phaseRef.current !== 'r') {
      plazaStep(plaza, me.current, dx, dy, cfg.speed, dt);
    }
  };

  return {
    cfg,
    live,
    startAt: 0,
    ents,
    seekerPos,
    me,
    orbit,
    aim,
    aimTo,
    fx,
    phaseAt,
    role,
    phase,
    round,
    ammo,
    maxAmmo,
    shotNo,
    msg,
    kcOn,
    bullets,
    killCam,
    stunned,
    reveal,
    feed,
    players,
    meId,
    shoot,
    predict,
    serverNow: () => net.now(),
  };
}

export type ActNaturalGameState = ReturnType<typeof useActNaturalGame>;
