import {
  FAIL_LOCK_MS,
  HOOK_MS,
  LAND_LOCK_MS,
  REEL_MAX_TICKS,
  SPECIES,
  STEAL_CD_MS,
  STEP_MS,
  ST_BITE,
  ST_IDLE,
  ST_NIB,
  ST_REEL,
  ST_STUN,
  ST_WAIT,
  fishY,
  newReel,
  resetReel,
  stepReel,
  type ReelState,
} from '@shared/fishing';
import { sfx } from '../../utils/sound';

export interface FishingConfig {
  lakes: string[][];
  durationMs: number;
}

export interface Row {
  st: number;
  prog: number;
  pts: number;
  immuneUntil: number;
  cdUntil: number;
  heldSp: number;
  heldUntil: number;
}

/** hiệu ứng một lần cho cảnh 3D lấy ra mỗi khung hình */
export interface Fx {
  k: 'cast' | 'nib' | 'bite' | 'hook' | 'land' | 'esc' | 'steal' | 'stealFail' | 'early';
  seat: number;
  /** loài cá (land/steal) */
  sp?: number;
  /** người bị giật (steal) */
  to?: number;
  /** cá rời tay thật hay chỉ đang kéo (steal kind) */
  kind?: string;
}

export interface FeedItem {
  id: number;
  text: string;
  tone: 'me' | 'good' | 'bad' | 'info';
}

const HOLD_CAP = 318;

/**
 * Lõi CÂU CÁ ở client, nằm ngoài React (như FartCore): dự đoán ván kéo của chính mình bằng cùng hàm của server
 * và chỉnh lại khi server gửi trạng thái (replay từ tick server từ nhật ký giữ/nhả của mình).
 */
export class FishingCore {
  readonly lake: number;
  readonly seat: number;
  readonly ids: string[];
  rows: Row[];
  fx: Fx[] = [];
  feed: FeedItem[] = [];
  feedVer = 0;
  snapVer = 0;
  /** trạng thái dự đoán của chính mình */
  ls = ST_IDLE;
  private lsAt = 0;
  private lockUntil = 0;
  cls = 0;
  seed = 0;
  biteAt = 0;
  t0 = 0;
  tick = 0;
  reel: ReelState = newReel();
  private prevY = 0.5;
  /** 0 = đang kéo · 1 = đã đủ tiến độ (chờ server) · -1 = tuột (chờ server) */
  localEnd = 0;
  private sources = new Set<string>();
  hold = false;
  private hk = new Int16Array(HOLD_CAP + 2);
  private hv = new Uint8Array(HOLD_CAP + 2);
  private hn = 0;
  private hist = new Float32Array((REEL_MAX_TICKS + 3) * 3);
  private feedId = 0;
  private lastStealTry = 0;
  stealCdUntil = 0;
  /** lần cuối nhận snapshot (giờ server) */
  lastSnap = 0;
  nameOf: (seat: number) => string = (s) => `#${s + 1}`;
  /** khi nào kết thúc ván (giờ server) */
  endsAt: number;
  /** đã thấy hiện tượng nào gần đây: cho HUD báo "giật hụt", "đã bị giật"… */
  flash = '';
  flashUntil = 0;
  liveFn: () => boolean = () => true;

  constructor(
    readonly cfg: FishingConfig,
    readonly meId: string,
    readonly startAt: number,
    private send: (input: any) => void,
    private now: () => number,
  ) {
    let li = cfg.lakes.findIndex((l) => l.includes(meId));
    if (li < 0) li = 0;
    this.lake = li;
    this.ids = cfg.lakes[li] ?? [];
    this.seat = this.ids.indexOf(meId);
    this.rows = this.ids.map(() => ({ st: ST_IDLE, prog: 0, pts: 0, immuneUntil: 0, cdUntil: 0, heldSp: -1, heldUntil: 0 }));
    this.endsAt = startAt + cfg.durationMs;
  }

  nowMs(): number {
    return this.now();
  }

  get spectating() {
    return this.seat < 0;
  }

  /** trạng thái hiển thị của một ghế (của mình thì dùng bản dự đoán) */
  stOf(seat: number): number {
    return seat === this.seat ? this.ls : (this.rows[seat]?.st ?? ST_IDLE);
  }

  /** có thể quăng cần ngay không (để HUD hiện gợi ý) */
  canCast(): boolean {
    return this.ls === ST_IDLE && this.now() >= this.lockUntil;
  }

  private setLs(s: number) {
    this.ls = s;
    this.lsAt = this.now();
  }

