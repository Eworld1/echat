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
  createUser as dbCreateUser, 
  getUserById, 
  getUserByEmail, 
  ensureSeedAdminUser,
  hashPassword 
} from '../services/db';
import { User } from '../types';
import { api } from '../services/api';

const ADMIN_EMAIL = 'eldermoses89@gmail.com';

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
    bio?: string; 
    location?: string; 
    termsAccepted: boolean 
  }) => Promise<void>;
  logout: () => Promise<void>;
  quickSwitchUser: (userId: string) => Promise<void>;
  updateCurrentUser: (updates: Partial<User>) => Promise<void>;
  refreshUser: () => Promise<void>;
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

// Friends and friend requests live on the Echat server, not in Firebase. Without this merge the
// UI keeps showing the stale Firebase copy, so "Add Friend" appears to do nothing.
async function withServerSocial<T extends { friends: string[]; friendRequestsSent: string[]; friendRequestsReceived: string[] }>(profile: T): Promise<T> {
  try {
    const me = await api.getMe();
    if (!me) return profile;
    return {
      ...profile,
      friends: me.friends ?? profile.friends,
      friendRequestsSent: me.friendRequestsSent ?? profile.friendRequestsSent,
      friendRequestsReceived: me.friendRequestsReceived ?? profile.friendRequestsReceived
    };
  } catch {
    return profile;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [devKey, setDevKeyState] = useState<string | null>(() => localStorage.getItem('echat_dev_key'));

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
    ensureSeedAdminUser().catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getUserById(firebaseUser.uid);
          if (userDoc) {
            localStorage.setItem('echat_user_id', userDoc.id);
            localStorage.setItem('echat_token', userDoc.id);
            setUser(userDoc);
            syncServerProfile(userDoc);
            withServerSocial(userDoc).then(setUser);
          } else if (firebaseUser.email) {
            const byEmail = await getUserByEmail(firebaseUser.email);
            if (byEmail) {
              localStorage.setItem('echat_user_id', byEmail.id);
              localStorage.setItem('echat_token', byEmail.id);
              setUser(byEmail);
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
        const isDeveloper = cleanEmail === ADMIN_EMAIL;
        profile = {
          id: uid,
          name: cred.user.displayName || cleanEmail.split('@')[0],
          email: cleanEmail,
          dob: '2000-01-01',
          passwordHash: hashPassword(password),
          avatar: cred.user.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
          coverPhoto: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1400&q=80',
          bio: 'Excited to be on Echat! 👋',
          location: 'Global',
          work: '',
          education: '',
          role: isDeveloper ? 'developer' : 'user',
          isVerified: isDeveloper,
          isOfficialDeveloper: isDeveloper,
          boostsCount: isDeveloper ? 420 : 0,
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
    bio?: string; 
    location?: string; 
    termsAccepted: boolean 
  }) => {
    setIsLoading(true);
    const cleanEmail = data.email.toLowerCase().trim();
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, data.password);
      const uid = userCredential.user.uid;
      const isDeveloper = cleanEmail === ADMIN_EMAIL;

      const newUser: User = {
        id: uid,
        name: data.name,
        email: cleanEmail,
        dob: data.dob,
        passwordHash: hashPassword(data.password),
        avatar: data.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        coverPhoto: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1400&q=80',
        bio: data.bio || 'Excited to be on Echat! 👋',
        location: data.location || 'Global',
        work: '',
        education: '',
        role: isDeveloper ? 'developer' : 'user',
        isVerified: isDeveloper,
        isOfficialDeveloper: isDeveloper,
        boostsCount: isDeveloper ? 420 : 0,
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
      } catch (e) {
        console.log('Backend sync (expected if already exists):', e);
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
    try {
      await updateDoc(doc(db, 'users', user.id), updates as any);
      const updated = { ...user, ...updates };
      setUser(updated);
      api.updateProfile(user.id, updates).catch(() => {});
    } catch (err) {
      console.error('updateCurrentUser error:', err);
      const updated = await api.updateProfile(user.id, updates);
      setUser(updated);
    }
  };

  const isDeveloper = Boolean(user && user.email?.toLowerCase().trim() === ADMIN_EMAIL);

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
      refreshUser 
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