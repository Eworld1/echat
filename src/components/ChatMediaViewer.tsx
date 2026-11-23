import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, Maximize, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';

export interface ChatAttachmentItem {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'video' | 'audio' | 'file';
}

export type ChatMediaItem = ChatAttachmentItem & { kind: 'image' | 'video' };

interface Props {
  items: ChatMediaItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const distance = (a: React.Touch, b: React.Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

export async function downloadChatAttachment(item: ChatAttachmentItem): Promise<void> {
  try {
    const response = await fetch(item.url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = item.name;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  } catch (error) {
    console.error('[Chat media] Download failed', {
      url: item.url,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

const absoluteMediaUrl = (url: string) => new URL(url, window.location.origin).href;

async function copyLink(url: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const input = document.createElement('textarea');
  input.value = url;
  input.readOnly = true;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Could not copy the media link.');
}

export async function shareChatAttachment(item: ChatAttachmentItem): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = absoluteMediaUrl(item.url);
  if (navigator.share) {
    try {
      await navigator.share({ title: item.name, url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  await copyLink(url);
  return 'copied';
}

export const ChatMediaViewer: React.FC<Props> = ({ items, index, onIndexChange, onClose }) => {
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const item = items[index];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => { setZoom(1); setStatus(''); }, [index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1));
      if (event.key === 'ArrowRight') onIndexChange(Math.min(items.length - 1, index + 1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, items.length, onClose, onIndexChange]);

  if (!item) return null;

  const changeZoom = (amount: number) => setZoom(value => Math.min(4, Math.max(1, value + amount)));
  const download = async () => {
    setStatus('');
    try {
      await downloadChatAttachment(item);
      setStatus('Downloaded');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not download this media.');
    }
  };
  const share = async () => {
    setStatus('');
    try {
      const result = await shareChatAttachment(item);
      setStatus(result === 'copied' ? 'Link copied' : result === 'shared' ? 'Shared' : '');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not share this media.');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex h-[100dvh] w-full flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Chat media viewer"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className="z-10 flex min-h-14 shrink-0 items-center justify-between gap-3 bg-black/60 px-3 py-2 sm:px-5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{index + 1} of {items.length}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.kind === 'image' && <>
            <button type="button" onClick={() => changeZoom(-0.5)} disabled={zoom <= 1} aria-label="Zoom out" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 disabled:opacity-40"><ZoomOut size={19}/></button>
            <button type="button" onClick={() => changeZoom(0.5)} disabled={zoom >= 4} aria-label="Zoom in" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 disabled:opacity-40"><ZoomIn size={19}/></button>
          </>}
          {item.kind === 'video' && <button type="button" onClick={() => { void videoRef.current?.requestFullscreen().catch(error => setStatus(error instanceof Error ? error.message : 'Fullscreen is unavailable.')); }} aria-label="Fullscreen video" className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><Maximize size={19}/></button>}
          <button type="button" onClick={download} aria-label="Download media" className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><Download size={19}/></button>
          <button type="button" onClick={() => void share()} aria-label="Share media" className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><Share2 size={19}/></button>
          <button type="button" onClick={onClose} aria-label="Close media viewer" className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><X size={20}/></button>
        </div>
      </header>
      <section
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-5"
        onTouchStart={event => {
          const touches = event.touches;
          if (touches.length === 2) pinchStart.current = { distance: distance(touches[0], touches[1]), zoom };
          else if (touches[0]) touchStart.current = { x: touches[0].clientX, y: touches[0].clientY };
        }}
        onTouchMove={event => {
          if (event.touches.length !== 2 || !pinchStart.current) return;
          event.preventDefault();
          setZoom(Math.min(4, Math.max(1, pinchStart.current.zoom * distance(event.touches[0], event.touches[1]) / pinchStart.current.distance)));
        }}
        onTouchEnd={event => {
          const start = touchStart.current;
          const touch = event.changedTouches[0];
          touchStart.current = null;
          pinchStart.current = null;
          if (!start || !touch || zoom > 1 || items.length < 2) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) onIndexChange(Math.max(0, Math.min(items.length - 1, index + (dx < 0 ? 1 : -1))));
        }}
      >
        {item.kind === 'image'
          ? <img src={item.url} alt={item.name} draggable={false} style={{ transform: `scale(${zoom})`, touchAction: 'none' }} className="max-h-full max-w-full select-none object-contain transition-transform duration-100"/>
          : <video ref={videoRef} src={item.url} controls playsInline className="max-h-full max-w-full object-contain"/>}
        {items.length > 1 && <>
          <button type="button" onClick={() => onIndexChange(Math.max(0, index - 1))} disabled={index === 0} aria-label="Previous media" className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 disabled:opacity-30 sm:left-4"><ChevronLeft size={24}/></button>
          <button type="button" onClick={() => onIndexChange(Math.min(items.length - 1, index + 1))} disabled={index === items.length - 1} aria-label="Next media" className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 disabled:opacity-30 sm:right-4"><ChevronRight size={24}/></button>
        </>}
        {status && <p role="status" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-3 py-2 text-xs">{status}</p>}
      </section>
      <p className="shrink-0 truncate bg-black/60 px-4 py-2 text-center text-xs text-white/75">{item.name}</p>
    </div>,
    document.body
  );
};
