import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { V2MarketSettings } from './V2MarketSettings';

export const V2Settings:React.FC<{onWatchIntro?:()=>void}>=({onWatchIntro})=>{
  const {user,updateUser}=useAuth();
  const [dark,setDark]=useState(()=>typeof window!=='undefined'&&localStorage.getItem('echat_v2_dark')==='true');
  const [error,setError]=useState('');
  const toggleDark=()=>{const next=!dark;setDark(next);localStorage.setItem('echat_v2_dark',String(next));document.documentElement.classList.toggle('echat-v2-dark',location.pathname.startsWith('/v2/')&&next);};
  const visibility=user?.privacySettings?.postVisibility||'public';
  const changeVisibility=async(value:'public'|'friends'|'only_me')=>{if(!user)return;setError('');try{updateUser(await api.updateProfile(user.id,{privacySettings:{...user.privacySettings,postVisibility:value}}));}catch(e){setError(e instanceof Error?e.message:'Could not update privacy settings.');}};
  const unblock=async(id:string)=>{if(!user)return;setError('');try{updateUser(await api.updateProfile(user.id,{blockedUsers:(user.blockedUsers||[]).filter(item=>item!==id)}));}catch(e){setError(e instanceof Error?e.message:'Could not unblock this account.');}};
  return <div className="echat-v2-page mx-auto max-w-[760px] space-y-4">
    <header className="rounded-[26px] bg-[#0F1B2D] p-6 text-white"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#FFC107]">Settings</p><h1 className="mt-2 text-3xl font-extrabold">Your account</h1><p className="mt-2 text-sm text-slate-300">Account, privacy, appearance, and Market preferences.</p></header>
    <section className="echat-v2-card space-y-4 p-5"><div className="flex items-center gap-3"><img src={user?.avatar} alt="" className="h-14 w-14 rounded-full object-cover"/><div className="min-w-0"><h2 className="font-extrabold">{user?.name}</h2><p className="truncate text-sm text-slate-500">{user?.email}</p><p className="text-xs text-slate-500">{user?.location||'Location not set'}</p></div></div>
      <label className="flex min-h-12 items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold">Dark mode<input type="checkbox" checked={dark} onChange={toggleDark} className="h-5 w-5 accent-amber-500"/></label>
      <label className="block border-t border-slate-100 pt-3 text-sm font-bold">Default post privacy<select value={visibility} onChange={event=>void changeVisibility(event.target.value as 'public'|'friends'|'only_me')} className="mt-2 h-11 w-full rounded-xl bg-slate-50 px-3"><option value="public">Public</option><option value="friends">Your Circle</option><option value="only_me">Only me</option></select></label>
      <div className="border-t border-slate-100 pt-3"><h3 className="text-sm font-extrabold">Blocked accounts</h3>{user?.blockedUsers?.length?<ul className="mt-2 space-y-2">{user.blockedUsers.map(id=><li key={id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm"><span className="truncate">{id}</span><button type="button" onClick={()=>void unblock(id)} className="rounded-full bg-white px-3 py-2 text-xs font-bold">Unblock</button></li>)}</ul>:<p className="mt-1 text-xs text-slate-500">No blocked accounts.</p>}</div>
      {error&&<p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </section>
    <section className="echat-v2-card flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-amber-700">About Echat</p><h2 className="mt-1 text-lg font-extrabold">Meet the new Echat</h2><p className="mt-1 text-sm text-slate-500">Take a 30-second tour of Your Space, Vibes, Chat, and Market.</p></div><button type="button" onClick={onWatchIntro} className="min-h-11 rounded-full bg-[#0F1B2D] px-5 font-bold text-white hover:bg-slate-800">Watch Again</button></section>
    <V2MarketSettings/>
  </div>;
};
