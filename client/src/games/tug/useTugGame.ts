import { useEffect, useRef, useState } from 'react';
import { net } from '../../network/net';
import { sfx } from '../../utils/sound';
import { useGameEvents, useKeys, useServerClock } from '../../utils/hooks';
import type { GameProps } from '../types';

export interface TugConfig {
  goal: number;
  minInterval: number;
  endsAt: number;
  teams: { A: string[]; B: string[] };
}

/** Trạng thái + điều khiển của KÉO CO, dùng chung cho bản 2D và 3D. */
export function useTugGame({ gameId, config, startAt, meId, live }: GameProps) {
  const cfg = config as TugConfig;

  const ropeRef = useRef(0);
  const [rope, setRope] = useState(0);
  const [winner, setWinner] = useState<'A' | 'B' | null>(null);
  const [winAt, setWinAt] = useState(0);
  const [pullAt, setPullAt] = useState(0);
  const now = useServerClock(100);

  const myTeam: 'A' | 'B' = cfg.teams.A.includes(meId) ? 'A' : 'B';

  useGameEvents(gameId, (p) => {
    if (p.type === 'rope') {
      ropeRef.current = p.rope;
      setRope(p.rope);
    } else if (p.type === 'win') {
      setWinner(p.team);
      setWinAt(Date.now());
      (p.team === myTeam ? sfx.winner : sfx.miss)();
    }
  });

  useKeys(
    {
      Space: () => {
        if (winner) return;
        setPullAt(Date.now());
        sfx.tap();
        net.input(gameId, { type: 'pull' });
      },
    },
    live,
  );

  useEffect(() => {
    if (!live) setPullAt(0);
  }, [live]);

  const remain = Math.max(0, Math.ceil((startAt + cfg.endsAt - now) / 1000));

  return { cfg, rope, ropeRef, winner, winAt, pullAt, myTeam, remain };
}

export type TugGameState = ReturnType<typeof useTugGame>;
