import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Eye, ImagePlus, Loader2, Music2, Pause, Play, Plus, Search, Upload, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { cloudinaryVideoPoster } from '../../services/upload';
import { compressImage } from '../../utils/image';
import { TRENDING_SOUNDS } from '../../services/reels/soundCatalog';
import {
  DEFAULT_EDIT, IMAGE_SECONDS, MAX_STORY_SECONDS, createCarouselStory, ensureSoundsSeeded, extractHashtags, listenSavedSounds, listenSoundUseCounts,
  storyViewers, uploadMedia, validateMediaFile, type MediaEdit, type SavedSound
} from '../../services/reels/reelsStore';
import { StoryViewer, type StoryGroup, type StoryMusic } from './StoryViewer';

/**
 * TikTok-style story composer: up to 10 photos (drag to reorder) or 1 video (max 60 s),
 * caption + hashtags + background music, full-screen preview, then post.
 * Photos are shrunk to 1080 px / 80 % JPEG before upload (fast on slow networks).
 */

const MAX_PHOTOS = 10;
const GOLD = '#f5c518';
const AUDIO_MAX_BYTES = 10 * 1024 * 1024;
const SALONE_SOUND_IDS = ['trend_01', 'trend_02', 'trend_03', 'trend_04', 'trend_05'];

interface Item { id: string; file: File; url: string; kind: 'image' | 'video'; duration: number }
type ChosenMusic = StoryMusic & { file?: File };

const newId = () => Math.random().toString(36).slice(2, 10);

function videoDuration(url: string): Promise<number> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const timer = window.setTimeout(() => resolve(0), 8000);
    video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(Number.isFinite(video.duration) ? video.duration : 0); };
    video.onerror = () => { window.clearTimeout(timer); resolve(0); };
    video.src = url;
  });
}

