import type { PlayerState } from '@shared/protocol';
import Character from '../../components/Character';
import ArtView from './ArtView';
import type { ArtShowState } from './useArtShowGame';

const nameOf = (players: PlayerState[], id: string) => players.find((p) => p.id === id)?.name ?? '???';

function Painter({ players, id }: { players: PlayerState[]; id: string }) {
  const p = players.find((x) => x.id === id);
  return (
    <span className="as-painter">
      {p && (
        <span className="as-face" style={{ ['--c' as string]: p.color }}>
          <Character color={p.color} look={p.look} view="head" size={28} />
        </span>
      )}
      <b>{nameOf(players, id)}</b>
    </span>
  );
}

/** Công bố: tranh thắng + giải phụ + bảng phiếu — tên họa sĩ lộ ra ở đây. */
export default function Result({ game, players, meId }: { game: ArtShowState; players: PlayerState[]; meId: string }) {
  const { res, pics } = game;
  if (!res) return <div className="as-wait">Đang kiểm phiếu…</div>;
  const row = (k: number) => res.rows.find((r) => r.k === k);
  const winRows = res.win.map(row).filter(Boolean) as NonNullable<ReturnType<typeof row>>[];
  const tie = winRows.length > 1;
  const noVotes = winRows.length === 0;

  const award = (title: string, ks: number[], key: 'h' | 't', cls: string) => (
    <div className={`as-award ${cls}`}>
      <div className="as-award-title">{title}</div>
      {ks.length === 0 ? (
        <div className="as-award-none">Chưa có ai được chọn</div>
      ) : (
        <div className="as-award-list">
          {ks.map((k) => {
            const r = row(k)!;
            return (
              <div className="as-award-item" key={k}>
                <ArtView strokes={pics[k]} px={280} />
                <Painter players={players} id={r.id} />
                <small>
                  {r[key]} phiếu · +{key === 'h' ? 30 : 20} điểm
                </small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="as-res">
      <div className="as-res-main">
        <div className="as-win">
          <div className="as-win-title">{noVotes ? '😶 Không ai bình chọn' : tie ? '🤝 HOÀ! CÁC TRANH THẮNG' : '🏆 TRANH ĐƯỢC YÊU THÍCH NHẤT'}</div>
          <div className="as-win-list">
            {winRows.map((r) => (
              <div className="as-win-item" key={r.k}>
                <ArtView strokes={pics[r.k]} px={640} className="as-art big" />
                <div className="as-win-by">
                  <Painter players={players} id={r.id} />
                  <span>
                    {r.m} phiếu ❤️ {r.id === meId && '· bạn!'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="as-awards">
          {award('🤣 TRANH HÀI NHẤT', res.fun, 'h', 'fun')}
          {award('💩 THẢM HỌA NGHỆ THUẬT', res.fail, 't', 'fail')}
        </div>
      </div>
      <div className="as-strip">
        {res.rows.map((r) => (
          <div className={`as-mini ${r.id === meId ? 'me' : ''}`} key={r.k}>
            <ArtView strokes={pics[r.k]} px={160} />
            <b>{nameOf(players, r.id)}</b>
            <small>
              ❤️{r.m} 🤣{r.h} 💩{r.t}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}
