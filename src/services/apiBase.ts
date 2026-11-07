/**
 * Central place for backend URLs.
 * - VITE_API_URL empty  -> same-origin requests (server.ts serves both app and API).
 * - VITE_API_URL set    -> frontend (e.g. Vercel) talks to a separately hosted backend.
 */
const rawApiUrl: string = import.meta.env.VITE_API_URL ?? '';

export const API_URL: string = rawApiUrl.replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

/** Turns a server-relative upload path (/uploads/x.png) into a loadable URL. */
export function assetUrl(path: string): string {
  if (!path || /^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** WebSocket endpoint of the Echat server. */
export function wsUrl(): string {
  let base = API_URL;
  if (!base && typeof window !== 'undefined') {
    // Dev convenience: page opened on :5173 while the API/WS server lives on :3000.
    base =
      import.meta.env.DEV && window.location.port === '5173'
        ? `${window.location.protocol}//${window.location.hostname}:3000`
        : window.location.origin;
  }
  return `${base.replace(/^http/i, 'ws')}/ws`;
}
