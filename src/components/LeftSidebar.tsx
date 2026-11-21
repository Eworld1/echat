import { usePreferences } from '../context/PreferencesContext';
import type { AppView } from './Navbar';
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
  , Film, BarChart3, ChevronDown, Plus, X
} from 'lucide-react';

interface LeftSidebarProps {
  currentView: string;
  onNavigate: (view: AppView, targetProfileId?: string) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ currentView, onNavigate }) => {
  const { user, isDeveloper, myPages, activePage, switchIdentity, createIdentityPage } = useAuth();
  const { t } = usePreferences();
  const [showTerms, setShowTerms] = useState(false);
  const [showIdentityPicker, setShowIdentityPicker] = useState(false);
  const [showPageForm, setShowPageForm] = useState(false);
  const [pageForm, setPageForm] = useState({ name: '', category: 'Business', bio: '', avatar: '', cover: '' });
  const [pageError, setPageError] = useState('');
  const [isCreatingPage, setIsCreatingPage] = useState(false);

  if (!user) return null;

  return (
    <aside className="w-64 xl:w-72 flex-shrink-0 hidden lg:block sticky top-18 h-[calc(100vh-5rem)] overflow-y-auto pr-2 select-none">
      <div className="space-y-1">
        {/* Profile Shortcut */}
        <div className="relative">
          <button onClick={() => setShowIdentityPicker(value => !value)} className="w-full p-2.5 hover:bg-slate-200/60 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left group">
            <img src={activePage?.avatar || user.avatar} alt={activePage?.name || user.name} className="w-9 h-9 rounded-full object-cover border border-slate-200" />
            <span className="flex-1 truncate text-sm font-bold text-slate-900 group-hover:text-blue-600">{activePage?.name || user.name}</span><ChevronDown size={15} />
          </button>
          {showIdentityPicker && <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            <button onClick={() => { switchIdentity(null); setShowIdentityPicker(false); }} className="flex w-full items-center gap-2 rounded-xl p-2 text-left text-xs font-semibold hover:bg-slate-100"><img src={user.avatar} className="h-8 w-8 rounded-full object-cover" />My Personal Profile</button>
            {myPages.map(page => <button key={page.id} onClick={() => { switchIdentity(page); setShowIdentityPicker(false); }} className="flex w-full items-center gap-2 rounded-xl p-2 text-left text-xs font-semibold hover:bg-slate-100"><img src={page.avatar || user.avatar} className="h-8 w-8 rounded-full object-cover" />{page.name}</button>)}
            <button onClick={() => { setShowPageForm(true); setShowIdentityPicker(false); }} className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-slate-100 p-2 pt-3 text-left text-xs font-bold text-blue-700"><Plus size={16} />Create New Page</button>
          </div>}
        </div>
        {activePage && <div className="mx-2 mb-2 rounded-xl bg-blue-50 px-3 py-2 text-[11px] text-blue-800">You are posting as <b>{activePage.name}</b> <button onClick={() => switchIdentity(null)} className="ml-1 underline">Switch back</button></div>}

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
          className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${currentView === 'reels' ? 'bg-fuchsia-50 text-fuchsia-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'}`}
        >
          <div className="w-9 h-9 rounded-full bg-fuchsia-100 text-fuchsia-600 flex items-center justify-center"><Film size={19} /></div>
          <span className="truncate">Reels</span>
        </button>

        <button onClick={() => onNavigate('dashboard')} className={`w-full p-2.5 rounded-2xl flex items-center gap-3 transition cursor-pointer text-left ${currentView === 'dashboard' ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'}`}>
          <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center"><BarChart3 size={19} /></div>
          <span className="truncate">Dashboard</span>
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
            currentView === 'groups' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'hover:bg-slate-200/60 text-slate-700 font-semibold text-sm'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
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
          <span className="flex-1 truncate">{t('settings_privacy')}</span>
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
        <button
          onClick={() => onNavigate('saved')}
          className={`w-full p-2.5 hover:bg-slate-200/60 rounded-2xl flex items-center gap-3 transition text-left font-semibold text-sm ${currentView === 'saved' ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}`}
        >
          <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
            <Bookmark size={20} />
          </div>
          <span>{t('saved_posts')}</span>
        </button>

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
          {t('your_shortcuts')}
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
      {showPageForm && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4"><form onSubmit={async event => { event.preventDefault(); setIsCreatingPage(true); setPageError(''); try { await createIdentityPage({ ...pageForm, cover: pageForm.cover }); setShowPageForm(false); setPageForm({ name: '', category: 'Business', bio: '', avatar: '', cover: '' }); } catch (error) { setPageError(error instanceof Error ? error.message : 'Could not create page'); } finally { setIsCreatingPage(false); } }} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="font-bold">Create a Page</h2><button type="button" onClick={() => setShowPageForm(false)}><X size={18} /></button></div>
        <input required minLength={2} maxLength={80} placeholder="Page name" value={pageForm.name} onChange={event => setPageForm({ ...pageForm, name: event.target.value })} className="w-full rounded-xl border p-3 text-sm" />
        <select value={pageForm.category} onChange={event => setPageForm({ ...pageForm, category: event.target.value })} className="w-full rounded-xl border p-3 text-sm"><option>Business</option><option>Creator</option><option>Community</option><option>Education</option><option>Entertainment</option><option>Other</option></select>
        <textarea placeholder="Bio" maxLength={500} value={pageForm.bio} onChange={event => setPageForm({ ...pageForm, bio: event.target.value })} className="w-full rounded-xl border p-3 text-sm" />
        <input placeholder="Profile picture URL (optional)" value={pageForm.avatar} onChange={event => setPageForm({ ...pageForm, avatar: event.target.value })} className="w-full rounded-xl border p-3 text-sm" />
        <input placeholder="Cover picture URL (optional)" value={pageForm.cover} onChange={event => setPageForm({ ...pageForm, cover: event.target.value })} className="w-full rounded-xl border p-3 text-sm" />
        {pageError && <p className="text-sm text-red-600">{pageError}</p>}<button disabled={isCreatingPage} className="w-full rounded-xl bg-blue-600 p-3 text-sm font-bold text-white disabled:opacity-60">{isCreatingPage ? 'Creating…' : 'Create Page and switch to it'}</button>
      </form></div>}
    </aside>
  );
};
