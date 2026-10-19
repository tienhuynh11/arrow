// Một ván đang chơi: nối GameModel (dự đoán/nội suy) với Three.js, âm thanh, HUD và input.

import * as THREE from 'three';
import { GameModel } from '@shared/monkey/client';
import { CLASSES, MK_NO, MK_VUA, MONKEYS, headY, weaponOf } from '@shared/monkey/content';
import { PLAYER_SPAWNS, rayWorld } from '@shared/monkey/map';
import {
  FX_BUILD, FX_EXPLODE, FX_HEAL, FX_PICK, FX_PLAYERHIT, FX_REPAIR, FX_ROAR, FX_SHOCK, FX_SLAM, FX_SPLAT, FX_STOMP,
  PF_ADS, PF_BRACE, PF_DOWN_MASK, PF_REVIVING, PF_SPRINT, SnapData, decodeSnap, type SMsg,
} from '@shared/monkey/proto';
import { B_USE, EYE_Y, P_G, P_K, P_Q, P_U1, P_U2, P_W1, P_W2, P_X, SHOULDER, curReloadTicks, curWeapon, type Cmd } from '@shared/monkey/sim';
import type { GroundLoot } from '@shared/monkey/gear';
import type { QuickSlot } from '@shared/monkey/proto';
import type { WeaponDef } from '@shared/monkey/content';
import { api } from './api';
import { STAT_KEYS, defOf, equippedMap, fmtStat, statInfo } from './gearlib';
import { LootRenderer } from './render/loot';
import { makeGunModel } from './render/avatars';
import { CAM_MODES, saveSettings, type CamMode } from './settings';
import * as A from './audio';
import { Input } from './input';
import { net } from './net';
import { Avatar, type AvatarLook } from './render/avatars';
import { Fx } from './render/fx';
import { MonkeyRenderer } from './render/monkeys';
import { blobTex, type Stage } from './render/scene';
import { settings } from './settings';
import { Hud, type HudPlayer } from './ui/hud';
import { toast } from './ui/dom';
import { ST_FUSE, ST_POUNCE, ST_THROW, ST_WIND, ST_DROP } from '@shared/monkey/proto';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
/** khoảng cách (bình phương) còn vẽ chi tiết nhỏ của nhân vật đồng đội */
const AVATAR_DETAIL_D2 = 25 * 25;
/** màu vệt đạn theo idx người chơi (10 màu nhạt, đủ MAX_PLAYERS) */
const SHOT_COLORS = [0xfff2a8, 0xa8ffcb, 0xffd0a0, 0xffb0b0, 0xa8d8ff, 0xe0b8ff, 0xb0fff0, 0xffc0e0, 0xffffff, 0xc8c8ff];

/** thông tin trận ngoài danh sách người chơi */
export interface GameOpts {
  /** false = ải (không xu / cửa hàng) */
  economy: boolean;
  waves?: number;
  stageName?: string;
  /** túi đồ đang nằm trên đất (vào lại giữa trận) */
  loot?: GroundLoot[];
}
type StartP = HudPlayer & { weapons?: WeaponDef[]; quick?: QuickSlot[]; look?: AvatarLook };

export interface Shared3D {
  stage: Stage;
  monkeys: MonkeyRenderer;
  fx: Fx;
}

export class Game {
  model: GameModel;
  hud: Hud;
  private snap = new SnapData();
  private avatars = new Map<number, Avatar>();
  private cmds: Cmd[] = [];
  private inp = { mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0 };
  private lastCmd: Cmd | null = null;
  private shake = 0;
  private recoilPitch = 0;
  private camDist = 3.6;
  private fov = 78;
  private screechAt = 0;
  private beepAt = 0;
  private lastT = 0;
  private running = true;
  private breakReady = false;
  private blobT = blobTex();
  private killReward = new Map<number, number>();
  players: HudPlayer[];
  readonly me: number;
  overlay = false;
  private fpsDt = 0.016;
  private wasDown = 0;
  /** lần chém dao gần nhất của mình (hoạt cảnh cục bộ ngay khi bấm, khớp hồi chiêu ~0.6 s của server) */
  private knifeAt = 0;
  readonly opts: GameOpts;
  /** túi đồ trên đất */
  readonly loot = new LootRenderer();
  /** súng mang theo của từng người (ải) */
  private pWeapons = new Map<number, WeaponDef[]>();
  /** góc camera hiện hành */

  /** đang ngắm nghía súng */
  inspecting = false;
  private inspYaw = 0;
  private inspDrag: number | null = null;
  private camBlend = 0;
  private viewGun: { g: THREE.Group; key: string } | null = null;

