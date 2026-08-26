import type { NextConfig } from "next";

/**
 * Baseline security headers (master prompt §25 OWASP baseline).
 *
 * Content-Security-Policy is deliberately NOT set here — it needs a fresh
 * per-request nonce, which a static header table cannot produce. It lives
 * in `src/middleware.ts` instead (docs/WORLD_CLASS_AUDIT.md A-04). Keeping
 * the two sets separate avoids a stale duplicate CSP here silently
 * overriding the real one; browsers enforce the *intersection* of multiple
 * CSP headers, so a second one is a debugging nightmare, not a safety net.
 *
 * X-Frame-Options stays even though the CSP's `frame-ancestors 'none'`
 * supersedes it in modern browsers — it's the fallback for older ones.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
