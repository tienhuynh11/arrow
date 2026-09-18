import { NAME_MAX } from '../../../shared/protocol.js';

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Names are rendered as plain text on the client, but we still strip anything
 * that looks like markup so a leaked innerHTML sink can never be exploited.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'PLAYER';
  const cleaned = raw
    .replace(CONTROL_CHARS, '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return cleaned.length > 0 ? cleaned : 'PLAYER';
}

export function sanitizeCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
}

/** Sliding-window limiter used per connection. */
export class RateLimiter {
  private hits: number[] = [];
  constructor(private limit: number, private windowMs: number) {}

  allow(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0 && this.hits[0] < cutoff) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
