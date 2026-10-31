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
  Heart,
  MessageCircle,
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
} from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';

export type AppView = 'feed' | 'friends' | 'admin' | 'profile' | 'pages' | 'groups' | 'events' | 'settings';

interface NavbarProps {
  currentView: AppView;
  onNavigate: (view: AppView, targetProfileId?: string, targetPostId?: string) => void;
  onOpenMessenger: () => void;
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
  onOpenMessenger
}) => {
  const { user, isDeveloper, logout } = useAuth();
  const { onlineUserIds } = useSocket();

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Global Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ users: User[]; posts: Post[] }>({ users: [], posts: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'people' | 'posts' | 'pages'>('all');
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
      action: () => onNavigate('feed'),
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
      // 1. Try Firestore direct
      const firestoreNotifs = await getFirestoreNotifications(user.id);
      if (firestoreNotifs && firestoreNotifs.length > 0) {
        setNotifications(firestoreNotifs);
        return;
      }
      // 2. Fallback to API if any
      const list = await api.getNotifications().catch(() => []);
      setNotifications(list || []);
    } catch (err) {
      console.warn('Failed to load notifications:', err);
    }
  };

  useEffect(() => {
    if (user?.id) {
      loadNotifications();
    } else {
      setNotifications([]);
    }
  }, [user?.id]);

  const handleMarkNotificationsRead = async () => {
    if (user?.id) {
      markFirestoreNotificationsRead(user.id).catch(() => {});
    }
    await api.markNotificationsRead().catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
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

  const unreadNotificationsCount = notifications.filter(n => !n.read).length;

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200/90 shadow-2xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
        
        {/* Left: Brand Logo & Global Search Bar */}
        <div className="flex items-center gap-2.5 flex-1 max-w-md sm:max-w-lg lg:max-w-xl">
          <div
            onClick={() => onNavigate('feed')}
            className="flex items-center gap-2 cursor-pointer group flex-shrink-0"
          >
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md group-hover:scale-105 transition">
              <MessageSquare size={22} />
            </div>
            <span className="text-2xl font-black text-blue-600 tracking-tight hidden sm:inline">
              Echat
            </span>
          </div>

          {/* Global Search Bar */}
          <div ref={searchContainerRef} className="relative flex-1">
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
                placeholder="Search friends, posts, pages..."
                className="w-full pl-9 pr-16 py-1.5 bg-slate-100 hover:bg-slate-100/80 focus:bg-white text-xs sm:text-sm rounded-full border border-transparent focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition shadow-inner placeholder-slate-400"
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
              <div className="absolute top-11 left-0 right-0 sm:-right-16 md:-right-24 bg-white rounded-2xl shadow-2xl border border-slate-200/90 py-2.5 z-50 max-h-[82vh] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
                
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
                      Posts ({searchResults.posts.length})
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
                    {(activeTab === 'all' || activeTab === 'posts') && searchResults.posts.length > 0 && (
                      <div>
                        <div className="px-2.5 py-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <FileText size={12} className="text-amber-600" />
                            Posts ({searchResults.posts.length})
                          </span>
                        </div>
                        <div className="mt-1 space-y-1.5">
                          {searchResults.posts.map(post => (
                            <div
                              key={post.id}
                              onClick={() => handleSelectPost(post)}
                              className="px-3 py-2.5 hover:bg-blue-50/60 rounded-xl cursor-pointer transition border border-transparent hover:border-blue-100 group"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <img
                                    src={post.author?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
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

        <div className="flex items-center gap-1 sm:gap-2 h-full">
          <button
            onClick={() => onNavigate('feed')}
            className={`h-full px-4 sm:px-8 border-b-3 flex items-center justify-center transition cursor-pointer ${
              currentView === 'feed'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
            title="Home News Feed"
          >
            <Home size={22} strokeWidth={currentView === 'feed' ? 2.5 : 2} />
          </button>

          <button
            onClick={() => onNavigate('friends')}
            className={`h-full px-4 sm:px-8 border-b-3 flex items-center justify-center transition cursor-pointer relative ${
              currentView === 'friends'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
            title="Friends & Requests"
          >
            <Users size={22} strokeWidth={currentView === 'friends' ? 2.5 : 2} />
            {user && user.friendRequestsReceived.length > 0 && (
              <span className="absolute top-2 right-4 sm:right-6 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
                {user.friendRequestsReceived.length}
              </span>
            )}
          </button>

          {isDeveloper && (
            <button
              onClick={() => onNavigate('admin')}
              className={`h-full px-4 sm:px-8 border-b-3 flex items-center justify-center transition cursor-pointer ${
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
        <div className="flex items-center gap-1.5 sm:gap-2">

          {/* Messenger Icon */}
          <button
            onClick={onOpenMessenger}
            className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition relative cursor-pointer"
            title="Open Messenger"
          >
            <MessageSquare size={19} />
            <span className="absolute bottom-1 right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
          </button>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              onClick={() => {
                setShowNotifications(!showNotifications);
                if (!showNotifications) handleMarkNotificationsRead();
              }}
              className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition relative cursor-pointer"
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
                  <h3 className="font-bold text-slate-900 text-sm">Notifications</h3>
                  <button
                    onClick={handleMarkNotificationsRead}
                    className="text-xs text-blue-600 hover:underline font-semibold"
                  >
                    Mark all read
                  </button>
                </div>

                <div className="divide-y divide-slate-50">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map(n => (
                      <div
                        key={n.id}
                        className={`p-3.5 flex items-start gap-3 hover:bg-slate-50 transition cursor-pointer ${
                          !n.read ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        <img
                          src={n.actor?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
                          alt="actor"
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-800 leading-snug">
                            {n.message}
                          </p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile Menu */}
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-1 cursor-pointer"
            >
              <img
                src={user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'}
                alt={user?.name || 'User'}
                className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-200 hover:ring-blue-500 transition"
              />
            </button>

            {showProfileMenu && (
              <div className="absolute right-0 top-12 w-64 bg-white rounded-3xl shadow-2xl border border-slate-100 p-2 z-40 animate-in fade-in">
                {/* User card shortcut */}
                <div
                  onClick={() => {
                    if (user) onNavigate('profile', user.id);
                    setShowProfileMenu(false);
                  }}
                  className="p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl flex items-center gap-3 cursor-pointer transition mb-2"
                >
                  <img src={user?.avatar} alt={user?.name} className="w-11 h-11 rounded-full object-cover" />
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 text-sm truncate">{user?.name}</p>
                    <p className="text-xs text-slate-500">See your profile</p>
                  </div>
                </div>

                {isDeveloper && (
                  <button
                    onClick={() => {
                      onNavigate('admin');
                      setShowProfileMenu(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-2.5 transition"
                  >
                    <Shield size={16} className="text-purple-600" />
                    Developer Mode & Admin
                  </button>
                )}

                <button
                  onClick={() => {
                    logout();
                    setShowProfileMenu(false);
                  }}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-red-50 rounded-xl text-xs font-semibold text-red-600 flex items-center gap-2.5 transition border-t border-slate-100 mt-1"
                >
                  <LogOut size={16} />
                  Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
