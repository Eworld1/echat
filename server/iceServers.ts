import crypto from 'crypto';

/**
 * ICE servers for WebRTC calls (STUN + TURN relay).
 *
 * STUN alone only works when both phones can reach each other directly (often same Wi-Fi). Mobile
 * carriers (Orange, Africell…) use carrier-grade NAT, so calls between networks need a TURN relay.
 * All TURN credentials come from env vars (never hardcoded). The first configured provider wins:
 *
 *  1. Metered.ca        METERED_TURN_DOMAIN + METERED_TURN_API_KEY
 *  2. Cloudflare TURN   CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
 *  3. Twilio NTS        TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
 *  4. coturn (secret)   TURN_URLS + TURN_SECRET            (use-auth-secret / static-auth-secret)
 *  5. Static TURN       TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
 */

export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export interface IceConfigResult { iceServers: IceServer[]; provider: string; hasTurn: boolean; ttlSeconds: number }

export const STUN_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

const CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;
const FETCH_TIMEOUT_MS = 5000;

const env = (name: string) => (process.env[name] || '').trim();
const splitUrls = (value: string) => value.split(',').map(url => url.trim()).filter(Boolean);
const isTurnUrl = (url: string) => /^turns?:/i.test(url);
const hasTurnServer = (servers: IceServer[]) => servers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(isTurnUrl));

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Keep only well-formed { urls, username?, credential? } entries. */
function normalize(list: unknown): IceServer[] {
  const items = Array.isArray(list) ? list : list && typeof list === 'object' ? [list] : [];
  return items.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as { urls?: unknown; url?: unknown; username?: unknown; credential?: unknown };
    const urls = (Array.isArray(raw.urls) ? raw.urls : [raw.urls ?? raw.url]).filter((url): url is string => typeof url === 'string' && /^(stun|turns?):/i.test(url));
    if (!urls.length) return [];
    return [{
      urls: urls.length === 1 ? urls[0] : urls,
      ...(typeof raw.username === 'string' ? { username: raw.username } : {}),
      ...(typeof raw.credential === 'string' ? { credential: raw.credential } : {})
    }];
  });
}

type Provider = { name: string; configured: () => boolean; shared: boolean; load: (userId: string) => Promise<IceServer[]> };

const providers: Provider[] = [
  {
    name: 'metered',
    shared: true,
    configured: () => Boolean(env('METERED_TURN_DOMAIN') && env('METERED_TURN_API_KEY')),
    load: async () => {
      const domain = env('METERED_TURN_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return normalize(await fetchJson(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env('METERED_TURN_API_KEY'))}`));
    }
  },
  {
    name: 'cloudflare',
    shared: true,
    configured: () => Boolean(env('CLOUDFLARE_TURN_KEY_ID') && env('CLOUDFLARE_TURN_API_TOKEN')),
    load: async () => {
      const payload = await fetchJson(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env('CLOUDFLARE_TURN_KEY_ID'))}/credentials/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('CLOUDFLARE_TURN_API_TOKEN')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS })
      }) as { iceServers?: unknown };
      return normalize(payload.iceServers);
    }
  },
  {
    name: 'twilio',
    shared: true,
    configured: () => Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN')),
    load: async () => {
      const sid = env('TWILIO_ACCOUNT_SID');
      const payload = await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Tokens.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ Ttl: String(CREDENTIAL_TTL_SECONDS) })
      }) as { ice_servers?: unknown };
      return normalize(payload.ice_servers);
    }
  },
  {
    name: 'coturn',
    shared: false,
    configured: () => Boolean(env('TURN_URLS') && env('TURN_SECRET')),
    // coturn REST API auth: username = "<expiry>:<user>", password = base64(HMAC-SHA1(secret, username)).
    load: async userId => {
      const username = `${Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_SECONDS}:${userId}`;
      const credential = crypto.createHmac('sha1', env('TURN_SECRET')).update(username).digest('base64');
      return [{ urls: splitUrls(env('TURN_URLS')), username, credential }];
    }
  },
  {
    name: 'static',
    shared: true,
    configured: () => Boolean(env('TURN_URLS') && env('TURN_USERNAME') && env('TURN_CREDENTIAL')),
    load: async () => [{ urls: splitUrls(env('TURN_URLS')), username: env('TURN_USERNAME'), credential: env('TURN_CREDENTIAL') }]
  }
];

let sharedCache: { provider: string; servers: IceServer[]; expiresAt: number } | null = null;

/** STUN + the first working TURN provider. Never throws: with no TURN configured it returns STUN only. */
export async function getIceConfig(userId: string): Promise<IceConfigResult> {
  const ttlSeconds = Math.floor(CREDENTIAL_TTL_SECONDS / 2);
  for (const provider of providers) {
    if (!provider.configured()) continue;
    try {
      let servers: IceServer[];
      if (provider.shared && sharedCache?.provider === provider.name && sharedCache.expiresAt > Date.now()) servers = sharedCache.servers;
      else {
        servers = await provider.load(userId);
        // Reuse provider credentials for half their lifetime so we don't hit the provider on every call.
        if (provider.shared && hasTurnServer(servers)) sharedCache = { provider: provider.name, servers, expiresAt: Date.now() + ttlSeconds * 1000 };
      }
      if (!hasTurnServer(servers)) throw new Error('response had no TURN servers');
      return { iceServers: [...STUN_SERVERS, ...servers.filter(server => !(Array.isArray(server.urls) ? server.urls : [server.urls]).every(url => /^stun:/i.test(url)))], provider: provider.name, hasTurn: true, ttlSeconds };
    } catch (error) {
      console.warn(`[ICE] ${provider.name} TURN credentials failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { iceServers: STUN_SERVERS, provider: 'stun-only', hasTurn: false, ttlSeconds: 300 };
}

/** For /api/health and startup logs: which TURN provider is configured (no secrets). */
export function configuredTurnProvider(): string {
  return providers.find(provider => provider.configured())?.name || 'none';
}
