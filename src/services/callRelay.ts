import { api } from './api';

/**
 * LiveKit relay for 1:1 calls. Used when peer-to-peer + TURN can't connect within 10s (e.g. a
 * mobile carrier blocks the TURN provider). Both people join the private room "call_<callId>" and
 * publish the SAME microphone/camera tracks the call already uses, so mute / camera-off keep working.
 * LiveKit Cloud brings its own servers and falls back to TCP/TLS on port 443 by itself.
 */
export interface CallRelay {
  leave: () => void;
}

export interface CallRelayHandlers {
  onRemoteTrack: (track: MediaStreamTrack) => void;
  onRemoteTrackEnded: (track: MediaStreamTrack) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onLog: (line: string) => void;
}

export async function joinCallRelay(callId: string, localStream: MediaStream, handlers: CallRelayHandlers): Promise<CallRelay> {
  const { Room, RoomEvent, Track } = await import('livekit-client');
  const { url, token } = await api.getCallRelayToken(callId);
  const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
  let left = false;
  room.on(RoomEvent.TrackSubscribed, track => {
    handlers.onLog(`relay: receiving ${track.kind}`);
    handlers.onRemoteTrack(track.mediaStreamTrack);
  });
  room.on(RoomEvent.TrackUnsubscribed, track => handlers.onRemoteTrackEnded(track.mediaStreamTrack));
  room.on(RoomEvent.Reconnecting, () => handlers.onLog('relay: reconnecting…'));
  room.on(RoomEvent.Reconnected, () => handlers.onLog('relay: reconnected'));
  room.on(RoomEvent.Disconnected, reason => { if (!left) handlers.onDisconnected(String(reason ?? 'disconnected')); });
  handlers.onLog('relay: connecting to LiveKit…');
  await room.connect(url, token, { autoSubscribe: true });
  handlers.onLog('relay: connected to LiveKit');
  handlers.onConnected();
  for (const track of localStream.getTracks()) {
    if (track.readyState !== 'live') continue;
    await room.localParticipant.publishTrack(track, { source: track.kind === 'audio' ? Track.Source.Microphone : Track.Source.Camera })
      .catch(error => handlers.onLog(`relay: could not send ${track.kind}: ${error instanceof Error ? error.message : error}`));
  }
  return {
    leave: () => {
      if (left) return;
      left = true;
      // Keep our own mic/camera tracks running: the call (not LiveKit) owns and stops them.
      void room.disconnect(false);
    }
  };
}
