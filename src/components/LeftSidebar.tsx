import type { AppView } from './Navbar';
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { avatarSrc } from './UserAvatar';
import {
  BarChart3, Bookmark, Briefcase, Calendar, ChevronDown, Film, Flag, Gamepad2, Home, MessageCircle, Package, Radio,
  Settings, ShoppingBag, Ticket, User as UserIcon, Users, Users2, Wallet, X
} from 'lucide-react';

interface LeftSidebarProps {
  currentView: string;
  onNavigate: (view: AppView, targetProfileId?: string) => void;
  onOpenMessenger: () => void;
  /** Big "Go Live" button. Falls back to the Live page. */
  onGoLive?: () => void;
  mobileDrawer?: boolean;
  onClose?: () => void;
}

interface NavItem { id: string; label: string; icon: React.ReactNode; action: () => void; active: boolean; badge?: number; tint: string }

const MORE_KEY = 'echat_sidebar_more_open';

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ currentView, onNavigate, onOpenMessenger, onGoLive, mobileDrawer = false, onClose }) => {
  const { user } = useAuth();
  const { t } = usePreferences();
  const [moreOpen, setMoreOpen] = useState(() => { try { return localStorage.getItem(MORE_KEY) === '1'; } catch { return false; } });
  if (!user) return null;

  const toggleMore = () => setMoreOpen(open => {
    try { localStorage.setItem(MORE_KEY, open ? '0' : '1'); } catch { /* ignore */ }
    return !open;
  });

  const primary: NavItem[] = [
    { id: 'feed', label: 'Home', icon: <Home size={20} />, action: () => onNavigate('feed'), active: currentView === 'feed', tint: 'from-violet-600 to-indigo-500' },
    { id: 'live', label: 'Live Streams', icon: <Radio size={20} />, action: () => onNavigate('live'), active: currentView === 'live', tint: 'from-pink-500 to-rose-500' },
    { id: 'marketplace', label: 'Marketplace', icon: <ShoppingBag size={20} />, action: () => onNavigate('marketplace'), active: currentView === 'marketplace', tint: 'from-amber-500 to-orange-500' },
    { id: 'messages', label: 'Messages', icon: <MessageCircle size={20} />, action: onOpenMessenger, active: currentView === 'messages', tint: 'from-blue-600 to-cyan-500' },
    { id: 'friends', label: 'Friends', icon: <Users size={20} />, action: () => onNavigate('friends'), active: currentView === 'friends', badge: user.friendRequestsReceived?.length || 0, tint: 'from-emerald-500 to-teal-500' },
    { id: 'profile', label: 'Profile', icon: <UserIcon size={20} />, action: () => onNavigate('profile', user.id), active: currentView === 'profile', tint: 'from-fuchsia-500 to-purple-600' },
    { id: 'settings', label: 'Settings', icon: <Settings size={20} />, action: () => onNavigate('settings'), active: currentView === 'settings', tint: 'from-slate-500 to-slate-700' }
  ];
  const more: NavItem[] = [
    { id: 'reels', label: 'Reels', icon: <Film size={18} />, action: () => onNavigate('reels'), active: currentView === 'reels', tint: '' },
    { id: 'pages', label: t('pages'), icon: <Flag size={18} />, action: () => onNavigate('pages'), active: currentView === 'pages', tint: '' },
    { id: 'groups', label: t('groups'), icon: <Users2 size={18} />, action: () => onNavigate('groups'), active: currentView === 'groups', tint: '' },
    { id: 'jobs', label: 'Jobs', icon: <Briefcase size={18} />, action: () => onNavigate('jobs'), active: currentView === 'jobs', tint: '' },
    { id: 'events', label: t('events'), icon: <Calendar size={18} />, action: () => onNavigate('events'), active: currentView === 'events', tint: '' },
    { id: 'wallet', label: 'Wallet', icon: <Wallet size={18} />, action: () => onNavigate('wallet'), active: currentView === 'wallet' || currentView === 'adminWallet', tint: '' },
    { id: 'games', label: 'Games', icon: <Gamepad2 size={18} />, action: () => onNavigate('games'), active: currentView === 'games', tint: '' },
    { id: 'tickets', label: 'My Tickets', icon: <Ticket size={18} />, action: () => onNavigate('myTickets'), active: currentView === 'myTickets', tint: '' },
    { id: 'dashboard', label: 'Creator Dashboard', icon: <BarChart3 size={18} />, action: () => onNavigate('dashboard'), active: currentView === 'dashboard', tint: '' },
    { id: 'saved', label: t('saved_posts'), icon: <Bookmark size={18} />, action: () => onNavigate('saved'), active: currentView === 'saved', tint: '' },
    { id: 'orders', label: 'My Orders', icon: <Package size={18} />, action: () => onNavigate('orders'), active: currentView === 'orders', tint: '' }
  ];
  const moreActive = more.some(item => item.active);

  const primaryButton = (item: NavItem) => (
    <button key={item.id} type="button" onClick={item.action} aria-current={item.active ? 'page' : undefined}
      className={`group relative flex min-h-12 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-[15px] transition ${item.active
        ? 'bg-white font-extrabold text-slate-900 shadow-md shadow-violet-900/10 dark:bg-white/10 dark:text-white'
        : 'font-semibold text-slate-700 hover:bg-white/70 hover:shadow-sm dark:text-slate-300 dark:hover:bg-white/5'}`}>
      {item.active && <span aria-hidden="true" className="ec-gradient absolute left-0 top-2 bottom-2 w-1 rounded-full" />}
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition group-hover:scale-105 ${item.active ? `bg-gradient-to-br ${item.tint} text-white shadow-md` : 'bg-violet-50 text-violet-700 dark:bg-white/5 dark:text-violet-300'}`}>{item.icon}</span>
      <span className="flex-1 truncate">{item.label}</span>
      {Boolean(item.badge) && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">{item.badge}</span>}
    </button>
  );

  const content = (
    <>
      <button type="button" onClick={() => onNavigate('profile', user.id)} className="ec-card mb-3 flex w-full items-center gap-3 bg-white p-3 text-left transition hover:shadow-md dark:bg-[#161033]">
        <span className="ec-story-ring shrink-0 rounded-full p-[2px]"><img src={avatarSrc(user.avatar, user.name)} alt="" className="h-11 w-11 rounded-full border-2 border-white object-cover dark:border-[#161033]" /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-extrabold text-slate-900 dark:text-white">{user.name}</span>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">View your profile</span>
        </span>
      </button>

      <nav aria-label="Main" className="space-y-1">{primary.map(primaryButton)}</nav>

      <button type="button" onClick={onGoLive || (() => onNavigate('live'))} className="ec-golive mt-4 flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-[20px] text-base font-extrabold text-white">
        <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-white" /></span>
        Go Live
      </button>

      <div className="mt-4 border-t border-violet-100 pt-3 dark:border-white/10">
        <button type="button" onClick={toggleMore} aria-expanded={moreOpen || moreActive} className="flex min-h-10 w-full items-center justify-between rounded-xl px-2.5 text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-white/5">
          More <ChevronDown size={16} className={`transition ${moreOpen || moreActive ? 'rotate-180' : ''}`} />
        </button>
        {(moreOpen || moreActive) && (
          <div className="mt-1 grid grid-cols-1 gap-0.5">
            {more.map(item => (
              <button key={item.id} type="button" onClick={item.action} aria-current={item.active ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-xl px-2.5 text-left text-sm transition ${item.active ? 'bg-white font-bold text-violet-700 shadow-sm dark:bg-white/10 dark:text-violet-200' : 'font-medium text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/5'}`}>
                <span className="text-violet-500 dark:text-violet-300">{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (mobileDrawer) {
    return (
      <aside role="dialog" aria-modal="true" aria-label="Navigation menu" className="fixed inset-y-0 left-0 z-[90] flex w-[min(86vw,340px)] flex-col overflow-y-auto bg-[#f6f4fd] px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow-2xl animate-in slide-in-from-left duration-200 dark:bg-[#0d0a1f]">
        <div className="mb-2 flex items-center justify-between px-1 py-1">
          <span className="ec-gradient-text text-xl font-black tracking-tight">EChat</span>
          <button type="button" onClick={onClose} aria-label="Close navigation menu" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white dark:hover:bg-white/10"><X size={21} /></button>
        </div>
        {content}
      </aside>
    );
  }

  return (
    <aside className="sticky top-[76px] hidden h-[calc(100vh-88px)] w-64 shrink-0 select-none overflow-y-auto pb-6 pr-1 [scrollbar-width:thin] lg:block xl:w-72">
      {content}
    </aside>
  );
};
