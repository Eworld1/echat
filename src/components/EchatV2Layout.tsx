import React, { useEffect, useState } from 'react';
import { Bookmark, CalendarDays, Bell, Film, Home, Menu, MessageCircle, Plus, Search, Settings, ShoppingBag, Users, UsersRound, X, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { Notification } from '../types';
import './v2-layout.css';
import '../styles/echat-v2.css';
import { BackToClassicBanner } from './BackToClassicBanner';

export type V2Route = '/v2/home' | '/v2/moments' | '/v2/vibes' | '/v2/circle' | '/v2/chat' | '/v2/communities' | '/v2/market' | '/v2/events' | '/v2/saved' | '/v2/market/orders' | '/v2/settings' | '/v2/profile' | (string & {});
const links: { route: V2Route; title: string; icon: React.ReactNode }[] = [
  { route:'/v2/home', title:'Your Space', icon:<Home size={19}/> },
  { route:'/v2/moments', title:'Moments', icon:<span aria-hidden="true" className="text-lg">✨</span> },
  { route:'/v2/vibes', title:'Vibes', icon:<Film size={19}/> },
  { route:'/v2/circle', title:'Your Circle', icon:<Users size={19}/> },
  { route:'/v2/chat', title:'Echat Chat', icon:<MessageCircle size={19}/> },
  { route:'/v2/communities', title:'Communities', icon:<UsersRound size={19}/> },
  { route:'/v2/market', title:'Echat Market', icon:<ShoppingBag size={19}/> },
  { route:'/v2/events', title:'Events', icon:<CalendarDays size={19}/> },
  { route:'/v2/saved', title:'Saved', icon:<Bookmark size={19}/> },
  { route:'/v2/profile', title:'My Space', icon:<span aria-hidden="true" className="text-lg">👤</span> }
];
const topLinks=links.filter(link=>['/v2/home','/v2/vibes','/v2/circle','/v2/communities','/v2/market'].includes(link.route));
const notificationTarget=(item:Notification):V2Route=>item.type==='message'?'/v2/chat':item.type==='friend_request'||item.type==='friend_accept'?'/v2/circle':'/v2/home';
interface Props { route:V2Route; onNavigate:(route:V2Route)=>void; onCreate:()=>void; children:React.ReactNode; }

export const EchatV2Layout:React.FC<Props>=({route,onNavigate,onCreate,children})=>{
  const {user,isDeveloper}=useAuth();
  const canAdmin=Boolean(user&&(user.role==='admin'||user.isAdmin||isDeveloper));
  const [menuOpen,setMenuOpen]=useState(false);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [notifications,setNotifications]=useState<Notification[]>([]);
  const go=(next:V2Route)=>{setMenuOpen(false);setNotificationsOpen(false);onNavigate(next);};
  useEffect(()=>{if(!user)return;let alive=true;const load=()=>void api.getNotifications().then(items=>{if(alive)setNotifications(items);}).catch(()=>{});load();const timer=window.setInterval(load,30000);return()=>{alive=false;window.clearInterval(timer);};},[user?.id]);
  const openNotifications=async()=>{const opening=!notificationsOpen;setNotificationsOpen(opening);if(opening){try{await api.markNotificationsRead();setNotifications(current=>current.map(item=>({...item,read:true})));}catch{/* Keep notification links usable if sync is unavailable. */}}};
  const unread=notifications.some(item=>!item.read);
  return <div className="echat-v2 min-h-dvh pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0">
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0F1B2D] px-3 py-2 text-white shadow-sm sm:px-5">
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-2 sm:gap-3">
        <button type="button" onClick={()=>go('/v2/home')} className="flex shrink-0 items-center gap-2 rounded-xl text-left" aria-label="Your Space"><span className="grid h-10 w-10 place-items-center rounded-full border-2 border-[#FFC107] text-lg font-black text-[#FFC107]">E</span><span className="hidden text-lg font-extrabold sm:inline">Echat</span></button>
        <button type="button" onClick={()=>{go('/v2/circle');window.dispatchEvent(new Event('echat:v2-search'));}} className="hidden h-10 w-40 shrink items-center gap-2 rounded-full bg-white/10 px-4 text-left text-sm text-slate-300 hover:bg-white/15 md:flex lg:w-48"><Search size={17}/><span>Search Echat</span></button>
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 xl:flex">{topLinks.map(link=><button key={link.route} onClick={()=>go(link.route)} className={route===link.route?'flex min-h-10 items-center gap-2 rounded-full bg-[#FFC107] px-3 text-sm font-bold text-[#0F1B2D]':'flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-bold text-slate-200 hover:bg-white/10'}>{link.icon}<span>{link.title}</span></button>)}</nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={()=>{go('/v2/circle');window.dispatchEvent(new Event('echat:v2-search'));}} aria-label="Search people" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/15 md:hidden"><Search size={19}/></button>
          <button type="button" onClick={()=>go('/v2/chat')} aria-label="Messages" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/15"><MessageCircle size={19}/></button>
          <button type="button" onClick={()=>void openNotifications()} aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/15"><Bell size={19}/>{unread&&<span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0F1B2D] bg-[#FFC107]"/>}</button>
          <button type="button" onClick={()=>go('/v2/profile')} aria-label="My Space" className="rounded-full p-0.5 ring-2 ring-[#FFC107]/70"><img src={user?.avatar} alt="" className="h-9 w-9 rounded-full object-cover"/></button>
          <button type="button" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Open menu" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 lg:hidden">{menuOpen?<X size={19}/>:<Menu size={19}/>}</button>
        </div>
      </div>
    </header>
    {notificationsOpen&&<div className="fixed right-3 top-16 z-[70] max-h-[75dvh] w-[min(380px,calc(100vw-24px))] overflow-y-auto rounded-2xl bg-white p-3 text-slate-900 shadow-2xl"><div className="flex items-center justify-between px-2 py-1"><h2 className="font-extrabold">Notifications</h2><button onClick={()=>setNotificationsOpen(false)} aria-label="Close notifications" className="rounded-full p-2 hover:bg-slate-100"><X size={17}/></button></div>{notifications.slice(0,12).map(item=><button key={item.id} onClick={()=>go(notificationTarget(item))} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-amber-50"><span className={item.read?'h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200':'h-2.5 w-2.5 shrink-0 rounded-full bg-[#FFC107]'}/><span className="min-w-0 flex-1 text-sm"><b className="block truncate">{item.actor?.name||'Echat'}</b><span className="line-clamp-2 text-xs text-slate-600">{item.message}</span></span></button>)}{!notifications.length&&<p className="p-5 text-center text-sm text-slate-500">You’re all caught up.</p>}</div>}
    {menuOpen&&<div className="fixed inset-0 z-50 bg-black/30 lg:hidden" onClick={()=>setMenuOpen(false)}><div className="absolute right-3 top-16 max-h-[82dvh] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-3xl bg-white p-3 text-slate-900 shadow-2xl" onClick={event=>event.stopPropagation()}>{links.map(link=><button key={link.route} onClick={()=>go(link.route)} className={route===link.route?'flex min-h-12 w-full items-center gap-3 rounded-2xl bg-[#FFF2C7] px-3 text-left font-bold text-[#735000]':'flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-bold hover:bg-amber-50'}>{link.icon}{link.title}</button>)}<button onClick={()=>go('/v2/market/orders')} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-bold hover:bg-amber-50"><ShoppingBag size={19}/>Market orders</button><button onClick={()=>go('/v2/settings')} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-bold hover:bg-amber-50"><Settings size={19}/>Settings</button><button onClick={()=>{setMenuOpen(false);history.pushState({echatApp:true},'','/live');window.dispatchEvent(new Event('echat:navigate'));}} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-bold text-rose-700 hover:bg-rose-50"><span>🔴</span>Go Live</button>{canAdmin&&<button onClick={()=>{setMenuOpen(false);history.pushState({echatApp:true},'','/admin');window.dispatchEvent(new Event('echat:navigate'));}} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-bold text-violet-700 hover:bg-violet-50"><Shield size={19}/>Admin Dashboard</button>}</div></div>}
    <BackToClassicBanner/>
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-3 py-5 md:px-5 lg:grid-cols-[82px_minmax(0,1fr)]">
      <aside className="hidden lg:block"><div className="echat-v2-card sticky top-20 flex flex-col items-center gap-1 p-2">{links.map(link=><button key={link.route} title={link.title} onClick={()=>go(link.route)} className={route===link.route?'flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl bg-[#FFF2C7] px-1 text-center text-[10px] font-bold text-[#735000]':'flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-slate-600 hover:bg-slate-50'}>{link.icon}<span className="leading-tight">{link.title}</span></button>)}<button title="Market orders" onClick={()=>go('/v2/market/orders')} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-slate-600 hover:bg-slate-50"><ShoppingBag size={19}/><span>Orders</span></button><button title="Settings" onClick={()=>go('/v2/settings')} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-slate-600 hover:bg-slate-50"><Settings size={19}/><span>Settings</span></button><button title="Go Live" onClick={()=>{history.pushState({echatApp:true},'','/live');window.dispatchEvent(new Event('echat:navigate'));}} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-rose-700 hover:bg-rose-50"><span>🔴</span><span>Go Live</span></button>{canAdmin&&<button title="Admin Dashboard" onClick={()=>{history.pushState({echatApp:true},'','/admin');window.dispatchEvent(new Event('echat:navigate'));}} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-violet-700 hover:bg-violet-50"><Shield size={19}/><span>Admin</span></button>}</div></aside>
      <main className="min-w-0">{children}</main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(66px+env(safe-area-inset-bottom))] items-start justify-around border-t border-slate-200 bg-white/95 px-1 pt-1 backdrop-blur lg:hidden">{[{route:'/v2/home' as V2Route,label:'Home',icon:<Home size={21}/>},{route:'/v2/vibes' as V2Route,label:'Vibes',icon:<Film size={21}/>},{route:'/v2/home' as V2Route,label:'Create',icon:<Plus size={22}/>,create:true},{route:'/v2/circle' as V2Route,label:'Circle',icon:<Users size={21}/>},{route:'/v2/market' as V2Route,label:'Menu',icon:<Menu size={21}/>,menu:true}].map(item=><button key={item.label} onClick={()=>item.create?onCreate():item.menu?setMenuOpen(true):go(item.route)} className={route===item.route?'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold text-[#8C6200]':'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold text-slate-500'}>{item.create?<span className="-mt-3 grid h-12 w-12 place-items-center rounded-full border-4 border-white bg-[#F5B301] text-[#0F1B2D] shadow-lg"><Plus size={22}/></span>:item.icon}<span>{item.label}</span></button>)}</nav>
  </div>;
};
