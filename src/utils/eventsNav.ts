import { useEffect, useState } from 'react';

/** Navigate inside the classic app (App.tsx listens for "echat:navigate" and popstate). */
export function navigateTo(path: string): void {
  if (window.location.pathname === path) return;
  const tab = path.startsWith('/my-tickets') ? 'myTickets' : 'events';
  window.history.pushState({ echatApp: true, tab }, '', path);
  window.dispatchEvent(new Event('echat:navigate'));
  window.scrollTo({ top: 0 });
}

/** Current pathname, kept in sync with in-app navigation and the back button. */
export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener('echat:navigate', sync);
    window.addEventListener('echat:pathchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('echat:navigate', sync);
      window.removeEventListener('echat:pathchange', sync);
    };
  }, []);
  return pathname;
}

export function formatEventDate(iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, options) : 'Date to be announced';
}

export async function shareEvent(event: { id: string; title: string }): Promise<string> {
  const url = `${window.location.origin}/events/${encodeURIComponent(event.id)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: event.title, text: `${event.title} on EChat`, url });
      return '';
    }
    await navigator.clipboard.writeText(url);
    return 'Link copied';
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') return '';
    return 'Could not share this event';
  }
}
