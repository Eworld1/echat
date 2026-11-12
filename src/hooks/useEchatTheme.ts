import { useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { ECHAT_V2_DEFAULT } from '../config/featureFlags';

/** Keep the V2 theme as the default and migrate saved classic preferences. */
export function useEchatTheme(): void {
  const { user } = useAuth();
  useEffect(() => {
    try {
      if (localStorage.getItem('echat_theme') !== ECHAT_V2_DEFAULT) localStorage.setItem('echat_theme', ECHAT_V2_DEFAULT);
      document.documentElement.classList.toggle('echat-v2-dark', localStorage.getItem('echat_v2_dark') === 'true');
    } catch { /* The app route still defaults to V2 when storage is unavailable. */ }
    if (!user?.id) return;
    const settingsRef = doc(db, 'users', user.id, 'settings', 'echat_theme');
    void getDoc(settingsRef).then(snapshot => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const storedTheme = data.theme ?? data.value ?? data.echat_theme;
      if (storedTheme === 'classic') return setDoc(settingsRef, { theme: ECHAT_V2_DEFAULT, updatedAt: Date.now() }, { merge: true });
    }).catch(error => console.warn('[Echat] Could not migrate saved theme preference:', error));
  }, [user?.id]);
}
