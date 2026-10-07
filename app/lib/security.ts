import { NextRequest, NextResponse } from 'next/server';

// ── Shared limits & helpers for all API routes ─────────────────────
export const GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TEXT_CHARS = 100_000;
export const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 10) * 60_000;
export const SUMMARY_RATE_LIMIT = Number(process.env.RATE_LIMIT_MAX || 10);
export const CHAT_RATE_LIMIT = Number(process.env.RATE_LIMIT_CHAT_MAX || 30);

// Requests that use YOUR server key are rate limited per IP so nobody can drain
// your quota. Visitors who bring their own key use their own quota.
// NOTE: counters live in server memory; on Vercel each serverless instance has its
// own, so this is a good first defence rather than a strict cap.
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

// Keys are 20-200 characters of letters, digits, "_", "-" or ".".
export function looksLikeApiKey(key: string): boolean {
  return /^[A-Za-z0-9_.\-]{20,200}$/.test(key);
}

// Every response is no-store so keys, summaries and chats are never cached.
export function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

// Turns any Gemini/SDK error into a safe message (never exposes raw provider errors).
export function handleGeminiError(error: unknown) {
  const err = error as { message?: string; status?: number; name?: string };
  console.error('API error:', err.name || 'Error', err.status || ''); // never log the key or request

  const msg = err.message || '';
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key') || (err.status === 400 && msg.includes('key'))) {
    return reply({ error: 'Invalid API key. Please check your Gemini API key.' }, 401);
  }
  if (err.status === 403) {
    return reply({ error: 'This API key is not allowed to use Gemini. Please check its permissions.' }, 403);
  }
  if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || err.status === 429) {
    return reply({ error: 'API quota exceeded. Please try again later or use your own API key.' }, 429);
  }
  return reply({ error: 'Something went wrong. Please try again.' }, 500);
}

// Reads a plain-string form field (a file sent in its place is ignored).
export function formString(formData: FormData, name: string, fallback = ''): string {
  const v = formData.get(name);
  return typeof v === 'string' ? v : fallback;
}
