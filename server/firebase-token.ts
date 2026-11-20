import { importX509, jwtVerify, type JWTPayload } from 'jose';

export type FirebaseIdToken = JWTPayload & {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  auth_time?: number;
};

let certCache: { projectId: string; certs: Record<string, string>; expiresAt: number } | undefined;

async function getFirebaseCerts(projectId: string): Promise<Record<string, string>> {
  if (certCache?.projectId === projectId && certCache.expiresAt > Date.now()) return certCache.certs;

  const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!response.ok) throw Object.assign(new Error('Firebase public signing certificates are unavailable.'), { code: 'firebase-certs-unavailable' });
  const certs = await response.json() as Record<string, string>;
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/i)?.[1] || 3600);
  certCache = { projectId, certs, expiresAt: Date.now() + Math.max(60, maxAge) * 1000 };
  return certs;
}

/** Verify Firebase ID tokens without Firebase Admin Auth or Google ADC. */
export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<FirebaseIdToken> {
  if (token.length > 16_384) throw Object.assign(new Error('The Firebase sign-in token is invalid.'), { code: 'invalid-token' });

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(token.split('.')[0] || '', 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  } catch {
    throw Object.assign(new Error('The Firebase sign-in token is invalid.'), { code: 'invalid-token' });
  }
  if (header.alg !== 'RS256' || !header.kid) throw Object.assign(new Error('The Firebase sign-in token is invalid.'), { code: 'invalid-token' });

  const certs = await getFirebaseCerts(projectId);
  const certificate = certs[header.kid];
  if (!certificate) {
    certCache = undefined;
    throw Object.assign(new Error('The Firebase signing key is no longer valid. Please sign in again.'), { code: 'unknown-signing-key' });
  }

  const key = await importX509(certificate, 'RS256');
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`
  });
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw Object.assign(new Error('The Firebase sign-in token has no valid user.'), { code: 'invalid-token-subject' });
  }
  return { ...payload, uid: payload.sub } as FirebaseIdToken;
}
