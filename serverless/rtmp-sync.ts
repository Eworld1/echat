/**
 * Streaming software (OBS, Streamlabs, vMix, Larix…) → eChat live, like Facebook / YouTube Live:
 * the moment the app starts pushing RTMP to the user's LiveKit ingress, the user IS live.
 *
 * The truth always comes from LiveKit itself (IngressClient.listIngress → state.status), so the same
 * code runs for every trigger: the LiveKit webhook, the host's Streaming Software tab (every 3 s) and
 * viewers' Live tab. When the ingress publishes → liveStreams/{id} + lives/{hostId} status 'live';
 * when it stops → status 'ended' (viewers see Live Ended, the card disappears).
 */
import { randomUUID } from 'node:crypto';
import { IngressClient } from 'livekit-server-sdk';
import { canStartLive, endBroadcast, endOtherLivesOfHost, firestore, hostLiveRef, lives, publishHostLive, requireLiveKit, type LiveUser } from './live.js';

export const RTMP_IDENTITY_PREFIX = 'obs-';
export const RTMP_ROOM_PREFIX = 'echat-obs-';
/** LiveKit IngressState.Status: 1 = BUFFERING (OBS connected, media arriving), 2 = PUBLISHING. */
const ON_AIR = new Set([1, 2]);

export function uidFromIngress(identity: string, roomName: string): string {
  if (identity?.startsWith(RTMP_IDENTITY_PREFIX)) return identity.slice(RTMP_IDENTITY_PREFIX.length);
  if (roomName?.startsWith(RTMP_ROOM_PREFIX)) return roomName.slice(RTMP_ROOM_PREFIX.length);
  return '';
}

