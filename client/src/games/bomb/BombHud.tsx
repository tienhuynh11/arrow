import type { PlayerState } from '@shared/protocol';

export default function BombHud({
  holder,
  meId,
  players,
  ratio,
}: {
  holder: string | null;
  meId: string;
  players: PlayerState[];
  ratio: number;
}) {
  const carrier = players.find((p) => p.id === holder);

  return (
    <div className="bm-top">
      <div className="bm-fuse">
        <div className="bm-fuse-label">NGÒI NỔ</div>
        <div className="bm-fuse-bar">
          <div className={`bm-fuse-fill ${ratio < 0.3 ? 'hot' : ''}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>

      <div className="bm-status">
        {holder === meId ? (
          <span className="bm-you">💣 BẠN ÔM BOM — ĐUỔI CHẠM VÀO AI ĐÓ!</span>
        ) : carrier ? (
          <span className="bm-other">
            🏃 CHẠY! bom đang ở <b style={{ color: carrier.color }}>{carrier.name}</b>
          </span>
        ) : (
          <span className="bm-other">Đang gắn bom…</span>
        )}
      </div>
    </div>
  );
}
