import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { UserCheck, UserPlus, MessageCircle, X, Search, Users, Rocket, Sparkles } from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';
import confetti from 'canvas-confetti';

interface FriendsViewProps {
  onOpenChat: (user: User) => void;
  onViewProfile: (userId: string) => void;
}

export const FriendsView: React.FC<FriendsViewProps> = ({
  onOpenChat,
  onViewProfile
}) => {
  const { user, refreshUser } = useAuth();
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'requests' | 'friends' | 'suggestions'>('requests');
  const [isLoading, setIsLoading] = useState(true);
  const [sentNow, setSentNow] = useState<Set<string>>(new Set());

  const loadData = async () => {
    setIsLoading(true);
    try {
      const list = await api.getUsers();
      const validList = Array.isArray(list) ? list : [];
      // Developer always at top
      const sorted = [...validList].sort((a, b) => {
        const aIsDev = a.isOfficialDeveloper || a.email?.toLowerCase().trim() === 'eldermoses89@gmail.com' ? 1 : 0;
        const bIsDev = b.isOfficialDeveloper || b.email?.toLowerCase().trim() === 'eldermoses89@gmail.com' ? 1 : 0;
        return bIsDev - aIsDev;
      });
      setAllUsers(sorted);
      await refreshUser();
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (!user) return null;

  const friendsList = allUsers.filter(u => user.friends.includes(u.id));
  const requestsReceived = allUsers.filter(u => user.friendRequestsReceived.includes(u.id));
  const suggestions = allUsers.filter(
    u => u.id !== user.id && !user.friends.includes(u.id) && !user.friendRequestsReceived.includes(u.id)
  );

  const handleAccept = async (fromUserId: string) => {
    await api.acceptFriendRequest(fromUserId);
    confetti({ particleCount: 30, spread: 60 });
    loadData();
  };

  const handleReject = async (fromUserId: string) => {
    await api.rejectFriendRequest(fromUserId);
    loadData();
  };

  const handleSendRequest = async (toUserId: string) => {
    setSentNow(prev => new Set(prev).add(toUserId)); // button flips to "Request Sent" immediately
    try {
      await api.sendFriendRequest(toUserId);
      loadData();
    } catch (err) {
      setSentNow(prev => {
        const next = new Set(prev);
        next.delete(toUserId);
        return next;
      });
      alert(err instanceof Error ? err.message : 'Could not send the friend request. Please try again.');
    }
  };

  const handleUnfriend = async (friendId: string) => {
    if (!confirm('Are you sure you want to unfriend this user?')) return;
    await api.unfriend(friendId);
    loadData();
  };

  const filteredUsers = (list: User[]) => {
    if (!search.trim()) return list;
    return list.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.location.toLowerCase().includes(search.toLowerCase()));
  };

  return (
    <div className="max-w-4xl mx-auto pb-12">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Users className="text-blue-600" />
              Friends
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Connect with coworkers, friends, and creators around the world.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search friends..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 focus:bg-white text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-blue-500 transition"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mt-6 border-t border-slate-100 pt-3">
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-2 ${
              activeTab === 'requests' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Friend Requests
            {requestsReceived.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'requests' ? 'bg-white text-blue-600 font-extrabold' : 'bg-red-500 text-white font-extrabold'}`}>
                {requestsReceived.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('friends')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
              activeTab === 'friends' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Friends ({friendsList.length})
          </button>

          <button
            onClick={() => setActiveTab('suggestions')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
              activeTab === 'suggestions' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Suggestions ({suggestions.length})
          </button>
        </div>
      </div>

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            Pending Friend Requests ({requestsReceived.length})
          </h2>

          {requestsReceived.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
              <UserCheck size={36} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold">No pending friend requests</p>
              <p className="text-xs text-slate-400 mt-1">Check out suggestions to discover new friends!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {filteredUsers(requestsReceived).map(u => (
                <div key={u.id} className="bg-white rounded-2xl overflow-hidden shadow-xs border border-slate-200 flex flex-col">
                  <div className="h-44 overflow-hidden relative cursor-pointer" onClick={() => onViewProfile(u.id)}>
                    <img src={u.avatar} alt={u.name} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                  </div>
                  <div className="p-3.5 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 onClick={() => onViewProfile(u.id)} className="font-bold text-slate-900 text-sm hover:underline cursor-pointer">
                        {u.name}
                      </h4>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{u.location || u.bio}</p>
                    </div>
                    <div className="mt-4 space-y-2">
                      <button
                        onClick={() => handleAccept(u.id)}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition"
                      >
                        Confirm Request
                      </button>
                      <button
                        onClick={() => handleReject(u.id)}
                        className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                      >
                        Delete Request
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Friends Tab */}
      {activeTab === 'friends' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            All Friends ({friendsList.length})
          </h2>

          {friendsList.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
              <Users size={36} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold">You have no friends yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredUsers(friendsList).map(u => {
                const isDev = u.isOfficialDeveloper || u.email?.toLowerCase().trim() === 'eldermoses89@gmail.com';
                const displayName = isDev ? 'EChat Official - Developer' : u.name;

                return (
                  <div key={u.id} className={`rounded-2xl p-4 shadow-xs border flex items-center justify-between gap-3 hover:shadow-md transition ${
                    isDev ? 'bg-purple-50/70 border-purple-200' : 'bg-white border-slate-200'
                  }`}>
                    <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => onViewProfile(u.id)}>
                      <img src={u.avatar} alt={displayName} className={`w-14 h-14 rounded-2xl object-cover border ${
                        isDev ? 'border-purple-300 ring-2 ring-purple-300' : 'border-slate-100'
                      }`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4 className={`font-bold text-sm hover:underline truncate ${
                            isDev ? 'text-purple-950 font-extrabold' : 'text-slate-900'
                          }`}>
                            {displayName}
                          </h4>
                          {(u.isVerified || isDev) && <VerifiedBadge size={14} />}
                        </div>
                        <p className="text-xs text-slate-500 truncate">{isDev ? 'Official Developer Account' : (u.location || u.work || 'Friend')}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => onOpenChat(u)}
                        className="p-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                        title="Send message"
                      >
                        <MessageCircle size={16} />
                      </button>
                      <button
                        onClick={() => handleUnfriend(u.id)}
                        className="p-2 bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600 rounded-xl transition"
                        title="Unfriend"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Suggestions Tab */}
      {activeTab === 'suggestions' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900">
            People You May Know ({suggestions.length})
          </h2>

          {filteredUsers(suggestions).length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
              <Users size={36} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold">No friend suggestions right now</p>
              <p className="text-xs text-slate-400 mt-1">When new users register on Echat, they'll appear here!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {filteredUsers(suggestions).map(u => {
                const isSent = user.friendRequestsSent.includes(u.id) || sentNow.has(u.id);
                const isDev = u.isOfficialDeveloper || u.email?.toLowerCase().trim() === 'eldermoses89@gmail.com';
                const displayName = isDev ? 'EChat Official - Developer' : u.name;

                return (
                  <div key={u.id} className={`rounded-2xl overflow-hidden shadow-xs border flex flex-col ${
                    isDev ? 'bg-purple-50/60 border-purple-200' : 'bg-white border-slate-200'
                  }`}>
                    <div className="h-44 overflow-hidden relative cursor-pointer" onClick={() => onViewProfile(u.id)}>
                      <img src={u.avatar} alt={displayName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                      {isDev && (
                        <div className="absolute top-2 left-2 bg-purple-700/90 backdrop-blur-xs text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-md">
                          <Sparkles size={11} /> Official Developer
                        </div>
                      )}
                    </div>
                    <div className="p-3.5 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 onClick={() => onViewProfile(u.id)} className="font-bold text-slate-900 text-sm hover:underline cursor-pointer">
                            {displayName}
                          </h4>
                          {(u.isVerified || isDev) && <VerifiedBadge size={14} />}
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{isDev ? 'EChat Creator & Admin' : (u.location || u.work || u.email)}</p>
                      </div>
                      <div className="mt-4">
                        {isSent ? (
                          <button
                            disabled
                            className="w-full py-2 bg-slate-100 text-slate-400 rounded-xl text-xs font-bold cursor-not-allowed"
                          >
                            Request Sent
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSendRequest(u.id)}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <UserPlus size={15} />
                            Add Friend
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
