import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Check, ImagePlus, Music2, Pause, Play, Plus, Scissors, Smile, Sparkles, Trash2, Type, Upload, Users, Wand2, X, Zap } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { compressImage } from '../../utils/image';
import { TagFriendsPicker } from '../TagFriendsPicker';
import type { User } from '../../types';
import { MediaPlayer, preloadEffects, type MediaPlayerHandle } from './MediaPlayer';
import { SOUND_EFFECTS, TRENDING_SOUNDS, type SoundInfo } from '../../services/reels/soundCatalog';
import {
  DEFAULT_EDIT, FILTERS, IMAGE_SECONDS, MAX_REEL_SECONDS, MAX_STORY_SECONDS,
  createReel, createStory, ensureSoundsSeeded, extractHashtags, filterCss, listenSavedSounds, listenSoundUseCounts, storyViewers, uploadMedia, validateMediaFile,
  type Audience, type DuetSource, type MediaEdit, type MediaType, type Overlay, type PlaybackSpeed, type SavedSound, type StorySticker
} from '../../services/reels/reelsStore';

export interface StudioPreset {
  sound?: Pick<SoundInfo, 'id' | 'name' | 'artist' | 'audioUrl'> | null;
  caption?: string;
  duetOf?: DuetSource | null;
  remixOf?: string;
}

interface CreateStudioProps {
  mode: 'reel' | 'story';
  preset?: StudioPreset;
  onClose: () => void;
  onCreated: (message: string) => void;
}

type Tab = 'trim' | 'sound' | 'effects' | 'text' | 'stickers' | 'filters' | 'speed' | 'cover';
const TEXT_COLORS = ['#FFFFFF', '#000000', '#1877F2', '#F5B301', '#E11D48', '#10B981'];
const EMOJIS = ['😂', '🔥', '❤️', '😍', '🥳', '😮', '😢', '👏', '💯', '🎉', '🙏', '✨', '🇸🇱', '⚽', '🎶', '😎'];
const newId = () => Math.random().toString(36).slice(2, 10);
const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

async function captureFrame(src: string, at: number): Promise<File | null> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = src;
    const fail = () => resolve(null);
    const timer = window.setTimeout(fail, 8000);
    video.onerror = () => { window.clearTimeout(timer); fail(); };
    video.onloadeddata = () => { video.currentTime = Math.min(Math.max(0, at), Math.max(0, (video.duration || 1) - 0.1)); };
    video.onseeked = () => {
      window.clearTimeout(timer);
      const scale = Math.min(1, 720 / Math.max(video.videoWidth || 720, video.videoHeight || 1280));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((video.videoWidth || 720) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 1280) * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(blob ? new File([blob], 'cover.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.8);
    };
  });
}

