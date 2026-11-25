import { IngressAudioEncodingPreset, IngressAudioOptions, IngressClient, IngressInput, IngressVideoEncodingPreset, IngressVideoOptions, TrackSource } from 'livekit-server-sdk';

/**
 * Premium quality for streaming apps (OBS…): LiveKit transcodes the RTMP input into 3 simulcast
 * layers (1080p / 720p-class / low) at 30 fps so every viewer gets the best layer their internet
 * and screen allow, plus stereo Opus audio. Bump the version to re-apply to existing keys.
 */
const INGRESS_QUALITY_VERSION = 'h264-1080p30-3layers-opus-stereo-v1';
function ingressQualityOptions() {
  return {
    video: new IngressVideoOptions({ source: TrackSource.CAMERA, encodingOptions: { case: 'preset', value: IngressVideoEncodingPreset.H264_1080P_30FPS_3_LAYERS } }),
    audio: new IngressAudioOptions({ source: TrackSource.MICROPHONE, encodingOptions: { case: 'preset', value: IngressAudioEncodingPreset.OPUS_STEREO_96KBPS } })
  };
}
import type { DocumentData } from 'firebase-admin/firestore';
import { firestore, hostLiveRef, requireLiveKit } from './live.js';

export { describeLiveKitError } from './live.js';

export interface LiveStreamIngress {
  streamKey: string;
  serverUrl: string;
  ingestConfigured: true;
}

interface StoredLiveStreamIngress extends LiveStreamIngress {
  ingressId: string;
}

function getIngressClient(): IngressClient {
  const liveKit = requireLiveKit();
  const apiHost = liveKit.url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  return new IngressClient(apiHost, liveKit.apiKey, liveKit.apiSecret);
}

function storedIngress(data: DocumentData | undefined): StoredLiveStreamIngress | null {
  if (!data) return null;
  const streamKey = String(data.streamKey || '');
  const serverUrl = String(data.streamServerUrl || '');
  const ingressId = String(data.streamIngressId || '');
  return streamKey && serverUrl && ingressId
    ? { streamKey, serverUrl, ingressId, ingestConfigured: true }
    : null;
}

async function createLiveStreamIngress(uid: string) {
  const ingressClient = getIngressClient();
  const roomName = `echat-obs-${uid}`;
  const participantIdentity = `obs-${uid}`;
  const ingress = await ingressClient.createIngress(IngressInput.RTMP_INPUT, {
    name: `Echat RTMP ${uid}`,
    roomName,
    participantIdentity,
    participantName: 'Echat Streaming Software',
    enableTranscoding: true,
    ...ingressQualityOptions()
  });
  if (!ingress.ingressId || !ingress.url || !ingress.streamKey) {
    throw Object.assign(new Error('LiveKit did not return a complete RTMP ingress configuration.'), {
      status: 502,
      code: 'livekit-ingress-incomplete'
    });
  }
  return { ingressClient, ingress };
}

function toResponse(ingress: StoredLiveStreamIngress): LiveStreamIngress {
  return {
    streamKey: ingress.streamKey,
    serverUrl: ingress.serverUrl,
    ingestConfigured: true
  };
}

async function saveIngress(uid: string, ingressId: string, serverUrl: string, streamKey: string): Promise<void> {
  await firestore.collection('users').doc(uid).set({
    streamKey,
    streamServerUrl: serverUrl,
    streamIngressId: ingressId,
    streamIngressQuality: INGRESS_QUALITY_VERSION,
    streamKeyUpdatedAt: Date.now()
  }, { merge: true });
}

export async function getOrCreateLiveStreamIngress(uid: string): Promise<LiveStreamIngress> {
  const userReference = firestore.collection('users').doc(uid);
  const profile = await userReference.get();
  const saved = storedIngress(profile.data());
  const ingressClient = getIngressClient();

  if (saved) {
    const activeIngresses = await ingressClient.listIngress({ ingressId: saved.ingressId });
    const current = activeIngresses.find(ingress => ingress.ingressId === saved.ingressId);
    if (current) {
      // Upgrade older keys to the HD preset in place (same key, same URL). Only while OBS is not
      // streaming; otherwise it is retried next time the key is loaded.
      if (profile.data()?.streamIngressQuality !== INGRESS_QUALITY_VERSION && ![1, 2].includes(Number(current.state?.status ?? 0))) {
        try {
          await ingressClient.updateIngress(saved.ingressId, { name: current.name, roomName: current.roomName, participantIdentity: current.participantIdentity, participantName: current.participantName, enableTranscoding: true, ...ingressQualityOptions() });
          await userReference.set({ streamIngressQuality: INGRESS_QUALITY_VERSION }, { merge: true });
        } catch (error) {
          console.warn('[Live RTMP] Could not upgrade the stream key to HD yet', error instanceof Error ? error.message : error);
        }
      }
      return toResponse(saved);
    }
  }

  const { ingressClient: client, ingress } = await createLiveStreamIngress(uid);
  try {
    await saveIngress(uid, ingress.ingressId, ingress.url, ingress.streamKey);
  } catch (error) {
    await client.deleteIngress(ingress.ingressId).catch(cleanupError => {
      console.error('[Live RTMP] Could not remove an unpersisted ingress.', cleanupError);
    });
    throw error;
  }
  return toResponse({
    ingressId: ingress.ingressId,
    serverUrl: ingress.url,
    streamKey: ingress.streamKey,
    ingestConfigured: true
  });
}

export async function resetLiveStreamIngress(uid: string): Promise<LiveStreamIngress> {
  const userReference = firestore.collection('users').doc(uid);
  const profile = await userReference.get();
  const previous = storedIngress(profile.data());
  const { ingressClient, ingress } = await createLiveStreamIngress(uid);

  try {
    if (previous) {
      const oldIngresses = await ingressClient.listIngress({ ingressId: previous.ingressId });
      if (oldIngresses.some(item => item.ingressId === previous.ingressId)) {
        await ingressClient.deleteIngress(previous.ingressId);
      }
    }
    await saveIngress(uid, ingress.ingressId, ingress.url, ingress.streamKey);
    await hostLiveRef(uid).set({ holdUntilOffAir: false }, { merge: true }).catch(() => {});
  } catch (error) {
    await ingressClient.deleteIngress(ingress.ingressId).catch(cleanupError => {
      console.error('[Live RTMP] Could not remove an incomplete key reset ingress.', cleanupError);
    });
    throw error;
  }

  return toResponse({
    ingressId: ingress.ingressId,
    serverUrl: ingress.url,
    streamKey: ingress.streamKey,
    ingestConfigured: true
  });
}
