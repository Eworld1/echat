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

type Provider = {
  name: string;
  configured: () => boolean;
  shared: boolean;
  /** The provider serves TURN on 443 over UDP, TCP and TLS on the same host, so missing 443 variants can be added. */
  supports443: boolean;
  load: (userId: string) => Promise<IceServer[]>;
};

const providers: Provider[] = [
  {
    name: 'metered',
    supports443: true,
    shared: true,
    configured: () => Boolean(env('METERED_TURN_DOMAIN') && env('METERED_TURN_API_KEY')),
    load: async () => {
      const domain = env('METERED_TURN_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return normalize(await fetchJson(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env('METERED_TURN_API_KEY'))}`));
    }
  },
  {
    name: 'cloudflare',
    supports443: false,
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
    supports443: false,
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
    supports443: false,
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
    supports443: false,
    shared: true,
    configured: () => Boolean(env('TURN_URLS') && env('TURN_USERNAME') && env('TURN_CREDENTIAL')),
    load: async () => [{ urls: splitUrls(env('TURN_URLS')), username: env('TURN_USERNAME'), credential: env('TURN_CREDENTIAL') }]
  }
];

const sharedCache = new Map<string, { servers: IceServer[]; expiresAt: number }>();

/** One RTCIceServer per URL so the order the browser tries them in is explicit. */
function splitByUrl(servers: IceServer[]): IceServer[] {
  return servers.flatMap(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).map(url => ({ ...server, urls: url })));
}

const urlOf = (server: IceServer) => String(Array.isArray(server.urls) ? server.urls[0] : server.urls);
const turnHost = (url: string) => url.replace(/^turns?:/i, '').split('?')[0].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');

/**
 * Carriers such as Orange SL block UDP and the usual TURN ports (3478, 80). Port 443 looks like
 * ordinary HTTPS, so it gets through: TLS on 443 first, then TCP on 443, then UDP on 443, and only
 * then any other port as a last resort.
 */
export function turnRank(url: string): number {
  const tls = /^turns:/i.test(url);
  const port = Number((url.split('?')[0].match(/:(\d+)$/) || [])[1] || (tls ? 5349 : 3478));
  const tcp = /transport=tcp/i.test(url) || tls;
  if (port === 443 && tls) return 0;
  if (port === 443 && tcp) return 1;
  if (port === 443) return 2;
  if (tls) return 3;
  if (tcp) return 4;
  return 5;
}

/** Add turns:HOST:443?transport=tcp, turn:HOST:443?transport=tcp and turn:HOST:443 when missing. */
function with443Variants(servers: IceServer[]): IceServer[] {
  const out = [...servers];
  const have = new Set(servers.map(urlOf));
  for (const server of servers) {
    const url = urlOf(server);
    if (!/^turns?:/i.test(url) || !server.username) continue;
    const host = turnHost(url);
    for (const variant of [`turns:${host}:443?transport=tcp`, `turn:${host}:443?transport=tcp`, `turn:${host}:443`]) {
      if (have.has(variant)) continue;
      have.add(variant);
      out.push({ urls: variant, username: server.username, credential: server.credential });
    }
  }
  return out;
}

async function loadProvider(provider: Provider, userId: string, ttlSeconds: number): Promise<IceServer[]> {
  const cached = provider.shared ? sharedCache.get(provider.name) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.servers;
  let servers = splitByUrl(await provider.load(userId)).filter(server => /^turns?:/i.test(urlOf(server)));
  if (provider.supports443) servers = with443Variants(servers);
  if (!servers.length) throw new Error('response had no TURN servers');
  // Reuse provider credentials for half their lifetime so we don't hit the provider on every call.
  if (provider.shared) sharedCache.set(provider.name, { servers, expiresAt: Date.now() + ttlSeconds * 1000 });
  return servers;
}

const MAX_TURN_URLS = 9;

/**
 * STUN + TURN from EVERY configured provider (e.g. Metered as primary, Cloudflare/Twilio as backup),
 * ordered 443-TLS → 443-TCP → 443-UDP → other ports; the primary provider wins ties.
 * Never throws: with no working TURN it returns STUN only.
 */
export async function getIceConfig(userId: string): Promise<IceConfigResult> {
  const ttlSeconds = Math.floor(CREDENTIAL_TTL_SECONDS / 2);
  const configured = providers.filter(provider => provider.configured());
  const results = await Promise.all(configured.map(async (provider, order) => {
    try {
      return { provider: provider.name, order, servers: await loadProvider(provider, userId, ttlSeconds) };
    } catch (error) {
      console.warn(`[ICE] ${provider.name} TURN credentials failed:`, error instanceof Error ? error.message : error);
      return { provider: provider.name, order, servers: [] as IceServer[] };
    }
  }));
  const working = results.filter(result => result.servers.length);
  if (!working.length) return { iceServers: STUN_SERVERS, provider: 'stun-only', hasTurn: false, ttlSeconds: 300 };
  const turn = working
    .flatMap(result => result.servers.map((server, index) => ({ server, order: result.order, index })))
    .sort((a, b) => turnRank(urlOf(a.server)) - turnRank(urlOf(b.server)) || a.order - b.order || a.index - b.index)
    .slice(0, MAX_TURN_URLS)
    .map(item => item.server);
  // TURN first so the browser starts allocating the relay immediately; STUN after.
  return { iceServers: [...turn, ...STUN_SERVERS], provider: working.map(result => result.provider).join('+'), hasTurn: true, ttlSeconds };
}

/** For /api/health and startup logs: which TURN provider is configured (no secrets). */
export function configuredTurnProvider(): string {
  return providers.filter(provider => provider.configured()).map(provider => provider.name).join('+') || 'none';
}
