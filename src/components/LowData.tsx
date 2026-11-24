import React, { useEffect, useState } from 'react';
import { Download, Film, Gauge, Image as ImageIcon, Leaf, Play } from 'lucide-react';
import { countSaving, formatBytes, isUnlocked, lightVideoPoster, unlock, useDataSavedThisWeek, useLowDataMode, useMediaSize } from '../services/lowData';

/** Low Data Mode is switched only from Settings & Privacy → Data & Storage (no feed card, no pop-up). */

/** Small ON/OFF switch. */
export const LowDataSwitch: React.FC<{ checked: boolean; onChange: (on: boolean) => void; label: string; size?: 'sm' | 'md' }> = ({ checked, onChange, label, size = 'md' }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
    className={`relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'} ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'}`}>
    <span className={`pointer-events-none inline-block transform rounded-full bg-white shadow transition ${size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} ${checked ? (size === 'sm' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'}`} />
  </button>
);

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
