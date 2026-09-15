import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_LOOK, LOOK_PARTS, type LookPart } from '@shared/protocol';
import { actions, useStore } from '../state/store';
import { optionNames, randomLook } from '../utils/appearance';
import Character, { type CharState } from './Character';

type PartKind = 'swatch' | 'head' | 'full';

const TABS: { id: string; label: string; parts: { key: LookPart; label: string; kind: PartKind }[] }[] = [
  {
    id: 'body',
    label: '👕 CƠ THỂ',
    parts: [
      { key: 'skin', label: 'MÀU DA', kind: 'swatch' },
      { key: 'outfit', label: 'TRANG PHỤC', kind: 'full' },
      { key: 'shoes', label: 'MÀU GIÀY', kind: 'swatch' },
    ],
  },
  {
    id: 'hair',
    label: '💇 TÓC',
    parts: [
      { key: 'hair', label: 'KIỂU TÓC', kind: 'head' },
      { key: 'hairColor', label: 'MÀU TÓC', kind: 'swatch' },
    ],
  },
  {
    id: 'face',
    label: '😊 KHUÔN MẶT',
    parts: [
      { key: 'eyes', label: 'ĐÔI MẮT', kind: 'head' },
      { key: 'mouth', label: 'MIỆNG', kind: 'head' },
      { key: 'face', label: 'ĐIỂM NHẤN', kind: 'head' },
      { key: 'glasses', label: 'KÍNH', kind: 'head' },
    ],
  },
  {
    id: 'acc',
    label: '👑 PHỤ KIỆN',
    parts: [{ key: 'hat', label: 'ĐỘI ĐẦU', kind: 'head' }],
  },
];

const POSES: CharState[] = ['idle', 'win', 'punch', 'run', 'jump'];

/** Hộp thoại tạo nhân vật: đổi là lưu ngay và cả phòng thấy luôn. */
export default function CharacterEditor({ color, onClose }: { color: string; onClose: () => void }) {
  const look = useStore((s) => s.look);
  const [pose, setPose] = useState(0);
  const [tab, setTab] = useState(TABS[0].id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (key: LookPart, value: number) => actions.setLook({ ...look, [key]: value });
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  // gắn thẳng vào body: màn chính / sảnh chờ có animation transform, position: fixed bên trong sẽ bị bó theo khung đó
  return createPortal(
    <div className="editor-backdrop" onClick={onClose}>
      <div className="editor v2" role="dialog" aria-label="Tạo nhân vật" onClick={(e) => e.stopPropagation()}>
        <div className="ed-title">TẠO NHÂN VẬT</div>

        <div className="ed2-body">
          <div className="ed2-left">
            <div className="ed-gender" role="radiogroup" aria-label="Giới tính">
              {['👦 NAM', '👧 NỮ'].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={look.gender === i}
                  className={look.gender === i ? 'on' : ''}
                  onClick={() => change('gender', i)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ed-preview"
              style={{ '--c': color } as React.CSSProperties}
              onClick={() => setPose((p) => (p + 1) % POSES.length)}
              title="Bấm để đổi dáng"
            >
              <Character color={color} look={look} hurt={false} state={POSES[pose]} size={132} />
              <span className="ed-preview-hint">bấm để đổi dáng</span>
            </button>
            <div className="ed-left-actions">
              <button type="button" className="btn" onClick={() => actions.setLook(randomLook())}>
                🎲 NGẪU NHIÊN
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => actions.setLook({ ...DEFAULT_LOOK, gender: look.gender })}
              >
                ↺ MẶC ĐỊNH
              </button>
            </div>
          </div>

          <div className="ed2-right">
            <div className="ed-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`ed-tab ${tab === t.id ? 'on' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="ed-panel" role="tabpanel">
              {active.parts.map(({ key, label, kind }) => (
                <div key={key} className="ed-part">
                  <div className="setup-label">{label}</div>
                  {kind === 'swatch' ? (
                    <div className="ed-swatches">
                      {LOOK_PARTS[key].map((value, i) => (
                        <button
                          key={value}
                          type="button"
                          className={`ed-swatch ${look[key] === i ? 'on' : ''} ${value === 'auto' ? 'auto' : ''}`}
                          style={{ background: value === 'auto' ? color : value }}
                          title={value === 'auto' ? 'Theo màu áo' : value}
                          aria-label={value === 'auto' ? 'Theo màu áo' : value}
                          onClick={() => change(key, i)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className={`ed-grid ${kind}`}>
                      {optionNames(key, look).map((name, i) => (
                        <button
                          key={name}
                          type="button"
                          className={`ed-opt ${look[key] === i ? 'on' : ''}`}
                          onClick={() => change(key, i)}
                        >
                          <Character
                            color={color}
                            look={{ ...look, [key]: i }}
                            hurt={false}
                            state="idle"
                            view={kind === 'head' ? 'head' : 'full'}
                            size={kind === 'head' ? 52 : 40}
                          />
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="ed-note">Màu áo là màu của bạn trong phòng, để mọi người dễ nhận ra nhau khi chơi.</p>

        <div className="ed-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            XONG
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
