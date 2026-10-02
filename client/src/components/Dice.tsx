import { useEffect, useState } from 'react';

/** vị trí các chấm trên lưới 3×3 cho từng mặt xúc xắc (chỉ số 0–8, đọc từ trái sang phải, trên xuống dưới) */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Một mặt xúc xắc bằng CSS thuần. `value` 0 = chưa có kết quả (hiện dấu ?). */
export default function Dice({ value, rolling = false, size = 64 }: { value: number; rolling?: boolean; size?: number }) {
  const [face, setFace] = useState(value);

  // đang lắc thì đổi mặt liên tục, dừng lại thì hiện đúng giá trị
  useEffect(() => {
    if (!rolling) {
      setFace(value);
      return;
    }
    const id = window.setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 90);
    return () => window.clearInterval(id);
  }, [rolling, value]);

  const pips = PIPS[face] ?? [];
  return (
    <div
      className={`dice ${rolling ? 'rolling' : ''} ${face === 0 ? 'empty' : ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={face ? `Xúc xắc ${face}` : 'Xúc xắc'}
    >
      {face === 0 ? (
        <span className="dice-q">?</span>
      ) : (
        pips.map((i) => (
          <span key={i} className="dice-pip" style={{ left: `${20 + (i % 3) * 30}%`, top: `${20 + Math.floor(i / 3) * 30}%` }} />
        ))
      )}
    </div>
  );
}
