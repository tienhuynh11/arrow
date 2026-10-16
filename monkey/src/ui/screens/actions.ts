// Hành động dùng chung của sảnh: tạo/vào phòng theo tài khoản, gọi API có thông báo, đếm ngược.

import { CODE_LEN } from '@shared/monkey/config';
import { api } from '../../api';
import * as A from '../../audio';
import { toast } from '../dom';
import { S, nav, send } from './ctx';

/** gửi tạo phòng ở chế độ ải / vô tận với tên + nhân vật của tài khoản */
export function createRoom(opts: { solo: boolean; mode: 'stage' | 'endless'; stage?: string; map?: string }) {
  const me = api.me;
  if (!me) return;
  A.initAudio();
  if (opts.solo) nav.goFullscreen();
  S.lastStage = opts.stage ?? null;
  send({ t: 'create', name: me.profile.username, cls: me.profile.cls, solo: opts.solo, map: opts.map ?? S.myMap, mode: opts.mode, stage: opts.stage });
}

export function joinRoom(code: string) {
  const me = api.me;
  const c = code.trim().toUpperCase();
  if (c.length < 4) return toast(`Mã phòng gồm ${CODE_LEN} ký tự`);
  A.initAudio();
  send({ t: 'join', code: c, name: me?.profile.username ?? (S.name || 'Khỉ'), cls: me?.profile.cls ?? S.myCls });
}

/** hành động API có toast lỗi + âm thanh */
export async function act(p: Promise<unknown>, okMsg?: string) {
  try {
    await p;
    if (okMsg) toast(okMsg, true);
    A.sfxBuy();
    return true;
  } catch (e) {
    toast((e as Error).message || 'Có lỗi xảy ra');
    A.sfxDeny();
    return false;
  }
}

export function countdown(ms: number) {
  if (!(ms > 0)) return 'Đã kết thúc';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `Còn ${d} ngày ${hh}:${mm}:${ss}` : `Còn ${hh}:${mm}:${ss}`;
}
