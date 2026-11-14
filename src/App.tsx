import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider, useSocket } from './context/SocketContext';
import { User, LiveStream } from './types';
import { api } from './services/api';
import { Navbar } from './components/Navbar';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { Feed } from './components/Feed';
import { Reels } from './pages/Reels';
import { FriendsView } from './components/FriendsView';
import { ProfileView } from './components/ProfileView';
import { AdminDashboard } from './components/AdminDashboard';
import { ChatFloatingWindow } from './components/ChatFloatingWindow';
import { ChatDrawer } from './components/ChatDrawer';
import { CallModal } from './components/CallModal';
import { AuthModal } from './components/AuthModal';
import { GoLiveModal } from './components/GoLiveModal';
import { LiveViewerModal } from './components/LiveViewerModal';
import { SavedPosts } from './components/SavedPosts';
import { InstallAppBanner } from './components/InstallAppBanner';
import { Pages } from './pages/Pages';
import { Groups } from './pages/Groups';
import { Events } from './pages/Events';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { SplashScreen } from './components/SplashScreen';
import { UpgradePrompt } from './components/UpgradePrompt';
import { CreatePostModal } from './components/CreatePostModal';
import type { AppView } from './components/Navbar';
import { runTopBackAction, useBackButton } from './hooks/useBackButton';
import { EchatV2App } from './components/EchatV2App';
import { EchatV2Boundary } from './components/EchatV2Boundary';
import { useEchatTheme } from './hooks/useEchatTheme';

const classicRoutes: Record<string, AppView> = { '/home':'feed','/feed':'feed','/reels':'reels','/friends':'friends','/messages':'feed','/profile':'profile','/admin':'admin','/live':'feed','/go-live':'feed','/pages':'pages','/groups':'groups','/events':'events','/saved':'saved','/settings':'settings','/dashboard':'dashboard' };

