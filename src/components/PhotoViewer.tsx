import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Bookmark, Copy, Download, ExternalLink, MoreHorizontal, Send, Share2, ThumbsUp, X } from 'lucide-react';
import type { Post } from '../types';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { assetUrl } from '../services/apiBase';
import { initialsAvatar } from '../utils/avatar';
import { saveImageToDevice, shareImageFile } from '../utils/saveImage';
import { useBackButton } from '../hooks/useBackButton';

interface Props { post: Post; images: string[]; initialIndex: number; onClose: () => void; onPostUpdated: (post: Post) => void; }
const photoPath=(postId:string,index:number)=>`/photo/${encodeURIComponent(postId)}/${index}`;
const distance=(a:React.Touch,b:React.Touch)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);

export const PhotoViewer:React.FC<Props>=({post,images,initialIndex,onClose,onPostUpdated})=>{
  const {user,updateUser}=useAuth();
  const [index,setIndex]=useState(Math.max(0,Math.min(initialIndex,images.length-1)));
  const [zoom,setZoom]=useState(1);
  const [menuOpen,setMenuOpen]=useState(false);
  const [comment,setComment]=useState('');
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState('');
  const [error,setError]=useState('');
  const touchStart=useRef<{x:number;y:number}|null>(null);
  const pinchStart=useRef<{distance:number;zoom:number}|null>(null);
  const isSaved=Boolean(user?.savedPosts?.includes(post.id));
  const currentUrl=assetUrl(images[index]||'');

  useBackButton(true,onClose,`photo-viewer-${post.id}`);
  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previousOverflow;};
  },[]);
  useEffect(()=>{
    if(window.location.pathname.startsWith('/photo/')) return;
    window.history.pushState({...window.history.state,echatPhotoViewer:true},'',photoPath(post.id,index));
  },[]);
  useEffect(()=>{
    if(window.location.pathname.startsWith('/photo/')) window.history.replaceState({...window.history.state,echatPhotoViewer:window.history.state?.echatPhotoViewer===true},'',photoPath(post.id,index));
  },[post.id,index]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')close();if(event.key==='ArrowLeft')move(-1);if(event.key==='ArrowRight')move(1);};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  });
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(''),2300);return()=>window.clearTimeout(timer);},[toast]);

  function close(){
    if(window.history.state?.echatPhotoViewer){window.history.back();return;}
    if(window.location.pathname.startsWith('/photo/')) window.history.replaceState({...window.history.state,echatPhotoViewer:false},'','/home');
    onClose();
  }
  function move(step:number){setIndex(value=>Math.max(0,Math.min(images.length-1,value+step)));setZoom(1);setMenuOpen(false);}
  async function saveImage(){
    setBusy(true);setError('');
    try{await saveImageToDevice(currentUrl,`echat-${post.id}-${index+1}.jpg`);setToast('Image saved to your device');}
    catch(e){setError(e instanceof Error?e.message:'Image download failed. Open the image and save it from your browser.');}
    finally{setBusy(false);setMenuOpen(false);}
  }
  async function shareImage(){
    setBusy(true);setError('');
    try{await shareImageFile(currentUrl,`echat-${post.id}-${index+1}.jpg`);setToast('Image shared');}
    catch(e){try{await navigator.clipboard.writeText(currentUrl);setToast('Image link copied');}catch{setError(e instanceof Error?e.message:'Could not share this image.');}}
    finally{setBusy(false);setMenuOpen(false);}
  }
  async function copyImageLink(){try{await navigator.clipboard.writeText(currentUrl);setToast('Image link copied');}catch{setError('Could not copy the image link.');}setMenuOpen(false);}
  async function savePost(){if(!user)return;setBusy(true);setError('');try{const result=await api.toggleSavePost(post.id);updateUser({...user,savedPosts:result.savedPosts});setToast(result.savedPosts.includes(post.id)?'Post saved':'Post removed from Saved Posts');}catch(e){setError(e instanceof Error?e.message:'Could not update Saved Posts.');}finally{setBusy(false);}}
  async function react(){try{onPostUpdated(await api.reactToPost(post.id,'like'));}catch(e){setError(e instanceof Error?e.message:'Could not like this post.');}}
  async function addComment(event:React.FormEvent){event.preventDefault();if(!comment.trim())return;setBusy(true);try{onPostUpdated(await api.commentPost(post.id,comment.trim()));setComment('');}catch(e){setError(e instanceof Error?e.message:'Could not send comment.');}finally{setBusy(false);}}
  async function sharePost(){try{const url=`${location.origin}/?post=${encodeURIComponent(post.id)}`;if(navigator.share)await navigator.share({title:post.author?.name||'Echat photo',text:post.content,url});else{await navigator.clipboard.writeText(url);setToast('Post link copied');}}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError('Could not share this post.');}}

  return createPortal(<div className="fixed inset-0 z-[120] flex h-[100dvh] w-full flex-col bg-black text-white md:flex-row" role="dialog" aria-modal="true" aria-label="Photo viewer">
    <section className="relative flex h-[58dvh] min-h-0 shrink-0 items-center justify-center overflow-hidden bg-black md:h-full md:w-[70%]" onClick={event=>{if(event.target===event.currentTarget)close();}} onTouchStart={event=>{const touches=event.touches;if(touches.length===2)pinchStart.current={distance:distance(touches[0],touches[1]),zoom};else if(touches[0])touchStart.current={x:touches[0].clientX,y:touches[0].clientY};}} onTouchMove={event=>{if(event.touches.length===2){event.preventDefault();const start=pinchStart.current;if(start) setZoom(Math.min(3,Math.max(1,start.zoom*distance(event.touches[0],event.touches[1])/start.distance)));}}} onTouchEnd={event=>{const start=touchStart.current;const touch=event.changedTouches[0];touchStart.current=null;pinchStart.current=null;if(!start||!touch)return;const dx=touch.clientX-start.x,dy=touch.clientY-start.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy))move(dx<0?1:-1);else if(dy>90&&Math.abs(dy)>Math.abs(dx))close();}}>
      <div className="absolute left-3 top-3 z-20 rounded-full bg-black/60 px-3 py-1.5 text-sm font-semibold">{index+1} / {images.length}</div>
      <div className="absolute right-3 top-3 z-20 flex gap-2"><button onClick={()=>setMenuOpen(value=>!value)} aria-label="Image options" className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25"><MoreHorizontal size={20}/></button><button onClick={close} aria-label="Close photo viewer" className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25"><X size={21}/></button></div>
      {index>0&&<button onClick={()=>move(-1)} aria-label="Previous image" className="absolute left-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25"><ArrowLeft/></button>}
      <img src={currentUrl} alt={`Photo ${index+1} of ${images.length}`} draggable={false} onClick={()=>setZoom(value=>value===1?2:1)} onDoubleClick={event=>{event.preventDefault();setZoom(value=>value===1?2:1);}} style={{transform:`scale(${zoom})`,touchAction:'pan-y pinch-zoom'}} className="max-h-full max-w-full select-none object-contain transition-transform duration-150"/>
      {index<images.length-1&&<button onClick={()=>move(1)} aria-label="Next image" className="absolute right-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25"><ArrowRight/></button>}
      {menuOpen&&<div className="absolute right-3 top-16 z-30 w-56 overflow-hidden rounded-2xl bg-white p-1.5 text-sm font-semibold text-slate-800 shadow-2xl"><button disabled={busy} onClick={()=>void saveImage()} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 hover:bg-slate-100"><Download size={17}/>Save Image</button><button onClick={()=>void copyImageLink()} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 hover:bg-slate-100"><Copy size={17}/>Copy Image Link</button><button disabled={busy} onClick={()=>void shareImage()} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 hover:bg-slate-100"><Share2 size={17}/>Share Image</button><a href={currentUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-3 rounded-xl px-3 hover:bg-slate-100"><ExternalLink size={17}/>View Full Size</a></div>}
      {images.length>1&&<div className="absolute bottom-3 left-1/2 hidden max-w-[70%] -translate-x-1/2 gap-1.5 overflow-x-auto rounded-xl bg-black/45 p-1.5 md:flex">{images.map((image,i)=><button key={`${image}-${i}`} onClick={()=>{setIndex(i);setZoom(1);}} aria-label={`View image ${i+1}`} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${i===index?'border-white':'border-transparent'}`}><img src={assetUrl(image)} alt="" className="h-full w-full object-cover"/></button>)}</div>}
    </section>
    <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white text-slate-900 md:h-full md:w-[30%] md:flex-none">
      <header className="flex items-center gap-3 border-b border-slate-200 p-4"><img src={post.author?.avatar||initialsAvatar(post.author?.name||'Echat User')} alt="" className="h-11 w-11 rounded-full object-cover"/><div className="min-w-0 flex-1"><b className="block truncate text-sm">{post.author?.name||'Echat member'}</b><time className="text-xs text-slate-500">{new Date(post.createdAt).toLocaleString()}</time></div><button disabled={busy} onClick={()=>void savePost()} aria-label={isSaved?'Remove saved post':'Save post'} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100"><Bookmark size={18} fill={isSaved?'currentColor':'none'}/></button></header>
      {post.content&&<p className="whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6">{post.content}</p>}
      {error&&<p role="alert" className="mx-4 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      {toast&&<p role="status" className="mx-4 rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-800">{toast}</p>}
      <div className="sticky top-0 flex items-center gap-2 border-y border-slate-200 bg-white px-3 py-2"><button onClick={()=>void react()} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg font-semibold text-slate-700 hover:bg-slate-100"><ThumbsUp size={17}/>Like</button><button onClick={()=>document.getElementById('photo-comment-input')?.focus()} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg font-semibold text-slate-700 hover:bg-slate-100"><Send size={17}/>Comment</button><button onClick={()=>void sharePost()} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg font-semibold text-slate-700 hover:bg-slate-100"><Share2 size={17}/>Share</button></div>
      <div className="space-y-3 p-4">{(post.comments||[]).map(item=><div key={item.id} className="flex gap-2"><img src={item.author?.avatar||initialsAvatar(item.author?.name||'Echat User')} alt="" className="h-8 w-8 rounded-full object-cover"/><p className="min-w-0 rounded-2xl bg-slate-100 px-3 py-2 text-sm"><b className="mr-1">{item.author?.name||'Echat member'}</b>{item.content}</p></div>)}</div>
      <form onSubmit={event=>void addComment(event)} className="sticky bottom-0 mt-auto flex gap-2 border-t border-slate-200 bg-white p-3"><input id="photo-comment-input" value={comment} onChange={event=>setComment(event.target.value)} placeholder="Write a comment…" className="h-11 min-w-0 flex-1 rounded-full bg-slate-100 px-4 text-base outline-none focus:ring-2 focus:ring-blue-300"/><button disabled={busy||!comment.trim()} aria-label="Send comment" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-600 text-white disabled:opacity-50"><Send size={17}/></button></form>
    </aside>
  </div>,document.body);
};
