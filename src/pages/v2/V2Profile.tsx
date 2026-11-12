import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import type { Post } from '../../types';
import { V2PostCard } from '../../components/v2/V2PostCard';

type Tab='posts'|'reels'|'about';
export const V2Profile:React.FC=()=>{
  const {user}=useAuth();const [posts,setPosts]=useState<Post[]>([]);const [tab,setTab]=useState<Tab>('posts');const [error,setError]=useState('');
  useEffect(()=>{void api.getPosts().then(setPosts).catch(e=>setError(e instanceof Error?e.message:'Could not load profile posts.'));},[]);
  const own=useMemo(()=>posts.filter(post=>post.authorId===user?.id),[posts,user?.id]);
  const visible=own.filter(post=>tab==='reels'?(post.type==='reel'||post.isReel):tab==='posts'&&post.type!=='reel'&&post.isReel!==true);
  return <div className="echat-v2-page mx-auto w-full max-w-[940px] space-y-4">
    <section className="echat-v2-card overflow-hidden"><div className="h-44 bg-gradient-to-br from-[#0F1B2D] via-[#27425C] to-[#FFC107] sm:h-72"/><div className="px-4 pb-4 sm:px-7"><div className="-mt-12 flex flex-wrap items-end gap-4 sm:-mt-16"><img src={user?.avatar} alt="" className="h-24 w-24 rounded-full border-4 border-white object-cover sm:h-32 sm:w-32"/><div className="min-w-0 flex-1 pb-2"><h1 className="text-2xl font-extrabold sm:text-3xl">{user?.name||'My Space'}</h1><p className="mt-1 text-sm text-slate-500">{user?.bio||'Make this space yours.'}</p></div></div><nav className="mt-5 flex gap-2 border-t border-slate-100 pt-3">{(['posts','reels','about'] as Tab[]).map(item=><button key={item} onClick={()=>setTab(item)} className={tab===item?'min-h-11 rounded-full bg-[#FFF2C7] px-5 text-sm font-bold capitalize text-[#735000]':'min-h-11 rounded-full px-5 text-sm font-bold capitalize text-slate-600 hover:bg-slate-100'}>{item}</button>)}</nav></div></section>
    {tab==='about'?<section className="echat-v2-card space-y-3 p-5"><h2 className="text-lg font-extrabold">About</h2><p className="text-sm text-slate-700">{user?.bio||'No bio added yet.'}</p>{user?.location&&<p className="text-sm text-slate-600">Lives in {user.location}</p>}</section>:<div className="space-y-4">{error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{visible.map(post=><V2PostCard key={post.id} post={post} onUpdated={updated=>setPosts(current=>current.map(item=>item.id===updated.id?updated:item))}/>)}{!visible.length&&!error&&<div className="echat-v2-card p-8 text-center text-sm text-slate-500">No {tab==='reels'?'Vibes':'posts'} here yet.</div>}</div>}
  </div>;
};
