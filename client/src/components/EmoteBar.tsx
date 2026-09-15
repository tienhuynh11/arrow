import type { Emote } from '@shared/protocol';
import type { CharState } from './Character';
import { actions } from '../state/store';
import { sfx } from '../utils/sound';

export const EMOTE_LIST: { id: Emote; icon: string; label: string; state: CharState }[] = [
  { id: 'wave', icon: '👋', label: 'Chào', state: 'hit' },
  { id: 'dance', icon: '🕺', label: 'Nhảy', state: 'win' },
  { id: 'laugh', icon: '😂', label: 'Cười', state: 'win' },
  { id: 'angry', icon: '😡', label: 'Tức', state: 'punch' },
  { id: 'sad', icon: '😢', label: 'Buồn', state: 'lose' },
  { id: 'jump', icon: '🤸', label: 'Bật', state: 'jump' },
];

export const emoteInfo = (id: Emote) => EMOTE_LIST.find((e) => e.id === id);

/** Thanh emote ở màn chờ - bấm chuột hoặc phím 1…6. */
export default function EmoteBar() {
  return (
    <div className="emotebar">
      {EMOTE_LIST.map((e, i) => (
        <button
          key={e.id}
          type="button"
          className="emote-btn"
          title={`${e.label} (phím ${i + 1})`}
          onClick={() => {
            actions.emote(e.id);
            sfx.tap();
          }}
        >
          <span className="emote-icon">{e.icon}</span>
          <span className="emote-key">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}
