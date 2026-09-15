import type { PlayerState } from '@shared/protocol';

const MEDAL = ['🥇', '🥈', '🥉', '4️⃣'];

export default function Leaderboard({
  players,
  meId,
  comebackPlayerId,
}: {
  players: PlayerState[];
  meId: string;
  comebackPlayerId?: string | null;
}) {
  const sorted = players.filter((p) => !p.spectator).slice().sort((a, b) => b.total - a.total);
  // người xếp bét được đánh dấu băng cá nhân (chỉ khi đã có chênh lệch điểm)
  const lowest = sorted.length > 1 ? sorted[sorted.length - 1].total : null;
  const isLast = (total: number) => lowest !== null && sorted[0].total !== lowest && total === lowest;

  // phòng đông thì chỉ hiện top 8, nhưng luôn kèm dòng của chính mình
  const LIMIT = 8;
  const myIndex = sorted.findIndex((p) => p.id === meId);
  const shown = sorted.length <= LIMIT ? sorted : sorted.slice(0, LIMIT);
  const meOutside = myIndex >= LIMIT ? sorted[myIndex] : null;

  return (
    <div className="leaderboard">
      <div className="lb-title">
        LIVE RANKING{sorted.length > LIMIT ? ` · TOP ${LIMIT}/${sorted.length}` : ''}
      </div>
      {shown.map((p, i) => (
        <div
          key={p.id}
          className={`lb-row ${p.id === meId ? 'me' : ''}`}
          style={{ '--c': p.color, order: i } as React.CSSProperties}
        >
          <span className="lb-rank">{MEDAL[i] ?? i + 1}</span>
          <span className="lb-name">
            {p.name}
            {!p.connected && <em className="lb-off"> mất kết nối</em>}
            {p.id === comebackPlayerId && <em className="lb-bonus"> +10%</em>}
            {isLast(p.total) && (
              <em className="lb-hurt" title="Đang xếp bét">
                {' '}
                🩹
              </em>
            )}
          </span>
          <span className="lb-score">{p.total}</span>
        </div>
      ))}
      {meOutside && (
        <div className="lb-row me" style={{ '--c': meOutside.color, order: 99 } as React.CSSProperties}>
          <span className="lb-rank">{myIndex + 1}</span>
          <span className="lb-name">{meOutside.name}</span>
          <span className="lb-score">{meOutside.total}</span>
        </div>
      )}
    </div>
  );
}
