// Điều khiển: bàn phím + chuột (Pointer Lock) và cảm ứng (cần ảo + kéo để ngắm + nút).
// Trả về input mỗi khung hình theo trục cục bộ (mx phải+, mz tới+), góc nhìn và nút bấm.

import { B_ADS, B_FIRE, B_JUMP, B_RELOAD, B_SPRINT, B_USE, P_C, P_G, P_K, P_Q, P_V, P_X } from '@shared/monkey/sim';
import { settings, type Action } from './settings';

export class Input {
  yaw = 0; // radian
  pitch = -0.12;
  private keys = new Set<string>();
  private pressed = 0;
  mouseFire = false;
  mouseAds = false;
  adsLatched = false;
  locked = false;
  enabled = false;
  /** callback hành động giao diện */
  onAction: (a: 'shop' | 'scoresOn' | 'scoresOff' | 'pause' | 'touchpad') => void = () => {};
  /** đổi chế độ điều khiển (chuột ↔ cảm ứng) — giao diện bật/tắt nút ảo theo */
  onMode: (touch: boolean) => void = () => {};
  /** false = chưa được điều khiển (ví dụ chưa vào toàn màn hình) → bỏ qua mọi thao tác */
  gate: () => boolean = () => true;
  /** cảm ứng */
  touch = false;
  private stickId = -1;
  private stickOX = 0;
  private stickOY = 0;
  stickX = 0;
  stickY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  touchFire = false;
  touchSprint = false;
  touchJump = false;
  touchUse = false;
  /** độ nhạy hiện hành nhân thêm (ngắm trúng mục tiêu trên cảm ứng) */
  assistSlow = 1;
  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    // Chọn chế độ theo THIẾT BỊ ĐANG DÙNG, không theo "máy có cảm ứng hay không":
    // laptop Windows màn cảm ứng có 'ontouchstart' nhưng người chơi vẫn dùng chuột/touchpad.
    // Bắt đầu bằng chuột nếu có bất kỳ con trỏ chính xác nào; chạm màn hình thì chuyển sang cảm ứng, rê chuột thì quay lại.
    this.touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
    window.addEventListener('pointerdown', (e) => this.setMode(e.pointerType === 'touch'), true);
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && (e.movementX !== 0 || e.movementY !== 0)) this.setMode(false);
    }, true);
    window.addEventListener('touchstart', () => this.setMode(true), { capture: true, passive: true });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFire = false;
      this.mouseAds = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouseFire = false;
        this.mouseAds = false;
        if (this.enabled && !this.touch) this.onAction('pause');
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled || !this.gate()) return;
      this.noteMouse(performance.now());
      this.look(e.movementX, e.movementY, settings.sens * 0.0022 * (this.ads ? settings.adsSens : 1));
    });
    canvas.addEventListener('mousedown', (e) => {
      // chưa khoá chuột / chưa toàn màn hình: main.ts bắt cú bấm này (pointerdown trên document) để vào lại
      if (!this.enabled || this.touch || !this.locked || !this.gate()) return;
      if (e.button === 0) this.mouseFire = true;
      else if (e.button === 2) {
        if (settings.adsToggle) this.adsLatched = !this.adsLatched;
        this.mouseAds = true;
      } else this.keyCode(`Mouse${e.button}`, true);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      else if (e.button === 2) this.mouseAds = false;
      else this.keyCode(`Mouse${e.button}`, false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setMode(touch: boolean) {
    if (touch === this.touch) return;
    this.touch = touch;
    if (touch) this.unlock();
    this.onMode(touch);
    // vừa chuyển từ cảm ứng sang chuột bằng một cú bấm (cử chỉ người dùng) → xin khoá chuột luôn
    if (!touch && this.enabled) this.lock();
  }

  /* ---------- phát hiện touchpad bị Windows khoá khi gõ phím ---------- */
  private lastMouse = 0;
  private holdSince = 0;
  private mouseBeforeHold = 0;
  private mouseInHold = false;
  private pendingCheck = 0;
  private strikes = 0;
  private hinted = false;
  private noteMouse(now: number) {
    if (this.holdSince) this.mouseInHold = true;
    if (this.pendingCheck && now - this.pendingCheck < 700) {
      // chuột "sống lại" ngay khi nhả phím → rất có thể touchpad bị khoá lúc gõ
      this.strikes++;
      if (this.strikes >= 2 && !this.hinted) {
        this.hinted = true;
        this.onAction('touchpad');
      }
    }
    this.pendingCheck = 0;
    this.lastMouse = now;
  }

  /** gọi mỗi khung hình: xoay camera bằng phím + theo dõi touchpad */
  tick(dt: number, now: number) {
    if (!this.enabled || !this.gate()) return;
    const k = ((settings.keyTurn * Math.PI) / 180) * dt;
    if (this.bound('turnLeft')) this.look(-k / 0.0022 / Math.max(0.05, settings.sens), 0, settings.sens * 0.0022);
    if (this.bound('turnRight')) this.look(k / 0.0022 / Math.max(0.05, settings.sens), 0, settings.sens * 0.0022);
    if (this.bound('lookUp')) this.pitch = Math.min(1.2, this.pitch + k * 0.6);
    if (this.bound('lookDown')) this.pitch = Math.max(-1.2, this.pitch - k * 0.6);
    const held = this.bound('forward') || this.bound('back') || this.bound('left') || this.bound('right');
    if (held && !this.holdSince) {
      this.holdSince = now;
      this.mouseInHold = false;
      this.mouseBeforeHold = this.lastMouse;
    } else if (!held && this.holdSince) {
      if (this.locked && now - this.holdSince > 900 && !this.mouseInHold && this.mouseBeforeHold && this.holdSince - this.mouseBeforeHold < 1500) this.pendingCheck = now;
      this.holdSince = 0;
    }
  }

  lock() {
    if (this.touch || document.pointerLockElement === this.canvas) return;
    try {
      const r = (this.canvas as any).requestPointerLock({ unadjustedMovement: true });
      if (r && typeof r.catch === 'function') {
        r.catch(() => {
          // trình duyệt không hỗ trợ unadjustedMovement / chưa cho phép: thử lại kiểu thường, nuốt lỗi
          try {
            const r2 = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
            r2?.catch?.(() => {});
          } catch {
            /* bỏ qua */
          }
        });
      }
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* bỏ qua */
      }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get ads() {
    return settings.adsToggle ? this.adsLatched : this.mouseAds;
  }

  private look(dx: number, dy: number, k: number) {
    this.yaw -= dx * k * this.assistSlow;
    this.pitch -= dy * k * (settings.invertY ? -1 : 1) * this.assistSlow;
    const lim = 1.2;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  private bound(a: Action) {
    return this.keys.has(settings.keys[a]);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    if (!this.enabled) return;
    if (e.code === settings.keys.scores || e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    this.keyCode(e.code, down);
  }

  private keyCode(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    if (!down) {
      if (code === settings.keys.scores) this.onAction('scoresOff');
      return;
    }
    const k = settings.keys;
    if (code === k.skillG) this.pressed |= P_G;
    if (code === k.skillX) this.pressed |= P_X;
    if (code === k.ult) this.pressed |= P_Q;
    if (code === k.knife) this.pressed |= P_K;
    if (code === k.buyWeapon) this.pressed |= P_V;
    if (code === k.buyHp) this.pressed |= P_C;
    if (code === k.shop) this.onAction('shop');
    if (code === k.scores) this.onAction('scoresOn');
  }

  /** nút bấm một lần từ giao diện (nút cảm ứng, cửa hàng) */
  press(bit: number) {
    this.pressed |= bit;
  }

  /** đọc input khung hình hiện tại */
  read(out: { mx: number; mz: number; yaw: number; pitch: number; btn: number }) {
    let mx = 0;
    let mz = 0;
    let btn = 0;
    if (this.enabled && this.gate()) {
      if (this.bound('forward')) mz += 127;
      if (this.bound('back')) mz -= 127;
      if (this.bound('right')) mx += 127;
      if (this.bound('left')) mx -= 127;
      if (this.stickId >= 0) {
        mx = Math.round(this.stickX * 127);
        mz = Math.round(-this.stickY * 127);
      }
      if (this.mouseFire || this.touchFire) btn |= B_FIRE;
      if (this.ads) btn |= B_ADS;
      if (this.bound('sprint') || this.touchSprint || (this.stickId >= 0 && Math.hypot(this.stickX, this.stickY) > 0.97 && !this.touchFire)) btn |= B_SPRINT;
      if (this.bound('jump') || this.touchJump) btn |= B_JUMP;
      if (this.bound('reload')) btn |= B_RELOAD;
      if (this.bound('use') || this.touchUse) btn |= B_USE;
      btn |= this.pressed;
    }
    this.pressed = 0;
    out.mx = mx;
    out.mz = mz;
    out.yaw = Math.round((this.yaw / (Math.PI * 2)) * 65536) & 0xffff;
    out.pitch = Math.round((this.pitch / (Math.PI * 2)) * 65536);
    out.btn = btn;
  }

  pressReload() {
    this.keys.add(settings.keys.reload);
    setTimeout(() => this.keys.delete(settings.keys.reload), 80);
  }

  /* ======================= CẢM ỨNG ======================= */
  bindTouch(stickZone: HTMLElement, lookZone: HTMLElement, knob: HTMLElement, base: HTMLElement) {
    const R = 56;
    stickZone.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches[0];
      if (this.stickId >= 0) return;
      this.stickId = t.identifier;
      this.stickOX = t.clientX;
      this.stickOY = t.clientY;
      base.style.display = 'block';
      base.style.transform = `translate(${t.clientX - 64}px, ${t.clientY - 64}px)`;
      knob.style.transform = 'translate(0px,0px)';
      e.preventDefault();
    }, { passive: false });
    lookZone.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches[0];
      if (this.lookId >= 0) return;
      this.lookId = t.identifier;
      this.lookX = t.clientX;
      this.lookY = t.clientY;
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          let dx = t.clientX - this.stickOX;
          let dy = t.clientY - this.stickOY;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
          this.stickX = dx / R;
          this.stickY = dy / R;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === this.lookId) {
          const dx = t.clientX - this.lookX;
          const dy = t.clientY - this.lookY;
          this.lookX = t.clientX;
          this.lookY = t.clientY;
          this.look(dx, dy, settings.touchSens * 0.0052 * (this.ads ? 0.6 : 1));
        }
      }
    }, { passive: true });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          this.stickId = -1;
          this.stickX = this.stickY = 0;
          base.style.display = 'none';
        } else if (t.identifier === this.lookId) this.lookId = -1;
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
  }

  /** nút giữ trên cảm ứng */
  holdButton(el: HTMLElement, set: (v: boolean) => void) {
    el.addEventListener('touchstart', (e) => { set(true); el.classList.add('on'); e.preventDefault(); e.stopPropagation(); }, { passive: false });
    const off = (e: Event) => { set(false); el.classList.remove('on'); e.preventDefault(); };
    el.addEventListener('touchend', off);
    el.addEventListener('touchcancel', off);
  }

  tapButton(el: HTMLElement, fn: () => void) {
    el.addEventListener('touchstart', (e) => { fn(); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 120); e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.addEventListener('click', (e) => { if (!this.touch) fn(); e.stopPropagation(); });
  }

  /** hút tâm nhẹ trên cảm ứng: kéo yaw về phía mục tiêu gần tâm */
  assist(targetYaw: number | null, dt: number) {
    if (!this.touch || !settings.aimAssist || targetYaw === null) {
      this.assistSlow = 1;
      return;
    }
    let d = targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.12) {
      this.assistSlow = 0.6;
      if (this.touchFire) this.yaw += d * Math.min(1, dt * 4);
    } else this.assistSlow = 1;
  }

  resetKeys() {
    this.keys.clear();
    this.mouseFire = false;
    this.mouseAds = false;
    this.touchFire = this.touchJump = this.touchSprint = this.touchUse = false;
  }
}
