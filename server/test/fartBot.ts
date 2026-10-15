// Bot đơn giản dùng chung cho test: xì ngược hướng "muốn đi" = hướng tới điểm phía trước trên đường tâm, né chướng ngại + bờ.
import * as R from '../../shared/raft.js';

const ev = new Float64Array(5);

/** góc XÌ (thế giới) mà bot chọn, dựa trên trạng thái S tại tick */
export function botAim(c: R.Course, S: Float64Array, tick: number): number {
  const i0 = Math.min(c.n - 2, S[R.S_SEG] | 0);
  const seg = Math.min(c.n - 2, i0 + 4);
  const tx = c.tx[i0];
  const ty = c.ty[i0];
  const nx = -ty;
  const ny = tx;
  const hw = c.hw[i0];
  const lat = (S[R.S_X] - c.px[i0]) * nx + (S[R.S_Y] - c.py[i0]) * ny;
  const sNow = S[R.S_S];
  let latT = 0;
  let push = 0;
  for (let i = 0; i < c.nOb; i++) {
    if (c.obS[i] < sNow - 2 || c.obS[i] > sNow + 18) continue;
    R.obEval(c, i, tick + 25, ev);
    if (c.obK[i] === R.OB_ROCK) {
      const ci = Math.min(c.n - 2, Math.max(0, Math.round(c.obS[i] / c.ds)));
      const lr = (ev[0] - c.px[ci]) * -c.ty[ci] + (ev[1] - c.py[ci]) * c.tx[ci];
      const gap = ev[4] + 2.3;
      const c1 = lr - gap;
      const c2 = lr + gap;
      const lim = c.hw[ci] - 2.3;
      const ok1 = Math.abs(c1) < lim;
      const ok2 = Math.abs(c2) < lim;
      latT = ok1 && ok2 ? (Math.abs(c1 - lat) < Math.abs(c2 - lat) ? c1 : c2) : ok1 ? c1 : c2;
      break;
    }
    const abx = ev[2] - ev[0];
    const aby = ev[3] - ev[1];
    const l2 = abx * abx + aby * aby;
    let u = l2 > 1e-9 ? ((S[R.S_X] - ev[0]) * abx + (S[R.S_Y] - ev[1]) * aby) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const rx = S[R.S_X] - (ev[0] + abx * u);
    const ry = S[R.S_Y] - (ev[1] + aby * u);
    const d = Math.hypot(rx, ry) - ev[4] - 1.0;
    if (d < 7) {
      const sideV = rx * nx + ry * ny;
      const sg = Math.abs(sideV) < 0.3 ? 1 : Math.sign(sideV);
      push += sg * ((7 - Math.max(0, d)) / 7) * 2.6;
    }
  }
  let dx = c.px[seg] - S[R.S_X];
  let dy = c.py[seg] - S[R.S_Y];
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  const steer = Math.max(-1.6, Math.min(1.6, (latT - lat) * 0.55)) + push;
  dx += nx * steer;
  dy += ny * steer;
  if (Math.abs(lat) > hw - 2.6) {
    const k = (Math.abs(lat) - (hw - 2.6)) * 0.9;
    dx -= Math.sign(lat) * nx * k;
    dy -= Math.sign(lat) * ny * k;
  }
  dx += tx * 0.5;
  dy += ty * 0.5;
  return Math.atan2(dy, dx) + Math.PI;
}
