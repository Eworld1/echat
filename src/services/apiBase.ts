/**
 * Production live-control endpoints are handled same-origin by Vercel functions.
 * The existing API and WebSocket service remains the backend for Classic features.
 */
const rawApiUrl: string = import.meta.env.VITE_API_URL ?? '';

export const LEGACY_API_URL: string = rawApiUrl.replace(/\/+$/, '');
export const API_URL: string = LEGACY_API_URL;

export function apiUrl(path: string): string {
  // These Go Live control-plane endpoints now run inside this Vercel project.
  if (import.meta.env.PROD && /^\/api\/live\/(auth|start|end|current|watch)(?:\?|$)/.test(path)) return path;
  return `${API_URL}${path}`;
}

/** Turns a server-relative upload path (/uploads/x.png) into a loadable URL. */
export function assetUrl(path: string): string {
  if (!path || /^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** WebSocket endpoint of the Echat server. */
export function wsUrl(): string {
  let base = (import.meta.env.VITE_SOCKET_URL as string | undefined)?.replace(/\/+$/, '') || LEGACY_API_URL;
  if (!base && typeof window !== 'undefined') {
    // Dev convenience: page opened on :5173 while the API/WS server lives on :3000.
    base =
      import.meta.env.DEV && window.location.port === '5173'
        ? `${window.location.protocol}//${window.location.hostname}:3000`
        : window.location.origin;
  }
  return `${base.replace(/^http/i, 'ws')}/ws`;
}
