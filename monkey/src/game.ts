// Một ván đang chơi: nối GameModel (dự đoán/nội suy) với Three.js, âm thanh, HUD và input.

import * as THREE from 'three';
import { GameModel } from '@shared/monkey/client';
import { CLASSES, MK_NO, MK_VUA, MONKEYS, WEAPONS, headY } from '@shared/monkey/content';
import { PLAYER_SPAWNS, rayWorld } from '@shared/monkey/map';
import {
  FX_BUILD, FX_EXPLODE, FX_HEAL, FX_PICK, FX_PLAYERHIT, FX_REPAIR, FX_ROAR, FX_SHOCK, FX_SLAM, FX_SPLAT, FX_STOMP,
  PF_ADS, PF_BRACE, PF_DOWN_MASK, PF_REVIVING, PF_SPRINT, SnapData, decodeSnap, type SMsg,
} from '@shared/monkey/proto';
import { B_USE, EYE_Y, P_G, P_Q, P_X, SHOULDER, type Cmd } from '@shared/monkey/sim';
import * as A from './audio';
import { Input } from './input';
import { net } from './net';
import { Avatar } from './render/avatars';
import { Fx } from './render/fx';
import { MonkeyRenderer } from './render/monkeys';
import { blobTex, type Stage } from './render/scene';
import { settings } from './settings';
import { Hud, type HudPlayer } from './ui/hud';
import { toast } from './ui/dom';
import { ST_FUSE, ST_POUNCE, ST_THROW, ST_WIND, ST_DROP } from '@shared/monkey/proto';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const SHOT_COLORS = [0xfff2a8, 0xa8ffcb, 0xffd0a0, 0xffb0b0];

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

  constructor(private s3: Shared3D, readonly input: Input, players: HudPlayer[], me: number) {
    this.players = players;
    this.me = me;
    const meP = players.find((p) => p.idx === me)!;
    const sp = PLAYER_SPAWNS[me] ?? PLAYER_SPAWNS[0];
    this.model = new GameModel(me, meP.cls, sp.x, sp.z);
    input.yaw = Math.atan2(sp.x, sp.z);
    input.pitch = -0.12;
    this.hud = new Hud();
    this.hud.setPlayers(players, me);
    document.getElementById('app')!.prepend(this.hud.root);
    for (const p of players) {
      const a = new Avatar(p.cls, this.blobT, p.idx);
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
        A.sfxUlt();
        break;
      }
      case 'skill': {
        const av = this.avatars.get(m.i ?? -1);
        const id = CLASSES[this.players.find((p) => p.idx === m.i)?.cls ?? 0].id;
        if (av) av.skill(m.s === 'g' ? (id === 'dausi' ? 'stomp' : id === 'kysu' ? 'build' : 'throw') : id === 'dausi' ? 'brace' : 'build');
        break;
      }
      case 'buy':
        if (m.i === this.me) {
          A.sfxBuy();
          hud.feed(m.s === 'weapon' ? `🔫 ${WEAPONS[m.v ?? 0].name}` : `❤️ Máu bậc ${m.v}`, 'gold');
        } else hud.feed(`${name(m.i)} nâng ${m.s === 'weapon' ? WEAPONS[m.v ?? 0].short : 'máu'}`, '');
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
    m.frame(now, this.inp.mx, this.inp.mz, this.inp.yaw, this.inp.pitch, this.inp.btn, this.cmds);
    if (this.cmds.length) {
      this.lastCmd = this.cmds[this.cmds.length - 1];
      net.queueCmds(this.cmds, now);
    } else net.queueCmds(this.cmds, now);

    if (down && !this.wasDown) input.resetKeys();
    this.wasDown = down;
    A.setHeartbeat(!!me && !down && me.hp > 0 && me.hp < me.maxHp * 0.25);

    // ---- camera qua vai ----
    const ads = (this.inp.btn & 2) !== 0 && !down;
    const yaw = input.yaw;
    const pitch = input.pitch;
    const wantDist = (down ? 4.5 : settings.camDist) * (ads ? 0.62 : 1);
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
    const hit = rayWorld(ox, oy, oz, -dx, -dy, -dz, dist + 0.3);
    if (hit < dist + 0.3) dist = Math.max(0.4, hit - 0.3);
    let cx = ox - dx * dist, cyy = oy - dy * dist, cz = oz - dz * dist;
    if (cyy < 0.25) cyy = 0.25;
    // rung
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * settings.shake;
    if (sh > 0) {
      cx += (Math.random() - 0.5) * sh * 0.35;
      cyy += (Math.random() - 0.5) * sh * 0.35;
      cz += (Math.random() - 0.5) * sh * 0.35;
    }
    cam.position.set(cx, cyy, cz);
    cam.lookAt(cx + dx, cyy + dy, cz + dz);
    stage.followShadow(m.rx, m.rz);

    // ---- nhân vật ----
    for (const p of this.players) {
      const a = this.avatars.get(p.idx)!;
      const inf = m.info[p.idx];
      if (inf) a.setTier(inf.tier);
      if (p.idx === this.me) {
        const sp2 = Math.hypot(m.pred.vx, m.pred.vz);
        const rl = m.pred.reloadT > 0 ? 1 - m.pred.reloadT / WEAPONS[m.pred.tier].reload : -1;
        a.update({
          x: m.rx, y: m.ry, z: m.rz, yaw, pitch, dt, t: now / 1000, down, ads,
          sprint: sp2 > 7, brace: m.pred.braceT > 0, rage: !!inf && inf.shield > 0,
          reviving: (this.inp.btn & B_USE) !== 0 && !!inf && (inf.flags & PF_REVIVING) !== 0, reload: rl,
        });
        a.setVisible(dist > 1.1);
      } else if (inf) {
        a.update({
          x: m.oX[p.idx], y: m.oY[p.idx], z: m.oZ[p.idx], yaw: m.oYaw[p.idx], pitch: m.oPitch[p.idx], dt, t: now / 1000,
          down: inf.flags & PF_DOWN_MASK, ads: (inf.flags & PF_ADS) !== 0, sprint: (inf.flags & PF_SPRINT) !== 0,
          brace: (inf.flags & PF_BRACE) !== 0, rage: inf.shield > 0, reviving: (inf.flags & PF_REVIVING) !== 0,
          reload: inf.reloadT > 0 ? 1 - inf.reloadT / WEAPONS[inf.tier].reload : -1,
        });
      }
    }

    // ---- sự kiện → hiệu ứng + âm thanh ----
    this.handleFx(now);

    // ---- khỉ, hiệu ứng, cảnh ----
    this.s3.monkeys.update(m, now / 1000, dt, cam.position, cam.quaternion);
    this.s3.fx.update(m, dt, now / 1000);
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
          const w = WEAPONS[e.a];
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
          const tier = m.pred.tier;
          if (WEAPONS[tier].splashR > 0) {
            const dx = e.x - tmpV.x, dy = e.y - tmpV.y, dz = e.z - tmpV.z;
            const d = Math.hypot(dx, dy, dz) || 1;
            fx.ownShells.push({ x: tmpV.x, y: tmpV.y, z: tmpV.z, dx: dx / d, dy: dy / d, dz: dz / d, dist: d, t: 0, boom: true });
          } else {
            fx.tracer(tmpV.x, tmpV.y, tmpV.z, e.x, e.y, e.z, SHOT_COLORS[this.me], 0.06);
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
          const w = inf ? WEAPONS[inf.tier] : null;
          if (!w || w.splashR === 0) fx.tracer(tmpV.x, tmpV.y, tmpV.z, tmpV2.x, tmpV2.y, tmpV2.z, shooter >= 100 ? 0x9cff9c : SHOT_COLORS[shooter & 3], 0.07);
          fx.muzzleFlash(tmpV, false, !!w && w.pellets > 1);
          const [vol, pan] = this.spatial(tmpV.x, tmpV.z);
          A.sfxGun(shooter >= 100 ? 'turret' : w?.sound ?? 'pistol', vol * 0.7, pan);
          break;
        }
        case 'fx':
          this.worldFx(e.a, e.x, e.z, e.b, e.c);
          break;
        case 'reload':
          A.sfxReload(m.pred.tier);
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

  /** nút kỹ năng trên màn hình cảm ứng */
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
    this.s3.fx.clear();
    this.hud.destroy();
  }
}
