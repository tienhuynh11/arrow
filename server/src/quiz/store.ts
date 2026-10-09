import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Question {
  id: string;
  text: string;
  image?: string;
  audio?: string;
  video?: string;
  /** các đáp án chấp nhận; phần tử đầu là đáp án hiển thị */
  answers: string[];
  seconds: number;
  ignoreAccents?: boolean;
  note?: string;
}

export const QUIZ_DIR = resolve(process.env.QUIZ_DIR ?? resolve(process.cwd(), 'data', 'quiz'));
export const MEDIA_DIR = join(QUIZ_DIR, 'media');
const QUESTIONS_FILE = join(QUIZ_DIR, 'questions.json');
export const MEDIA_PREFIX = '/arrow/media/';

export function ensureDirs() {
  mkdirSync(MEDIA_DIR, { recursive: true });
}

/** ghi nguyên tử: file tạm rồi rename */
export function atomicWrite(file: string, data: string | Buffer) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export function normalizeAnswer(s: string, ignoreAccents?: boolean): string {
  let t = String(s ?? '').normalize('NFC').toLowerCase();
  if (ignoreAccents) {
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').normalize('NFC');
  }
  return t.trim().replace(/\s+/g, ' ');
}

export function isCorrect(q: Pick<Question, 'answers' | 'ignoreAccents'>, text: string): boolean {
  const n = normalizeAnswer(text, q.ignoreAccents);
  if (!n) return false;
  return q.answers.some((a) => normalizeAnswer(a, q.ignoreAccents) === n);
}

const SAMPLE: Array<[string, string[]]> = [
  ['Thủ đô của Việt Nam là gì?', ['Hà Nội']],
  ['Con sông dài nhất Việt Nam chảy qua Cần Thơ tên là gì?', ['Sông Hậu', 'Hậu Giang']],
  ['Hành tinh nào gần Mặt Trời nhất?', ['Sao Thủy', 'Thủy Tinh']],
  ['Nước nào có hình chữ S ở Đông Nam Á, thủ đô Hà Nội? (tên nước)', ['Việt Nam']],
  ['Đỉnh núi cao nhất Việt Nam tên là gì?', ['Fansipan', 'Phan Xi Păng']],
  ['Một năm dương lịch bình thường có bao nhiêu ngày?', ['365']],
  ['Tác giả của Truyện Kiều là ai?', ['Nguyễn Du']],
  ['Thành phố nào được gọi là Thành phố Hoa Phượng Đỏ?', ['Hải Phòng']],
];

function sampleQuestions(): Question[] {
  return SAMPLE.map(([text, answers], i) => ({ id: `sample${i + 1}`, text, answers, seconds: 20, ignoreAccents: true }));
}

function cleanUrl(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  const s = u.trim();
  if (!s) return undefined;
  if (/^\/arrow\/media\/[a-z0-9._-]+$/.test(s)) return s;
  if (/^https?:\/\/[^\s]+$/i.test(s) && s.length <= 2000) return s;
  throw new Error('URL media không hợp lệ');
}

/** kiểm tra + chuẩn hoá danh sách câu hỏi; ném Error với thông báo tiếng Việt nếu sai */
export function validateQuestions(input: unknown): Question[] {
  if (!Array.isArray(input)) throw new Error('questions phải là mảng');
  if (input.length > 2000) throw new Error('Quá nhiều câu hỏi');
  const seen = new Set<string>();
  return input.map((raw: any, idx) => {
    const at = `Câu ${idx + 1}`;
    if (!raw || typeof raw !== 'object') throw new Error(`${at}: không hợp lệ`);
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) throw new Error(`${at}: thiếu nội dung câu hỏi`);
    if (text.length > 500) throw new Error(`${at}: câu hỏi quá dài`);
    const answers = (Array.isArray(raw.answers) ? raw.answers : [])
      .map((a: unknown) => (typeof a === 'string' ? a.trim() : ''))
      .filter(Boolean);
    if (answers.length < 1) throw new Error(`${at}: cần ít nhất 1 đáp án`);
    if (answers.length > 20 || answers.some((a: string) => a.length > 120)) throw new Error(`${at}: đáp án quá dài/nhiều`);
    const seconds = Math.round(Number(raw.seconds));
    if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) throw new Error(`${at}: thời gian phải từ 5 đến 120 giây`);
    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : '';
    if (!id || seen.has(id)) id = randomBytes(6).toString('hex');
    seen.add(id);
    const q: Question = { id, text, answers, seconds };
    try {
      const image = cleanUrl(raw.image);
      const audio = cleanUrl(raw.audio);
      const video = cleanUrl(raw.video);
      if (image) q.image = image;
      if (audio) q.audio = audio;
      if (video) q.video = video;
    } catch (e: any) {
      throw new Error(`${at}: ${e.message}`);
    }
    if (raw.ignoreAccents) q.ignoreAccents = true;
    if (typeof raw.note === 'string' && raw.note.trim()) q.note = raw.note.trim().slice(0, 300);
    return q;
  });
}

export function loadQuestions(): Question[] {
  try {
    if (existsSync(QUESTIONS_FILE)) {
      const data = JSON.parse(readFileSync(QUESTIONS_FILE, 'utf8'));
      return validateQuestions(Array.isArray(data) ? data : data.questions);
    }
  } catch (e) {
    console.warn('[quiz] không đọc được questions.json:', (e as Error).message);
  }
  return [];
}

/** bộ câu hỏi dùng khi chơi: kho rỗng thì dùng mẫu */
export function loadPlayable(): Question[] {
  const qs = loadQuestions();
  return qs.length ? qs : sampleQuestions();
}

export function saveQuestions(qs: Question[]) {
  ensureDirs();
  atomicWrite(QUESTIONS_FILE, JSON.stringify({ questions: qs }, null, 2));
}

/** tên file media được câu hỏi tham chiếu */
export function referencedMedia(qs: Question[]): Set<string> {
  const s = new Set<string>();
  for (const q of qs) for (const u of [q.image, q.audio, q.video]) if (u?.startsWith(MEDIA_PREFIX)) s.add(u.slice(MEDIA_PREFIX.length));
  return s;
}

export function mediaUsage(): number {
  ensureDirs();
  let total = 0;
  for (const f of readdirSync(MEDIA_DIR)) {
    try {
      total += statSync(join(MEDIA_DIR, f)).size;
    } catch { /* bỏ qua */ }
  }
  return total;
}

export function gcMedia(): number {
  ensureDirs();
  const used = referencedMedia(loadQuestions());
  let removed = 0;
  for (const f of readdirSync(MEDIA_DIR)) {
    if (!used.has(f)) {
      try {
        unlinkSync(join(MEDIA_DIR, f));
        removed++;
      } catch { /* bỏ qua */ }
    }
  }
  return removed;
}
