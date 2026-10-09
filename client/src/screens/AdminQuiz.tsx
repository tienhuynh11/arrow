import { useEffect, useRef, useState } from 'react';

interface Question {
  id: string;
  text: string;
  image?: string;
  audio?: string;
  video?: string;
  answers: string[];
  seconds: number;
  ignoreAccents?: boolean;
  note?: string;
}

const BASE = import.meta.env.BASE_URL;
const KEY_STORE = 'arrow.adminKey';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const blank = (): Question => ({ id: uid(), text: '', answers: [], seconds: 25, ignoreAccents: true });

const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
};

type Kind = 'image' | 'audio' | 'video';
const ACCEPT: Record<Kind, string> = {
  image: 'image/png,image/jpeg,image/webp,image/gif',
  audio: 'audio/mpeg,audio/ogg,audio/wav,audio/mp4,.mp3,.ogg,.wav,.m4a',
  video: 'video/mp4,video/webm',
};
const KIND_LABEL: Record<Kind, string> = { image: '🖼️ Ảnh', audio: '🎵 Âm thanh', video: '🎬 Video' };

export default function AdminQuiz() {
  const [key, setKey] = useState(readKey());
  const [authed, setAuthed] = useState(false);
  const [list, setList] = useState<Question[]>([]);
  const [edit, setEdit] = useState<Question | null>(null);
  const [answersText, setAnswersText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const importRef = useRef<HTMLInputElement>(null);

  const say = (text: string, ok = true) => setMsg({ ok, text });

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}admin/api/${path}`, {
      ...init,
      headers: { 'x-admin-key': key, ...(init.headers ?? {}) },
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* không phải JSON */
    }
    if (!res.ok) {
      const why =
        res.status === 403 ? 'Sai mật khẩu hoặc trang quản trị đang tắt' : res.status === 429 ? 'Sai quá nhiều lần, thử lại sau' : data?.error || `Lỗi ${res.status}`;
      throw new Error(why);
    }
    return data;
  };

  const login = async (k = key) => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}admin/api/ping`, { headers: { 'x-admin-key': k } });
      if (!res.ok) throw new Error(res.status === 429 ? 'Sai quá nhiều lần, thử lại sau' : 'Sai mật khẩu hoặc trang quản trị đang tắt');
      try {
        localStorage.setItem(KEY_STORE, k);
      } catch {
        /* bỏ qua */
      }
      const data = await (
        await fetch(`${BASE}admin/api/questions`, { headers: { 'x-admin-key': k } })
      ).json();
      setList(Array.isArray(data.questions) ? data.questions : []);
      setAuthed(true);
      setDirty(false);
      setMsg(null);
    } catch (e: any) {
      setAuthed(false);
      say(e.message || 'Không kết nối được server', false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (readKey()) void login(readKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const update = (next: Question[]) => {
    setList(next);
    setDirty(true);
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  const startEdit = (q: Question) => {
    setEdit({ ...q });
    setAnswersText(q.answers.join('\n'));
  };

  const commitEdit = () => {
    if (!edit) return;
    const answers = answersText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!edit.text.trim()) return say('Chưa nhập nội dung câu hỏi', false);
    if (answers.length === 0) return say('Cần ít nhất một đáp án', false);
    const q: Question = {
      ...edit,
      text: edit.text.trim(),
      answers,
      seconds: Math.max(5, Math.min(120, Math.round(edit.seconds) || 25)),
    };
    for (const k of ['image', 'audio', 'video'] as Kind[]) if (!q[k]?.trim()) delete q[k];
    if (!q.note?.trim()) delete q.note;
    const at = list.findIndex((x) => x.id === q.id);
    update(at >= 0 ? list.map((x, i) => (i === at ? q : x)) : [...list, q]);
    setEdit(null);
    say('Đã cập nhật danh sách — nhớ bấm "Lưu tất cả"');
  };

  const upload = (kind: Kind, file: File) => {
    if (file.size > 25 * 1024 * 1024) return say('File lớn hơn 25 MB', false);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}admin/api/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('x-admin-key', key);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress((p) => ({ ...p, [kind]: Math.round((e.loaded / e.total) * 100) }));
    };
    xhr.onerror = () => {
      setProgress((p) => ({ ...p, [kind]: -1 }));
      say('Tải lên thất bại (mất kết nối)', false);
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* bỏ qua */
      }
      setProgress((p) => ({ ...p, [kind]: -1 }));
      if (xhr.status >= 200 && xhr.status < 300 && data?.url) {
        setEdit((e) => (e ? { ...e, [kind]: data.url } : e));
        say('Đã tải lên');
      } else say(data?.error || `Tải lên lỗi (${xhr.status})`, false);
    };
    setProgress((p) => ({ ...p, [kind]: 0 }));
    xhr.send(file);
  };

  const saveAll = async () => {
    setBusy(true);
    try {
      const r = await api('questions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questions: list }),
      });
      setDirty(false);
      say(`Đã lưu ${r?.count ?? list.length} câu hỏi lên server`);
    } catch (e: any) {
      say(e.message, false);
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    try {
      const res = await fetch(`${BASE}admin/api/export`, { headers: { 'x-admin-key': key } });
      if (!res.ok) throw new Error('Không xuất được (sai mật khẩu?)');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'quiz-backup.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      say('Đã tải file quiz-backup.json');
    } catch (e: any) {
      say(e.message, false);
    }
  };

  const importFile = async (file: File) => {
    if (!window.confirm('Nhập sao lưu sẽ THAY THẾ toàn bộ câu hỏi hiện có. Tiếp tục?')) return;
    setBusy(true);
    try {
      await api('import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text() });
      await login();
      say('Đã nhập sao lưu');
    } catch (e: any) {
      say(e.message, false);
    } finally {
      setBusy(false);
    }
  };

  const gc = async () => {
    try {
      const r = await api('gc', { method: 'POST' });
      say(`Đã xoá ${r?.removed ?? 0} file media thừa`);
    } catch (e: any) {
      say(e.message, false);
    }
  };

  const back = () => {
    if (dirty && !window.confirm('Có thay đổi chưa lưu. Vẫn thoát?')) return;
    history.pushState('', document.title, location.pathname + location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const notice = msg && <div className={`qa-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>;

  return (
    <div className="qa">
      <div className="qa-top">
        <button className="btn ghost" onClick={back}>
          ← về game
        </button>
        <h1>Quản lý câu hỏi QUIZ</h1>
      </div>
      <p className="qa-note">
        Dữ liệu được lưu thành file trên server. Nếu server chạy trên hosting miễn phí có ổ đĩa tạm (mất khi khởi động lại), hãy bấm
        "Xuất sao lưu" thường xuyên để nạp lại khi cần.
      </p>

      {!authed ? (
        <form
          className="qa-card qa-login"
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <label>
            Mật khẩu quản trị
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
          </label>
          <button className="btn primary" disabled={busy || !key}>
            Đăng nhập
          </button>
          {notice}
        </form>
      ) : edit ? (
        <div className="qa-card qa-form">
          <h2>{list.some((x) => x.id === edit.id) ? 'Sửa câu hỏi' : 'Thêm câu hỏi'}</h2>
          <label>
            Nội dung câu hỏi
            <textarea
              rows={2}
              value={edit.text}
              placeholder="Ví dụ: Đây là bài hát nào?"
              onChange={(e) => setEdit({ ...edit, text: e.target.value })}
            />
          </label>

          {(['image', 'audio', 'video'] as Kind[]).map((kind) => {
            const url = edit[kind] ?? '';
            const pr = progress[kind];
            return (
              <div className="qa-media" key={kind}>
                <div className="qa-media-h">
                  <b>{KIND_LABEL[kind]}</b>
                  <label className="btn qa-file">
                    Tải lên
                    <input
                      type="file"
                      accept={ACCEPT[kind]}
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) upload(kind, f);
                      }}
                    />
                  </label>
                  {url && (
                    <button type="button" className="btn ghost" onClick={() => setEdit({ ...edit, [kind]: '' })}>
                      Bỏ
                    </button>
                  )}
                </div>
                <input
                  value={url}
                  placeholder="hoặc dán đường dẫn URL"
                  onChange={(e) => setEdit({ ...edit, [kind]: e.target.value })}
                />
                {pr !== undefined && pr >= 0 && (
                  <div className="qa-prog">
                    <i style={{ width: `${pr}%` }} />
                    <span>{pr}%</span>
                  </div>
                )}
                {url && kind === 'image' && <img className="qa-prev" src={url} alt="" />}
                {url && kind === 'audio' && <audio className="qa-prev" src={url} controls preload="metadata" />}
                {url && kind === 'video' && <video className="qa-prev" src={url} controls playsInline preload="metadata" />}
              </div>
            );
          })}

          <label>
            Các đáp án được chấp nhận (mỗi dòng một đáp án, dòng đầu là đáp án hiển thị)
            <textarea rows={3} value={answersText} onChange={(e) => setAnswersText(e.target.value)} />
          </label>
          <div className="qa-row">
            <label>
              Số giây (5–120)
              <input
                type="number"
                min={5}
                max={120}
                value={edit.seconds}
                onChange={(e) => setEdit({ ...edit, seconds: Number(e.target.value) })}
              />
            </label>
            <label className="qa-check">
              <input
                type="checkbox"
                checked={!!edit.ignoreAccents}
                onChange={(e) => setEdit({ ...edit, ignoreAccents: e.target.checked })}
              />
              Bỏ qua dấu tiếng Việt khi so khớp
            </label>
          </div>
          <label>
            Ghi chú (chỉ để bạn xem)
            <input value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
          </label>
          {notice}
          <div className="qa-actions">
            <button className="btn primary" onClick={commitEdit}>
              Xong
            </button>
            <button className="btn ghost" onClick={() => setEdit(null)}>
              Huỷ
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="qa-bar">
            <button className="btn primary" onClick={() => startEdit(blank())}>
              + Thêm câu hỏi
            </button>
            <button className={`btn ${dirty ? 'primary' : ''}`} disabled={busy} onClick={saveAll}>
              💾 Lưu tất cả{dirty ? ' •' : ''}
            </button>
            <button className="btn" onClick={exportAll}>
              Xuất sao lưu
            </button>
            <button className="btn" disabled={busy} onClick={() => importRef.current?.click()}>
              Nhập sao lưu
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importFile(f);
              }}
            />
            <button className="btn ghost" onClick={gc}>
              Dọn media thừa
            </button>
          </div>
          {notice}
          {list.length === 0 && <div className="qa-card qa-empty">Chưa có câu hỏi nào. Bấm "+ Thêm câu hỏi".</div>}
          <ol className="qa-list">
            {list.map((q, i) => (
              <li key={q.id} className="qa-card">
                <div className="qa-item">
                  <span className="qa-n">{i + 1}</span>
                  <div className="qa-info">
                    <b>{q.text}</b>
                    <small>
                      {q.image ? '🖼️ ' : ''}
                      {q.audio ? '🎵 ' : ''}
                      {q.video ? '🎬 ' : ''}→ {q.answers.join(' | ')} · {q.seconds}s
                    </small>
                  </div>
                </div>
                <div className="qa-btns">
                  <button className="btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Lên">
                    ↑
                  </button>
                  <button className="btn" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Xuống">
                    ↓
                  </button>
                  <button className="btn" onClick={() => startEdit(q)}>
                    Sửa
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const copy = { ...q, id: uid() };
                      const next = [...list];
                      next.splice(i + 1, 0, copy);
                      update(next);
                    }}
                  >
                    Nhân đôi
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => window.confirm('Xoá câu hỏi này?') && update(list.filter((x) => x.id !== q.id))}
                  >
                    Xoá
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
