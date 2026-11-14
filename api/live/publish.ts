import { GO_LIVE, getGoLiveEligibility } from '../../src/config/featureFlags.js';
import type { ApiRequest, ApiResponse } from '../../serverless/live.js';
import { canStartLive, createRoomToken, handleError, liveKitUrl, lives, sendJson, verifyLiveUser } from '../../serverless/live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    if (!canStartLive(user)) {
      if (user.isBlocked || user.liveAccess === 'blocked') return sendJson(res, 403, { error: 'Your Go Live access is blocked.', code: 'live-access-denied' });
      const { accountAgeDays, daysLeft } = getGoLiveEligibility(user);
      return sendJson(res, 403, { error: `Go Live is for developers right now. Your account is ${accountAgeDays} days old. You can Go Live in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} (after ${GO_LIVE.minAccountAgeDaysForNormalUsers} days).`, code: 'live-access-denied', accountAgeDays, daysLeft });
    }
    const streamId = typeof req.body?.streamId === 'string' ? req.body.streamId : '';
    const doc = await lives.doc(streamId).get();
    const live = doc.data();
    if (!doc.exists || !live?.isActive || live.hostId !== user.uid || !live.liveKitRoom) return sendJson(res, 404, { error: 'Your active live broadcast was not found.', code: 'live-not-found' });
    return sendJson(res, 200, { url: liveKitUrl, token: await createRoomToken(user, String(live.liveKitRoom), true) });
  } catch (error) {
    return handleError(res, error, 'publish');
  }
}
