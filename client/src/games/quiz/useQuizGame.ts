import { useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface QuizQuestion {
  i: number;
  total: number;
  text: string;
  image?: string;
  audio?: string;
  video?: string;
  seconds: number;
  startAt: number;
  endAt: number;
  len: number;
}

export interface QuizRow {
  id: string;
  text: string;
  ok: boolean;
  pts: number;
  ms: number;
}

export interface QuizResult {
  i: number;
  answer: string;
  accepted: string[];
  rows: QuizRow[];
  scores: Record<string, number>;
  nextAt: number;
}

/** Trạng thái QUIZ ĐOÁN NHANH: câu hỏi hiện tại, ai đã chốt, đáp án mình đã chốt, kết quả. Config không chứa câu hỏi/đáp án. */
export function useQuizGame({ gameId }: GameProps) {
  const [q, setQ] = useState<QuizQuestion | null>(null);
  const [prog, setProg] = useState<{ ids: string[]; total: number; marks: Record<string, [number, number]> }>({ ids: [], total: 0, marks: {} });
  const [ack, setAck] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const cur = useRef(-1);

  useGameEvents(gameId, (p) => {
    if (p.type === 'q') {
      if (p.i === cur.current) return; // gói lặp: bỏ qua
      cur.current = p.i;
      setQ(p as QuizQuestion);
      setProg({ ids: [], total: 0, marks: {} });
      setAck(null);
      setSent(false);
      setResult(null);
      sfx.start();
    } else if (p.type === 'prog') {
      if (p.i === cur.current) setProg({ ids: p.ids ?? [], total: p.total ?? 0, marks: p.marks ?? {} });
    } else if (p.type === 'ack') {
      if (p.i === cur.current) {
        setAck(String(p.text ?? ''));
        setSent(true);
        sfx.tick();
      }
    } else if (p.type === 'result') {
      cur.current = Math.max(cur.current, p.i);
      setResult(p as QuizResult);
      setScores(p.scores ?? {});
      setSent(true);
    }
  });

  /** chốt MỘT lần mỗi câu */
  const submit = (text: string) => {
    const t = text.trim();
    if (!t || sent || result) return false;
    setSent(true);
    net.input(gameId, { type: 'answer', text: t });
    return true;
  };

  return { q, prog, ack, sent, result, scores, submit };
}

export type QuizGameState = ReturnType<typeof useQuizGame>;
