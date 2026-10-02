import { useEffect, useState } from 'react';
import { PLAYER_COLORS, ROOM_SIZE_OPTIONS, type RoomState } from '@shared/protocol';
import { TILES } from '@shared/board';
import { actions, useStore } from '../state/store';
import Character from '../components/Character';
import CharacterEditor from '../components/CharacterEditor';
import FullscreenHint from '../components/FullscreenHint';
import { webglSupported } from '../three/quality';
import EmoteBar, { EMOTE_LIST, emoteInfo } from '../components/EmoteBar';
import ModePicker from '../components/ModePicker';

export default function Lobby({ room }: { room: RoomState }) {
  const meId = useStore((s) => s.meId);
  const emotes = useStore((s) => s.emotes);
  const catalog = useStore((s) => s.catalog);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [, tick] = useState(0);

  // emote tự tắt sau ~1.6s nên cần nhịp render để bong bóng biến mất đúng lúc
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  // phím 1…6 bấm emote cho nhanh (tắt khi đang tạo nhân vật)
  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.code.replace('Digit', ''));
      if (e.code.startsWith('Digit') && idx >= 1 && idx <= EMOTE_LIST.length) {
        e.preventDefault();
        actions.emote(EMOTE_LIST[idx - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const me = room.players.find((p) => p.id === meId);
  const isHost = me?.isHost ?? false;
  const active = room.players.filter((p) => p.connected && !p.spectator);
  const connectedCount = active.length;
  // host không cần bấm sẵn sàng; mọi người còn lại phải sẵn sàng hết thì mới bắt đầu được
  const waiting = active.filter((p) => !p.isHost && !p.ready);
  const enough = connectedCount >= room.minPlayers;
  const canStart = enough && waiting.length === 0;
  const slots = Array.from({ length: room.maxPlayers }, (_, i) => room.players.find((p) => p.slot === i) ?? null);
  const big = room.maxPlayers > 8;

  const copy = () => {
    navigator.clipboard?.writeText(room.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };

  const toggleGame = (id: string) => {
    const cur = room.selectedGameIds;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length === 0) return;
    actions.setSettings({ gameIds: next });
  };

  return (
    <div className="lobby">
      <div className="room-code" onClick={copy} title="Bấm để copy">
        <span className="rc-label">ROOM CODE</span>
        <span className="rc-value">{room.code}</span>
        <span className="rc-hint">{copied ? 'đã copy!' : 'bấm để copy · gửi cho bạn bè'}</span>
      </div>

      <div className="lobby-meta">
        <span>
          👥 {connectedCount}/{room.maxPlayers}
        </span>
        {room.mode === 'journey' ? (
          <span>🗺️ Hành Trình Xuyên Việt · {TILES.length} tỉnh</span>
        ) : (
          <span>🎮 {room.selectedGameIds.length} minigame</span>
        )}
        <button className="linkish" onClick={() => setEditing(true)}>
          ✏️ Nhân vật của bạn
        </button>
        {isHost && (
          <button className="linkish" onClick={() => setSettingsOpen((v) => !v)}>
            {settingsOpen ? 'Đóng cài đặt' : 'Cài đặt phòng'}
          </button>
        )}
      </div>

      <FullscreenHint />
      {!webglSupported() && (
        <p className="status warn">
          ⚠️ Máy của bạn không chạy được đồ hoạ 3D (WebGL) nên sẽ không chơi được minigame. Hãy bật tăng tốc phần cứng
          hoặc dùng trình duyệt khác.
        </p>
      )}

      {settingsOpen && isHost && (
        <div className="lobby-settings">
          <div className="setup-block">
            <div className="setup-label">SỐ NGƯỜI TỐI ĐA</div>
            <div className="size-row">
              {ROOM_SIZE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`size-btn ${room.maxPlayers === n ? 'on' : ''}`}
                  disabled={n < connectedCount}
                  onClick={() => actions.setSettings({ maxPlayers: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="setup-block">
            <div className="setup-label">CHẾ ĐỘ CHƠI</div>
            <ModePicker value={room.mode} onChange={(mode) => actions.setSettings({ mode })} />
          </div>
          {room.mode === 'classic' && (
          <div className="setup-block">
            <div className="setup-label">MINIGAME</div>
            <div className="game-picker">
              {catalog.map((g) => {
                const on = room.selectedGameIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`game-chip ${on ? 'on' : ''}`}
                    onClick={() => toggleGame(g.id)}
                    title={g.instructions}
                  >
                    <span className="gc-check">{on ? '✓' : ''}</span>
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
          )}
        </div>
      )}

      <div className={`slots ${big ? 'dense' : ''}`}>
        {slots.map((p, i) => (
          <div
            key={i}
            className={`slot ${p ? 'filled' : ''}`}
            style={{ '--c': PLAYER_COLORS[i % PLAYER_COLORS.length] } as React.CSSProperties}
          >
            <div className="slot-label">P{i + 1}</div>
            {p ? (
              <>
                <div
                  className={`slot-char ${p.id === meId ? 'mine' : ''}`}
                  onClick={p.id === meId ? () => setEditing(true) : undefined}
                  title={p.id === meId ? 'Bấm để đổi ngoại hình' : undefined}
                >
                  {(() => {
                    const e = emotes[p.id];
                    const live = e && Date.now() - e.at < 1600 ? emoteInfo(e.emote) : null;
                    return (
                      <>
                        {live && <span className="slot-bubble">{live.icon}</span>}
                        <Character
                          color={PLAYER_COLORS[i % PLAYER_COLORS.length]}
                          state={
                            live ? live.state : !p.connected ? 'lose' : !p.isHost && p.ready ? 'win' : 'idle'
                          }
                          size={big ? 42 : 56}
                        />
                      </>
                    );
                  })()}
                </div>
                <div className="slot-name">
                  {p.name}
                  {p.id === meId && ' (bạn)'}
                </div>
                <div className="slot-status">
                  {p.isHost ? (
                    <span className="tag host">HOST</span>
                  ) : p.ready ? (
                    <span className="tag ready">READY</span>
                  ) : (
                    <span className="tag">chưa sẵn sàng</span>
                  )}
                  {!p.connected && <span className="tag off">OFFLINE</span>}
                </div>
              </>
            ) : (
              <div className="slot-empty">
                <Character color="#2b3352" state="idle" size={big ? 42 : 56} />
                <div className="slot-waiting">Waiting…</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <EmoteBar />

      <div className="lobby-actions">
        {!isHost && (
          <button className={`btn ${me?.ready ? '' : 'primary'}`} onClick={() => actions.ready(!me?.ready)}>
            {me?.ready ? 'HUỶ SẴN SÀNG' : 'SẴN SÀNG'}
          </button>
        )}
        {isHost && (
          <button className="btn primary" disabled={!canStart} onClick={() => actions.start()}>
            START GAME
          </button>
        )}
        <button className="btn ghost" onClick={() => actions.leaveRoom()}>
          RỜI PHÒNG
        </button>
      </div>

      {!enough ? (
        <p className="status">Cần ít nhất {room.minPlayers} người chơi để bắt đầu.</p>
      ) : isHost ? (
        waiting.length > 0 ? (
          <p className="status">
            Đang chờ {waiting.length} người sẵn sàng: {waiting.map((p) => p.name).join(', ')}
          </p>
        ) : (
          <p className="status ok">Mọi người đã sẵn sàng · bấm START GAME!</p>
        )
      ) : (
        <p className="status">
          {me?.ready ? 'Bạn đã sẵn sàng · chờ host bấm START GAME…' : 'Bấm SẴN SÀNG để host có thể bắt đầu trận'}
        </p>
      )}

      {editing && (
        <CharacterEditor color={me?.color ?? PLAYER_COLORS[0]} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
