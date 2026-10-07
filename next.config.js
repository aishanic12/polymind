/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// Content-Security-Policy: only this site's own code may run, and the browser may
// only talk back to this site. Fonts come from Google Fonts. (Next.js needs
// 'unsafe-inline' for its small inline bootstrap scripts; dev mode also needs eval.)
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  `connect-src 'self'${isProd ? '' : ' ws: wss:'}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  ...(isProd ? [{ key: 'Content-Security-Policy', value: csp }] : []),
];

const nextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The API never gets cached anywhere.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
    ];
  },
};

module.exports = nextConfig;
