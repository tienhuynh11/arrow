import { useState } from 'react';
import { DEFAULT_MAX_PLAYERS, NAME_MAX, PLAYER_COLORS, ROOM_SIZE_OPTIONS, type GameMode } from '@shared/protocol';
import { actions, useStore } from '../state/store';
import Character from '../components/Character';
import CharacterEditor from '../components/CharacterEditor';
import ModePicker, { JourneyInfo } from '../components/ModePicker';

export default function Home() {
  const name = useStore((s) => s.name);
  const connected = useStore((s) => s.connected);
  const joining = useStore((s) => s.joining);
  const catalog = useStore((s) => s.catalog);
  const look = useStore((s) => s.look);
  const [editing, setEditing] = useState(false);

  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'none' | 'join' | 'create'>('none');
  const [maxPlayers, setMaxPlayers] = useState<number>(DEFAULT_MAX_PLAYERS);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>('classic');

  const canPlay = name.trim().length > 0 && connected && !joining;
  const selected = picked ?? catalog.map((g) => g.id);
  const creating = mode === 'create';

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (next.length === 0) return; // phải chừa lại ít nhất một game
    setPicked(next);
  };

  return (
    // lúc tạo phòng dùng bố cục 2 cột để cả form nằm gọn trong một màn hình, không phải cuộn
    <div className={`home ${creating ? 'wide' : ''}`}>
      <div className="home-intro">
        <h1 className="logo">
          ARROW<span>PARTY</span>
        </h1>
        <p className="tagline">Tối đa 16 người · 18 minigame · 1 nhà vô địch</p>

        <label className="field">
          <span>ENTER YOUR NAME</span>
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder="Tên của bạn"
            onChange={(e) => actions.setName(e.target.value)}
            autoFocus
          />
        </label>

        <div className="home-look">
          <button type="button" className="home-look-preview" onClick={() => setEditing(true)} title="Tạo nhân vật">
            <Character color={PLAYER_COLORS[0]} look={look} hurt={false} size={46} />
          </button>
          <div className="home-look-info">
            <b>Nhân vật của bạn</b>
            <span>Nam/nữ, tóc, khuôn mặt, trang phục, phụ kiện…</span>
          </div>
          <button type="button" className="btn home-look-btn" onClick={() => setEditing(true)}>
            ✏️ TẠO NHÂN VẬT
          </button>
        </div>

        {mode === 'none' && (
          <div className="home-actions">
            <button className="btn primary" disabled={!canPlay} onClick={() => setMode('create')}>
              CREATE ROOM
            </button>
            <button className="btn" disabled={!canPlay} onClick={() => setMode('join')}>
              JOIN ROOM
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="home-actions">
            <input
              className="code-input"
              value={code}
              maxLength={4}
              placeholder="A7K2"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 4 && actions.joinRoom(code)}
              autoFocus
            />
            <button
              className="btn primary"
              disabled={!canPlay || code.length < 4}
              onClick={() => actions.joinRoom(code)}
            >
              JOIN
            </button>
            <button className="btn ghost" onClick={() => setMode('none')}>
              ← Quay lại
            </button>
          </div>
        )}

        {creating && (
          <div className="setup-block">
            <div className="setup-label">SỐ NGƯỜI TỐI ĐA</div>
            <div className="size-row">
              {ROOM_SIZE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`size-btn ${maxPlayers === n ? 'on' : ''}`}
                  onClick={() => setMaxPlayers(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {creating && (
        <div className="home-games setup-block">
          <div className="setup-label">CHẾ ĐỘ CHƠI</div>
          <ModePicker value={gameMode} onChange={setGameMode} />
          {gameMode === 'journey' && <JourneyInfo />}
          {gameMode === 'classic' && (
            <>
          <div className="setup-label">
            CHỌN MINIGAME{' '}
            <span className="setup-count">
              {selected.length}/{catalog.length}
            </span>
          </div>
          <div className="game-picker">
            {catalog.map((g) => {
              const on = selected.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`game-chip ${on ? 'on' : ''}`}
                  onClick={() => toggle(g.id)}
                  title={g.instructions}
                >
                  <span className="gc-check">{on ? '✓' : ''}</span>
                  {g.name}
                </button>
              );
            })}
          </div>
          <div className="setup-actions">
            <button className="linkish" onClick={() => setPicked(catalog.map((g) => g.id))}>
              Chọn hết
            </button>
            <button className="linkish" onClick={() => setPicked([catalog[0]?.id].filter(Boolean) as string[])}>
              Bỏ chọn
            </button>
          </div>
          <p className="setup-note">
            Mỗi trận chơi hết các game đã chọn (~{Math.max(1, Math.round(selected.length * 1))} phút), thứ tự ngẫu
            nhiên.
          </p>
            </>
          )}
        </div>
      )}

      {creating && (
        <div className="home-create home-actions">
          <button
            className="btn primary"
            disabled={!canPlay || selected.length === 0}
            onClick={() => actions.createRoom({ maxPlayers, gameIds: selected, mode: gameMode })}
          >
            TẠO PHÒNG
          </button>
          <button className="btn ghost" onClick={() => setMode('none')}>
            ← Quay lại
          </button>
        </div>
      )}

      {!connected && <p className="status warn">Đang kết nối tới server…</p>}
      <a className="home-admin" href="#admin">
        Quản lý quiz
      </a>
      {editing && <CharacterEditor color={PLAYER_COLORS[0]} onClose={() => setEditing(false)} />}
    </div>
  );
}
