import { NextResponse, type NextRequest } from "next/server";

/**
 * Nonce-based Content-Security-Policy (docs/WORLD_CLASS_AUDIT.md finding
 * A-04). This was deliberately deferred for a long time on the correct
 * reasoning that a half-right CSP is worse than none — Next.js needs either
 * `unsafe-inline` (which defeats the point) or a per-request nonce threaded
 * through the framework's own bootstrap scripts. This does the latter.
 *
 * How the nonce reaches React: Next.js reads the nonce out of the *request's*
 * CSP header and automatically applies it to the framework's inline scripts,
 * so the header has to be set on the forwarded request, not only on the
 * response. Both are set below for that reason — dropping the request-side
 * header silently breaks hydration in production, where the fallback
 * `unsafe-inline` is absent.
 *
 * Deliberate choices worth not "simplifying" later:
 *
 * - `'strict-dynamic'` lets Next's nonce'd bootstrap load the chunks it
 *   needs without enumerating every hashed filename. Browsers that honour
 *   it ignore the host allow-list; the `'self'` entry is the fallback for
 *   ones that don't.
 * - `'unsafe-eval'` is allowed in development ONLY. React Refresh/HMR needs
 *   it; production must never have it.
 * - `style-src` keeps `'unsafe-inline'`. Tailwind v4 and next/font both
 *   inject inline styles, and there is no nonce path for them here. This is
 *   a real, documented gap — inline *styles* are a far smaller attack
 *   surface than inline scripts, but it is not zero, and it should be
 *   revisited if the styling pipeline ever makes nonces practical.
 * - `frame-ancestors 'none'` duplicates the existing X-Frame-Options header
 *   on purpose: CSP supersedes it in modern browsers, the header covers
 *   older ones.
 * - `form-action 'self'` matters more than usual here — it stops an
 *   injected form from posting exam answers or credentials off-origin.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // See the note above: inline styles are still permitted.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    // No third-party calls are made by this app; in dev the HMR websocket
    // needs the loopback origins.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    // Only meaningful over HTTPS; harmless on localhost.
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except Next's own static output and image optimizer.
     * Static assets are served from disk with no HTML context to inject
     * into, and running this on them would burn a UUID per asset request
     * for no benefit.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
