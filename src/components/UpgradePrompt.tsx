import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

const CURRENT_VERSION = '2.0.0';
const VERSION_KEY = 'echat_app_version';
const DISMISS_KEY = `echat_upgrade_dismissed_${CURRENT_VERSION}`;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export const UpgradePrompt: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(VERSION_KEY) !== CURRENT_VERSION && localStorage.getItem(DISMISS_KEY) !== '1') setOpen(true);
  }, []);

  const finish = () => {
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    localStorage.removeItem(DISMISS_KEY);
    setOpen(false);
  };

  const upgrade = async () => {
    if (!isStandalone()) {
      setShowInstructions(true);
      return;
    }
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((registrations || []).map(registration => registration.update().catch(() => undefined)));
      if ('caches' in window) await Promise.all((await caches.keys()).map(key => caches.delete(key)));
    } catch { /* The app still reloads with the newest server assets. */ }
    finish();
    window.location.reload();
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-[10010] flex items-end justify-center bg-black/65 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
    <section className="w-full max-w-md rounded-3xl border border-amber-300/20 bg-slate-950 p-6 text-white shadow-2xl">
      <button onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setOpen(false); }} aria-label="Close" className="float-right rounded-full p-2 text-slate-400 hover:bg-white/10"><X size={18} /></button>
      <img src="/logo-192.png" alt="EchatSl" className="mb-4 h-16 w-16 rounded-full" />
      <h2 id="upgrade-title" className="text-xl font-black">New EChat Look is Here</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">Upgrade to get the new EChat logo and new features on your device.</p>
      {showInstructions && <div className="mt-4 rounded-xl bg-white/5 p-3 text-sm text-slate-200">
        <p className="font-bold">Add EchatSl to your Home Screen</p>
        <p className="mt-2"><b>Android:</b> Open the browser menu (⋮), then tap <i>Install app</i> or <i>Add to Home screen</i>.</p>
        <p className="mt-2"><b>iPhone/iPad:</b> Tap Share in Safari, then <i>Add to Home Screen</i>.</p>
        <button onClick={finish} className="mt-3 rounded-lg bg-amber-400 px-3 py-2 font-bold text-black">Done</button>
      </div>}
      {!showInstructions && <div className="mt-5 flex gap-3">
        <button onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setOpen(false); }} className="min-h-11 flex-1 rounded-xl border border-slate-700 px-4 py-2 font-bold text-slate-200">Later</button>
        <button onClick={() => void upgrade()} className="min-h-11 flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2 font-extrabold text-black"><Download size={17} />Upgrade Now</button>
      </div>}
    </section>
  </div>;
};
