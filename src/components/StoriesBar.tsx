import { avatarSrc } from './UserAvatar';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Story, User } from '../types';
import { api } from '../services/api';
import { auth } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Images, Plus, Sparkles, Type, X } from 'lucide-react';
import { CreateStoryModal } from './CreateStoryModal';
import { CreateStudio } from './reels/CreateStudio';
import { StoryViewer, type StoryGroup, type StoryMusic, type ViewerStory } from './reels/StoryViewer';
import { StoryComposer } from './reels/StoryComposer';
import { DEFAULT_EDIT, listenStories, type Story as FireStory } from '../services/reels/reelsStore';
import { useLiveProfiles } from '../services/liveProfiles';

interface StoriesBarProps {
  /** Opens a chat after replying to a story (Feed). Optional: Reels just shows a confirmation. */
  onOpenChatWithUser?: (user: User) => void;
}

const SEEN_KEY = 'echat_seen_stories';
function readSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[]); } catch { return new Set(); }
}
function writeSeen(seen: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500))); } catch { /* storage unavailable */ }
}

function fromFirestore(story: FireStory): ViewerStory {
  // New TikTok-style photo stories (mediaUrls) play as a carousel with background music.
  const photos = story.mediaType === 'image' && story.mediaUrls?.length ? story.mediaUrls : [];
  const carousel = photos.length > 0 && story.mediaTypes?.length === photos.length;
  return {
    key: `fs_${story.id}`, source: 'firestore', id: story.id, authorId: story.userId, authorName: story.userName, authorAvatar: story.userAvatar,
    createdAt: story.createdAt, kind: story.mediaType, mediaUrl: story.mediaUrl, coverUrl: story.coverUrl,
    edit: story, stickers: story.stickers, views: story.views,
    carousel,
    slides: carousel ? photos.map(url => ({ url, kind: 'image' as const })) : undefined,
    caption: story.caption || '',
    hashtags: story.hashtags || [],
    music: story.musicUrl ? { id: story.soundId, url: story.musicUrl, title: story.musicTitle || 'Music', artist: story.musicArtist || '' } : null,
    likesCount: story.likesCount || 0,
    commentsCount: story.commentsCount || 0,
    savesCount: story.savesCount || 0,
    sharesCount: story.sharesCount || 0
  };
}

/** ?story=<id> from a shared link (opened once, then removed from the address bar). */
function takeStoryParam(): string {
  try { return (new URL(window.location.href).searchParams.get('story') || '').slice(0, 200); } catch { return ''; }
}
function clearStoryParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('story')) return;
    url.searchParams.delete('story');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  } catch { /* ignore */ }
}
function fromLegacy(story: Story): ViewerStory {
  return {
    key: `legacy_${story.id}`, source: 'legacy', id: story.id, authorId: story.authorId, authorName: story.author?.name || 'EChat user', authorAvatar: story.author?.avatar || '',
    createdAt: story.createdAt, kind: story.type, mediaUrl: story.mediaUrl || '', coverUrl: '', text: story.text, background: story.backgroundGradient,
    edit: { ...DEFAULT_EDIT }, stickers: [], views: story.viewers?.length || 0, legacyAuthor: story.author
  };
}

