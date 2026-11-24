import React, { useEffect, useState } from 'react';
import { Download, Film, Gauge, Image as ImageIcon, Leaf, Play, Wifi, X } from 'lucide-react';
import {
  countSaving, formatBytes, isUnlocked, lightVideoPoster, markLowDataSuggested, onNetworkChange, setLowDataMode,
  shouldSuggestLowData, unlock, useDataSavedThisWeek, useLowDataMode, useMediaSize
} from '../services/lowData';

/** Small ON/OFF switch. */
export const LowDataSwitch: React.FC<{ checked: boolean; onChange: (on: boolean) => void; label: string; size?: 'sm' | 'md' }> = ({ checked, onChange, label, size = 'md' }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
    className={`relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'} ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'}`}>
    <span className={`pointer-events-none inline-block transform rounded-full bg-white shadow transition ${size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} ${checked ? (size === 'sm' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'}`} />
  </button>
);

/** Top of the Feed: "Low Data: ON/OFF" quick toggle + green "Saving Data" badge when ON. */
export const LowDataFeedBar: React.FC = () => {
  const [on, setOn] = useLowDataMode();
  const saved = useDataSavedThisWeek();
  return (
    <div className={`ec-card flex items-center gap-3 px-4 py-2.5 transition ${on ? 'bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-400/30' : 'bg-white dark:bg-[#161033]'}`}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${on ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'}`}><Leaf size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Low Data: {on ? 'ON' : 'OFF'}</p>
        {on
          ? <p className="flex flex-wrap items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white"><span className="h-1.5 w-1.5 rounded-full bg-white" />Low Data ON - Saving Data</span>{saved > 0 && <span>{formatBytes(saved)} saved this week</span>}</p>
          : <p className="truncate text-xs text-slate-500 dark:text-slate-400">Turn on to stop autoplay and load lighter photos.</p>}
      </div>
      <LowDataSwitch checked={on} onChange={setOn} label="Low Data Mode" />
    </div>
  );
};

/** Settings → Data & Storage. */
export const LowDataSettingsCard: React.FC = () => {
  const [on, setOn] = useLowDataMode();
  const saved = useDataSavedThisWeek();
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Leaf size={16} className="text-emerald-600" />Low Data Mode</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Use less mobile data. Stays on until you turn it off.</div>
        </div>
        <LowDataSwitch checked={on} onChange={setOn} label="Low Data Mode" />
      </div>
      <div className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${on ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-slate-50 text-slate-600 dark:bg-white/5 dark:text-slate-300'}`}>
        {saved > 0 ? <>You saved <b>{formatBytes(saved)}</b> this week with Low Data Mode</> : on ? 'You saved 0 MB this week so far. Savings appear as you use EChat.' : 'Turn on Low Data Mode to start saving data.'}
      </div>
      <ul className="grid gap-1.5 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-2">
        <li className="flex items-center gap-2"><Film size={14} className="shrink-0 text-violet-500" />No video or Reels autoplay</li>
        <li className="flex items-center gap-2"><ImageIcon size={14} className="shrink-0 text-violet-500" />Blurred previews, tap for HD</li>
        <li className="flex items-center gap-2"><Download size={14} className="shrink-0 text-violet-500" />Chat media: tap to download</li>
        <li className="flex items-center gap-2"><Gauge size={14} className="shrink-0 text-violet-500" />Smaller uploads (800px photos, 480p video)</li>
      </ul>
    </div>
  );
};

/** "Slow network detected" popup (2G / 3G / phone data saver). Once every few days, never after a choice. */
export const LowDataSuggestion: React.FC = () => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const check = () => { if (shouldSuggestLowData()) { markLowDataSuggested(); setVisible(true); } };
    const timer = window.setTimeout(check, 2500);
    const stop = onNetworkChange(check);
    return () => { window.clearTimeout(timer); stop(); };
  }, []);
  if (!visible) return null;
  const choose = (on: boolean) => { setLowDataMode(on); setVisible(false); };
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="low-data-title" className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[95] mx-auto max-w-sm rounded-[20px] border border-emerald-200 bg-white p-4 shadow-2xl shadow-emerald-900/20 ec-fade-up dark:border-emerald-400/30 dark:bg-[#161033] sm:bottom-6">
      <button type="button" onClick={() => setVisible(false)} aria-label="Not now" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18} /></button>
      <div className="flex items-start gap-3 pr-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15"><Wifi size={20} /></span>
        <div>
          <p id="low-data-title" className="font-extrabold text-slate-900 dark:text-white">Slow network detected. Turn ON Low Data Mode?</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Videos won't autoplay and photos load lighter. You can change this in Settings → Data & Storage.</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => choose(false)} className="min-h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 dark:bg-white/10 dark:text-slate-200">Keep OFF</button>
        <button type="button" onClick={() => choose(true)} className="min-h-11 rounded-xl bg-emerald-500 text-sm font-bold text-white hover:bg-emerald-600">Turn ON</button>
      </div>
    </div>
  );
};