  constructor(private s3: Shared3D, readonly input: Input, players: HudPlayer[], me: number, opts: GameOpts = { economy: true }) {
    this.opts = opts;
    this.players = players;
    this.me = me;
    const meP = players.find((p) => p.idx === me)!;
    const sp = PLAYER_SPAWNS[me] ?? PLAYER_SPAWNS[0];
    // chỉ số đồ (tin start players[i].mods) phải vào mô phỏng dự đoán, nếu không client lệch server
    // ải: súng thật từ đồ (tin start players[i].weapons) cũng phải vào mô phỏng dự đoán
    const mp = meP as { mods?: import('@shared/monkey/progression').SimMods; weapons?: import('@shared/monkey/content').WeaponDef[] };
    this.model = new GameModel(me, meP.cls, sp.x, sp.z, mp.mods, undefined, mp.weapons ?? null);
    input.yaw = Math.atan2(sp.x, sp.z);
    input.pitch = -0.12;
    const meS = meP as StartP;
    for (const p of players as StartP[]) if (p.weapons?.length) this.pWeapons.set(p.idx, p.weapons);
    this.hud = new Hud({ economy: opts.economy, weapons: meS.weapons?.length ? meS.weapons : null, quick: meS.quick ?? [], waves: opts.waves, stageName: opts.stageName });
    this.hud.onSlot = (k) => {
      if (k === 'w1') input.press(P_W1);
      else if (k === 'w2') input.press(P_W2);
      else if (k === 'u1') input.press(P_U1);
      else if (k === 'u2') input.press(P_U2);
      else if (k === 'knife') this.pressKnife();
      else if (k === 'g' || k === 'x' || k === 'q') this.pressSkill(k);
      else if (k === 'inspect') this.onInspectKey();
    };
    s3.stage.scene.add(this.loot.group);
    for (const l of opts.loot ?? []) this.addLoot(l);
    this.hud.setPlayers(players, me);
    document.getElementById('app')!.prepend(this.hud.root);
    for (const p of players) {
      // ngoại hình đồ đang mặc (tin start players[i].look)
      const a = new Avatar(p.cls, this.blobT, p.idx, (p as { look?: AvatarLook }).look);
      a.setTier(0);
      this.avatars.set(p.idx, a);
      s3.stage.scene.add(a.root, a.blob);
    }
    s3.fx.clear();
    s3.fx.onShellBoom = (x, y, z) => s3.fx.sparks(x, y, z, 10, 1, 0.9, 0.4, 5);
    s3.monkeys.onState = (sl, st, x, z) => this.monkeySound(sl, st, x, z);
    this.camDist = settings.camDist;
    this.fov = settings.fov;
    input.enabled = true;
  }

  /* ======================= MẠNG ======================= */
  onBin(v: DataView) {
    if (!decodeSnap(v, this.snap)) return;
    this.model.onSnap(this.snap, performance.now());
  }

