import { JOURNEY_TURNS, TILES } from '@shared/board';
import type { GameMode } from '@shared/protocol';

/** Hai thẻ chọn chế độ chơi, dùng ở màn tạo phòng và ở cài đặt phòng trong sảnh chờ. */
export default function ModePicker({ value, onChange }: { value: GameMode; onChange: (m: GameMode) => void }) {
  const cards: { id: GameMode; icon: string; title: string; desc: string }[] = [
    { id: 'classic', icon: '🎮', title: 'CHẾ ĐỘ THƯỜNG', desc: 'Chơi lần lượt các minigame bạn chọn' },
    { id: 'journey', icon: '🗺️', title: 'HÀNH TRÌNH XUYÊN VIỆT', desc: `Tung xúc xắc đi qua ${TILES.length} tỉnh, mỗi ô một minigame văn hoá` },
  ];
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Chế độ chơi">
      {cards.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          className={`mode-card ${value === c.id ? 'on' : ''}`}
          onClick={() => onChange(c.id)}
        >
          <span className="mode-ico" aria-hidden="true">
            {c.icon}
          </span>
          <span className="mode-text">
            <b>{c.title}</b>
            <em>{c.desc}</em>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Tóm tắt luật + danh sách các tỉnh của chế độ Hành Trình Xuyên Việt. */
export function JourneyInfo() {
  return (
    <div className="journey-info">
      <div className="ji-grid">
        {TILES.map((t) => (
          <span key={t.id} className={`ji-tile ${t.festival ? 'festival' : ''}`} title={`${t.title} — ${t.intro}`}>
            <span className="ji-emoji">{t.emoji}</span>
            <span className="ji-text">
              <b>{t.name}</b>
              <em>{t.specialty}</em>
            </span>
          </span>
        ))}
      </div>
      <ul className="ji-rules">
        <li>
          🎲 Mỗi chặng một người tung xúc xắc theo vòng; <b>cả phòng cùng đi</b> theo xúc xắc của mình
        </li>
        <li>📍 Ô mà người tung dừng lại quyết định tỉnh và minigame của chặng, cả phòng cùng chơi</li>
        <li>
          🏅 Hạng 1 nhận trọn <b>Điểm Văn Hoá</b> và huy hiệu đặc sản (hạng 2 một nửa, hạng 3 một phần tư); đang đứng đúng ô thì ×1,5
        </li>
        <li>
          🏆 Sau {JOURNEY_TURNS} chặng, ai nhiều Điểm Văn Hoá nhất là <b>Nhà Văn Hoá Xuyên Việt</b>
        </li>
      </ul>
    </div>
  );
}
