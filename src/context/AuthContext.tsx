import { compressImage } from '../utils/image';
import { onProfilePictureChanged } from '../services/profilePhotoPosts';
import { gradientCover, initialsAvatar } from '../utils/avatar';
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
  type User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { disablePush } from '../services/push';
import { 
  getUserById, 
  getUserByEmail
} from '../services/db';
import { Page, User } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isDeveloper: boolean;
  devKey: string | null;
  setDevKey: (key: string | null) => void;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  /** Google sign-in. New people get `pendingSocialSignup` and must finish with completeSocialSignup. */
  loginWithProvider: (provider: SocialProvider, remember?: boolean) => Promise<void>;
  pendingSocialSignup: PendingSocialSignup | null;
  completeSocialSignup: (data: { name: string; dob: string }) => Promise<void>;
  cancelSocialSignup: () => Promise<void>;
  register: (data: { 
    name: string; 
    email: string; 
    password: string; 
    dob: string; 
    avatar?: string; 
    avatarFile?: File;
    bio?: string; 
    location?: string; 
    termsAccepted: boolean 
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** Email: waiting for the Firebase verification link to be clicked. Phone: waiting for the SMS code. */
  pendingVerification: PendingVerification | null;
  /** Email sign-up: creates the Firebase account and sends the verification link (no codes). */
  startEmailSignup: (data: EmailSignupData) => Promise<void>;
  /** Phone sign-in: check the SMS code Firebase texted. */
  confirmSmsCode: (code: string) => Promise<void>;
  /** Email: reload the Firebase user; true (and signed in) once the verification link was clicked. */
  checkEmailVerified: () => Promise<boolean>;
  /** Email: send the Firebase verification link again; resolves with seconds until the next resend. */
  resendVerificationEmail: () => Promise<number>;
  /** Phone: text a new SMS code; resolves with seconds until the next resend is allowed. */
  resendSmsCode: () => Promise<number>;
  cancelVerification: () => Promise<void>;
  /** Phone sign-in / sign-up: sends an SMS code through Firebase Phone Auth. */
  startPhoneSignIn: (phoneNumber: string, recaptchaContainerId: string, remember?: boolean) => Promise<void>;
  /** Remove the invisible reCAPTCHA (call when the sign-in screen unmounts). */
  clearRecaptcha: () => void;
  quickSwitchUser: (userId: string) => Promise<void>;
  updateCurrentUser: (updates: Partial<User>) => Promise<void>;
  /** Merge an already-saved user object (e.g. the server's reply) into the signed-in user. */
  updateUser: (updated: User) => void;
  refreshUser: () => Promise<void>;
  myPages: Page[];
  activePage: Page | null;
  switchIdentity: (page: Page | null) => void;
  createIdentityPage: (data: { name: string; category: string; bio: string; avatar?: string; cover: string }) => Promise<Page>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Facebook login was removed: Google is the only social sign-in. 'phone' = Firebase SMS sign-in.
export type SocialProvider = 'google' | 'phone';

export interface EmailSignupData { name: string; email: string; password: string; dob: string; avatarFile?: File; remember?: boolean }
export type PendingVerification =
  /** Email/password account waiting for the Firebase verification link (new sign-up, or a login before verifying). */
  | { kind: 'email'; email: string; justSignedUp: boolean }
  | { kind: 'phone'; phoneNumber: string };

/** Where the Firebase email links send people back to (must be an authorized domain in Firebase). */
const emailActionSettings = () => ({ url: `${window.location.origin}/home`, handleCodeInApp: false });

/** Firebase verification email. If this site isn't an authorized domain yet, send it without the "Continue" link. */
async function sendVerificationLink(firebaseUser: FirebaseUser): Promise<void> {
  try {
    await sendEmailVerification(firebaseUser, emailActionSettings());
  } catch (error) {
    const code = String((error as { code?: string })?.code || '');
    if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri' || code === 'auth/missing-continue-uri') await sendEmailVerification(firebaseUser);
    else throw error;
  }
}

/** Email/password accounts must verify their email; Google and phone sign-ins are already verified. */
export function needsEmailVerification(firebaseUser: FirebaseUser | null): boolean {
  if (!firebaseUser || firebaseUser.emailVerified || firebaseUser.phoneNumber) return false;
  const providers = firebaseUser.providerData.map(item => item.providerId);
  return providers.includes('password') && !providers.includes('google.com');
}

/** Plain-language errors for verification calls. */
function verificationError(error: unknown): Error {
  if (error instanceof Error && (error as { status?: number }).status) return error;
  const code = String((error as { code?: string })?.code || '');
  if (code === 'auth/invalid-verification-code') return new Error('That code isn\'t right. Check the SMS and try again.');
  if (code === 'auth/code-expired') return new Error('This code has expired. Tap "Resend code" to get a new one.');
  if (code === 'auth/invalid-phone-number') return new Error('Enter your phone number with the country code, e.g. +232 76 123456.');
  if (code === 'auth/too-many-requests') return new Error('Too many emails or attempts. Please wait a few minutes and try again.');
  if (code === 'auth/network-request-failed') return new Error('No internet connection. Check your network and try again.');
  if (code === 'auth/billing-not-enabled' || code === 'auth/quota-exceeded') return new Error('Phone sign-up isn\'t available right now. Please use your email or Google.');
  if (code === 'auth/operation-not-allowed') return new Error('Phone sign-in isn\'t switched on yet. Please use your email or Google.');
  if (code === 'auth/captcha-check-failed') return new Error('Security check failed. Reload the page and try again.');
  return error instanceof Error ? error : new Error(friendlyAuthError(error));
}
export interface PendingSocialSignup { provider: SocialProvider; name: string; email: string; photoURL: string }

// "Remember me" off: the sign-in lasts only for this browser session.
const SESSION_ONLY_KEY = 'echat_session_only';
const SESSION_ALIVE_KEY = 'echat_session_alive';
try {
  if (localStorage.getItem(SESSION_ONLY_KEY) === '1' && !sessionStorage.getItem(SESSION_ALIVE_KEY)) {
    ['echat_user_id', 'echat_token', 'echat_live_auth'].forEach(key => localStorage.removeItem(key));
  }
  sessionStorage.setItem(SESSION_ALIVE_KEY, '1');
} catch { /* storage blocked */ }

async function applyRememberMe(remember: boolean): Promise<void> {
  try {
    if (remember) localStorage.removeItem(SESSION_ONLY_KEY);
    else localStorage.setItem(SESSION_ONLY_KEY, '1');
    sessionStorage.setItem(SESSION_ALIVE_KEY, '1');
  } catch { /* storage blocked */ }
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence).catch(() => {});
}

/** Plain-language messages for Firebase sign-in errors. */
export function friendlyAuthError(error: unknown, provider?: SocialProvider): string {
  const code = String((error as { code?: string })?.code || '');
  const name = 'Google';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'Wrong email or password. Please try again.';
    case 'auth/invalid-email': return 'That email address doesn\'t look right.';
    case 'auth/user-disabled': return 'This account has been disabled. Contact EChat support.';
    case 'auth/too-many-requests': return 'Too many attempts. Wait a few minutes, or reset your password.';
    case 'auth/network-request-failed': return 'No internet connection. Check your network and try again.';
    case 'auth/operation-not-allowed': return `${name} sign-in isn't switched on yet. An admin must enable it in Firebase → Authentication → Sign-in method.`;
    case 'auth/unauthorized-domain': return `This website isn't approved for ${name} sign-in yet. An admin must add it in Firebase → Authentication → Settings → Authorized domains.`;
    case 'auth/account-exists-with-different-credential': return 'This email already has an EChat account with a different sign-in method. Log in with your email and password.';
    case 'auth/popup-blocked': return `Your browser blocked the ${name} window. Allow pop-ups and try again.`;
    case 'auth/email-already-in-use': return 'An account with this email address already exists.';
    case 'auth/weak-password': return 'Password should be at least 6 characters.';
    default: return (error as Error)?.message || 'Something went wrong. Please try again.';
  }
}

