import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Pause, Play, Trash2 } from 'lucide-react';

export const VOICE_MAX_SECONDS = 30;

export interface VoiceClip {
  file: File;
  previewUrl: string;
  duration: number;
}

const formatSecs = (value: number) => {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
};

/** Deterministic pseudo-waveform so the same clip always draws the same bars. */
const waveformFor = (seed: string, bars: number) => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: bars }, (_, i) => {
    hash = Math.imul(hash ^ (i + 1), 2654435761) >>> 0;
    return 0.25 + ((hash % 1000) / 1000) * 0.75;
  });
};

/** Cloudinary serves audio under /video/upload/; an .mp3 variant plays in every browser (e.g. old Safari without WebM). */
const mp3Fallback = (url: string) => /^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//.test(url) ? url.replace(/\.[a-z0-9]+(\?.*)?$/i, '.mp3') : '';

interface HoldToRecordProps {
  onRecorded: (clip: VoiceClip) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

/** Press and hold to record (up to 30s). Releasing stops; reaching 30s stops automatically. */
export const HoldToRecordButton: React.FC<HoldToRecordProps> = ({ onRecorded, onError, disabled, compact }) => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const holdingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const limitRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (limitRef.current !== null) window.clearTimeout(limitRef.current);
    tickRef.current = null;
    limitRef.current = null;
  };

  const stop = () => {
    holdingRef.current = false;
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    setRecording(false);
  };

  useEffect(() => () => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const start = async () => {
    if (disabled || recording) return;
    holdingRef.current = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError?.('Voice recording is not supported in this browser.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      holdingRef.current = false;
      onError?.('Microphone access was denied. Allow the mic to record a voice post.');
      return;
    }
    // Released before the mic was ready (e.g. while the permission prompt was open): don't record.
    if (!holdingRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
    streamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      const duration = Math.min(VOICE_MAX_SECONDS, (Date.now() - startedAtRef.current) / 1000);
      if (duration < 1 || !chunks.length) { onError?.('Hold the mic button a little longer to record.'); return; }
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type });
      onRecorded({ file, previewUrl: URL.createObjectURL(blob), duration: Math.max(1, Math.round(duration)) });
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setElapsed(0);
    setRecording(true);
    tickRef.current = window.setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 200);
    limitRef.current = window.setTimeout(stop, VOICE_MAX_SECONDS * 1000);
  };

  const progress = Math.min(1, elapsed / VOICE_MAX_SECONDS);
  const size = compact ? 36 : 64;

  return (
    <div className={`flex select-none items-center ${compact ? 'gap-2' : 'flex-col gap-2'}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={recording ? 'Release to stop recording' : 'Hold to record a voice message'}
        title="Hold to record (up to 30s)"
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); void start(); }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); void start(); } }}
        onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') stop(); }}
        className={`relative grid shrink-0 touch-none place-items-center rounded-full text-white shadow transition disabled:opacity-50 ${recording ? 'scale-110 bg-red-500' : 'bg-[#1877F2] hover:bg-[#166FE5]'}`}
        style={{ width: size, height: size, background: recording ? `conic-gradient(#fff3 ${progress * 360}deg, transparent 0) , #ef4444` : undefined }}
      >
        <Mic size={compact ? 16 : 26} />
        {recording && <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-red-400/40" />}
      </button>
      <span className={`text-xs font-semibold ${recording ? 'text-red-600' : 'text-slate-500'}`} aria-live="polite">
        {recording ? `Recording… ${formatSecs(elapsed)} / 0:30` : compact ? '' : 'Hold to record · up to 30s'}
      </span>
    </div>
  );
};

interface VoicePlayerProps {
  src: string;
  duration?: number;
  compact?: boolean;
  onRemove?: () => void;
}

/** Play/pause, waveform progress bar (tap to seek) and duration. */
export const VoicePlayer: React.FC<VoicePlayerProps> = ({ src, duration = 0, compact, onRemove }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration);
  const [source, setSource] = useState(src);
  const [failed, setFailed] = useState(false);
  const bars = useMemo(() => waveformFor(src, compact ? 28 : 40), [src, compact]);

  useEffect(() => { setSource(src); setFailed(false); setCurrent(0); setPlaying(false); }, [src]);
  useEffect(() => { if (duration) setTotal(duration); }, [duration]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play().catch(() => setPlaying(false));
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total;
  };

  const progress = total ? Math.min(1, current / total) : 0;

  return (
    <div className={`flex w-full items-center gap-3 ${compact ? 'rounded-full bg-slate-100 px-2 py-1.5' : 'rounded-2xl bg-gradient-to-r from-blue-50 to-violet-50 px-3 py-3'}`}>
      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setTotal(value); }}
        onError={() => { const fallback = mp3Fallback(src); if (fallback && source !== fallback) setSource(fallback); else setFailed(true); }}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={failed}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className={`grid shrink-0 place-items-center rounded-full bg-[#1877F2] text-white shadow hover:bg-[#166FE5] disabled:bg-slate-300 ${compact ? 'h-8 w-8' : 'h-11 w-11'}`}
      >
        {playing ? <Pause size={compact ? 14 : 18} fill="currentColor" /> : <Play size={compact ? 14 : 18} fill="currentColor" className="ml-0.5" />}
      </button>
      <div role="slider" aria-label="Voice message progress" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(current)} tabIndex={-1} onClick={seek} className={`flex flex-1 cursor-pointer items-center gap-[2px] ${compact ? 'h-6' : 'h-9'}`}>
        {bars.map((height, index) => (
          <span
            key={index}
            className={`flex-1 rounded-full transition-colors ${index / bars.length < progress ? 'bg-[#1877F2]' : 'bg-slate-300'}`}
            style={{ height: `${Math.round(height * 100)}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 font-mono text-xs font-bold text-slate-600">
        {failed ? 'Unavailable' : formatSecs(playing || current > 0 ? current : total)}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Discard voice recording" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-500">
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
};
