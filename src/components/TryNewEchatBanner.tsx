import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useEchatTheme } from '../hooks/useEchatTheme';

export const TryNewEchatBanner:React.FC=()=>{
  const {setTheme}=useEchatTheme();
  return <button type="button" onClick={()=>{setTheme('v2');window.history.pushState({echatV2:true},'','/v2/home');window.dispatchEvent(new Event('echat:navigate'));}} className="mb-4 flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-[#FFF8E7] to-amber-100 p-4 text-left shadow-sm">
    <span><b className="flex items-center gap-2 text-sm text-[#0F1B2D]"><Sparkles size={17} className="text-[#B17A00]"/>Try New Echat ✨</b><small className="mt-1 block text-xs text-slate-600">Explore Echat V2 with your same account and posts.</small></span><span className="flex items-center gap-2 rounded-full bg-[#F5B301] px-4 py-2 text-xs font-extrabold text-[#0F1B2D]">Explore Echat V2 <ArrowRight size={14}/></span>
  </button>;
};