  private push(text: string, tone: FeedItem['tone']) {
    this.feed.push({ id: ++this.feedId, text, tone });
    if (this.feed.length > 4) this.feed.shift();
    this.feedVer++;
  }

  private flashMsg(text: string, ms = 1400) {
    this.flash = text;
    this.flashUntil = this.now() + ms;
  }

  /* ---------------- đầu vào của người chơi ---------------- */
  down(src: string) {
    const was = this.sources.size > 0;
    this.sources.add(src);
    if (was) return;
    this.press();
  }

  up(src: string) {
    this.sources.delete(src);
    if (this.sources.size === 0 && this.ls === ST_REEL) this.setHold(false);
  }

  releaseAll() {
    this.sources.clear();
    if (this.ls === ST_REEL) this.setHold(false);
  }

  private press() {
    if (this.spectating || !this.liveFn()) return;
    const now = this.now();
    if (now >= this.endsAt) return;
    switch (this.ls) {
      case ST_IDLE:
        if (now < this.lockUntil) return;
        this.setLs(ST_WAIT);
        this.send({ type: 'fcast' });
        this.fx.push({ k: 'cast', seat: this.seat });
        sfx.fishCast();
        return;
      case ST_WAIT:
      case ST_NIB:
        // giật sớm → kéo cần về
        this.send({ type: 'fhook', at: now });
        this.setLs(ST_IDLE);
        this.lockUntil = now + FAIL_LOCK_MS;
        this.fx.push({ k: 'early', seat: this.seat });
        this.flashMsg('Giật sớm quá! Cá sợ chạy mất');
        sfx.miss();
        return;
      case ST_BITE:
        this.startReel(now);
        this.send({ type: 'fhook', at: now });
        this.fx.push({ k: 'hook', seat: this.seat });
        sfx.fishHook();
        this.setHold(true);
        return;
      case ST_REEL:
        this.setHold(true);
        return;
    }
  }

  private startReel(at: number) {
    this.setLs(ST_REEL);
    this.t0 = at;
    this.tick = 0;
    this.hn = 0;
    this.hold = false;
    this.localEnd = 0;
    resetReel(this.reel);
    this.prevY = this.reel.y;
    this.hist[0] = this.reel.y;
    this.hist[1] = this.reel.v;
    this.hist[2] = this.reel.p;
  }

  private setHold(h: boolean) {
    if (this.hold === h || this.ls !== ST_REEL) return;
    this.hold = h;
    const k = Math.max(this.tick, Math.floor((this.now() - this.t0) / STEP_MS));
    const n = this.hn;
    if (n > 0 && this.hk[n - 1] === k) this.hv[n - 1] = h ? 1 : 0;
    else if (n < HOLD_CAP) {
      this.hk[n] = k;
      this.hv[n] = h ? 1 : 0;
      this.hn = n + 1;
    }
    this.send({ type: 'fhold', h: h ? 1 : 0, k });
    if (h) sfx.tap();
  }

  /** nút GIẬT; `to` = ghế muốn giật (bỏ trống = server tự chọn cá ngon nhất) */
  steal(toSeat?: number) {
    if (this.spectating || !this.liveFn()) return;
    const now = this.now();
    if (now >= this.endsAt || this.ls === ST_REEL || this.ls === ST_STUN) return;
    if (now < this.stealCdUntil || now - this.lastStealTry < 300) return;
    this.lastStealTry = now;
    const to = toSeat !== undefined && toSeat !== this.seat ? this.ids[toSeat] : undefined;
    this.send(to ? { type: 'fsteal', to } : { type: 'fsteal' });
    sfx.fishStealTry();
  }

  /* ---------------- vòng lặp mỗi khung hình ---------------- */
  frame() {
    if (this.ls !== ST_REEL || this.localEnd !== 0) return;
    const now = this.now();
    const cur = Math.min(REEL_MAX_TICKS, Math.floor((now - this.t0) / STEP_MS));
    while (this.tick < cur && this.localEnd === 0) {
      this.prevY = this.reel.y;
      const res = stepReel(this.reel, this.holdAt(this.tick), this.cls, this.seed, this.tick);
      this.tick++;
      const b = this.tick * 3;
      this.hist[b] = this.reel.y;
      this.hist[b + 1] = this.reel.v;
      this.hist[b + 2] = this.reel.p;
      if (res !== 0) this.localEnd = res;
    }
  }

  private holdAt(t: number): boolean {
    let h = false;
    for (let i = 0; i < this.hn && this.hk[i] <= t; i++) h = this.hv[i] === 1;
    return h;
  }

