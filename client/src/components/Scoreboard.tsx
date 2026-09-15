import type { PlayerState, ScoreRow, StandingRow } from '@shared/protocol';
import { useServerClock } from '../utils/hooks';
import Character from './Character';

const ORDINAL = [
  { n: '1', s: 'ST' },
  { n: '2', s: 'ND' },
  { n: '3', s: 'RD' },
  { n: '4', s: 'TH' },
];

/** Bục vinh danh sau mỗi minigame. */
export default function Scoreboard({
  rows,
  standings,
  players,
  nextAt,
  meId,
}: {
  rows: ScoreRow[];
  standings: StandingRow[];
  players: PlayerState[];
  nextAt: number;
  meId: string;
}) {
  const now = useServerClock(100);
  const remain = Math.max(0, Math.ceil((nextAt - now) / 1000));
  const byId = (id: string) => players.find((p) => p.id === id);

  const winner = byId(rows[0]?.playerId ?? '');
  const tied = rows.length > 1 && rows[1].rank === 1;

  // bục chỉ đủ chỗ cho vài người; phần còn lại hiện ở danh sách gọn bên dưới
  const PODIUM = rows.length <= 6 ? rows.length : 5;
  const onStage = rows.slice(0, PODIUM);
  const rest = rows.slice(PODIUM);

  return (
    <div className="podium">
      <h2 className="pd-title">
        {tied ? (
          <em>HOÀ!</em>
        ) : (
          <>
            <span style={{ color: winner?.color }}>{winner?.name ?? '-'}</span> <em>WINS!</em>
          </>
        )}
      </h2>

      <div className="pd-stage">
        {onStage.map((r, i) => {
          const p = byId(r.playerId);
          if (!p) return null;
          const ord = ORDINAL[Math.min(r.rank - 1, 3)];
          return (
            <div
              key={r.playerId}
              className={`pd-col ${r.rank === 1 ? 'first' : ''} ${r.playerId === meId ? 'me' : ''}`}
              style={{ '--c': p.color, animationDelay: `${i * 110}ms` } as React.CSSProperties}
            >
              <div className="pd-char">
                <Character
                  color={p.color}
                  size={r.rank === 1 ? 104 : 80}
                  state={r.rank === 1 ? 'win' : r.points < 0 ? 'lose' : 'idle'}
                />
              </div>

              <div className="pd-rank">
                {ord.n}
                <sup>{ord.s}</sup>
              </div>
              <div className="pd-name">{p.name}</div>

              <div className="pd-sep" />
              <div className="pd-reward-label">Reward</div>
              <div className={`pd-points ${r.points < 0 ? 'neg' : ''}`}>
                {r.points >= 0 ? '+' : ''}
                {r.points}
              </div>
              <div className="pd-detail">{r.detail}</div>
            </div>
          );
        })}
      </div>

      {rest.length > 0 && (
        <div className="pd-rest">
          {rest.map((r) => {
            const p = byId(r.playerId);
            if (!p) return null;
            return (
              <span
                key={r.playerId}
                className={`pd-rest-row ${r.playerId === meId ? 'me' : ''}`}
                style={{ '--c': p.color } as React.CSSProperties}
              >
                <b>{r.rank}.</b> {p.name}
                <em className={r.points < 0 ? 'neg' : ''}>
                  {r.points >= 0 ? '+' : ''}
                  {r.points}
                </em>
              </span>
            );
          })}
        </div>
      )}

      <div className="pd-totals">
        {standings.slice(0, 8).map((s) => {
          const p = byId(s.playerId);
          if (!p) return null;
          return (
            <span key={s.playerId} className="pd-total" style={{ '--c': p.color } as React.CSSProperties}>
              {s.rank}. {p.name} <b>{s.total}</b>
            </span>
          );
        })}
      </div>

      <div className="pd-next">Minigame tiếp theo sau {remain}s…</div>
    </div>
  );
}
