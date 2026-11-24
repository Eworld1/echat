import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { lightImageUrl, lightVideoUrl } from '../../services/lowData';
import { IMAGE_SECONDS, filterCss, type DuetSource, type MediaEdit, type MediaType } from '../../services/reels/reelsStore';

/**
 * Plays a reel / story with all edits applied at playback time:
 * trim window, speed, colour filter, text & emoji overlays, background music (own volume),
 * original-audio volume, timed sound effects, duet side-by-side, and Ken Burns zoom for photos.
 */

const KEN_BURNS_CSS = `@keyframes echatKenBurns { from { transform: scale(1) translate(0,0); } to { transform: scale(1.18) translate(-2%, -2%); } }`;
let kenBurnsInjected = false;
function injectKenBurns() {
  if (kenBurnsInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = KEN_BURNS_CSS;
  document.head.appendChild(style);
  kenBurnsInjected = true;
}

const effectCache = new Map<string, HTMLAudioElement>();
function playEffect(url: string) {
  let base = effectCache.get(url);
  if (!base) { base = new Audio(url); base.preload = 'auto'; effectCache.set(url, base); }
  const instance = base.cloneNode(true) as HTMLAudioElement;
  void instance.play().catch(() => {});
}
export function preloadEffects(urls: string[]) {
  for (const url of urls) if (!effectCache.has(url)) { const audio = new Audio(url); audio.preload = 'auto'; effectCache.set(url, audio); }
}

export interface MediaPlayerHandle {
  /** Current position in media seconds (absolute, not relative to trim start). */
  currentTime: () => number;
  seek: (seconds: number) => void;
  /**
   * Mute / unmute immediately, inside the tap handler. iPhone only allows sound when it is turned on
   * during the user's tap, so this must not wait for a React re-render.
   */
  setMutedNow: (muted: boolean) => void;
}

interface MediaPlayerProps {
  mediaType: MediaType;
  mediaUrl: string;
  coverUrl?: string;
  edit: MediaEdit;
  duet?: DuetSource | null;
  active: boolean;
  muted: boolean;
  paused?: boolean;
  loop?: boolean;
  /** Clamp the play window (stories: 60 s). */
  maxSeconds?: number;
  preload?: 'auto' | 'metadata' | 'none';
  onProgress?: (fraction: number) => void;
  onEnded?: () => void;
  onDuration?: (seconds: number) => void;
  /** Called when the browser refused unmuted autoplay (user must tap for sound). */
  onSoundBlocked?: () => void;
  className?: string;
  children?: React.ReactNode;
  /** Low Data Mode: play a 480p video / 800px photo copy (falls back to the original if that fails). */
  lowData?: boolean;
}

export const MediaPlayer = forwardRef<MediaPlayerHandle, MediaPlayerProps>(function MediaPlayer({
  mediaType, mediaUrl, coverUrl, edit, duet, active, muted, paused = false, loop = true, maxSeconds, preload = 'auto',
  onProgress, onEnded, onDuration, onSoundBlocked, className = '', children, lowData = false
}, handleRef) {
  const [lightFailed, setLightFailed] = useState(false);
  const useLight = lowData && !lightFailed;
  const src = useLight ? (mediaType === 'video' ? lightVideoUrl(mediaUrl) : lightImageUrl(mediaUrl)) : mediaUrl;
  useEffect(() => { setLightFailed(false); }, [mediaUrl]);
  const onLightError = () => { if (src !== mediaUrl) { setLightFailed(true); return true; } return false; };
  const videoRef = useRef<HTMLVideoElement>(null);
  const duetRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [mediaDuration, setMediaDuration] = useState(mediaType === 'image' ? IMAGE_SECONDS : 0);
  const [cycle, setCycle] = useState(0); // restarts Ken Burns on every loop
  const imageClock = useRef({ position: 0, last: 0 });
  const lastTime = useRef(-1);
  const callbacks = useRef({ onProgress, onEnded, onSoundBlocked });
  callbacks.current = { onProgress, onEnded, onSoundBlocked };
  const editRef = useRef(edit);
  editRef.current = edit;
  const [buffering, setBuffering] = useState(mediaType === 'video');
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const activeRef = useRef(false);

  // Stop sound when the app goes to the background; resume when it comes back.
  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => { if (mediaType === 'image') injectKenBurns(); }, [mediaType]);
  useEffect(() => { preloadEffects(edit.effects.map(effect => effect.url)); }, [edit.effects]);

  const start = Math.max(0, edit.trimStart || 0);
  const naturalEnd = mediaType === 'image' ? IMAGE_SECONDS : mediaDuration;
  let end = edit.trimEnd > start ? Math.min(edit.trimEnd, naturalEnd || edit.trimEnd) : naturalEnd;
  if (maxSeconds && end - start > maxSeconds) end = start + maxSeconds;
  const windowRef = useRef({ start, end });
  windowRef.current = { start, end };

  const readTime = () => mediaType === 'video' ? (videoRef.current?.currentTime ?? 0) : imageClock.current.position;
  const seekTo = (seconds: number) => {
    if (mediaType === 'video' && videoRef.current) videoRef.current.currentTime = seconds;
    else imageClock.current.position = seconds;
    if (duetRef.current && duet) duetRef.current.currentTime = (duet.trimStart || 0) + Math.max(0, seconds - windowRef.current.start);
    if (musicRef.current) musicRef.current.currentTime = Math.max(0, seconds - windowRef.current.start);
    lastTime.current = seconds - 0.001;
  };

  const setMutedNow = (value: boolean) => {
    const video = videoRef.current;
    const music = musicRef.current;
    if (video) {
      video.muted = value || editRef.current.originalVolume === 0;
      if (!value && activeRef.current && video.paused) void video.play().catch(() => {});
    }
    if (music) {
      music.muted = value;
      if (!value && activeRef.current && editRef.current.soundUrl) void music.play().catch(() => {});
      if (value) music.pause();
    }
  };

  useImperativeHandle(handleRef, () => ({ currentTime: readTime, seek: seekTo, setMutedNow }));

  // Volumes / speed (iOS ignores element volume; 0 still mutes via `muted`).
  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.playbackRate = edit.speed || 1; video.volume = Math.min(1, Math.max(0, edit.originalVolume)); }
    if (duetRef.current) duetRef.current.playbackRate = edit.speed || 1;
    if (musicRef.current) musicRef.current.volume = Math.min(1, Math.max(0, edit.musicVolume));
  }, [edit.speed, edit.originalVolume, edit.musicVolume]);

  // Sync mute flags (before the play effect, so elements start with the right state).
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted || edit.originalVolume === 0;
    if (duetRef.current) duetRef.current.muted = true;
    if (musicRef.current) musicRef.current.muted = muted;
  }, [muted, edit.originalVolume]);

  // Play / pause everything together.
  const shouldPlay = active && !paused && pageVisible;
  activeRef.current = shouldPlay;
  useEffect(() => {
    const video = videoRef.current;
    const music = musicRef.current;
    const duetVideo = duetRef.current;
    if (!shouldPlay) {
      video?.pause(); duetVideo?.pause(); music?.pause();
      return;
    }
    const tryPlay = async (element: HTMLMediaElement | null) => {
      if (!element) return;
      try { await element.play(); }
      catch (error) {
        if ((error as DOMException)?.name === 'NotAllowedError' && !element.muted) {
          element.muted = true; // browser blocked sound: keep playing silently
          callbacks.current.onSoundBlocked?.();
          await element.play().catch(() => {});
        }
      }
    };
    if (video && (video.currentTime < windowRef.current.start || (windowRef.current.end && video.currentTime >= windowRef.current.end))) seekTo(windowRef.current.start);
    void tryPlay(video);
    void tryPlay(duetVideo);
    if (music && edit.soundUrl && !muted) void tryPlay(music);
    else music?.pause();
    imageClock.current.last = performance.now();
  }, [shouldPlay, muted, edit.soundUrl, mediaUrl, src]);

  // Clock: trim loop, timed effects, progress, image timer.
  useEffect(() => {
    if (!shouldPlay) return;
    let frame = 0;
    const tick = (now: number) => {
      const { start: windowStart, end: windowEnd } = windowRef.current;
      if (mediaType === 'image') {
        const clock = imageClock.current;
        clock.position = Math.max(clock.position, windowStart) + Math.max(0, (now - clock.last) / 1000) * (editRef.current.speed || 1);
        clock.last = now;
      }
      const time = readTime();
      if (!muted) {
        for (const effect of editRef.current.effects) {
          if (effect.at > lastTime.current && effect.at <= time && effect.at >= windowStart) playEffect(effect.url);
        }
      }
      lastTime.current = time;
      if (windowEnd > windowStart) {
        callbacks.current.onProgress?.(Math.min(1, Math.max(0, (time - windowStart) / (windowEnd - windowStart))));
        if (time >= windowEnd - 0.02) {
          if (loop) { seekTo(windowStart); setCycle(value => value + 1); }
          else { callbacks.current.onEnded?.(); return; }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    imageClock.current.last = performance.now();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shouldPlay, mediaType, loop, muted]);

  // Reset to the start when a slide becomes active again.
  useEffect(() => {
    if (!active) return;
    seekTo(windowRef.current.start);
    setCycle(value => value + 1);
  }, [active, mediaUrl]);

  const filter = filterCss(edit.filter);
  const media = mediaType === 'video'
    ? <video
        ref={videoRef}
        src={src}
        poster={coverUrl || undefined}
        playsInline
        muted
        preload={preload}
        onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value)) { setMediaDuration(value); onDuration?.(value); } }}
        onLoadStart={() => setBuffering(true)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onError={() => { if (!onLightError()) setBuffering(false); }}
        className="h-full w-full object-cover object-center"
        style={{ filter }}
      />
    : <img
        key={cycle}
        src={src}
        onError={onLightError}
        alt=""
        draggable={false}
        className="h-full w-full object-cover"
        style={{ filter, animation: shouldPlay ? `echatKenBurns ${IMAGE_SECONDS / (edit.speed || 1)}s ease-in-out forwards` : 'none' }}
      />;

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className}`} style={{ containerType: 'inline-size' }}>
      {(coverUrl || mediaType === 'image') && <img src={coverUrl || src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />}
      {duet ? (
        <div className="relative grid h-full w-full grid-cols-2">
          <div className="relative h-full overflow-hidden border-r border-black">
            {duet.mediaType === 'video'
              ? <video ref={duetRef} src={lowData ? lightVideoUrl(duet.mediaUrl) : duet.mediaUrl} playsInline muted preload={preload} className="h-full w-full object-cover" />
              : <img src={duet.mediaUrl} alt="" className="h-full w-full object-cover" />}
            <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">@{duet.creatorName}</span>
          </div>
          <div className="relative h-full overflow-hidden">{media}</div>
        </div>
      ) : <div className="relative h-full w-full">{media}</div>}
      {edit.soundUrl && <audio ref={musicRef} src={edit.soundUrl} loop preload={preload === 'none' ? 'none' : 'auto'} />}
      {edit.overlays.map(overlay => (
        <span
          key={overlay.id}
          className="pointer-events-none absolute z-10 max-w-[90%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-wrap break-words text-center font-extrabold leading-tight"
          style={{ left: `${overlay.x}%`, top: `${overlay.y}%`, color: overlay.color, fontSize: `${overlay.size}cqw`, textShadow: overlay.kind === 'text' ? '0 2px 6px rgba(0,0,0,.7)' : undefined }}
        >{overlay.text}</span>
      ))}
      {mediaType === 'video' && buffering && active && (
        <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center" aria-label="Loading video" role="status">
          <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        </div>
      )}
      {children}
    </div>
  );
});
