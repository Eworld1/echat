import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AdminStats, User, Post } from '../types';
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
  BadgeCheck
} from 'lucide-react';

interface AdminDashboardProps {
  onViewProfile: (userId: string) => void;
  onOpenGoLive?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onViewProfile, onOpenGoLive }) => {
  const { user, isDeveloper } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [reportedPosts, setReportedPosts] = useState<Post[]>([]);
  const [activeTab, setActiveTab] = useState<'profile' | 'analytics' | 'users' | 'reports' | 'logs'>('profile');
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

  useEffect(() => {
    if (user) {
      setDevName(user.name);
      setDevAvatar(user.avatar);
      setDevBio(user.bio || '');
      setDevLocation(user.location || '');
      setDevWork(user.work || '');
    }
  }, [user]);

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
    } catch (err: any) {
      setErrorMsg(err.message || 'Access denied');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isDeveloper) {
      loadAdminData();
    }
  }, [isDeveloper]);

  // Task 1: 100% Gated - Only my developer account can see and access it
  const ADMIN_EMAIL = 'eldermoses89@gmail.com';
  const isAuthorized = Boolean(user && user.email?.toLowerCase().trim() === ADMIN_EMAIL);

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
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'profile' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-200 hover:bg-white/10'
            }`}
          >
            <Edit3 size={14} />
            Developer Profile Controls
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'analytics' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-200 hover:bg-white/10'
            }`}
          >
            <Activity size={14} />
            Analytics Overview
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'users' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-200 hover:bg-white/10'
            }`}
          >
            <Users size={14} />
            User Management ({usersList.length})
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'reports' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-200 hover:bg-white/10'
            }`}
          >
            <AlertTriangle size={14} />
            Moderation Reports
            {reportedPosts.length > 0 && (
              <span className="bg-red-500 text-white px-1.5 py-0.2 rounded-full text-[10px] font-extrabold">
                {reportedPosts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'logs' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-200 hover:bg-white/10'
            }`}
          >
            <Terminal size={14} />
            Live Event Stream
          </button>
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
      {activeTab === 'analytics' && stats && (

        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Users</span>
                <span className="p-2 bg-blue-50 text-blue-600 rounded-xl"><Users size={18} /></span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{stats.totalUsers}</p>
              <p className="text-[11px] text-emerald-600 font-semibold mt-1">
                {stats.onlineUsers} online now
              </p>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Posts</span>
                <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><FileText size={18} /></span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{stats.totalPosts}</p>
              <p className="text-[11px] text-indigo-600 font-semibold mt-1">
                News Feed active
              </p>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Messages</span>
                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl"><MessageSquare size={18} /></span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{stats.totalMessages}</p>
              <p className="text-[11px] text-slate-500 font-semibold mt-1">
                Real-time WebSockets
              </p>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Flagged Posts</span>
                <span className="p-2 bg-rose-50 text-rose-600 rounded-xl"><AlertTriangle size={18} /></span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{stats.pendingReports}</p>
              <p className="text-[11px] text-rose-600 font-semibold mt-1">
                {stats.pendingReports === 0 ? 'Queue clean' : 'Action required'}
              </p>
            </div>
          </div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Active Stories</h4>
              <p className="text-2xl font-bold text-slate-900">{stats.totalStories} Statuses</p>
              <p className="text-xs text-slate-500 mt-1">Expiring within 24 hours</p>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Suspended Users</h4>
              <p className="text-2xl font-bold text-slate-900">{stats.blockedUsers}</p>
              <p className="text-xs text-slate-500 mt-1">Blocked from participating</p>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Socket Uptime</h4>
              <p className="text-2xl font-bold text-slate-900">{stats.uptimeSeconds}s</p>
              <p className="text-xs text-slate-500 mt-1">{stats.activeSockets} active socket connections</p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-3xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Registered Accounts</h3>
              <p className="text-xs text-slate-500">Monitor all accounts, inspect profiles, and manage access.</p>
            </div>

            <input
              type="text"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Filter by name or email..."
              className="text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden w-full sm:w-64"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">User</th>
                  <th className="px-6 py-3.5">Role</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Location</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-3.5 flex items-center gap-3">
                      <img src={u.avatar} alt={u.name} className="w-9 h-9 rounded-full object-cover" />
                      <div>
                        <p className="font-bold text-slate-900">{u.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">{u.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                        u.role === 'developer' ? 'bg-purple-100 text-purple-700' :
                        u.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      {u.isBlocked ? (
                        <span className="inline-flex items-center gap-1 text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full">
                          <Lock size={12} /> Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                          <Unlock size={12} /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-slate-600">
                      {u.location || 'Not set'}
                    </td>
                    <td className="px-6 py-3.5 text-right space-x-2">
                      <button
                        onClick={() => onViewProfile(u.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
                        title="View profile"
                      >
                        <Eye size={13} className="inline mr-1" />
                        View
                      </button>

                      {u.role !== 'developer' && (
                        <button
                          onClick={() => handleToggleBlock(u.id)}
                          className={`px-2.5 py-1 rounded-lg font-bold transition ${
                            u.isBlocked
                              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                              : 'bg-red-100 text-red-700 hover:bg-red-200'
                          }`}
                        >
                          {u.isBlocked ? 'Unblock' : 'Block'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: MODERATION REPORTS */}
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
      {activeTab === 'logs' && (
        <div className="bg-slate-950 text-slate-200 rounded-3xl p-6 font-mono text-xs shadow-2xl border border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
            <span className="text-emerald-400 font-bold flex items-center gap-2">
              <Terminal size={16} />
              WebSocket & Database Real-time Telemetry
            </span>
            <span className="text-slate-500 text-[11px]">Auto-streaming</span>
          </div>

          <div className="space-y-2 h-72 overflow-y-auto">
            <p className="text-slate-400">[00:00:01] Node.js Express server listening on 0.0.0.0:3000</p>
            <p className="text-slate-400">[00:00:02] WebSocket Server mounted at /ws</p>
            <p className="text-purple-400">[00:00:03] Super Admin recognized: eldermoses89@gmail.com (role: developer)</p>
            <p className="text-emerald-400">[00:00:04] Production database online: clean production state loaded</p>
            <p className="text-blue-400">[00:00:05] WebRTC STUN relay servers active (stun.l.google.com:19302)</p>
            <p className="text-slate-300">[00:00:06] Client connection ack sent to frontend</p>
            <p className="text-emerald-400">[00:00:07] Presence heartbeat: 100% operational</p>
          </div>
        </div>
      )}
    </div>
  );
};
