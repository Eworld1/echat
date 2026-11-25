import { useSocket } from '../context/SocketContext';
import React, { useState, useEffect } from 'react';
import { User, Post } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { avatarClick, openAvatarViewer } from './AvatarViewer';
import { PostCard } from './PostCard';
import { ReelsViewer } from './ReelsViewer';
import { ReelThumbnail } from './ReelThumbnail';
import { useBackButton } from '../hooks/useBackButton';
import { CreatePostModal } from './CreatePostModal';
import { LiveUserActions } from './LiveUserActions';
import { ConnectionsModal, type ConnectionsTab } from './ConnectionsModal';
import { listenFollowerCount } from '../services/liveDiscovery';
import { VerifiedBadge } from './VerifiedBadge';
import { useProfilePhotoUpload } from './ProfilePhotoEditor';
import { isGeneratedImage } from '../utils/avatar';
import {
  Camera,
  MapPin,
  Briefcase,
  GraduationCap,
  Calendar,
  UserCheck,
  UserPlus,
  MessageCircle,
  Edit3,
  X,
  Phone,
  Video,
  Grid,
  FileText,
  Users,
  Rocket,
  Sparkles
  , Film, Share2
} from 'lucide-react';

interface ProfileViewProps {
  userId: string;
  onOpenChat: (user: User) => void;
  onViewProfile: (userId: string) => void;
}

