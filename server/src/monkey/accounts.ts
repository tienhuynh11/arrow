// Tài khoản Bầy Khỉ: tên đăng nhập + mật khẩu (không email). Mật khẩu băm scrypt có salt,
// token phiên ngẫu nhiên 32 byte — DB chỉ lưu sha256 của token. Hạn 30 ngày.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { FailLimiter } from '../http/util.js';
import { StoreError, storeReady } from './db/index.js';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;
export const SESSION_DAYS = 30;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

/** chữ cái (kể cả tiếng Việt có dấu), số, _ . - */
const NAME_RE = /^[\p{L}\p{M}0-9_.-]+$/u;

/** chuẩn hoá + kiểm tra tên; trả tên đã NFC hoặc ném StoreError */
export function checkUsername(raw: unknown): string {
  if (typeof raw !== 'string') throw new StoreError('Thiếu tên đăng nhập');
  const name = raw.normalize('NFC').trim();
  const len = [...name].length;
  if (len < USERNAME_MIN || len > USERNAME_MAX) throw new StoreError(`Tên đăng nhập dài ${USERNAME_MIN}–${USERNAME_MAX} ký tự`);
  if (!NAME_RE.test(name)) throw new StoreError('Tên chỉ gồm chữ, số và _ . -');
  return name;
}
export function checkPassword(raw: unknown): string {
  if (typeof raw !== 'string') throw new StoreError('Thiếu mật khẩu');
  if (raw.length < PASSWORD_MIN) throw new StoreError(`Mật khẩu tối thiểu ${PASSWORD_MIN} ký tự`);
  if (raw.length > PASSWORD_MAX) throw new StoreError('Mật khẩu quá dài');
  return raw;
}

function scryptAsync(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) =>
    scrypt(pw.normalize('NFC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (e, k) => (e ? rej(e) : res(k))),
  );
}

/** định dạng: s1$<salt base64url>$<hash base64url> */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt);
  return `s1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [v, s, h] = stored.split('$');
  if (v !== 's1' || !s || !h) return false;
  const want = Buffer.from(h, 'base64url');
  const got = await scryptAsync(pw, Buffer.from(s, 'base64url'));
  return want.length === got.length && timingSafeEqual(want, got);
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/* ---- chặn thử sai theo IP ---- */
const loginFails = new FailLimiter(10, 5 * 60_000);
/** đăng ký (kể cả thành công) — chặn tạo tài khoản hàng loạt */
const registers = new FailLimiter(8, 60 * 60_000);

/** chỉ dùng cho test */
export function _resetRateLimits() {
  loginFails.reset();
  registers.reset();
}

/** băm giả để đăng nhập tên không tồn tại tốn thời gian như tên có thật */
let dummyHash: Promise<string> | null = null;

async function newSession(accountId: number) {
  const store = await storeReady();
  const token = randomBytes(32).toString('base64url');
  await store.createSession(accountId, tokenHash(token), new Date(Date.now() + SESSION_DAYS * 86400_000));
  return token;
}

export async function register(ip: string, username: unknown, password: unknown): Promise<{ token: string; accountId: number }> {
  if (registers.blocked(ip)) throw new StoreError('Tạo quá nhiều tài khoản, thử lại sau', 429);
  const name = checkUsername(username);
  const pw = checkPassword(password);
  registers.fail(ip);
  const store = await storeReady();
  if (await store.findAccount(name)) throw new StoreError('Tên đăng nhập đã có người dùng', 409);
  const id = await store.createAccount(name, await hashPassword(pw));
  if (id === null) throw new StoreError('Tên đăng nhập đã có người dùng', 409);
  return { token: await newSession(id), accountId: id };
}

export async function login(ip: string, username: unknown, password: unknown): Promise<{ token: string; accountId: number }> {
  if (loginFails.blocked(ip)) throw new StoreError('Sai quá nhiều lần, thử lại sau ít phút', 429);
  const bad = () => {
    loginFails.fail(ip);
    return new StoreError('Sai tên đăng nhập hoặc mật khẩu', 401);
  };
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > PASSWORD_MAX || username.length > 64) throw bad();
  const store = await storeReady();
  const acc = await store.findAccount(username.normalize('NFC').trim());
  if (!acc) {
    dummyHash ??= hashPassword('khong-co-tai-khoan');
    await verifyPassword(password, await dummyHash);
    throw bad();
  }
  if (!(await verifyPassword(password, acc.passHash))) throw bad();
  return { token: await newSession(acc.id), accountId: acc.id };
}

export async function logout(token: string) {
  const store = await storeReady();
  await store.deleteSession(tokenHash(token));
}

/** token → accountId (null nếu sai / hết hạn) */
export async function resolveToken(token: unknown): Promise<number | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const store = await storeReady();
  return store.sessionAccount(tokenHash(token));
}

/** token → {accountId, username} cho WS auth */
export async function resolveAccount(token: unknown): Promise<{ accountId: number; username: string } | null> {
  const id = await resolveToken(token);
  if (id === null) return null;
  const store = await storeReady();
  const acc = await store.accountById(id);
  return acc ? { accountId: acc.id, username: acc.username } : null;
}
