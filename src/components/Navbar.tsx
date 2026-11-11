import { usePreferences } from '../context/PreferencesContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { IosInstallHelp } from './InstallAppBanner';
import { initialsAvatar } from '../utils/avatar';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { getNotifications as getFirestoreNotifications, markNotificationsRead as markFirestoreNotificationsRead } from '../services/db';
import { User, Notification, Post } from '../types';
import {
  MessageSquare,
  Search,
  Home,
  PlusSquare,
  Users,
  Shield,
  Bell,
  LogOut,
  User as UserIcon,
  X,
  Clock,
  Sparkles,
  Compass,
  Bookmark,
  UsersRound,
  CalendarDays,
  Settings2,
  Heart,
  Download,
  MessageCircle,
  Phone,
  PhoneMissed,
  Loader2,
  FileText,
  CornerDownLeft,
  ArrowRight,
  ChevronRight,
  Image as ImageIcon,
  Flag,
  Users2,
  Calendar,
  Settings as SettingsIcon
  , Film, BarChart3
} from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';
import { LANGUAGES, type LanguageName } from '../i18n/translations';

export type AppView = 'feed' | 'reels' | 'friends' | 'admin' | 'profile' | 'pages' | 'groups' | 'events' | 'settings' | 'saved' | 'dashboard';

interface NavbarProps {
  currentView: AppView;
  onNavigate: (view: AppView, targetProfileId?: string, targetPostId?: string) => void;
  onOpenMessenger: () => void;
  onOpenCreate: () => void;
  onProfileMenuChange: (open: boolean) => void;
}

