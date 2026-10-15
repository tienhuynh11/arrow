import { useEffect, useRef, useState } from 'react';
import type { ArtStroke } from '@shared/artshow';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface ArtPhase {
  ph: 'draw' | 'vote' | 'result';
  startAt: number;
  endAt: number;
  topic?: string;
  n?: number;
}

export interface ArtRow {
  k: number;
  id: string;
  m: number;
  h: number;
  t: number;
  raw: number;
}

export interface ArtResult {
  rows: ArtRow[];
  win: number[];
  fun: number[];
  fail: number[];
  endAt: number;
}

export interface MyVotes {
  m: number;
  c: 'h' | 't' | null;
  k: number;
}

/** Trạng thái ĐẠI HỘI HỌA SĨ: pha hiện tại, tranh để bình chọn (ẩn danh), phiếu của mình, kết quả. */
export function useArtShowGame({ gameId, live }: GameProps) {
  const [ph, setPh] = useState<ArtPhase | null>(null);
  const [pics, setPics] = useState<Record<number, ArtStroke[]>>({});
  const [mine, setMine] = useState(-1);
  const [my, setMy] = useState<MyVotes>({ m: -1, c: null, k: -1 });
  const [prog, setProg] = useState({ voted: 0, total: 0 });
  const [res, setRes] = useState<ArtResult | null>(null);
  const [restore, setRestore] = useState<ArtStroke[] | null>(null);
  const phRef = useRef<string>('');
  const resSeen = useRef(false);

  useGameEvents(gameId, (p) => {
    switch (p.type) {
      case 'ph':
        if (phRef.current !== p.ph) {
          phRef.current = p.ph;
          if (p.ph === 'draw') sfx.start();
          else if (p.ph === 'vote') sfx.start();
        }
        setPh(p as ArtPhase);
        break;
      case 'pic':
        setPics((o) => ({ ...o, [p.k]: p.s }));
        break;
      case 'mine':
        setMine(p.k);
        break;
      case 'my':
        setMy({ m: p.m, c: p.c, k: p.k });
        break;
      case 'vp':
        setProg({ voted: p.voted, total: p.total });
        break;
      case 'mydraw':
        setRestore(p.s);
        break;
      case 'res':
        setRes(p as ArtResult);
        if (!resSeen.current) {
          resSeen.current = true;
          sfx.winner();
        }
        break;
    }
  });

  // vào lại giữa ván (tải lại trang…): xin server gửi lại trạng thái, tranh và phiếu của mình
  useEffect(() => {
    if (live) net.input(gameId, { type: 'async' });
  }, [live, gameId]);

  // đang bình chọn/xem kết quả mà thiếu tranh → hỏi lại (tối đa vài lần)
  const have = Object.keys(pics).length;
  useEffect(() => {
    if (!ph || ph.ph === 'draw' || !ph.n || have >= ph.n) return;
    const id = window.setTimeout(() => net.input(gameId, { type: 'async' }), 1500);
    return () => window.clearTimeout(id);
  }, [ph, have, gameId]);

  const vote = (k: number, c: 'm' | 'h' | 't') => {
    if (k === mine) return;
    // hiện phiếu ngay (lạc quan), server xác nhận bằng gói 'my'
    setMy((o) => {
      if (c === 'm') return { ...o, m: k };
      if (k === -1) return o.c === c ? { ...o, c: null, k: -1 } : o;
      return { ...o, c, k };
    });
    sfx.tap();
    net.input(gameId, { type: 'avote', k, c });
  };

  return { ph, pics, mine, my, prog, res, restore, vote };
}

export type ArtShowState = ReturnType<typeof useArtShowGame>;
