import React, { useEffect, useState } from 'react';
import { Bookmark, CalendarDays, Bell, Film, Home, Menu, MessageCircle, Plus, Search, Settings, ShoppingBag, Users, UsersRound, X, Shield, Compass, Bot, Megaphone, Smile, Newspaper, Gamepad2, Clock3, Baby, Rss, LayoutDashboard, UserRound, ContactRound, Radio, LockKeyhole, LayoutGrid } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { Notification } from '../types';
import './v2-layout.css';
import '../styles/echat-v2.css';
import { BackToClassicBanner } from './BackToClassicBanner';
import { EchatAppSwitcherTile } from './EchatAppSwitcherTile';

export type V2Route = '/v2/home' | '/v2/moments' | '/v2/vibes' | '/v2/circle' | '/v2/chat' | '/v2/communities' | '/v2/market' | '/v2/events' | '/v2/saved' | '/v2/market/orders' | '/v2/settings' | '/v2/profile' | (string & {});
const classicLinks: { route: V2Route; title: string; icon: React.ReactNode; classic?:string }[] = [
  { route:'/v2/home', title:'News Feed', icon:<Home size={19}/>, classic:'/home' },
  { route:'/v2/vibes', title:'Reels', icon:<Film size={19}/>, classic:'/reels' },
  { route:'/v2/profile', title:'Dashboard', icon:<LayoutDashboard size={19}/>, classic:'/dashboard' },
  { route:'/v2/circle', title:'Friends & Requests', icon:<ContactRound size={19}/>, classic:'/friends' },
  { route:'/v2/pages', title:'Pages', icon:<UsersRound size={19}/>, classic:'/pages' },
  { route:'/v2/groups', title:'Groups', icon:<UsersRound size={19}/>, classic:'/groups' },
  { route:'/v2/events', title:'Events', icon:<CalendarDays size={19}/>, classic:'/events' },
  { route:'/v2/settings', title:'Settings & Privacy', icon:<LockKeyhole size={19}/>, classic:'/settings' },
];
const links: { route: V2Route; title: string; icon: React.ReactNode; classic?:string }[] = [
  ...classicLinks,
  { route:'/v2/finds', title:'Finds', icon:<Compass size={19}/> },
  { route:'/v2/ai', title:'eChat AI', icon:<Bot size={19}/> },
  { route:'/v2/saved', title:'Saved', icon:<Bookmark size={19}/> },
  { route:'/v2/ads', title:'Ad Center', icon:<Megaphone size={19}/> },
  { route:'/v2/avatar', title:'Avatars', icon:<Smile size={19}/> },
  { route:'/v2/feeds', title:'Feeds', icon:<Newspaper size={19}/> },
  { route:'/v2/games', title:'Games', icon:<Gamepad2 size={19}/> },
  { route:'/v2/market', title:'Marketplace', icon:<ShoppingBag size={19}/> },
  { route:'/v2/memories', title:'Memories', icon:<Clock3 size={19}/> },
  { route:'/v2/kids', title:'Messenger Kids', icon:<Baby size={19}/> },
  { route:'/v2/communities', title:'Communities', icon:<UsersRound size={19}/> },
  { route:'/v2/market', title:'Echat Market', icon:<ShoppingBag size={19}/> },
  { route:'/v2/profile', title:'My Space', icon:<UserRound size={19}/> }
];
const v2MenuLinks: {route:V2Route;title:string;icon:React.ReactNode}[]=[
  {route:'/v2/finds',title:'Finds',icon:<Compass size={19}/>},
  {route:'/v2/ai',title:'eChat AI',icon:<Bot size={19}/>},
  {route:'/v2/saved',title:'Saved',icon:<Bookmark size={19}/>},
  {route:'/v2/ads',title:'Ad Center',icon:<Megaphone size={19}/>},
  {route:'/v2/avatar',title:'Avatars',icon:<Smile size={19}/>},
  {route:'/v2/events',title:'Events',icon:<CalendarDays size={19}/>},
  {route:'/v2/feeds',title:'Feeds',icon:<Newspaper size={19}/>},
  {route:'/v2/games',title:'Games',icon:<Gamepad2 size={19}/>},
  {route:'/v2/groups',title:'Groups',icon:<UsersRound size={19}/>},
  {route:'/v2/market',title:'Marketplace',icon:<ShoppingBag size={19}/>},
  {route:'/v2/memories',title:'Memories',icon:<Clock3 size={19}/>},
  {route:'/v2/kids',title:'Messenger Kids',icon:<Baby size={19}/>},
  {route:'/v2/pages',title:'Pages',icon:<UsersRound size={19}/>},
];
const topLinks=links.filter(link=>['News Feed','Reels','Friends & Requests','Marketplace'].includes(link.title));
const notificationTarget=(item:Notification):V2Route=>item.type==='message'?'/v2/chat':item.type==='friend_request'||item.type==='friend_accept'?'/v2/circle':'/v2/home';
interface Props { route:V2Route; onNavigate:(route:V2Route)=>void; onCreate:()=>void; children:React.ReactNode; }

