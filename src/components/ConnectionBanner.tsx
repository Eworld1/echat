import { useEffect, useState } from 'react';
import { apiUrl } from '../services/apiBase';
import { isLowDataMode } from '../services/lowData';

/** Shows a visible warning when the Echat backend can't be reached. */
export function ConnectionBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        if (!cancelled) setOffline(!(res.ok && isJson));
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    check();
    // Low Data Mode: no background checks while the app is hidden, and only every 2 minutes.
    let lastCheck = Date.now();
    const id = setInterval(() => {
      if (isLowDataMode() && (document.visibilityState === 'hidden' || Date.now() - lastCheck < 120000)) return;
      lastCheck = Date.now();
      void check();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white text-sm font-semibold text-center px-4 py-2">
      Can't reach the Echat server. Posts, friends and chat are unavailable until it is back online.
    </div>
  );
}
