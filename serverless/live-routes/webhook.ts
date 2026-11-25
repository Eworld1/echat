import { randomUUID } from 'node:crypto';
import { WebhookReceiver } from 'livekit-server-sdk';
import type { ApiRequest, ApiResponse } from '../live.js';
import { canStartLive, endOtherLivesOfHost, firestore, handleError, lives, markLiveEnded, publishHostLive, recountLiveViewers, requireLiveKit, sendJson, type LiveUser } from '../live.js';

/**
 * POST /api/live/webhook — LiveKit Cloud webhook (Settings → Webhooks → this URL).
 *
 * - ingress_started : a user's streaming software (OBS, Streamlabs, vMix, XSplit, Prism, Larix,
 *                     any Custom RTMP app) started pushing → create a live entry so it shows in Live Now.
 * - ingress_ended   : the software stopped → mark that live as ended ("Live Ended" for viewers).
 * - room_finished   : a LiveKit room closed (e.g. phone host lost connection) → end its live entry.
 * - participant_left: a viewer left → remove their presence and update the viewer count.
 *
 * Every request is verified with LIVEKIT_API_KEY / LIVEKIT_API_SECRET (signed JWT + body hash).
 */

const RTMP_IDENTITY_PREFIX = 'obs-';
const RTMP_ROOM_PREFIX = 'echat-obs-';

async function readRawBody(req: ApiRequest): Promise<string> {
  const body = req.body as unknown;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (!req.readableEnded) {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('Webhook body timed out.'), { status: 400, code: 'webhook-body-timeout' })), 10_000);
      req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on('end', () => { clearTimeout(timer); resolve(); });
      req.on('error', error => { clearTimeout(timer); reject(error); });
    });
    if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  }
  // Last resort: a platform already parsed JSON. Signature check may fail if formatting changed.
  return body && typeof body === 'object' ? JSON.stringify(body) : '';
}

function uidFromIngress(identity: string, roomName: string): string {
  if (identity.startsWith(RTMP_IDENTITY_PREFIX)) return identity.slice(RTMP_IDENTITY_PREFIX.length);
  if (roomName.startsWith(RTMP_ROOM_PREFIX)) return roomName.slice(RTMP_ROOM_PREFIX.length);
  return '';
}

async function activeLivesInRoom(roomName: string) {
  const result = await lives.where('liveKitRoom', '==', roomName).where('isActive', '==', true).get();
  return result.docs;
}

async function startSoftwareLive(ingressId: string, roomName: string, identity: string): Promise<string> {
  const uid = uidFromIngress(identity, roomName);
  if (!uid) return 'ignored: not an Echat streaming-software ingress';
  const profileSnapshot = await firestore.collection('users').doc(uid).get();
  const profile = profileSnapshot.data() || {};
  // Only the ingress currently saved for this user may go live (a reset key's old ingress is deleted anyway).
  if (profile.streamIngressId && profile.streamIngressId !== ingressId) return 'ignored: ingress is not the user’s current stream key';
  const liveUser: LiveUser = {
    uid,
    email: String(profile.email || ''),
    name: String(profile.name || 'Echat User'),
    avatar: String(profile.avatar || ''),
    role: String(profile.role || 'user'),
    liveAccess: String(profile.liveAccess || 'none'),
    isVerified: Boolean(profile.isVerified),
    isAdmin: Boolean(profile.isAdmin || profile.canApproveLive),
    isBlocked: Boolean(profile.isBlocked),
    createdAt: Number(profile.createdAt) || Date.now()
  };
  if (!canStartLive(liveUser)) return 'ignored: user is not allowed to go live';
  if ((await activeLivesInRoom(roomName)).length) return 'ok: already live';

  const details = profile.rtmpStreamDetails || {};
  const id = `live_${randomUUID()}`;
  await endOtherLivesOfHost(uid, null, 'replaced');
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
    startedAt: Date.now(),
    isActive: true,
    comments: [],
    liveKitRoom: roomName,
    source: 'rtmp',
    ingressId
  };
  await lives.doc(id).create(live);
  await publishHostLive(live);
  return `ok: created ${id}`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const liveKit = requireLiveKit();
    const rawBody = await readRawBody(req);
    const authorization = String(req.headers.authorization || '');
    const receiver = new WebhookReceiver(liveKit.apiKey, liveKit.apiSecret);
    let event;
    try {
      event = await receiver.receive(rawBody, authorization);
    } catch (error) {
      console.warn('[Live Webhook] Rejected unsigned or invalid webhook', error instanceof Error ? error.message : error);
      return sendJson(res, 401, { error: 'Invalid webhook signature.', code: 'invalid-webhook' });
    }

    let result = 'ignored';
    const ingress = event.ingressInfo;
    switch (event.event) {
      case 'ingress_started':
        if (ingress) result = await startSoftwareLive(ingress.ingressId, ingress.roomName, ingress.participantIdentity);
        break;
      case 'ingress_ended':
        if (ingress?.roomName) {
          for (const doc of await activeLivesInRoom(ingress.roomName)) await markLiveEnded(doc.id, 'software-stopped');
          result = 'ok: ended';
        }
        break;
      case 'room_finished':
        if (event.room?.name) {
          for (const doc of await activeLivesInRoom(event.room.name)) await markLiveEnded(doc.id, 'room-finished');
          result = 'ok: ended';
        }
        break;
      case 'participant_left':
        if (event.room?.name && event.participant?.identity) {
          for (const doc of await activeLivesInRoom(event.room.name)) {
            await doc.ref.collection('viewers').doc(event.participant.identity).delete();
            await recountLiveViewers(doc.id);
          }
          result = 'ok: viewer removed';
        }
        break;
      default:
        break;
    }
    console.info('[Live Webhook]', { event: event.event, result });
    return sendJson(res, 200, { received: true, result });
  } catch (error) {
    return handleError(res, error, 'webhook');
  }
}
