import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useEchatTheme } from '../hooks/useEchatTheme';

export const BackToClassicBanner:React.FC=()=>{
  const {setTheme}=useEchatTheme();
  return <div className="mx-auto w-full max-w-7xl px-3 pt-3 sm:px-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/30 bg-[#17263d] px-4 py-3 text-white"><span className="text-sm font-semibold">You are in New Echat</span><button type="button" onClick={()=>{setTheme('classic');window.history.pushState({echatClassic:true},'','/home');window.dispatchEvent(new Event('echat:navigate'));}} className="flex min-h-10 items-center gap-2 rounded-full bg-[#FFC107] px-4 text-sm font-extrabold text-[#0F1B2D]"><ArrowLeft size={16}/>Back to Classic</button></div></div>;
};
