import { TokenVerifier, WebhookReceiver } from 'livekit-server-sdk';
import type { ApiRequest, ApiResponse } from '../live.js';
import { handleError, lives, markLiveEnded, recountLiveViewers, requireLiveKit, sendJson } from '../live.js';
import { RTMP_IDENTITY_PREFIX, RTMP_ROOM_PREFIX, syncRtmpLives, uidFromIngress } from '../rtmp-sync.js';

/**
 * POST /api/live/webhook (also /api/livekit-webhook) — LiveKit Cloud webhook
 * (LiveKit Cloud → Settings → Webhooks → https://<your-app>/api/live/webhook).
 *
 * Streaming software (OBS…): ingress_started / ingress_ended / room_started / room_finished /
 * participant_joined / participant_left / track_published / track_unpublished for an eChat ingress
 * room → re-read that user's ingress state from LiveKit and set lives/{hostId} live or ended.
 * Phone lives: room_finished ends the live; participant_left removes a viewer and recounts.
 *
 * Security: the Authorization JWT must be signed with LIVEKIT_API_KEY / LIVEKIT_API_SECRET. If the
 * platform already parsed the body (so its sha256 can't be checked), the payload is NOT trusted:
 * the request only triggers a re-check against LiveKit's own API.
 */
async function readRawBody(req: ApiRequest): Promise<{ raw: string; exact: boolean }> {
  // Read the stream before touching req.body (on Vercel, req.body parses and re-serializes JSON).
  if (!req.readableEnded && (req as { readable?: boolean }).readable !== false) {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 3000);
      req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on('end', () => { clearTimeout(timer); resolve(); });
      req.on('error', error => { clearTimeout(timer); reject(error); });
    });
    if (chunks.length) return { raw: Buffer.concat(chunks).toString('utf8'), exact: true };
  }
  const body = req.body as unknown;
  if (typeof body === 'string') return { raw: body, exact: true };
  if (Buffer.isBuffer(body)) return { raw: body.toString('utf8'), exact: true };
  return { raw: body && typeof body === 'object' ? JSON.stringify(body) : '', exact: false };
}

type Event = { event?: string; room?: { name?: string }; participant?: { identity?: string }; ingressInfo?: { roomName?: string; participantIdentity?: string } };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const liveKit = requireLiveKit();
    const { raw } = await readRawBody(req);
    const authorization = String(req.headers.authorization || '');
    let event: Event;
    let verifiedBody = true;
    try {
      event = await new WebhookReceiver(liveKit.apiKey, liveKit.apiSecret).receive(raw, authorization) as Event;
    } catch (error) {
      // Signature valid but body re-serialized by the platform → only use it as a trigger.
      try {
        await new TokenVerifier(liveKit.apiKey, liveKit.apiSecret).verify(authorization);
        event = JSON.parse(raw || '{}') as Event;
        verifiedBody = false;
      } catch {
        console.warn('[Live Webhook] Rejected unsigned or invalid webhook', error instanceof Error ? error.message : error);
        return sendJson(res, 401, { error: 'Invalid webhook signature.', code: 'invalid-webhook' });
      }
    }

    const roomName = String(event.room?.name || event.ingressInfo?.roomName || '');
    const identity = String(event.participant?.identity || event.ingressInfo?.participantIdentity || '');
    const rtmpUid = uidFromIngress(identity, roomName) || (roomName.startsWith(RTMP_ROOM_PREFIX) ? roomName.slice(RTMP_ROOM_PREFIX.length) : '');
    let result = 'ignored';

    if (rtmpUid && (roomName.startsWith(RTMP_ROOM_PREFIX) || identity.startsWith(RTMP_IDENTITY_PREFIX) || String(event.event).startsWith('ingress_'))) {
      // Streaming software: LiveKit's API is the source of truth (works for every event type).
      const states = await syncRtmpLives(rtmpUid);
      result = `ok: rtmp ${states.map(state => `${state.uid}=${state.publishing ? 'live' : 'off'}`).join(',') || 'no ingress'}`;
      if (event.event === 'participant_left' && verifiedBody && identity && !identity.startsWith(RTMP_IDENTITY_PREFIX)) await removeViewer(roomName, identity);
    } else if (verifiedBody && event.event === 'room_finished' && roomName) {
      for (const doc of (await lives.where('liveKitRoom', '==', roomName).where('isActive', '==', true).get()).docs) await markLiveEnded(doc.id, 'room-finished');
      result = 'ok: ended';
    } else if (verifiedBody && event.event === 'participant_left' && roomName && identity) {
      await removeViewer(roomName, identity);
      result = 'ok: viewer removed';
    }
    console.info('[Live Webhook]', { event: event.event, verifiedBody, result });
    return sendJson(res, 200, { received: true, result });
  } catch (error) {
    return handleError(res, error, 'webhook');
  }
}

async function removeViewer(roomName: string, identity: string) {
  for (const doc of (await lives.where('liveKitRoom', '==', roomName).where('isActive', '==', true).get()).docs) {
    await doc.ref.collection('viewers').doc(identity).delete();
    await recountLiveViewers(doc.id);
  }
}
