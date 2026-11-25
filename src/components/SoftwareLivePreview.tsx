import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore The SDK package is installed by Vercel's production install; local typings may be absent.
import { Room, RoomEvent, Track } from 'livekit-client';
import { api } from '../services/api';

/**
 * Host preview of what viewers see from the streaming app (OBS…): joins the live room as a
 * subscriber, muted (no echo), through the same /api/live/watch path viewers use.
 */
export const SoftwareLivePreview: React.FC<{ streamId: string; hostId: string }> = ({ streamId, hostId }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<'connecting' | 'playing' | 'waiting' | 'error'>('connecting');

  useEffect(() => {
    let cancelled = false;
    let room: Room | null = null;
    setState('connecting');
    void (async () => {
      try {
        const credentials = await api.getLiveKitViewerToken(streamId, hostId);
        if (cancelled) return;
        room = new Room({ adaptiveStream: true, dynacast: true });
        room.on(RoomEvent.TrackSubscribed, (track: any) => {
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            videoRef.current.muted = true;
            void videoRef.current.play().catch(() => {});
            setState('playing');
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track: any) => { if (track.kind === Track.Kind.Video) setState('waiting'); });
        await room.connect(credentials.url, credentials.token);
        if (!cancelled) setState(current => (current === 'playing' ? current : 'waiting'));
      } catch (error) {
        console.warn('[Go Live] Preview unavailable:', error);
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; room?.disconnect(); };
  }, [streamId, hostId]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} muted playsInline autoPlay aria-label="Preview of your live" className="h-full w-full object-contain" />
      {state !== 'playing' && (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-xs font-semibold text-slate-300">
          {state === 'connecting' ? 'Loading preview…' : state === 'waiting' ? 'Waiting for video from your streaming app…' : 'Preview unavailable — viewers can still watch.'}
        </p>
      )}
      <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Preview</span>
    </div>
  );
};