export function MainApp() {
  const { user, isDeveloper, isLoading, activePage, switchIdentity } = useAuth();
  useEchatTheme();
  const canAdmin = Boolean(user && (user.role === 'admin' || user.role === 'super_admin' || isDeveloper || (user as User & {isAdmin?:boolean}).isAdmin));
  const { onLiveStarted, onLiveStopped, onLiveStreamUpdated } = useSocket();
  const [splashElapsed, setSplashElapsed] = useState(false);
  const [splashHidden, setSplashHidden] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setSplashElapsed(true), 2000); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { if (!splashElapsed || isLoading) return; const timer = window.setTimeout(() => setSplashHidden(true), 500); return () => window.clearTimeout(timer); }, [splashElapsed, isLoading]);

  const [currentView, setCurrentView] = useState<AppView>('feed');
  const [isV2Route, setIsV2Route] = useState(() => window.location.pathname.startsWith('/v2/'));
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [activeChatPartner, setActiveChatPartner] = useState<User | null>(null);
  const [isMessengerDrawerOpen, setIsMessengerDrawerOpen] = useState(false);
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [showBackToast, setShowBackToast] = useState(false);
  const currentViewRef = useRef(currentView);
  const previousViewRef = useRef<AppView>('feed');
  const lastHomeBackRef = useRef(0);
  const backToastTimer = useRef<number | null>(null);
  const initialAuthResolved = useRef(false);
  const previousLoggedIn = useRef(false);
  const handleProfileMenuChange = useCallback(() => {}, []);
  currentViewRef.current = currentView;
  useEffect(() => {
    const syncRoute = () => {
      const path = window.location.pathname;
      if (path.startsWith('/v2/')) { setIsV2Route(true); return; }
      setIsV2Route(false);
      if (path === '/market') {
        window.history.replaceState({ echatV2: true }, '', `/v2/market${window.location.search}`);
        setIsV2Route(true);
        return;
      }
      if (path === '/' || path.startsWith('/classic')) {
        window.history.replaceState({ echatApp: true, tab: 'feed' }, '', `/home${window.location.search}`);
        setCurrentView('feed');
        return;
      }
      const route = path.startsWith('/admin/') ? 'admin' : path.startsWith('/live/') ? 'feed' : classicRoutes[path];
      if (route) {
        if (route === 'admin' && !isLoading && !canAdmin) {
          window.history.replaceState({ echatApp: true, tab: 'feed' }, '', '/home');
          setCurrentView('feed');
          return;
        }
        setCurrentView(route);
        if (route === 'profile') setProfileUserId(user?.id || null);
        if (path === '/messages') setIsMessengerDrawerOpen(true);
        if (path === '/live' || path === '/go-live') setIsGoLiveOpen(true);
        if (path.startsWith('/live/')) {
          const streamId = decodeURIComponent(path.slice('/live/'.length));
          void api.getCurrentLive().then(result => {
            if (result.live?.id === streamId) setActiveViewerStream(result.live);
          }).catch(() => {});
        }
      }
    };
    syncRoute();
    window.addEventListener('echat:navigate', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => { window.removeEventListener('echat:navigate', syncRoute); window.removeEventListener('popstate', syncRoute); };
  }, [user?.id, canAdmin, isLoading]);
  useBackButton(Boolean(activeChatPartner), () => setActiveChatPartner(null), 'chat-conversation');
  useEffect(() => {
    if (isLoading) return;
    if (initialAuthResolved.current && user && !previousLoggedIn.current && (window.location.pathname === '/' || window.location.pathname === '/v2/home')) {
      const target = window.location.pathname === '/v2/home' ? '/v2/home' : '/home';
      const goV2 = target === '/v2/home';
      window.history.replaceState({ [goV2 ? 'echatV2' : 'echatApp']: true }, '', target);
      setIsV2Route(goV2);
      setCurrentView('feed');
    }
    previousLoggedIn.current = Boolean(user);
    initialAuthResolved.current = true;
  }, [isLoading, user?.id]);

  // Live streaming states
  const [currentLiveStream, setCurrentLiveStream] = useState<LiveStream | null>(null);
  const [isGoLiveOpen, setIsGoLiveOpen] = useState(false);
  const [activeViewerStream, setActiveViewerStream] = useState<LiveStream | null>(null);

  // Only authenticated administrators can access the administration console.
  useEffect(() => {
    if (!isLoading && currentView === 'admin' && !canAdmin) {
      setCurrentView('feed');
      window.history.replaceState({ echatApp: true, tab: 'feed' }, '', '/home');
    }
  }, [currentView, canAdmin, isLoading]);

  // Load and listen for active live streams
  useEffect(() => {
    const refreshLive = () => api.getCurrentLive().then(res => {
      setCurrentLiveStream(res.live);
      setActiveViewerStream(current => current && res.live?.id === current.id ? res.live : current && !res.live ? null : current);
    }).catch(() => {});
    refreshLive();
    const refreshTimer = window.setInterval(refreshLive, 12000);

    const unsubStart = onLiveStarted((stream) => {
      setCurrentLiveStream(stream);
    });

    const unsubStop = onLiveStopped((streamId) => {
      setCurrentLiveStream(null);
      setActiveViewerStream(prev => prev?.id === streamId ? null : prev);
    });

    const unsubUpdate = onLiveStreamUpdated((stream) => {
      setCurrentLiveStream(stream);
      setActiveViewerStream(prev => prev?.id === stream.id ? stream : prev);
    });

    return () => {
      window.clearInterval(refreshTimer);
      unsubStart();
      unsubStop();
      unsubUpdate();
    };
  }, [onLiveStarted, onLiveStopped, onLiveStreamUpdated]);

  const handleNavigate = (
    view: AppView,
    targetProfileId?: string,
    targetPostId?: string
  ) => {
    if (view === 'admin' && !canAdmin) return;
    if (view !== currentView) previousViewRef.current = currentView;
    const routeByView:Record<AppView,string>={feed:'/home',reels:'/reels',friends:'/friends',admin:'/admin',profile:'/profile',pages:'/pages',groups:'/groups',events:'/events',settings:'/settings',saved:'/saved',dashboard:'/dashboard'};
    window.history.pushState({ echatApp: true, tab: view, profileId: targetProfileId || null }, '', `${routeByView[view]}${window.location.search}`);
    setActiveChatPartner(null);
    setIsMessengerDrawerOpen(false);
    setIsGoLiveOpen(false);
    setActiveViewerStream(null);
    setCurrentView(view);
    if (view === 'profile') {
      setProfileUserId(targetProfileId || user?.id || null);
    }
    if (targetPostId) {
      setTimeout(() => {
        const el = document.getElementById(`post-${targetPostId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-4', 'ring-blue-500/70', 'ring-offset-2', 'shadow-lg');
          setTimeout(() => {
            el.classList.remove('ring-4', 'ring-blue-500/70', 'ring-offset-2', 'shadow-lg');
          }, 4000);
        }
      }, 350);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (!window.history.state?.echatApp) window.history.pushState({ echatApp: true, tab: currentViewRef.current }, '', `${window.location.pathname}${window.location.search}`);
    const handlePopState = () => {
      if (window.location.pathname.startsWith('/v2')) return;
      if (runTopBackAction()) {
        window.history.pushState({ echatApp: true, tab: currentViewRef.current }, '', `${window.location.pathname}${window.location.search}`);
        return;
      }
      const view = currentViewRef.current;
      if (view === 'profile' && profileUserId && profileUserId !== user?.id && previousViewRef.current !== 'profile') {
        const previous = previousViewRef.current;
        setProfileUserId(null);
        setCurrentView(previous);
        currentViewRef.current = previous;
        window.history.pushState({ echatApp: true, tab: previous }, '', `${window.location.pathname}${window.location.search}`);
        return;
      }
      if (view !== 'feed') {
        setProfileUserId(null);
        setCurrentView('feed');
        currentViewRef.current = 'feed';
        previousViewRef.current = 'feed';
        window.history.pushState({ echatApp: true, tab: 'feed' }, '', `${window.location.pathname}${window.location.search}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const now = Date.now();
      if (now - lastHomeBackRef.current < 2000) return;
      lastHomeBackRef.current = now;
      setShowBackToast(true);
      if (backToastTimer.current) window.clearTimeout(backToastTimer.current);
      backToastTimer.current = window.setTimeout(() => setShowBackToast(false), 2000);
      window.history.pushState({ echatApp: true, tab: 'feed' }, '', `${window.location.pathname}${window.location.search}`);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (backToastTimer.current) window.clearTimeout(backToastTimer.current);
    };
  }, [profileUserId, user?.id]);

  // Someone opened a shared link like https://your-site/?post=post_abc123
  useEffect(() => {
    if (!user) return;
    const postId = new URLSearchParams(window.location.search).get('post');
    if (!postId) return;
    window.history.replaceState({ echatApp: true, tab: 'feed' }, '', window.location.pathname);
    const timer = setTimeout(() => handleNavigate('feed', undefined, postId), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleOpenChat = (partner: User) => {
    setActiveChatPartner(partner);
  };
  const closeGoLive = () => {
    setIsGoLiveOpen(false);
    if (window.location.pathname === '/live' || window.location.pathname.startsWith('/live/') || window.location.pathname === '/go-live') {
      window.history.replaceState({ echatApp: true, tab: 'feed' }, '', '/home');
      window.dispatchEvent(new Event('echat:navigate'));
    }
  };

  if (!splashHidden) return <SplashScreen leaving={splashElapsed && !isLoading} />;

  if (isLoading) {
    const checkingLiveLogin = ['/live', '/go-live'].includes(window.location.pathname);
    return (
      <div className="min-h-screen bg-[#F0F2F5] flex flex-col items-center justify-center text-slate-500">
        <div className="w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin mb-4" />
        <h2 className="text-xl font-bold text-slate-800">{checkingLiveLogin ? 'Checking login…' : 'Loading EchatSL...'}</h2>
        <p className="text-xs text-slate-400 mt-1">{checkingLiveLogin ? 'Waiting for Firebase sign-in to finish' : 'Connecting to real-time socket engine'}</p>
      </div>
    );
  }

  if (!user) {
    if (['/live', '/go-live'].includes(window.location.pathname)) return <GoLiveModal isOpen onClose={closeGoLive} />;
    return <AuthModal isOpen={true} />;
  }

  return (
    <div className="echat-classic min-h-screen bg-[#F0F2F5] flex flex-col text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <InstallAppBanner />
      {splashHidden && <UpgradePrompt />}

      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        onOpenMessenger={() => setIsMessengerDrawerOpen(true)}
        onOpenCreate={() => setIsCreatePostOpen(true)}
        onOpenGoLive={() => setIsGoLiveOpen(true)}
        onProfileMenuChange={handleProfileMenuChange}
      />

      {activePage && <div className="mx-auto w-full max-w-7xl px-4 pt-2"><div className="flex items-center justify-between rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white">You are posting as {activePage.name}<button onClick={() => switchIdentity(null)} className="underline">Switch back to Personal</button></div></div>}

      {/* Main Layout Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-4 py-4 pb-20 lg:pb-4 flex gap-4 sm:gap-6 justify-center">
        {/* Left Sidebar (Desktop) */}
        <LeftSidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          onOpenGoLive={() => setIsGoLiveOpen(true)}
        />

        {/* Central Stage */}
        <main className={`box-border w-full min-w-0 flex-1 px-1 sm:px-0 ${currentView === 'dashboard' ? 'max-w-5xl' : currentView === 'feed' ? 'max-w-[680px]' : 'max-w-3xl'}`}>
          {isV2Route ? <EchatV2Boundary><EchatV2App embedded /></EchatV2Boundary> : currentView === 'feed' && (
            <Feed
              onOpenChat={handleOpenChat}
              onViewProfile={(uid) => handleNavigate('profile', uid)}
              onOpenGoLive={() => setIsGoLiveOpen(true)}
              onWatchLive={(stream) => setActiveViewerStream(stream)}
              liveStream={currentLiveStream}
            />
          )}

          {currentView === 'reels' && <Reels onViewProfile={uid => handleNavigate('profile', uid)} />}

          {currentView === 'friends' && (
            <FriendsView
              onOpenChat={handleOpenChat}
              onViewProfile={(uid) => handleNavigate('profile', uid)}
            />
          )}

          {currentView === 'profile' && profileUserId && (
            <ProfileView
              userId={profileUserId}
              onOpenChat={handleOpenChat}
              onViewProfile={(uid) => handleNavigate('profile', uid)}
            />
          )}

          {currentView === 'pages' && (
            <Pages onNavigateBack={() => handleNavigate('feed')} onOpenChat={handleOpenChat} />
          )}

          {currentView === 'groups' && <Groups />}

          {currentView === 'events' && <Events />}

          {currentView === 'dashboard' && <Dashboard />}

          {currentView === 'settings' && (
            <Settings onNavigateHome={() => handleNavigate('feed')} />
          )}

          {currentView === 'saved' && (
            <SavedPosts onViewProfile={(uid) => handleNavigate('profile', uid)} />
          )}

          {currentView === 'admin' && canAdmin && (
            <AdminDashboard
              onViewProfile={(uid) => handleNavigate('profile', uid)}
            />
          )}
        </main>

        {/* Right Contacts Sidebar (Desktop XL) */}
        {currentView !== 'dashboard' && <div className="hidden xl:block"><RightSidebar onOpenChat={handleOpenChat} onViewProfile={uid => handleNavigate('profile', uid)} /></div>}
      </div>

      {/* Floating Messenger Window */}
      {activeChatPartner && (
        <ChatFloatingWindow
          partner={activeChatPartner}
          onClose={() => setActiveChatPartner(null)}
        />
      )}

      {/* Slide-out Messenger Drawer */}
      <ChatDrawer
        isOpen={isMessengerDrawerOpen}
        onClose={() => setIsMessengerDrawerOpen(false)}
        onSelectUser={handleOpenChat}
      />
      <CreatePostModal isOpen={isCreatePostOpen} onClose={() => setIsCreatePostOpen(false)} onPostCreated={() => { setIsCreatePostOpen(false); handleNavigate('feed'); }} />

      {showBackToast && <div role="status" className="fixed bottom-6 left-1/2 z-[150] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-xl">Press back again to exit</div>}

      {/* WebRTC Video / Audio Call Modal */}
      <CallModal />

      {/* Go Live Studio Modal */}
      <GoLiveModal
        isOpen={isGoLiveOpen}
        onClose={closeGoLive}
        onStreamStarted={(stream) => {
          setCurrentLiveStream(stream);
        }}
        onStreamEnded={() => {
          setCurrentLiveStream(null);
        }}
      />

      {/* Live Stream Audience Viewer Modal */}
      {activeViewerStream && (
        <LiveViewerModal
          stream={activeViewerStream}
          onClose={() => {
            setActiveViewerStream(null);
            if (window.location.pathname.startsWith('/live/')) {
              window.history.replaceState({ echatApp: true, tab: 'feed' }, '', '/home');
              window.dispatchEvent(new Event('echat:navigate'));
            }
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <MainApp />
      </SocketProvider>
    </AuthProvider>
  );
}
