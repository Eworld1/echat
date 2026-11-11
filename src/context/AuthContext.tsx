import { compressImage } from '../utils/image';
import { gradientCover, initialsAvatar } from '../utils/avatar';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';
import { auth, db } from '../services/firebase';
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
  login: (email: string, password: string) => Promise<void>;
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
        setUser(null);
      }
    } catch (err) {
      console.error('refreshUser failed:', err);
      localStorage.removeItem('echat_user_id');
      localStorage.removeItem('echat_token');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getUserById(firebaseUser.uid);
          if (userDoc && isRemovedDemoAccount(userDoc)) {
            await signOut(auth);
            localStorage.removeItem('echat_user_id');
            localStorage.removeItem('echat_token');
            setUser(null);
          } else if (userDoc) {
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

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    const cleanEmail = email.toLowerCase().trim();
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
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

      // ✅ FIX 2: Sync with Express backend so /api/friends works
      try {
        await api.login({ email: cleanEmail, password });
      } catch {}
      
      // Also register in backend if not exists
      try {
        await api.register({ name: profile.name, email: cleanEmail, password, dob: profile.dob || '2000-01-01', id: profile.id, termsAccepted: true });
      } catch {}
      setUser(await withServerSocial(profile));

    } catch (firebaseErr: any) {
      console.warn('Firebase login failed, trying backend fallback:', firebaseErr);
      try {
        const res = await api.login({ email: cleanEmail, password });
        localStorage.setItem('echat_user_id', res.user.id);
        localStorage.setItem('echat_token', res.token || res.user.id);
        setUser(res.user);
      } catch (backendErr) {
        throw firebaseErr;
      }
    } finally {
      setIsLoading(false);
    }
  };

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
    setIsLoading(true);
    const cleanEmail = data.email.toLowerCase().trim();
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, data.password);
      const uid = userCredential.user.uid;
      const newUser: User = {
        id: uid,
        name: data.name,
        email: cleanEmail,
        dob: data.dob,
        passwordHash: '', // Firebase Auth owns the password; never store a hash in Firestore
        // No stock photos: a generated initials avatar until the person uploads their own picture.
        avatar: data.avatar || initialsAvatar(data.name),
        coverPhoto: gradientCover(data.name),
        bio: data.bio || 'Excited to be on Echat! 👋',
        location: data.location || 'Global',
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

      await setDoc(doc(db, 'users', uid), newUser);

      // ✅ FIX: Save ID + TOKEN immediately so Add Friend works
      localStorage.setItem('echat_user_id', uid);
      localStorage.setItem('echat_token', uid);
      setUser(newUser);

      // ✅ FIX: Also create in Express backend so friends/call API works
      try {
        await api.register({ ...data, email: cleanEmail, id: uid });
      } catch {
        // Firebase remains authoritative; backend registration may already exist.
      }
      setUser(await withServerSocial(newUser));

      // Profile picture chosen from the device gallery: shrink, upload, then save it on the profile.
      if (data.avatarFile) {
        try {
          const file = await compressImage(data.avatarFile, 640);
          const url = await api.uploadFile(file);
          await updateDoc(doc(db, 'users', uid), { avatar: url });
          setUser(prev => (prev ? { ...prev, avatar: url } : prev));
          await api.updateProfile(uid, { avatar: url }).catch(() => {});
        } catch (uploadErr) {
          console.warn('Profile photo upload failed; keeping the generated avatar:', uploadErr);
        }
      }

    } catch (err: any) {
      console.error('Registration failed:', err);
      if (err?.code === 'auth/email-already-in-use') {
        throw new Error('An account with this email address already exists.');
      } else if (err?.code === 'auth/weak-password') {
        throw new Error('Password should be at least 6 characters.');
      } else if (err?.code === 'auth/invalid-email') {
        throw new Error('The email address is invalid.');
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      const current = auth.currentUser;
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
        setUser(targetUser);
        return;
      }
      const res = await api.quickSwitch(userId);
      localStorage.setItem('echat_user_id', res.user.id);
      localStorage.setItem('echat_token', res.token || res.user.id);
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

  const isDeveloper = Boolean(user && user.role === 'developer' && user.isOfficialDeveloper);

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
      quickSwitchUser, 
      updateCurrentUser, 
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
