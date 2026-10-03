import { createReadStream, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

/** `stat` that maps "does not exist" to null and rethrows real I/O errors. */
async function statIfExists(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

/**
 * Serves the built SPA with path traversal protection. Hashed assets get long-lived caching;
 * unknown routes fall back to index.html so room links like `/r/abc123` work.
 */
export function createStaticHandler(rootDir: string) {
  const root = resolve(rootDir);
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (err: unknown) {
      res.statusCode = 400;
      res.end(`Bad request: ${String(err)}`);
      return true;
    }
    const candidate = normalize(join(root, pathname));
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return true;
    }
    let file = candidate;
    let info = await statIfExists(file);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await statIfExists(file);
    }
    if (!info?.isFile()) {
      if (extname(pathname) !== '') return false;
      file = join(root, 'index.html');
      info = await statIfExists(file);
      if (!info?.isFile()) return false;
    }
    const ext = extname(file);
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.setHeader(
      'Cache-Control',
      file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await new Promise<void>((done, fail) => {
      const stream = createReadStream(file);
      stream.on('error', fail);
      stream.on('end', () => done());
      stream.pipe(res);
    });
    return true;
  };
}
