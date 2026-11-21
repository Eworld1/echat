export type VideoLink = { kind: 'youtube' | 'facebook' | 'link'; originalUrl: string; embedUrl?: string; videoId?: string };

export function parseVideoLink(text: string): VideoLink | null {
  const raw = text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.!?]+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (['youtube.com', 'youtube-nocookie.com'].includes(host) || host === 'youtu.be') {
      const id = host === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] : url.searchParams.get('v') || url.pathname.match(/^\/(?:live|embed|shorts)\/([^/?]+)/)?.[1];
      if (id && /^[\w-]{6,}$/.test(id)) return { kind: 'youtube', originalUrl: raw, videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1` };
    }
    if (host === 'facebook.com' || host === 'fb.watch') return { kind: 'facebook', originalUrl: raw, embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(raw)}&show_text=false&autoplay=false` };
    return { kind: 'link', originalUrl: raw };
  } catch { return null; }
}