/**
 * Low Data video cover: thumbnail + Play + size ("2.1 MB"). Nothing of the video downloads until tapped.
 * Where the video would have autoplayed (Reels) its size counts as data saved (un-counted when played).
 */
export const LowDataVideoCover: React.FC<{ url: string; poster?: string; onPlay: () => void; className?: string; label?: string; /** true where the video would normally autoplay (Reels) */ countsAsSaving?: boolean }> = ({ url, poster, onPlay, className = '', label = 'Play video', countsAsSaving = true }) => {
  const size = useMediaSize(url, true);
  const posterUrl = poster || lightVideoPoster(url);
  useEffect(() => { if (size && countsAsSaving) countSaving(url, size); }, [url, size, countsAsSaving]);
  return (
    <button type="button" onClick={event => { event.stopPropagation(); unlock(url); onPlay(); }} aria-label={`${label}${size ? ` (${formatBytes(size)})` : ''}`}
      className={`relative flex w-full items-center justify-center overflow-hidden bg-slate-900 text-white ${className}`}>
      {posterUrl ? <img src={posterUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-80" /> : <Film size={42} className="text-white/30" />}
      <span className="relative flex flex-col items-center gap-2">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-black/60 ring-2 ring-white/70 backdrop-blur-sm"><Play size={28} fill="currentColor" className="ml-1" /></span>
        <span className="rounded-full bg-black/65 px-3 py-1 text-xs font-bold">{size ? formatBytes(size) : 'Tap to play'} · Low Data</span>
      </span>
    </button>
  );
};

/** Chat photo / video in Low Data Mode: "Tap to download (1.2 MB)" until tapped. */
export const ChatMediaGate: React.FC<{ url: string; kind: 'image' | 'video'; size?: number; name?: string; children: React.ReactNode }> = ({ url, kind, size, name, children }) => {
  const [lowData] = useLowDataMode();
  const [open, setOpen] = useState(() => isUnlocked(url));
  const gated = lowData && !open;
  const knownSize = useMediaSize(url, gated, size);
  useEffect(() => { if (gated && knownSize) countSaving(url, knownSize); }, [gated, url, knownSize]);
  if (!gated) return <>{children}</>;
  return (
    <button type="button" onClick={event => { event.stopPropagation(); unlock(url); setOpen(true); }}
      className="mt-1.5 flex min-h-[72px] w-56 max-w-full items-center gap-3 rounded-xl bg-black/10 px-3 py-2 text-left text-current transition hover:bg-black/15 dark:bg-white/10">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/15 dark:bg-white/15">{kind === 'image' ? <ImageIcon size={20} /> : <Film size={20} />}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{kind === 'image' ? 'Photo' : 'Video'}</span>
        <span className="flex items-center gap-1 text-xs opacity-80"><Download size={12} />Tap to download{knownSize ? ` (${formatBytes(knownSize)})` : ''}</span>
        {name && <span className="block truncate text-[10px] opacity-60">{name}</span>}
      </span>
    </button>
  );
};
