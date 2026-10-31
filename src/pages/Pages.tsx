import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Page, PagePost } from '../types';
import {
  Flag,
  Plus,
  ThumbsUp,
  UserPlus,
  UserCheck,
  Share2,
  Image as ImageIcon,
  Send,
  ArrowLeft,
  Search,
  CheckCircle,
  Users,
  Compass,
  Sparkles
} from 'lucide-react';

interface PagesProps {
  initialPageId?: string | null;
  onNavigateBack?: () => void;
  onOpenChat?: (user: any) => void;
}

const CATEGORIES = [
  'All',
  'Technology & Gaming',
  'Social Network',
  'Entertainment & Media',
  'Business & Startup',
  'Education & Learning',
  'Art & Design',
  'Sports & Fitness'
];

export const Pages: React.FC<PagesProps> = ({ initialPageId, onNavigateBack }) => {
  const { user, isDeveloper } = useAuth();
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(initialPageId || null);
  const [activeTab, setActiveTab] = useState<'explore' | 'my_pages'>('explore');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal create page
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Technology & Gaming');
  const [newBio, setNewBio] = useState('');
  const [newCover, setNewCover] = useState('');
  const [newAvatar, setNewAvatar] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Post as page
  const [pagePostContent, setPagePostContent] = useState('');
  const [pagePostMedia, setPagePostMedia] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  useEffect(() => {
    loadPages();
  }, []);

  useEffect(() => {
    if (initialPageId) {
      setSelectedPageId(initialPageId);
    }
  }, [initialPageId]);

  const loadPages = async () => {
    setIsLoading(true);
    try {
      const data = await api.getPages();
      setPages(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load pages', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsCreating(true);
    try {
      const created = await api.createPage({
        name: newName.trim(),
        category: newCategory,
        bio: newBio.trim(),
        cover: newCover.trim() || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
        avatar: newAvatar.trim() || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(newName)}`
      });
      setPages(prev => [created, ...prev]);
      setIsCreateModalOpen(false);
      setNewName('');
      setNewBio('');
      setNewCover('');
      setNewAvatar('');
      setSelectedPageId(created.id);
    } catch (e: any) {
      alert(e.message || 'Failed to create page');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleFollow = async (pageId: string) => {
    try {
      const updated = await api.togglePageFollow(pageId);
      setPages(prev => prev.map(p => p.id === pageId ? updated : p));
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleToggleLike = async (pageId: string) => {
    try {
      const updated = await api.togglePageLike(pageId);
      setPages(prev => prev.map(p => p.id === pageId ? updated : p));
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleCreatePagePost = async (pageId: string) => {
    if (!pagePostContent.trim() && !pagePostMedia.trim()) return;
    setIsPosting(true);
    try {
      const newPost = await api.createPagePost(pageId, {
        content: pagePostContent.trim(),
        mediaUrl: pagePostMedia.trim() || undefined,
        mediaType: pagePostMedia.trim() ? 'image' : undefined
      });
      setPages(prev => prev.map(p => {
        if (p.id === pageId) {
          return {
            ...p,
            posts: [newPost, ...(p.posts || [])]
          };
        }
        return p;
      }));
      setPagePostContent('');
      setPagePostMedia('');
    } catch (e: any) {
      alert(e.message || 'Failed to publish post as page');
    } finally {
      setIsPosting(false);
    }
  };

  const activePage = pages.find(p => p.id === selectedPageId);

  // Filtered pages
  const filteredPages = pages.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.bio?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.category?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesTab = activeTab === 'explore' || p.ownerId === user?.id || (p.followers && p.followers.includes(user?.id || ''));
    return matchesSearch && matchesCategory && matchesTab;
  });

  // PAGE DETAIL VIEW
  if (activePage) {
    const isOwner = activePage.ownerId === user?.id || isDeveloper;
    const isFollowing = user ? activePage.followers?.includes(user.id) : false;
    const isLiked = user ? activePage.likes?.includes(user.id) : false;

    return (
      <div className="space-y-4 pb-12">
        {/* Back navigation */}
        <button
          onClick={() => setSelectedPageId(null)}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-xl shadow-sm border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to all Pages
        </button>

        {/* Page Banner & Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="h-48 sm:h-64 w-full bg-slate-800 relative">
            <img
              src={activePage.cover}
              alt={activePage.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </div>

          <div className="px-6 pb-6 pt-3 relative">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-16 sm:-mt-20 mb-4">
              <div className="flex items-end gap-4">
                <img
                  src={activePage.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(activePage.name)}`}
                  alt={activePage.name}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-4 border-white shadow-md bg-white"
                />
                <div className="pb-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-black text-slate-900">{activePage.name}</h1>
                    <CheckCircle size={18} className="text-blue-600 fill-blue-50" />
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                    {activePage.category}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleToggleLike(activePage.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
                    isLiked
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <ThumbsUp size={16} className={isLiked ? 'fill-white' : ''} />
                  {isLiked ? 'Liked' : 'Like'} ({activePage.likes?.length || 0})
                </button>

                <button
                  onClick={() => handleToggleFollow(activePage.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
                    isFollowing
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isFollowing ? <UserCheck size={16} /> : <UserPlus size={16} />}
                  {isFollowing ? 'Following' : 'Follow'} ({activePage.followers?.length || 0})
                </button>
              </div>
            </div>

            {/* Bio */}
            {activePage.bio && (
              <p className="text-sm text-slate-600 mt-2 max-w-2xl leading-relaxed">
                {activePage.bio}
              </p>
            )}

            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-100 text-xs font-semibold text-slate-500">
              <div>
                <strong className="text-slate-900 font-bold">{activePage.followers?.length || 0}</strong> Followers
              </div>
              <div>
                <strong className="text-slate-900 font-bold">{activePage.likes?.length || 0}</strong> Likes
              </div>
              <div>
                <strong className="text-slate-900 font-bold">{activePage.posts?.length || 0}</strong> Posts
              </div>
              <div>
                Created by <span className="text-slate-800 font-bold">{activePage.ownerName || 'Admin'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Post as Page (If owner or developer) */}
        {isOwner && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">
              <Sparkles size={14} />
              Post as {activePage.name}
            </div>
            <textarea
              value={pagePostContent}
              onChange={(e) => setPagePostContent(e.target.value)}
              placeholder={`Write something as ${activePage.name}...`}
              rows={3}
              className="w-full text-sm p-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="mt-2 flex flex-col sm:flex-row gap-2 items-center justify-between">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <ImageIcon size={16} className="text-slate-400" />
                <input
                  type="url"
                  value={pagePostMedia}
                  onChange={(e) => setPagePostMedia(e.target.value)}
                  placeholder="Optional image URL..."
                  className="text-xs p-2 bg-slate-50 rounded-lg border border-slate-200 focus:outline-none flex-1 sm:w-64"
                />
              </div>
              <button
                onClick={() => handleCreatePagePost(activePage.id)}
                disabled={isPosting || (!pagePostContent.trim() && !pagePostMedia.trim())}
                className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Send size={14} />
                {isPosting ? 'Publishing...' : 'Publish Post'}
              </button>
            </div>
          </div>
        )}

        {/* Page Posts Feed */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider px-1">
            Posts ({activePage.posts?.length || 0})
          </h3>

          {(!activePage.posts || activePage.posts.length === 0) ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-slate-500">
              <Flag size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold">No posts on this page yet.</p>
              {isOwner && <p className="text-xs text-slate-400 mt-1">Use the publisher above to share your first announcement!</p>}
            </div>
          ) : (
            activePage.posts.map(post => (
              <div key={post.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <img
                    src={activePage.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(activePage.name)}`}
                    alt={activePage.name}
                    className="w-10 h-10 rounded-xl object-cover border border-slate-200"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      {activePage.name}
                      <CheckCircle size={14} className="text-blue-600 fill-blue-50" />
                    </h4>
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
                    <img src={post.mediaUrl} alt="Post media" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ALL PAGES LIST VIEW
  return (
    <div className="space-y-4 pb-12">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-blue-600 font-extrabold text-lg sm:text-xl">
            <Flag size={24} />
            <h2>Pages & Communities</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Discover brands, creators, tech organizations, and communities on Echat
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <Plus size={18} />
          Create New Page
        </button>
      </div>

      {/* Tabs & Search Filter */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('explore')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'explore'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Explore All Pages
            </button>
            <button
              onClick={() => setActiveTab('my_pages')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'my_pages'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              My Pages & Following
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pages..."
              className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Pages Grid */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400">
          <div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin mx-auto mb-2" />
          <p className="text-xs">Loading pages...</p>
        </div>
      ) : filteredPages.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-slate-200">
          <Flag size={40} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-bold text-slate-700">No pages found</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No pages match "${searchQuery}". Try a different keyword.`
              : 'Be the first to create a brand, media, or tech page on Echat!'}
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 cursor-pointer"
          >
            Create a Page Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredPages.map(page => {
            const isFollowing = user ? page.followers?.includes(user.id) : false;
            const isLiked = user ? page.likes?.includes(user.id) : false;

            return (
              <div
                key={page.id}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div
                    onClick={() => setSelectedPageId(page.id)}
                    className="h-28 w-full bg-slate-800 relative cursor-pointer group"
                  >
                    <img
                      src={page.cover}
                      alt={page.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                    <span className="absolute top-2 right-2 text-[10px] font-bold bg-white/90 text-slate-800 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      {page.category}
                    </span>
                  </div>

                  <div className="p-4 pt-0 relative">
                    <div className="flex items-end gap-3 -mt-8 mb-2">
                      <img
                        onClick={() => setSelectedPageId(page.id)}
                        src={page.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(page.name)}`}
                        alt={page.name}
                        className="w-14 h-14 rounded-xl object-cover border-2 border-white shadow-md bg-white cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <h3
                          onClick={() => setSelectedPageId(page.id)}
                          className="text-sm font-bold text-slate-900 truncate hover:text-blue-600 cursor-pointer"
                        >
                          {page.name}
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          {page.followers?.length || 0} followers • {page.likes?.length || 0} likes
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 mt-2 leading-relaxed">
                      {page.bio || 'No bio provided.'}
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-2 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() => handleToggleFollow(page.id)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      isFollowing
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>

                  <button
                    onClick={() => setSelectedPageId(page.id)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                  >
                    View Page
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE PAGE MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-black text-lg">
                <Flag size={20} className="text-blue-600" />
                <h3>Create New Page</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePage} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Page Name *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Freetown Tech Innovators"
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Category *
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CATEGORIES.filter(c => c !== 'All').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Bio / Description
                </label>
                <textarea
                  value={newBio}
                  onChange={(e) => setNewBio(e.target.value)}
                  rows={2}
                  placeholder="Briefly describe what your page is about..."
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Cover Photo URL (optional)
                </label>
                <input
                  type="url"
                  value={newCover}
                  onChange={(e) => setNewCover(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full text-xs p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Avatar / Logo URL (optional)
                </label>
                <input
                  type="url"
                  value={newAvatar}
                  onChange={(e) => setNewAvatar(e.target.value)}
                  placeholder="https://..."
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
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {isCreating ? 'Creating Page...' : 'Create Page'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
