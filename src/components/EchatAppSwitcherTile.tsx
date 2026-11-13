import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useEchatTheme } from '../hooks/useEchatTheme';

interface Props {
  variant: 'classic' | 'v2';
  onNavigate?: () => void;
  compact?: boolean;
}

/** Shared Classic/V2 switcher entry used by the header and menus. */
export const EchatAppSwitcherTile: React.FC<Props> = ({ variant, onNavigate, compact = false }) => {
  const { setTheme } = useEchatTheme();
  const toV2 = variant === 'classic';
  const navigate = () => {
    setTheme(toV2 ? 'v2' : 'classic');
    window.history.pushState({ echatV2: toV2 }, '', toV2 ? '/v2/home' : '/home');
    window.dispatchEvent(new Event('echat:navigate'));
    onNavigate?.();
  };

  return (
    <button type="button" onClick={navigate} className={`group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 ${compact ? 'min-h-14' : 'min-h-[76px]'}`}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"><Sparkles size={21} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">{toV2 ? 'Echat V2' : 'Back to Echat Classic'}{toV2 && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-white">NEW</span>}</span>
        {!compact && <span className="mt-0.5 block text-xs leading-4 text-slate-500 dark:text-slate-300">{toV2 ? 'Try New Echat - Same account and posts' : 'Return to your Classic Echat home'}</span>}
      </span>
      <ArrowRight size={17} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
    </button>
  );
};
