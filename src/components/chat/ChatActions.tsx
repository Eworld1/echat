import React, { useEffect, useRef, useState } from 'react';
import { Copy, CornerUpLeft, Loader2, Pause, Pencil, Play, Reply, SendHorizontal, Trash2, X } from 'lucide-react';

/**
 * WhatsApp-style chat actions shared by the private chat (and group chat when it exists):
 * swipe-to-reply + long-press, the action sheet, the "Delete for everyone / Delete for me" box,
 * confirm dialogs, reply quotes and the voice-note preview player.
 */

const SWIPE_TRIGGER = 64;
const LONG_PRESS_MS = 450;

/** Wraps one message: swipe left/right to reply, long-press (or right-click) to open the menu. */
export const SwipeableMessage: React.FC<{
  id: string;
  isMine: boolean;
  highlighted?: boolean;
  onReply: () => void;
  onLongPress: () => void;
  children: React.ReactNode;
}> = ({ id, isMine, highlighted, onReply, onLongPress, children }) => {
  const [dx, setDxState] = useState(0);
  // The live offset is kept in a ref too: pointerup must see the latest value, not the last render's.
  const dxRef = useRef(0);
  const setDx = (value: number) => { dxRef.current = value; setDxState(value); };
  const start = useRef<{ x: number; y: number; pointerId: number; locked: 'x' | 'y' | null } | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  const cancelPress = () => { window.clearTimeout(pressTimer.current); pressTimer.current = undefined; };
  const reset = () => { cancelPress(); start.current = null; setDx(0); };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    longPressed.current = false;
    start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, locked: null };
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setDx(0);
      navigator.vibrate?.(20);
      onLongPress();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.pointerId !== event.pointerId) return;
    const moveX = event.clientX - s.x;
    const moveY = event.clientY - s.y;
    if (Math.abs(moveX) > 8 || Math.abs(moveY) > 8) cancelPress();
    if (!s.locked && (Math.abs(moveX) > 10 || Math.abs(moveY) > 10)) s.locked = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
    if (s.locked === 'x' && !longPressed.current) setDx(Math.max(-90, Math.min(90, moveX)));
  };
  const onPointerUp = () => {
    const swiped = Math.abs(dxRef.current) >= SWIPE_TRIGGER && !longPressed.current;
    reset();
    if (swiped) { navigator.vibrate?.(15); onReply(); }
  };

  useEffect(() => () => cancelPress(), []);
  const progress = Math.min(1, Math.abs(dx) / SWIPE_TRIGGER);

  return (
    <div
      id={`msg-${id}`}
      className={`relative max-w-[82%] touch-pan-y select-none sm:max-w-[70%] ${isMine ? 'self-end' : 'self-start'} ${highlighted ? 'ec-msg-highlight' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      onPointerLeave={() => { if (start.current) onPointerUp(); }}
      onContextMenu={event => { event.preventDefault(); cancelPress(); onLongPress(); }}
      onClickCapture={event => { if (longPressed.current) { event.preventDefault(); event.stopPropagation(); longPressed.current = false; } }}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white text-slate-600 shadow ${dx >= 0 ? '-left-10' : '-right-10'}`}
        style={{ opacity: progress, transform: `translateY(-50%) scale(${0.6 + progress * 0.4})` }}
      >
        <Reply size={16} className={dx < 0 ? 'scale-x-[-1]' : ''} />
      </span>
      <div style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform 180ms ease' }}>{children}</div>
    </div>
  );
};

/** "Moses" + preview inside a bubble (tap scrolls to the original) or above the composer. */
export const ReplyQuote: React.FC<{ name: string; preview: string; isMine?: boolean; onClick?: () => void; onClose?: () => void; compact?: boolean }> = ({ name, preview, isMine, onClick, onClose, compact }) => {
  const box = `flex min-w-0 items-stretch overflow-hidden rounded-lg text-left ${isMine ? 'bg-white/15' : 'bg-slate-100'}`;
  const body = (
    <>
      <span className={`w-1 shrink-0 ${isMine ? 'bg-white/70' : 'bg-emerald-500'}`} />
      <span className="min-w-0 flex-1 px-2.5 py-1.5">
        <span className={`block truncate text-xs font-bold ${isMine ? 'text-white' : 'text-emerald-700'}`}>{name}</span>
        <span className={`block truncate text-xs ${isMine ? 'text-white/85' : 'text-slate-600'}`}>{preview}</span>
      </span>
    </>
  );
  if (onClose) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-1.5 ring-1 ring-slate-200">
        <CornerUpLeft size={16} className="ml-1 shrink-0 text-emerald-600" />
        <div className={`${box} flex-1 bg-white`}>{body}</div>
        <button type="button" onClick={onClose} aria-label="Cancel reply" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-200"><X size={16} /></button>
      </div>
    );
  }
  return <button type="button" onClick={event => { event.stopPropagation(); onClick?.(); }} className={`${box} ${compact ? '' : 'mb-1.5'} w-full`}>{body}</button>;
};