export const EchatV2Layout:React.FC<Props>=({route,onNavigate,onCreate,children})=>{
  const {user,isDeveloper}=useAuth();
  const canAdmin=Boolean(user&&(user.role==='admin'||user.role==='super_admin'||user.isAdmin||isDeveloper));
  const [menuOpen,setMenuOpen]=useState(false);
  const [appsOpen,setAppsOpen]=useState(false);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [notifications,setNotifications]=useState<Notification[]>([]);
  const go=(next:V2Route)=>{setMenuOpen(false);setAppsOpen(false);setNotificationsOpen(false);onNavigate(next);};
  const goClassic=(path:string)=>{setMenuOpen(false);setAppsOpen(false);setNotificationsOpen(false);window.history.pushState({echatApp:true},'',path);window.dispatchEvent(new Event('echat:navigate'));};
  useEffect(()=>{if(!user)return;let alive=true;const load=()=>void api.getNotifications().then(items=>{if(alive)setNotifications(items);}).catch(()=>{});load();const timer=window.setInterval(load,30000);return()=>{alive=false;window.clearInterval(timer);};},[user?.id]);
  const openNotifications=async()=>{const opening=!notificationsOpen;setNotificationsOpen(opening);if(opening){try{await api.markNotificationsRead();setNotifications(current=>current.map(item=>({...item,read:true})));}catch{/* Keep notification links usable if sync is unavailable. */}}};
  const unread=notifications.some(item=>!item.read);
  return <div className="echat-v2 min-h-dvh pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0">
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white px-3 py-2 text-slate-900 sm:px-5">
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-2 sm:gap-3">
        <button type="button" onClick={()=>go('/v2/home')} className="flex shrink-0 items-center rounded-xl text-left" aria-label="Your Space"><img src="/logo-mark-blue.svg" alt="" className="h-10 w-10 object-contain md:hidden"/><img src="/logo-blue.svg" alt="Echat" className="hidden h-10 w-[164px] object-contain object-left md:block"/></button>
        <button type="button" onClick={()=>{go('/v2/circle');window.dispatchEvent(new Event('echat:v2-search'));}} className="hidden h-10 w-40 shrink items-center gap-2 rounded-full bg-slate-100 px-4 text-left text-sm text-slate-700 hover:bg-slate-200 md:flex lg:w-48"><Search size={17}/><span>Search Echat</span></button>
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 xl:flex">{topLinks.map(link=><button key={link.route} onClick={()=>go(link.route)} className={route===link.route?'flex min-h-10 items-center gap-2 rounded-lg border-b-[3px] border-[#0A2A6B] px-3 text-sm font-bold text-[#0A2A6B]':'flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100'}>{link.icon}<span>{link.title}</span></button>)}</nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={()=>{go('/v2/circle');window.dispatchEvent(new Event('echat:v2-search'));}} aria-label="Search people" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 hover:bg-slate-200 md:hidden"><Search size={19}/></button>
          <button type="button" onClick={()=>go('/v2/chat')} aria-label="Messages" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 hover:bg-slate-200"><MessageCircle size={19}/></button>
          <button type="button" onClick={()=>void openNotifications()} aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-full bg-slate-100 hover:bg-slate-200"><Bell size={19}/>{unread&&<span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#1877F2]"/>}</button>
          <div className="relative">
            <button type="button" onClick={()=>setAppsOpen(value=>!value)} aria-label="Open Echat apps menu" aria-expanded={appsOpen} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 hover:bg-slate-200"><LayoutGrid size={19}/></button>
            {appsOpen&&<>
              <button type="button" aria-label="Close apps menu" onClick={()=>setAppsOpen(false)} className="fixed inset-0 z-[45] cursor-default"/>
              <div role="menu" aria-label="Echat apps" className="absolute right-0 top-12 z-[46] w-[min(340px,calc(100vw-24px))] rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 shadow-2xl">
                <h2 className="mb-2 px-1 text-sm font-bold">Echat apps</h2>
                <EchatAppSwitcherTile variant="v2" onNavigate={()=>setAppsOpen(false)}/>
              </div>
            </>}
          </div>
          <button type="button" onClick={()=>go('/v2/profile')} aria-label="My Space" className="rounded-full p-0.5 ring-2 ring-[#0A2A6B]"><img src={user?.avatar} alt="" className="h-9 w-9 rounded-full object-cover"/></button>
          <button type="button" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Open menu" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 hover:bg-slate-200 lg:hidden">{menuOpen?<X size={19}/>:<Menu size={19}/>}</button>
        </div>
      </div>
    </header>
    {notificationsOpen&&<div className="fixed right-3 top-16 z-[70] max-h-[75dvh] w-[min(380px,calc(100vw-24px))] overflow-y-auto rounded-2xl bg-white p-3 text-slate-900 shadow-2xl"><div className="flex items-center justify-between px-2 py-1"><h2 className="font-extrabold">Notifications</h2><button onClick={()=>setNotificationsOpen(false)} aria-label="Close notifications" className="rounded-full p-2 hover:bg-slate-100"><X size={17}/></button></div>{notifications.slice(0,12).map(item=><button key={item.id} onClick={()=>go(notificationTarget(item))} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-amber-50"><span className={item.read?'h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200':'h-2.5 w-2.5 shrink-0 rounded-full bg-[#FFC107]'}/><span className="min-w-0 flex-1 text-sm"><b className="block truncate">{item.actor?.name||'Echat'}</b><span className="line-clamp-2 text-xs text-slate-600">{item.message}</span></span></button>)}{!notifications.length&&<p className="p-5 text-center text-sm text-slate-500">You’re all caught up.</p>}</div>}
    {menuOpen&&<div className="fixed inset-0 z-[80] bg-black/35" onClick={()=>setMenuOpen(false)}><aside aria-label="Echat menu" className="absolute bottom-0 left-0 top-0 flex w-[85%] max-w-[360px] flex-col overflow-hidden border-r border-slate-200 bg-white text-slate-900 shadow-xl animate-in slide-in-from-left duration-200" onClick={event=>event.stopPropagation()}><header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3"><span className="text-lg font-extrabold">Menu</span><button onClick={()=>setMenuOpen(false)} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100"><X size={19}/></button></header><div className="min-h-0 flex-1 overflow-y-auto p-3"><button type="button" onClick={()=>go('/v2/profile')} className="mb-4 flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left"><img src={user?.avatar||'/logo-mark-blue.svg'} alt="" className="h-12 w-12 rounded-full object-cover"/><span className="min-w-0"><b className="block truncate text-base">{user?.name||'Echat member'}</b><span className="block text-sm text-slate-500">See your profile</span></span></button><div className="mb-3"><EchatAppSwitcherTile variant="v2" onNavigate={()=>setMenuOpen(false)}/></div><div className="mb-2 px-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Classic Echat</div>{classicLinks.map(link=><button key={`${link.classic}-${link.title}`} onClick={()=>goClassic(link.classic!)} className="flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-3 text-left text-sm font-semibold hover:bg-slate-50">{link.icon}<span>{link.title}</span></button>)}{isDeveloper&&<button onClick={()=>goClassic('/admin')} className="flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-3 text-left text-sm font-semibold hover:bg-slate-50"><Shield size={19}/>Developer Mode</button>}{canAdmin&&<button onClick={()=>goClassic('/admin')} className="flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-3 text-left text-sm font-semibold text-[#0A2A6B] hover:bg-slate-50"><Shield size={19}/>ADMIN</button>}<div className="my-3 border-t border-slate-200"/><div className="mb-2 px-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Discover Echat</div>{v2MenuLinks.map(link=><button key={`${link.route}-${link.title}`} onClick={()=>go(link.route)} className={route===link.route?'flex min-h-12 w-full items-center gap-3 border-b border-slate-100 bg-[#E9EFF8] px-3 text-left text-sm font-bold text-[#0A2A6B]':'flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-3 text-left text-sm font-semibold hover:bg-slate-50'}>{link.icon}<span>{link.title}</span></button>)}{[{route:'/v2/moments' as V2Route,title:'Moments',icon:<Clock3 size={19}/>},{route:'/v2/vibes' as V2Route,title:'Vibes',icon:<Film size={19}/>},{route:'/v2/circle' as V2Route,title:'Your Circle',icon:<Users size={19}/>},{route:'/v2/chat' as V2Route,title:'Echat Chat',icon:<MessageCircle size={19}/>},{route:'/v2/communities' as V2Route,title:'Communities',icon:<UsersRound size={19}/>},{route:'/v2/market/orders' as V2Route,title:'Market orders',icon:<ShoppingBag size={19}/>},{route:'/v2/settings' as V2Route,title:'Settings',icon:<Settings size={19}/>}].map(link=><button key={`${link.route}-${link.title}`} onClick={()=>go(link.route)} className="flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-3 text-left text-sm font-semibold hover:bg-slate-50">{link.icon}<span>{link.title}</span></button>)}<button onClick={()=>goClassic('/live')} className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"><Radio size={19}/>Go Live</button>{canAdmin&&<button onClick={()=>goClassic('/admin')} className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm font-semibold text-[#0A2A6B] hover:bg-slate-50"><Shield size={19}/>Admin Dashboard</button>}</div></aside></div>}
    <BackToClassicBanner/>
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-3 py-5 md:px-5 lg:grid-cols-[82px_minmax(0,1fr)]">
      <aside className="hidden lg:block"><div className="echat-v2-card sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col items-center gap-1 overflow-y-auto p-2">{links.map((link,index)=><button key={`${link.route}-${link.title}-${index}`} title={link.title} onClick={()=>go(link.route)} className={route===link.route?'flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl bg-[#E8EEF7] px-1 text-center text-[10px] font-bold text-[#0A2A6B]':'flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-slate-600 hover:bg-slate-50'}>{link.icon}<span className="leading-tight">{link.title}</span></button>)}<button title="Market orders" onClick={()=>go('/v2/market/orders')} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-slate-600 hover:bg-slate-50"><ShoppingBag size={19}/><span>Orders</span></button><button title="Settings" onClick={()=>go('/v2/settings')} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-slate-600 hover:bg-slate-50"><Settings size={19}/><span>Settings</span></button><button title="Go Live" onClick={()=>{history.pushState({echatApp:true},'','/live');window.dispatchEvent(new Event('echat:navigate'));}} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-rose-700 hover:bg-rose-50"><Radio size={19}/><span>Go Live</span></button>{canAdmin&&<button title="Admin Dashboard" onClick={()=>{history.pushState({echatApp:true},'','/admin');window.dispatchEvent(new Event('echat:navigate'));}} className="flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold text-[#0A2A6B] hover:bg-slate-100"><Shield size={19}/><span>Admin</span></button>}</div></aside>
      <main className="min-w-0">{children}</main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(66px+env(safe-area-inset-bottom))] items-start justify-around border-t border-slate-200 bg-white px-1 pt-1 lg:hidden">{[{route:'/v2/home' as V2Route,label:'Home',icon:<Home size={21}/>},{route:'/v2/vibes' as V2Route,label:'Vibes',icon:<Film size={21}/>},{route:'/v2/home' as V2Route,label:'Create',icon:<Plus size={22}/>,create:true},{route:'/v2/circle' as V2Route,label:'Circle',icon:<Users size={21}/>},{route:'/v2/market' as V2Route,label:'Menu',icon:<Menu size={21}/>,menu:true}].map(item=><button key={item.label} onClick={()=>item.create?onCreate():item.menu?setMenuOpen(true):go(item.route)} className={route===item.route?'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold text-[#0A2A6B]':'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold text-slate-600'}>{item.create?<span className="-mt-3 grid h-12 w-12 place-items-center rounded-full border-4 border-white bg-[#1877F2] text-white"><Plus size={22}/></span>:item.icon}<span>{item.label}</span></button>)}</nav>
  </div>;
};
