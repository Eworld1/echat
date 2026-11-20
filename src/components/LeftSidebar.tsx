import { usePreferences } from '../context/PreferencesContext';
import type { AppView } from './Navbar';
import React from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Users,
  MessageSquare,
  Bookmark,
  Compass,
  Settings,
  Flag,
  Users2,
  Calendar,
  Film,
  BarChart3,
  ShoppingBag,
  Package,
  Video,
  X
} from 'lucide-react';

interface LeftSidebarProps {
  currentView: string;
  onNavigate: (view: AppView, targetProfileId?: string) => void;
  onOpenMessenger: () => void;
  mobileDrawer?: boolean;
  onClose?: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ currentView, onNavigate, onOpenMessenger, mobileDrawer = false, onClose }) => {
  const { user } = useAuth();
  const { t } = usePreferences();

  if (!user) return null;

  if (mobileDrawer) {
    const items: { label: string; icon: React.ReactNode; action: () => void; active?: boolean }[] = [
      { label: 'News Feed', icon: <Compass size={20}/>, action: () => onNavigate('feed'), active: currentView === 'feed' },
      { label: 'Reels', icon: <Film size={20}/>, action: () => onNavigate('reels'), active: currentView === 'reels' },
      { label: 'Friends & Requests', icon: <Users size={20}/>, action: () => onNavigate('friends'), active: currentView === 'friends' },
      { label: 'Messages', icon: <MessageSquare size={20}/>, action: onOpenMessenger },
      { label: 'Pages', icon: <Flag size={20}/>, action: () => onNavigate('pages'), active: currentView === 'pages' },
      { label: 'Groups', icon: <Users2 size={20}/>, action: () => onNavigate('groups'), active: currentView === 'groups' },
      { label: 'Events', icon: <Calendar size={20}/>, action: () => onNavigate('events'), active: currentView === 'events' },
      { label: 'Dashboard', icon: <BarChart3 size={20}/>, action: () => onNavigate('dashboard'), active: currentView === 'dashboard' },
      { label: 'Saved Posts', icon: <Bookmark size={20}/>, action: () => onNavigate('saved'), active: currentView === 'saved' },
      { label: 'Marketplace', icon: <ShoppingBag size={20}/>, action: () => onNavigate('marketplace'), active: currentView === 'marketplace' },
      { label: 'My Orders', icon: <Package size={20}/>, action: () => onNavigate('orders'), active: currentView === 'orders' },
      { label: 'Settings & Privacy', icon: <Settings size={20}/>, action: () => onNavigate('settings'), active: currentView === 'settings' },
      { label: 'Go Live', icon: <Video size={20}/>, action: () => onNavigate('live'), active: currentView === 'live' }
    ];
    return <aside role="dialog" aria-modal="true" aria-label="Navigation menu" className="fixed inset-y-0 left-0 z-[90] flex w-[min(84vw,340px)] flex-col overflow-y-auto border-r border-slate-200 bg-white px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow-2xl animate-in slide-in-from-left duration-200">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 px-2 pb-3"><div className="flex min-w-0 items-center gap-3"><img src={user.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover"/><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{user.name}</p><p className="text-xs text-slate-500">Echat menu</p></div></div><button type="button" onClick={onClose} aria-label="Close navigation menu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-slate-100"><X size={21}/></button></div>
      <nav className="space-y-1">{items.map(item=><button key={item.label} type="button" onClick={item.action} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${item.active?'bg-blue-50 text-blue-800':'text-slate-800 hover:bg-slate-100'}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[#0A2A6B]">{item.icon}</span><span className="flex-1">{item.label}</span></button>)}</nav>
    </aside>;
  }

  return (
    <aside className="w-64 xl:w-72 flex-shrink-0 hidden lg:block sticky top-18 h-[calc(100vh-5rem)] overflow-y-auto pr-2 select-none">
      <div className="space-y-1">
        {/* Feeds / Home */}
        <button
          onClick={() => onNavigate('feed')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
            currentView === 'feed' ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
            <Compass size={20} />
          </div>
          <span className="truncate">{t('news_feed')}</span>
        </button>

        <button
          onClick={() => onNavigate('reels')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${currentView === 'reels' ? 'bg-blue-50 text-blue-800 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'}`}
        >
          <div className="w-9 h-9 rounded-full bg-slate-100 text-[#0A2A6B] flex items-center justify-center"><Film size={19} /></div>
          <span className="truncate">Reels</span>
        </button>

        {/* Friends */}
        <button
          onClick={() => onNavigate('friends')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
            currentView === 'friends' ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <Users size={20} />
          </div>
          <span className="flex-1 truncate">{t('friends_requests')}</span>
          {user.friendRequestsReceived.length > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {user.friendRequestsReceived.length}
            </span>
          )}
        </button>

        <button onClick={onOpenMessenger} className="w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left hover:bg-slate-200/60 text-slate-700 font-semibold text-sm"><div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center"><MessageSquare size={20}/></div><span>Messages</span></button>

        {/* Pages */}
        <button
          onClick={() => onNavigate('pages')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
            currentView === 'pages' ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center">
            <Flag size={20} />
          </div>
          <span className="flex-1 truncate">{t('pages')}</span>
        </button>

        {/* Groups */}
        <button
          onClick={() => onNavigate('groups')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
            currentView === 'groups' ? 'bg-blue-50 text-blue-800 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-slate-100 text-[#0A2A6B] flex items-center justify-center">
            <Users2 size={20} />
          </div>
          <span className="flex-1 truncate">{t('groups')}</span>
        </button>

        {/* Events */}
        <button
          onClick={() => onNavigate('events')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
            currentView === 'events' ? 'bg-rose-50 text-rose-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
            <Calendar size={20} />
          </div>
          <span className="flex-1 truncate">{t('events')}</span>
        </button>

        <button onClick={() => onNavigate('dashboard')} className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${currentView === 'dashboard' ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'}`}><div className="w-9 h-9 rounded-full bg-slate-100 text-[#0A2A6B] flex items-center justify-center"><BarChart3 size={19}/></div><span>Dashboard</span></button>

        {/* Settings & Privacy */}
        {/* Saved */}
        <button
          onClick={() => onNavigate('saved')}
          className={`w-full p-2.5 hover:bg-slate-200/60 rounded-2xl flex items-center gap-3 transition text-left font-semibold text-sm ${currentView === 'saved' ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}`}
        >
          <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
            <Bookmark size={20} />
          </div>
          <span>{t('saved_posts')}</span>
        </button>

        <button onClick={() => onNavigate('marketplace')} className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${currentView === 'marketplace' ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'}`}><div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center"><ShoppingBag size={19}/></div><span>Marketplace</span></button>
        <button onClick={() => onNavigate('orders')} className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${currentView === 'orders' ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'}`}><div className="w-9 h-9 rounded-full bg-slate-100 text-[#0A2A6B] flex items-center justify-center"><Package size={19}/></div><span>My Orders</span></button>

        {/* Settings and administrator access */}
        <button onClick={() => onNavigate('settings')} className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${currentView === 'settings' ? 'bg-slate-200 text-slate-900 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'}`}><div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center"><Settings size={20}/></div><span className="flex-1 truncate">{t('settings_privacy')}</span></button>
      </div>

    </aside>
  );
};
