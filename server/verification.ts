import crypto from 'node:crypto';
import { promises as dns } from 'node:dns';
import { firestore, getFirebaseAdminAuth } from './firebase-admin.js';

/**
 * eChat 6-digit verification codes (sign-up, verify existing email, password reset).
 *
 * - Codes are random (crypto.randomInt), never logged, never returned to the browser.
 * - Firestore keeps only an HMAC-SHA-256 hash: verificationCodes/{sha256(purpose:email)}
 *   { purpose, codeHash, expiresAt, attempts, used, createdAt, sentAt }.
 * - 10 minute expiry, 5 wrong attempts max, 60 s between sends, 3 sends per hour per email.
 * - Codes are emailed through Brevo or Resend (plain HTTPS: works on Render's free plan, no billing card).
 *
 * Firestore rules deny all browser access to verificationCodes / verificationSends; only this
 * server (Firebase Admin) reads them.
 */

export type CodePurpose = 'signup' | 'verify' | 'reset';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 3;
const MAX_ATTEMPTS = 5;

export class VerificationError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid', public retryAfter?: number) { super(message); }
}

// ---------- configuration ----------

const env = (name: string) => (process.env[name] || '').trim().replace(/^["']|["']$/g, '');
const brevoKey = () => env('BREVO_API_KEY');
const resendKey = () => env('RESEND_API_KEY');
const emailFrom = () => env('EMAIL_FROM') || env('VERIFICATION_EMAIL_FROM');
const appUrl = () => (env('APP_URL') || 'https://echat-ivory.vercel.app').replace(/\/+$/, '');

/** HMAC key for code hashes. Falls back to a hash of the service-account secret so it is stable across restarts. */
function codeSecret(): string {
  const explicit = env('VERIFICATION_CODE_SECRET');
  if (explicit) return explicit;
  return crypto.createHash('sha256').update(`echat-codes:${process.env.FIREBASE_SERVICE_ACCOUNT_JSON || 'dev-only'}`).digest('hex');
}

export function verificationStatus() {
  const emailReady = Boolean((brevoKey() || resendKey()) && emailFrom());
  const adminReady = Boolean(firestore && getFirebaseAdminAuth());
  return { ready: emailReady && adminReady, email: emailReady, firebaseAdmin: adminReady, provider: brevoKey() ? 'brevo' : resendKey() ? 'resend' : 'none' };
}

function requireReady() {
  const status = verificationStatus();
  if (!status.firebaseAdmin) throw new VerificationError('Verification is not set up on the server yet (Firebase Admin key missing).', 503, 'not-configured');
  if (!status.email) throw new VerificationError('Verification emails are not set up on the server yet.', 503, 'not-configured');
  return { db: firestore!, auth: getFirebaseAdminAuth()! };
}

// ---------- email checks ----------

export const normalizeEmail = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

// Common throw-away inbox providers. MX lookup below also rejects domains that can't receive mail.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'mailinator.net', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la',
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmailo.com', 'tempail.com',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com',
  'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'mailcatch.com', 'spamgourmet.com', 'mytemp.email', 'tempinbox.com',
  'burnermail.io', 'moakt.com', 'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'discard.email', 'mailpoof.com', 'linshiyouxiang.net', 'emailfake.com', 'fakemail.net',
  'getairmail.com', 'inboxkitten.com', 'mail.tm', 'mailsac.com', 'spambox.us', 'trash-mail.com', 'wegwerfmail.de', 'byom.de', 'cs.email', 'tempr.email', 'dropmail.me',
  'mailtemp.info', 'email-temp.com', 'disposablemail.com', 'anonaddy.me', '1secmail.com', '1secmail.net', '1secmail.org', 'harakirimail.com', 'mvrht.com', 'example.com', 'test.com'
]);

const mxCache = new Map<string, { ok: boolean; at: number }>();
async function domainReceivesMail(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.ok;
  let ok = true;
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 4000))
    ]);
    ok = records.some(record => record.exchange && record.exchange !== '.');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Only a definite "no such domain / no mail records" rejects; DNS hiccups never block a real person.
    ok = !(code === 'ENOTFOUND' || code === 'ENODATA');
  }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