  /** vị trí thanh đã nội suy giữa hai bước (0..1) */
  barY(now: number): number {
    if (this.ls !== ST_REEL) return 0.5;
    const f = Math.min(1, Math.max(0, (now - this.t0) / STEP_MS - this.tick));
    return this.localEnd !== 0 ? this.reel.y : this.prevY + (this.reel.y - this.prevY) * f;
  }

  /** vị trí cá (0..1) tại giờ server `now` */
  fishAt(now: number): number {
    return fishY(this.seed, this.cls, Math.min(REEL_MAX_TICKS, (now - this.t0) / STEP_MS));
  }

  /** thời gian còn lại để giật cần (ms), âm nếu hết */
  hookLeft(now: number): number {
    return this.biteAt + HOOK_MS - now;
  }

  /* ---------------- tin nhắn từ server ---------------- */
  onMessage(p: any) {
    const now = this.now();
    switch (p.type) {
      case 'sn': {
        this.lastSnap = now;
        const r = p.r as number[][];
        for (let i = 0; i < r.length && i < this.rows.length; i++) {
          const o = this.rows[i];
          const a = r[i];
          o.st = a[0];
          o.prog = a[1];
          o.pts = a[2];
          o.immuneUntil = a[3] > 0 ? now + a[3] * 100 : 0;
          o.cdUntil = a[4] > 0 ? now + a[4] * 100 : 0;
          o.heldSp = a[5];
          o.heldUntil = a[6] > 0 ? now + a[6] * 100 : 0;
        }
        const me = this.rows[this.seat];
        if (me) {
          if (me.cdUntil > this.stealCdUntil) this.stealCdUntil = me.cdUntil;
          // lệch pha quá lâu so với server → tin server (trừ lúc lệnh của mình còn đang bay)
          if (me.st !== this.ls && now - this.lsAt > 700 && this.ls !== ST_REEL) this.adopt(me.st);
          else if (this.ls === ST_REEL && me.st !== ST_REEL && me.st !== ST_BITE && now - this.lsAt > 900) this.adopt(me.st);
        }
        this.snapVer++;
        return;
      }
      case 'st': {
        if (this.rows[p.i]) this.rows[p.i].st = p.s;
        if (p.i === this.seat) {
          if (p.s === ST_NIB) {
            this.setLs(ST_NIB);
            this.fx.push({ k: 'nib', seat: p.i });
            sfx.fishNib();
          } else if (p.s === ST_BITE) {
            if (this.ls !== ST_BITE) this.setLs(ST_BITE);
            this.fx.push({ k: 'bite', seat: p.i });
            sfx.fishBite();
          } else if (p.s === ST_IDLE && this.ls !== ST_IDLE) {
            this.setLs(ST_IDLE);
          } else if (p.s === ST_STUN) {
            this.setLs(ST_STUN);
          } else if (p.s === ST_WAIT && this.ls === ST_IDLE) {
            this.setLs(ST_WAIT);
          }
        } else if (p.s === ST_WAIT) this.fx.push({ k: 'cast', seat: p.i });
        else if (p.s === ST_BITE) this.fx.push({ k: 'bite', seat: p.i });
        else if (p.s === ST_NIB) this.fx.push({ k: 'nib', seat: p.i });
        return;
      }
      case 'bite':
        this.cls = p.cls;
        this.seed = p.seed;
        this.biteAt = p.at;
        if (this.ls === ST_NIB || this.ls === ST_WAIT) this.setLs(ST_BITE);
        return;
      case 'rs':
        this.onRs(p.k, p.y / 1000, p.v / 1000, p.p / 1000);
        return;
      case 'esc':
        if (p.i === this.seat) {
          this.setLs(ST_IDLE);
          this.sources.clear();
          this.lockUntil = now + FAIL_LOCK_MS;
          if (p.why === 'reel') {
            this.flashMsg('Cá tuột câu mất rồi!');
            sfx.fishEscape();
          } else if (p.why === 'late') {
            this.flashMsg('Chậm quá, cá nhả mồi!');
            sfx.miss();
          }
          this.fx.push({ k: 'esc', seat: p.i });
        } else if (p.why === 'reel') this.fx.push({ k: 'esc', seat: p.i });
        return;
      case 'land': {
        const sp = SPECIES[p.sp];
        const o = this.rows[p.i];
        if (o) {
          o.heldSp = p.v > 0 ? p.sp : o.heldSp;
          o.heldUntil = p.u > 0 ? p.u : 0;
        }
        this.fx.push({ k: 'land', seat: p.i, sp: p.sp });
        const mine = p.i === this.seat;
        if (mine) {
          this.setLs(ST_IDLE);
          this.lockUntil = now + LAND_LOCK_MS;
          this.sources.clear();
          this.hold = false;
          const pts = p.v > 0 ? `+${p.v}` : `${p.v}`;
          this.flashMsg(`${sp.emoji} ${sp.name} ${pts}`, 1800);
          this.push(`Bạn câu được ${sp.emoji} ${sp.name} (${pts})`, p.v > 0 ? 'me' : 'bad');
          if (sp.tier === 'trash') sfx.fishTrash();
          else sfx.fishLand(sp.tier === 'legend' ? 2 : sp.tier === 'rare' ? 1 : 0);
        } else if (sp.tier !== 'common' || p.v < 0) {
          this.push(`${this.nameOf(p.i)} câu được ${sp.emoji} ${sp.name}`, p.v < 0 ? 'info' : 'good');
        }
        return;
      }
      case 'stl': {
        const by = this.nameOf(p.by);
        const from = this.nameOf(p.from);
        const o = this.rows[p.from];
        if (p.ok) {
          const sp = SPECIES[p.sp];
          if (o) o.immuneUntil = now + 3800;
          if (o && p.k === 'l') o.heldUntil = 0;
          this.fx.push({ k: 'steal', seat: p.by, to: p.from, sp: p.sp, kind: p.k });
          if (p.by === this.seat) {
            this.stealCdUntil = Math.max(this.stealCdUntil, now + STEAL_CD_MS);
            this.setLs(ST_IDLE);
            this.sources.clear();
            this.lockUntil = now + 450;
            this.flashMsg(`🪝 Giật được ${sp.emoji} ${sp.name} ${p.g >= 0 ? '+' : ''}${p.g}`, 1800);
            this.push(`Bạn giật ${sp.emoji} ${sp.name} của ${from} (${p.g >= 0 ? '+' : ''}${p.g})`, p.g >= 0 ? 'me' : 'bad');
            sfx.fishSteal();
          } else if (p.from === this.seat) {
            if (this.ls === ST_REEL) this.setLs(ST_IDLE);
            this.sources.clear();
            this.hold = false;
            this.lockUntil = now + LAND_LOCK_MS;
            this.flashMsg(`😭 ${by} giật mất ${sp.emoji} ${sp.name}!`, 2000);
            this.push(`${by} giật mất ${sp.emoji} ${sp.name} của bạn`, 'bad');
            sfx.fishRobbed();
          } else this.push(`${by} giật ${sp.emoji} ${sp.name} của ${from}`, 'info');
        } else {
          this.fx.push({ k: 'stealFail', seat: p.by, to: p.from });
          if (p.by === this.seat) {
            this.stealCdUntil = Math.max(this.stealCdUntil, now + STEAL_CD_MS);
            this.setLs(ST_STUN);
            this.sources.clear();
            this.flashMsg('💫 Giật hụt! Bị choáng', 2000);
            this.push(`Giật hụt ${from}! (${p.g})`, 'bad');
            sfx.fishStealFail();
          } else this.push(`${by} giật hụt ${from}`, 'info');
        }
        return;
      }
      case 'ns':
        this.stealCdUntil = Math.min(this.stealCdUntil, now);
        this.flashMsg('Chưa có cá nào để giật', 1000);
        return;
    }
  }

  private adopt(s: number) {
    this.setLs(s);
    this.sources.clear();
    this.hold = false;
  }

  private onRs(k: number, y: number, v: number, p: number) {
    if (this.ls !== ST_REEL || k > this.tick || k < 0 || k > REEL_MAX_TICKS) return;
    const b = k * 3;
    if (Math.abs(this.hist[b + 2] - p) < 0.02 && Math.abs(this.hist[b] - y) < 0.05) return;
    // lệch → lấy trạng thái server rồi chạy lại các bước từ k tới hiện tại bằng nhật ký giữ/nhả của mình
    this.reel.y = y;
    this.reel.v = v;
    this.reel.p = p;
    this.hist[b] = y;
    this.hist[b + 1] = v;
    this.hist[b + 2] = p;
    this.localEnd = 0;
    for (let t = k; t < this.tick; t++) {
      this.prevY = this.reel.y;
      const res = stepReel(this.reel, this.holdAt(t), this.cls, this.seed, t);
      const q = (t + 1) * 3;
      this.hist[q] = this.reel.y;
      this.hist[q + 1] = this.reel.v;
      this.hist[q + 2] = this.reel.p;
      if (res !== 0) {
        this.localEnd = res;
        break;
      }
    }
  }
}
