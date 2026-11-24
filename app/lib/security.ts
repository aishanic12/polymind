import { NextRequest, NextResponse } from 'next/server';

// ── Shared limits & helpers for all API routes ─────────────────────
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TEXT_CHARS = 100_000;
export const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 10) * 60_000;
export const SUMMARY_RATE_LIMIT = Number(process.env.RATE_LIMIT_MAX || 10);
export const CHAT_RATE_LIMIT = Number(process.env.RATE_LIMIT_CHAT_MAX || 30);

// Local model requests are rate limited per IP to avoid overwhelming the host.
// Counters live in server memory and reset when the server restarts.
const hits = new Map<string, number[]>();

export function isRateLimited(bucket: string, ip: string, max: number): boolean {
  const now = Date.now();
  const id = `${bucket}:${ip}`;
  const recent = (hits.get(id) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= max) {
    hits.set(id, recent);
    return true;
  }
  recent.push(now);
  hits.set(id, recent);
  if (hits.size > 5000) {
    hits.forEach((v, k) => {
      if (!v.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) hits.delete(k);
    });
  }
  return false;
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

// Block other websites from calling the API from a visitor's browser.
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients (curl, server-to-server)
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

// Every response is no-store so keys, summaries and chats are never cached.
export function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

// Reads a plain-string form field (a file sent in its place is ignored).
export function formString(formData: FormData, name: string, fallback = ''): string {
  const v = formData.get(name);
  return typeof v === 'string' ? v : fallback;
}
