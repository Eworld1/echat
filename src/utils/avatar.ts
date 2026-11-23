/**
 * Generated placeholders (no stock photos, no external requests): a colored circle with the person's
 * or page's initials, and a soft gradient for covers. Shown only until the user picks a real image.
 */
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
    `font-family="Arial,Helvetica,sans-serif" font-size="104" font-weight="700">${initialsOf(name)
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
