import type { NextConfig } from "next";

/**
 * Baseline security headers (master prompt §25 OWASP baseline). A strict
 * Content-Security-Policy is deliberately NOT included yet — Next.js needs
 * either 'unsafe-inline' (weak) or a nonce wired through middleware
 * (correct, more setup) for its bootstrap scripts, and shipping a
 * half-correct CSP is worse than none. Tracked as a follow-up in
 * PROJECT_STATUS.md rather than rushed in here.
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
