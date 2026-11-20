import React, { useState } from 'react';
import { Bookmark, Flame, MessageCircle, Send, Share2 } from 'lucide-react';
import type { Post } from '../../types';
import { api } from '../../services/api';
import { assetUrl } from '../../services/apiBase';
import { ImageViewerV2 } from './ImageViewerV2';

interface Props { post:Post; onUpdated?:(post:Post)=>void; }
export const V2PostCard:React.FC<Props> = ({post,onUpdated})=>{
  const [current,setCurrent]=useState(post);const [comment,setComment]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [viewerIndex,setViewerIndex]=useState<number|null>(null);
  const images=(current.mediaUrls?.length?current.mediaUrls:[current.mediaUrl]).filter((url):url is string=>Boolean(url));
  const update= (next:Post)=>{setCurrent(next);onUpdated?.(next);};
  const fire=async()=>{setBusy(true);setError('');try{update(await api.reactToPost(current.id,'love'));}catch(e){setError(e instanceof Error?e.message:'Could not Fire this post.');}finally{setBusy(false);}};
  const sendComment=async(event:React.FormEvent)=>{event.preventDefault();if(!comment.trim())return;setBusy(true);setError('');try{update(await api.commentPost(current.id,comment.trim()));setComment('');}catch(e){setError(e instanceof Error?e.message:'Could not comment.');}finally{setBusy(false);}};
  const spread=async()=>{try{await api.sharePost(current.id);if(navigator.share)await navigator.share({title:'Echat',text:current.content,url:location.href});else await navigator.clipboard.writeText(location.href); }catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError('Could not spread this post.');}};
  const save=async()=>{setBusy(true);setError('');try{await api.toggleSavePost(current.id);}catch(e){setError(e instanceof Error?e.message:'Could not save post.');}finally{setBusy(false);}};
  return <article className="echat-v2-card overflow-hidden p-4 sm:p-5">
    <div className="flex items-center gap-3"><img src={current.author?.avatar} alt="" className="h-11 w-11 rounded-full object-cover"/><div className="min-w-0 flex-1"><p className="truncate font-extrabold">{current.author?.name||'Echat member'} {current.feeling&&<span className="font-medium text-slate-500">· {current.feeling}</span>}</p><p className="text-xs text-slate-500">{new Date(current.createdAt).toLocaleString()}</p></div><span className="rounded-full bg-[#FFF2C7] px-3 py-1 text-xs font-bold text-[#735000]">{current.privacy==='public'?'Public':'Circle'}</span></div>
    {current.content&&<p className="mt-4 whitespace-pre-wrap text-[15px] leading-7">{current.content}</p>}
    {images.length>0&&<div className={`mt-3 grid gap-1 overflow-hidden rounded-2xl ${images.length===1?'grid-cols-1':'grid-cols-2'}`}>{images.slice(0,5).map((url,i)=><button type="button" key={`${url}-${i}`} onClick={()=>setViewerIndex(i)} className={`relative overflow-hidden bg-slate-100 ${images.length===1?'max-h-[520px]':'h-40 sm:h-56'} ${images.length===3&&i===0?'row-span-2 h-[324px] sm:h-[452px]':''}`}><img src={assetUrl(url)} alt={`Post photo ${i+1}`} loading="lazy" className="h-full w-full object-cover"/>{i===4&&images.length>5&&<span className="absolute inset-0 grid place-items-center bg-black/55 text-2xl font-extrabold text-white">+{images.length-5}</span>}</button>)}</div>}
    <div className="mt-3 flex items-center justify-between border-b border-slate-100 pb-3 text-xs text-slate-500"><span>{current.reactions?.length||0} Fires</span><span>{current.comments?.length||0} comments · {current.sharesCount||0} spreads</span></div>
    <div className="grid grid-cols-3 gap-2 py-2"><button disabled={busy} onClick={()=>void fire()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl font-bold text-[#9A6800] hover:bg-amber-50"><Flame size={18}/>Fire</button><button onClick={()=>document.getElementById(`v2-comment-${current.id}`)?.focus()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl font-bold text-slate-600 hover:bg-slate-50"><MessageCircle size={18}/>Comment</button><button onClick={()=>void spread()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl font-bold text-slate-600 hover:bg-slate-50"><Share2 size={18}/>Spread</button></div>
    {current.comments?.slice(-3).map(item=><p key={item.id} className="mt-2 rounded-2xl bg-[#FFF8E7] px-3 py-2 text-sm"><b>{item.author?.name||'Member'}</b> {item.content}</p>)}
    <form onSubmit={sendComment} className="mt-2 flex items-center gap-2"><label className="sr-only" htmlFor={`v2-comment-${current.id}`}>Write a comment</label><input id={`v2-comment-${current.id}`} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Write a comment…" className="h-11 min-w-0 flex-1 rounded-full bg-slate-100 px-4 text-sm outline-none focus:ring-2 focus:ring-amber-400"/><button disabled={busy||!comment.trim()} aria-label="Send comment" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F5B301] text-[#0F1B2D] disabled:opacity-50"><Send size={17}/></button><button type="button" onClick={()=>void save()} aria-label="Save post" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700"><Bookmark size={17}/></button></form>
    {error&&<p role="alert" className="mt-2 text-sm font-semibold text-rose-700">{error}</p>}
    {viewerIndex!==null&&<ImageViewerV2 post={current} initialIndex={viewerIndex} onClose={()=>setViewerIndex(null)}/>}
  </article>;
};
