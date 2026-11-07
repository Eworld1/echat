import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome/Edge/Samsung Internet fire this once, early: keep it at module level so it is never missed.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach(cb => cb());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(ua) || iPadOs;
}

/**
 * Install-the-app support for every device:
 * - Android / Windows / Mac / Linux (Chrome, Edge, Samsung Internet): one-tap native install prompt
 * - iPhone / iPad (Safari): no prompt exists, so we show "Share, then Add to Home Screen" steps
 */
export function useInstallPrompt() {
  const [, force] = useState(0);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const update = () => {
      force(n => n + 1);
      setInstalled(isStandalone());
    };
    subscribers.add(update);
    return () => { subscribers.delete(update); };
  }, []);

  const ios = isIos();
  const canPromptNatively = deferredPrompt !== null;
  const canInstall = !installed && (canPromptNatively || ios);

  const install = async (): Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'> => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      notify();
      return outcome;
    }
    return ios ? 'ios' : 'unavailable';
  };

  return { canInstall, installed, ios, install };
}
