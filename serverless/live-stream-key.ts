import { IngressClient, IngressInput } from 'livekit-server-sdk';
import type { DocumentData } from 'firebase-admin/firestore';
import { firestore, requireLiveKit } from './live.js';

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
    enableTranscoding: true
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
    if (activeIngresses.some(ingress => ingress.ingressId === saved.ingressId)) return toResponse(saved);
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