  onJson(m: SMsg) {
    const hud = this.hud;
    if (m.t === 'wave') {
      hud.setWave(m.phase, m.n, m.ends - net.offset, m.total, m.boss, m.ready);
      this.breakReady = m.ready.includes(this.me);
      if (m.phase === 'fight') {
        hud.announce(m.boss ? `ĐỢT ${m.n}` : `ĐỢT ${m.n}`, m.boss ? '👑 VUA KHỈ ĐỘT XUẤT HIỆN!' : `${m.total} con khỉ đang kéo tới!`, m.boss);
        A.sfxWaveStart(m.boss);
      } else if (m.n === 0) {
        hud.announce('CHUẨN BỊ!', 'Bầy khỉ sắp tràn vào đền');
      }
      return;
    }
    if (m.t !== 'ev') return;
    const name = (i?: number) => this.players.find((p) => p.idx === i)?.name ?? '?';
    switch (m.k) {
      case 'down':
        hud.feed(`💀 ${name(m.i)} đã gục!`, 'bad');
        if (m.i === this.me) {
          A.sfxDown();
          if (m.v) hud.feed('Bạn sẽ tự đứng dậy sau 5 giây (còn lượt tự hồi sinh)', 'gold');
        }
        break;
      case 'revived':
        hud.feed(m.j === m.i ? `💪 ${name(m.i)} tự đứng dậy!` : m.j !== undefined && m.j >= 0 ? `🤝 ${name(m.j)} đỡ ${name(m.i)} dậy` : `✨ ${name(m.i)} được hồi sinh`, 'good');
        if (m.i === this.me || m.j === this.me) A.sfxRevive();
        break;
      case 'dead':
        hud.feed(`☠️ ${name(m.i)} tử trận — sẽ hồi sinh đợt sau`, 'bad');
        break;
      case 'respawn':
        hud.feed(`🔄 ${name(m.i)} quay lại chiến đấu`, 'good');
        break;
      case 'boss':
        break;
      case 'bossdown':
        hud.announce('HẠ VUA KHỈ!', `${name(m.i)} kết liễu · cả đội +350 xu`);
        A.sfxWaveClear();
        break;
      case 'clear':
        hud.announce(`XONG ĐỢT ${m.v}`, `+${m.j} xu mỗi người · đồng đội gục được hồi sinh`);
        A.sfxWaveClear();
        break;
      case 'ult': {
        const cls = CLASSES[this.players.find((p) => p.idx === m.i)?.cls ?? 0];
        hud.feed(`${cls.q.icon} ${name(m.i)}: ${cls.q.name}!`, 'gold');
        this.avatars.get(m.i ?? -1)?.skill('ult');
        if (cls.id === 'xathu' && m.i === this.me) {
          // phát bắn thần của chính mình: server không gửi lại vệt đạn của mình → tự vẽ
          this.avatars.get(this.me)?.muzzleWorld(tmpV);
          const yaw = (this.model.pred.yaw / 65536) * Math.PI * 2;
          const pt = (this.model.pred.pitch / 65536) * Math.PI * 2;
          const d = 90;
          tmpV2.set(tmpV.x + Math.sin(yaw) * Math.cos(pt) * d, tmpV.y + Math.sin(pt) * d, tmpV.z + Math.cos(yaw) * Math.cos(pt) * d);
          this.s3.fx.tracer(tmpV.x, tmpV.y, tmpV.z, tmpV2.x, tmpV2.y, tmpV2.z, 0xc4b5fd, 0.18);
        }
        A.sfxUlt();
        break;
      }
      case 'skill': {
        const av = this.avatars.get(m.i ?? -1);
        const id = CLASSES[this.players.find((p) => p.idx === m.i)?.cls ?? 0].id;
        if (av) av.skill(m.s === 'g' ? (id === 'dausi' ? 'stomp' : id === 'kysu' ? 'build' : 'throw') : id === 'dausi' || id === 'xathu' ? 'brace' : id === 'phaothu' ? 'throw' : id === 'caoboi' ? 'stomp' : 'build');
        break;
      }
      case 'buy':
        if (m.i === this.me) {
          A.sfxBuy();
          hud.feed(m.s === 'weapon' ? `🔫 ${weaponOf(this.model.pred.cls, m.v ?? 0).name}` : `❤️ Máu bậc ${m.v}`, 'gold');
        } else hud.feed(`${name(m.i)} nâng ${m.s === 'weapon' ? weaponOf(this.players.find((p) => p.idx === m.i)?.cls ?? 0, m.v ?? 0).short : 'máu'}`, '');
        break;
      case 'knife':
        // người khác chém (của mình đã vẽ ngay lúc bấm)
        if (m.i !== undefined && m.i !== this.me) {
          this.avatars.get(m.i)?.slash();
          const [vol, pan] = this.spatial(this.model.oX[m.i], this.model.oZ[m.i]);
          A.sfxWhoosh(vol, pan);
        }
        if (m.i === this.me && (m.v ?? 0) > 0) hud.feed(m.j ? `🔪 Đâm lén ×2! (${m.v} trúng)` : `🔪 Chém trúng ${m.v}`, 'gold');
        break;
      case 'loot': {
        const g = m as unknown as GroundLoot;
        this.addLoot({ id: g.id, x: g.x, z: g.z, grade: g.grade, itemId: g.itemId });
        if (g.grade >= 3) A.sfxLoot(g.grade);
        break;
      }
      case 'unloot':
        this.loot.remove(m.v ?? -1);
        this.hud.loot.delete(m.v ?? -1);
        break;
      case 'picked': {
        const mine = m.i === this.me;
        this.hud.pickup(m.s ?? '', m.j ?? 0, mine ? undefined : name(m.i));
        if (mine) {
          A.sfxLoot(m.j ?? 0);
          const l = this.hud.loot.get(m.v ?? -1);
          if (l) this.s3.fx.sparks(l.x, 0.6, l.z, 10, 1, 0.9, 0.5, 4);
        }
        break;
      }
      case 'bagfull':
        A.sfxDeny();
        toast('🎒 Ba lô trận đã đầy — không nhặt thêm được');
        break;
      case 'use': {
        const def = defOf(m.s);
        if (m.i === this.me) {
          A.sfxHeal();
          hud.feed(`${def?.name ?? 'Vật phẩm'} · còn ${m.v ?? 0}`, 'good');
        } else hud.feed(`${name(m.i)} dùng ${def?.name ?? 'vật phẩm'}`, '');
        break;
      }
      case 'out':
        hud.feed(m.i === this.me ? '☠️ Bạn đã gục hẳn — đồ mang theo bị mất (trừ Túi an toàn)' : `☠️ ${name(m.i)} gục hẳn — rơi mất đồ`, 'bad');
        break;
      case 'noshop':
        A.sfxDeny();
        toast(this.opts.economy ? '🚫 Ải này không cho nâng cấp giữa trận' : '🚫 Vượt ải không có cửa hàng — chỉ dùng đồ mang theo');
        break;
      case 'nocash':
        A.sfxDeny();
        toast(`Thiếu xu — cần ${m.v} xu`);
        break;
    }
  }

  setBreakReady(r: boolean) {
    this.breakReady = r;
    net.send({ t: 'bready', r });
  }
  isBreakReady() {
    return this.breakReady;
  }

