// "Bộ não" bot cho SINH TỒN BẦY KHỈ — dùng chung cho mô phỏng thời gian ảo và bot WebSocket thật.
// Chỉ đọc GameModel (đúng những gì một client thật nhìn thấy) rồi trả input như người chơi.

import { GameModel } from '../../shared/monkey/client.js';
import { CLASSES, HP_TIER_COST, MAX_HP_TIER, MAX_TIER, ULT_KILLS, WEAPONS, bodyY } from '../../shared/monkey/content.js';
import { ARENA } from '../../shared/monkey/map.js';
import { FX_SHOCK, PF_DOWN_MASK } from '../../shared/monkey/proto.js';
import { B_FIRE, B_JUMP, B_RELOAD, B_SPRINT, B_USE, EYE_Y, P_C, P_G, P_Q, P_V, P_X } from '../../shared/monkey/sim.js';

export interface BotInput { mx: number; mz: number; yaw: number; pitch: number; btn: number }

export class BotBrain {
  /** sai số ngắm (radian) — mô phỏng tay người */
  aimNoise: number;
  /** thời gian phản xạ đổi mục tiêu (ms) */
  react: number;
  private target = -1;
  private targetAt = 0;
  private yawRad = 0;
  private pitchRad = 0;
  private strafe = 1;
  private strafeAt = 0;
  private shocks: { x: number; z: number; t: number }[] = [];
  private lastBuy = 0;
  private rng: () => number;
  wantBreakReady = false;

  constructor(seed: number, skill = 0.6) {
    let a = seed >>> 0 || 7;
    this.rng = () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
    this.aimNoise = 0.07 - skill * 0.05;
    this.react = 420 - skill * 250;
  }

  think(m: GameModel, now: number): BotInput {
    const me = m.info[m.me];
    const out: BotInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, btn: 0 };
    const x = m.rx, z = m.rz;
    // sóng xung kích boss (nhảy để né)
    for (const e of m.fx) if (e.k === 'fx' && e.a === FX_SHOCK) this.shocks.push({ x: e.x, z: e.z, t: now });
    m.fx.length = 0;
    this.shocks = this.shocks.filter((s) => now - s.t < 1500);

