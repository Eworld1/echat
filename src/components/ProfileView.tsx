import React, { useState, useEffect } from 'react';
import { User, Post } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PostCard } from './PostCard';
import { VerifiedBadge } from './VerifiedBadge';
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
  const { user: currentUser, updateCurrentUser } = useAuth();
  const [profileData, setProfileData] = useState<{ user: User; posts: Post[]; friends: User[] } | null>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'about' | 'friends' | 'photos'>('posts');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBoosting, setIsBoosting] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editWork, setEditWork] = useState('');
  const [editEducation, setEditEducation] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editCover, setEditCover] = useState('');
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);
  const [uploadError, setUploadError] = useState('');

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const raw = await api.getUserProfile(userId);
      const data = 'user' in raw && raw.user
        ? raw
        : { user: raw as unknown as User, posts: [] as Post[], friends: [] as User[] };
      setProfileData(data);
      setEditName(data.user.name);
      setEditDob(data.user.dob || '');
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

  const handleUnfriend = async () => {
    if (!confirm('Unfriend this user?')) return;
    await api.unfriend(userId);
    loadProfile();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateCurrentUser({
        name: editName,
        dob: editDob,
        bio: editBio,
        location: editLocation,
        work: editWork,
        education: editEducation,
        avatar: editAvatar,
        coverPhoto: editCover
      });
      setIsEditModalOpen(false);
      loadProfile();
    } catch (err) {
      console.error('Failed to update profile:', err);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'avatar' | 'cover') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file (JPG, PNG, WebP or GIF).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('Image is too large. Maximum size is 8 MB.');
      return;
    }
    setUploadError('');
    setUploading(kind);
    try {
      const url = await api.uploadFile(file);
      if (kind === 'avatar') setEditAvatar(url);
      else setEditCover(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
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

  // Extract all photos from user's posts
  const photos = posts.filter(p => p.mediaUrl && p.mediaType !== 'video').map(p => p.mediaUrl!);

  return (
    <div className="max-w-4xl mx-auto pb-12">
      {/* Cover and Avatar Section */}
      <div className="bg-white rounded-b-3xl shadow-xs border-x border-b border-slate-200 overflow-hidden">
        {/* Cover Photo */}
        <div className="relative h-48 sm:h-72 bg-gradient-to-r from-blue-600 to-indigo-700">
          <img
            src={user.coverPhoto}
            alt="cover"
            className="w-full h-full object-cover"
          />
          {isOwnProfile && (
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-xs hover:bg-white text-slate-800 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 transition"
            >
              <Camera size={15} />
              Edit Cover
            </button>
          )}
        </div>

        {/* Profile Info Header */}
        <div className="px-6 pb-6 pt-0 relative">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between -mt-16 sm:-mt-20 gap-4 mb-4">
            {/* Avatar */}
            <div className="flex items-end gap-4">
              <div className="relative">
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-32 h-32 sm:w-40 sm:h-40 rounded-full object-cover border-4 border-white shadow-lg bg-white"
                />
                {user.isOnline && (
                  <span className="absolute bottom-3 right-3 w-5 h-5 bg-emerald-500 rounded-full ring-4 ring-white" />
                )}
                {isOwnProfile && (
                  <button
                    onClick={() => setIsEditModalOpen(true)}
                    className="absolute bottom-1 right-1 p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full border border-white shadow transition"
                    title="Change Avatar"
                  >
                    <Camera size={16} />
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
                const followerCount = (friends.length * 8 + 420).toLocaleString();

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
                        <span>{friends.length} {friends.length === 1 ? 'friend' : 'friends'}</span>
                        {isDevProfile && (
                          <>
                            <span>•</span>
                            <span className="text-purple-700 font-semibold flex items-center gap-1">
                              <Users size={14} /> {followerCount} Followers
                            </span>
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
            {user.dob && (
              <span className="flex items-center gap-1.5">
                <Calendar size={15} className="text-pink-500" />
                <span>
                  Born <strong className="text-slate-700 font-semibold">{new Date(user.dob).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
                  {getAge(user.dob) !== null && (
                    <span className="text-slate-500 font-normal ml-1">({getAge(user.dob)} years old)</span>
                  )}
                </span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar size={15} className="text-slate-400" />
              Joined {new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </span>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 mt-6 border-t border-slate-100 pt-1">
            <button
              onClick={() => setActiveTab('posts')}
              className={`px-4 py-2.5 text-xs sm:text-sm font-bold border-b-2 transition ${
                activeTab === 'posts' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Posts ({posts.length})
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
              onClick={() => setActiveTab('friends')}
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
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'posts' && (
          <div className="space-y-4">
            {posts.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
                <FileText size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-semibold">No posts yet</p>
              </div>
            ) : (
              posts.map(p => (
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

        {activeTab === 'about' && (
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-900">About {user.name}</h3>
            <div className="space-y-3 text-sm text-slate-700">
              <p><strong>Bio:</strong> {user.bio || 'No bio provided'}</p>
              <p><strong>Email:</strong> {user.email}</p>
              {user.dob && (
                <p>
                  <strong>Date of Birth:</strong> {new Date(user.dob).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                  {getAge(user.dob) !== null && ` (${getAge(user.dob)} years old)`}
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
            <h3 className="text-base font-bold text-slate-900 mb-4">Friends ({friends.length})</h3>
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
      </div>

      {/* Edit Profile Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Edit Profile</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-full">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Profile Picture</label>
                <div className="flex items-center gap-3">
                  <img src={editAvatar} alt="Profile preview" className="w-16 h-16 rounded-full object-cover border border-slate-200 bg-slate-100" />
                  <label className="cursor-pointer px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition">
                    {uploading === 'avatar' ? 'Uploading...' : 'Upload photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      disabled={uploading !== null}
                      onChange={e => handleImageUpload(e, 'avatar')}
                    />
                  </label>
                </div>
                <input
                  type="text"
                  value={editAvatar}
                  onChange={e => setEditAvatar(e.target.value)}
                  placeholder="...or paste an image URL"
                  className="w-full mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Cover Photo</label>
                <img src={editCover} alt="Cover preview" className="w-full h-24 rounded-xl object-cover border border-slate-200 bg-slate-100 mb-2" />
                <label className="inline-block cursor-pointer px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition">
                  {uploading === 'cover' ? 'Uploading...' : 'Upload cover'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={e => handleImageUpload(e, 'cover')}
                  />
                </label>
                <input
                  type="text"
                  value={editCover}
                  onChange={e => setEditCover(e.target.value)}
                  placeholder="...or paste an image URL"
                  className="w-full mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
                {uploadError && <p className="mt-2 text-red-600 font-semibold">{uploadError}</p>}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Bio</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Location</label>
                  <input
                    type="text"
                    value={editLocation}
                    onChange={e => setEditLocation(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Workplace</label>
                  <input
                    type="text"
                    value={editWork}
                    onChange={e => setEditWork(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Education</label>
                <input
                  type="text"
                  value={editEducation}
                  onChange={e => setEditEducation(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Date of Birth</label>
                <input
                  type="date"
                  value={editDob}
                  max={new Date(new Date().setFullYear(new Date().getFullYear() - 13)).toISOString().split('T')[0]}
                  onChange={e => setEditDob(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-full"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
