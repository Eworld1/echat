import { apiUrl } from '../services/apiBase';

export interface LinkPreview {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

const cache = new Map<string, { expires: number; value: LinkPreview }>();
const urlPattern = /(https?:\/\/[^\s<>()]+)/i;

export function extractFirstUrl(text: string): string | null {
  const match = text.match(urlPattern);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[.,!?;:]+$/, ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function isVideoPlatformUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com') || host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch';
  } catch { return false; }
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  const parsed = new URL(url);
  const fallback: LinkPreview = { url, domain: parsed.hostname.replace(/^www\./, ''), favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64` };
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    try {
      let response = await fetch(apiUrl('/api/link-preview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: controller.signal });
      if (!response.ok) response = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}&meta=true`, { signal: controller.signal });
      if (!response.ok) throw new Error('Preview unavailable');
      const result = await response.json();
      const data = result?.data || result || {};
      const preview: LinkPreview = {
        ...fallback,
        title: typeof data.title === 'string' ? data.title.slice(0, 180) : undefined,
        description: typeof data.description === 'string' ? data.description.slice(0, 300) : undefined,
        image: typeof data.image?.url === 'string' ? data.image.url : typeof data.image === 'string' ? data.image : undefined,
        favicon: typeof data.logo?.url === 'string' ? data.logo.url : typeof data.favicon === 'string' ? data.favicon : fallback.favicon
      };
      cache.set(url, { value: preview, expires: Date.now() + 60 * 60 * 1000 });
      return preview;
    } finally { window.clearTimeout(timer); }
  } catch {
    cache.set(url, { value: fallback, expires: Date.now() + 60 * 60 * 1000 });
    return fallback;
  }
}