// Keeps the Express server's copy of the user in step with the real (Firebase) profile.
function syncServerProfile(profile: { name: string; avatar: string; coverPhoto: string; bio: string; location: string }): void {
  api.syncProfile({
    name: profile.name,
    avatar: profile.avatar,
    coverPhoto: profile.coverPhoto,
    bio: profile.bio,
    location: profile.location
  }).catch(() => { /* server may be waking up; retried on next load */ });
}

function isRemovedDemoAccount(profile: Pick<User, 'id' | 'name'>): boolean {
  return profile.id === 'user_admin_elder' || /^elder moses\s*\(test\)$/i.test(profile.name.trim());
}

// Friends and friend requests live on the Echat server, not in Firebase. Without this merge the
// UI keeps showing the stale Firebase copy, so "Add Friend" appears to do nothing.
async function withServerSocial<T extends { friends: string[]; friendRequestsSent: string[]; friendRequestsReceived: string[]; savedPosts?: string[]; blockedUsers?: string[]; privacySettings?: unknown; role?: User['role']; isVerified?: boolean; isOfficialDeveloper?: boolean }>(profile: T): Promise<T> {
  try {
    const me = await api.getMe();
    if (!me) return profile;
    return {
      ...profile,
      friends: me.friends ?? profile.friends,
      friendRequestsSent: me.friendRequestsSent ?? profile.friendRequestsSent,
      friendRequestsReceived: me.friendRequestsReceived ?? profile.friendRequestsReceived,
      savedPosts: me.savedPosts ?? profile.savedPosts ?? [],
      blockedUsers: me.blockedUsers ?? profile.blockedUsers ?? [],
      privacySettings: me.privacySettings ?? profile.privacySettings,
      role: me.role ?? profile.role,
      isVerified: me.isVerified ?? profile.isVerified,
      isOfficialDeveloper: me.isOfficialDeveloper ?? profile.isOfficialDeveloper
    };
  } catch {
    return profile;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [devKey, setDevKeyState] = useState<string | null>(() => localStorage.getItem('echat_dev_key'));
  const [myPages, setMyPages] = useState<Page[]>([]);
  const [activePage, setActivePage] = useState<Page | null>(null);
  const [pendingSocialSignup, setPendingSocialSignup] = useState<PendingSocialSignup | null>(null);
  const [pendingVerification, setPendingVerification] = useState<PendingVerification | null>(null);
  const phoneConfirmation = useRef<{ result: ConfirmationResult; containerId: string; remember: boolean } | null>(null);
  /** The single invisible reCAPTCHA. Each one gets a brand-new element, so it can never be "already rendered". */
  const recaptcha = useRef<RecaptchaVerifier | null>(null);
  const smsInFlight = useRef<Promise<void> | null>(null);

  const clearRecaptcha = useCallback(() => {
    const verifier = recaptcha.current;
    recaptcha.current = null;
    try { verifier?.clear(); } catch { /* already gone */ }
  }, []);

  /** Signed in but email not verified: keep them out of the app and show "Check your email". */
  const holdForVerification = async (firebaseUser: FirebaseUser): Promise<boolean> => {
    if (!needsEmailVerification(firebaseUser)) return false;
    // They may have just clicked the link (in this or another tab): refresh once before deciding.
    await firebaseUser.reload().catch(() => {});
    if (auth.currentUser?.emailVerified) { await auth.currentUser.getIdToken(true).catch(() => ''); return false; }
    ['echat_user_id', 'echat_token', 'echat_live_auth'].forEach(key => localStorage.removeItem(key));
    setUser(null);
    const email = (firebaseUser.email || '').toLowerCase();
    setPendingVerification(current => current?.kind === 'email' && current.email === email ? current : { kind: 'email', email, justSignedUp: false });
    return true;
  };

  useEffect(() => {
    const onProfileUpdated = (event: Event) => {
      const updated = (event as CustomEvent<Partial<User> & { id?: string }>).detail;
      if (!updated || !updated.id) return;
      setUser(current => {
        if (!current || current.id !== updated.id) return current;
        return { ...current, ...updated, id: current.id } as User;
      });
    };
    window.addEventListener('echat:profile-updated', onProfileUpdated);
    return () => window.removeEventListener('echat:profile-updated', onProfileUpdated);
  }, []);

  useEffect(() => {
    if (!user) { setMyPages([]); setActivePage(null); localStorage.removeItem('echat_active_page'); return; }
    let cancelled = false;
    api.getMyPages().then(pages => {
      if (cancelled) return;
      setMyPages(pages);
      const id = localStorage.getItem('echat_active_page');
      setActivePage(id ? pages.find(page => page.id === id) || null : null);
    }).catch(() => { if (!cancelled) { setMyPages([]); setActivePage(null); } });
    return () => { cancelled = true; };
  }, [user?.id]);

  const switchIdentity = (page: Page | null) => {
    setActivePage(page);
    if (page) localStorage.setItem('echat_active_page', page.id);
    else localStorage.removeItem('echat_active_page');
  };
  const createIdentityPage = async (data: { name: string; category: string; bio: string; avatar?: string; cover: string }) => {
    const page = await api.createPage(data);
    setMyPages(current => [page, ...current]);
    switchIdentity(page);
    return page;
  };

  const setDevKey = (key: string | null) => {
    if (key) localStorage.setItem('echat_dev_key', key);
    else localStorage.removeItem('echat_dev_key');
    setDevKeyState(key);
  };

  const refreshUser = async () => {
    const currentFirebaseUser = auth.currentUser;
    if (currentFirebaseUser) {
      try {
        let profile = await getUserById(currentFirebaseUser.uid);
        if (!profile && currentFirebaseUser.email) {
          profile = await getUserByEmail(currentFirebaseUser.email);
        }
        if (profile && isRemovedDemoAccount(profile)) {
          await signOut(auth);
          localStorage.removeItem('echat_user_id');
          localStorage.removeItem('echat_token');
          localStorage.removeItem('echat_live_auth');
          setUser(null);
          setIsLoading(false);
          return;
        }
        if (profile) {
          localStorage.setItem('echat_user_id', profile.id);
          localStorage.setItem('echat_token', profile.id);
          syncServerProfile(profile);
          setUser(await withServerSocial(profile));
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error('Error fetching user profile from Firestore:', err);
      }
    }

    const storedId = localStorage.getItem('echat_user_id');
    if (!storedId) {
      setIsLoading(false);
      setUser(null);
      return;
    }

    try {
      const firestoreUser = await getUserById(storedId);
      if (firestoreUser) {
        setUser(firestoreUser);
        setIsLoading(false);
        return;
      }
      const me = await api.getMe();
      if (me) {
        setUser(me);
      } else {
        localStorage.removeItem('echat_user_id');
        localStorage.removeItem('echat_token');
        localStorage.removeItem('echat_live_auth');
        setUser(null);
      }
    } catch (err) {
      console.error('refreshUser failed:', err);
      localStorage.removeItem('echat_user_id');
      localStorage.removeItem('echat_token');
      localStorage.removeItem('echat_live_auth');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && await holdForVerification(firebaseUser)) { setIsLoading(false); return; }
      if (firebaseUser) {
        try {
          const userDoc = await getUserById(firebaseUser.uid);
          if (userDoc && isRemovedDemoAccount(userDoc)) {
            await signOut(auth);
            localStorage.removeItem('echat_user_id');
            localStorage.removeItem('echat_token');
            localStorage.removeItem('echat_live_auth');
            setUser(null);
          } else if (userDoc) {
            if (firebaseUser.emailVerified && userDoc.emailVerified !== true && firebaseUser.providerData.some(item => item.providerId === 'password')) {
              updateDoc(doc(db, 'users', userDoc.id), { emailVerified: true, emailVerifiedAt: Date.now() }).catch(() => {});
            }
            localStorage.setItem('echat_user_id', userDoc.id);
            localStorage.setItem('echat_token', userDoc.id);
            setUser(await withServerSocial(userDoc));
            syncServerProfile(userDoc);
            withServerSocial(userDoc).then(setUser);
          } else if (firebaseUser.email) {
            const byEmail = await getUserByEmail(firebaseUser.email);
            if (byEmail && isRemovedDemoAccount(byEmail)) {
              await signOut(auth);
              localStorage.removeItem('echat_user_id');
              localStorage.removeItem('echat_token');
              localStorage.removeItem('echat_live_auth');
              setUser(null);
            } else if (byEmail) {
              localStorage.setItem('echat_user_id', byEmail.id);
              localStorage.setItem('echat_token', byEmail.id);
              setUser(await withServerSocial(byEmail));
              syncServerProfile(byEmail);
              withServerSocial(byEmail).then(setUser);
            }
          }
        } catch (err) {
          console.error('onAuthStateChanged profile fetch error:', err);
        }
      } else {
        const storedId = localStorage.getItem('echat_user_id');
        if (!storedId) {
          setUser(null);
        }
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string, remember = true) => {
    // No global isLoading here: it swapped the login page for the loading screen, so a failed
    // login came back to an empty form without its error message. The form shows its own spinner.
    const cleanEmail = email.toLowerCase().trim();
    await applyRememberMe(remember);
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      // Unverified email: no entry. "Please verify your email first" opens with a Resend link button.
      if (await holdForVerification(cred.user)) return;
      const uid = cred.user.uid;
      let profile = await getUserById(uid);
      if (!profile) {
        profile = await getUserByEmail(cleanEmail);
      }
      if (!profile) {
        profile = {
          id: uid,
          name: cred.user.displayName || cleanEmail.split('@')[0],
          email: cleanEmail,
          dob: '2000-01-01',
          passwordHash: '', // Firebase Auth owns the password; never store a hash in Firestore
          avatar: cred.user.photoURL || initialsAvatar(cred.user.displayName || cleanEmail.split('@')[0]),
          coverPhoto: gradientCover(cred.user.displayName || cleanEmail.split('@')[0]),
          bio: 'Excited to be on Echat! 👋',
          location: 'Global',
          work: '',
          education: '',
          role: 'user',
          isVerified: false,
          isOfficialDeveloper: false,
          emailVerified: cred.user.emailVerified,
          boostsCount: 0,
          boostedBy: [],
          isBlocked: false,
          isOnline: true,
          lastSeen: Date.now(),
          createdAt: Date.now(),
          friends: [],
          friendRequestsSent: [],
          friendRequestsReceived: []
        };
        await setDoc(doc(db, 'users', uid), profile, { merge: true });
      } else {
        if (isRemovedDemoAccount(profile)) {
          await signOut(auth);
          throw new Error('This legacy demo account was removed. Please use your personal account.');
        }
        await updateDoc(doc(db, 'users', profile.id), {
          isOnline: true,
          lastSeen: Date.now()
        }).catch(() => {});
      }

      // ✅ FIX 1: Always save ID + TOKEN for backend auth (Add Friend & Call need this)
      localStorage.setItem('echat_user_id', profile.id);
      localStorage.setItem('echat_token', profile.id);
      setUser(profile);

      // Sync with Express and retain its signed proof for protected live controls.
      let liveAuthToken: string | undefined;
      try { liveAuthToken = (await api.login({ email: cleanEmail, password })).liveAuthToken; } catch {}
      try {
        const registered = await api.register({ name: profile.name, email: cleanEmail, password, dob: profile.dob || '2000-01-01', id: profile.id, termsAccepted: true });
        liveAuthToken = registered.liveAuthToken || liveAuthToken;
      } catch {}
      if (liveAuthToken) localStorage.setItem('echat_live_auth', liveAuthToken);
      setUser(await withServerSocial(profile));

    } catch (firebaseErr: any) {
      if (firebaseErr instanceof Error && !(firebaseErr as { code?: string }).code) throw firebaseErr;
      const code = String(firebaseErr?.code || '');
      // Very old accounts exist only on the eChat server. They must verify their email once,
      // which moves them to Firebase; they are never let in unverified.
      if (['auth/invalid-credential', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) {
        let legacy: Awaited<ReturnType<typeof api.login>> | null = null;
        try { legacy = await api.login({ email: cleanEmail, password }); } catch { legacy = null; }
        if (legacy) {
          // Move the old account to Firebase, then it must verify its email like everyone else.
          await startEmailSignup({ name: legacy.user.name, email: cleanEmail, password, dob: legacy.user.dob || '2000-01-01', remember });
          return;
        }
      }
      throw new Error(friendlyAuthError(firebaseErr));
    }
  };

  /** Signed in with Google: use the existing EChat profile, or ask the person to finish sign-up. */
  const finishSocialSignIn = async (firebaseUser: FirebaseUser, provider: SocialProvider) => {
    let profile = await getUserById(firebaseUser.uid);
    if (!profile && firebaseUser.email) profile = await getUserByEmail(firebaseUser.email.toLowerCase());
    if (profile && isRemovedDemoAccount(profile)) {
      await signOut(auth);
      throw new Error('This legacy demo account was removed. Please use your personal account.');
    }
    if (!profile) {
      setPendingSocialSignup({ provider, name: firebaseUser.displayName || '', email: firebaseUser.email || '', photoURL: firebaseUser.photoURL || '' });
      return;
    }
    setPendingSocialSignup(null);
    localStorage.setItem('echat_user_id', profile.id);
    localStorage.setItem('echat_token', profile.id);
    updateDoc(doc(db, 'users', profile.id), { isOnline: true, lastSeen: Date.now() }).catch(() => {});
    setUser(profile);
    syncServerProfile(profile);
    setUser(await withServerSocial(profile));
  };

  const loginWithProvider = async (provider: SocialProvider, remember = true) => {
    await applyRememberMe(remember);
    const authProvider = new GoogleAuthProvider();
    authProvider.setCustomParameters({ prompt: 'select_account' });
    try {
      const credential = await signInWithPopup(auth, authProvider);
      await finishSocialSignIn(credential.user, provider);
    } catch (error) {
      const code = String((error as { code?: string })?.code || '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      // Some phones/in-app browsers can't open pop-ups: continue in the same tab instead.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try { sessionStorage.setItem('echat_social_provider', provider); } catch { /* ignore */ }
        await signInWithRedirect(auth, authProvider);
        return;
      }
      throw new Error(friendlyAuthError(error, provider));
    }
  };

  // Coming back from a redirect sign-in (see loginWithProvider).
  useEffect(() => {
    const provider: SocialProvider = 'google';
    try { sessionStorage.removeItem('echat_social_provider'); } catch { /* ignore */ }
    getRedirectResult(auth).then(result => { if (result?.user) void finishSocialSignIn(result.user, provider); }).catch(error => console.warn('Social sign-in redirect failed:', friendlyAuthError(error, provider)));
  }, []);

  /** First Google sign-in: create the EChat profile once the person confirms name + date of birth (18+). */
  const completeSocialSignup = async (data: { name: string; dob: string }) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !pendingSocialSignup) throw new Error(pendingSocialSignup?.provider === 'phone' ? 'Your sign-in expired. Please enter your phone number again.' : 'Your sign-in expired. Please continue with Google again.');
    const name = data.name.trim().slice(0, 80) || pendingSocialSignup.name || 'EChat user';
    const email = (firebaseUser.email || pendingSocialSignup.email || '').toLowerCase();
    if (pendingSocialSignup.provider === 'google' && !firebaseUser.emailVerified) throw new Error('Google did not confirm this email. Please use another account.');
    const newUser: User = {
      id: firebaseUser.uid,
      name,
      email,
      dob: data.dob,
      passwordHash: '',
      avatar: /^https:\/\//.test(pendingSocialSignup.photoURL) ? pendingSocialSignup.photoURL : initialsAvatar(name),
      coverPhoto: gradientCover(name),
      bio: 'Excited to be on Echat! 👋',
      location: 'Global',
      work: '',
      education: '',
      role: 'user',
      isVerified: false,
      isOfficialDeveloper: false,
      boostsCount: 0,
      boostedBy: [],
      isBlocked: false,
      isOnline: true,
      lastSeen: Date.now(),
      createdAt: Date.now(),
      friends: [],
      friendRequestsSent: [],
      friendRequestsReceived: []
    };
    const viaPhone = pendingSocialSignup.provider === 'phone';
    newUser.emailVerified = !viaPhone && firebaseUser.emailVerified;
    newUser.phoneVerified = viaPhone;
    if (viaPhone && firebaseUser.phoneNumber) newUser.phoneNumber = firebaseUser.phoneNumber;
    await setDoc(doc(db, 'users', newUser.id), { ...newUser, termsAccepted: true, signInProvider: pendingSocialSignup.provider });
    localStorage.setItem('echat_user_id', newUser.id);
    localStorage.setItem('echat_token', newUser.id);
    setPendingSocialSignup(null);
    setUser(newUser);
    syncServerProfile(newUser);
    setUser(await withServerSocial(newUser));
  };

  const cancelSocialSignup = async () => {
    setPendingSocialSignup(null);
    await signOut(auth).catch(() => {});
  };

  /**
   * New email account: create the eChat profile right away (marked emailVerified: false) so nothing is
   * lost if the link is opened on another phone. The app stays locked until the link is clicked.
   */
  const createEmailProfile = async (firebaseUser: FirebaseUser, data: EmailSignupData) => {
    const uid = firebaseUser.uid;
    const cleanEmail = data.email.toLowerCase().trim();
    if (await getUserById(uid).catch(() => null)) return;
    const profile: User = {
      id: uid,
      name: data.name.trim().slice(0, 80) || cleanEmail.split('@')[0],
      email: cleanEmail,
      dob: data.dob,
      passwordHash: '', // Firebase Auth owns the password; never store a hash in Firestore
      // No stock photos: a generated initials avatar until the person uploads their own picture.
      avatar: initialsAvatar(data.name),
      coverPhoto: gradientCover(data.name),
      bio: 'Excited to be on Echat! 👋',
      location: 'Global',
      work: '',
      education: '',
      role: 'user',
      isVerified: false,
      isOfficialDeveloper: false,
      emailVerified: false,
      phoneVerified: false,
      boostsCount: 0,
      boostedBy: [],
      isBlocked: false,
      isOnline: false,
      lastSeen: Date.now(),
      createdAt: Date.now(),
      friends: [],
      friendRequestsSent: [],
      friendRequestsReceived: []
    };
    await setDoc(doc(db, 'users', uid), { ...profile, termsAccepted: true, signInProvider: 'password' });

    // Also create the Express copy so friends, calls and live work after verification.
    api.register({ name: profile.name, email: cleanEmail, password: data.password, dob: profile.dob || data.dob, id: uid, termsAccepted: true }).catch(() => {});

    // Profile picture chosen from the device gallery: shrink, upload, then save it on the profile.
    if (data.avatarFile) {
      try {
        const file = await compressImage(data.avatarFile, 640);
        const url = await api.uploadFile(file);
        await updateDoc(doc(db, 'users', uid), { avatar: url });
        await api.updateProfile(uid, { avatar: url }).catch(() => {});
      } catch (uploadErr) {
        console.warn('Profile photo upload failed; keeping the generated avatar:', uploadErr);
      }
    }
  };

  /** Email sign-up: create the Firebase account, email the verification link, then wait on "Check your email". */
  const startEmailSignup = async (data: EmailSignupData) => {
    const cleanEmail = data.email.toLowerCase().trim();
    await applyRememberMe(data.remember !== false);
    let firebaseUser: FirebaseUser;
    try {
      firebaseUser = (await createUserWithEmailAndPassword(auth, cleanEmail, data.password)).user;
    } catch (error) {
      throw new Error(friendlyAuthError(error));
    }
    setPendingVerification({ kind: 'email', email: cleanEmail, justSignedUp: true });
    ['echat_user_id', 'echat_token', 'echat_live_auth'].forEach(key => localStorage.removeItem(key));
    setUser(null);
    try {
      await sendVerificationLink(firebaseUser);
    } catch (error) {
      console.warn('Could not send the verification email yet:', (error as { code?: string })?.code || error);
    }
    await createEmailProfile(firebaseUser, { ...data, email: cleanEmail }).catch(error => console.warn('Could not create the profile yet:', error));
  };

  const checkEmailVerified = async (): Promise<boolean> => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error('Your sign-in expired. Please log in again.');
    try { await firebaseUser.reload(); } catch (error) { throw verificationError(error); }
    const current = auth.currentUser;
    if (!current?.emailVerified) return false;
    await current.getIdToken(true); // the new token carries email_verified = true for Firestore rules
    await updateDoc(doc(db, 'users', current.uid), { emailVerified: true, emailVerifiedAt: Date.now() }).catch(() => {});
    setPendingVerification(null);
    await refreshUser();
    return true;
  };

  const resendVerificationEmail = async (): Promise<number> => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error('Your sign-in expired. Please log in again.');
    try { await sendVerificationLink(firebaseUser); }
    catch (error) { throw verificationError(error); }
    return 60;
  };

  /** Phone sign-in: check the SMS code. */
  const confirmSmsCode = async (code: string) => {
    try {
      const confirmation = phoneConfirmation.current;
      if (!confirmation) throw new Error('This code has expired. Tap "Resend SMS" to get a new one.');
      const credential = await confirmation.result.confirm(code);
      phoneConfirmation.current = null;
      clearRecaptcha();
      setPendingVerification(null);
      await finishSocialSignIn(credential.user, 'phone');
    } catch (error) {
      throw verificationError(error);
    }
  };

  /**
   * Texts the SMS code. Only one send at a time; the old reCAPTCHA is cleared and a fresh one is
   * rendered into a new child element, so double taps / resends never hit "reCAPTCHA has already been rendered".
   */
  const sendSms = (phoneNumber: string, containerId: string, remember: boolean): Promise<void> => {
    if (smsInFlight.current) return smsInFlight.current;
    const run = (async () => {
      clearRecaptcha();
      const host = document.getElementById(containerId);
      if (!host) throw new Error('Could not start phone verification. Please reload the page and try again.');
      host.replaceChildren();
      const slot = document.createElement('div');
      host.appendChild(slot);
      const verifier = new RecaptchaVerifier(auth, slot, { size: 'invisible' });
      recaptcha.current = verifier;
      try {
        const result = await signInWithPhoneNumber(auth, phoneNumber, verifier);
        phoneConfirmation.current = { result, containerId, remember };
      } catch (error) {
        clearRecaptcha();
        throw error;
      }
    })();
    smsInFlight.current = run;
    return run.finally(() => { smsInFlight.current = null; });
  };

  /** Phone: send a new SMS code. */
  const resendSmsCode = async (): Promise<number> => {
    const pending = pendingVerification;
    if (pending?.kind !== 'phone') return resendVerificationEmail();
    try {
      const previous = phoneConfirmation.current;
      await sendSms(pending.phoneNumber, previous?.containerId || 'echat-recaptcha', previous?.remember ?? true);
      return 60;
    } catch (error) {
      throw verificationError(error);
    }
  };

  const startPhoneSignIn = async (phoneNumber: string, recaptchaContainerId: string, remember = true) => {
    const clean = phoneNumber.replace(/[^\d+]/g, '');
    if (!/^\+\d{8,15}$/.test(clean)) throw new Error('Enter your phone number with the country code, e.g. +232 76 123456.');
    await applyRememberMe(remember);
    try {
      await sendSms(clean, recaptchaContainerId, remember);
    } catch (error) {
      throw verificationError(error);
    }
    setPendingVerification({ kind: 'phone', phoneNumber: clean });
  };

  const cancelVerification = async () => {
    const pending = pendingVerification;
    setPendingVerification(null);
    phoneConfirmation.current = null;
    clearRecaptcha();
    if (pending?.kind === 'email') await signOut(auth).catch(() => {});
  };

  /** Kept for callers: email sign-up = Firebase account + verification link. */
  const register = async (data: {
    name: string;
    email: string;
    password: string;
    dob: string;
    avatar?: string;
    avatarFile?: File;
    bio?: string;
    location?: string;
    termsAccepted: boolean
  }) => {
    await startEmailSignup({ name: data.name, email: data.email, password: data.password, dob: data.dob, avatarFile: data.avatarFile });
  };

  const logout = async () => {
    try {
      const current = auth.currentUser;
      // Stop this phone getting the next person's notifications (needs the session, so before signOut).
      if (current) await disablePush({ keepChoice: true }).catch(() => {});
      if (current) {
        await updateDoc(doc(db, 'users', current.uid), {
          isOnline: false,
          lastSeen: Date.now()
        }).catch(() => {});
      }
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('echat_user_id');
      localStorage.removeItem('echat_token');
      localStorage.removeItem('echat_live_auth');
      setUser(null);
      setIsLoading(false);
    }
  };

  const quickSwitchUser = async (userId: string) => {
    setIsLoading(true);
    try {
      let targetUser = await getUserById(userId);
      if (targetUser) {
        localStorage.setItem('echat_user_id', targetUser.id);
        localStorage.setItem('echat_token', targetUser.id);
        localStorage.removeItem('echat_live_auth');
        setUser(targetUser);
        return;
      }
      const res = await api.quickSwitch(userId);
      localStorage.setItem('echat_user_id', res.user.id);
      localStorage.setItem('echat_token', res.token || res.user.id);
      localStorage.removeItem('echat_live_auth');
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  };

  const updateCurrentUser = async (updates: Partial<User>) => {
    if (!user) return;
    const previous = user;
    const optimistic = { ...user, ...updates };
    const publishProfile = (profile: User) => {
      const snapshot = { id: profile.id, name: profile.name, avatar: profile.avatar, coverPhoto: profile.coverPhoto, bio: profile.bio };
      localStorage.setItem('echat_profile_snapshot', JSON.stringify(snapshot));
      window.dispatchEvent(new CustomEvent('echat:profile-updated', { detail: snapshot }));
    };
    setUser(optimistic);
    publishProfile(optimistic);
    try {
      const [firebaseResult, serverResult] = await Promise.allSettled([
        updateDoc(doc(db, 'users', user.id), updates as any),
        api.updateProfile(user.id, updates)
      ]);
      if (firebaseResult.status === 'rejected' && serverResult.status === 'rejected') throw serverResult.reason;
      const updated = serverResult.status === 'fulfilled' ? { ...optimistic, ...serverResult.value } : optimistic;
      setUser(updated);
      publishProfile(updated);
      // Facebook-style "[Name] updated their profile picture" post in the main feed.
      if (typeof updates.avatar === 'string' && updates.avatar && updates.avatar !== previous.avatar) {
        void onProfilePictureChanged({ id: updated.id, name: updated.name }, updates.avatar, previous.avatar || '')
          .catch(error => console.warn('Could not create the profile picture post:', error));
      }
    } catch (err) {
      console.error('updateCurrentUser error:', err);
      setUser(previous);
      publishProfile(previous);
      throw err;
    }
  };

  const updateUser = (updated: User) => {
    setUser(prev => (prev ? { ...prev, ...updated } : updated));
  };

  const configuredDeveloperUid = String(import.meta.env.VITE_SUPER_ADMIN_UID || '').trim();
  const configuredDeveloperEmail = String(import.meta.env.VITE_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const isConfiguredDeveloper = Boolean(user && ((configuredDeveloperUid && auth.currentUser?.uid === configuredDeveloperUid) || (auth.currentUser?.emailVerified && user.email?.trim().toLowerCase() === configuredDeveloperEmail)));
  const isDeveloper = Boolean(user && (user.role === 'super_admin' || user.canApproveLive === true || (user.role === 'developer' && user.isOfficialDeveloper) || isConfiguredDeveloper));

  return (
    <AuthContext.Provider value={{ 
      user, 
      isLoading, 
      isDeveloper, 
      devKey, 
      setDevKey, 
      login, 
      register, 
      logout, 
      pendingVerification,
      startEmailSignup,
      confirmSmsCode,
      checkEmailVerified,
      resendVerificationEmail,
      resendSmsCode,
      clearRecaptcha,
      cancelVerification,
      startPhoneSignIn,
      quickSwitchUser, 
      updateCurrentUser, 
      loginWithProvider,
      pendingSocialSignup,
      completeSocialSignup,
      cancelSocialSignup,
      updateUser, 
      refreshUser,
      myPages,
      activePage,
      switchIdentity,
      createIdentityPage
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
