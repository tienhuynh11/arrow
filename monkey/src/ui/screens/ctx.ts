// Trạng thái + điều hướng dùng chung giữa các màn (main.ts là bộ định tuyến, gán các hàm trong `nav`).

import type { BoardEntry, CMsg, LobbyPlayer, SMsg } from '@shared/monkey/proto';
import { net } from '../../net';

export type Screen = 'login' | 'home' | 'hub' | 'lobby' | 'game' | 'over' | 'victory';
export type Mode = 'endless' | 'stage';

/* ---------- tin WS (chế độ ải, thắng ải…) ---------- */
export type RoomPlayerX = LobbyPlayer;
export type RoomMsgX = Extract<SMsg, { t: 'room' }>;
export type StartMsgX = Extract<SMsg, { t: 'start' }>;
export type VictoryMsg = Extract<SMsg, { t: 'victory' }>;
export type OverMsgX = Extract<SMsg, { t: 'over' }>;

export interface RoomState {
  code: string; phase: string; solo: boolean; host: number; players: RoomPlayerX[]; map: string;
  mode: Mode; stage: string | null; stages: string[] | null;
}

export const S = {
  screen: 'login' as Screen,
  room: null as RoomState | null,
  meIdx: -1,
  modalClose: null as (() => void) | null,
  /** tên khách (chế độ vô tận không tài khoản) */
  name: '',
  myCls: 0,
  myMap: 'random',
  lb: { solo: [] as BoardEntry[], team: [] as BoardEntry[] },
  lbTab: 'solo' as 'solo' | 'team',
  pendingJoin: null as string | null,
  /** tên đã xác thực qua WS ('authed') */
  authedName: null as string | null,
  /** tab đang mở ở sảnh */
  hubTab: 'stages' as HubTab,
  /** ải cuối cùng vừa chơi (để "Ải tiếp theo") */
  lastStage: null as string | null,
  /** chạy thay cho "về sảnh" khi nhận 'left' (ví dụ: rời phòng rồi tạo ải kế tiếp) */
  afterLeave: null as (() => void) | null,
};
export type HubTab = 'stages' | 'chars' | 'inv' | 'events' | 'endless' | 'rank';

/** gửi tin điều khiển (kể cả loại mới chưa có trong CMsg) */
export function send(m: CMsg | Record<string, unknown>) {
  net.send(m as CMsg);
}

/** các hàm điều hướng — main.ts gán */
export const nav = {
  login: () => {},
  home: () => {},
  hub: (_tab?: HubTab) => {},
  lobby: () => {},
  help: () => {},
  settings: () => {},
  goFullscreen: () => {},
  toggleFullscreen: () => {},
  logout: () => {},
};

export function modal(close: () => void) {
  S.modalClose = close;
}
export function closeModal() {
  if (S.modalClose) {
    const c = S.modalClose;
    S.modalClose = null;
    c();
  }
}

/** hộp xác nhận đơn giản (không dùng confirm() của trình duyệt để không thoát toàn màn hình) */
export function confirmBox(title: string, body: string, okText: string, onOk: () => void, danger = false) {
  const root = document.createElement('div');
  root.className = 'modal';
  const close = () => { root.remove(); if (S.modalClose === close) S.modalClose = null; };
  root.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  card.style.cssText = 'width:min(400px,100%);text-align:center';
  const h2 = document.createElement('h2');
  h2.style.justifyContent = 'center';
  h2.textContent = title;
  const p = document.createElement('p');
  p.style.cssText = 'color:var(--dim);margin-top:0';
  p.textContent = body;
  const row = document.createElement('div');
  row.className = 'row';
  row.style.justifyContent = 'center';
  const no = document.createElement('button');
  no.className = 'btn ghost';
  no.textContent = 'Huỷ';
  no.onclick = close;
  const ok = document.createElement('button');
  ok.className = `btn ${danger ? 'red' : 'green'}`;
  ok.textContent = okText;
  ok.onclick = () => { close(); onOk(); };
  row.append(no, ok);
  card.append(h2, p, row);
  root.append(card);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  document.body.append(root);
  S.modalClose = close;
}
