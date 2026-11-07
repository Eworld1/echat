import { usePreferences } from '../context/PreferencesContext';
import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { Post } from '../types';
import { PostCard } from './PostCard';

interface SavedPostsProps {
  onViewProfile: (userId: string) => void;
}

export const SavedPosts: React.FC<SavedPostsProps> = ({ onViewProfile }) => {
  const [posts, setPosts] = useState<Post[]>([]);
  const { t } = usePreferences();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setPosts(await api.getSavedPosts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your saved posts.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-5 flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
          <Bookmark size={22} />
        </div>
        <div>
          <h1 className="text-lg font-extrabold text-slate-900">{t('saved_posts')}</h1>
          <p className="text-xs text-slate-500">Posts you bookmarked to read later. Only you can see this list.</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={26} />
        </div>
      )}

      {error && !isLoading && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-semibold rounded-2xl p-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="underline">{t('try_again')}</button>
        </div>
      )}

      {!isLoading && !error && posts.length === 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
          <Bookmark className="mx-auto text-slate-300 mb-3" size={36} />
          <p className="font-bold text-slate-700">{t('saved_nothing')}</p>
          <p className="text-sm text-slate-500 mt-1">Tap the ••• menu on any post and choose "Save post".</p>
        </div>
      )}

      {posts.map(post => (
        <PostCard
          key={post.id}
          post={post}
          onPostUpdated={updated => setPosts(prev => prev.map(p => (p.id === updated.id ? updated : p)))}
          onPostDeleted={id => setPosts(prev => prev.filter(p => p.id !== id))}
          onViewProfile={onViewProfile}
        />
      ))}
    </div>
  );
};
