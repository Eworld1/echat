/**
 * Facebook-style profile picture + cover photo editing. No image links are ever shown:
 * tap the picture -> choose from the device (gallery / camera / files) -> crop -> upload -> saved
 * on the profile and shown everywhere straight away. "Remove photo" goes back to the generated one.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, Loader2, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { gradientCover, initialsAvatar, isGeneratedImage } from '../utils/avatar';

export type PhotoKind = 'avatar' | 'cover';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const ALLOWED = /^image\/(jpeg|jpg|png|webp)$/i;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const OUTPUT: Record<PhotoKind, { width: number; height: number; aspect: number }> = {
  avatar: { width: 720, height: 720, aspect: 1 },
  cover: { width: 1600, height: 900, aspect: 16 / 9 }
};

export function checkImageFile(file: File): string {
  if (!ALLOWED.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) return 'Please choose a JPG, PNG or WebP photo.';
  if (file.size > MAX_INPUT_BYTES) return 'That photo is too large. Please choose one under 20 MB.';
  return '';
}

/* ------------------------------------------------------------------ cropper ------------------------------------------------------------------ */

interface CropperProps {
  file: File;
  kind: PhotoKind;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}

/** Drag to position, pinch / wheel / slider to zoom. Returns a JPEG of exactly the cropped area. */
export const PhotoCropper: React.FC<CropperProps> = ({ file, kind, onCancel, onDone }) => {
  const { aspect, width: outW, height: outH } = OUTPUT[kind];
  const frameRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState('');
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setImg(image);
    image.onerror = () => setLoadError('This photo could not be opened. Please choose another one.');
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientWidth / aspect });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);

  const baseScale = img && frame.w ? Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight) : 1;
  const scale = baseScale * zoom;

  const clamp = useCallback((p: { x: number; y: number }, s = scale) => {
    if (!img) return p;
    const minX = frame.w - img.naturalWidth * s;
    const minY = frame.h - img.naturalHeight * s;
    return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
  }, [img, frame, scale]);

  // Centre the photo when it loads or the frame size changes.
  useEffect(() => {
    if (!img || !frame.w) return;
    const s = Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight);
    setZoom(1);
    setPos({ x: (frame.w - img.naturalWidth * s) / 2, y: (frame.h - img.naturalHeight * s) / 2 });
  }, [img, frame.w, frame.h]);

  /** Zoom around the frame centre so the middle of the picture stays put. */
  const applyZoom = (next: number) => {
    if (!img) return;
    const z = Math.min(4, Math.max(1, next));
    const newScale = baseScale * z;
    const cx = frame.w / 2, cy = frame.h / 2;
    const ix = (cx - pos.x) / scale, iy = (cy - pos.y) / scale;
    setZoom(z);
    setPos(clamp({ x: cx - ix * newScale, y: cy - iy * newScale }, newScale));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      applyZoom(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.current.dist || 1)));
      return;
    }
    setPos(p => clamp({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = async () => {
    if (!img || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, -pos.x / scale, -pos.y / scale, frame.w / scale, frame.h / scale, 0, 0, outW, outH);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob) throw new Error('no blob');
      onDone(new File([blob], `${kind === 'avatar' ? 'profile' : 'cover'}-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    } catch {
      setLoadError('Could not prepare this photo. Please try another one.');
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-stretch justify-center bg-[#000000]/75 sm:items-center sm:p-6" role="presentation" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={kind === 'avatar' ? 'Crop profile picture' : 'Crop cover photo'} onClick={e => e.stopPropagation()} style={{ colorScheme: 'light' }}
        className="flex h-dvh w-full flex-col bg-[#ffffff] text-[#111111] sm:h-auto sm:max-w-[620px] sm:rounded-2xl sm:shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#eceef1] px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] sm:pt-3">
          <h3 className="text-[18px] font-extrabold">{kind === 'avatar' ? 'Choose profile picture' : 'Choose cover photo'}</h3>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="grid h-10 w-10 place-items-center rounded-full text-[#4b5563] hover:bg-[#f1f2f4]"><X size={20} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 overflow-y-auto px-4 py-5">
          <div ref={frameRef} className="relative mx-auto w-full max-w-[560px] touch-none select-none overflow-hidden rounded-xl bg-[#111111]"
            style={{ aspectRatio: String(aspect), cursor: 'grab' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onWheel={e => applyZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
            {img && <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 max-w-none"
              style={{ width: img.naturalWidth * scale, height: img.naturalHeight * scale, transform: `translate(${pos.x}px, ${pos.y}px)` }} />}
            {kind === 'avatar' && img && <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-[#ffffff]/80" />}
            {kind === 'cover' && img && <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-[#ffffff]/70" />}
            {!img && !loadError && <div className="absolute inset-0 grid place-items-center text-[#ffffff]"><Loader2 className="animate-spin" size={28} /></div>}
          </div>
          {loadError
            ? <p role="alert" className="text-center text-[14px] font-semibold text-[#b91c1c]">{loadError}</p>
            : <p className="text-center text-[13px] text-[#6b7280]">Drag to reposition · pinch or use the slider to zoom</p>}
          <div className="mx-auto flex w-full max-w-[420px] items-center gap-3">
            <button type="button" onClick={() => applyZoom(zoom - 0.2)} aria-label="Zoom out" className="grid h-9 w-9 place-items-center rounded-full hover:bg-[#f1f2f4]"><ZoomOut size={18} /></button>
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={e => applyZoom(Number(e.target.value))} aria-label="Zoom" className="flex-1 accent-[#2563eb]" />
            <button type="button" onClick={() => applyZoom(zoom + 0.2)} aria-label="Zoom in" className="grid h-9 w-9 place-items-center rounded-full hover:bg-[#f1f2f4]"><ZoomIn size={18} /></button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#eceef1] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <button type="button" onClick={onCancel} className="h-11 rounded-xl px-5 text-[15px] font-bold text-[#1f2937] hover:bg-[#f1f2f4]">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!img || busy || Boolean(loadError)} className="h-11 rounded-xl bg-[#2563eb] px-6 text-[15px] font-bold text-[#ffffff] hover:bg-[#1d4ed8] disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ------------------------------------------------------------- upload + save hook ------------------------------------------------------------- */

/** Choose -> crop -> upload -> save on the profile (Firestore + server), with spinner/error state. */
export function useProfilePhotoUpload(onSaved?: (kind: PhotoKind, url: string) => void) {
  const { user, updateCurrentUser } = useAuth();
  const [pending, setPending] = useState<{ kind: PhotoKind; file: File } | null>(null);
  const [uploading, setUploading] = useState<PhotoKind | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputs = { avatar: useRef<HTMLInputElement>(null), cover: useRef<HTMLInputElement>(null) };

  const choose = (kind: PhotoKind) => { setError(''); inputs[kind].current?.click(); };

  const onFile = (kind: PhotoKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkImageFile(file);
    if (problem) { setError(problem); return; }
    setPending({ kind, file });
  };

  const save = async (kind: PhotoKind, value: string) => {
    await updateCurrentUser(kind === 'avatar' ? { avatar: value } : { coverPhoto: value });
    onSaved?.(kind, value);
  };

  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 3000); };

  const upload = async (kind: PhotoKind, cropped: File) => {
    setPending(null);
    setUploading(kind);
    setError('');
    try {
      const url = await api.uploadFile(cropped);
      if (!url) throw new Error('Upload failed');
      await save(kind, url);
      flash(kind === 'avatar' ? 'Profile picture updated' : 'Cover photo updated');
    } catch (err) {
      console.warn('Profile photo upload failed:', err);
      const message = err instanceof Error && err.message ? err.message : '';
      setError(`Upload failed${message && !/^upload failed$/i.test(message) ? `: ${message}` : ''}. Please check your connection and try again.`);
    } finally {
      setUploading(null);
    }
  };

  const remove = async (kind: PhotoKind) => {
    if (!user) return;
    setUploading(kind);
    setError('');
    try {
      await save(kind, kind === 'avatar' ? initialsAvatar(user.name || '?') : gradientCover(user.name || 'echat'));
      flash(kind === 'avatar' ? 'Profile picture removed' : 'Cover photo removed');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not remove the photo. Please try again.');
    } finally {
      setUploading(null);
    }
  };

  const elements = (
    <>
      <input ref={inputs.avatar} type="file" accept={ACCEPT} className="hidden" aria-hidden="true" tabIndex={-1} onChange={onFile('avatar')} />
      <input ref={inputs.cover} type="file" accept={ACCEPT} className="hidden" aria-hidden="true" tabIndex={-1} onChange={onFile('cover')} />
      {pending && <PhotoCropper file={pending.file} kind={pending.kind} onCancel={() => setPending(null)} onDone={cropped => void upload(pending.kind, cropped)} />}
    </>
  );

  return { choose, remove, uploading, error, notice, elements };
}

/* ------------------------------------------------------------------- menu ------------------------------------------------------------------- */

const PhotoMenu: React.FC<{ align?: "center" | "right"; kind: PhotoKind; canRemove: boolean; onUpload: () => void; onRemove: () => void; onClose: () => void }> = ({ align = "center", kind, canRemove, onUpload, onRemove, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = window.setTimeout(() => document.addEventListener('pointerdown', away), 0);
    document.addEventListener('keydown', esc);
    return () => { window.clearTimeout(t); document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const item = 'flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] font-semibold hover:bg-[#f1f2f4]';
  return (
    <div ref={ref} role="menu" style={{ colorScheme: 'light' }} className={`absolute top-full z-30 mt-2 w-60 ${align === "right" ? "right-0" : "left-1/2 -translate-x-1/2"} overflow-hidden rounded-xl border border-[#e5e7eb] bg-[#ffffff] py-1 text-[#111111] shadow-xl`}>
      <button type="button" role="menuitem" className={item} onClick={() => { onClose(); onUpload(); }}>
        <ImagePlus size={18} className="text-[#2563eb]" />{kind === 'avatar' ? 'Upload profile picture' : 'Upload cover photo'}
      </button>
      {canRemove && (
        <button type="button" role="menuitem" className={`${item} text-[#b91c1c]`} onClick={() => { onClose(); onRemove(); }}>
          <Trash2 size={18} />Remove photo
        </button>
      )}
    </div>
  );
};

/* -------------------------------------------------------------- settings block -------------------------------------------------------------- */

/** Cover photo with "Edit Cover Photo" + round profile picture with a camera badge. */
export const ProfilePhotoEditor: React.FC<{ onSaved?: (kind: PhotoKind, url: string) => void }> = ({ onSaved }) => {
  const { user } = useAuth();
  const photos = useProfilePhotoUpload(onSaved);
  const [menu, setMenu] = useState<PhotoKind | null>(null);
  if (!user) return null;
  const avatar = user.avatar || initialsAvatar(user.name || '?');
  const cover = user.coverPhoto || gradientCover(user.name || 'echat');
  const busy = photos.uploading !== null;
  const open = (kind: PhotoKind) => { if (!busy) setMenu(current => (current === kind ? null : kind)); };

  return (
    <div className="space-y-2">
      <div className="relative">
        {/* Cover photo */}
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-600 to-indigo-700 sm:aspect-[16/6]">
          <img key={cover} src={cover} alt="Cover photo" onError={e => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
          {photos.uploading === 'cover' && (
            <div className="absolute inset-0 grid place-items-center bg-[#000000]/45 text-[#ffffff]"><span className="flex items-center gap-2 text-sm font-bold"><Loader2 size={22} className="animate-spin" />Uploading…</span></div>
          )}
        </div>
        <div className="absolute bottom-3 right-3">
          <button type="button" onClick={() => open('cover')} disabled={busy} aria-haspopup="menu" aria-expanded={menu === 'cover'}
            className="flex items-center gap-1.5 rounded-lg bg-[#ffffff]/95 px-3 py-2 text-[13px] font-bold text-[#111111] shadow-md hover:bg-[#ffffff] disabled:opacity-60">
            <Camera size={16} />Edit Cover Photo
          </button>
          {menu === 'cover' && <PhotoMenu align="right" kind="cover" canRemove={!isGeneratedImage(user.coverPhoto)} onUpload={() => photos.choose('cover')} onRemove={() => void photos.remove('cover')} onClose={() => setMenu(null)} />}
        </div>

        {/* Profile picture */}
        <div className="absolute -bottom-14 left-4 sm:left-6">
          <div className="relative h-28 w-28 sm:h-32 sm:w-32">
            <button type="button" onClick={() => open('avatar')} disabled={busy} aria-label="Change profile picture" aria-haspopup="menu" aria-expanded={menu === 'avatar'}
              className="block h-full w-full overflow-hidden rounded-full border-4 border-white bg-slate-200 shadow-lg">
              <img key={avatar} src={avatar} alt="Profile picture" className="h-full w-full object-cover" onError={e => { e.currentTarget.src = initialsAvatar(user.name || '?'); }} />
              {photos.uploading === 'avatar' && <span className="absolute inset-0 grid place-items-center rounded-full bg-[#000000]/45 text-[#ffffff]"><Loader2 size={26} className="animate-spin" /></span>}
            </button>
            <button type="button" onClick={() => open('avatar')} disabled={busy} aria-label="Edit profile picture" tabIndex={-1}
              className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[#e4e6eb] text-[#111111] shadow hover:bg-[#d8dadf] disabled:opacity-60">
              <Camera size={17} />
            </button>
            {menu === 'avatar' && <PhotoMenu kind="avatar" canRemove={!isGeneratedImage(user.avatar)} onUpload={() => photos.choose('avatar')} onRemove={() => void photos.remove('avatar')} onClose={() => setMenu(null)} />}
          </div>
        </div>
      </div>
      <div className="h-14" />
      <div aria-live="polite" className="min-h-5 text-xs font-bold">
        {photos.error ? <span role="alert" className="text-red-600">{photos.error}</span> : photos.notice ? <span className="text-emerald-600">✓ {photos.notice}</span> : <span className="font-medium text-slate-500">Tap your picture or the cover to change it.</span>}
      </div>
      {photos.elements}
    </div>
  );
};