export async function checkEmailForSignup(email: string): Promise<void> {
  if (!EMAIL_RE.test(email)) throw new VerificationError('Enter a valid email address.');
  const domain = email.split('@')[1];
  const parts = domain.split('.');
  const blocked = parts.some((_, index) => DISPOSABLE_DOMAINS.has(parts.slice(index).join('.')));
  if (blocked) throw new VerificationError('Temporary or disposable email addresses can\'t be used. Please use your real email.', 400, 'disposable-email');
  if (!(await domainReceivesMail(domain))) throw new VerificationError('That email domain can\'t receive mail. Check the address and try again.', 400, 'bad-domain');
}

// ---------- storage ----------

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const codeDocId = (purpose: CodePurpose, email: string) => sha256(`${purpose}:${email}`);
const hashCode = (docId: string, code: string) => crypto.createHmac('sha256', codeSecret()).update(`${docId}:${code}`).digest('hex');

/** 3 per hour per email (all purposes together) and 60 s between sends. Throws when over the limit. */
async function reserveSend(db: NonNullable<typeof firestore>, email: string): Promise<void> {
  const ref = db.collection('verificationSends').doc(sha256(`sends:${email}`));
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const recent = ((snap.exists ? snap.get('times') : []) as number[] || []).filter(time => typeof time === 'number' && now - time < 60 * 60 * 1000);
    const last = recent.length ? Math.max(...recent) : 0;
    if (now - last < RESEND_AFTER_MS) {
      const wait = Math.ceil((RESEND_AFTER_MS - (now - last)) / 1000);
      throw new VerificationError(`Please wait ${wait} seconds before asking for a new code.`, 429, 'resend-too-soon', wait);
    }
    if (recent.length >= MAX_SENDS_PER_HOUR) {
      const wait = Math.ceil((Math.min(...recent) + 60 * 60 * 1000 - now) / 1000);
      throw new VerificationError('Too many codes requested. Please try again in an hour.', 429, 'too-many-codes', wait);
    }
    tx.set(ref, { times: [...recent, now], expiresAt: now + 60 * 60 * 1000 });
  });
}

async function storeCode(db: NonNullable<typeof firestore>, purpose: CodePurpose, email: string): Promise<string> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = codeDocId(purpose, email);
  const now = Date.now();
  await db.collection('verificationCodes').doc(id).set({ purpose, codeHash: hashCode(id, code), expiresAt: now + CODE_TTL_MS, attempts: 0, used: false, createdAt: now });
  return code;
}

