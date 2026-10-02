import type { RoomState, StandingRow } from '@shared/protocol';
import { TILES } from '@shared/board';
import { actions, useStore } from '../state/store';
import Character from '../components/Character';

const MEDAL = ['🥇', '🥈', '🥉', '4️⃣'];

export default function Final({ room, final }: { room: RoomState; final: { standings: StandingRow[]; winnerId: string } }) {
  const meId = useStore((s) => s.meId);
  const me = room.players.find((p) => p.id === meId);
  const winner = room.players.find((p) => p.id === final.winnerId);
  const winnerScore = final.standings.find((s) => s.playerId === final.winnerId)?.total ?? 0;
  const journey = room.mode === 'journey';
  /** huy hiệu đặc sản (emoji) mỗi người đã thu thập ở chế độ Hành Trình Xuyên Việt */
  const badgesOf = (id: string) => (room.board?.badges[id] ?? []).map((i) => TILES[i].emoji).join('');

  return (
    // màn rộng: nhà vô địch bên trái, bảng điểm bên phải để vừa một màn hình
    <div className="final final-wide">
      <div className="confetti" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>

      <div className="final-hero">
        <div className="trophy">🏆</div>
        {winner && <Character color={winner.color} state="win" size={104} />}
        <div className="final-label">{journey ? 'NHÀ VĂN HOÁ XUYÊN VIỆT' : 'WINNER'}</div>
        <div className="final-winner" style={{ color: winner?.color }}>
          {winner?.name ?? '-'}
        </div>
        <div className="final-score">{winnerScore}{journey ? ' điểm' : ''}</div>
        {journey && winner && badgesOf(winner.id) && <div className="final-badges">{badgesOf(winner.id)}</div>}
      </div>

      <div className="final-side">
        <div className="final-table">
          {final.standings.map((s) => {
            const p = room.players.find((x) => x.id === s.playerId);
            if (!p) return null;
            return (
              <div key={s.playerId} className={`ft-row ${s.playerId === meId ? 'me' : ''}`} style={{ '--c': p.color } as React.CSSProperties}>
                <span className="ft-rank">{MEDAL[s.rank - 1] ?? s.rank}</span>
                <Character color={p.color} state={s.rank === 1 ? 'win' : 'lose'} size={26} />
                <span className="ft-name">{p.name}</span>
                {journey && <span className="ft-badges">{badgesOf(p.id)}</span>}
                <span className="ft-total">{s.total}</span>
              </div>
            );
          })}
        </div>

        <div className="final-actions">
          {me?.isHost ? (
            <>
              <button className="btn primary" onClick={() => actions.start()}>
                PLAY AGAIN
              </button>
              <button className="btn" onClick={() => actions.backToLobby()}>
                BACK TO LOBBY
              </button>
            </>
          ) : (
            <p className="status">Chờ host bắt đầu ván mới…</p>
          )}
          <button className="btn ghost" onClick={() => actions.leaveRoom()}>
            RỜI PHÒNG
          </button>
        </div>
      </div>
    </div>
  );
}