function ingressClient(): IngressClient {
  const liveKit = requireLiveKit();
  return new IngressClient(liveKit.url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'), liveKit.apiKey, liveKit.apiSecret);
}

async function activeLivesInRoom(roomName: string) {
  return (await lives.where('liveKitRoom', '==', roomName).where('isActive', '==', true).get()).docs;
}

/** Create the live for a publishing ingress (idempotent: an existing live in that room is kept). */
export async function startSoftwareLive(ingressId: string, roomName: string, identity: string): Promise<string> {
  const uid = uidFromIngress(identity, roomName);
  if (!uid) return 'ignored: not an Echat streaming-software ingress';
  const pointerData = (await hostLiveRef(uid).get()).data();
  if (pointerData?.holdUntilOffAir === true) return 'ignored: host ended this live; waiting for the app to stop streaming';
  const existing = await activeLivesInRoom(roomName);
  if (existing.length) {
    // Keep lives/{hostId} pointing at it (e.g. after a camera live in between).
    if (pointerData?.status !== 'live' || pointerData.streamId !== existing[0].id) await publishHostLive({ ...existing[0].data(), id: existing[0].id });
    return `ok: already live ${existing[0].id}`;
  }
  const profile = (await firestore.collection('users').doc(uid).get()).data() || {};
  // Only the ingress currently saved for this user may go live (Reset Key deletes the old one anyway).
  if (profile.streamIngressId && profile.streamIngressId !== ingressId) return 'ignored: ingress is not the user’s current stream key';
  const developerUid = String(process.env.SUPER_ADMIN_UID || process.env.VITE_SUPER_ADMIN_UID || '').trim();
  const developer = Boolean(developerUid && uid === developerUid);
  const liveUser: LiveUser = {
    uid,
    email: String(profile.email || ''),
    name: String(profile.name || 'Echat User'),
    avatar: String(profile.avatar || ''),
    role: developer ? 'super_admin' : String(profile.role || 'user'),
    liveAccess: developer ? 'approved' : String(profile.liveAccess || 'none'),
    isVerified: Boolean(profile.isVerified),
    isAdmin: developer || Boolean(profile.isAdmin || profile.canApproveLive),
    isBlocked: !developer && Boolean(profile.isBlocked),
    createdAt: Number(profile.createdAt) || Date.now()
  };
  if (!canStartLive(liveUser)) return 'ignored: user is not allowed to go live';

  const details = profile.rtmpStreamDetails || {};
  const id = `live_${randomUUID()}`;
  await endOtherLivesOfHost(uid, null, 'replaced');
  const now = Date.now();
  const live = {
    id,
    hostId: uid,
    hostName: liveUser.name,
    hostAvatar: liveUser.avatar,
    hostEmail: liveUser.email,
    isHostVerified: liveUser.isVerified,
    title: String(details.title || '').trim() || `${liveUser.name} is Live on EChat!`,
    category: String(details.category || 'Just Chatting'),
    location: String(details.location || ''),
    reportCount: 0,
    underReview: false,
    taggedPageIds: [],
    viewersCount: 0,
    peakViewers: 0,
    reactionsCount: 0,
    startedAt: now,
    heartbeatAt: now,
    isActive: true,
    comments: [],
    liveKitRoom: roomName,
    source: 'rtmp',
    ingressId
  };
  await lives.doc(id).create(live);
  await publishHostLive(live);
  await notifyFollowers(uid, liveUser.name, id, live.title).catch(() => {});
  return `ok: created ${id}`;
}

async function notifyFollowers(uid: string, name: string, streamId: string, title: string) {
  const followers = await firestore.collection('followers').where('followingId', '==', uid).limit(450).get();
  if (!followers.docs.length) return;
  const batch = firestore.batch();
  for (const follower of followers.docs) {
    const followerId = String(follower.data().followerId || '');
    if (!followerId) continue;
    batch.set(firestore.collection('notifications').doc(), { userId: followerId, actorId: uid, type: 'live_stream', targetId: streamId, message: `${name} is live: ${title}`, read: false, createdAt: Date.now() });
  }
  await batch.commit();
}

/** End the software live in this room (OBS stopped). */
export async function endSoftwareLive(roomName: string, reason: string): Promise<number> {
  const docs = await activeLivesInRoom(roomName);
  // The room is the user's permanent ingress room: never delete it, just end the broadcast record.
  for (const doc of docs) await endBroadcast(doc.id, '', reason);
  return docs.length;
}

export type RtmpState = { uid: string; ingressId: string; roomName: string; status: number; publishing: boolean };

/**
 * Ask LiveKit which eChat ingresses are on air and make Firestore match.
 * uid given → only that user's ingress (host polling); otherwise every eChat ingress.
 */
export async function syncRtmpLives(uid?: string): Promise<RtmpState[]> {
  const client = ingressClient();
  const list = await client.listIngress(uid ? { roomName: `${RTMP_ROOM_PREFIX}${uid}` } : {});
  const states: RtmpState[] = [];
  for (const ingress of list) {
    const roomName = String(ingress.roomName || '');
    const owner = uidFromIngress(String(ingress.participantIdentity || ''), roomName);
    if (!owner || !roomName.startsWith(RTMP_ROOM_PREFIX)) continue;
    const status = Number(ingress.state?.status ?? 0);
    const publishing = ON_AIR.has(status);
    states.push({ uid: owner, ingressId: ingress.ingressId, roomName, status, publishing });
  }
  // A user may have an old ingress in the same room; on air if ANY of their current ones is.
  const byRoom = new Map<string, RtmpState>();
  for (const state of states) {
    const seen = byRoom.get(state.roomName);
    if (!seen || (state.publishing && !seen.publishing)) byRoom.set(state.roomName, state);
  }
  // One read of the software lives that are currently marked live.
  let active = (await lives.where('source', '==', 'rtmp').where('isActive', '==', true).get()).docs;
  if (uid) active = active.filter(doc => doc.data().liveKitRoom === `${RTMP_ROOM_PREFIX}${uid}`);
  const activeRooms = new Set(active.map(doc => String(doc.data().liveKitRoom || '')));
  // App stopped streaming after the host tapped End Live: a later start is a NEW live again.
  const held = new Set((await firestore.collection('lives').where('holdUntilOffAir', '==', true).get()).docs.map(doc => doc.id));
  for (const state of byRoom.values()) {
    if (!state.publishing && held.has(state.uid)) await hostLiveRef(state.uid).update({ holdUntilOffAir: false });
    if (state.publishing) await startSoftwareLive(state.ingressId, state.roomName, `${RTMP_IDENTITY_PREFIX}${state.uid}`);
  }
  // OBS stopped (or its ingress was deleted by Reset Key): end the live.
  for (const doc of active) {
    const room = String(doc.data().liveKitRoom || '');
    if (!byRoom.get(room)?.publishing && activeRooms.has(room)) await endBroadcast(doc.id, '', 'software-stopped');
  }
  return [...byRoom.values()];
}

let lastFullSync = 0;
/** Throttled full sync (any server instance at most every 5 s). */
export async function syncAllRtmpLivesThrottled(): Promise<void> {
  if (Date.now() - lastFullSync < 5000) return;
  lastFullSync = Date.now();
  await syncRtmpLives();
}