/** Checks a code. Wrong codes count as attempts; the 5th wrong one burns the code. Success deletes it. */
async function consumeCode(purpose: CodePurpose, email: string, code: unknown): Promise<void> {
  const { db } = requireReady();
  const clean = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (clean.length !== 6) throw new VerificationError('Enter the 6-digit code.');
  const id = codeDocId(purpose, email);
  const ref = db.collection('verificationCodes').doc(id);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'missing';
    const data = snap.data() as { codeHash: string; expiresAt: number; attempts: number; used: boolean };
    if (data.used || data.expiresAt < Date.now()) { tx.delete(ref); return 'expired'; }
    if (data.attempts >= MAX_ATTEMPTS) { tx.delete(ref); return 'locked'; }
    const expected = Buffer.from(data.codeHash, 'hex');
    const given = Buffer.from(hashCode(id, clean), 'hex');
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      const attempts = data.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) tx.delete(ref); else tx.update(ref, { attempts });
      return attempts >= MAX_ATTEMPTS ? 'locked' : `wrong:${MAX_ATTEMPTS - attempts}`;
    }
    tx.update(ref, { used: true, usedAt: Date.now() });
    return 'ok';
  });
  if (result === 'ok') { await ref.delete().catch(() => {}); return; }
  if (result === 'missing' || result === 'expired') throw new VerificationError('This code has expired. Tap "Resend code" to get a new one.', 400, 'expired');
  if (result === 'locked') throw new VerificationError('Too many wrong tries. Tap "Resend code" to get a new code.', 400, 'locked');
  const left = Number(result.split(':')[1]);
  throw new VerificationError(`That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 400, 'wrong-code');
}

// ---------- email ----------

function emailHtml(code: string, purpose: CodePurpose): string {
  const intro = purpose === 'reset' ? 'Use this code to reset your eChat password.' : 'Use this code to verify your email and finish setting up your eChat account.';
  return `<!doctype html><html><body style="margin:0;background:#f6f3ea;font-family:Arial,Helvetica,sans-serif;color:#111">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e2c06e;border-radius:20px;padding:32px 28px">
      <tr><td align="center"><img src="${appUrl()}/logo-512.png" width="64" height="64" alt="eChat" style="display:block;border-radius:16px" /></td></tr>
      <tr><td align="center" style="padding-top:12px;font-size:22px;font-weight:800">eChat</td></tr>
      <tr><td style="padding-top:20px;font-size:15px;line-height:1.5;color:#374151">${intro}</td></tr>
      <tr><td style="padding-top:16px;font-size:15px;color:#111">Your eChat verification code is:</td></tr>
      <tr><td align="center" style="padding:14px 0 6px"><div style="display:inline-block;letter-spacing:10px;font-size:34px;font-weight:800;color:#1f3d1a;background:#fdf6e3;border:1px solid #e2c06e;border-radius:14px;padding:14px 18px 14px 28px">${code}</div></td></tr>
      <tr><td style="padding-top:14px;font-size:13px;line-height:1.5;color:#6b7280">This code expires in <b>10 minutes</b>. Never share it with anyone &mdash; eChat staff will never ask for it.</td></tr>
      <tr><td style="padding-top:10px;font-size:13px;line-height:1.5;color:#6b7280">If you didn't ask for this code, you can ignore this email.</td></tr>
      <tr><td align="center" style="padding-top:24px;font-size:11px;color:#9ca3af">From Eworld (LEK GOD)</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { name: match[1] || 'eChat', email: match[2] } : { name: 'eChat', email: from };
}