    const down = me ? me.flags & PF_DOWN_MASK : 0;
    // ---- tìm khỉ gần nhất ----
    let best = -1, bd = 1e9;
    let near = 0;
    let cx = 0, cz = 0;
    for (let sl = 0; sl < 160; sl++) {
      if (!m.rmVisible[sl]) continue;
      const dx = m.rmX[sl] - x, dz = m.rmZ[sl] - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 7) { near++; cx += dx / (d || 1); cz += dz / (d || 1); }
      // ưu tiên khỉ nổ / khỉ gần
      const pr = d - (m.mType[sl] === 3 ? 4 : 0);
      if (pr < bd) { bd = pr; best = sl; }
    }
    if (best !== this.target && now - this.targetAt > this.react) {
      this.target = best;
      this.targetAt = now;
    }
    const tgt = this.target >= 0 && m.rmVisible[this.target] ? this.target : best;

    // ---- đồng đội gục ----
    let rescue = -1, rd = 1e9;
    for (let i = 0; i < 4; i++) {
      if (i === m.me || !m.info[i] || !m.infoValid[i]) continue;
      if ((m.info[i].flags & PF_DOWN_MASK) !== 1) continue;
      const d = Math.hypot(m.oX[i] - x, m.oZ[i] - z);
      if (d < rd) { rd = d; rescue = i; }
    }

    let wantX = 0, wantZ = 0;
    if (tgt >= 0) {
      const dx = m.rmX[tgt] - x, dz = m.rmZ[tgt] - z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const ty = Math.atan2(dx, dz);
      const tp = Math.atan2(bodyY(m.mType[tgt]) - (EYE_Y + m.ry), d);
      // xoay tâm ngắm mượt về mục tiêu + nhiễu tay
      let dyaw = ty - this.yawRad;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yawRad += dyaw * 0.35 + (this.rng() - 0.5) * this.aimNoise;
      this.pitchRad += (tp - this.pitchRad) * 0.35 + (this.rng() - 0.5) * this.aimNoise * 0.5;
      const aimed = Math.abs(dyaw) < 0.12;
      const w = WEAPONS[me?.tier ?? 0];
      if (aimed && d < w.range * 0.9 && !down) out.btn |= B_FIRE;
      // thả diều: lùi ra khi khỉ áp sát, đi ngang
      if (now - this.strafeAt > 1800 + this.rng() * 1500) { this.strafe = -this.strafe; this.strafeAt = now; }
      const fx = dx / d, fz = dz / d;
      if (bd < 6 || near >= 3) {
        wantX = -fx - (near ? cx / near : 0) * 0.5;
        wantZ = -fz - (near ? cz / near : 0) * 0.5;
      } else if (bd > 16) {
        wantX = fx * 0.4;
        wantZ = fz * 0.4;
      }
      wantX += -fz * this.strafe * 0.6;
      wantZ += fx * this.strafe * 0.6;
    } else {
      // không thấy khỉ: về gần giữa sân
      const d = Math.hypot(x, z);
      if (d > 8) { wantX = -x / d; wantZ = -z / d; }
      if (me && me.ammo < WEAPONS[me.tier].mag * 0.6) out.btn |= B_RELOAD;
    }
    // né mép sân
    const edge = ARENA - 4;
    if (x > edge) wantX -= 1.5; else if (x < -edge) wantX += 1.5;
    if (z > edge) wantZ -= 1.5; else if (z < -edge) wantZ += 1.5;

    // cứu đồng đội khi không bị vây
    if (rescue >= 0 && near < 3 && !down) {
      const dx = m.oX[rescue] - x, dz = m.oZ[rescue] - z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 1.6) { wantX = dx / d; wantZ = dz / d; if (d > 6) out.btn |= B_SPRINT; out.btn &= ~B_FIRE; }
      else { wantX = 0; wantZ = 0; out.btn |= B_USE; out.btn &= ~B_FIRE; }
    }
    if (down) {
      // bò về phía đồng đội đang đứng gần nhất
      let bi = -1, bdd = 1e9;
      for (let i = 0; i < 4; i++) {
        if (i === m.me || !m.info[i] || !m.infoValid[i] || (m.info[i].flags & PF_DOWN_MASK)) continue;
        const d = Math.hypot(m.oX[i] - x, m.oZ[i] - z);
        if (d < bdd) { bdd = d; bi = i; }
      }
      if (bi >= 0 && bdd > 1.5) { wantX = (m.oX[bi] - x) / bdd; wantZ = (m.oZ[bi] - z) / bdd; }
      else { wantX = 0; wantZ = 0; }
    }
    // né sóng xung kích: nhảy khi vòng sóng sắp tới
    for (const s of this.shocks) {
      const r = ((now - s.t) / 1000) * 11;
      const d = Math.hypot(x - s.x, z - s.z);
      if (Math.abs(d - r) < 2.2) out.btn |= B_JUMP;
    }

    // đổi hướng di chuyển thế giới → trục cục bộ theo yaw
    const sy = Math.sin(this.yawRad), cyw = Math.cos(this.yawRad);
    const len = Math.hypot(wantX, wantZ);
    if (len > 0.05) {
      const ux = wantX / len, uz = wantZ / len;
      out.mz = Math.round((ux * sy + uz * cyw) * 127);
      out.mx = Math.round((ux * -cyw + uz * sy) * 127);
    }
    out.yaw = Math.round((this.yawRad / (Math.PI * 2)) * 65536) & 0xffff;
    out.pitch = Math.max(-13000, Math.min(13000, Math.round((this.pitchRad / (Math.PI * 2)) * 65536)));

    // ---- mua sắm + kỹ năng ----
    if (me && !down && now - this.lastBuy > 700) {
      const cls = CLASSES[me.cls];
      const wc = me.tier < MAX_TIER ? WEAPONS[me.tier + 1].cost : 1e9;
      const hc = me.hpTier < MAX_HP_TIER ? HP_TIER_COST[me.hpTier + 1] : 1e9;
      if (me.cash >= wc && (wc <= hc * 1.6 || me.cash >= wc + hc)) { out.btn |= P_V; this.lastBuy = now; }
      else if (me.cash >= hc && me.cash - hc > 40 && hc * 1.6 < wc) { out.btn |= P_C; this.lastBuy = now; }
      else if (near >= 3 && me.cdG === 0 && me.cash >= cls.g.cost + 120) { out.btn |= P_G; this.lastBuy = now; }
      else if (near >= 4 && me.cdX === 0 && me.cash >= cls.x.cost + 150) { out.btn |= P_X; this.lastBuy = now; }
      else if (me.ult >= 255 && near >= 3) { out.btn |= P_Q; this.lastBuy = now; }
      void ULT_KILLS;
    }
    this.wantBreakReady = m.phase === 2;
    return out;
  }
}
