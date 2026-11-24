/**
 * Generated placeholders (no stock photos, no external requests): a colored circle with the person's
 * or page's initials, and a soft gradient for covers. Shown only until the user picks a real image.
 */
import { assetUrl } from '../services/apiBase';

const PALETTE = ['#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#059669', '#0891B2', '#4F46E5', '#CA8A04'];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '?';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

export function initialsAvatar(name: string): string {
  const color = PALETTE[hash(name || '?') % PALETTE.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
    `<rect width="256" height="256" fill="${color}"/>` +
    `<text x="50%" y="50%" dy=".35em" text-anchor="middle" fill="#fff" ` +
    `font-family="Arial,Helvetica,sans-serif" font-size="120" font-weight="700">${(Array.from(name.trim())[0] || '?').toUpperCase()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</text></svg>`;
  return toDataUrl(svg);
}

export function gradientCover(seed: string): string {
  const h = hash(seed || 'echat');
  const a = PALETTE[h % PALETTE.length];
  const b = PALETTE[(h >> 3) % PALETTE.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/>` +
    `<stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="400" fill="url(#g)"/></svg>`;
  return toDataUrl(svg);
}

/** True when the value is one of our generated placeholders (not a user-chosen photo). */
export function isGeneratedImage(url?: string): boolean {
  return !url || url.startsWith('data:image/svg+xml');
}

/**
 * True when a profile-photo URL can actually load. Empty / "undefined" / temporary blob: URLs and
 * old Firebase Storage links (that bucket no longer exists) are treated as "no photo".
 */
export function isUsableAvatarUrl(url?: string | null): url is string {
  if (!url || typeof url !== 'string') return false;
  const value = url.trim();
  if (!value || value === 'undefined' || value === 'null') return false;
  if (value.startsWith('data:image/')) return true;
  if (value.startsWith('blob:')) return false;
  if (/firebasestorage\.googleapis\.com|\.firebasestorage\.app\/|\.appspot\.com\/o\//i.test(value)) return false;
  return /^https?:\/\//i.test(value) || value.startsWith('/');
}

/**
 * Safety net for every profile picture in the app: when an avatar image fails to load, swap it for
 * the coloured initials circle right away (never a broken-image icon). Avatars are recognised by the
 * `data-avatar` attribute or the round `rounded-full` class; the name comes from data-name or alt.
 */
export function installAvatarFallback(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.src.startsWith('data:image/svg+xml')) return; // already the fallback
    if (img.dataset.avatar === undefined && !img.classList.contains('rounded-full')) return;
    // A relative /uploads/… photo may live on the API server: try that address once before giving up.
    const raw = img.getAttribute('src') || '';
    if (raw.startsWith('/') && !raw.startsWith('//') && img.dataset.avatarRetried !== '1') {
      const absolute = assetUrl(raw);
      if (absolute !== raw) { img.dataset.avatarRetried = '1'; img.src = absolute; return; }
    }
    const name = img.dataset.name || (img.alt && !/^(you|avatar|user|profile|profile picture)$/i.test(img.alt) ? img.alt : '') || '?';
    img.removeAttribute('srcset');
    img.src = initialsAvatar(name);
  }, true);
}
