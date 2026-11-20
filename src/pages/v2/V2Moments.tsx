import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import type { Story } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { MomentsRow } from '../../components/v2/MomentsRow';
import { MomentViewer } from '../../components/v2/MomentViewer';

export const V2Moments:React.FC=()=>{
  const {user}=useAuth();const [stories,setStories]=useState<Story[]>([]);const [selected,setSelected]=useState<Story|null>(null);const [text,setText]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const load=async()=>{try{setStories((await api.getStories()).filter(story=>story.expiresAt>Date.now()));}catch(e){setError(e instanceof Error?e.message:'Could not load Moments.');}};
  useEffect(()=>{void load();},[]);
  const create=async()=>{if(!text.trim())return;setBusy(true);setError('');try{await api.createStory({type:'text',text:text.trim()});setText('');await load();}catch(e){setError(e instanceof Error?e.message:'Could not share Moment.');}finally{setBusy(false);}};
  return <div className="echat-v2-page mx-auto max-w-[760px] space-y-4"><header className="rounded-[28px] bg-[#0F1B2D] p-6 text-white"><p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#FFC107]">Moments</p><h1 className="mt-2 text-3xl font-extrabold">A day in your circle.</h1><p className="mt-2 text-sm text-slate-300">Quick updates that disappear after 24 hours.</p></header><MomentsRow stories={stories} ownId={user?.id} onOpen={setSelected} onCreate={()=>document.getElementById('v2-moment-composer')?.focus()}/><section className="echat-v2-card p-4"><label htmlFor="v2-moment-composer" className="font-extrabold">Share a Moment</label><textarea id="v2-moment-composer" value={text} onChange={event=>setText(event.target.value)} maxLength={500} placeholder="What are you up to?" className="mt-3 min-h-24 w-full rounded-2xl bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-amber-300"/><div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-500">Text moments expire in 24 hours.</span><button disabled={busy||!text.trim()} onClick={()=>void create()} className="flex min-h-11 items-center gap-2 rounded-full bg-[#F5B301] px-5 font-extrabold disabled:opacity-50">{busy&&<Loader2 size={16} className="animate-spin"/>}Share Moment</button></div>{error&&<p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}</section>{selected&&<MomentViewer story={selected} onClose={()=>setSelected(null)}/>}</div>;
};
