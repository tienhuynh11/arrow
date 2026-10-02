import type { PlayerState } from '@shared/protocol';

export default function BombHud({
  holders,
  meId,
  players,
  ratio,
  alive,
  total,
  round,
  iOut,
}: {
  holders: string[];
  meId: string;
  players: PlayerState[];
  ratio: number;
  alive: number;
  total: number;
  round: number;
  iOut: boolean;
}) {
  const carrier = holders.length === 1 ? players.find((p) => p.id === holders[0]) : undefined;

  return (
    <div className="bm-top">
      <div className="bm-fuse">
        <div className="bm-fuse-label">
          NGÒI NỔ · VÒNG {round + 1} · CÒN LẠI {alive}/{total}
        </div>
        <div className="bm-fuse-bar">
          <div className={`bm-fuse-fill ${ratio < 0.3 ? 'hot' : ''}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>

      <div className="bm-status">
        {iOut ? (
          <span className="bm-other">💥 Bạn đã nổ — xem nốt ván nhé</span>
        ) : holders.includes(meId) ? (
          <span className="bm-you">💣 BẠN ÔM BOM — ĐUỔI VÀ CHẠM VÀO AI ĐÓ!</span>
        ) : carrier ? (
          <span className="bm-other">
            🏃 CHẠY! bom đang ở <b style={{ color: carrier.color }}>{carrier.name}</b>
          </span>
        ) : holders.length ? (
          <span className="bm-other">🏃 CHẠY! đang có {holders.length} quả bom</span>
        ) : (
          <span className="bm-other">Đang gắn bom…</span>
        )}
      </div>
    </div>
  );
}
