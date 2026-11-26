import { join, normalize, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'btterm';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** app://btterm/<path> 를 renderer 폴더 안의 파일 경로로 바꾼다. 폴더 밖이면 null(SEC-7). */
export function resolveAppPath(rootDir: string, requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.slice(1);
  const root = normalize(rootDir);
  const target = normalize(join(root, relative.replaceAll('\\', '/')));
  return target.startsWith(root + sep) ? target : null;
}
