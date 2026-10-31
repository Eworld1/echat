import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Group, GroupPost } from '../types';
import {
  Users2,
  Plus,
  Lock,
  Globe,
  UserCheck,
  UserPlus,
  LogOut,
  Send,
  Image as ImageIcon,
  ArrowLeft,
  Search,
  ShieldCheck,
  Check,
  Sparkles,
  AlertCircle
} from 'lucide-react';

interface GroupsProps {
  initialGroupId?: string | null;
  onNavigateBack?: () => void;
  onOpenChat?: (user: any) => void;
}

export const Groups: React.FC<GroupsProps> = ({ initialGroupId }) => {
  const { user, isDeveloper } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroupId || null);
  const [activeTab, setActiveTab] = useState<'explore' | 'joined'>('explore');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Create Group Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrivacy, setNewPrivacy] = useState<'public' | 'private'>('public');
  const [newDescription, setNewDescription] = useState('');
  const [newCover, setNewCover] = useState('');
  const [newAvatar, setNewAvatar] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Group Post creation
  const [groupPostContent, setGroupPostContent] = useState('');
  const [groupPostMedia, setGroupPostMedia] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  useEffect(() => {
    loadGroups();
  }, []);

  useEffect(() => {
    if (initialGroupId) {
      setSelectedGroupId(initialGroupId);
    }
  }, [initialGroupId]);

  const loadGroups = async () => {
    setIsLoading(true);
    try {
      const data = await api.getGroups();
      setGroups(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load groups', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsCreating(true);
    try {
      const created = await api.createGroup({
        name: newName.trim(),
        privacy: newPrivacy,
        description: newDescription.trim(),
        cover: newCover.trim() || 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
        avatar: newAvatar.trim() || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(newName)}`
      });
      setGroups(prev => [created, ...prev]);
      setIsCreateModalOpen(false);
      setNewName('');
      setNewDescription('');
      setNewCover('');
      setNewAvatar('');
      setSelectedGroupId(created.id);
    } catch (e: any) {
      alert(e.message || 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinGroup = async (groupId: string) => {
    try {
      const updated = await api.joinGroup(groupId);
      setGroups(prev => prev.map(g => g.id === groupId ? updated : g));
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    try {
      const updated = await api.leaveGroup(groupId);
      setGroups(prev => prev.map(g => g.id === groupId ? updated : g));
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleCreateGroupPost = async (groupId: string) => {
    if (!groupPostContent.trim() && !groupPostMedia.trim()) return;
    setIsPosting(true);
    try {
      const newPost = await api.createGroupPost(groupId, {
        content: groupPostContent.trim(),
        mediaUrl: groupPostMedia.trim() || undefined,
        mediaType: groupPostMedia.trim() ? 'image' : undefined
      });
      setGroups(prev => prev.map(g => {
        if (g.id === groupId) {
          return {
            ...g,
            posts: [newPost, ...(g.posts || [])]
          };
        }
        return g;
      }));
      setGroupPostContent('');
      setGroupPostMedia('');
    } catch (e: any) {
      alert(e.message || 'Failed to post to group');
    } finally {
      setIsPosting(false);
    }
  };

  const handleApprovePost = async (groupId: string, postId: string) => {
    try {
      await api.approveGroupPost(groupId, postId);
      setGroups(prev => prev.map(g => {
        if (g.id === groupId) {
          return {
            ...g,
            posts: (g.posts || []).map(p => p.id === postId ? { ...p, status: 'approved' } : p)
          };
        }
        return g;
      }));
    } catch (e: any) {
      alert(e.message || 'Failed to approve post');
    }
  };

  const activeGroup = groups.find(g => g.id === selectedGroupId);

  const filteredGroups = groups.filter(g => {
    const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const isMember = user ? (g.members && g.members.includes(user.id)) : false;
    const matchesTab = activeTab === 'explore' || isMember;
    return matchesSearch && matchesTab;
  });

  // GROUP DETAIL VIEW
  if (activeGroup) {
    const isOwner = activeGroup.ownerId === user?.id || isDeveloper;
    const isMember = user ? (activeGroup.members && activeGroup.members.includes(user.id)) : false;
    const approvedPosts = (activeGroup.posts || []).filter(p => p.status === 'approved');
    const pendingPosts = (activeGroup.posts || []).filter(p => p.status === 'pending');

    return (
      <div className="space-y-4 pb-12">
        {/* Back navigation */}
        <button
          onClick={() => setSelectedGroupId(null)}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-xl shadow-sm border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to all Groups
        </button>

        {/* Group Banner & Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="h-44 sm:h-56 w-full bg-slate-800 relative">
            <img
              src={activeGroup.cover}
              alt={activeGroup.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </div>

          <div className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900">{activeGroup.name}</h1>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                    activeGroup.privacy === 'private' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {activeGroup.privacy === 'private' ? <Lock size={12} /> : <Globe size={12} />}
                    {activeGroup.privacy === 'private' ? 'Private Group' : 'Public Group'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {activeGroup.members?.length || 0} members • Managed by <strong className="text-slate-700">{activeGroup.ownerName || 'Admin'}</strong>
                </p>
              </div>

              {/* Join / Leave Buttons */}
              <div className="flex items-center gap-2">
                {isMember ? (
                  <button
                    onClick={() => handleLeaveGroup(activeGroup.id)}
                    className="px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 text-slate-700 hover:bg-red-50 hover:text-red-600 transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <LogOut size={16} />
                    Leave Group
                  </button>
                ) : (
                  <button
                    onClick={() => handleJoinGroup(activeGroup.id)}
                    className="px-5 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <UserPlus size={16} />
                    Join Group
                  </button>
                )}
              </div>
            </div>

            {/* Description */}
            {activeGroup.description && (
              <p className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100 leading-relaxed">
                {activeGroup.description}
              </p>
            )}
          </div>
        </div>

        {/* Admin Post Approval Panel */}
        {isOwner && pendingPosts.length > 0 && (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-extrabold text-amber-800 uppercase tracking-wider">
              <ShieldCheck size={16} />
              Admin Moderation: Pending Post Approvals ({pendingPosts.length})
            </div>

            <div className="space-y-2">
              {pendingPosts.map(p => (
                <div key={p.id} className="bg-white rounded-xl p-3 border border-amber-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <img
                      src={p.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(p.authorName)}`}
                      alt={p.authorName}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">{p.authorName}</h4>
                      <p className="text-xs text-slate-700 mt-0.5">{p.content}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleApprovePost(activeGroup.id, p.id)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-1 cursor-pointer shrink-0"
                  >
                    <Check size={14} />
                    Approve Post
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Member Post Composer */}
        {isMember ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 mb-2">
              <Sparkles size={14} className="text-blue-600" />
              Write something to the group...
            </div>
            <textarea
              value={groupPostContent}
              onChange={(e) => setGroupPostContent(e.target.value)}
              placeholder="Share an update, idea, or ask a question to group members..."
              rows={3}
              className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="mt-2 flex flex-col sm:flex-row gap-2 items-center justify-between">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <ImageIcon size={16} className="text-slate-400" />
                <input
                  type="url"
                  value={groupPostMedia}
                  onChange={(e) => setGroupPostMedia(e.target.value)}
                  placeholder="Optional image URL..."
                  className="text-xs p-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none flex-1 sm:w-64"
                />
              </div>
              <button
                onClick={() => handleCreateGroupPost(activeGroup.id)}
                disabled={isPosting || (!groupPostContent.trim() && !groupPostMedia.trim())}
                className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <Send size={14} />
                {isPosting ? 'Posting...' : 'Post to Group'}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-blue-50 rounded-2xl border border-blue-200 p-4 text-center">
            <AlertCircle size={24} className="mx-auto text-blue-600 mb-1" />
            <p className="text-xs font-bold text-blue-900">Join this group to post and participate in discussions</p>
            <button
              onClick={() => handleJoinGroup(activeGroup.id)}
              className="mt-2 px-4 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 cursor-pointer"
            >
              Join Group Now
            </button>
          </div>
        )}

        {/* Group Feed */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider px-1">
            Group Feed ({approvedPosts.length})
          </h3>

          {approvedPosts.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-slate-500">
              <Users2 size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold">No approved posts yet in this group.</p>
              {isMember && <p className="text-xs text-slate-400 mt-1">Start the conversation with your first post!</p>}
            </div>
          ) : (
            approvedPosts.map(post => (
              <div key={post.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <img
                    src={post.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(post.authorName)}`}
                    alt={post.authorName}
                    className="w-10 h-10 rounded-full object-cover border border-slate-200"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{post.authorName}</h4>
                    <span className="text-[11px] text-slate-400">
                      {new Date(post.createdAt).toLocaleDateString()} at {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {post.content}
                </p>

                {post.mediaUrl && (
                  <div className="rounded-xl overflow-hidden max-h-96 bg-black">
                    <img src={post.mediaUrl} alt="Group post media" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ALL GROUPS LIST VIEW
  return (
    <div className="space-y-4 pb-12">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-extrabold text-lg sm:text-xl">
            <Users2 size={24} />
            <h2>Groups & Communities</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Connect with people who share your passions, tech stack, and goals
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <Plus size={18} />
          Create New Group
        </button>
      </div>

      {/* Tabs & Search */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('explore')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeTab === 'explore'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Explore Groups
          </button>
          <button
            onClick={() => setActiveTab('joined')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeTab === 'joined'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Joined Groups ({groups.filter(g => user && g.members?.includes(user.id)).length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search groups..."
            className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Groups Grid */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mx-auto mb-2" />
          <p className="text-xs">Loading groups...</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-slate-200">
          <Users2 size={40} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-bold text-slate-700">No groups found</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No groups match "${searchQuery}".`
              : 'Create a group to start collaborating with like-minded friends!'}
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 cursor-pointer"
          >
            Create a Group Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredGroups.map(group => {
            const isMember = user ? (group.members && group.members.includes(user.id)) : false;

            return (
              <div
                key={group.id}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div
                    onClick={() => setSelectedGroupId(group.id)}
                    className="h-28 w-full bg-slate-800 relative cursor-pointer group"
                  >
                    <img
                      src={group.cover}
                      alt={group.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                    <span className="absolute top-2 right-2 text-[10px] font-bold bg-white/90 text-slate-800 backdrop-blur-sm px-2 py-0.5 rounded-full flex items-center gap-1">
                      {group.privacy === 'private' ? <Lock size={10} /> : <Globe size={10} />}
                      {group.privacy === 'private' ? 'Private' : 'Public'}
                    </span>
                  </div>

                  <div className="p-4 pt-3">
                    <h3
                      onClick={() => setSelectedGroupId(group.id)}
                      className="text-sm font-bold text-slate-900 truncate hover:text-indigo-600 cursor-pointer"
                    >
                      {group.name}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {group.members?.length || 0} members
                    </p>

                    <p className="text-xs text-slate-600 line-clamp-2 mt-2 leading-relaxed">
                      {group.description || 'No description provided.'}
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-2 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() => isMember ? handleLeaveGroup(group.id) : handleJoinGroup(group.id)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      isMember
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {isMember ? <UserCheck size={14} /> : <UserPlus size={14} />}
                    {isMember ? 'Joined' : 'Join Group'}
                  </button>

                  <button
                    onClick={() => setSelectedGroupId(group.id)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                  >
                    View
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE GROUP MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-black text-lg">
                <Users2 size={20} className="text-indigo-600" />
                <h3>Create New Group</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Group Name *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Freetown Developers & Builders"
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Privacy *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewPrivacy('public')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                      newPrivacy === 'public'
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <Globe size={14} className="text-indigo-600" />
                      Public
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Anyone can see who is in the group and what they post.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewPrivacy('private')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                      newPrivacy === 'private'
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <Lock size={14} className="text-indigo-600" />
                      Private
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Only members can see who is in the group and what they post.</p>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                  placeholder="What is the purpose of this group?"
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Cover Image URL (optional)
                </label>
                <input
                  type="url"
                  value={newCover}
                  onChange={(e) => setNewCover(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full text-xs p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newName.trim()}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {isCreating ? 'Creating Group...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
