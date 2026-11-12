import React, { useState } from 'react';
import { ArrowLeft, Bookmark, CalendarDays, Compass, Film, Home, Menu, MessageCircle, Plus, ShoppingBag, Users, UsersRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './v2-layout.css';
import '../styles/echat-v2.css';

export type V2Route = '/v2/home' | '/v2/moments' | '/v2/vibes' | '/v2/circle' | '/v2/chat' | '/v2/communities' | '/v2/market' | '/v2/events' | '/v2/saved' | '/v2/market/orders' | '/v2/settings' | `/v2/market/listing/${string}`;

const links: { route: V2Route; title: string; icon: React.ReactNode }[] = [
  { route:'/v2/home', title:'Your Space', icon:<Home size={19}/> },
  { route:'/v2/moments', title:'Moments', icon:<SparklesIcon/> },
  { route:'/v2/vibes', title:'Vibes', icon:<Film size={19}/> },
  { route:'/v2/circle', title:'Your Circle', icon:<Users size={19}/> },
  { route:'/v2/chat', title:'Echat Chat', icon:<MessageCircle size={19}/> },
  { route:'/v2/communities', title:'Communities', icon:<UsersRound size={19}/> },
  { route:'/v2/market', title:'Echat Market', icon:<ShoppingBag size={19}/> },
  { route:'/v2/events', title:'Events', icon:<CalendarDays size={19}/> },
  { route:'/v2/saved', title:'Saved', icon:<Bookmark size={19}/> }
];

function SparklesIcon(){ return <span aria-hidden="true" className="text-lg">✨</span>; }

interface Props { route: V2Route; onNavigate:(route:V2Route)=>void; onClassic:()=>void; onCreate:()=>void; children:React.ReactNode; }

export const EchatV2Layout: React.FC<Props> = ({ route,onNavigate,onClassic,onCreate,children }) => {
  const { user } = useAuth();
  const [menuOpen,setMenuOpen]=useState(false);
  const go=(next:V2Route)=>{ setMenuOpen(false); onNavigate(next); };
  return <div className="echat-v2 min-h-dvh">
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/95 px-3 py-2 backdrop-blur sm:px-5">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-3">
        <button type="button" onClick={()=>go('/v2/home')} className="flex shrink-0 items-center gap-2 rounded-xl text-left" aria-label="Your Space"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#0F1B2D] text-lg font-black text-[#FFC107]">E</span><span className="hidden text-lg font-extrabold tracking-tight text-[#0F1B2D] sm:inline">Echat<span className="text-[#F5B301]">V2</span></span></button>
        <nav className="hidden items-center gap-1 lg:flex">{links.slice(0,6).map(link=><button key={link.route} onClick={()=>go(link.route)} className={`flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-bold ${route===link.route?'bg-[#FFF2C7] text-[#735000]':'text-slate-600 hover:bg-slate-100'}`}>{link.icon}<span>{link.title}</span></button>)}</nav>
        <div className="flex items-center gap-2"><button type="button" onClick={onClassic} className="hidden min-h-10 rounded-full border border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:block"><ArrowLeft size={14} className="mr-1 inline"/>Back to Classic</button><button type="button" onClick={()=>go('/v2/settings')} className="flex items-center gap-2 rounded-full p-1.5 pr-3 hover:bg-slate-100" aria-label="V2 settings"><img src={user?.avatar} alt="" className="h-9 w-9 rounded-full object-cover"/><span className="hidden max-w-28 truncate text-sm font-bold sm:block">{user?.name}</span></button><button type="button" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Open V2 menu" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 lg:hidden">{menuOpen?<X size={19}/>:<Menu size={19}/>}</button></div>
      </div>
    </header>
    {menuOpen&&<div className="fixed inset-0 z-50 bg-black/30 lg:hidden" onClick={()=>setMenuOpen(false)}><div className="absolute right-3 top-16 max-h-[80dvh] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-3xl bg-white p-3 shadow-2xl" onClick={event=>event.stopPropagation()}>{links.map(link=><button key={link.route} onClick={()=>go(link.route)} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-bold hover:bg-amber-50">{link.icon}{link.title}</button>)}<button onClick={()=>go('/v2/market/orders')} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-bold hover:bg-amber-50"><ShoppingBag size={19}/>Market orders</button><button onClick={onClassic} className="mt-2 flex min-h-12 w-full items-center gap-3 rounded-2xl bg-[#0F1B2D] px-3 text-left font-bold text-white"><ArrowLeft size={18}/>Back to Classic Echat</button></div></div>}
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-3 py-5 md:px-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden lg:block"><div className="echat-v2-card sticky top-20 p-3">{links.map(link=><button key={link.route} onClick={()=>go(link.route)} className={`flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-bold ${route===link.route?'bg-[#FFF2C7] text-[#735000]':'text-slate-600 hover:bg-slate-50'}`}>{link.icon}{link.title}</button>)}<button onClick={()=>go('/v2/market/orders')} className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-bold text-slate-600 hover:bg-slate-50"><ShoppingBag size={19}/>Market Orders</button><button onClick={onClassic} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-2xl bg-[#0F1B2D] px-3 text-left text-sm font-bold text-white"><ArrowLeft size={18}/>Classic Echat</button></div></aside>
      <main className="min-w-0">{children}</main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(66px+env(safe-area-inset-bottom))] items-start justify-around border-t border-slate-200 bg-white/95 px-1 pt-1 backdrop-blur lg:hidden">{[{route:'/v2/home' as V2Route,label:'Home',icon:<Home size={21}/>},{route:'/v2/vibes' as V2Route,label:'Vibes',icon:<Film size={21}/>},{route:'/v2/home' as V2Route,label:'Create',icon:<Plus size={22}/>,create:true},{route:'/v2/circle' as V2Route,label:'Circle',icon:<Users size={21}/>},{route:'/v2/market' as V2Route,label:'Menu',icon:<Menu size={21}/> }].map(item=><button key={item.label} onClick={()=>item.create?onCreate():go(item.route)} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${route===item.route?'text-[#8C6200]':'text-slate-500'}`}>{item.create?<span className="-mt-3 grid h-12 w-12 place-items-center rounded-full border-4 border-white bg-[#F5B301] text-[#0F1B2D] shadow-lg"><Plus size={22}/></span>:item.icon}<span>{item.label}</span></button>)}</nav>
  </div>;
};
