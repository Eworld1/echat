import React, { useState } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

const DISMISS_KEY = 'echat_install_dismissed_at';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/** Small "Install Echat" bar + iPhone instructions. Hidden once the app is installed. */
export const InstallAppBanner: React.FC = () => {
  const { canInstall, ios, install } = useInstallPrompt();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < SEVEN_DAYS;
  });

  if (!canInstall || dismissed) return null;

  const handleInstall = async () => {
    const result = await install();
    if (result === 'ios') setShowIosHelp(true);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <>
      <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-sm z-[70] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3.5 flex items-center gap-3">
        <img src="/icon-192.png" alt="" className="w-11 h-11 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-slate-900 leading-tight">Install Echat</p>
          <p className="text-[11px] text-slate-500 leading-snug">
            {ios ? 'Add it to your Home Screen for the full app experience.' : 'Get the app on your device: faster, full screen, no browser bar.'}
          </p>
        </div>
        <button onClick={handleInstall} className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5">
          <Download size={14} /> Install
        </button>
        <button onClick={dismiss} aria-label="Not now" className="text-slate-400 hover:text-slate-600">
          <X size={18} />
        </button>
      </div>

      {showIosHelp && <IosInstallHelp onClose={() => setShowIosHelp(false)} />}
    </>
  );
};

export const IosInstallHelp: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[95] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
      <h3 className="text-lg font-extrabold text-slate-900">Install Echat on iPhone / iPad</h3>
      <ol className="mt-4 space-y-3 text-sm text-slate-700">
        <li className="flex items-start gap-3">
          <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center flex-shrink-0">1</span>
          <span>Open this page in <strong>Safari</strong>, then tap the <Share size={14} className="inline -mt-1 mx-0.5" /> <strong>Share</strong> button.</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center flex-shrink-0">2</span>
          <span>Scroll down and tap <PlusSquare size={14} className="inline -mt-1 mx-0.5" /> <strong>Add to Home Screen</strong>.</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center flex-shrink-0">3</span>
          <span>Tap <strong>Add</strong>. Echat now opens like a normal app.</span>
        </li>
      </ol>
      <button onClick={onClose} className="mt-5 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold">Got it</button>
    </div>
  </div>
);