/** Long-press menu: Reply, Copy, Edit (own text, 15 min), Delete. Bottom sheet on phones, small box on desktop. */
export const MessageActionSheet: React.FC<{
  preview: string;
  canEdit: boolean;
  canCopy: boolean;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ preview, canEdit, canCopy, onReply, onCopy, onEdit, onDelete, onClose }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const item = 'flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-[15px] font-semibold text-slate-800 hover:bg-slate-100';
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} role="presentation">
      <div role="menu" aria-label="Message options" onClick={event => event.stopPropagation()} className="w-full max-w-sm rounded-t-3xl bg-white p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-2">
        <p className="truncate px-4 pb-2 pt-2 text-xs text-slate-500">{preview}</p>
        <button type="button" role="menuitem" onClick={onReply} className={item}><Reply size={19} className="text-emerald-600" />Reply</button>
        {canCopy && <button type="button" role="menuitem" onClick={onCopy} className={item}><Copy size={19} className="text-slate-500" />Copy</button>}
        {canEdit && <button type="button" role="menuitem" onClick={onEdit} className={item}><Pencil size={19} className="text-blue-600" />Edit</button>}
        <button type="button" role="menuitem" onClick={onDelete} className={`${item} text-red-600`}><Trash2 size={19} />Delete</button>
        <button type="button" onClick={onClose} className="mt-1 min-h-12 w-full rounded-xl bg-slate-100 text-[15px] font-bold text-slate-700">Cancel</button>
      </div>
    </div>
  );
};

/** WhatsApp delete box: centered, asks first, two clear choices. */
export const DeleteMessageModal: React.FC<{
  canDeleteForEveryone: boolean;
  busy: boolean;
  error?: string;
  onEveryone: () => void;
  onMe: () => void;
  onCancel: () => void;
}> = ({ canDeleteForEveryone, busy, error, onEveryone, onMe, onCancel }) => (
  <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-6" onClick={busy ? undefined : onCancel} role="presentation">
    <div role="alertdialog" aria-modal="true" aria-labelledby="delete-msg-title" onClick={event => event.stopPropagation()} className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
      <h2 id="delete-msg-title" className="text-lg font-bold text-slate-900">Delete message?</h2>
      <p className="mt-1 text-sm text-slate-500">{canDeleteForEveryone ? 'Delete for everyone removes it for both of you.' : 'This removes it only from your chat.'}</p>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
      <div className="mt-4 flex flex-col gap-2">
        {canDeleteForEveryone && <button type="button" disabled={busy} onClick={onEveryone} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-[15px] font-bold text-white hover:bg-red-700 disabled:opacity-60">{busy ? <Loader2 size={18} className="animate-spin" /> : <span aria-hidden="true">🗑️</span>}Delete for everyone</button>}
        <button type="button" disabled={busy} onClick={onMe} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-50 px-4 text-[15px] font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-60"><span aria-hidden="true">🗑️</span>Delete for me</button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-xl px-4 text-[15px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60">Cancel</button>
      </div>
    </div>
  </div>
);

export const ConfirmDialog: React.FC<{ title: string; message: string; confirmLabel: string; busy: boolean; error?: string; onConfirm: () => void; onCancel: () => void }> = ({ title, message, confirmLabel, busy, error, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-6" onClick={busy ? undefined : onCancel} role="presentation">
    <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={event => event.stopPropagation()} className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
      <h2 id="confirm-title" className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{message}</p>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl px-4 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60">Cancel</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">{busy && <Loader2 size={16} className="animate-spin" />}{confirmLabel}</button>
      </div>
    </div>
  </div>
);

const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Bar heights (0..1) from the recorded audio, so the preview looks like WhatsApp's waveform. */
async function waveformOf(blob: Blob, bars = 36): Promise<number[]> {
  try {
    // Offline context: decodes without opening the speaker / audio device (lighter, never blocks the mic).
    const Offline = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const context = new Offline(1, 1, 44100);
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / bars));
    const peaks = Array.from({ length: bars }, (_, i) => {
      let max = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) max = Math.max(max, Math.abs(data[j]));
      return max;
    });
    const top = Math.max(...peaks, 0.01);
    return peaks.map(p => Math.max(0.12, p / top));
  } catch {
    return Array.from({ length: bars }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 1.7)));
  }
}

/** After recording: listen first, then Send - or Delete and record again. Nothing is sent automatically. */
export const VoiceNotePreview: React.FC<{ blob: Blob; seconds: number; sending: boolean; onSend: () => void; onDelete: () => void }> = ({ blob, seconds, sending, onSend, onDelete }) => {
  const [url] = useState(() => URL.createObjectURL(blob));
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(seconds);
  const [bars, setBars] = useState<number[]>([]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => { let alive = true; void waveformOf(blob).then(result => { if (alive) setBars(result); }); return () => { alive = false; }; }, [blob]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <div className="flex w-full min-w-0 items-center gap-2" aria-label="Voice message preview">
      <button type="button" onClick={onDelete} disabled={sending} aria-label="Delete voice message" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={20} /></button>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-3xl bg-slate-100 px-2 py-1.5">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-600 text-white">{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}</button>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px]" aria-hidden="true">
          {(bars.length ? bars : Array.from({ length: 36 }, () => 0.2)).map((height, i, all) => (
            <span key={i} className={`w-[3px] shrink-0 rounded-full ${i / all.length <= progress ? 'bg-blue-600' : 'bg-slate-400'}`} style={{ height: `${Math.round(height * 100)}%` }} />
          ))}
        </div>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-600">{fmt(playing || position ? position : duration)}</span>
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setPosition(0); }}
          onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={event => { const d = event.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDuration(d); }}
          className="hidden"
        />
      </div>
      <button type="button" onClick={onSend} disabled={sending} aria-label="Send voice message" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">{sending ? <Loader2 size={18} className="animate-spin" /> : <SendHorizontal size={19} />}</button>
    </div>
  );
};