export const CreateStudio: React.FC<CreateStudioProps> = ({ mode, preset, onClose, onCreated }) => {
  const { user } = useAuth();
  const uid = auth.currentUser?.uid || '';
  const maxSeconds = mode === 'story' ? MAX_STORY_SECONDS : MAX_REEL_SECONDS;
  const duetOf = preset?.duetOf || null;

  const [step, setStep] = useState<'pick' | 'edit' | 'details'>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<MediaType>('video');
  const [previewUrl, setPreviewUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [pickError, setPickError] = useState('');
  const [edit, setEdit] = useState<MediaEdit>(() => ({
    ...DEFAULT_EDIT,
    ...(preset?.sound ? { soundId: preset.sound.id, soundName: preset.sound.name, soundArtist: preset.sound.artist, soundUrl: preset.sound.audioUrl, originalVolume: 0.3 } : {})
  }));
  const [stickers, setStickers] = useState<StorySticker[]>([]);
  const [tab, setTab] = useState<Tab>('trim');
  const [paused, setPaused] = useState(false);
  const playerRef = useRef<MediaPlayerHandle>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);

  // sound library
  const [soundTab, setSoundTab] = useState<'trending' | 'saved'>('trending');
  const [useCounts, setUseCounts] = useState<Map<string, number>>(new Map());
  const [savedSounds, setSavedSounds] = useState<SavedSound[]>([]);
  const [previewSoundId, setPreviewSoundId] = useState('');
  const previewAudio = useRef<HTMLAudioElement | null>(null);

  // text / stickers inputs
  const [textInput, setTextInput] = useState('');
  const [textColor, setTextColor] = useState(TEXT_COLORS[0]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollA, setPollA] = useState('Yes');
  const [pollB, setPollB] = useState('No');
  const [questionPrompt, setQuestionPrompt] = useState('Ask me anything');
  const [sliderPrompt, setSliderPrompt] = useState('How much do you love this?');
  const [sliderEmoji, setSliderEmoji] = useState('😍');

  // cover
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [coverAt, setCoverAt] = useState(1);

  // details
  const [caption, setCaption] = useState(preset?.caption || '');
  const [hashtagInput, setHashtagInput] = useState('');
  const [location, setLocation] = useState('');
  const [tagged, setTagged] = useState<User[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [audience, setAudience] = useState<Audience>('public');
  const [alsoStory, setAlsoStory] = useState(false);

  // upload
  const [progress, setProgress] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState('');
  const cancelUpload = useRef<() => void>(() => {});

  useEffect(() => {
    void ensureSoundsSeeded();
    const stopCounts = listenSoundUseCounts(setUseCounts);
    const stopSaved = listenSavedSounds(uid, setSavedSounds);
    preloadEffects(SOUND_EFFECTS.map(effect => effect.audioUrl));
    return () => { stopCounts(); stopSaved(); previewAudio.current?.pause(); };
  }, [uid]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (!coverFile) { setCoverPreview(''); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const windowEnd = mediaType === 'image' ? IMAGE_SECONDS : (edit.trimEnd > edit.trimStart ? edit.trimEnd : Math.min(duration, edit.trimStart + maxSeconds));
  const update = (patch: Partial<MediaEdit>) => setEdit(current => ({ ...current, ...patch }));

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setPickError('');
    try {
      const { mediaType: type } = validateMediaFile(picked, mode);
      let chosen = picked;
      if (type === 'image') chosen = await compressImage(picked, 1600, 0.85); // client-side compression for photos
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(chosen);
      setFile(chosen);
      setMediaType(type);
      setPreviewUrl(url);
      setDuration(type === 'image' ? IMAGE_SECONDS : 0);
      update({ trimStart: 0, trimEnd: type === 'image' ? IMAGE_SECONDS : 0, effects: [] });
      setTab(type === 'video' ? 'trim' : 'sound');
      setCoverFile(null);
      setStep('edit');
    } catch (error) {
      setPickError(error instanceof Error ? error.message : 'Could not use this file.');
    }
  };

  const onVideoDuration = (seconds: number) => {
    setDuration(seconds);
    setEdit(current => current.trimEnd > 0 ? current : { ...current, trimStart: 0, trimEnd: Math.min(seconds, maxSeconds) });
    if (mode === 'reel') {
      const at = Math.min(1, seconds / 2);
      setCoverAt(at);
      void captureFrame(previewUrl, at).then(frame => { if (frame) setCoverFile(current => current || frame); });
    }
  };

  const setTrim = (which: 'start' | 'end', value: number) => {
    setEdit(current => {
      let start = which === 'start' ? value : current.trimStart;
      let end = which === 'end' ? value : (current.trimEnd || Math.min(duration, maxSeconds));
      if (which === 'start') { start = Math.min(start, end - 1); if (end - start > maxSeconds) end = start + maxSeconds; }
      else { end = Math.max(end, start + 1); if (end - start > maxSeconds) start = end - maxSeconds; }
      return { ...current, trimStart: Math.max(0, start), trimEnd: Math.min(duration || end, end) };
    });
    playerRef.current?.seek(which === 'start' ? value : Math.max(0, value - 2));
  };

  const togglePreviewSound = (sound: { id: string; audioUrl: string }) => {
    if (previewSoundId === sound.id) { previewAudio.current?.pause(); setPreviewSoundId(''); return; }
    previewAudio.current?.pause();
    const audio = new Audio(sound.audioUrl);
    previewAudio.current = audio;
    audio.onended = () => setPreviewSoundId('');
    void audio.play().catch(() => setPreviewSoundId(''));
    setPreviewSoundId(sound.id);
  };
  const chooseSound = (sound: { id: string; name: string; artist: string; audioUrl: string }) => {
    previewAudio.current?.pause();
    setPreviewSoundId('');
    update({ soundId: sound.id, soundName: sound.name, soundArtist: sound.artist, soundUrl: sound.audioUrl, originalVolume: Math.min(edit.originalVolume, 0.3) });
  };

  const addEffect = (effect: SoundInfo) => {
    const at = Math.round((playerRef.current?.currentTime() ?? 0) * 10) / 10;
    new Audio(effect.audioUrl).play().catch(() => {});
    update({ effects: [...edit.effects, { id: newId(), soundId: effect.id, name: effect.name, url: effect.audioUrl, at: Math.max(edit.trimStart, at) }].slice(0, 50).sort((a, b) => a.at - b.at) });
  };

  const addOverlay = (kind: Overlay['kind'], text: string, color = '#FFFFFF') => {
    if (!text.trim()) return;
    update({ overlays: [...edit.overlays, { id: newId(), kind, text: text.trim().slice(0, 120), x: 50, y: 40 + (edit.overlays.length % 4) * 8, color, size: kind === 'emoji' ? 14 : 7 }].slice(0, 30) });
  };

  // Drag overlays / stickers on the preview.
  const dragRef = useRef<{ id: string; kind: 'overlay' | 'sticker' } | null>(null);
  const onDragMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const box = previewBoxRef.current?.getBoundingClientRect();
    if (!drag || !box) return;
    const x = Math.min(95, Math.max(5, ((event.clientX - box.left) / box.width) * 100));
    const y = Math.min(95, Math.max(5, ((event.clientY - box.top) / box.height) * 100));
    if (drag.kind === 'overlay') update({ overlays: edit.overlays.map(item => item.id === drag.id ? { ...item, x, y } : item) });
    else setStickers(current => current.map((item, index) => String(index) === drag.id ? { ...item, x, y } : item));
  };

  const addSticker = (sticker: StorySticker) => setStickers(current => [...current, sticker].slice(0, 10));

  const pickCoverFrame = async (seconds: number) => {
    setCoverAt(seconds);
    const frame = await captureFrame(previewUrl, seconds);
    if (frame) setCoverFile(frame);
  };
  const uploadCustomCover = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked || !picked.type.startsWith('image/')) return;
    setCoverFile(await compressImage(picked, 1080, 0.8));
  };

  const hashtags = useMemo(() => extractHashtags(`${caption} ${hashtagInput.split(/[\s,]+/).filter(Boolean).map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`), [caption, hashtagInput]);

  const publish = async () => {
    if (!file || !user || !uid) { setSubmitError('Please sign in again.'); return; }
    if (caption.length > 2200) { setSubmitError('Caption must be 2,200 characters or less.'); return; }
    if (mediaType === 'video' && edit.trimEnd - edit.trimStart > maxSeconds + 0.5) { setSubmitError(`Trim your video to ${maxSeconds} seconds or less.`); return; }
    setSubmitError('');
    setPaused(true);
    setProgress(0);
    try {
      const folder = mode === 'story' ? 'stories' : 'reels';
      const mediaUpload = uploadMedia(folder, uid, file, percent => setProgress(Math.round(percent * 0.85)));
      cancelUpload.current = mediaUpload.cancel;
      const mediaUrl = await mediaUpload.promise;
      let coverUrl = mediaType === 'image' ? mediaUrl : '';
      if (coverFile && mediaType === 'video') {
        const coverUpload = uploadMedia('covers', uid, coverFile, percent => setProgress(85 + Math.round(percent * 0.1)));
        cancelUpload.current = coverUpload.cancel;
        coverUrl = await coverUpload.promise.catch(error => { console.error('[EChat upload] cover upload failed (reel still posts)', error); return ''; });
      }
      setProgress(96);
      const finalEdit: MediaEdit = { ...edit, trimEnd: mediaType === 'image' ? IMAGE_SECONDS : (edit.trimEnd || Math.min(duration, maxSeconds)) };
      const friends = Array.isArray(user.friends) ? user.friends : [];
      if (mode === 'story') {
        await createStory({ ...finalEdit, userId: uid, userName: user.name, userAvatar: user.avatar || '', mediaUrl, mediaType, coverUrl, stickers, allowedViewers: storyViewers({ id: uid, friends }), fromReelId: '' });
        setProgress(100);
        onCreated('Story shared');
        return;
      }
      const allowedViewers = audience === 'only_me' ? [uid] : Array.from(new Set([uid, ...friends])).slice(0, 2000);
      const reelId = await createReel({
        ...finalEdit,
        mediaType, mediaUrl, coverUrl,
        caption: caption.trim(),
        hashtags,
        location: location.trim().slice(0, 120),
        taggedUserIds: tagged.map(item => item.id),
        taggedNames: tagged.map(item => item.name),
        audience,
        allowedViewers,
        duration: mediaType === 'image' ? IMAGE_SECONDS : Math.max(0, finalEdit.trimEnd - finalEdit.trimStart),
        creatorId: uid,
        creatorName: user.name,
        creatorAvatar: user.avatar || '',
        isStoryAlso: alsoStory,
        duetOf,
        remixOf: preset?.remixOf || ''
      });
      if (alsoStory) {
        await createStory({ ...finalEdit, userId: uid, userName: user.name, userAvatar: user.avatar || '', mediaUrl, mediaType, coverUrl, stickers: [], allowedViewers: storyViewers({ id: uid, friends }), fromReelId: reelId }).catch(error => console.error('[EChat upload] could not also share to Story', error));
      }
      setProgress(100);
      onCreated(alsoStory ? 'Reel posted and shared to your Story' : 'Reel posted');
    } catch (error) {
      console.error('[EChat upload] publish failed', error);
      setProgress(null);
      setSubmitError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'trim', label: 'Trim', icon: <Scissors size={16} />, show: mediaType === 'video' },
    { id: 'sound', label: 'Sound', icon: <Music2 size={16} />, show: true },
    { id: 'effects', label: 'Effects', icon: <Zap size={16} />, show: true },
    { id: 'text', label: 'Text', icon: <Type size={16} />, show: true },
    { id: 'stickers', label: 'Stickers', icon: <Smile size={16} />, show: true },
    { id: 'filters', label: 'Filters', icon: <Wand2 size={16} />, show: true },
    { id: 'speed', label: 'Speed', icon: <Sparkles size={16} />, show: true },
    { id: 'cover', label: 'Cover', icon: <ImagePlus size={16} />, show: mode === 'reel' && mediaType === 'video' }
  ];

  const soundRow = (sound: { id: string; name: string; artist: string; audioUrl: string }, count?: number) => (
    <li key={sound.id} className="flex items-center gap-2 rounded-xl bg-[#F2F4F7] p-2">
      <button type="button" onClick={() => togglePreviewSound(sound)} aria-label={previewSoundId === sound.id ? `Stop ${sound.name}` : `Play preview of ${sound.name}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#1877F2] shadow-sm">{previewSoundId === sound.id ? <Pause size={16} /> : <Play size={16} />}</button>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{sound.name}</p><p className="truncate text-xs text-slate-500">{sound.artist}{count !== undefined ? ` · ${count.toLocaleString()} uses` : ''}</p></div>
      <button type="button" onClick={() => chooseSound(sound)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-bold ${edit.soundId === sound.id ? 'bg-emerald-600 text-white' : 'bg-[#1877F2] text-white'}`}>{edit.soundId === sound.id ? 'Using' : 'Use this sound'}</button>
    </li>
  );

  const title = mode === 'story' ? 'Add to Story' : duetOf ? `Duet with @${duetOf.creatorName}` : preset?.remixOf ? 'Remix' : 'Create Reel';

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex min-h-14 items-center gap-2 border-b border-slate-200 px-3 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={() => step === 'details' ? setStep('edit') : step === 'edit' ? setStep('pick') : onClose()} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100">{step === 'pick' ? <X size={20} /> : <ArrowLeft size={20} />}</button>
        <h2 className="flex-1 truncate text-base font-extrabold text-slate-900">{title}</h2>
        {step === 'edit' && <button type="button" onClick={() => mode === 'story' ? void publish() : setStep('details')} disabled={progress !== null} className="min-h-10 rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white disabled:opacity-60">{mode === 'story' ? 'Share' : 'Next'}</button>}
        {step === 'details' && <button type="button" onClick={() => void publish()} disabled={progress !== null} className="min-h-10 rounded-xl bg-[#1877F2] px-4 text-sm font-bold text-white disabled:opacity-60">Post</button>}
      </header>

      {progress !== null && (
        <div className="border-b border-slate-200 bg-white px-4 py-2" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700"><span>{progress < 100 ? 'Uploading…' : 'Done!'}</span><span>{progress}%</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#1877F2] transition-[width]" style={{ width: `${progress}%` }} /></div>
          {progress < 85 && <button type="button" onClick={() => { cancelUpload.current(); setProgress(null); }} className="mt-1 text-xs font-semibold text-rose-600">Cancel upload</button>}
        </div>
      )}
      {submitError && (
        <div role="alert" className="mx-4 mt-2 flex items-start gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          <p className="min-w-0 flex-1">{submitError}</p>
          {file && progress === null && <button type="button" onClick={() => void publish()} className="min-h-9 shrink-0 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white">Retry</button>}
        </div>
      )}

      {step === 'pick' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto bg-[#F2F4F7] p-6 text-center">
          {duetOf && <p className="max-w-sm rounded-xl bg-white p-3 text-sm text-slate-700 shadow-sm">Your video will play side-by-side with <strong>@{duetOf.creatorName}</strong>’s reel.</p>}
          <label className="flex w-full max-w-sm cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-slate-600 shadow-sm hover:border-[#1877F2]">
            <Upload size={32} className="text-[#1877F2]" />
            <span className="text-base font-extrabold text-slate-900">Choose video or photo</span>
            <span className="text-xs">Video: MP4, MOV, WEBM · max 30MB · up to {maxSeconds}s</span>
            <span className="text-xs">Photo: JPG, PNG, WEBP · max 10MB · plays for {IMAGE_SECONDS}s with zoom</span>
            <input type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" className="hidden" onChange={event => void pickFile(event)} />
          </label>
          {pickError && <p role="alert" className="w-full max-w-sm rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{pickError}</p>}
        </div>
      )}

      {step === 'edit' && file && (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black p-2 md:p-4">
            <div
              ref={previewBoxRef}
              className="relative aspect-[9/16] h-full max-h-full max-w-full overflow-hidden rounded-xl"
              onPointerMove={onDragMove}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerLeave={() => { dragRef.current = null; }}
            >
              <MediaPlayer
                ref={playerRef}
                mediaType={mediaType}
                mediaUrl={previewUrl}
                coverUrl={coverPreview}
                edit={{ ...edit, overlays: [] }}
                duet={duetOf}
                active
                muted={false}
                paused={paused}
                maxSeconds={maxSeconds}
                onDuration={onVideoDuration}
              >
                {edit.overlays.map(overlay => (
                  <span
                    key={overlay.id}
                    onPointerDown={event => { event.preventDefault(); dragRef.current = { id: overlay.id, kind: 'overlay' }; }}
                    className="absolute z-20 max-w-[90%] -translate-x-1/2 -translate-y-1/2 cursor-move touch-none select-none whitespace-pre-wrap break-words rounded px-1 text-center font-extrabold leading-tight outline-dashed outline-1 outline-white/40"
                    style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color, fontSize: `${overlay.size}cqw`, textShadow: overlay.kind === 'text' ? '0 2px 6px rgba(0,0,0,.7)' : undefined }}
                  >{overlay.text}</span>
                ))}
                {stickers.map((sticker, index) => (
                  <div key={index} onPointerDown={event => { event.preventDefault(); dragRef.current = { id: String(index), kind: 'sticker' }; }} className="absolute z-20 w-[70%] -translate-x-1/2 -translate-y-1/2 cursor-move touch-none select-none" style={{ left: `${sticker.x}%`, top: `${sticker.y}%` }}>
                    <StickerPreview sticker={sticker} soundName={edit.soundName} />
                  </div>
                ))}
              </MediaPlayer>
              <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play preview' : 'Pause preview'} className="absolute bottom-3 left-3 z-30 grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white">{paused ? <Play size={18} /> : <Pause size={18} />}</button>
            </div>
          </div>

          <div className="flex max-h-[48vh] min-h-0 flex-col border-t border-slate-200 bg-white md:max-h-none md:w-[380px] md:border-l md:border-t-0">
            <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2" role="tablist" aria-label="Editing tools">
              {tabs.filter(item => item.show).map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${tab === item.id ? 'bg-[#1877F2] text-white' : 'bg-[#F2F4F7] text-slate-700'}`}>{item.icon}{item.label}</button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
              {tab === 'trim' && mediaType === 'video' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">{duration ? `Video length ${fmt(duration)} · keep up to ${maxSeconds}s` : 'Loading video length… (if this video cannot preview here, it is uploaded as-is and the first ' + maxSeconds + 's are played)'}</p>
                  <label className="block text-xs font-bold text-slate-700">Start · {fmt(edit.trimStart)}
                    <input type="range" min={0} max={Math.max(0, duration - 1)} step={0.1} value={edit.trimStart} disabled={!duration} onChange={event => setTrim('start', Number(event.target.value))} className="mt-1 w-full accent-[#1877F2]" />
                  </label>
                  <label className="block text-xs font-bold text-slate-700">End · {fmt(windowEnd)}
                    <input type="range" min={1} max={Math.max(1, duration)} step={0.1} value={windowEnd} disabled={!duration} onChange={event => setTrim('end', Number(event.target.value))} className="mt-1 w-full accent-[#1877F2]" />
                  </label>
                  <p className="rounded-lg bg-[#F2F4F7] p-2 text-xs font-semibold text-slate-700">Clip length: {fmt(Math.max(0, windowEnd - edit.trimStart))} / max {fmt(maxSeconds)}</p>
                </div>
              )}

              {tab === 'sound' && (
                <div className="space-y-3">
                  <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><Music2 size={14} />{edit.soundId ? `${edit.soundName} · ${edit.soundArtist}` : `Original Audio - ${user?.name || 'You'}`}</p>
                    {mediaType === 'video' && <label className="block text-xs text-slate-600">Original video volume · {Math.round(edit.originalVolume * 100)}%<input type="range" min={0} max={1} step={0.05} value={edit.originalVolume} onChange={event => update({ originalVolume: Number(event.target.value) })} className="w-full accent-[#1877F2]" /></label>}
                    {edit.soundId && <label className="block text-xs text-slate-600">Music volume · {Math.round(edit.musicVolume * 100)}%<input type="range" min={0} max={1} step={0.05} value={edit.musicVolume} onChange={event => update({ musicVolume: Number(event.target.value) })} className="w-full accent-[#1877F2]" /></label>}
                    {edit.soundId && <button type="button" onClick={() => update({ soundId: '', soundName: '', soundArtist: '', soundUrl: '', originalVolume: 1 })} className="text-xs font-semibold text-rose-600">Remove sound (use original audio)</button>}
                  </div>
                  <div className="flex rounded-xl bg-[#F2F4F7] p-1">
                    <button type="button" onClick={() => setSoundTab('trending')} className={`min-h-9 flex-1 rounded-lg text-xs font-bold ${soundTab === 'trending' ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}>Trending Sounds</button>
                    <button type="button" onClick={() => setSoundTab('saved')} className={`min-h-9 flex-1 rounded-lg text-xs font-bold ${soundTab === 'saved' ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}><Bookmark size={12} className="mr-1 inline" />Saved Sounds ({savedSounds.length})</button>
                  </div>
                  <ul className="space-y-2">
                    {soundTab === 'trending'
                      ? [...TRENDING_SOUNDS].sort((a, b) => (useCounts.get(b.id) || 0) - (useCounts.get(a.id) || 0)).map(sound => soundRow(sound, useCounts.get(sound.id) || 0))
                      : savedSounds.length ? savedSounds.map(sound => soundRow({ id: sound.soundId, name: sound.name, artist: sound.artist, audioUrl: sound.audioUrl })) : <li className="rounded-xl bg-[#F2F4F7] p-4 text-center text-xs text-slate-500">Tap a sound name on any Reel, then “Save Sound”, to keep it here.</li>}
                  </ul>
                </div>
              )}

              {tab === 'effects' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Play the preview, then tap an effect to drop it at the current moment ({fmt(playerRef.current?.currentTime() ?? 0)}).</p>
                  <div className="grid grid-cols-3 gap-2">
                    {SOUND_EFFECTS.map(effect => <button key={effect.id} type="button" onClick={() => addEffect(effect)} className="min-h-12 rounded-xl bg-[#F2F4F7] px-2 text-xs font-bold text-slate-800 hover:bg-[#E7F0FD]"><Plus size={12} className="mr-0.5 inline" />{effect.name}</button>)}
                  </div>
                  {edit.effects.length > 0 && <ul className="space-y-1">{edit.effects.map(effect => <li key={effect.id} className="flex items-center justify-between rounded-lg bg-[#F2F4F7] px-2 py-1.5 text-xs"><span><strong>{effect.name}</strong> at {fmt(effect.at)}</span><button type="button" onClick={() => update({ effects: edit.effects.filter(item => item.id !== effect.id) })} aria-label={`Remove ${effect.name}`} className="text-rose-600"><Trash2 size={14} /></button></li>)}</ul>}
                </div>
              )}

              {tab === 'text' && (
                <div className="space-y-3">
                  <textarea value={textInput} onChange={event => setTextInput(event.target.value)} maxLength={120} rows={2} placeholder="Type your text…" className="w-full rounded-xl border border-slate-300 p-2" />
                  <div className="flex gap-2">{TEXT_COLORS.map(color => <button key={color} type="button" onClick={() => setTextColor(color)} aria-label={`Text color ${color}`} className={`h-8 w-8 rounded-full border-2 ${textColor === color ? 'border-[#1877F2]' : 'border-slate-200'}`} style={{ background: color }} />)}</div>
                  <button type="button" onClick={() => { addOverlay('text', textInput, textColor); setTextInput(''); }} disabled={!textInput.trim()} className="min-h-10 w-full rounded-xl bg-[#1877F2] font-bold text-white disabled:opacity-50">Add text</button>
                  <p className="text-xs text-slate-500">Drag text on the preview to move it.</p>
                  {edit.overlays.length > 0 && <div className="flex flex-wrap gap-1.5">{edit.overlays.map(overlay => <button key={overlay.id} type="button" onClick={() => update({ overlays: edit.overlays.filter(item => item.id !== overlay.id) })} className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-xs">{overlay.text.slice(0, 16)} ✕</button>)}</div>}
                </div>
              )}

              {tab === 'stickers' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-8 gap-1">{EMOJIS.map(emoji => <button key={emoji} type="button" onClick={() => addOverlay('emoji', emoji)} className="aspect-square rounded-lg text-2xl hover:bg-[#F2F4F7]">{emoji}</button>)}</div>
                  {mode === 'story' && (
                    <div className="space-y-3 border-t border-slate-200 pt-3">
                      <fieldset className="space-y-1.5 rounded-xl border border-slate-200 p-2"><legend className="px-1 text-xs font-bold">Poll</legend>
                        <input value={pollQuestion} onChange={event => setPollQuestion(event.target.value)} maxLength={80} placeholder="Ask a question…" className="w-full rounded-lg border border-slate-300 p-2 text-xs" />
                        <div className="flex gap-1.5"><input value={pollA} onChange={event => setPollA(event.target.value)} maxLength={24} className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2 text-xs" /><input value={pollB} onChange={event => setPollB(event.target.value)} maxLength={24} className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2 text-xs" /></div>
                        <button type="button" disabled={!pollQuestion.trim() || !pollA.trim() || !pollB.trim()} onClick={() => addSticker({ kind: 'poll', prompt: pollQuestion.trim(), options: [pollA.trim(), pollB.trim()], x: 50, y: 70 })} className="min-h-9 w-full rounded-lg bg-[#1877F2] text-xs font-bold text-white disabled:opacity-50">Add poll</button>
                      </fieldset>
                      <fieldset className="space-y-1.5 rounded-xl border border-slate-200 p-2"><legend className="px-1 text-xs font-bold">Question</legend>
                        <input value={questionPrompt} onChange={event => setQuestionPrompt(event.target.value)} maxLength={80} className="w-full rounded-lg border border-slate-300 p-2 text-xs" />
                        <button type="button" disabled={!questionPrompt.trim()} onClick={() => addSticker({ kind: 'question', prompt: questionPrompt.trim(), x: 50, y: 70 })} className="min-h-9 w-full rounded-lg bg-[#1877F2] text-xs font-bold text-white disabled:opacity-50">Add question</button>
                      </fieldset>
                      <fieldset className="space-y-1.5 rounded-xl border border-slate-200 p-2"><legend className="px-1 text-xs font-bold">Emoji slider</legend>
                        <input value={sliderPrompt} onChange={event => setSliderPrompt(event.target.value)} maxLength={80} className="w-full rounded-lg border border-slate-300 p-2 text-xs" />
                        <div className="flex gap-1">{['😍', '🔥', '😂', '😮', '💯'].map(emoji => <button key={emoji} type="button" onClick={() => setSliderEmoji(emoji)} className={`h-9 w-9 rounded-lg text-xl ${sliderEmoji === emoji ? 'bg-[#E7F0FD]' : ''}`}>{emoji}</button>)}</div>
                        <button type="button" disabled={!sliderPrompt.trim()} onClick={() => addSticker({ kind: 'slider', prompt: sliderPrompt.trim(), emoji: sliderEmoji, x: 50, y: 70 })} className="min-h-9 w-full rounded-lg bg-[#1877F2] text-xs font-bold text-white disabled:opacity-50">Add emoji slider</button>
                      </fieldset>
                      <button type="button" disabled={!edit.soundId} onClick={() => addSticker({ kind: 'music', prompt: edit.soundName, x: 50, y: 20 })} className="min-h-10 w-full rounded-xl bg-[#F2F4F7] text-xs font-bold text-slate-800 disabled:opacity-50"><Music2 size={14} className="mr-1 inline" />{edit.soundId ? `Add music sticker (${edit.soundName})` : 'Pick a sound first to add a music sticker'}</button>
                      {stickers.length > 0 && <div className="flex flex-wrap gap-1.5">{stickers.map((sticker, index) => <button key={index} type="button" onClick={() => setStickers(current => current.filter((_, i) => i !== index))} className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-xs">{sticker.kind}: {sticker.prompt.slice(0, 14)} ✕</button>)}</div>}
                    </div>
                  )}
                </div>
              )}

              {tab === 'filters' && (
                <div className="grid grid-cols-5 gap-2">
                  {FILTERS.map(item => (
                    <button key={item.id} type="button" onClick={() => update({ filter: item.id })} className={`flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-bold ${edit.filter === item.id ? 'bg-[#E7F0FD] text-[#1877F2]' : 'text-slate-700'}`}>
                      <span className="block aspect-square w-full overflow-hidden rounded-lg bg-slate-800">{mediaType === 'image' ? <img src={previewUrl} alt="" className="h-full w-full object-cover" style={{ filter: filterCss(item.id) }} /> : coverPreview ? <img src={coverPreview} alt="" className="h-full w-full object-cover" style={{ filter: filterCss(item.id) }} /> : null}</span>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              {tab === 'speed' && (
                <div className="flex gap-2">{([0.5, 1, 1.5, 2] as PlaybackSpeed[]).map(speed => <button key={speed} type="button" onClick={() => update({ speed })} className={`min-h-11 flex-1 rounded-xl text-sm font-extrabold ${edit.speed === speed ? 'bg-[#1877F2] text-white' : 'bg-[#F2F4F7] text-slate-700'}`}>{speed}x</button>)}</div>
              )}

              {tab === 'cover' && mode === 'reel' && mediaType === 'video' && (
                <div className="space-y-3">
                  {coverPreview ? <img src={coverPreview} alt="Cover preview" className="mx-auto h-40 rounded-xl object-cover" /> : <p className="text-xs text-slate-500">Picking a cover frame…</p>}
                  <label className="block text-xs font-bold text-slate-700">Choose frame · {fmt(coverAt)}
                    <input type="range" min={0} max={Math.max(0.1, duration - 0.1)} step={0.1} value={coverAt} disabled={!duration} onChange={event => setCoverAt(Number(event.target.value))} onPointerUp={() => void pickCoverFrame(coverAt)} onKeyUp={() => void pickCoverFrame(coverAt)} className="w-full accent-[#1877F2]" />
                  </label>
                  <label className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-xs font-bold text-slate-700"><ImagePlus size={16} />Upload custom cover<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => void uploadCustomCover(event)} /></label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 'details' && (
        <div className="flex-1 space-y-4 overflow-y-auto bg-[#F2F4F7] p-4">
          <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              {(coverPreview || mediaType === 'image') && <img src={coverPreview || previewUrl} alt="" className="h-28 w-20 shrink-0 rounded-lg object-cover" style={{ filter: filterCss(edit.filter) }} />}
              <label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wider text-slate-600">Caption
                <textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} rows={4} placeholder="Describe your reel… #hashtags work here too" className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm font-normal normal-case tracking-normal" />
              </label>
            </div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">Hashtags
              <input value={hashtagInput} onChange={event => setHashtagInput(event.target.value)} placeholder="#salone #music" className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm font-normal normal-case" />
              {hashtags.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{hashtags.map(tag => <span key={tag} className="rounded-full bg-[#E7F0FD] px-2 py-0.5 text-xs font-semibold normal-case text-[#1877F2]">{tag}</span>)}</span>}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">Location
              <input value={location} onChange={event => setLocation(event.target.value)} list="reel-locations" maxLength={120} placeholder="e.g. Freetown" className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm font-normal normal-case" />
              <datalist id="reel-locations">{['Freetown', 'Bo', 'Kenema', 'Makeni', 'Koidu', 'Lungi'].map(item => <option key={item} value={item} />)}</datalist>
            </label>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Tag Friends</span>
              <button type="button" onClick={() => setTagPickerOpen(true)} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-300 px-3 text-left text-sm"><Users size={16} />{tagged.length ? tagged.map(item => item.name).join(', ') : 'Tag friends'}</button>
            </div>
            <fieldset>
              <legend className="text-xs font-bold uppercase tracking-wider text-slate-600">Audience</legend>
              <div className="mt-1 flex rounded-xl bg-[#F2F4F7] p-1">
                {([['public', 'Public'], ['friends', 'Friends'], ['only_me', 'Only Me']] as [Audience, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setAudience(value)} aria-pressed={audience === value} className={`min-h-10 flex-1 rounded-lg text-sm font-bold ${audience === value ? 'bg-white text-[#1877F2] shadow-sm' : 'text-slate-600'}`}>{label}</button>)}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={alsoStory} onChange={event => setAlsoStory(event.target.checked)} className="h-5 w-5 accent-[#1877F2]" />Also share to My Story</label>
            <button type="button" onClick={() => void publish()} disabled={progress !== null} className="min-h-12 w-full rounded-xl bg-[#1877F2] text-base font-extrabold text-white disabled:opacity-60"><Check size={18} className="mr-1 inline" />Post Reel</button>
          </div>
        </div>
      )}

      {tagPickerOpen && <TagFriendsPicker selected={tagged} onChange={setTagged} onClose={() => setTagPickerOpen(false)} />}
    </div>
  );
};

/** Visual for a story sticker (shared by the studio preview and the story viewer). */
export const StickerPreview: React.FC<{ sticker: StorySticker; soundName?: string; children?: React.ReactNode }> = ({ sticker, soundName, children }) => {
  if (sticker.kind === 'music') return <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-sm font-bold text-slate-900 shadow-lg"><Music2 size={16} className="text-[#1877F2]" /><span className="truncate">{sticker.prompt || soundName || 'Music'}</span></div>;
  return (
    <div className="rounded-2xl bg-white/95 p-3 text-center text-slate-900 shadow-lg">
      <p className="text-sm font-extrabold">{sticker.prompt}</p>
      {children ?? (
        sticker.kind === 'poll' ? <div className="mt-2 grid grid-cols-2 gap-2">{(sticker.options || []).map(option => <span key={option} className="rounded-xl bg-[#F2F4F7] py-2 text-sm font-bold">{option}</span>)}</div>
          : sticker.kind === 'question' ? <div className="mt-2 rounded-xl bg-[#F2F4F7] py-2 text-xs text-slate-500">Type something…</div>
            : <div className="mt-2 flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-gradient-to-r from-[#1877F2]/30 to-[#1877F2]" /><span className="text-xl">{sticker.emoji}</span></div>
      )}
    </div>
  );
};
