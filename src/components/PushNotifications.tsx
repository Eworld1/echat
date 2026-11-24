import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2, X } from 'lucide-react';
import { PUSH_CHANGED_EVENT, disablePush, enablePush, getPushState, isInstalledApp, shouldAskForPush, snoozePushPrompt, syncPushAfterLogin, type PushState } from '../services/push';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function usePushState(): [PushState | null, () => void] {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => { void getPushState().then(setState); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(PUSH_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener(PUSH_CHANGED_EVENT, refresh); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  return [state, refresh];
}

/**
 * After login: refresh this device's token, and (once, unless "Not now" a week ago) ask
 * "Turn on notifications?". The browser's own permission box only opens after "Turn on" is tapped.
 */
export const PushPermissionPrompt: React.FC<{ userId: string | null }> = ({ userId }) => {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setVisible(false);
    if (!userId) return;
    void syncPushAfterLogin();
    const timer = window.setTimeout(() => { void shouldAskForPush().then(setVisible); }, 4000);
    return () => window.clearTimeout(timer);
  }, [userId]);

  if (!visible || !userId) return null;
  const later = () => { snoozePushPrompt(); setVisible(false); };
  const turnOn = async () => {
    setBusy(true); setError('');
    try {
      const result = await enablePush();
      if (result === 'blocked') setError('Notifications are blocked for eChat. You can allow them in your browser\'s site settings.');
      else setVisible(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not turn on notifications.'); }
    finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="push-prompt-title" className="ec-fade-up fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[95] mx-auto max-w-sm rounded-[20px] border border-[#e2c06e] bg-white p-4 shadow-2xl shadow-amber-900/20 dark:border-amber-300/30 dark:bg-[#161033] sm:bottom-6">
      <button type="button" onClick={later} aria-label="Not now" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18} /></button>
      <div className="flex items-start gap-3 pr-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fdf6e3] text-[#a87b22] ring-1 ring-[#e9cf8a] dark:bg-amber-500/15"><BellRing size={20} /></span>
        <div>
          <p id="push-prompt-title" className="font-extrabold text-slate-900 dark:text-white">Turn on notifications?</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Get new messages, friend requests and group posts even when eChat is closed. You can change this in Settings &amp; Privacy.</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={later} className="min-h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 dark:bg-white/10 dark:text-slate-200">Not now</button>
        <button type="button" onClick={() => void turnOn()} disabled={busy} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#f3dc9b] via-[#d9b25a] to-[#b68428] text-sm font-extrabold text-[#1f3d1a] disabled:opacity-70">{busy ? <><Loader2 size={16} className="animate-spin" />Turning on…</> : 'Turn on'}</button>
      </div>
    </div>
  );
};

/** Settings & Privacy → Push Notifications (this device). Takes effect straight away. */
export const PushNotificationsCard: React.FC = () => {
  const [state, refresh] = usePushState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const on = state === 'on';

  const toggle = async () => {
    if (busy || state === null || state === 'unsupported') return;
    setBusy(true); setError('');
    try {
      if (on) await disablePush();
      else {
        const result = await enablePush();
        if (result === 'blocked') setError('Notifications are blocked. Allow them for this site in your browser settings, then try again.');
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update notifications.'); }
    finally { setBusy(false); refresh(); }
  };

  const hint =
    state === 'unsupported' ? (isIOS() && !isInstalledApp() ? 'On iPhone: tap Share → Add to Home Screen, open eChat from there, then turn this on.' : 'This browser can\'t receive push notifications. Try Chrome, or install eChat (Add to Home Screen).')
    : state === 'blocked' ? 'Blocked in your browser. Tap the lock icon next to the address (or Site settings), allow Notifications, then come back.'
    : on ? 'On for this device. You\'ll get messages, friend requests and group posts even when eChat is closed.'
    : 'Off. Turn on to get messages, friend requests and group posts when eChat is closed.';

  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          {on ? <Bell size={16} className="text-blue-600" /> : <BellOff size={16} className="text-slate-400" />}
          Push Notifications
        </div>
        <div className="text-xs text-slate-500">{hint}</div>
        {error && <div role="alert" className="mt-1 text-xs font-semibold text-red-600">{error}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Push notifications"
        onClick={() => void toggle()}
        disabled={busy || state === null || state === 'unsupported'}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        {busy
          ? <Loader2 size={14} className="mx-auto animate-spin text-white" />
          : <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${on ? 'translate-x-5' : 'translate-x-0'}`} />}
      </button>
    </div>
  );
};
