import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { ECHAT_V2_DEFAULT, ECHAT_V2_ENABLED } from '../config/featureFlags';

export type EchatTheme = 'classic' | 'v2';
function readTheme(): EchatTheme {
  try { return ECHAT_V2_ENABLED && (window.location.pathname.startsWith('/v2/') || (localStorage.getItem('echat_theme') === 'v2' && localStorage.getItem('echat_theme_explicit') === 'true')) ? 'v2' : ECHAT_V2_DEFAULT; }
  catch { return ECHAT_V2_DEFAULT; }
}

/** Keeps the Classic/V2 choice on this device and in the signed-in user's settings. */
export function useEchatTheme() {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<EchatTheme>(readTheme);
  const manuallyChanged = useRef(false);

  useEffect(() => {
    try { document.documentElement.classList.toggle('echat-v2-dark', localStorage.getItem('echat_v2_dark') === 'true'); } catch { /* Storage can be unavailable in private browsing. */ }
    const sync = (event: Event) => { const next = (event as CustomEvent<EchatTheme>).detail; if (next === 'classic' || next === 'v2') setThemeState(next); };
    window.addEventListener('echat:theme-changed', sync);
    return () => window.removeEventListener('echat:theme-changed', sync);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const settingsRef = doc(db, 'users', user.id, 'settings', 'echat_theme');
    void getDoc(settingsRef).then(snapshot => {
      if (!active || manuallyChanged.current || !snapshot.exists()) return;
      const data = snapshot.data();
      const saved = data.theme ?? data.value ?? data.echat_theme;
      if (saved === 'classic' || (saved === 'v2' && ECHAT_V2_ENABLED)) {
        const directV2 = ECHAT_V2_ENABLED && window.location.pathname.startsWith('/v2/');
        let explicitV2 = false;
        try { explicitV2 = localStorage.getItem('echat_theme_explicit') === 'true'; } catch { /* Use Classic as the default. */ }
        const effective: EchatTheme = directV2 || (saved === 'v2' && explicitV2) ? 'v2' : 'classic';
        setThemeState(effective);
        window.dispatchEvent(new CustomEvent('echat:theme-changed', { detail: effective }));
        try { localStorage.setItem('echat_theme', effective); localStorage.setItem('echat_theme_explicit', 'true'); } catch { /* Keep the in-memory choice. */ }
        if (effective !== saved) void setDoc(settingsRef, { theme: effective, updatedAt: Date.now() }, { merge: true });
        else if ((saved === 'v2' && !directV2 && !explicitV2) || (saved === 'classic' && directV2)) window.location.replace(effective === 'v2' ? '/v2/home' : '/home');
      }
    }).catch(error => console.warn('[Echat] Could not load theme preference:', error));
    return () => { active = false; };
  }, [user?.id]);

  const setTheme = useCallback((next: EchatTheme) => {
    const safeNext = next === 'v2' && !ECHAT_V2_ENABLED ? 'classic' : next;
    manuallyChanged.current = true;
    setThemeState(safeNext);
    window.dispatchEvent(new CustomEvent('echat:theme-changed', { detail: safeNext }));
    try { localStorage.setItem('echat_theme', safeNext); localStorage.setItem('echat_theme_explicit', 'true'); } catch { /* In-memory navigation still works. */ }
    if (user?.id) void setDoc(doc(db, 'users', user.id, 'settings', 'echat_theme'), { theme: safeNext, updatedAt: Date.now() }, { merge: true }).catch(error => console.warn('[Echat] Could not save theme preference:', error));
    return safeNext;
  }, [user?.id]);

  return { theme, setTheme };
}
