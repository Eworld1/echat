/**
 * DM calls: shared types and helpers. Signaling (offer / answer / ICE candidates / status) lives in
 * the Firestore `calls` collection, which doubles as the call history:
 *   callerId, receiverId, type ('audio' | 'video'), status ('ringing' → 'answered' | 'declined' | 'missed'),
 *   duration (seconds), createdAt (ms).
 * No signaling server is needed, so calls work the same on Vercel and Render.
 */

export type CallStatus = 'ringing' | 'answered' | 'declined' | 'missed';

export interface CallDoc {
  callerId: string;
  callerName: string;
  callerAvatar: string;
  receiverId: string;
  receiverName: string;
  receiverAvatar: string;
  type: 'audio' | 'video';
  /** Same as `type` (kept for older app versions). */
  callType: 'audio' | 'video';
  status: CallStatus;
  /** Why a call was missed or declined: busy, unavailable, no_answer, cancelled, declined, no_permission, failed. */
  reason?: string;
  offer: RTCSessionDescriptionInit | null;
  answer: RTCSessionDescriptionInit | null;
  callerCandidates: RTCIceCandidateInit[];
  receiverCandidates: RTCIceCandidateInit[];
  duration: number;
  createdAt: number;
  /** Set by the receiver's device when it starts ringing. */
  ringingAt?: number;
  answeredAt?: number;
  endedAt?: number;
  endedBy?: string;
  /** Mid-call switch between audio and video. */
  currentType?: 'audio' | 'video';
  currentTypeBy?: string;
}

/** No device rang within this time: "User is unavailable". */
export const CALL_DELIVERY_TIMEOUT_MS = 20_000;
/** Rang but nobody answered within this time: missed call. */
export const CALL_ANSWER_TIMEOUT_MS = 45_000;
/** Ringing calls older than this are stale (caller closed the app) and never shown. */
export const CALL_RING_MAX_AGE_MS = 70_000;

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO: MediaTrackConstraints = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };

/**
 * Ask for microphone (+ camera for video calls). If a video call is placed from a device without a
 * working camera, fall back to audio so the call still happens.
 */
export async function getCallMedia(type: 'audio' | 'video'): Promise<{ stream: MediaStream; videoFallback: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Calls need a secure (https) page and a browser that supports calling.'), { name: 'NotSupportedError' });
  }
  if (type === 'audio') return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false }), videoFallback: false };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: VIDEO }), videoFallback: false };
  } catch (error) {
    const name = (error as DOMException)?.name;
    if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false }), videoFallback: true };
    }
    throw error;
  }
}

export function callMediaErrorMessage(error: unknown, type: 'audio' | 'video', action: 'start' | 'accept'): string {
  const name = (error as DOMException)?.name;
  const devices = type === 'video' ? 'microphone and camera' : 'microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return `Allow ${devices} access to ${action === 'start' ? 'start' : 'answer'} this call. Tap the lock or camera icon in your browser's address bar, choose Allow, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return `Your ${devices} is being used by another app. Close it and try again.`;
  if (name === 'NotSupportedError') return (error as Error).message;
  return `Could not use your ${devices}. Check your device settings and try again.`;
}

/** Candidates the other side has published that this side should add. */
export function remoteCandidates(data: CallDoc, myRole: 'caller' | 'receiver'): RTCIceCandidateInit[] {
  const list = myRole === 'caller' ? data.receiverCandidates : data.callerCandidates;
  return Array.isArray(list) ? list : [];
}

export function unavailableMessage(name: string, reason?: string): string {
  const who = name || 'This person';
  if (reason === 'busy') return `${who} is on another call. User is unavailable.`;
  if (reason === 'no_answer') return `${who} didn't answer.`;
  return `User is unavailable. ${who} isn't online right now - they'll see a missed call.`;
}
