import React from 'react';
import { Sparkles } from 'lucide-react';
import { useEchatTheme } from '../hooks/useEchatTheme';

function changeRoute(path: string) {
  window.history.pushState({ echatTheme: true }, '', path);
  window.dispatchEvent(new Event('echat:navigate'));
}

export const EchatThemeToggle: React.FC<{compact?:boolean}> = ({compact=false}) => {
  const {theme,setTheme}=useEchatTheme();
  return <div className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm ${compact?'text-[11px]':'text-xs'}`} aria-label="Choose Echat version">
    <button type="button" aria-pressed={theme==='classic'} onClick={()=>{setTheme('classic');if(location.pathname.startsWith('/v2/'))changeRoute('/home');}} className={`rounded-full px-3 py-1.5 font-bold ${theme==='classic'?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-100'}`}>Classic</button>
    <button type="button" aria-pressed={theme==='v2'} onClick={()=>{if(setTheme('v2'))changeRoute('/v2/home');}} className={`rounded-full px-3 py-1.5 font-bold ${theme==='v2'?'bg-amber-400 text-slate-950':'text-slate-600 hover:bg-slate-100'}`}><Sparkles size={13} className="mr-1 inline"/>New</button>
  </div>;
};