/** Stories row (Feed + Reels): new Firebase stories and older stories, one bubble per person. */
export const StoriesBar: React.FC<StoriesBarProps> = ({ onOpenChatWithUser }) => {
  const { user } = useAuth();
  const { onStoryCreated } = useSocket();
  const uid = auth.currentUser?.uid || user?.id || '';
  const [legacyStories, setLegacyStories] = useState<Story[]>([]);
  const [fireStories, setFireStories] = useState<FireStory[]>([]);
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());
  const [viewerGroup, setViewerGroup] = useState<number | null>(null);
  const [viewerStoryId, setViewerStoryId] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSound, setComposerSound] = useState<StoryMusic | null>(null);
  const [linkedStory] = useState(takeStoryParam);
  const [menuOpen, setMenuOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [storyToast, setStoryToast] = useState('');

  const loadLegacy = useCallback(async () => {
    try {
      const list = await api.getStories();
      const allowedAuthors = new Set([user?.id, ...(user?.friends || [])].filter(Boolean));
      const now = Date.now();
      setLegacyStories(list.filter(story => story.expiresAt > now && allowedAuthors.has(story.authorId)));
    } catch (err) {
      console.error('Failed to load stories:', err);
    }
  }, [user?.id, user?.friends]);

  useEffect(() => {
    void loadLegacy();
    const unsub = onStoryCreated(newStory => setLegacyStories(prev => [newStory, ...prev.filter(s => s.id !== newStory.id)]));
    return () => unsub();
  }, [loadLegacy, onStoryCreated]);

  useEffect(() => listenStories(uid, setFireStories, error => console.warn('[Stories] Could not load stories:', error.message)), [uid]);

  useEffect(() => {
    if (!storyToast) return;
    const timeout = window.setTimeout(() => setStoryToast(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [storyToast]);

  const rawGroups = useMemo<StoryGroup[]>(() => {
    const now = Date.now();
    const all = [
      ...fireStories.filter(story => story.expiresAt > now).map(fromFirestore),
      ...legacyStories.map(fromLegacy)
    ];
    // Older stories the server already marked as viewed by me count as seen.
    const seenNow = new Set(seen);
    for (const story of legacyStories) if (user && story.viewers?.some(viewer => viewer.userId === user.id)) seenNow.add(`legacy_${story.id}`);
    const byAuthor = new Map<string, StoryGroup>();
    for (const story of all.sort((a, b) => a.createdAt - b.createdAt)) {
      const group = byAuthor.get(story.authorId) || { authorId: story.authorId, authorName: story.authorName, authorAvatar: story.authorAvatar, stories: [] };
      group.stories.push(story);
      if (!group.authorAvatar && story.authorAvatar) group.authorAvatar = story.authorAvatar;
      byAuthor.set(story.authorId, group);
    }
    const isUnseen = (group: StoryGroup) => group.stories.some(story => !seenNow.has(story.key));
    return [...byAuthor.values()].sort((a, b) => {
      const ownA = a.authorId === uid ? 0 : 1; const ownB = b.authorId === uid ? 0 : 1;
      if (ownA !== ownB) return ownA - ownB;
      const unseenA = isUnseen(a) ? 0 : 1; const unseenB = isUnseen(b) ? 0 : 1;
      if (unseenA !== unseenB) return unseenA - unseenB;
      return (b.stories[b.stories.length - 1]?.createdAt || 0) - (a.stories[a.stories.length - 1]?.createdAt || 0);
    });
  }, [fireStories, legacyStories, seen, uid, user]);
  // Live names/photos on the story rings and in the viewer (not the copies saved with each story).
  const liveAuthors = useLiveProfiles(rawGroups.map(group => group.authorId));
  const groups = useMemo(() => rawGroups.map(group => {
    const live = liveAuthors[group.authorId];
    return live ? { ...group, authorName: live.name || group.authorName, authorAvatar: live.avatar || group.authorAvatar } : group;
  }), [rawGroups, liveAuthors]);

  // Shared link (?story=…): open that story once it has loaded (only people allowed to see it can).
  useEffect(() => {
    if (!linkedStory || viewerGroup !== null) return;
    const index = groups.findIndex(group => group.stories.some(story => story.id === linkedStory));
    if (index >= 0) { setViewerStoryId(linkedStory); setViewerGroup(index); clearStoryParam(); }
  }, [groups, linkedStory, viewerGroup]);
  useEffect(() => {
    if (!linkedStory) return;
    const timer = window.setTimeout(() => {
      if (new URL(window.location.href).searchParams.has('story')) { clearStoryParam(); setStoryToast('This story has expired or is only visible to friends.'); }
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [linkedStory]);

  const ownGroupIndex = groups.findIndex(group => group.authorId === uid);
  const otherGroups = groups.filter(group => group.authorId !== uid);

  const markSeen = useCallback((story: ViewerStory) => {
    setSeen(current => {
      if (current.has(story.key)) return current;
      const next = new Set(current); next.add(story.key); writeSeen(next); return next;
    });
  }, []);

  const handleReply = async (story: ViewerStory, text: string) => {
    await api.sendMessage({ receiverId: story.authorId, text });
    if (story.legacyAuthor && onOpenChatWithUser && text.startsWith('Replying')) onOpenChatWithUser(story.legacyAuthor);
  };

  const ring = (group: StoryGroup) => group.stories.some(story => !seen.has(story.key))
    ? 'ec-story-ring'
    : 'bg-slate-300 dark:bg-white/20';

  if (!user) return null;
  const ownGroup = ownGroupIndex >= 0 ? groups[ownGroupIndex] : null;

  return (
    <>
      {storyToast && <div role="status" aria-live="polite" className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-[210] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{storyToast}</div>}
      <div className="flex items-start justify-start gap-4 overflow-x-auto pb-3 scrollbar-none select-none ">
        {/* Your Story */}
        <div className="relative flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center sm:w-[76px]">
          <button
            type="button"
            onClick={() => ownGroup ? setViewerGroup(ownGroupIndex) : setMenuOpen(true)}
            aria-label={ownGroup ? 'View your story' : 'Add to your story'}
            className={`h-[68px] w-[68px] rounded-full p-[3px] sm:h-[76px] sm:w-[76px] ${ownGroup ? ring(ownGroup) : 'bg-slate-200'}`}
          >
            <img src={avatarSrc(user.avatar, user.name || '')} alt={user.name || 'Your story'} data-avatar="" data-name={user.name || ''} className="h-full w-full rounded-full border-2 border-white object-cover" />
          </button>
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Add to story" className="ec-gradient absolute right-0 top-[48px] grid h-7 w-7 place-items-center rounded-full border-2 border-white text-white shadow sm:top-[54px]"><Plus size={17} /></button>
          <span className="w-full truncate text-xs font-semibold text-slate-800">Your Story</span>
        </div>

        {otherGroups.map(group => {
          const index = groups.indexOf(group);
          return (
            <button key={group.authorId} type="button" onClick={() => setViewerGroup(index)} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center sm:w-[76px]">
              <span className={`block h-[68px] w-[68px] rounded-full p-[3px] sm:h-[76px] sm:w-[76px] ${ring(group)}`}><img src={avatarSrc(group.authorAvatar, group.authorName)} alt={group.authorName} data-avatar="" data-name={group.authorName} loading="lazy" className="h-full w-full rounded-full border-2 border-white object-cover" /></span>
              <span className="w-full truncate text-xs font-semibold text-slate-800">{group.authorName}</span>
            </button>
          );
        })}
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-[215] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label="Add to story" onClick={() => setMenuOpen(false)}>
          <div className="w-full max-w-sm space-y-2 rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="font-extrabold text-slate-900">Add to Story</h2><button type="button" onClick={() => setMenuOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X size={18} /></button></div>
            <button type="button" onClick={() => { setMenuOpen(false); setComposerSound(null); setComposerOpen(true); }} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[#e2c06e] bg-[#fffbeb] px-4 text-left font-bold text-slate-900"><Images className="text-[#b68428]" />Photos &amp; video<span className="ml-auto text-xs font-normal text-slate-500">up to 10 photos + music</span></button>
            <button type="button" onClick={() => { setMenuOpen(false); setStudioOpen(true); }} className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-[#F2F4F7] px-4 text-left font-bold text-slate-900"><Sparkles className="text-[#1877F2]" />Story studio<span className="ml-auto text-xs font-normal text-slate-500">stickers, polls, effects</span></button>
            <button type="button" onClick={() => { setMenuOpen(false); setTextOpen(true); }} className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-[#F2F4F7] px-4 text-left font-bold text-slate-900"><Type className="text-fuchsia-600" />Text story</button>
          </div>
        </div>
      )}

      {viewerGroup !== null && groups[viewerGroup] && (
        <StoryViewer
          groups={groups}
          startGroup={viewerGroup}
          startStoryId={viewerStoryId || undefined}
          onClose={() => { setViewerGroup(null); setViewerStoryId(''); }}
          onUseSound={music => { setViewerGroup(null); setViewerStoryId(''); setComposerSound(music); setComposerOpen(true); }}
          onSeen={markSeen}
          onReply={handleReply}
          onLegacyView={story => { void api.viewStory(story.id).catch(() => {}); }}
        />
      )}

      {composerOpen && <StoryComposer presetSound={composerSound} onClose={() => setComposerOpen(false)} onCreated={message => { setComposerOpen(false); setStoryToast(message); }} />}
      {studioOpen && <CreateStudio mode="story" onClose={() => setStudioOpen(false)} onCreated={message => { setStudioOpen(false); setStoryToast(message); }} />}

      <CreateStoryModal
        isOpen={textOpen}
        onClose={() => setTextOpen(false)}
        onStoryCreated={() => { setStoryToast('Story shared successfully'); void loadLegacy(); }}
      />
    </>
  );
};
