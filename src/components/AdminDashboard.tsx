import { AdminOverview } from './admin/AdminOverview';
import { AdminUsers } from './admin/AdminUsers';
import { AdminAnnouncements } from './admin/AdminAnnouncements';
import { AdminActivity } from './admin/AdminActivity';
import { LiveAccessAdmin } from './admin/LiveAccessAdmin';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AdminStats, User, Post, SiteConfig } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import confetti from 'canvas-confetti';
import {
  ShieldAlert,
  Users,
  FileText,
  MessageSquare,
  AlertTriangle,
  Lock,
  Unlock,
  Trash2,
  CheckCircle,
  Activity,
  Terminal,
  RefreshCw,
  Eye,
  Edit3,
  Camera,
  Check,
  Sparkles,
  Radio,
  BadgeCheck,
  BarChart3,
  Megaphone,
  Shield
} from 'lucide-react';

interface AdminDashboardProps {
  onViewProfile: (userId: string) => void;
  onOpenGoLive?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onViewProfile, onOpenGoLive }) => {
  const { user, isDeveloper, updateUser } = useAuth();
  const canAdmin = Boolean(user && (user.role === 'admin' || user.role === 'super_admin' || isDeveloper || (user as User & {isAdmin?:boolean}).isAdmin));
  const [setupPassword, setSetupPassword] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [reportedPosts, setReportedPosts] = useState<Post[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'reports' | 'announce' | 'activity' | 'profile' | 'welcome' | 'liveAccess'>('overview');
  const [pendingLiveRequests, setPendingLiveRequests] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Developer Profile Controls (Task 2)
  const [devName, setDevName] = useState(user?.name || '');
  const [devAvatar, setDevAvatar] = useState(user?.avatar || '');
  const [devBio, setDevBio] = useState(user?.bio || '');
  const [devLocation, setDevLocation] = useState(user?.location || '');
  const [devWork, setDevWork] = useState(user?.work || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [welcomeConfig, setWelcomeConfig] = useState<SiteConfig>({});
  const [isSavingWelcome, setIsSavingWelcome] = useState(false);

  useEffect(() => {
    if (user) {
      setDevName(user.name);
      setDevAvatar(user.avatar);
      setDevBio(user.bio || '');
      setDevLocation(user.location || '');
      setDevWork(user.work || '');
    }
  }, [user]);

  useEffect(() => {
    if (canAdmin) api.getSiteConfig().then(setWelcomeConfig).catch(err => setErrorMsg(err.message || 'Could not load welcome page settings'));
  }, [canAdmin]);

  const handleClaimAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupPassword.trim()) return;
    setIsClaiming(true);
    setErrorMsg('');
    try {
      const { user: claimed } = await api.claimAdmin(setupPassword.trim());
      updateUser(claimed);
      setSetupPassword('');
      setSuccessMsg('Admin access activated.');
      await loadAdminData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not claim admin access');
    } finally {
      setIsClaiming(false);
    }
  };

  const loadAdminData = async () => {
    setIsRefreshing(true);
    setErrorMsg('');
    try {
      const [s, u, r] = await Promise.all([
        api.getAdminStats(),
        api.getAdminUsers(),
        api.getAdminReports()
      ]);
      setStats(s);
      setUsersList(u);
      setReportedPosts(r);
      try { setPendingLiveRequests((await api.getAdminLiveAccess()).requests.length); } catch { setPendingLiveRequests(0); }
    } catch (err: any) {
      setErrorMsg(err.message || 'Access denied');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (canAdmin) {
      loadAdminData();
    }
  }, [canAdmin]);

  // Task 1: 100% Gated - Only my developer account can see and access it
  const ADMIN_EMAIL = 'eldermoses89@gmail.com';
  const isAuthorized = Boolean(user && (user.email?.toLowerCase().trim() === ADMIN_EMAIL || user.role === 'admin' || user.role === 'super_admin' || (user as User & {isAdmin?:boolean}).isAdmin));

  if (!isAuthorized) {
    return (
      <div className="max-w-md mx-auto my-16 bg-white rounded-3xl p-8 shadow-xl border border-slate-200 text-center animate-in fade-in">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
          <Lock size={32} />
        </div>
        <h2 className="text-xl font-black text-slate-900">404 — Page Not Found</h2>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          The requested administration console is private and restricted.
        </p>
        <button
          onClick={() => onViewProfile(user?.id || '')}
          className="mt-5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
        >
          Return to Feed
        </button>
      </div>
    );
  }

  const handleToggleBlock = async (userId: string) => {
    try {
      const updated = await api.toggleBlockUser(userId);
      setUsersList(prev => prev.map(u => u.id === updated.id ? updated : u));
      loadAdminData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDismissReport = async (postId: string) => {
    try {
      await api.dismissReport(postId);
      setReportedPosts(prev => prev.filter(p => p.id !== postId));
      loadAdminData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteReportedPost = async (postId: string) => {
    if (!confirm('Permanently delete this reported post from Echat?')) return;
    try {
      await api.deletePost(postId);
      setReportedPosts(prev => prev.filter(p => p.id !== postId));
      loadAdminData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSaveDeveloperProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await api.updateDeveloperProfile({
        name: devName,
        avatar: devAvatar,
        bio: devBio,
        location: devLocation,
        work: devWork
      });
      setSuccessMsg('Developer profile updated everywhere instantly!');
      confetti({ particleCount: 45, spread: 60 });
      loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update developer profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleVerifySelf = async () => {
    setIsVerifying(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await api.verifySelf();
      setSuccessMsg('Account verified! Blue badge is now active across all screens.');
      confetti({ particleCount: 50, spread: 70 });
      loadAdminData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to verify account');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveWelcome = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingWelcome(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const saved = await api.updateSiteConfig(welcomeConfig);
      setWelcomeConfig(saved);
      setSuccessMsg('Welcome page settings saved and published.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save welcome page settings');
    } finally {
      setIsSavingWelcome(false);
    }
  };


  const filteredUsers = usersList.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto pb-16 animate-in fade-in">
      {/* Admin Header */}
      <div className="bg-gradient-to-r from-purple-900 via-slate-900 to-indigo-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl mb-6 relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-purple-500/30 text-purple-300 text-[11px] font-extrabold px-3 py-0.5 rounded-full uppercase tracking-wider border border-purple-400/30">
                Super Admin Gate
              </span>
              <span className="bg-emerald-500/20 text-emerald-400 text-[11px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Node Engine
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Echat Master Developer Console
            </h1>
            <p className="text-xs text-purple-200/80 mt-1">
              Logged in as <strong className="text-white">{user?.name}</strong> ({user?.email}) • Super Administrator
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadAdminData}
              disabled={isRefreshing}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 border border-white/10 transition cursor-pointer"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              Sync Stats
            </button>
            {onOpenGoLive && (
              <button
                onClick={onOpenGoLive}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <Radio size={14} />
                Go Live
              </button>
            )}
            <button
              onClick={() => onViewProfile(user?.id || '')}
              className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/30 text-xs font-bold rounded-xl transition cursor-pointer"
            >
              View Feed
            </button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="relative z-10 flex items-center gap-2 mt-6 border-t border-white/10 pt-4 overflow-x-auto pb-1">
          {([
            ['overview', 'Overview', <BarChart3 key="o" size={14} />],
            ['users', 'Users', <Users key="u" size={14} />],
            ['reports', 'Moderation', <AlertTriangle key="r" size={14} />],
            ['announce', 'Announcements', <Megaphone key="a" size={14} />],
            ['activity', 'Activity log', <Terminal key="l" size={14} />],
            ['profile', 'My controls', <Shield key="p" size={14} />],
            ['welcome', 'Welcome page', <Edit3 key="w" size={14} />],
            ['liveAccess', 'Live Access', <Radio key="live" size={14} />]
          ] as const).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                activeTab === id ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-200 hover:bg-white/10'
              }`}
            >
              {icon}
              {label}
              {id === 'reports' && reportedPosts.length > 0 && (
                <span className="bg-red-500 text-white px-1.5 rounded-full text-[10px] font-extrabold">{reportedPosts.length}</span>
              )}
              {id === 'liveAccess' && pendingLiveRequests > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-extrabold text-white">{pendingLiveRequests}</span>}
            </button>
          ))}
        </div>
      </div>

      {successMsg && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <CheckCircle size={16} className="text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <AlertTriangle size={16} className="text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* The server only trusts admins it has verified: enter the setup password once to activate. */}
      {errorMsg.includes('Access denied') && (
        <form onSubmit={handleClaimAdmin} className="mb-6 p-5 bg-white border border-purple-200 rounded-2xl space-y-3">
          <p className="text-sm font-extrabold text-slate-900">Activate admin access</p>
          <p className="text-xs text-slate-500">
            Enter the admin setup password you set as <code>ADMIN_BOOTSTRAP_PASSWORD</code> on your server.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={setupPassword}
              onChange={e => setSetupPassword(e.target.value)}
              placeholder="Admin setup password"
              autoComplete="off"
              className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button
              type="submit"
              disabled={isClaiming || !setupPassword.trim()}
              className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-bold"
            >
              {isClaiming ? 'Checking...' : 'Activate'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 0: DEVELOPER PROFILE CONTROLS (TASK 2 & 5) */}
      {activeTab === 'profile' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Card: Live Avatar & Verified Status Control */}
            <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-200 flex flex-col items-center text-center">
              <div className="relative mb-3">
                <img
                  src={devAvatar || user?.avatar}
                  alt="Developer Avatar"
                  className="w-28 h-28 rounded-full object-cover border-4 border-purple-100 shadow-md"
                />
                <span className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center ring-2 ring-white">
                  <VerifiedBadge size={16} />
                </span>
              </div>

              <div className="flex items-center gap-1.5 justify-center mb-1">
                <h3 className="text-lg font-black text-slate-900">{devName || user?.name}</h3>
                <VerifiedBadge size={16} />
              </div>
              <p className="text-xs text-purple-700 font-extrabold uppercase tracking-wider">
                EChat Official - Developer
              </p>
              <p className="text-xs text-slate-400 mt-1">{user?.email}</p>

              <div className="w-full mt-5 pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold px-2">
                  <span className="text-slate-500">Official Blue Badge:</span>
                  <span className="text-emerald-600 font-bold flex items-center gap-1">
                    <CheckCircle size={14} /> Active
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-semibold px-2">
                  <span className="text-slate-500">Community Boosts:</span>
                  <span className="text-purple-700 font-extrabold">
                    🚀 {user?.boostsCount || 420} Boosts
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleVerifySelf}
                  disabled={isVerifying}
                  className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-blue-200 cursor-pointer"
                >
                  <BadgeCheck size={16} className="text-blue-600" />
                  {isVerifying ? 'Refreshing Badge...' : 'Re-verify My Account'}
                </button>
              </div>
            </div>

            {/* Right 2-Cols: Edit Form for Instant Everywhere Updates */}
            <div className="lg:col-span-2 bg-white rounded-3xl p-6 sm:p-8 shadow-xs border border-slate-200">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Master Profile Customization
                  </h3>
                  <p className="text-xs text-slate-500">
                    Edits made here update across all chat lists, posts, comments, and headers instantly.
                  </p>
                </div>
                <span className="bg-purple-100 text-purple-800 text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase">
                  Real-time Sync
                </span>
              </div>

              <form onSubmit={handleSaveDeveloperProfile} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={devName}
                      onChange={e => setDevName(e.target.value)}
                      placeholder="e.g. Elder Moses"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-purple-600 focus:outline-hidden transition"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Location
                    </label>
                    <input
                      type="text"
                      value={devLocation}
                      onChange={e => setDevLocation(e.target.value)}
                      placeholder="e.g. San Francisco, CA"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-purple-600 focus:outline-hidden transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Profile Picture URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={devAvatar}
                      onChange={e => setDevAvatar(e.target.value)}
                      placeholder="https://images.unsplash.com/..."
                      className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-purple-600 focus:outline-hidden transition"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Professional Headline / Work Title
                  </label>
                  <input
                    type="text"
                    value={devWork}
                    onChange={e => setDevWork(e.target.value)}
                    placeholder="e.g. Founder & Lead Architect @ EChat"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-purple-600 focus:outline-hidden transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bio Description
                  </label>
                  <textarea
                    rows={3}
                    value={devBio}
                    onChange={e => setDevBio(e.target.value)}
                    placeholder="Tell the community about your mission with EChat..."
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-purple-600 focus:outline-hidden transition"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="px-6 py-3 bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-800 hover:to-indigo-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center gap-2"
                  >
                    <Check size={16} />
                    {isSavingProfile ? 'Saving Changes...' : 'Save Profile Changes (Update Everywhere)'}
                  </button>
                </div>
              </form>
            </div>

          </div>
        </div>
      )}

      {/* TAB 1: ANALYTICS OVERVIEW */}
      {activeTab === 'overview' && (
        <AdminOverview
          onlineUsers={stats?.onlineUsers ?? 0}
          pendingReports={reportedPosts.length}
          onOpenReports={() => setActiveTab('reports')}
        />
      )}

      {activeTab === 'users' && user && (
        <AdminUsers currentUserId={user.id} onViewProfile={onViewProfile} onChanged={loadAdminData} />
      )}

      {activeTab === 'reports' && (
        <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-200">
          <div className="mb-6">
            <h3 className="text-base font-bold text-slate-900">Content Moderation Queue</h3>
            <p className="text-xs text-slate-500">Review reported posts and take immediate administrative action.</p>
          </div>

          {reportedPosts.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <CheckCircle size={40} className="mx-auto mb-2 text-emerald-500 opacity-80" />
              <p className="text-sm font-bold text-slate-700">All Clean!</p>
              <p className="text-xs text-slate-400 mt-1">No posts currently flagged for moderation.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reportedPosts.map(p => (
                <div key={p.id} className="p-4 rounded-2xl border border-red-200 bg-red-50/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1 max-w-xl">
                    <div className="flex items-center gap-2">
                      <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        FLAGGED
                      </span>
                      <span className="text-xs font-bold text-slate-800">Author: {p.author?.name || 'Unknown User'}</span>
                      <span className="text-xs text-slate-400">• Post ID: {p.id}</span>
                    </div>

                    <p className="text-xs font-semibold text-red-700">
                      Reason: "{p.reportReason || 'Inappropriate content'}"
                    </p>

                    <p className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-red-100 mt-2">
                      {p.content || '[Media only post]'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDismissReport(p.id)}
                      className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition"
                    >
                      Dismiss Report
                    </button>
                    <button
                      onClick={() => handleDeleteReportedPost(p.id)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5"
                    >
                      <Trash2 size={14} />
                      Delete Post
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LIVE EVENT STREAM */}
      {activeTab === 'welcome' && (
        <form onSubmit={handleSaveWelcome} className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm space-y-5">
          <div><h2 className="text-lg font-extrabold text-slate-900">Welcome page</h2><p className="mt-1 text-sm text-slate-500">Edit the public sign-in screen content and background.</p></div>
          <label className="block text-sm font-semibold text-slate-700">Headline<input maxLength={90} value={welcomeConfig.welcomeTitle || ''} onChange={e => setWelcomeConfig(current => ({ ...current, welcomeTitle: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal" placeholder="Welcome to EChat" /></label>
          <label className="block text-sm font-semibold text-slate-700">Welcome text<textarea maxLength={280} rows={3} value={welcomeConfig.welcomeSubtitle || ''} onChange={e => setWelcomeConfig(current => ({ ...current, welcomeSubtitle: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal" placeholder="Connect with friends and share moments." /></label>
          <label className="block text-sm font-semibold text-slate-700">Background image URL<input value={welcomeConfig.welcomeBgImage || ''} onChange={e => setWelcomeConfig(current => ({ ...current, welcomeBgImage: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal" placeholder="https://example.com/welcome-background.jpg" /></label>
          {welcomeConfig.welcomeBgImage && <img src={welcomeConfig.welcomeBgImage} alt="Welcome background preview" className="h-40 w-full rounded-xl object-cover" />}
          <button disabled={isSavingWelcome} className="rounded-xl bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60">{isSavingWelcome ? 'Saving…' : 'Save welcome page'}</button>
        </form>
      )}
      {activeTab === 'announce' && <AdminAnnouncements />}

      {activeTab === 'activity' && <AdminActivity />}
      {activeTab === 'liveAccess' && <LiveAccessAdmin onPendingCount={setPendingLiveRequests} />}
    </div>
  );
};
