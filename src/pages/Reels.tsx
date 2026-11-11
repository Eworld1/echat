import React, { useCallback, useEffect, useState } from 'react';
import { Film, Plus, Sparkles } from 'lucide-react';
import { api } from '../services/api';
import { Post } from '../types';
import { ReelsViewer } from '../components/ReelsViewer';
import { ReelThumbnail } from '../components/ReelThumbnail';
import { CreatePostModal } from '../components/CreatePostModal';
import { useSocket } from '../context/SocketContext';

interface ReelsProps {
  onViewProfile: (userId: string) => void;
}

export const Reels: React.FC<ReelsProps> = ({ onViewProfile }) => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  const { onNewPost, onPostUpdated, onPostDeleted } = useSocket();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const allPosts = await api.getPosts();
      setPosts(allPosts.filter(post => post.type === 'reel' && post.mediaType === 'video' && post.mediaUrl && post.privacy === 'public'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const stopNew = onNewPost(post => {
      if (post.type === 'reel' && post.mediaType === 'video' && post.mediaUrl && post.privacy === 'public') {
        setPosts(current => [post, ...current.filter(item => item.id !== post.id)]);
      }
    });
    const stopUpdate = onPostUpdated(post => {
      setPosts(current => current.map(item => item.id === post.id ? post : item).filter(item => item.privacy === 'public'));
    });
    const stopDelete = onPostDeleted(id => setPosts(current => current.filter(item => item.id !== id)));
    return () => { stopNew(); stopUpdate(); stopDelete(); };
  }, [load, onNewPost, onPostUpdated, onPostDeleted]);

  return (
    <div className="mx-auto max-w-[620px] space-y-4 pb-16">
      <header className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-100 text-fuchsia-700"><Film size={21} /></span>
          <div><h1 className="font-extrabold text-slate-900">Reels</h1><p className="text-xs text-slate-500">Short public videos from the eChat community</p></div>
        </div>
        <button onClick={() => setShowComposer(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-bold text-white hover:bg-fuchsia-700"><Plus size={15} /> Create Reel</button>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading Reels…</div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <Sparkles size={30} className="mx-auto mb-2 text-fuchsia-500" />
          <p className="font-bold text-slate-800">No public video posts yet</p>
          <p className="mt-1 text-sm text-slate-500">Create a Reel to start the video feed.</p>
          <button onClick={() => setShowComposer(true)} className="mt-4 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700">Create your first Reel</button>
        </div>
      ) : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{posts.map(post => <ReelThumbnail key={post.id} post={post} onClick={() => setSelectedReelId(post.id)} />)}</div>}

      <CreatePostModal isOpen={showComposer} onClose={() => setShowComposer(false)} onPostCreated={load} forcePublic videoOnly title="Create a public Reel" />
      {selectedReelId && <ReelsViewer posts={posts} initialPostId={selectedReelId} onClose={() => setSelectedReelId(null)} onPostUpdated={updated => setPosts(current => current.map(item => item.id === updated.id ? updated : item))} onPostDeleted={id => { setSelectedReelId(null); setPosts(current => current.filter(item => item.id !== id)); }} onViewProfile={onViewProfile} />}
    </div>
  );
};
