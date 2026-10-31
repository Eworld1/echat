import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import {
  Settings as SettingsIcon,
  Shield,
  User as UserIcon,
  Moon,
  Sun,
  Globe,
  Bell,
  Trash2,
  Lock,
  Key,
  Camera,
  Check,
  AlertTriangle,
  UserX,
  PhoneCall,
  Eye,
  Smartphone
} from 'lucide-react';

interface SettingsProps {
  onNavigateHome?: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onNavigateHome }) => {
  const { user, updateUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'privacy' | 'settings' | 'profile'>('privacy');

  // Tab 1: Privacy State
  const [postVisibility, setPostVisibility] = useState<'public' | 'friends' | 'only_me'>('public');
  const [whoCanCallMe, setWhoCanCallMe] = useState<'everyone' | 'friends' | 'nobody'>('everyone');
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [privacySaved, setPrivacySaved] = useState(false);

  // Tab 2: General Settings State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('echat_theme') as 'light' | 'dark') || 'light';
  });
  const [language, setLanguage] = useState<string>(() => {
    return localStorage.getItem('echat_language') || 'English';
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('echat_notifications');
    return saved !== null ? saved === 'true' : true;
  });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('echat_sound');
    return saved !== null ? saved === 'true' : true;
  });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Tab 3: Profile State
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [location, setLocation] = useState(user?.location || '');
  const [work, setWork] = useState(user?.work || '');
  const [education, setEducation] = useState(user?.education || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [coverPhoto, setCoverPhoto] = useState(user?.coverPhoto || '');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState('');

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setBio(user.bio || '');
      setLocation(user.location || '');
      setWork(user.work || '');
      setEducation(user.education || '');
      setAvatar(user.avatar || '');
      setCoverPhoto(user.coverPhoto || '');
      setBlockedUsers(user.blockedUsers || []);

      // Load custom privacy settings if saved
      if (user.privacySettings) {
        setPostVisibility(user.privacySettings.postVisibility || 'public');
        setWhoCanCallMe(user.privacySettings.whoCanCallMe || 'everyone');
        setIs2FAEnabled(Boolean(user.privacySettings.twoFactorAuth));
      }
    }
  }, [user]);

  // Handle Theme Change
  const handleToggleTheme = (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
    localStorage.setItem('echat_theme', newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Save Privacy Settings
  const handleSavePrivacy = async () => {
    if (!user) return;
    try {
      const updated = await api.updateProfile(user.id, {
        privacySettings: {
          postVisibility,
          whoCanCallMe,
          twoFactorAuth: is2FAEnabled
        }
      });
      updateUser(updated);
      setPrivacySaved(true);
      setTimeout(() => setPrivacySaved(false), 3000);
    } catch (e: any) {
      alert(e.message || 'Failed to save privacy settings');
    }
  };

  // Save General Settings
  const handleSaveGeneralSettings = () => {
    localStorage.setItem('echat_theme', theme);
    localStorage.setItem('echat_language', language);
    localStorage.setItem('echat_notifications', String(notificationsEnabled));
    localStorage.setItem('echat_sound', String(soundEnabled));
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
  };

  // Unblock user
  const handleUnblockUser = async (targetId: string) => {
    if (!user) return;
    const nextBlocked = blockedUsers.filter(id => id !== targetId);
    setBlockedUsers(nextBlocked);
    try {
      const updated = await api.updateProfile(user.id, {
        blockedUsers: nextBlocked
      });
      updateUser(updated);
    } catch (e) {
      console.error(e);
    }
  };

  // Save Profile Details
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsUpdatingProfile(true);
    setProfileSuccessMsg('');
    try {
      const updated = await api.updateProfile(user.id, {
        name: name.trim(),
        bio: bio.trim(),
        location: location.trim(),
        work: work.trim(),
        education: education.trim(),
        avatar: avatar.trim(),
        coverPhoto: coverPhoto.trim()
      });
      updateUser(updated);
      setProfileSuccessMsg('Profile updated successfully!');
      setTimeout(() => setProfileSuccessMsg(''), 3000);
    } catch (e: any) {
      alert(e.message || 'Failed to update profile');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Change Password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!newPassword || newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    if (!user) return;
    setIsChangingPassword(true);
    try {
      await api.changePassword(user.id, {
        currentPassword,
        newPassword
      });
      setPasswordSuccess('Password changed successfully! Keep it safe.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(''), 4000);
    } catch (e: any) {
      setPasswordError(e.message || 'Failed to update password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Delete Account
  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeletingAccount(true);
    try {
      await api.deleteAccount(user.id);
      logout();
      window.location.reload();
    } catch (e: any) {
      alert(e.message || 'Failed to delete account');
      setIsDeletingAccount(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Settings Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <SettingsIcon size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">Settings & Privacy</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Control your visibility, appearance, security, and account preferences
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 mt-6 border-b border-slate-100 pb-1">
          <button
            onClick={() => setActiveTab('privacy')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'privacy'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Shield size={16} />
            Privacy
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <SettingsIcon size={16} />
            Preferences
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <UserIcon size={16} />
            Edit Profile
          </button>
        </div>
      </div>

      {/* TAB 1: PRIVACY */}
      {activeTab === 'privacy' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Eye size={18} className="text-blue-600" />
              Audience & Visibility
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose who can see your content and reach out to you on Echat
            </p>
          </div>

          <div className="space-y-4 max-w-xl">
            {/* Who can see posts */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Who can see your posts?
              </label>
              <select
                value={postVisibility}
                onChange={(e: any) => setPostVisibility(e.target.value)}
                className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="public">Public (Everyone on Echat)</option>
                <option value="friends">Friends Only</option>
                <option value="only_me">Only Me (Private archive)</option>
              </select>
            </div>

            {/* Who can call me */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Who can call you with Live Video & Audio?
              </label>
              <select
                value={whoCanCallMe}
                onChange={(e: any) => setWhoCanCallMe(e.target.value)}
                className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="everyone">Everyone on Echat</option>
                <option value="friends">Friends Only (Recommended)</option>
                <option value="nobody">Nobody (Mute all incoming calls)</option>
              </select>
            </div>

            {/* Two-Factor Authentication Mock */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Smartphone size={16} className="text-indigo-600" />
                  Two-Factor Authentication (2FA)
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Protect your account by requiring an extra verification token when logging in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIs2FAEnabled(!is2FAEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  is2FAEnabled ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    is2FAEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Blocked Users List */}
            <div className="pt-4 border-t border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
                <UserX size={16} className="text-red-500" />
                Blocked Users ({blockedUsers.length})
              </h4>
              <p className="text-xs text-slate-500 mb-3">
                Blocked people cannot call you, send you messages, or view your stories and feed.
              </p>

              {blockedUsers.length === 0 ? (
                <div className="p-4 bg-slate-50 rounded-xl text-center text-xs text-slate-400">
                  You haven't blocked anyone.
                </div>
              ) : (
                <div className="space-y-2">
                  {blockedUsers.map(id => (
                    <div key={id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl text-xs">
                      <span className="font-semibold text-slate-700">User ID: {id}</span>
                      <button
                        onClick={() => handleUnblockUser(id)}
                        className="text-xs font-bold text-red-600 hover:text-red-700 cursor-pointer"
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 flex items-center gap-3">
              <button
                onClick={handleSavePrivacy}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition cursor-pointer shadow-sm"
              >
                Save Privacy Settings
              </button>
              {privacySaved && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <Check size={14} /> Saved!
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GENERAL PREFERENCES & SETTINGS */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <SettingsIcon size={18} className="text-blue-600" />
              General Preferences
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Customize language, theme, and notifications
            </p>
          </div>

          <div className="space-y-6 max-w-xl">
            {/* Dark / Light Mode */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Appearance & Theme
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleToggleTheme('light')}
                  className={`p-3.5 rounded-xl border flex items-center gap-3 cursor-pointer transition ${
                    theme === 'light'
                      ? 'border-blue-600 bg-blue-50/50 text-blue-900'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Sun size={20} className="text-amber-500" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Light Theme</div>
                    <div className="text-[10px] text-slate-500">Classic bright look</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleTheme('dark')}
                  className={`p-3.5 rounded-xl border flex items-center gap-3 cursor-pointer transition ${
                    theme === 'dark'
                      ? 'border-blue-600 bg-slate-900 text-white'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Moon size={20} className="text-indigo-400" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Dark Theme</div>
                    <div className="text-[10px] text-slate-400">Easy on the eyes</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Language Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Globe size={14} className="text-emerald-600" />
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="English">English (United States)</option>
                <option value="Krio">Krio (Sierra Leone)</option>
                <option value="French">Français (French)</option>
                <option value="Spanish">Español (Spanish)</option>
                <option value="Arabic">العربية (Arabic)</option>
                <option value="German">Deutsch (German)</option>
              </select>
            </div>

            {/* Notifications Toggle */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Notifications & Audio
              </h3>

              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Bell size={16} className="text-blue-600" />
                    Push & In-App Notifications
                  </div>
                  <div className="text-xs text-slate-500">Receive alerts when friends comment, call, or post.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    notificationsEnabled ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <PhoneCall size={16} className="text-emerald-600" />
                    Incoming Call Ringing Sound
                  </div>
                  <div className="text-xs text-slate-500">Play ringing audio on incoming WebRTC video and voice calls.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    soundEnabled ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      soundEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                onClick={handleSaveGeneralSettings}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition cursor-pointer shadow-sm"
              >
                Save Preferences
              </button>
              {settingsSaved && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <Check size={14} /> Preferences Saved!
                </span>
              )}
            </div>

            {/* Danger Zone: Delete Account */}
            <div className="pt-6 border-t border-red-100">
              <div className="bg-red-50 rounded-2xl p-4 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-red-900 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-red-600" />
                    Delete Account
                  </h4>
                  <p className="text-xs text-red-700 mt-0.5">
                    Permanently delete your profile, posts, messages, and presence. This cannot be undone.
                  </p>
                </div>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition cursor-pointer shrink-0 shadow-sm"
                >
                  Delete Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: EDIT PROFILE */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <UserIcon size={18} className="text-blue-600" />
              Edit Profile Information
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Update your personal bio, avatars, credentials, and password
            </p>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4 max-w-xl">
            {/* Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Display Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Email (Readonly) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Account Email
              </label>
              <input
                type="email"
                disabled
                value={email}
                className="w-full text-sm p-3 bg-slate-100 text-slate-500 rounded-xl border border-slate-200 cursor-not-allowed"
              />
            </div>

            {/* Bio */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                placeholder="Write a few words about yourself..."
                className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Location & Work */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Freetown, SL"
                  className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Work / Profession
                </label>
                <input
                  type="text"
                  value={work}
                  onChange={(e) => setWork(e.target.value)}
                  placeholder="e.g. Full Stack Developer"
                  className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Profile Avatar URL */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Profile Avatar URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  placeholder="https://..."
                  className="w-full text-xs p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setAvatar(`https://api.dicebear.com/7.x/avataaars/svg?seed=${Date.now()}`)}
                  className="px-3 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 shrink-0 cursor-pointer"
                >
                  Randomize
                </button>
              </div>
            </div>

            {/* Cover Photo URL */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Cover Photo URL
              </label>
              <input
                type="url"
                value={coverPhoto}
                onChange={(e) => setCoverPhoto(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                className="w-full text-xs p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={isUpdatingProfile}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isUpdatingProfile ? 'Saving...' : 'Save Profile Changes'}
              </button>
              {profileSuccessMsg && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <Check size={14} /> {profileSuccessMsg}
                </span>
              )}
            </div>
          </form>

          {/* CHANGE PASSWORD SECTION */}
          <div className="pt-6 border-t border-slate-100 max-w-xl">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-1">
              <Lock size={16} className="text-blue-600" />
              Change Password
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter your current password and choose a secure new one.
            </p>

            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {passwordError && (
                <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200">
                  {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div className="p-3 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-xl border border-emerald-200 flex items-center gap-2">
                  <Check size={16} />
                  {passwordSuccess}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isChangingPassword || !newPassword}
                  className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {isChangingPassword ? 'Updating Password...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={22} />
              </div>
              <h3 className="text-lg font-black text-slate-900">Permanently Delete Account?</h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to delete your Echat account? All your posts, photos, messages, and profile history will be permanently erased.
            </p>

            <div className="pt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingAccount}
                onClick={handleDeleteAccount}
                className="px-5 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {isDeletingAccount ? 'Deleting...' : 'Yes, Delete My Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
