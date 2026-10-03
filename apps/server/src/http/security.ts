import type { IncomingMessage, ServerResponse } from 'node:http';
import helmet from 'helmet';

export interface SecurityOptions {
  /** Extra origins for `connect-src` (e.g. a LiveKit server). */
  extraConnectSrc: string[];
  allowedOrigins: string[];
}

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/** Helmet with a CSP tuned for the app (WASM physics, WebRTC media, blob workers). */
export function createSecurityHeaders(options: SecurityOptions): Middleware {
  const mw = helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'wasm-unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:', 'mediastream:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'ws:', 'wss:', ...options.extraConnectSrc],
        'worker-src': ["'self'", 'blob:'],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // Screen capture and camera/mic need these to stay available to our own origin.
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  return (req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)',
    );
    mw(req, res, next);
  };
}

/** Same-origin by default; explicit allowlist for split deployments. */
export function isOriginAllowed(req: IncomingMessage, allowed: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  // A malformed Origin header is treated as a foreign origin.
  if (!URL.canParse(origin)) return false;
  return new URL(origin).host === host;
}

export function applyCors(req: IncomingMessage, res: ServerResponse, allowed: string[]): void {
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}