interface PageItem {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: React.ReactNode;
  action: () => void;
  keywords: string[];
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onNavigate,
  onOpenMessenger,
  onOpenCreate,
  onProfileMenuChange
}) => {
  const { user, isDeveloper, logout, activePage, myPages, switchIdentity } = useAuth();
  const { t, theme, setTheme, language, setLanguage } = usePreferences();
  const { onlineUserIds, onNotification, startCall } = useSocket();
  const { canInstall, install } = useInstallPrompt();
  const [showIosHelp, setShowIosHelp] = useState(false);

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [showHelpInfo, setShowHelpInfo] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toast, setToast] = useState<Notification | null>(null);

  // Global Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ users: User[]; posts: Post[] }>({ users: [], posts: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'people' | 'posts' | 'reels' | 'pages'>('all');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('echat_recent_searches');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const profileTouchStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showSearchDropdown || window.innerWidth < 1025) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [showSearchDropdown]);

  useEffect(() => {
    setShowProfileMenu(false);
    onProfileMenuChange(false);
    setSettingsExpanded(false);
    setShowNotifications(false);
    setShowSearchDropdown(false);
  }, [currentView, onProfileMenuChange]);

  const closeProfileMenu = () => {
    setShowProfileMenu(false);
    onProfileMenuChange(false);
  };

  const toggleProfileMenu = () => {
    setShowProfileMenu(open => {
      onProfileMenuChange(!open);
      return !open;
    });
    setSettingsExpanded(false);
    setShowHelpInfo(false);
  };

  // App Pages definition for search
  const searchablePages: PageItem[] = useMemo(() => [
    {
      id: 'page_feed',
      title: 'News Feed',
      description: 'Home stream of posts, updates, and stories',
      category: 'Social',
      icon: <Compass size={18} className="text-blue-600" />,
      action: () => onNavigate('feed'),
      keywords: ['feed', 'home', 'news', 'timeline', 'updates', 'stream']
    },
    {
      id: 'page_friends',
      title: 'Friends & Requests',
      description: 'Find friends, see received invitations, and manage network',
      category: 'Community',
      icon: <Users size={18} className="text-emerald-600" />,
      action: () => onNavigate('friends'),
      keywords: ['friends', 'friend requests', 'connections', 'people', 'network', 'requests']
    },
    {
      id: 'page_reels',
      title: 'Reels',
      description: 'Create and watch short public videos',
      category: 'Media',
      icon: <Film size={18} className="text-fuchsia-600" />,
      action: () => onNavigate('reels'),
      keywords: ['reels', 'short videos', 'video feed', 'clips']
    },
    {
      id: 'page_profile',
      title: 'My Profile',
      description: 'Your personal timeline, photos, and profile settings',
      category: 'Account',
      icon: <UserIcon size={18} className="text-indigo-600" />,
      action: () => {
        if (user) onNavigate('profile', user.id);
      },
      keywords: ['profile', 'me', 'account', 'bio', 'photos', 'timeline', 'dob']
    },
    {
      id: 'page_messenger',
      title: 'Messenger & Calls',
      description: 'Direct messaging and real-time WebRTC audio/video calling',
      category: 'Messaging',
      icon: <MessageSquare size={18} className="text-violet-600" />,
      action: () => onOpenMessenger(),
      keywords: ['messenger', 'chat', 'messages', 'dm', 'calls', 'video call', 'audio call']
    },
    ...(isDeveloper ? [{
      id: 'page_admin',
      title: 'Developer Mode & Admin',
      description: 'System metrics, user moderation, database inspection',
      category: 'Administration',
      icon: <Shield size={18} className="text-purple-600" />,
      action: () => onNavigate('admin'),
      keywords: ['admin', 'developer', 'dashboard', 'logs', 'moderation', 'reports', 'system']
    }] : []),
    {
      id: 'page_stories',
      title: '24-Hour Stories',
      description: 'View temporary photo and video moments from friends',
      category: 'Media',
      icon: <Sparkles size={18} className="text-amber-500" />,
      action: () => onNavigate('feed'),
      keywords: ['stories', 'story', 'status', 'moments', '24h']
    },
    {
      id: 'page_saved',
      title: 'Saved Posts',
      description: 'Browse articles and posts you saved for later',
      category: 'Collections',
      icon: <Bookmark size={18} className="text-rose-500" />,
      action: () => onNavigate('saved'),
      keywords: ['saved', 'bookmarks', 'favorites', 'saved posts']
    }
  ], [user, isDeveloper, onNavigate, onOpenMessenger]);


  // Filtered pages based on search query
  const matchingPages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return searchablePages;
    return searchablePages.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.keywords.some(k => k.includes(q))
    );
  }, [searchQuery, searchablePages]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Shortcut Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearchDropdown(true);
      }
      if (e.key === 'Escape') {
        setShowSearchDropdown(false);
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Notifications
  const loadNotifications = async () => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }
    try {
      // The Echat server is the source of truth (messages, missed calls, friend requests...)
      const list = await api.getNotifications();
      if (list && list.length > 0) {
        setNotifications(list);
        return;
      }
      // Older notifications that only exist in Firestore
      const firestoreNotifs = await getFirestoreNotifications(user.id).catch(() => []);
      setNotifications(firestoreNotifs || []);
    } catch (err) {
      console.warn('Failed to load notifications:', err);
    }
  };

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }
    loadNotifications();
    // Safety net in case a live push was missed (phone asleep, connection dropped)
    const timer = setInterval(loadNotifications, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadNotifications(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('echat:messages-seen', loadNotifications);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('echat:messages-seen', loadNotifications);
    };
  }, [user?.id]);

  // Live notifications: new message, missed call, friend request...
  useEffect(() => {
    return onNotification(n => {
      setNotifications(prev => [n, ...prev.filter(x => x.id !== n.id)]);
      setToast(n);
      if (document.hidden && 'Notification' in window && window.Notification.permission === 'granted') {
        try {
          new window.Notification(n.type === 'missed_call' ? 'Missed call' : n.type === 'message' ? 'New message' : 'Echat', {
            body: n.message,
            icon: n.actor?.avatar,
            tag: n.id
          });
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleMarkNotificationsRead = async () => {
    if (user?.id) {
      markFirestoreNotificationsRead(user.id).catch(() => {});
    }
    // Message notifications stay unread until the chat is opened (the server clears them then).
    await api.markNotificationsRead({ exceptMessages: true }).catch(() => {});
    setNotifications(prev => prev.map(n => (n.type === 'message' ? n : { ...n, read: true })));
  };

  // Perform debounced search
  const performSearch = (q: string) => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!q.trim()) {
      setIsSearching(false);
      setSearchResults({ users: [], posts: [] });
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await api.search(q.trim());
        setSearchResults(results);
      } catch (err) {
        console.error('Global search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 220);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    setShowSearchDropdown(true);
    performSearch(q);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults({ users: [], posts: [] });
    setIsSearching(false);
    searchInputRef.current?.focus();
  };

  const saveRecentSearch = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setRecentSearches(prev => {
      const updated = [clean, ...prev.filter(i => i.toLowerCase() !== clean.toLowerCase())].slice(0, 8);
      try {
        localStorage.setItem('echat_recent_searches', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const removeRecentSearch = (term: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentSearches(prev => {
      const updated = prev.filter(i => i !== term);
      try {
        localStorage.setItem('echat_recent_searches', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const clearAllRecent = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentSearches([]);
    try {
      localStorage.removeItem('echat_recent_searches');
    } catch {}
  };

  const handleSelectUser = (targetUser: User) => {
    saveRecentSearch(targetUser.name);
    setShowSearchDropdown(false);
    onNavigate('profile', targetUser.id);
  };

  const handleSelectPost = (targetPost: Post) => {
    saveRecentSearch(searchQuery || targetPost.content.slice(0, 25));
    setShowSearchDropdown(false);
    onNavigate('feed', undefined, targetPost.id);
  };

  const handleSelectPage = (page: PageItem) => {
    saveRecentSearch(page.title);
    setShowSearchDropdown(false);
    page.action();
  };

  const handleSelectRecentTerm = (term: string) => {
    setSearchQuery(term);
    setShowSearchDropdown(true);
    performSearch(term);
  };

  // Helper to highlight matching text
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim() || !text) return text;
    const q = query.trim();
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + q.length);
    const after = text.slice(idx + q.length);
    return (
      <span>
        {before}
        <span className="bg-blue-100 text-blue-800 font-bold px-0.5 rounded-xs">
          {match}
        </span>
        {after}
      </span>
    );
  };

  const totalResultsCount =
    (searchQuery.trim() ? searchResults.users.length : 0) +
    (searchQuery.trim() ? searchResults.posts.length : 0) +
    matchingPages.length;
  const matchingPosts = searchResults.posts.filter(post => post.type !== 'reel');
  const matchingReels = searchResults.posts.filter(post => post.type === 'reel');

  const unreadNotificationsCount = notifications.filter(n => !n.read && n.type !== 'message').length;
  const unreadMessageCount = notifications.filter(n => !n.read && n.type === 'message').length;

  return (
    <header className={`sticky top-0 ${showProfileMenu ? 'z-[100]' : 'z-30'} bg-white border-b border-slate-200/90 shadow-2xs`}>
      <div className="mx-auto grid h-auto w-full max-w-7xl grid-cols-[40px_minmax(0,1fr)_auto] grid-rows-[56px_48px] items-center gap-x-2 px-3 sm:px-4 min-[1025px]:grid-cols-[280px_minmax(0,1fr)_320px] min-[1025px]:grid-rows-[56px]">
        
        {/* Left: Brand Logo & Global Search Bar */}
        <div className="contents">
          <div
            onClick={() => onNavigate('feed')}
            className="col-start-1 row-start-1 flex min-w-0 shrink-0 cursor-pointer items-center gap-2 group min-[1025px]:w-[280px]"
          >
            <img src="/logo.png" alt="EchatSl" className="h-10 w-10 shrink-0 rounded-full object-cover shadow-md transition group-hover:scale-105" />
            <span className="hidden truncate text-xl font-black tracking-tight text-amber-600 min-[1025px]:inline">EchatSl</span>
          </div>

          {/* Global Search Bar */}
          <div ref={searchContainerRef} className={`relative col-start-2 row-start-1 min-w-0 w-full ${showSearchDropdown ? 'min-[1025px]:fixed min-[1025px]:left-1/2 min-[1025px]:top-16 min-[1025px]:z-50 min-[1025px]:w-[min(500px,calc(100vw-24px))] min-[1025px]:-translate-x-1/2 min-[1025px]:rounded-full min-[1025px]:bg-white min-[1025px]:shadow-xl min-[1025px]:block' : 'min-[1025px]:hidden'}`}>
            <div className="relative flex items-center">
              <div className="absolute left-3 text-slate-400 flex items-center pointer-events-none">
                {isSearching ? (
                  <Loader2 size={16} className="animate-spin text-blue-600" />
                ) : (
                  <Search size={16} />
                )}
              </div>

              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onFocus={() => setShowSearchDropdown(true)}
                placeholder={window.innerWidth <= 768 ? 'Search' : 'Search EChat'}
                className="h-10 w-full min-w-0 rounded-full border border-transparent bg-slate-100 py-1.5 pl-9 pr-10 text-xs shadow-inner transition placeholder-slate-400 hover:bg-slate-100/80 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 sm:text-sm"
              />

              <div className="absolute right-2.5 flex items-center gap-1">
                {searchQuery && (
                  <button
                    onClick={handleClearSearch}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200/60 transition cursor-pointer"
                    title="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
                {!searchQuery && (
                  <span className="hidden md:flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 bg-slate-200/70 border border-slate-300/60 px-1.5 py-0.5 rounded-md pointer-events-none select-none">
                    <kbd>Ctrl</kbd> <kbd>K</kbd>
                  </span>
                )}
              </div>
            </div>

            {/* Global Search Results Dropdown */}
            {showSearchDropdown && (
              <div className="fixed inset-0 z-[70] flex h-[100dvh] max-h-[100dvh] flex-col overflow-y-auto border border-slate-200/90 bg-white py-2.5 shadow-2xl animate-in fade-in min-[769px]:absolute min-[769px]:inset-auto min-[769px]:left-0 min-[769px]:right-0 min-[769px]:top-11 min-[769px]:z-50 min-[769px]:max-h-[82vh] min-[769px]:rounded-2xl min-[769px]:py-2.5">
                <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] min-[769px]:hidden">
                  <button type="button" onClick={() => setShowSearchDropdown(false)} aria-label="Back from search" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"><X size={20} /></button>
                  <div className="relative min-w-0 flex-1">
                    <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input autoFocus value={searchQuery} onChange={handleSearchChange} placeholder="Search EChat" className="h-11 w-full rounded-full bg-slate-100 pl-10 pr-4 text-base text-slate-900 outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                
                {/* Search Tabs when query entered */}
                {searchQuery.trim() && (
                  <div className="px-3 pb-2 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto text-xs font-semibold">
                    <button
                      onClick={() => setActiveTab('all')}
                      className={`px-3 py-1 rounded-full transition cursor-pointer ${
                        activeTab === 'all'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      All ({searchResults.users.length + searchResults.posts.length + matchingPages.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('people')}
                      className={`px-3 py-1 rounded-full transition cursor-pointer flex items-center gap-1 ${
                        activeTab === 'people'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <Users size={12} />
                      People ({searchResults.users.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('posts')}
                      className={`px-3 py-1 rounded-full transition cursor-pointer flex items-center gap-1 ${
                        activeTab === 'posts'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <FileText size={12} />
                      Posts ({matchingPosts.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('reels')}
                      className={`px-3 py-1 rounded-full transition cursor-pointer flex items-center gap-1 ${activeTab === 'reels' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      <Film size={12} /> Reels ({matchingReels.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('pages')}
                      className={`px-3 py-1 rounded-full transition cursor-pointer flex items-center gap-1 ${
                        activeTab === 'pages'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <Compass size={12} />
                      Pages ({matchingPages.length})
                    </button>
                  </div>
                )}

                {/* State 1: Empty Query - Show Recent Searches & Quick Pages */}
                {!searchQuery.trim() && (
                  <div className="divide-y divide-slate-100">
                    {/* Recent Searches Section */}
                    {recentSearches.length > 0 && (
                      <div className="p-2">
                        <div className="px-2.5 py-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            Recent Searches
                          </span>
                          <button
                            onClick={clearAllRecent}
                            className="text-blue-600 hover:underline cursor-pointer lowercase text-xs font-medium"
                          >
                            clear all
                          </button>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {recentSearches.map((term, i) => (
                            <div
                              key={i}
                              onClick={() => handleSelectRecentTerm(term)}
                              className="px-2.5 py-1.5 hover:bg-slate-100/80 rounded-xl flex items-center justify-between group cursor-pointer transition text-xs text-slate-700"
                            >
                              <div className="flex items-center gap-2">
                                <Clock size={14} className="text-slate-400 group-hover:text-blue-500 transition" />
                                <span>{term}</span>
                              </div>
                              <button
                                onClick={(e) => removeRecentSearch(term, e)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 rounded-md transition"
                                title="Remove from recent"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quick Pages Shortcuts */}
                    <div className="p-2">
                      <p className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Explore Echat
                      </p>
                      <div className="mt-1 space-y-0.5">
                        {searchablePages.slice(0, 5).map(page => (
                          <div
                            key={page.id}
                            onClick={() => handleSelectPage(page)}
                            className="px-2.5 py-2 hover:bg-blue-50/70 rounded-xl flex items-center gap-3 cursor-pointer transition group"
                          >
                            <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center transition">
                              {page.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 leading-tight group-hover:text-blue-600 transition">
                                {page.title}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate leading-tight">
                                {page.description}
                              </p>
                            </div>
                            <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-500 transition" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* State 2: Query Entered & Results Loaded */}
                {searchQuery.trim() && (
                  <div className="p-2 space-y-4">
                    {/* Searching Loader Indicator */}
                    {isSearching && (
                      <div className="py-4 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin text-blue-600" />
                        <span>Searching Echat for "{searchQuery}"...</span>
                      </div>
                    )}

                    {/* Empty State */}
                    {!isSearching &&
                      searchResults.users.length === 0 &&
                      searchResults.posts.length === 0 &&
                      matchingPages.length === 0 && (
                        <div className="py-8 px-4 text-center">
                          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                            <Search size={22} />
                          </div>
                          <p className="text-sm font-bold text-slate-800">No results found for "{searchQuery}"</p>
                          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                            Try checking for spelling errors or searching for a friend's name, post topics, or pages like 'Friends'.
                          </p>
                        </div>
                      )}

                    {/* Section: People */}
                    {(activeTab === 'all' || activeTab === 'people') && searchResults.users.length > 0 && (
                      <div>
                        <div className="px-2.5 py-1 flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Users size={12} className="text-blue-600" />
                            People ({searchResults.users.length})
                          </span>
                        </div>
                        <div className="mt-1 space-y-1">
                          {searchResults.users.map(u => {
                            const isOnline = onlineUserIds.includes(u.id);
                            const isFriend = user?.friends.includes(u.id);
                            const isMe = user?.id === u.id;

                            return (
                              <div
                                key={u.id}
                                onClick={() => handleSelectUser(u)}
                                className="px-3 py-2 hover:bg-blue-50/70 rounded-xl flex items-center gap-3 cursor-pointer transition group"
                              >
                                <div className="relative">
                                  <img
                                    src={u.avatar}
                                    alt={u.name}
                                    className="w-10 h-10 rounded-full object-cover border border-slate-200"
                                  />
                                  {isOnline && (
                                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition flex items-center gap-1">
                                      {highlightMatch(u.name, searchQuery)}
                                      {(u.isVerified || u.email === 'eldermoses89@gmail.com') && <VerifiedBadge size={13} />}
                                    </span>
                                    {isMe ? (
                                      <span className="text-[10px] font-extrabold bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded-md">
                                        You
                                      </span>
                                    ) : isFriend ? (
                                      <span className="text-[10px] font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded-md">
                                        Friend
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="text-[11px] text-slate-500 truncate">
                                    {u.location ? `Lives in ${u.location}` : u.bio || u.email}
                                  </p>
                                </div>
                                <button
                                  className="text-[11px] font-bold text-blue-600 group-hover:bg-blue-600 group-hover:text-white px-2.5 py-1 rounded-lg transition border border-blue-200 group-hover:border-blue-600"
                                >
                                  View
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Section: Pages & Navigation */}
                    {(activeTab === 'all' || activeTab === 'pages') && matchingPages.length > 0 && (
                      <div>
                        <div className="px-2.5 py-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <Compass size={12} className="text-indigo-600" />
                            Pages & Navigation ({matchingPages.length})
                          </span>
                        </div>
                        <div className="mt-1 space-y-1">
                          {matchingPages.map(page => (
                            <div
                              key={page.id}
                              onClick={() => handleSelectPage(page)}
                              className="px-3 py-2 hover:bg-slate-100/90 rounded-xl flex items-center gap-3 cursor-pointer transition group"
                            >
                              <div className="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-white group-hover:shadow-xs flex items-center justify-center transition border border-slate-200/60">
                                {page.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition">
                                    {highlightMatch(page.title, searchQuery)}
                                  </span>
                                  <span className="text-[9px] font-semibold uppercase bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                    {page.category}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {page.description}
                                </p>
                              </div>
                              <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-600 transition" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Section: Posts */}
                    {(activeTab === 'all' || activeTab === 'posts') && matchingPosts.length > 0 && (
                      <div>
                        <div className="px-2.5 py-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <FileText size={12} className="text-amber-600" />
                            Posts ({matchingPosts.length})
                          </span>
                        </div>
                        <div className="mt-1 space-y-1.5">
                          {matchingPosts.map(post => (
                            <div
                              key={post.id}
                              onClick={() => handleSelectPost(post)}
                              className="px-3 py-2.5 hover:bg-blue-50/60 rounded-xl cursor-pointer transition border border-transparent hover:border-blue-100 group"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <img
                                    src={post.author?.avatar || initialsAvatar(post.author?.name || '')}
                                    alt={post.author?.name || 'User'}
                                    className="w-6 h-6 rounded-full object-cover"
                                  />
                                  <span className="text-xs font-bold text-slate-800 truncate group-hover:text-blue-600 transition">
                                    {highlightMatch(post.author?.name || 'User', searchQuery)}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-400 flex-shrink-0">
                                  {new Date(post.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                              </div>

                              <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                                {highlightMatch(post.content, searchQuery)}
                              </p>

                              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400 font-medium">
                                {post.mediaUrl && (
                                  <span className="flex items-center gap-1 text-blue-600">
                                    <ImageIcon size={11} />
                                    Media attached
                                  </span>
                                )}
                                <span className="flex items-center gap-1">
                                  <Heart size={11} className="text-rose-500" />
                                  {post.reactions?.length || 0}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MessageCircle size={11} className="text-slate-400" />
                                  {post.comments?.length || 0}
                                </span>
                                <span className="ml-auto text-blue-600 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5 font-bold">
                                  Jump to post <ArrowRight size={10} />
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(activeTab === 'all' || activeTab === 'reels') && matchingReels.length > 0 && (
                      <div>
                        <div className="px-2.5 py-1"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Reels ({matchingReels.length})</span></div>
                        <div className="mt-1 space-y-1.5">
                          {matchingReels.map(reel => <div key={reel.id} onClick={() => handleSelectPost(reel)} className="flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition hover:border-fuchsia-100 hover:bg-fuchsia-50/60">
                            <Film size={18} className="shrink-0 text-fuchsia-600" />
                            <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-800">{reel.author?.name || 'EChat Reel'}</p><p className="truncate text-[11px] text-slate-500">{reel.content || 'Video Reel'}</p></div>
                            <ArrowRight size={14} className="text-slate-300" />
                          </div>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Dropdown Footer */}
                <div className="px-3 pt-2 mt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 select-none">
                  <span>Global Search across Echat</span>
                  <div className="flex items-center gap-2">
                    <span>Press <kbd className="bg-slate-100 px-1 py-0.5 rounded border border-slate-200 font-mono">Esc</kbd> to close</span>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Center: Main Navigation Icons (Facebook style) */}

        <div className="col-span-3 row-start-2 flex h-12 w-full max-w-full items-stretch justify-center gap-0 overflow-x-auto overflow-y-hidden px-2 scrollbar-none min-[1025px]:col-start-2 min-[1025px]:col-span-1 min-[1025px]:row-start-1 min-[1025px]:overflow-visible">
          <button
            onClick={() => onNavigate('feed')}
            className={`h-12 min-w-14 max-w-28 flex-1 border-b-[3px] flex flex-col items-center justify-center gap-0 transition cursor-pointer ${
              currentView === 'feed'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
            title="Home News Feed"
          >
            <Home size={22} strokeWidth={currentView === 'feed' ? 2.5 : 2} />
            <span className="text-[9px] leading-3 min-[1025px]:hidden">Home</span>
          </button>

          <button
            onClick={() => onNavigate('reels')}
            className={`h-12 min-w-14 max-w-28 flex-1 border-b-[3px] flex flex-col items-center justify-center gap-0 transition cursor-pointer ${currentView === 'reels' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
            title="Reels"
          >
            <Film size={22} strokeWidth={currentView === 'reels' ? 2.5 : 2} />
            <span className="text-[9px] leading-3 min-[1025px]:hidden">Reels</span>
          </button>

          <button
            onClick={() => onNavigate('friends')}
            className={`h-12 min-w-14 max-w-28 flex-1 border-b-[3px] flex flex-col items-center justify-center gap-0 transition cursor-pointer relative ${
              currentView === 'friends'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
            title="Friends & Requests"
          >
            <Users size={22} strokeWidth={currentView === 'friends' ? 2.5 : 2} />
            <span className="text-[9px] leading-3 min-[1025px]:hidden">Friends</span>
            {user && user.friendRequestsReceived.length > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
                {user.friendRequestsReceived.length}
              </span>
            )}
          </button>

          <button onClick={() => onNavigate('pages')} className={`hidden h-12 min-w-14 max-w-28 flex-1 items-center justify-center border-b-[3px] transition hover:bg-slate-100 hover:text-slate-800 min-[1025px]:flex ${currentView === 'pages' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`} title="Pages"><Flag size={22} /></button>
          <button onClick={onOpenMessenger} className="relative flex h-12 min-w-14 max-w-28 flex-1 flex-col items-center justify-center gap-0 border-b-[3px] border-transparent text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 min-[1025px]:hidden" title="Messages"><MessageSquare size={20} /><span className="text-[9px] leading-3">Messages</span>{unreadMessageCount > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">{unreadMessageCount}</span>}</button>
          <button onClick={() => { setShowNotifications(value => !value); if (!showNotifications) handleMarkNotificationsRead(); }} className="relative flex h-12 min-w-14 max-w-28 flex-1 flex-col items-center justify-center gap-0 border-b-[3px] border-transparent text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 min-[1025px]:hidden" title="Notifications"><Bell size={20} /><span className="text-[9px] leading-3">Notifications</span>{unreadNotificationsCount > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unreadNotificationsCount}</span>}</button>

          {isDeveloper && (
            <button
              onClick={() => onNavigate('admin')}
              className={`h-12 min-w-14 max-w-28 flex-1 border-b-[3px] items-center justify-center transition cursor-pointer hidden min-[1025px]:flex ${
                currentView === 'admin'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`}
              title="Master Developer Console"
            >
              <div className="flex items-center gap-1.5">
                <Shield size={20} strokeWidth={currentView === 'admin' ? 2.5 : 2} />
                <span className="hidden md:inline text-[11px] font-extrabold uppercase bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-md">
                  Developer
                </span>
              </div>
            </button>
          )}
        </div>

        {/* Right: Actions, Messenger, Notifications, Profile */}
        <div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-1 min-[1025px]:gap-2">

          <button onClick={() => { setShowSearchDropdown(true); searchInputRef.current?.focus(); }} className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 min-[1025px]:flex" title="Search EChat" aria-label="Search EChat"><Search size={19} /></button>

          <button onClick={onOpenCreate} className="hidden h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 min-[1025px]:flex" title="Create post"><PlusSquare size={19} /></button>

          {/* Messenger Icon */}
          <button
            onClick={onOpenMessenger}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 min-[1025px]:relative min-[1025px]:flex min-[1025px]:h-10 min-[1025px]:w-10 cursor-pointer"
            title="Open Messenger"
          >
            <MessageSquare size={19} />
            {unreadMessageCount > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-red-600 text-white text-[10px] font-extrabold rounded-full flex items-center justify-center ring-2 ring-white">
                {unreadMessageCount > 9 ? '9+' : unreadMessageCount}
              </span>
            ) : (
              <span className="absolute bottom-1 right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
            )}
          </button>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              onClick={() => {
                setShowNotifications(!showNotifications);
                if (!showNotifications) {
                  handleMarkNotificationsRead();
                  if ('Notification' in window && window.Notification.permission === 'default') {
                    window.Notification.requestPermission().catch(() => {});
                  }
                }
              }}
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 min-[1025px]:relative min-[1025px]:flex min-[1025px]:h-10 min-[1025px]:w-10 cursor-pointer"
              title="Notifications"
            >
              <Bell size={19} />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white text-[10px] font-extrabold rounded-full flex items-center justify-center ring-2 ring-white">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 top-12 w-80 sm:w-96 bg-white rounded-3xl shadow-2xl border border-slate-100 py-3 z-40 max-h-96 overflow-y-auto animate-in fade-in">
                <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">{t('notifications')}</h3>
                  <button
                    onClick={handleMarkNotificationsRead}
                    className="text-xs text-blue-600 hover:underline font-semibold"
                  >
                    {t('mark_all_read')}
                  </button>
                </div>

                <div className="divide-y divide-slate-50">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs">
                      {t('no_notifications')}
                    </div>
                  ) : (
                    notifications.map(n => (
                      <div
                        key={n.id}
                        onClick={() => {
                          setShowNotifications(false);
                          if (n.type === 'message') onOpenMessenger();
                          else if (n.type === 'birthday' || n.type === 'birthday_reminder' || n.type === 'birthday_today') onNavigate('profile', n.actorId);
                          else if ((n.type === 'post_tag' || n.type === 'post_share' || n.type === 'post_reaction' || n.type === 'post_comment' || n.type === 'post_new') && n.targetId) {
                            onNavigate('feed', undefined, n.targetId);
                          } else if (n.type === 'live_stream') onNavigate('feed');
                          else if (n.type === 'friend_request') onNavigate('friends');
                          else if (n.type === 'friend_accept' || n.type === 'missed_call') onNavigate('profile', n.actorId);
                          else if (n.type === 'page_follow') onNavigate('pages');
                        }}
                        className={`p-3.5 flex items-start gap-3 hover:bg-slate-50 transition cursor-pointer ${
                          !n.read ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        <div className="relative flex-shrink-0">
                          <img
                            src={n.actor?.avatar || initialsAvatar(n.actor?.name || '')}
                            alt="actor"
                            className="w-10 h-10 rounded-full object-cover"
                          />
                          {(n.type === 'message' || n.type === 'missed_call' || n.type === 'birthday' || n.type === 'birthday_reminder' || n.type === 'birthday_today') && (
                            <span
                              className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-white ring-2 ring-white ${
                                n.type === 'missed_call' ? 'bg-red-600' : n.type.startsWith('birthday') ? 'bg-amber-500' : 'bg-blue-600'
                              }`}
                            >
                              {n.type === 'missed_call' ? <PhoneMissed size={11} /> : n.type.startsWith('birthday') ? <span aria-hidden="true">🎂</span> : <MessageCircle size={11} />}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-snug ${n.type === 'missed_call' ? 'text-red-700 font-semibold' : 'text-slate-800'}`}>
                            {n.message}
                          </p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {n.type === 'missed_call' && n.actor && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setShowNotifications(false);
                                startCall(n.actor!.id, n.actor!.name, n.actor!.avatar, n.callType || 'audio');
                              }}
                              className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold"
                            >
                              <Phone size={11} /> {t('call_back')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {showIosHelp && <IosInstallHelp onClose={() => setShowIosHelp(false)} />}

          {/* Live pop-up for a new message / missed call */}
          {toast && (
            <div className="fixed bottom-4 right-4 z-[80] max-w-xs w-[calc(100%-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3.5 flex items-start gap-3 animate-in fade-in">
              <img
                src={toast.actor?.avatar || initialsAvatar(toast.actor?.name || '')}
                alt=""
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold ${toast.type === 'missed_call' ? 'text-red-600' : 'text-blue-600'}`}>
                  {toast.type === 'missed_call' ? 'Missed call' : toast.type === 'message' ? 'New message' : toast.type === 'announcement' ? 'Announcement' : 'Notification'}
                </p>
                <p className="text-xs text-slate-700 leading-snug break-words">{toast.message}</p>
                {toast.type === 'message' && (
                  <button
                    onClick={() => { setToast(null); onOpenMessenger(); }}
                    className="mt-1.5 text-[11px] font-bold text-blue-600 hover:underline"
                  >
                    {t('open_chat')}
                  </button>
                )}
                {toast.type === 'missed_call' && toast.actor && (
                  <button
                    onClick={() => { const a = toast.actor!; setToast(null); startCall(a.id, a.name, a.avatar, toast.callType || 'audio'); }}
                    className="mt-1.5 text-[11px] font-bold text-emerald-600 hover:underline"
                  >
                    {t('call_back')}
                  </button>
                )}
              </div>
              <button onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none" aria-label="Dismiss">×</button>
            </div>
          )}

          {/* User Profile Menu */}
          <div className="relative">
            <button
              onClick={toggleProfileMenu}
              className="flex items-center gap-1 cursor-pointer"
            >
              <img
                src={user?.avatar || initialsAvatar(user?.name || '')}
                alt={user?.name || 'User'}
                className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-slate-200 transition hover:ring-blue-500 min-[1025px]:h-10 min-[1025px]:w-10"
              />
            </button>

          {showProfileMenu && <>
              <button type="button" onClick={closeProfileMenu} aria-label="Close profile menu" className="fixed inset-0 z-[100] bg-black/45" />
              <div role="dialog" aria-label="Profile menu" onTouchStart={event => { profileTouchStartRef.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={event => { const start = profileTouchStartRef.current; const end = event.changedTouches[0]?.clientY; if (start !== null && end !== undefined && end - start > 90) closeProfileMenu(); profileTouchStartRef.current = null; }} className="fixed bottom-0 left-0 right-0 z-[110] max-h-[75dvh] w-full touch-pan-y overflow-y-auto overscroll-contain rounded-t-[20px] border border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom-3 dark:border-slate-700 dark:bg-[#1a2a3a] min-[769px]:bottom-auto min-[769px]:left-auto min-[769px]:right-4 min-[769px]:top-[calc(env(safe-area-inset-top)+60px)] min-[769px]:max-h-[calc(100dvh-80px)] min-[769px]:w-[360px] min-[769px]:rounded-xl min-[769px]:p-3 min-[769px]:animate-in min-[769px]:fade-in">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 min-[769px]:hidden" />
                <button onClick={closeProfileMenu} aria-label="Close profile menu" className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-white min-[769px]:h-8 min-[769px]:w-8"><X size={18} /></button>
                {/* User card shortcut */}
                <button type="button"
                  onClick={() => {
                    if (user) onNavigate('profile', user.id);
                    closeProfileMenu();
                  }}
                  className="mb-3 flex min-h-16 w-full items-center gap-3 rounded-xl bg-slate-50 p-3 pr-12 text-left transition hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <img src={user?.avatar || initialsAvatar(user?.name || '')} alt={user?.name} className="h-12 w-12 shrink-0 rounded-full object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-bold text-slate-900 dark:text-white">{user?.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-300">{t('see_profile')}</p>
                  </div>
                </button>

                <div className="mb-3 rounded-xl border border-slate-100 p-2 dark:border-slate-600">
                  <p className="px-2 pb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Switch identity</p>
                  <button onClick={() => { switchIdentity(null); closeProfileMenu(); }} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-[15px] text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-white/10"><img src={user?.avatar || initialsAvatar(user?.name || '')} className="h-8 w-8 rounded-full object-cover" />{user?.name} · Personal</button>
                  {myPages.map(page => <button key={page.id} onClick={() => { switchIdentity(page); closeProfileMenu(); }} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-[15px] text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-white/10"><img src={page.avatar || '/logo-192.png'} className="h-8 w-8 rounded-full object-cover" />{page.name}</button>)}
                  <button onClick={() => { onNavigate('pages'); closeProfileMenu(); }} className="flex min-h-12 w-full items-center rounded-lg px-2 text-left text-[15px] font-semibold text-blue-700 hover:bg-slate-50 dark:text-blue-300 dark:hover:bg-white/10">+ Create or manage Pages</button>
                  {activePage && <p className="px-2 pt-1 text-[10px] text-blue-700">Currently using {activePage.name}</p>}
                </div>

                {([
                  ['pages', 'Pages', Flag],
                  ['groups', 'Groups', UsersRound],
                  ['events', 'Events', CalendarDays],
                  ['dashboard', 'Dashboard', BarChart3],
                  ['saved', 'Saved Posts', Bookmark]
                ] as const).map(([view, label, Icon]) => (
                  <button
                    key={view}
                    onClick={() => {
                      onNavigate(view);
                      closeProfileMenu();
                    }}
                    className={`flex h-12 w-full items-center gap-4 rounded-lg px-4 text-left text-base font-semibold transition hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10 ${currentView === view ? 'bg-slate-100 dark:bg-white/10' : ''}`}
                  >
                    <Icon size={22} className="shrink-0 text-slate-500 dark:text-slate-300" />
                    {label}
                  </button>
                ))}

                <button type="button" onClick={() => setSettingsExpanded(value => !value)} aria-expanded={settingsExpanded} className={`flex h-12 w-full items-center gap-4 rounded-lg px-4 text-left text-base font-semibold transition hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10 ${currentView === 'settings' ? 'bg-slate-100 dark:bg-white/10' : ''}`}>
                  <Settings2 size={22} className="shrink-0 text-slate-500 dark:text-slate-300" />Settings &amp; Privacy<ChevronRight size={18} className={`ml-auto transition-transform ${settingsExpanded ? 'rotate-90' : ''}`} />
                </button>
                {settingsExpanded && <div className="mb-1 ml-8 space-y-1 border-l border-slate-200 pl-2 dark:border-slate-600">
                  <button onClick={() => { onNavigate('settings'); closeProfileMenu(); }} className="flex h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10">Settings</button>
                  <button onClick={() => { onNavigate('settings'); closeProfileMenu(); }} className="flex h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10">Privacy Checkup</button>
                  <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10">Dark Mode: {theme === 'dark' ? 'On' : 'Off'}</button>
                  <label className="flex h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 dark:text-slate-100">Language<select aria-label="Language" value={language} onChange={event => setLanguage(event.target.value as LanguageName)} className="max-w-36 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800">{(Object.keys(LANGUAGES) as LanguageName[]).map(name => <option key={name} value={name}>{LANGUAGES[name].label}</option>)}</select></label>
                  <button onClick={() => { logout(); closeProfileMenu(); }} className="flex h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">Logout</button>
                </div>}

                <button type="button" onClick={() => setShowHelpInfo(value => !value)} aria-expanded={showHelpInfo} className="flex h-12 w-full items-center gap-4 rounded-lg px-4 text-left text-base font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10"><MessageCircle size={22} className="shrink-0 text-slate-500 dark:text-slate-300" />Help &amp; Support</button>
                {showHelpInfo && <p className="mx-4 mb-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-200">For help with your account, contact your EChat administrator.</p>}

                {canInstall && (
                  <button
                    onClick={async () => {
                      closeProfileMenu();
                      const result = await install();
                      if (result === 'ios') setShowIosHelp(true);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 rounded-xl text-xs font-semibold text-blue-700 flex items-center gap-2.5 transition"
                  >
                    <Download size={16} />
                    {t('install_app')}
                  </button>
                )}

                {isDeveloper && (
                  <button
                    onClick={() => {
                      onNavigate('admin');
                      closeProfileMenu();
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-2.5 transition"
                  >
                    <Shield size={16} className="text-purple-600" />
                    {t('developer_admin')}
                  </button>
                )}

                <button
                  onClick={() => {
                    logout();
                    closeProfileMenu();
                  }}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-red-50 rounded-xl text-xs font-semibold text-red-600 flex items-center gap-2.5 transition border-t border-slate-100 mt-1"
                >
                  <LogOut size={16} />
                  {t('log_out')}
                </button>
              </div>
            </>}
          </div>
        </div>
      </div>
    </header>
  );
};
