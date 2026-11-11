import React, { useEffect, useState } from 'react';
import { Eye, Heart, MessageCircle, Users, FileText, TrendingUp } from 'lucide-react';
import { api } from '../services/api';
import type { Post } from '../types';
import { ReelsViewer } from '../components/ReelsViewer';
import { ReelThumbnail } from '../components/ReelThumbnail';
import { CreatePostModal } from '../components/CreatePostModal';

type DashboardData = { stats: { views: number; likes: number; comments: number; followers: number; posts: number }; viewsByDay: { date: string; views: number }[]; posts: Post[]; reels?: Post[] };

export const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [period, setPeriod] = useState<7 | 30>(7);
  const [contentTab, setContentTab] = useState<'posts' | 'reels'>('posts');
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  const [isCreateReelOpen, setIsCreateReelOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const refresh = () => api.getDashboard().then(value => { if (mounted) setData(value); }).catch(err => { if (mounted) setError(err instanceof Error ? err.message : 'Could not load dashboard'); });
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  const days = data?.viewsByDay.slice(-period) || [];
  const maxViews = Math.max(1, ...days.map(day => day.views));
  const cards = [
    { label: 'Post views', value: data?.stats.views ?? 0, Icon: Eye, color: 'text-cyan-300' },
    { label: 'Likes', value: data?.stats.likes ?? 0, Icon: Heart, color: 'text-rose-300' },
    { label: 'Comments', value: data?.stats.comments ?? 0, Icon: MessageCircle, color: 'text-blue-300' },
    { label: 'Followers', value: data?.stats.followers ?? 0, Icon: Users, color: 'text-violet-300' },
    { label: 'Posts', value: data?.stats.posts ?? 0, Icon: FileText, color: 'text-amber-300' }
  ];
  const selectedReel = data?.reels?.find(reel => reel.id === selectedReelId) || null;
  const updateReel = (updated: Post) => setData(current => current ? { ...current, reels: current.reels?.map(reel => reel.id === updated.id ? updated : reel) } : current);
  return <section className="mx-auto w-full max-w-[940px] space-y-6 px-1 pb-16 text-white sm:px-0">
    <header><p className="text-sm text-slate-400">Your content performance</p><h1 className="text-2xl font-black">Creator Dashboard</h1></header>
    {error && <p className="rounded-xl bg-rose-950 p-4 text-rose-200">{error}</p>}
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">{cards.map(({ label, value, Icon, color }) => <article key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg"><div className="flex justify-between"><span className="text-xs text-slate-400">{label}</span><Icon size={18} className={color} /></div><p className="mt-3 text-2xl font-black">{value.toLocaleString()}</p></article>)}</div>
    <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Post views</h2><p className="text-xs text-slate-400">Daily views over the selected period</p></div><div className="flex gap-2">{([7, 30] as const).map(value => <button key={value} onClick={() => setPeriod(value)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${period === value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Last {value} days</button>)}</div></div>
      <div className="mt-5 flex h-44 items-end gap-1 border-b border-slate-700 pb-1">{days.map(day => <div key={day.date} title={`${day.date}: ${day.views} views`} className="group flex h-full min-w-0 flex-1 flex-col justify-end"><div className="w-full rounded-t bg-gradient-to-t from-blue-700 to-cyan-400" style={{ height: `${Math.max(day.views ? 5 : 1, day.views / maxViews * 100)}%` }} /></div>)}</div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-500"><span>{days[0]?.date}</span><span>{days.at(-1)?.date}</span></div>
    </article>
    <article className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-5"><TrendingUp className="text-emerald-300" size={20} /><h2 className="font-bold">Your content</h2><div className="ml-auto flex gap-1">{(['posts', 'reels'] as const).map(tab => <button key={tab} onClick={() => setContentTab(tab)} className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${contentTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>{tab} ({tab === 'posts' ? data?.posts.length || 0 : data?.reels?.length || 0})</button>)}</div></div>
      {contentTab === 'posts' ? <div className="divide-y divide-slate-800">{data?.posts.map((post, index) => <PostRow key={post.id} post={post} top={index === 0 && (post.viewsCount || 0) > 0} />)}{data && !data.posts.length && <p className="p-8 text-center text-sm text-slate-400">Your posts and their stats will appear here.</p>}</div> : <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">{data?.reels?.map(reel => <ReelThumbnail key={reel.id} post={reel} onClick={() => setSelectedReelId(reel.id)} />)}{data && !data.reels?.length && <div className="col-span-full p-8 text-center"><p className="text-sm text-slate-400">No Reels yet</p><button type="button" onClick={() => setIsCreateReelOpen(true)} className="mt-3 min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white">Create Reel</button></div>}</div>}
    </article>
    {isCreateReelOpen && <CreatePostModal isOpen onClose={() => setIsCreateReelOpen(false)} onPostCreated={() => { void api.getDashboard().then(setData).catch(() => {}); }} forcePublic videoOnly title="Create a public Reel" />}
    {selectedReel && data?.reels && <ReelsViewer posts={data.reels} initialPostId={selectedReel.id} onClose={() => setSelectedReelId(null)} onPostUpdated={updateReel} onPostDeleted={() => { setSelectedReelId(null); void api.getDashboard().then(setData).catch(() => {}); }} onViewProfile={() => {}} />}
  </section>;
};

const PostRow: React.FC<{ post: Post; top: boolean }> = ({ post, top }) => <div className="flex items-center gap-3 p-4 sm:gap-4">
  {post.mediaUrl ? <img src={post.mediaUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-800"><FileText size={20} className="text-slate-400" /></div>}
  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2">{top && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">Top post</span>}<span className="text-xs text-slate-500">{new Date(post.createdAt).toLocaleDateString()}</span></div><p className="mt-1 truncate text-sm text-slate-200">{post.content || 'Media post'}</p></div>
  <div className="hidden shrink-0 grid-cols-3 gap-4 text-center sm:grid"><Metric icon={<Eye size={14} />} value={post.viewsCount || 0} label="Views" /><Metric icon={<Heart size={14} />} value={post.reactions.length} label="Likes" /><Metric icon={<MessageCircle size={14} />} value={post.comments.length} label="Comments" /></div>
  <div className="shrink-0 text-right text-sm font-bold sm:hidden">{post.viewsCount || 0}<span className="block text-[10px] font-normal text-slate-500">views</span></div>
</div>;

const Metric: React.FC<{ icon: React.ReactNode; value: number; label: string }> = ({ icon, value, label }) => <div className="min-w-14"><div className="flex items-center justify-center gap-1 text-slate-300">{icon}<span>{value}</span></div><span className="text-[10px] text-slate-500">{label}</span></div>;
