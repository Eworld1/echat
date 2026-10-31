import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { TermsModal } from './TermsModal';
import {
  Users,
  MessageSquare,
  Shield,
  Bookmark,
  Sparkles,
  Compass,
  Video,
  Clock,
  Settings,
  FileText,
  Flag,
  Users2,
  Calendar
} from 'lucide-react';

interface LeftSidebarProps {
  currentView: string;
  onNavigate: (view: 'feed' | 'friends' | 'admin' | 'profile' | 'pages' | 'groups' | 'events' | 'settings', targetProfileId?: string) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ currentView, onNavigate }) => {
  const { user, isDeveloper } = useAuth();
  const [showTerms, setShowTerms] = useState(false);

  if (!user) return null;

  return (
    <aside className="w-64 xl:w-72 flex-shrink-0 hidden lg:block sticky top-18 h-[calc(100vh-5rem)] overflow-y-auto pr-2 select-none">
      <div className="space-y-1">
        {/* Profile Shortcut */}
        <button
          onClick={() => onNavigate('profile', user.id)}
          className="w-full p-2.5 hover:bg-slate-200/60 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left group"
        >
          <img
            src={user.avatar}
            alt={user.name}
            className="w-9 h-9 rounded-full object-cover border border-slate-200"
          />
          <span className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition truncate">
            {user.name}
          </span>
        </button>

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
          <span className="truncate">News Feed</span>
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
          <span className="flex-1 truncate">Friends & Requests</span>
          {user.friendRequestsReceived.length > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {user.friendRequestsReceived.length}
            </span>
          )}
        </button>

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
          <span className="flex-1 truncate">Pages</span>
        </button>

        {/* Groups */}
        <button
          onClick={() => onNavigate('groups')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
            currentView === 'groups' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <Users2 size={20} />
          </div>
          <span className="flex-1 truncate">Groups</span>
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
          <span className="flex-1 truncate">Events</span>
        </button>

        {/* Settings & Privacy */}
        <button
          onClick={() => onNavigate('settings')}
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
            currentView === 'settings' ? 'bg-slate-200 text-slate-900 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center">
            <Settings size={20} />
          </div>
          <span className="flex-1 truncate">Settings & Privacy</span>
        </button>

        {/* Developer Admin (Only visible to Super Admin) */}
        {isDeveloper && (
          <button
            onClick={() => onNavigate('admin')}
            className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${
              currentView === 'admin' ? 'bg-purple-50 text-purple-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
            }`}
          >
            <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center">
              <Shield size={20} />
            </div>
            <span className="flex-1 truncate">Developer Mode</span>
            <span className="bg-purple-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase">
              Admin
            </span>
          </button>
        )}

        {/* Saved */}
        <div className="w-full p-2.5 hover:bg-slate-200/60 rounded-2xl flex items-center gap-3 transition text-slate-600 font-semibold text-sm cursor-pointer">
          <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
            <Bookmark size={20} />
          </div>
          <span>Saved Posts</span>
        </div>

        {/* Memories */}
        <div className="w-full p-2.5 hover:bg-slate-200/60 rounded-2xl flex items-center gap-3 transition text-slate-600 font-semibold text-sm cursor-pointer">
          <div className="w-9 h-9 rounded-full bg-cyan-100 text-cyan-600 flex items-center justify-center">
            <Clock size={20} />
          </div>
          <span>Memories</span>
        </div>
      </div>

      {/* Shortcuts divider */}
      <div className="mt-4 pt-4 border-t border-slate-200/80">
        <h4 className="px-3 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
          Your Shortcuts
        </h4>

        <div className="space-y-1">
          <div className="p-2 hover:bg-slate-200/60 rounded-xl flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700">
            <span className="w-6 h-6 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold">
              🚀
            </span>
            <span className="truncate">React & TypeScript Engineers</span>
          </div>

          <div className="p-2 hover:bg-slate-200/60 rounded-xl flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700">
            <span className="w-6 h-6 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold">
              🎨
            </span>
            <span className="truncate">Modern UI/UX Design System</span>
          </div>

          <div className="p-2 hover:bg-slate-200/60 rounded-xl flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700">
            <span className="w-6 h-6 rounded-lg bg-purple-500 text-white flex items-center justify-center font-bold">
              ⚡
            </span>
            <span className="truncate">WebRTC & Real-time Sockets</span>
          </div>
        </div>
      </div>

      <div className="mt-8 px-3 text-[11px] text-slate-400 space-y-1">
        <p>© 2026 Echat by Google AI Studio</p>
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <span>Privacy</span>
          <span>•</span>
          <button
            onClick={() => setShowTerms(true)}
            className="hover:underline hover:text-blue-600 font-semibold cursor-pointer text-slate-500"
          >
            Terms & Conditions
          </button>
          <span>•</span>
          <span>Cookies</span>
        </div>
      </div>

      <TermsModal isOpen={showTerms} onClose={() => setShowTerms(false)} />
    </aside>
  );
};
