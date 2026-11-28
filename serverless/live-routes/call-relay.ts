import { AccessToken } from 'livekit-server-sdk';
import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, firestore, handleError, handleLiveOptions, liveKitUrl, requireLiveKit, sendJson, verifyLiveUid } from '../live.js';

/**
 * POST /api/live/call-relay { callId }
 * Fallback media path for 1:1 calls when peer-to-peer + TURN can't connect (e.g. a carrier blocks
 * the TURN provider). Both people join the private LiveKit room "call_<callId>"; LiveKit Cloud carries
 * the audio/video over its own servers (UDP, or TCP/TLS on 443). Only the caller and receiver of
 * that call get a token, and only while the call hasn't ended.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const uid = await verifyLiveUid(req);
    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
    const callId = String(body?.callId || '');
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(callId)) return sendJson(res, 400, { error: 'callId is required.', code: 'call-id-required' });
    const snapshot = await firestore.collection('calls').doc(callId).get();
    const call = snapshot.data();
    if (!snapshot.exists || !call) return sendJson(res, 404, { error: 'Call not found.', code: 'call-not-found' });
    if (call.callerId !== uid && call.receiverId !== uid) return sendJson(res, 403, { error: 'You are not in this call.', code: 'not-call-party' });
    if (call.endedAt || call.status === 'declined' || call.status === 'missed') return sendJson(res, 410, { error: 'This call has ended.', code: 'call-ended' });
    const lk = requireLiveKit();
    const isCaller = call.callerId === uid;
    const name = String((isCaller ? call.callerName : call.receiverName) || 'User').slice(0, 80);
    const room = `call_${callId}`;
    const token = new AccessToken(lk.apiKey, lk.apiSecret, { identity: uid, name, ttl: '3h' });
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
    return sendJson(res, 200, { url: liveKitUrl, token: await token.toJwt(), room });
  } catch (error) {
    return handleError(res, error, 'call-relay');
  }
}

function safeJson(value: string): Record<string, unknown> | null {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}