  /* ======================= KHUNG HÌNH ======================= */
  frame(now: number) {
    if (!this.running) return;
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    this.fpsDt += (dt - this.fpsDt) * 0.1;
    const m = this.model;
    const input = this.input;
    const stage = this.s3.stage;
    const me = m.info[this.me];
    const down = me ? me.flags & PF_DOWN_MASK : 0;

    // hỗ trợ ngắm cảm ứng: mục tiêu gần tâm
    if (input.touch) input.assist(this.assistTarget(), dt);

    input.tick(dt, now);
    input.read(this.inp);
    m.rttMs = net.rtt || 100;
    // giật súng: cộng vào pitch thật (ảnh hưởng ngắm, người chơi phải ghìm)
    if (this.recoilPitch > 0) {
      const back = Math.min(this.recoilPitch, dt * 3.5);
      this.recoilPitch -= back;
      input.pitch -= back * 0.6;
    }
    this.cmds.length = 0;
    if ((this.inp.btn & P_K) && !down && now - this.knifeAt > 600) {
      this.knifeAt = now;
      this.avatars.get(this.me)?.slash();
      A.sfxWhoosh(1, 0);
    }
    m.frame(now, this.inp.mx, this.inp.mz, this.inp.yaw, this.inp.pitch, this.inp.btn, this.cmds);
    if (this.cmds.length) {
      this.lastCmd = this.cmds[this.cmds.length - 1];
      net.queueCmds(this.cmds, now);
    } else net.queueCmds(this.cmds, now);

    if (down && !this.wasDown) input.resetKeys();
    this.wasDown = down;
    A.setHeartbeat(!!me && !down && me.hp > 0 && me.hp < me.maxHp * 0.25);

    // ---- camera: qua vai / thứ nhất / xa — tia giữa màn hình luôn trùng tia bắn (gốc shotOrigin, hướng yaw/pitch) ----
    const ads = (this.inp.btn & 2) !== 0 && !down;
    const mode: CamMode = down ? 'shoulder' : settings.camMode;
    const yaw = input.yaw;
    const pitch = input.pitch;
    const wantDist = mode === 'fps' ? 0 : mode === 'far' ? 7.5 * (ads ? 0.75 : 1) : (down ? 4.5 : settings.camDist) * (ads ? 0.62 : 1);
    this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 10);
    const wantFov = settings.fov * (ads ? 0.78 : 1);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 12);
    const cam = stage.camera;
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    const dx = sy * cp, dy = sp, dz = cy * cp;
    const ox = m.rx - cy * SHOULDER, oy = m.ry + EYE_Y, oz = m.rz + sy * SHOULDER;
    // va chạm camera với vật cản: kéo vào gần
    let dist = this.camDist;
    let cx: number, cyy: number, cz: number;
    let lx = 0, ly = 0, lz = 0;
    let lookAtPt = false;
    if (mode === 'far') {
      // cao + xa phía sau, nhìn vào điểm tia bắn chạm vật cản → tâm ngắm vẫn chỉ đúng chỗ đạn tới
      const reach = Math.min(45, rayWorld(ox, oy, oz, dx, dy, dz, 45));
      lx = ox + dx * reach; ly = oy + dy * reach; lz = oz + dz * reach;
      cx = ox - sy * dist; cz = oz - cy * dist; cyy = oy + 2.6 + Math.max(0, -sp) * 2;
      lookAtPt = true;
    } else {
      if (dist > 0.05) {
        const hit = rayWorld(ox, oy, oz, -dx, -dy, -dz, dist + 0.3);
        if (hit < dist + 0.3) dist = Math.max(0.4, hit - 0.3);
      }
      cx = ox - dx * dist; cyy = oy - dy * dist; cz = oz - dz * dist;
    }
    if (cyy < 0.25) cyy = 0.25;
    // ngắm nghía súng: camera vòng ra trước mặt nhân vật, súng xoay chậm
    if (this.inspecting) {
      if (this.inspDrag === null) this.inspYaw += dt * 0.35;
      const a = yaw + Math.PI * 0.82 + this.inspYaw;
      const meAv0 = this.avatars.get(this.me);
      if (meAv0) meAv0.muzzleWorld(tmpV2);
      else tmpV2.set(m.rx, m.ry + 1, m.rz);
      lx = (m.rx * 0.45 + tmpV2.x * 0.55); ly = m.ry + 0.95; lz = (m.rz * 0.45 + tmpV2.z * 0.55);
      cx = lx + Math.sin(a) * 1.9; cyy = ly + 0.35; cz = lz + Math.cos(a) * 1.9;
      lookAtPt = true;
      this.camBlend = 1;
    }
    // rung
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * settings.shake;
    if (sh > 0) {
      cx += (Math.random() - 0.5) * sh * 0.35;
      cyy += (Math.random() - 0.5) * sh * 0.35;
      cz += (Math.random() - 0.5) * sh * 0.35;
    }
    if (this.camBlend > 0) {
      // chuyển mượt vào / ra chế độ ngắm nghía
      const k = 1 - Math.exp(-dt * 7);
      cam.position.lerp(tmpV.set(cx, cyy, cz), this.inspecting ? k : Math.max(k, 1 - this.camBlend));
      if (!this.inspecting) this.camBlend = Math.max(0, this.camBlend - dt * 3);
    } else cam.position.set(cx, cyy, cz);
    if (lookAtPt) cam.lookAt(lx, ly, lz);
    else cam.lookAt(cam.position.x + dx, cam.position.y + dy, cam.position.z + dz);
    this.updateViewGun(mode === 'fps' && !this.inspecting && !down, cam, now, ads);
    stage.followShadow(m.rx, m.rz);

    // ---- nhân vật ----
    for (const p of this.players) {
      const a = this.avatars.get(p.idx)!;
      const inf = m.info[p.idx];
      if (inf) a.setTier(inf.tier);
      if (p.idx === this.me) {
        const sp2 = Math.hypot(m.pred.vx, m.pred.vz);
        const rl = m.pred.reloadT > 0 ? 1 - m.pred.reloadT / curReloadTicks(m.pred) : -1;
        this.syncGun(a, p.idx, m.pred.wslot);
        a.update({
          x: m.rx, y: m.ry, z: m.rz, yaw, pitch, dt, t: now / 1000, down, ads,
          sprint: sp2 > 7, brace: m.pred.braceT > 0 && CLASSES[m.pred.cls].id === 'dausi', rage: !!inf && inf.shield > 0,
          reviving: (this.inp.btn & B_USE) !== 0 && !!inf && (inf.flags & PF_REVIVING) !== 0, reload: rl,
        });
        a.setVisible(this.inspecting || (mode !== 'fps' && dist > 1.1));
      } else if (inf) {
        // xa > 25 m: ẩn chi tiết nhỏ (mắt, kính, nút…) — rẻ, đỡ draw call khi 10 người
        const ddx = m.oX[p.idx] - cam.position.x, ddz = m.oZ[p.idx] - cam.position.z;
        a.setDetail(ddx * ddx + ddz * ddz < AVATAR_DETAIL_D2);
        this.syncGun(a, p.idx, inf.wslot);
        a.update({
          x: m.oX[p.idx], y: m.oY[p.idx], z: m.oZ[p.idx], yaw: m.oYaw[p.idx], pitch: m.oPitch[p.idx], dt, t: now / 1000,
          down: inf.flags & PF_DOWN_MASK, ads: (inf.flags & PF_ADS) !== 0, sprint: (inf.flags & PF_SPRINT) !== 0,
          brace: (inf.flags & PF_BRACE) !== 0 && CLASSES[p.cls].id === 'dausi', rage: inf.shield > 0, reviving: (inf.flags & PF_REVIVING) !== 0,
          reload: inf.reloadT > 0 ? 1 - inf.reloadT / this.reloadOf(p.idx, p.cls, inf.tier, inf.wslot) : -1,
        });
      }
    }

    // ---- sự kiện → hiệu ứng + âm thanh ----
    this.handleFx(now);

    // ---- khỉ, hiệu ứng, cảnh ----
    this.s3.monkeys.update(m, now / 1000, dt, cam.position, cam.quaternion);
    this.s3.fx.update(m, dt, now / 1000);
    this.loot.update(now / 1000, now);
    this.ambientScreech(now);
    stage.update(now / 1000, dt);
    stage.trackFps(dt, now);
    this.s3.fx.setScale(stage.renderer.domElement.height / (2 * Math.tan(((cam.fov / 2) * Math.PI) / 180)));
    stage.render();
    this.hud.update(m, cam, dt, now, this.lastCmd, net.rtt, 1 / Math.max(0.001, this.fpsDt));
  }

  private assistTarget(): number | null {
    const m = this.model;
    let best: number | null = null;
    let bd = 0.15;
    for (let sl = 0; sl < 160; sl++) {
      if (!m.rmVisible[sl]) continue;
      const dx = m.rmX[sl] - m.rx, dz = m.rmZ[sl] - m.rz;
      const d = Math.hypot(dx, dz);
      if (d > 25) continue;
      const a = Math.atan2(dx, dz);
      let diff = a - this.input.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < bd) { bd = Math.abs(diff); best = a; }
    }
    return best;
  }

  private spatial(x: number, z: number): [number, number] {
    const cam = this.s3.stage.camera;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d = Math.hypot(dx, dz);
    const camYaw = this.input.yaw;
    const rel = Math.atan2(dx, dz) - camYaw;
    const vol = Math.max(0, 1 - d / 45);
    return [vol * vol, -Math.sin(rel) * 0.8];
  }

  private addShake(v: number) {
    this.shake = Math.min(1.2, this.shake + v);
  }

  private handleFx(now: number) {
    const m = this.model;
    const fx = this.s3.fx;
    const meAv = this.avatars.get(this.me)!;
    for (const e of m.fx) {
      switch (e.k) {
        case 'fire': {
          const w = m.pred.weapons ? curWeapon(m.pred) : weaponOf(m.pred.cls, e.a);
          A.sfxGun(w.sound, 1, 0);
          meAv.kick();
          meAv.muzzleWorld(tmpV);
          fx.muzzleFlash(tmpV, true, w.pellets > 1 || w.splashR > 0);
          this.recoilPitch += (w.kick * Math.PI) / 180 * 0.45;
          this.addShake(w.pellets > 1 || w.splashR > 0 ? 0.32 : 0.08);
          break;
        }
        case 'tracer': {
          meAv.muzzleWorld(tmpV);
          if (curWeapon(m.pred).splashR > 0) {
            const dx = e.x - tmpV.x, dy = e.y - tmpV.y, dz = e.z - tmpV.z;
            const d = Math.hypot(dx, dy, dz) || 1;
            fx.ownShells.push({ x: tmpV.x, y: tmpV.y, z: tmpV.z, dx: dx / d, dy: dy / d, dz: dz / d, dist: d, t: 0, boom: true });
          } else {
            fx.tracer(tmpV.x, tmpV.y, tmpV.z, e.x, e.y, e.z, SHOT_COLORS[this.me % SHOT_COLORS.length], 0.06);
          }
          if (e.a >= 0) {
            fx.fur(e.x, e.y, e.z, MONKEYS[m.mType[e.a]].color, 4);
            fx.sparks(e.x, e.y, e.z, 3, 1, 0.9, 0.6, 3);
            if (e.c === 0) {
              this.hud.hitmarker(e.b ? 'crit' : 'hit');
              A.sfxHit(!!e.b);
            }
          } else if (e.y < 0.1) {
            fx.norm.spawn(e.x, 0.05, e.z, 0, 1.2, 0, 0.4, 0.2, 0.5, 0.55, 0.45, 0.3, 2, 2);
          } else fx.sparks(e.x, e.y, e.z, 4, 1, 0.8, 0.5, 4);
          break;
        }
        case 'hit': {
          // số sát thương của mình (server xác nhận)
          const crit = (e.c & 1) === 1;
          const t = m.mType[e.a];
          this.hud.damageNumber(m.rmX[e.a] || e.x, headY(t) + 0.45, m.rmZ[e.a] || e.z, String(e.b), crit ? 'crit' : '');
          if (crit) this.hud.hitmarker('crit');
          break;
        }
        case 'mhit':
          if (Math.random() < 0.5) fx.fur(e.x, 0.9, e.z, MONKEYS[m.mType[e.a]].color, 2);
          break;
        case 'kill': {
          const type = e.b;
          const [vol, pan] = this.spatial(e.x, e.z);
          A.sfxMonkey('die', vol, pan, type === MK_VUA ? 0.4 : 1 / MONKEYS[type].scale);
          fx.fur(e.x, 0.8 * MONKEYS[type].scale, e.z, MONKEYS[type].color, type === MK_VUA ? 30 : 9);
          if (e.c === this.me) {
            this.hud.hitmarker('kill');
            A.sfxKill(true);
            fx.coins(e.x, 1.2, e.z, 4);
            const reward = MONKEYS[type].reward;
            this.hud.damageNumber(e.x, 1.9 * MONKEYS[type].scale, e.z, `+${reward} xu`, 'coin');
          }
          break;
        }
        case 'shot': {
          const shooter = e.a;
          let ok = true;
          if (shooter >= 100) ok = fx.turretMuzzle(shooter - 100, tmpV);
          else {
            const av = this.avatars.get(shooter);
            if (!av) ok = false;
            else {
              av.muzzleWorld(tmpV);
              av.kick();
            }
          }
          if (!ok) break;
          const yaw = (e.b / 65536) * Math.PI * 2;
          const pt = (e.c / 65536) * Math.PI * 2;
          const d = e.x;
          tmpV2.set(tmpV.x + Math.sin(yaw) * Math.cos(pt) * d, tmpV.y + Math.sin(pt) * d, tmpV.z + Math.cos(yaw) * Math.cos(pt) * d);
          const inf = shooter < 100 ? m.info[shooter] : null;
          const w = inf ? this.weaponOfP(shooter, inf.cls, inf.tier, inf.wslot) : null;
          if (!w || w.splashR === 0) fx.tracer(tmpV.x, tmpV.y, tmpV.z, tmpV2.x, tmpV2.y, tmpV2.z, shooter >= 100 ? 0x9cff9c : SHOT_COLORS[shooter % SHOT_COLORS.length], 0.07);
          fx.muzzleFlash(tmpV, false, !!w && w.pellets > 1);
          const [vol, pan] = this.spatial(tmpV.x, tmpV.z);
          A.sfxGun(shooter >= 100 ? 'turret' : w?.sound ?? 'pistol', vol * 0.7, pan);
          break;
        }
        case 'fx':
          this.worldFx(e.a, e.x, e.z, e.b, e.c);
          break;
        case 'reload':
          A.sfxReload(curWeapon(m.pred).pellets > 1 ? 2 : 0);
          break;
        case 'jump':
          A.sfxJump();
          break;
        case 'empty':
          A.sfxEmpty();
          break;
      }
    }
    m.fx.length = 0;
    void now;
  }

  private worldFx(kind: number, x: number, z: number, a: number, b: number) {
    const fx = this.s3.fx;
    const [vol, pan] = this.spatial(x, z);
    const near = Math.max(0, 1 - Math.hypot(x - this.model.rx, z - this.model.rz) / 25);
    switch (kind) {
      case FX_EXPLODE:
        fx.explosion(x, z, a / 10);
        A.sfxExplosion(Math.max(0.25, vol), pan);
        this.addShake(0.55 * near);
        break;
      case FX_SLAM:
        fx.dust(x, z, a ? 3.5 : 2.6, 16);
        fx.ring(x, z, 0.3, a ? 3.5 : 2.6, 0.35, 0xffcf80);
        A.sfxSlam(vol, pan, !!a);
        this.addShake(0.3 * near);
        break;
      case FX_SHOCK:
        fx.shockwave(x, z);
        A.sfxSlam(Math.max(0.4, vol), pan, true);
        this.addShake(0.7 * Math.max(0.3, near));
        this.hud.feed('⚠ SÓNG XUNG KÍCH — NHẢY ĐỂ NÉ!', 'bad');
        break;
      case FX_HEAL:
        fx.heal(x, z);
        if (a === this.me) A.sfxHeal();
        break;
      case FX_ROAR:
        A.sfxMonkey('roar', Math.max(0.5, vol), pan);
        fx.ring(x, z, 1, 8, 0.8, b ? 0xff4020 : 0xffa060);
        this.addShake(0.5);
        if (!a) this.hud.feed('👑 Vua Khỉ gầm gọi đàn con!', 'bad');
        break;
      case FX_STOMP:
        fx.dust(x, z, 5, 26);
        fx.ring(x, z, 0.5, 5, 0.4, 0xffd08a);
        A.sfxSlam(Math.max(0.5, vol), pan, true);
        this.addShake(0.45 * near);
        break;
      case FX_SPLAT:
        for (let i = 0; i < 10; i++) fx.norm.spawn(x, 0.4, z, (Math.random() - 0.5) * 4, 2 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.6, 0.18, 0.08, 1, 0.9, 0.3, 9, 1);
        A.sfxSplat(vol, pan);
        break;
      case FX_PLAYERHIT: {
        const victim = a;
        const dmg = b & 1023;
        const src = b >> 10;
        this.avatars.get(victim)?.hit(x, z);
        if (victim === this.me) {
          this.hud.hurtFrom(x, z, dmg >= 20);
          A.sfxHurt(dmg >= 20);
          this.addShake(Math.min(0.6, 0.15 + dmg / 60));
        }
        void src;
        break;
      }
      case FX_BUILD:
        fx.dust(x, z, 1.2, 10);
        A.sfxBuild();
        break;
      case FX_REPAIR:
        fx.sparks(x, 1, z, 12, 0.4, 0.8, 1, 4);
        break;
      case FX_PICK:
        fx.coins(x, 0.8, z, 8);
        if (b === this.me) A.sfxBuy();
        break;
    }
  }

  private monkeySound(sl: number, st: number, x: number, z: number) {
    const [vol, pan] = this.spatial(x, z);
    if (vol < 0.05) return;
    const t = this.model.mType[sl];
    const pitch = 1 / Math.sqrt(MONKEYS[t].scale);
    if (st === ST_WIND && Math.random() < 0.5) A.sfxMonkey('ook', vol, pan, pitch);
    else if (st === ST_THROW) A.sfxMonkey('throw', vol, pan);
    else if (st === ST_POUNCE) A.sfxMonkey('pounce', vol, pan);
    else if (st === ST_FUSE && t === MK_NO) {
      const now = performance.now();
      if (now - this.beepAt > 120) {
        this.beepAt = now;
        for (let i = 0; i < 4; i++) setTimeout(() => A.sfxMonkey('beep', vol, pan), i * 140);
      }
    } else if (st === ST_DROP && Math.random() < 0.25) A.sfxMonkey('drop', vol, pan);
  }

  private ambientScreech(now: number) {
    if (now < this.screechAt) return;
    const m = this.model;
    const n = m.visibleMonkeys();
    this.screechAt = now + 350 + 2400 / Math.max(1, n);
    if (n === 0) return;
    for (let k = 0; k < 6; k++) {
      const sl = Math.floor(Math.random() * 160);
      if (!m.rmVisible[sl]) continue;
      const [vol, pan] = this.spatial(m.rmX[sl], m.rmZ[sl]);
      A.sfxMonkey('screech', vol * 0.8, pan, 1 / Math.sqrt(MONKEYS[m.mType[sl]].scale));
      break;
    }
  }

  /* ======================= SÚNG THEO MÓN ĐỒ ======================= */
  private weaponOfP(idx: number, cls: number, tier: number, wslot: number): WeaponDef {
    const ws = this.pWeapons.get(idx);
    return ws ? ws[wslot] ?? ws[0] : weaponOf(cls, tier);
  }
  private reloadOf(idx: number, cls: number, tier: number, wslot: number) {
    const w = this.weaponOfP(idx, cls, tier, wslot);
    return Math.max(1, Math.round(w.reload * (CLASSES[cls]?.reloadMul ?? 1)));
  }
  /** avatar cầm đúng khẩu đang chọn (ải), khẩu còn lại đeo sau lưng */
  private syncGun(a: Avatar, idx: number, wslot: number) {
    const ws = this.pWeapons.get(idx);
    if (!ws) return;
    const w = ws[wslot] ?? ws[0];
    a.setGun(w.model, w.color);
    a.showBackGun(ws.length > 1);
  }

  /* ======================= TÚI ĐỒ DƯỚI ĐẤT ======================= */
  private addLoot(l: GroundLoot) {
    this.loot.add(l);
    this.hud.loot.set(l.id, l);
  }

  /* ======================= CAMERA ======================= */
  cycleCamera() {
    const i = CAM_MODES.findIndex(([m]) => m === settings.camMode);
    const [next, name] = CAM_MODES[(i + 1) % CAM_MODES.length];

    settings.camMode = next;
    saveSettings();
    this.hud.feed(`🎥 Camera: ${name}`, '');
  }

  /** súng góc nhìn thứ nhất (gắn theo camera; avatar của mình ẩn) */
  private updateViewGun(on: boolean, cam: THREE.PerspectiveCamera, now: number, ads: boolean) {
    const w = curWeapon(this.model.pred);
    const key = `${w.model}|${w.color}`;
    if (on && (!this.viewGun || this.viewGun.key !== key)) {
      if (this.viewGun) this.s3.stage.scene.remove(this.viewGun.g);
      const gm = makeGunModel(w.model, w.color);
      const g = new THREE.Group();
      gm.g.scale.setScalar(0.85);
      g.add(gm.g);
      this.viewGun = { g, key };
      this.s3.stage.scene.add(g);
    }
    if (!this.viewGun) return;
    this.viewGun.g.visible = on;
    if (!on) return;
    const t = now / 1000;
    const sp = Math.hypot(this.model.pred.vx, this.model.pred.vz);
    const bob = Math.min(1, sp / 6) * 0.012;
    const rl = this.model.pred.reloadT > 0 ? Math.sin(Math.min(1, 1 - this.model.pred.reloadT / curReloadTicks(this.model.pred)) * Math.PI) : 0;
    // toạ độ trong không gian camera: phải-dưới-trước (ngắm: vào giữa)
    tmpV.set(ads ? 0 : 0.2, (ads ? -0.13 : -0.2) + Math.sin(t * 9) * bob - rl * 0.12 - this.recoilPitch * 0.4, -0.42 + this.recoilPitch * 0.6);
    tmpV.applyQuaternion(cam.quaternion).add(cam.position);
    this.viewGun.g.position.copy(tmpV);
    this.viewGun.g.quaternion.copy(cam.quaternion);
    this.viewGun.g.rotateY(Math.PI);
    this.viewGun.g.rotateX(-rl * 0.6);
  }

  /** bật / tắt ngắm nghía súng (main.ts lo khoá chuột) */
  onInspectKey: () => void = () => this.setInspect(!this.inspecting);
  setInspect(on: boolean) {
    if (on === this.inspecting) return;
    const meInf = this.model.info[this.me];
    if (on && meInf && (meInf.flags & PF_DOWN_MASK)) return;
    this.inspecting = on;
    this.inspYaw = 0;
    if (!on) {
      this.hud.showInspect(null);
      return;
    }
    const w = curWeapon(this.model.pred);
    // món đồ thật (để hiện phẩm + dòng phụ) nếu đang đăng nhập
    const eq = equippedMap(api.me);
    const it = this.model.pred.weapons ? eq.get(this.model.pred.wslot === 1 ? 'weapon2' : 'weapon1') : undefined;
    const def = it ? defOf(it.itemId) : undefined;
    const aff = it ? STAT_KEYS.filter((k) => it.affixes[k]).map((k) => [statInfo(k).name, fmtStat(k, it.affixes[k]!)] as [string, string]) : [];
    this.hud.showInspect(w, it && def ? { name: def.name, grade: it.grade, affixes: aff } : undefined);
  }
  /** kéo chuột khi đang ngắm nghía: xoay */
  inspectDrag(dx: number | null) {
    if (dx === null) { this.inspDrag = null; return; }
    this.inspDrag = dx;
    this.inspYaw += dx * 0.01;
  }

  /** nút kỹ năng trên màn hình cảm ứng */
  /** nút dao trên màn hình cảm ứng */
  pressKnife() {
    this.input.press(P_K);
  }

  pressSkill(which: 'g' | 'x' | 'q') {
    this.input.press(which === 'g' ? P_G : which === 'x' ? P_X : P_Q);
  }

  stop() {
    this.running = false;
    this.input.enabled = false;
    this.input.unlock();
    A.setHeartbeat(false);
  }

  destroy() {
    this.stop();
    for (const a of this.avatars.values()) {
      this.s3.stage.scene.remove(a.root, a.blob);
      a.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.avatars.clear();
    this.s3.stage.scene.remove(this.loot.group);
    this.loot.dispose();
    if (this.viewGun) this.s3.stage.scene.remove(this.viewGun.g);
    this.viewGun = null;
    this.s3.fx.clear();
    this.hud.destroy();
  }
}
