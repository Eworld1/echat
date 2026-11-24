import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Link previews for shared eChat links (WhatsApp, Facebook, X, Telegram, iMessage…).
 *
 *   /post/:id  → rich card for a post        (vercel.json rewrites to /api/preview?kind=post&id=…)
 *   /u/:id     → rich card for a profile     (also /profile?user=… and old /home?post=… links)
 *
 * Crawlers don't run JavaScript, so this returns the normal app page (index.html) with the right
 * og:/twitter: tags already in <head>. People who open the link get the same page and the app opens
 * the post / profile as usual. Data comes from the EChat server's public /api/preview endpoints.
 */

type Req = IncomingMessage & { query?: Record<string, string | string[] | undefined> };
interface Meta { title: string; description: string; image: string; url: string; type: 'website' | 'article' | 'profile'; imageAlt: string; largeImage: boolean }

const PRODUCTION_HOST = (process.env.VERCEL_PROJECT_PRODUCTION_URL || 'echat-ivory.vercel.app').replace(/^https?:\/\//, '');
const API_BASE = (process.env.VITE_API_URL || process.env.ECHAT_API_URL || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
const DEFAULT_DESCRIPTION = 'Chat, stream and connect on eChat: messages, HD calls, live streams, Reels and a marketplace in one place.';

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

/** WhatsApp wants a reasonably small JPG/PNG: ask Cloudinary for a 1200×630 (or 600×600) JPG. */
function shareImage(url: string, square: boolean): string {
  const match = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/);
  if (!match) return url;
  const size = square ? 'c_fill,g_face,w_600,h_600' : 'c_fill,g_auto,w_1200,h_630';
  return `${match[1]}${size},q_auto,f_jpg/${match[2]}`;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { signal: controller.signal, headers: { accept: 'application/json, text/html' } }); }
  finally { clearTimeout(timer); }
}

let cachedShell: { html: string; at: number } | null = null;
async function appShell(site: string): Promise<string> {
  if (cachedShell && Date.now() - cachedShell.at < 5 * 60_000) return cachedShell.html;
  const response = await fetchWithTimeout(`${site}/index.html`, 4000);
  if (!response.ok) throw new Error(`index.html ${response.status}`);
  const html = await response.text();
  if (!html.includes('<div id="root">')) throw new Error('unexpected index.html');
  cachedShell = { html, at: Date.now() };
  return html;
}

async function lookup(kind: 'post' | 'user', id: string): Promise<{ title: string; description: string; image: string; video?: boolean } | null> {
  if (!API_BASE || !id) return null;
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/preview/${kind}/${encodeURIComponent(id)}`, 5000);
    if (!response.ok) return null;
    const data = await response.json() as { title?: string; description?: string; image?: string; video?: boolean };
    return data.title ? { title: data.title, description: data.description || '', image: data.image || '', video: data.video } : null;
  } catch {
    return null; // server asleep / unreachable: fall back to the eChat card
  }
}

function metaTags(meta: Meta): string {
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(meta.url)}" />`,
    `<meta property="og:site_name" content="eChat" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:image:secure_url" content="${esc(meta.image)}" />`,
    `<meta property="og:image:alt" content="${esc(meta.imageAlt)}" />`,
    `<meta name="twitter:card" content="${meta.largeImage ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image)}" />`
  ];
  return tags.join('\n    ');
}

/** Drop index.html's generic title/description/og/twitter tags and put this link's tags in their place. */
function inject(html: string, meta: Meta): string {
  const stripped = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');
  return stripped.replace(/<head>/i, `<head>\n    ${metaTags(meta)}`);
}

/** Tiny page for when index.html can't be fetched: crawlers still get the tags, people are sent to the app. */
function fallbackPage(meta: Meta, appPath: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    ${metaTags(meta)}
    <meta http-equiv="refresh" content="0;url=${esc(appPath)}" /></head>
    <body><p><a href="${esc(appPath)}">Open on eChat</a></p><script>location.replace(${JSON.stringify(appPath)})</script></body></html>`;
}

export default async function handler(req: Req, res: ServerResponse): Promise<void> {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || PRODUCTION_HOST).split(',')[0].trim();
  const site = `https://${host}`;
  const query = req.query || Object.fromEntries(new URL(req.url || '/', site).searchParams);
  const kind = one(query.kind) === 'user' ? 'user' : 'post';
  const id = one(query.id).slice(0, 200);
  const shareUrl = `${site}/${kind === 'user' ? 'u' : 'post'}/${encodeURIComponent(id)}`;
  const appPath = kind === 'user' ? `/profile?user=${encodeURIComponent(id)}` : `/home?post=${encodeURIComponent(id)}`;
  const logo = `https://${PRODUCTION_HOST}/logo-512.png`;

  const found = await lookup(kind, id);
  const image = found?.image && /^https:\/\//.test(found.image) ? shareImage(found.image, kind === 'user') : logo;
  const meta: Meta = found
    ? { title: found.title, description: found.description || DEFAULT_DESCRIPTION, image, url: shareUrl, type: kind === 'user' ? 'profile' : 'article', imageAlt: found.title, largeImage: kind === 'post' && image !== logo }
    : { title: kind === 'user' ? 'eChat profile' : 'eChat post', description: DEFAULT_DESCRIPTION, image: logo, url: shareUrl, type: 'website', imageAlt: 'eChat logo', largeImage: false };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short CDN cache: edits show up within minutes, and repeated crawler hits don't wake the server.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  try {
    res.statusCode = 200;
    res.end(inject(await appShell(site), meta));
  } catch {
    res.statusCode = 200;
    res.end(fallbackPage(meta, appPath));
  }
}
