// Màn đăng nhập / đăng ký.
import { useState } from 'preact/hooks';
import { GAME_TITLE } from '@shared/heroes/config';
import { api } from '../../api';
import { go, useBusy } from '../../state';

const NAME_RE = /^[\p{L}\p{M}0-9_.-]{3,20}$/u;

function Scenery() {
  return (
    <svg class="login-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="lsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4fb6ff" />
          <stop offset="1" stop-color="#bfeaff" />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill="url(#lsky)" />
      <circle cx="320" cy="60" r="28" fill="#fff3a0" stroke="#fff" stroke-width="6" stroke-opacity=".5" />
      <g fill="#fff">
        <ellipse cx="70" cy="70" rx="42" ry="14" />
        <ellipse cx="95" cy="60" rx="26" ry="14" />
        <ellipse cx="250" cy="110" rx="36" ry="11" />
        <ellipse cx="270" cy="102" rx="22" ry="11" />
      </g>
      <path d="M0 220 Q70 160 140 205 Q210 150 280 200 Q340 165 400 205 V300 H0Z" fill="#8fdc6a" />
      <path d="M0 250 Q100 215 200 245 Q300 215 400 250 V300 H0Z" fill="#6cc24a" />
      <g stroke="#1e2a4a" stroke-width="3" stroke-linejoin="round">
        <rect x="60" y="205" width="8" height="26" fill="#8a5a2b" />
        <circle cx="64" cy="195" r="20" fill="#3fae4a" />
        <rect x="330" y="215" width="8" height="24" fill="#8a5a2b" />
        <circle cx="334" cy="205" r="17" fill="#4fc257" />
      </g>
    </svg>
  );
}

export function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();

  const submit = (e: Event) => {
    e.preventDefault();
    setErr('');
    if (!NAME_RE.test(name.trim())) return setErr('Tên 3–20 ký tự: chữ, số, _ . -');
    if (pw.length < 6) return setErr('Mật khẩu tối thiểu 6 ký tự');
    void run(async () => {
      try {
        if (mode === 'login') await api.login(name.trim(), pw);
        else await api.register(name.trim(), pw);
        go({ n: 'hub' });
      } catch (x) {
        setErr(x instanceof Error ? x.message : 'Có lỗi xảy ra');
      }
    });
  };

  return (
    <div class="login">
      <Scenery />
      <form class="login-card" onSubmit={submit}>
        <h1 class="logo">{GAME_TITLE}</h1>
        <p class="tagline">Sưu tầm tướng, dựng đội hình, vượt ải!</p>
        <div class="seg wide" role="tablist">
          <button type="button" role="tab" class={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Đăng nhập</button>
          <button type="button" role="tab" class={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Đăng ký</button>
        </div>
        <label>
          <span>Tên đăng nhập</span>
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autocomplete="username" maxLength={20} />
        </label>
        <label>
          <span>Mật khẩu</span>
          <input type="password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {err && <div class="form-err" role="alert">{err}</div>}
        <button type="submit" class={`btn primary big${busy ? ' busy' : ''}`} disabled={busy}>
          {busy ? <span class="spin" /> : mode === 'login' ? 'VÀO GAME' : 'TẠO TÀI KHOẢN'}
        </button>
        {mode === 'register' && <small>Tài khoản dùng chung với Bầy Khỉ. Tặng sẵn 4 tướng khởi đầu!</small>}
      </form>
    </div>
  );
}