function getAge(dobString?: string): number | null {
  if (!dobString) return null;
  const birthDate = new Date(dobString);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  userId,
  onOpenChat,
  onViewProfile
}) => {
  const { user: currentUser, updateCurrentUser, updateUser } = useAuth();
  const { startCall } = useSocket();
  const [profileData, setProfileData] = useState<{ user: User; posts: Post[]; reels?: Post[]; friends: User[] } | null>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'reels' | 'about' | 'friends' | 'photos' | 'videos'>('posts');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [isCreateReelOpen, setIsCreateReelOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBoosting, setIsBoosting] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editDobVisibility, setEditDobVisibility] = useState<User['dobVisibility']>('public');
  const [editBio, setEditBio] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editWork, setEditWork] = useState('');
  const [editEducation, setEditEducation] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editCover, setEditCover] = useState('');
  // Choose -> crop -> upload -> saved on the profile right away (shown everywhere instantly).
  const photoUpload = useProfilePhotoUpload((kind, url) => { if (kind === 'avatar') setEditAvatar(url); else setEditCover(url); });
  const [profileNotice, setProfileNotice] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [selectedReel, setSelectedReel] = useState<Post | null>(null);
  // Friends / Following / Followers list (tap the counts or the Friends tab).
  const [connectionsTab, setConnectionsTab] = useState<ConnectionsTab | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  useEffect(() => (userId ? listenFollowerCount(userId, setFollowerCount) : undefined), [userId]);
  useEffect(() => { setConnectionsTab(null); }, [userId]);
  useBackButton(isEditModalOpen, () => setIsEditModalOpen(false), 'profile-edit');
  useBackButton(Boolean(selectedReel), () => setSelectedReel(null), 'profile-reel');

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const raw = await api.getUserProfile(userId);
      const data = 'user' in raw && raw.user
        ? raw
        : { user: raw as unknown as User, posts: [] as Post[], reels: [] as Post[], friends: [] as User[] };
      setProfileData({ ...data, posts: data.posts.filter(post => post.type === 'post' && post.isReel !== true && post.videoType !== 'reel'), reels: (data.reels || data.posts.filter(post => post.type === 'reel' || post.isReel === true)).filter(post => post.type === 'reel' || post.isReel === true) });
      setEditName(data.user.name);
      setEditDob(data.user.dob || '');
      setEditDobVisibility(data.user.dobVisibility || 'public');
      setEditBio(data.user.bio || '');
      setEditLocation(data.user.location || '');
      setEditWork(data.user.work || '');
      setEditEducation(data.user.education || '');
      setEditAvatar(data.user.avatar);
      setEditCover(data.user.coverPhoto);
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [userId]);

  useEffect(() => {
    const updateViewedProfile = (event: Event) => {
      const updated = (event as CustomEvent<Partial<User>>).detail;
      if (!updated?.id || updated.id !== userId) return;
      setProfileData(current => current ? { ...current, user: { ...current.user, ...updated } } : current);
    };
    window.addEventListener('echat:profile-updated', updateViewedProfile);
    return () => window.removeEventListener('echat:profile-updated', updateViewedProfile);
  }, [userId]);

  const isOwnProfile = currentUser?.id === userId;
  const isFriend = currentUser?.friends.includes(userId);
  const hasSentRequest = currentUser?.friendRequestsSent.includes(userId);
  const hasReceivedRequest = currentUser?.friendRequestsReceived.includes(userId);
  const handleBoost = async () => {
    if (!profileData?.user || isBoosting) return;
    try {
      setIsBoosting(true);
      const res = await api.boostUser(profileData.user.id);
      setProfileData(prev => {
        if (!prev) return null;
        const currentBoosted = prev.user.boostedBy || [];
        const nextBoosted = res.hasBoosted
          ? (currentUser && !currentBoosted.includes(currentUser.id) ? [...currentBoosted, currentUser.id] : currentBoosted)
          : currentBoosted.filter(id => id !== currentUser?.id);
        return {
          ...prev,
          user: {
            ...prev.user,
            boostsCount: res.boostsCount,
            boostedBy: nextBoosted
          }
        };
      });
    } catch (err) {
      console.error('Failed to boost:', err);
    } finally {
      setIsBoosting(false);
    }
  };

  const handleSendFriendRequest = async () => {
    await api.sendFriendRequest(userId);
    loadProfile();
  };

  const handleAcceptFriendRequest = async () => {
    await api.acceptFriendRequest(userId);
    loadProfile();
  };

  // /u/<id> shows a rich preview (photo + name + bio) when pasted in WhatsApp, Facebook… (see api/preview.ts).
  const [profileLinkCopied, setProfileLinkCopied] = useState(false);
  const shareProfile = async () => {
    const url = `${window.location.origin}/u/${encodeURIComponent(userId)}`;
    const name = profileData?.user.name || 'this profile';
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: `${name} on eChat`, url }); return; }
      await navigator.clipboard.writeText(url);
      setProfileLinkCopied(true);
      window.setTimeout(() => setProfileLinkCopied(false), 2000);
    } catch { /* share sheet closed */ }
  };

  const handleUnfriend = async () => {
    if (!confirm('Unfriend this user?')) return;
    await api.unfriend(userId);
    loadProfile();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileNotice('');
    try {
      await updateCurrentUser({
        name: editName,
        dob: editDob,
        dobVisibility: editDobVisibility,
        bio: editBio,
        location: editLocation,
        work: editWork,
        education: editEducation,
        avatar: editAvatar,
        coverPhoto: editCover
      });
      setIsEditModalOpen(false);
      setProfileNotice('Profile updated');
      loadProfile();
    } catch (err) {
      console.error('Failed to update profile:', err);
      setProfileNotice(err instanceof Error ? err.message : 'Could not update profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  if (isLoading || !profileData) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center text-slate-400">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm">Loading profile...</p>
      </div>
    );
  }

  const { user, posts, friends } = profileData;
  const profilePosts = posts;
  const normalPosts = profilePosts.filter(post => post.type === 'post' && post.isReel !== true && post.videoType !== 'reel');
  const reels = (profileData.reels || []).filter(post => (post.type === 'reel' || post.isReel === true) && post.mediaType === 'video');
  const dobLabel = user.dob
    ? `${new Date(user.dob).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}${getAge(user.dob) !== null ? ` (${getAge(user.dob)} years old)` : ''}`
    : user.dobMonthDay
      ? `Born on ${new Date(`2000-${user.dobMonthDay}`).toLocaleDateString([], { month: 'long', day: 'numeric' })}`
      : '';
  const birthdayMonthDay = user.dob?.slice(5) || user.dobMonthDay;
  const isBirthdayToday = Boolean(birthdayMonthDay && birthdayMonthDay === `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}` && (isOwnProfile || user.dobVisibility !== 'only_me'));

  // Extract all photos from user's posts
  const photos = normalPosts.filter(p => p.mediaUrl && p.mediaType === 'image').map(p => p.mediaUrl!);
  const videos = normalPosts.filter(p => p.mediaType === 'video');

  return (
    <div className="max-w-4xl mx-auto pb-12">
      {/* Cover and Avatar Section */}
      <div className="bg-white rounded-b-3xl shadow-xs border-x border-b border-slate-200 overflow-hidden">
        {/* Cover Photo */}
        <div className="relative h-48 sm:h-72 bg-gradient-to-r from-blue-600 to-indigo-700">
          {user.coverPhoto && <img
            key={user.coverPhoto}
            src={user.coverPhoto}
            alt=""
            onError={event => { event.currentTarget.style.display = 'none'; }}
            className="w-full h-full object-cover"
          />}
          {isOwnProfile && (
            <button
              type="button"
              onClick={() => photoUpload.choose('cover')}
              disabled={photoUpload.uploading !== null}
              className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-xs hover:bg-white text-slate-800 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 transition disabled:opacity-70"
            >
              {photoUpload.uploading === 'cover' ? <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-slate-400 border-t-slate-800" /> : <Camera size={15} />}
              {photoUpload.uploading === 'cover' ? 'Uploading…' : 'Edit Cover Photo'}
            </button>
          )}
        </div>

        {isBirthdayToday && <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-3 text-amber-950 dark:from-amber-950/50 dark:to-orange-950/40 dark:text-amber-100"><div className="font-semibold">🎂 {isOwnProfile ? `Happy Birthday, ${user.name}! Your friends can see it’s your birthday.` : `Today is ${user.name}’s Birthday!`}</div>{!isOwnProfile && <button type="button" onClick={() => onOpenChat(user)} className="min-h-10 rounded-full bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600">Wish them Happy Birthday</button>}</div>}

        {/* Profile Info Header */}
        <div className="px-6 pb-6 pt-0 relative">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between -mt-16 sm:-mt-20 gap-4 mb-4">
            {/* Avatar */}
            <div className="flex items-end gap-4">
              <div className="relative">
                <img
                  src={user.avatar}
                  alt={user.name}
                  role="button"
                  tabIndex={0}
                  title="View profile picture"
                  onClick={avatarClick({ userId: user.id, name: user.name, avatar: user.avatar })}
                  onKeyDown={event => { if (event.key === 'Enter') openAvatarViewer({ userId: user.id, name: user.name, avatar: user.avatar }); }}
                  className="w-32 h-32 sm:w-40 sm:h-40 cursor-pointer rounded-full object-cover border-4 border-white shadow-lg bg-white transition hover:brightness-95"
                />
                {user.isOnline && (
                  <span className="absolute bottom-3 right-3 w-5 h-5 bg-emerald-500 rounded-full ring-4 ring-white" />
                )}
                {isOwnProfile && (
                  <button
                    type="button"
                    onClick={() => photoUpload.choose('avatar')}
                    disabled={photoUpload.uploading !== null}
                    className="absolute bottom-1 right-1 p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full border border-white shadow transition"
                    title="Change profile picture"
                    aria-label="Change profile picture"
                  >
                    {photoUpload.uploading === 'avatar' ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-slate-800" /> : <Camera size={16} />}
                  </button>
                )}
              </div>

              {(() => {
                const isDevProfile = Boolean(
                  user.isOfficialDeveloper ||
                  user.email?.toLowerCase().trim() === 'eldermoses89@gmail.com' ||
                  user.role === 'developer'
                );
                const hasBoosted = Boolean(currentUser && user.boostedBy?.includes(currentUser.id));

                return (
                  <>
                    <div className="mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight flex items-center gap-2">
                          <span>{user.name}</span>
                          {(user.isVerified || isDevProfile) && <VerifiedBadge size={22} />}
                        </h1>
                        {isDevProfile && (
                          <span className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-[11px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-xs">
                            <Sparkles size={12} /> EChat Official Developer
                          </span>
                        )}
                        {!isDevProfile && user.role === 'admin' && (
                          <span className="bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                            Admin
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3 text-sm text-slate-500 font-medium mt-1 flex-wrap">
                        <button type="button" onClick={() => setConnectionsTab('friends')} className="rounded-md font-semibold text-slate-600 hover:text-slate-900 hover:underline">{friends.length} {friends.length === 1 ? 'friend' : 'friends'}</button>
                        <span>•</span>
                        <button type="button" onClick={() => setConnectionsTab('followers')} className="rounded-md font-semibold text-slate-600 hover:text-slate-900 hover:underline">{followerCount.toLocaleString()} {followerCount === 1 ? 'follower' : 'followers'}</button>
                        {isDevProfile && (
                          <>
                            <span>•</span>
                            <span className="text-amber-600 font-semibold flex items-center gap-1">
                              <Rocket size={14} /> {user.boostsCount || 0} Boosts
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const isDevProfile = Boolean(
                  user.isOfficialDeveloper ||
                  user.email?.toLowerCase().trim() === 'eldermoses89@gmail.com' ||
                  user.role === 'developer'
                );
                const hasBoosted = Boolean(currentUser && user.boostedBy?.includes(currentUser.id));

                return (
                  <>
                    {/* Boost Button (Only on Developer Profile) */}
                    {isDevProfile && (
                      <button
                        onClick={handleBoost}
                        disabled={isBoosting}
                        className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-2 transition shadow-xs cursor-pointer ${
                          hasBoosted
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 text-white hover:from-amber-600 hover:to-pink-600'
                        }`}
                        title={hasBoosted ? 'You have boosted this developer account' : 'Boost this developer account'}
                      >
                        <Rocket size={16} className={isBoosting ? 'animate-bounce' : ''} />
                        <span>{hasBoosted ? 'Boosted 🚀' : 'Boost Account 🚀'}</span>
                        <span className="bg-black/20 text-white px-2 py-0.5 rounded-full text-[11px] font-mono">
                          {user.boostsCount || 0}
                        </span>
                      </button>
                    )}

                    {!isOwnProfile && <LiveUserActions targetUserId={user.id} targetName={user.name} />}

                    <button type="button" onClick={() => void shareProfile()} title="Share profile link"
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition">
                      <Share2 size={16} />{profileLinkCopied ? 'Link copied' : 'Share'}
                    </button>

                    {isOwnProfile ? (
                      <button
                        onClick={() => setIsEditModalOpen(true)}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-2 transition"
                      >
                        <Edit3 size={16} />
                        Edit profile
                      </button>
                    ) : (
                      <>
                        {isFriend ? (
                          <button
                            onClick={handleUnfriend}
                            className="px-4 py-2 bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-800 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition"
                          >
                            <UserCheck size={16} />
                            Friends
                          </button>
                        ) : hasReceivedRequest ? (
                          <button
                            onClick={handleAcceptFriendRequest}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition"
                          >
                            Accept Request
                          </button>
                        ) : hasSentRequest ? (
                          <button
                            disabled
                            className="px-4 py-2 bg-slate-100 text-slate-400 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 cursor-not-allowed"
                          >
                            Request Sent
                          </button>
                        ) : (
                          <button
                            onClick={handleSendFriendRequest}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition shadow-xs"
                          >
                            <UserPlus size={16} />
                            Add Friend
                          </button>
                        )}

                        <button
                          onClick={() => onOpenChat(user)}
                          className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition"
                        >
                          <MessageCircle size={16} />
                          Message
                        </button>

                        <button
                          onClick={() => startCall(user.id, user.name, user.avatar, 'audio')}
                          className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition"
                          title="Voice call"
                        >
                          <Phone size={16} />
                          <span className="hidden sm:inline">Call</span>
                        </button>

                        <button
                          onClick={() => startCall(user.id, user.name, user.avatar, 'video')}
                          className="px-3.5 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs sm:text-sm font-bold rounded-xl flex items-center gap-1.5 transition"
                          title="Video call"
                        >
                          <Video size={16} />
                          <span className="hidden sm:inline">Video</span>
                        </button>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Bio */}
          {user.bio && (
            <p className="text-sm text-slate-700 max-w-2xl leading-relaxed mt-2">
              {user.bio}
            </p>
          )}

          {/* Details Row */}
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap mt-4 text-xs text-slate-500 font-medium pt-3 border-t border-slate-100">
            {user.location && (
              <span className="flex items-center gap-1.5">
                <MapPin size={15} className="text-slate-400" />
                Lives in <strong className="text-slate-700 font-semibold">{user.location}</strong>
              </span>
            )}
            {user.work && (
              <span className="flex items-center gap-1.5">
                <Briefcase size={15} className="text-slate-400" />
                Works at <strong className="text-slate-700 font-semibold">{user.work}</strong>
              </span>
            )}
            {user.education && (
              <span className="flex items-center gap-1.5">
                <GraduationCap size={15} className="text-slate-400" />
                Studied at <strong className="text-slate-700 font-semibold">{user.education}</strong>
              </span>
            )}
            {dobLabel && (
              <span className="flex items-center gap-1.5">
                <Calendar size={15} className="text-pink-500" />
                <span>{dobLabel.startsWith('Born on ') ? dobLabel : <>Born <strong className="text-slate-700 font-semibold">{dobLabel}</strong></>}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar size={15} className="text-slate-400" />
              Joined {new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </span>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 mt-6 border-t border-slate-100 pt-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('posts')}
              className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition ${
                activeTab === 'posts' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Posts ({normalPosts.length})
            </button>
            <button onClick={() => setActiveTab('reels')} className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition ${activeTab === 'reels' ? 'border-fuchsia-600 text-fuchsia-600' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
              Reels ({reels.length})
            </button>
            <button
              onClick={() => setActiveTab('about')}
              className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition ${
                activeTab === 'about' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              About
            </button>
            <button
              onClick={() => { setActiveTab('friends'); setConnectionsTab('friends'); }}
              className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition ${
                activeTab === 'friends' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Friends ({friends.length})
            </button>
            <button
              onClick={() => setActiveTab('photos')}
              className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition ${
                activeTab === 'photos' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Photos ({photos.length})
            </button>
            <button onClick={() => setActiveTab('videos')} className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition ${activeTab === 'videos' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
              Videos ({videos.length})
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'posts' && (
          <div className="space-y-4">
            {normalPosts.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
                <FileText size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-semibold">No posts yet</p>
                {isOwnProfile && <button type="button" onClick={() => setIsCreatePostOpen(true)} className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">Create Post</button>}
              </div>
            ) : (
              normalPosts.map(p => (
                <PostCard
                  key={p.id}
                  post={p}
                  onPostUpdated={loadProfile}
                  onPostDeleted={loadProfile}
                  onViewProfile={onViewProfile}
                />
              ))
            )}
          </div>
        )}

        {activeTab === 'reels' && (
          reels.length ? <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {reels.map(reel => <ReelThumbnail key={reel.id} post={reel} onClick={() => setSelectedReel(reel)} />)}
          </div> : <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500"><Film size={32} className="mx-auto mb-2 text-fuchsia-500" /><p className="font-bold">No Reels yet</p>{isOwnProfile && <><p className="mt-1 text-sm">Create a short video Reel to share it here.</p><button type="button" onClick={() => setIsCreateReelOpen(true)} className="mt-3 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white">Create Reel</button></>}</div>
        )}

        {activeTab === 'about' && (
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-900">About {user.name}</h3>
            <div className="space-y-3 text-sm text-slate-700">
              <p><strong>Bio:</strong> {user.bio || 'No bio provided'}</p>
              <p><strong>Email:</strong> {user.email}</p>
              {dobLabel && (
                <p>
                  <strong>Date of Birth:</strong> {dobLabel.startsWith('Born on ') ? dobLabel.slice(8) : dobLabel}
                </p>
              )}
              <p><strong>Location:</strong> {user.location || 'Not specified'}</p>
              <p><strong>Workplace:</strong> {user.work || 'Not specified'}</p>
              <p><strong>Education:</strong> {user.education || 'Not specified'}</p>
            </div>
          </div>
        )}

        {activeTab === 'friends' && (
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">Friends ({friends.length})</h3>
              <button type="button" onClick={() => setConnectionsTab('friends')} className="rounded-lg px-3 py-1.5 text-sm font-bold text-blue-600 hover:bg-blue-50">See all · Followers</button>
            </div>
            {friends.length === 0 ? (
              <p className="text-sm text-slate-400">No friends added yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {friends.map(f => (
                  <div
                    key={f.id}
                    onClick={() => onViewProfile(f.id)}
                    className="p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200/60 cursor-pointer flex items-center gap-3 transition"
                  >
                    <img src={f.avatar} alt={f.name} className="w-12 h-12 rounded-xl object-cover" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{f.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{f.location || f.email}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'photos' && (
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-4">Photos</h3>
            {photos.length === 0 ? (
              <p className="text-sm text-slate-400">No photos uploaded yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map((src, idx) => (
                  <img
                    key={idx}
                    src={src}
                    alt={`photo-${idx}`}
                    className="h-44 w-full object-cover rounded-xl shadow-xs cursor-pointer hover:opacity-90 transition"
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'videos' && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{videos.length ? videos.map(post => <article key={post.id} className="overflow-hidden rounded-xl bg-black"><video src={post.mediaUrl} poster={post.thumbnailUrl} controls playsInline preload="metadata" className="aspect-video w-full object-cover" /><p className="bg-white p-2 text-xs text-slate-700 line-clamp-2">{post.content || 'Video post'}</p></article>) : <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">No videos yet</div>}</div>}
      </div>

      <CreatePostModal isOpen={isCreatePostOpen} onClose={() => setIsCreatePostOpen(false)} onPostCreated={() => { setIsCreatePostOpen(false); void loadProfile(); }} />
      <CreatePostModal isOpen={isCreateReelOpen} onClose={() => setIsCreateReelOpen(false)} onPostCreated={() => { setIsCreateReelOpen(false); void loadProfile(); }} forcePublic videoOnly title="Create a public Reel" />

      {profileNotice && <div role="status" className="fixed bottom-20 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-xl">{profileNotice}</div>}

      {selectedReel && <ReelsViewer posts={reels} initialPostId={selectedReel.id} onClose={() => setSelectedReel(null)} onPostUpdated={() => { void loadProfile(); }} onPostDeleted={() => { setSelectedReel(null); void loadProfile(); }} onViewProfile={onViewProfile} />}

      {isOwnProfile && photoUpload.elements}
      {isOwnProfile && photoUpload.error && !isEditModalOpen && <div role="alert" className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-xl bg-[#b91c1c] px-4 py-3 text-sm font-semibold text-[#ffffff] shadow-lg">{photoUpload.error}</div>}

      {/* Edit Profile (Facebook-style: pictures with Upload buttons, no image links shown) */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#000000]/60 sm:items-center sm:p-6" onClick={() => setIsEditModalOpen(false)} role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-profile-title" onClick={event => event.stopPropagation()} style={{ colorScheme: 'light' }}
            className="flex h-dvh w-full flex-col bg-[#ffffff] text-[#111111] sm:h-auto sm:max-h-[90vh] sm:max-w-[560px] sm:rounded-[26px] sm:border sm:border-[#e2c06e] sm:shadow-[0_0_0_1px_rgba(255,226,150,0.35),0_0_28px_6px_rgba(240,196,92,0.40),0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between border-b border-[#eceef1] px-5 pb-3 pt-[calc(env(safe-area-inset-top)+14px)] sm:pt-4">
              <h3 id="edit-profile-title" className="text-[20px] font-extrabold">Edit profile</h3>
              <button type="button" onClick={() => setIsEditModalOpen(false)} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-[#4b5563] hover:bg-[#f1f2f4]"><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveProfile} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
                {/* Profile picture */}
                <section>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-[16px] font-extrabold">Profile picture</h4>
                    <div className="flex items-center gap-1">
                      {!isGeneratedImage(editAvatar) && <button type="button" disabled={photoUpload.uploading !== null} onClick={() => void photoUpload.remove('avatar')} className="rounded-lg px-3 py-1.5 text-[14px] font-bold text-[#b91c1c] hover:bg-[#fdecec] disabled:opacity-60">Remove</button>}
                      <button type="button" disabled={photoUpload.uploading !== null} onClick={() => photoUpload.choose('avatar')} className="rounded-lg px-3 py-1.5 text-[14px] font-bold text-[#1f4d1f] hover:bg-[#f6efd9] disabled:opacity-60">Upload photo</button>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <button type="button" disabled={photoUpload.uploading !== null} onClick={() => photoUpload.choose('avatar')} className="group relative block h-40 w-40 rounded-full" aria-label="Upload profile picture">
                      <span className="absolute inset-0 grid place-items-center rounded-full bg-gradient-to-br from-[#f3dc9b] to-[#b68428] text-5xl font-extrabold text-[#1f3d1a]">{(editName || user.name || '?').trim().charAt(0).toUpperCase()}</span>
                      {editAvatar && <img key={editAvatar} src={editAvatar} alt="Profile picture" onError={event => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 h-full w-full rounded-full object-cover" />}
                      <span className="absolute inset-0 rounded-full ring-4 ring-[#ffffff] shadow-[0_0_0_2px_#e2c06e]" />
                      {photoUpload.uploading === 'avatar'
                        ? <span className="absolute inset-0 grid place-items-center rounded-full bg-[#000000]/45 text-[#ffffff]"><span className="h-9 w-9 animate-spin rounded-full border-4 border-[#ffffff]/40 border-t-[#ffffff]" /></span>
                        : <span className="absolute bottom-1 right-1 grid h-10 w-10 place-items-center rounded-full border-2 border-[#ffffff] bg-[#eef0f2] text-[#111111] shadow transition group-hover:bg-[#e2e5e9]"><Camera size={19} /></span>}
                    </button>
                  </div>
                </section>

                {/* Cover photo */}
                <section>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-[16px] font-extrabold">Cover photo</h4>
                    <div className="flex items-center gap-1">
                      {!isGeneratedImage(editCover) && <button type="button" disabled={photoUpload.uploading !== null} onClick={() => void photoUpload.remove('cover')} className="rounded-lg px-3 py-1.5 text-[14px] font-bold text-[#b91c1c] hover:bg-[#fdecec] disabled:opacity-60">Remove</button>}
                      <button type="button" disabled={photoUpload.uploading !== null} onClick={() => photoUpload.choose('cover')} className="rounded-lg px-3 py-1.5 text-[14px] font-bold text-[#1f4d1f] hover:bg-[#f6efd9] disabled:opacity-60">Upload cover</button>
                    </div>
                  </div>
                  <button type="button" disabled={photoUpload.uploading !== null} onClick={() => photoUpload.choose('cover')} className="group relative block aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[#e5e7eb]" aria-label="Upload cover photo">
                    <span className="absolute inset-0 bg-gradient-to-br from-[#f6e7bd] via-[#e9d29a] to-[#cfa24a]" />
                    {editCover && <img key={editCover} src={editCover} alt="Cover photo" onError={event => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 h-full w-full object-cover" />}
                    {photoUpload.uploading === 'cover'
                      ? <span className="absolute inset-0 grid place-items-center bg-[#000000]/40"><span className="h-9 w-9 animate-spin rounded-full border-4 border-[#ffffff]/40 border-t-[#ffffff]" /></span>
                      : <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-[#ffffff]/95 px-3 py-1.5 text-[13px] font-bold text-[#111111] shadow transition group-hover:bg-[#ffffff]"><Camera size={16} />Edit Cover Photo</span>}
                  </button>
                  {photoUpload.error && <p role="alert" className="mt-2 text-[13px] font-semibold text-[#b91c1c]">{photoUpload.error}</p>}
                  {!photoUpload.error && photoUpload.notice && <p className="mt-2 text-[13px] font-semibold text-[#047857]">✓ {photoUpload.notice}</p>}
                </section>

                {/* Name + bio */}
                <section className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-bold">Full name</span>
                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required maxLength={80} style={{ colorScheme: 'light' }}
                      className="h-12 w-full rounded-xl border border-[#d4d7db] bg-[#f1f2f4] px-4 text-[15px] text-[#111827] outline-none focus:border-[#c9a24a] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#e9c86a]/30" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-bold">Bio</span>
                    <textarea value={editBio} onChange={e => setEditBio(e.target.value)} rows={3} maxLength={300} placeholder="Describe who you are" style={{ colorScheme: 'light' }}
                      className="w-full resize-none rounded-xl border border-[#d4d7db] bg-[#f1f2f4] px-4 py-3 text-[15px] text-[#111827] outline-none placeholder:text-[#7b818a]! focus:border-[#c9a24a] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#e9c86a]/30" />
                    <span className="mt-1 block text-right text-[12px] text-[#9ca3af]">{editBio.length}/300</span>
                  </label>
                </section>

                {/* Other details, folded away so the form stays simple */}
                <details className="group rounded-2xl border border-[#eceef1] px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-bold">More about you <span className="text-[13px] font-semibold text-[#6b7280] group-open:hidden">Location, work, birthday</span></summary>
                  <div className="mt-3 space-y-3 text-[14px]">
                    {([['Location', editLocation, setEditLocation], ['Workplace', editWork, setEditWork], ['Education', editEducation, setEditEducation]] as const).map(([label, value, setValue]) => (
                      <label key={label} className="block">
                        <span className="mb-1 block font-semibold text-[#374151]">{label}</span>
                        <input type="text" value={value} onChange={e => setValue(e.target.value)} style={{ colorScheme: 'light' }} className="h-11 w-full rounded-xl border border-[#d4d7db] bg-[#f1f2f4] px-3.5 text-[#111827] outline-none focus:border-[#c9a24a] focus:bg-[#ffffff]" />
                      </label>
                    ))}
                    <label className="block">
                      <span className="mb-1 block font-semibold text-[#374151]">Date of birth</span>
                      <input type="date" value={editDob} max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]} onChange={e => setEditDob(e.target.value)} style={{ colorScheme: 'light' }} className="h-11 w-full rounded-xl border border-[#d4d7db] bg-[#f1f2f4] px-3.5 text-[#111827] outline-none focus:border-[#c9a24a] focus:bg-[#ffffff]" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block font-semibold text-[#374151]">Birthday visibility</span>
                      <select value={editDobVisibility || 'public'} onChange={event => setEditDobVisibility(event.target.value as User['dobVisibility'])} style={{ colorScheme: 'light' }} className="h-11 w-full rounded-xl border border-[#d4d7db] bg-[#f1f2f4] px-3 text-[#111827] outline-none focus:border-[#c9a24a]">
                        <option value="public">Public — show full date</option>
                        <option value="friends">Friends only — show full date</option>
                        <option value="only_me">Only me</option>
                        <option value="month_day_only">Show month and day only</option>
                      </select>
                      {editDobVisibility === 'only_me' && <span className="mt-1 block text-[12px] font-medium text-[#b45309]">Your friends will not be notified about your birthday.</span>}
                    </label>
                  </div>
                </details>
              </div>

              <div className="flex gap-2 border-t border-[#eceef1] px-5 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="h-12 flex-1 rounded-xl border border-[#d4d7db] bg-[#ffffff] text-[15px] font-bold text-[#374151] hover:bg-[#f1f2f4] sm:flex-none sm:px-6">Cancel</button>
                <button type="submit" disabled={isSavingProfile || photoUpload.uploading !== null}
                  className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl border border-[#b8862b] bg-gradient-to-b from-[#f3dc9b] via-[#d9b25a] to-[#b68428] text-[16px] font-extrabold text-[#1f3d1a] shadow-[0_6px_16px_rgba(166,120,30,0.30),inset_0_1px_0_rgba(255,255,255,0.6)] hover:brightness-105 disabled:cursor-wait disabled:opacity-70 sm:ml-auto sm:flex-none sm:px-8">
                  {photoUpload.uploading ? 'Uploading…' : isSavingProfile ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {connectionsTab && (
        <ConnectionsModal
          profileUser={{ id: user.id, name: user.name }}
          friends={friends}
          initialTab={connectionsTab}
          onClose={() => setConnectionsTab(null)}
          onViewProfile={onViewProfile}
          onFriendsChanged={next => {
            setProfileData(current => current ? { ...current, friends: next } : current);
            if (currentUser && isOwnProfile) updateUser({ ...currentUser, friends: next.map(friend => friend.id) });
          }}
        />
      )}
    </div>
  );
};