export const StoryComposer: React.FC<{ onClose: () => void; onCreated: (message: string) => void; presetSound?: StoryMusic | null }> = ({ onClose, onCreated, presetSound }) => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || '';
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [music, setMusic] = useState<ChosenMusic | null>(presetSound || null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const cancelUpload = useRef<() => void>(() => {});
  const cancelled = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const isVideo = items[0]?.kind === 'video';
  const current = items.find(item => item.id === selected) || items[0];

  // Revoke local preview URLs when the composer closes.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const localUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.current.push(url); return url; };

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer); }, [notice]);

  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setError('');
    const videos = files.filter(file => file.type.startsWith('video/'));
    if (videos.length) {
      if (files.length > 1 || items.length) { setError('Choose up to 10 photos, or 1 video on its own.'); return; }
      try {
        validateMediaFile(videos[0], 'story');
        const url = localUrl(videos[0]);
        const duration = await videoDuration(url);
        if (duration > MAX_STORY_SECONDS + 0.5) { setError(`Video must be ${MAX_STORY_SECONDS} seconds or less (this one is ${Math.round(duration)}s).`); return; }
        const item: Item = { id: newId(), file: videos[0], url, kind: 'video', duration };
        setItems([item]);
        setSelected(item.id);
      } catch (err) { setError(err instanceof Error ? err.message : 'Could not use this video.'); }
      return;
    }
    if (isVideo) { setError('A story can have 1 video, or up to 10 photos, not both.'); return; }
    const room = MAX_PHOTOS - items.length;
    if (room <= 0) { setNotice('You can add up to 10 photos.'); return; }
    const chosen = files.slice(0, room);
    if (files.length > room) setNotice(`Only ${room} more photo${room === 1 ? '' : 's'} fit (max 10). The rest were skipped.`);
    setPreparing(true);
    const added: Item[] = [];
    for (const file of chosen) {
      try {
        validateMediaFile(file, 'story');
        const small = await compressImage(file, 1080, 0.8);
        added.push({ id: newId(), file: small, url: localUrl(small), kind: 'image', duration: IMAGE_SECONDS });
      } catch (err) { setError(err instanceof Error ? `${file.name}: ${err.message}` : 'Some photos could not be used.'); }
    }
    setPreparing(false);
    if (added.length) { setItems(currentItems => [...currentItems, ...added].slice(0, MAX_PHOTOS)); setSelected(selectedId => selectedId || added[0].id); }
  };

  const remove = (id: string) => {
    setItems(currentItems => currentItems.filter(item => item.id !== id));
    if (selected === id) setSelected('');
  };
  const move = (from: number, to: number) => setItems(currentItems => {
    if (to < 0 || to >= currentItems.length || from === to) return currentItems;
    const copy = [...currentItems];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
  });

  /* ---- drag to reorder (pointer events: works with touch and mouse) ---- */
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{ id: string; x: number; y: number; started: boolean; timer: number } | null>(null);
  const [dragId, setDragId] = useState('');
  const onTileDown = (event: React.PointerEvent, id: string) => {
    if ((event.target as HTMLElement).closest('[data-no-drag]')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const timer = window.setTimeout(() => { if (drag.current) { drag.current.started = true; setDragId(id); } }, 180);
    drag.current = { id, x: event.clientX, y: event.clientY, started: false, timer };
  };
  const onTileMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    if (!state.started) {
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 8) return;
      window.clearTimeout(state.timer); state.started = true; setDragId(state.id);
    }
    let target = -1;
    let best = Infinity;
    items.forEach((item, index) => {
      const rect = tileRefs.current.get(item.id)?.getBoundingClientRect();
      if (!rect) return;
      const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      if (distance < best) { best = distance; target = index; }
    });
    const from = items.findIndex(item => item.id === state.id);
    if (target >= 0 && from >= 0 && target !== from) move(from, target);
  };
  const onTileUp = (id: string) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    window.clearTimeout(state.timer);
    if (!state.started) setSelected(id);
    setDragId('');
  };

  const hashtags = useMemo(() => extractHashtags(`${caption} ${hashtagInput.split(/[\s,]+/).filter(Boolean).map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`), [caption, hashtagInput]);

  const edit = (): MediaEdit => ({
    ...DEFAULT_EDIT,
    trimStart: 0,
    trimEnd: isVideo ? Math.min(items[0].duration || MAX_STORY_SECONDS, MAX_STORY_SECONDS) : IMAGE_SECONDS,
    soundId: music?.id || '',
    soundName: music?.title || '',
    soundArtist: music?.artist || '',
    soundUrl: music?.url || '',
    musicVolume: 0.8,
    originalVolume: music ? 0.3 : 1
  });

  const previewGroups = useMemo<StoryGroup[]>(() => {
    if (!items.length || !user) return [];
    const base = {
      key: 'preview', source: 'firestore' as const, id: 'preview', authorId: uid || user.id, authorName: user.name, authorAvatar: user.avatar || '',
      createdAt: Date.now(), coverUrl: '', stickers: [], views: 0, caption: caption.trim(), hashtags, music: music ? { id: music.id, url: music.url, title: music.title, artist: music.artist } : null
    };
    const story = isVideo
      ? { ...base, kind: 'video' as const, mediaUrl: items[0].url, edit: edit() }
      : { ...base, kind: 'image' as const, mediaUrl: items[0].url, edit: { ...DEFAULT_EDIT }, carousel: true, slides: items.map(item => ({ url: item.url, kind: 'image' as const })) };
    return [{ authorId: base.authorId, authorName: base.authorName, authorAvatar: base.authorAvatar, stories: [story] }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, music, caption, hashtags, user, uid, isVideo]);

  const publish = async () => {
    if (!user || !uid) { setError('Please sign in again.'); return; }
    if (!items.length) { setError('Add at least one photo or video.'); return; }
    setError('');
    cancelled.current = false;
    setProgress(0);
    try {
      const total = items.length + (music?.file ? 1 : 0);
      const mediaUrls: string[] = [];
      for (const [index, item] of items.entries()) {
        const upload = uploadMedia('stories', uid, item.file, percent => setProgress(Math.round(((index + percent / 100) / total) * 92)));
        cancelUpload.current = upload.cancel;
        mediaUrls.push(await upload.promise);
        if (cancelled.current) return;
      }
      let musicUrl = music?.url || '';
      if (music?.file) {
        const upload = uploadMedia('stories', uid, music.file, percent => setProgress(Math.round(((items.length + percent / 100) / total) * 92)));
        cancelUpload.current = upload.cancel;
        musicUrl = await upload.promise;
      }
      if (cancelled.current) return;
      setProgress(95);
      const friends = Array.isArray(user.friends) ? user.friends : [];
      await createCarouselStory({
        ...edit(),
        soundUrl: musicUrl,
        userId: uid,
        userName: user.name,
        userAvatar: user.avatar || '',
        mediaUrls,
        mediaTypes: items.map(item => item.kind),
        coverUrl: isVideo ? cloudinaryVideoPoster(mediaUrls[0]) : mediaUrls[0],
        caption: caption.trim(),
        hashtags,
        stickers: [],
        allowedViewers: storyViewers({ id: uid, friends }),
        fromReelId: ''
      });
      setProgress(100);
      onCreated(items.length > 1 ? `Story shared (${items.length} photos)` : 'Story shared');
    } catch (err) {
      if (cancelled.current) return;
      setProgress(null);
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setError(/permission/i.test(message) ? 'Could not post. Verify your account, then try again.' : message);
    }
  };

  const cancel = () => { cancelled.current = true; cancelUpload.current(); setProgress(null); };
  const busy = progress !== null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#0b0b0d] text-white" role="dialog" aria-modal="true" aria-label="New story" style={{ colorScheme: 'dark' }}>
      <header className="flex min-h-14 items-center gap-2 border-b border-white/10 px-3 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={() => (items.length && !busy ? (window.confirm('Discard this story?') && onClose()) : onClose())} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10">{items.length ? <ArrowLeft size={20} /> : <X size={20} />}</button>
        <h2 className="flex-1 text-base font-extrabold">New Story</h2>
        {items.length > 0 && <button type="button" onClick={() => void publish()} disabled={busy || preparing} className="min-h-10 rounded-full px-5 text-sm font-extrabold text-black disabled:opacity-60" style={{ background: GOLD }}>{busy ? 'Posting…' : 'Post'}</button>}
      </header>

      {busy && (
        <div className="border-b border-white/10 px-4 py-2" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-xs font-bold"><span>{progress! < 100 ? `Uploading ${items.length > 1 ? `${items.length} photos` : isVideo ? 'video' : 'photo'}…` : 'Done!'}</span><span>{progress}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full transition-[width]" style={{ width: `${progress}%`, background: GOLD }} /></div>
          {progress! < 95 && <button type="button" onClick={cancel} className="mt-1 text-xs font-semibold text-rose-300">Cancel upload</button>}
        </div>
      )}
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl bg-rose-500/15 p-3 text-sm font-semibold text-rose-200">{error}</p>}
      {notice && <p role="status" className="mx-4 mt-3 rounded-xl bg-white/10 p-3 text-sm text-white/90">{notice}</p>}

      <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" className="hidden"
        onChange={event => { void addFiles(event.target.files); event.target.value = ''; }} />

      {!items.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={preparing}
            className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl border-2 border-dashed p-8 transition hover:bg-white/5" style={{ borderColor: `${GOLD}99` }}>
            <span className="grid h-16 w-16 place-items-center rounded-full text-black" style={{ background: GOLD }}>{preparing ? <Loader2 size={28} className="animate-spin" /> : <ImagePlus size={30} />}</span>
            <span className="text-lg font-extrabold">{preparing ? 'Preparing photos…' : 'Select photos or a video'}</span>
            <span className="text-sm text-white/70">Up to 10 photos (they play like a slideshow), or 1 video up to 60 seconds</span>
          </button>
          {music && <p className="flex items-center gap-2 text-sm text-white/80"><Music2 size={16} style={{ color: GOLD }} />Using sound: <b>{music.title}</b></p>}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl space-y-4 p-4">
            {/* big preview */}
            <button type="button" onClick={() => setPreviewOpen(true)} className="relative mx-auto block aspect-[9/16] max-h-[46vh] w-auto overflow-hidden rounded-2xl bg-black ring-1 ring-white/10" aria-label="Preview story">
              {current?.kind === 'video'
                ? <video src={current.url} muted playsInline preload="metadata" className="h-full w-full object-contain" />
                : current && <img src={current.url} alt="" className="h-full w-full object-contain" />}
              <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold"><Eye size={14} />Preview</span>
              {items.length > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-bold">{items.indexOf(current!) + 1} / {items.length}</span>}
            </button>

            {/* thumbnails: drag to reorder */}
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-white/70">
                <span className="font-bold uppercase tracking-wider">{isVideo ? 'Video' : `Photos ${items.length}/10`}</span>
                {items.length > 1 && <span>Hold &amp; drag to reorder</span>}
              </div>
              <ul className="grid grid-cols-5 gap-2">
                {items.map((item, index) => (
                  <li key={item.id}
                    ref={element => { if (element) tileRefs.current.set(item.id, element); else tileRefs.current.delete(item.id); }}
                    onPointerDown={event => onTileDown(event, item.id)} onPointerMove={onTileMove} onPointerUp={() => onTileUp(item.id)} onPointerCancel={() => { drag.current = null; setDragId(''); }}
                    tabIndex={0} aria-label={`Photo ${index + 1} of ${items.length}. Alt + arrow keys to move.`}
                    onKeyDown={event => { if (event.altKey && event.key === 'ArrowLeft') move(index, index - 1); if (event.altKey && event.key === 'ArrowRight') move(index, index + 1); if (event.key === 'Enter') setSelected(item.id); }}
                    className={`relative aspect-[3/4] touch-none select-none overflow-hidden rounded-xl bg-white/5 transition ${dragId === item.id ? 'z-10 scale-110 shadow-2xl ring-2' : current?.id === item.id ? 'ring-2' : 'ring-1 ring-white/10'}`}
                    style={dragId === item.id || current?.id === item.id ? { ['--tw-ring-color' as string]: GOLD } : undefined}>
                    {item.kind === 'video' ? <video src={item.url} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" /> : <img src={item.url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />}
                    <span className="absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-extrabold text-black" style={{ background: GOLD }}>{index + 1}</span>
                    <button type="button" data-no-drag onClick={() => remove(item.id)} aria-label={`Remove photo ${index + 1}`} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70"><X size={13} /></button>
                  </li>
                ))}
                {!isVideo && items.length < MAX_PHOTOS && (
                  <li><button type="button" onClick={() => fileInput.current?.click()} disabled={preparing} aria-label="Add photos" className="grid aspect-[3/4] w-full place-items-center rounded-xl border-2 border-dashed border-white/25 text-white/70 hover:bg-white/5">{preparing ? <Loader2 size={20} className="animate-spin" /> : <Plus size={22} />}</button></li>
                )}
              </ul>
            </div>

            {/* music */}
            <button type="button" onClick={() => setMusicOpen(true)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-white/5 px-4 text-left ring-1 ring-white/10 hover:bg-white/10">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-black" style={{ background: GOLD }}><Music2 size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{music ? `♫ ${music.title}` : 'Add music'}</span>
                <span className="block truncate text-xs text-white/60">{music ? music.artist : 'Trending, Sierra Leone / Afrobeats, or your own sound'}</span>
              </span>
              {music && <span role="button" tabIndex={0} onClick={event => { event.stopPropagation(); setMusic(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); setMusic(null); } }} aria-label="Remove music" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X size={16} /></span>}
            </button>

            {/* caption + hashtags */}
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/70">Caption</span>
              <textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} rows={3} placeholder="Say something about your story…"
                className="w-full rounded-2xl border border-white/15 bg-white/5 p-3 text-sm text-white placeholder:text-white/40 focus:border-[#f5c518] focus:outline-none" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/70">Hashtags</span>
              <input value={hashtagInput} onChange={event => setHashtagInput(event.target.value)} placeholder="#salone #freetown" autoCapitalize="off"
                className="min-h-11 w-full rounded-2xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 focus:border-[#f5c518] focus:outline-none" />
              {hashtags.length > 0 && <span className="mt-2 flex flex-wrap gap-1.5">{hashtags.map(tag => <span key={tag} className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold" style={{ color: GOLD }}>{tag}</span>)}</span>}
            </label>

            <div className="flex gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => setPreviewOpen(true)} disabled={busy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border-2 text-sm font-extrabold disabled:opacity-50" style={{ borderColor: GOLD, color: GOLD }}><Eye size={18} />Preview</button>
              <button type="button" onClick={() => void publish()} disabled={busy || preparing} className="flex min-h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-black disabled:opacity-60" style={{ background: GOLD }}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}Post Story</button>
            </div>
          </div>
        </div>
      )}

      {musicOpen && <MusicPicker selectedId={music?.id || ''} userName={user?.name || 'you'} onClose={() => setMusicOpen(false)} onChoose={choice => { setMusic(choice); setMusicOpen(false); }} />}
      {previewOpen && previewGroups.length > 0 && (
        <StoryViewer preview groups={previewGroups} startGroup={0} onClose={() => setPreviewOpen(false)} onSeen={() => {}} onReply={async () => {}} />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ music picker */

export const MusicPicker: React.FC<{ selectedId: string; userName: string; onClose: () => void; onChoose: (music: ChosenMusic) => void }> = ({ selectedId, userName, onClose, onChoose }) => {
  const uid = auth.currentUser?.uid || '';
  const [tab, setTab] = useState<'trending' | 'salone' | 'saved' | 'upload'>('trending');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [saved, setSaved] = useState<SavedSound[]>([]);
  const [playing, setPlaying] = useState('');
  const [uploadError, setUploadError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void ensureSoundsSeeded();
    const stopCounts = listenSoundUseCounts(setCounts);
    const stopSaved = listenSavedSounds(uid, setSaved);
    return () => { stopCounts(); stopSaved(); audio.current?.pause(); };
  }, [uid]);

  const library = useMemo(() => {
    const catalog = TRENDING_SOUNDS.map(sound => ({ id: sound.id, url: sound.audioUrl, title: sound.name, artist: sound.artist, category: sound.category }));
    const mine = saved.map(sound => ({ id: sound.soundId, url: sound.audioUrl, title: sound.name, artist: sound.artist, category: 'Saved' }));
    let list = tab === 'saved' ? mine : tab === 'salone' ? catalog.filter(sound => SALONE_SOUND_IDS.includes(sound.id)) : [...catalog].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
    const query = search.trim().toLowerCase();
    if (query) list = [...catalog, ...mine].filter(sound => `${sound.title} ${sound.artist} ${sound.category}`.toLowerCase().includes(query));
    return list;
  }, [tab, saved, counts, search]);

  const toggle = (sound: { id: string; url: string }) => {
    if (playing === sound.id) { audio.current?.pause(); setPlaying(''); return; }
    audio.current?.pause();
    const next = new Audio(sound.url);
    audio.current = next;
    next.onended = () => setPlaying('');
    void next.play().catch(() => setPlaying(''));
    setPlaying(sound.id);
  };

  const uploadOwn = (file: File | undefined) => {
    setUploadError('');
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(file.name)) { setUploadError('Choose an audio file (MP3, M4A, WAV, OGG).'); return; }
    if (file.size > AUDIO_MAX_BYTES) { setUploadError('Audio must be 10 MB or less.'); return; }
    audio.current?.pause();
    onChoose({ id: `own_${newId()}`, url: URL.createObjectURL(file), title: `original sound - ${userName}`, artist: userName, file });
  };

  const tabs: [typeof tab, string][] = [['trending', 'Trending'], ['salone', 'Sierra Leone / Afrobeats'], ['saved', 'Saved'], ['upload', 'Upload']];

  return (
    <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div className="flex max-h-[85vh] flex-col rounded-t-3xl bg-[#151518] text-white" onClick={event => event.stopPropagation()} role="dialog" aria-label="Choose music">
        <div className="flex items-center justify-between px-4 pb-2 pt-4"><p className="text-base font-extrabold">Add music</p><button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"><X size={18} /></button></div>
        <div className="px-4">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search music" className="min-h-11 w-full rounded-full bg-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[#f5c518]" />
          </label>
          {!search && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist">
              {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-9 shrink-0 rounded-full px-3.5 text-xs font-bold ${tab === id ? 'text-black' : 'bg-white/10 text-white/80'}`} style={tab === id ? { background: GOLD } : undefined}>{label}</button>)}
            </div>
          )}
        </div>
        <div className="min-h-[200px] flex-1 overflow-y-auto px-4 py-3">
          {tab === 'upload' && !search ? (
            <div className="space-y-3 text-center">
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/25 p-6 hover:bg-white/5">
                <Upload size={26} style={{ color: GOLD }} />
                <span className="font-bold">Upload your own sound</span>
                <span className="text-xs text-white/60">MP3, M4A, WAV or OGG · max 10 MB</span>
                <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg" className="hidden" onChange={event => { uploadOwn(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
              {uploadError && <p role="alert" className="text-sm font-semibold text-rose-300">{uploadError}</p>}
              <p className="text-xs text-white/60">It will show as <b>♫ original sound - {userName}</b>. Only upload audio you made or have the right to use.</p>
            </div>
          ) : library.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/60">{tab === 'saved' && !search ? 'Sounds you save from Reels appear here.' : 'No music found.'}</p>
          ) : (
            <ul className="space-y-2">
              {library.map(sound => (
                <li key={sound.id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-2">
                  <button type="button" onClick={() => toggle(sound)} aria-label={playing === sound.id ? `Stop ${sound.title}` : `Play ${sound.title}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-black" style={{ background: GOLD }}>{playing === sound.id ? <Pause size={18} /> : <Play size={18} />}</button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{sound.title}</p>
                    <p className="truncate text-xs text-white/60">{sound.artist} · {sound.category}{counts.get(sound.id) ? ` · ${counts.get(sound.id)!.toLocaleString()} uses` : ''}</p>
                  </div>
                  <button type="button" onClick={() => { audio.current?.pause(); onChoose(sound); }} className={`min-h-9 shrink-0 rounded-full px-3.5 text-xs font-extrabold ${selectedId === sound.id ? 'bg-emerald-500 text-white' : 'text-black'}`} style={selectedId === sound.id ? undefined : { background: GOLD }}>{selectedId === sound.id ? 'Using' : 'Use'}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] leading-snug text-white/50">Library tracks are original, royalty-free eChat Studio music, free to use in your stories.</p>
      </div>
    </div>
  );
};