async function sendCodeEmail(to: string, code: string, purpose: CodePurpose): Promise<void> {
  const subject = purpose === 'reset' ? `${code} is your eChat password reset code` : `${code} is your eChat verification code`;
  const text = `Your eChat verification code is: ${code}\n\nIt expires in 10 minutes. Never share it with anyone.\n\nIf you didn't ask for this code, ignore this email.\n\nFrom Eworld (LEK GOD)`;
  const html = emailHtml(code, purpose);
  const sender = parseFrom(emailFrom());
  let response: Response;
  if (brevoKey()) {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey(), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      signal: AbortSignal.timeout(15000)
    });
  } else {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${sender.name} <${sender.email}>`, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(15000)
    });
  }
  if (!response.ok) {
    // Log the provider's status only: never the code or the recipient.
    console.error('[verification] email provider rejected the message:', response.status, (await response.text().catch(() => '')).slice(0, 300));
    throw new VerificationError('We couldn\'t send the email right now. Please try again in a minute.', 502, 'email-failed');
  }
}

async function issueCode(purpose: CodePurpose, email: string): Promise<void> {
  const { db } = requireReady();
  await reserveSend(db, email);
  const code = await storeCode(db, purpose, email);
  await sendCodeEmail(email, code, purpose);
}

// ---------- flows ----------

async function findAuthUser(email: string) {
  const auth = getFirebaseAdminAuth();
  if (!auth) return null;
  try { return await auth.getUserByEmail(email); }
  catch (error) { if ((error as { code?: string }).code === 'auth/user-not-found') return null; throw error; }
}

export const RESPONSE_TIMING = { expiresInSeconds: CODE_TTL_MS / 1000, resendAfterSeconds: RESEND_AFTER_MS / 1000 };

/** Sign-up step 1: check the email, then send a code. Nothing is created yet. */
export async function sendSignupCode(rawEmail: unknown): Promise<void> {
  requireReady();
  const email = normalizeEmail(rawEmail);
  await checkEmailForSignup(email);
  const existing = await findAuthUser(email);
  if (existing) throw new VerificationError('An account with this email already exists. Log in instead.', 409, 'email-in-use');
  await issueCode('signup', email);
}

/** Sign-up step 2: code is right → create the Firebase account with emailVerified = true. */
export async function completeSignup(rawEmail: unknown, code: unknown, password: unknown, name: unknown, legacyUid?: string): Promise<{ uid: string }> {
  const { auth } = requireReady();
  const email = normalizeEmail(rawEmail);
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new VerificationError('Password should be at least 6 characters.');
  if (await findAuthUser(email)) throw new VerificationError('An account with this email already exists. Log in instead.', 409, 'email-in-use');
  await consumeCode('signup', email, code);
  const displayName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
  const fields = { email, password, emailVerified: true, ...(displayName ? { displayName } : {}) };
  try {
    return { uid: (await auth.createUser(legacyUid ? { uid: legacyUid, ...fields } : fields)).uid };
  } catch (error) {
    if (legacyUid && (error as { code?: string }).code === 'auth/uid-already-exists') return { uid: (await auth.createUser(fields)).uid };
    throw error;
  }
}

/** Signed-in person with an unverified email (older accounts): send a code to that email. */
export async function sendVerifyCode(uid: string): Promise<string> {
  const { auth } = requireReady();
  const record = await auth.getUser(uid);
  const email = normalizeEmail(record.email);
  if (!email) throw new VerificationError('This account has no email address.');
  if (record.emailVerified) throw new VerificationError('Your email is already verified.', 409, 'already-verified');
  await issueCode('verify', email);
  return email;
}

export async function completeVerify(uid: string, code: unknown): Promise<void> {
  const { auth, db } = requireReady();
  const record = await auth.getUser(uid);
  const email = normalizeEmail(record.email);
  if (!email) throw new VerificationError('This account has no email address.');
  if (!record.emailVerified) {
    await consumeCode('verify', email, code);
    await auth.updateUser(uid, { emailVerified: true });
  }
  await db.collection('users').doc(uid).set({ emailVerified: true, emailVerifiedAt: Date.now() }, { merge: true });
}

/**
 * Forgot password step 1. Always answers the same way so nobody can test which emails exist,
 * but only registered accounts get an email. The 3-per-hour limit counts every request for an
 * address (registered or not), so hitting the limit reveals nothing either.
 */
export async function sendResetCode(rawEmail: unknown, legacyUserExists: (email: string) => boolean): Promise<void> {
  const { db } = requireReady();
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw new VerificationError('Enter a valid email address.');
  await reserveSend(db, email);
  const exists = Boolean(await findAuthUser(email)) || legacyUserExists(email);
  if (!exists) {
    await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 500)); // similar timing to a real send
    return;
  }
  const code = await storeCode(db, 'reset', email);
  await sendCodeEmail(email, code, 'reset');
}

/** Forgot password step 2: right code → set the new password, sign out other devices. */
export async function completeReset(rawEmail: unknown, code: unknown, newPassword: unknown): Promise<{ uid: string | null; email: string }> {
  const { auth, db } = requireReady();
  const email = normalizeEmail(rawEmail);
  if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) throw new VerificationError('Password should be at least 6 characters.');
  await consumeCode('reset', email, code);
  const record = await findAuthUser(email);
  if (record) {
    // They proved they own the inbox, so the email counts as verified too.
    await auth.updateUser(record.uid, { password: newPassword, emailVerified: true });
    await auth.revokeRefreshTokens(record.uid).catch(() => {});
    await db.collection('users').doc(record.uid).set({ emailVerified: true, emailVerifiedAt: Date.now() }, { merge: true }).catch(() => {});
  }
  return { uid: record?.uid || null, email };
}
