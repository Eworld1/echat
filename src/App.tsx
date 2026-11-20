import React, { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider, useSocket } from './context/SocketContext';
import { User, LiveStream } from './types';
import { api, invalidateApiReadCache } from './services/api';
import { Navbar } from './components/Navbar';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { ChatDrawer } from './components/ChatDrawer';
import { CallScreen } from './components/CallScreen.tsx';
import { InstallAppBanner } from './components/InstallAppBanner';
import { SplashScreen } from './components/SplashScreen';
// TEMP DISABLED FOR V2 ROLLBACK: import { UpgradePrompt } from './components/UpgradePrompt';
import type { AppView } from './components/Navbar';
import { runTopBackAction, useBackButton } from './hooks/useBackButton';
import { ECHAT_V2_ENABLED } from './config/featureFlags';
// TEMP DISABLED FOR V2 ROLLBACK: import { EchatV2App } from './components/EchatV2App';
// TEMP DISABLED FOR V2 ROLLBACK: import { EchatV2Boundary } from './components/EchatV2Boundary';
import type { V2MarketListing } from './services/v2Market';
import { Film, Home, Menu, MessageSquare, ShoppingBag } from 'lucide-react';

const AuthModal = lazy(() => import('./components/AuthModal').then(module => ({ default: module.AuthModal })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then(module => ({ default: module.AdminDashboard })));
const ChatFloatingWindow = lazy(() => import('./components/ChatFloatingWindow').then(module => ({ default: module.ChatFloatingWindow })));
const Events = lazy(() => import('./pages/Events').then(module => ({ default: module.Events })));
const Feed = lazy(() => import('./components/Feed').then(module => ({ default: module.Feed })));
const FriendsView = lazy(() => import('./components/FriendsView').then(module => ({ default: module.FriendsView })));
const GoLiveModal = lazy(() => import('./components/GoLiveModal').then(module => ({ default: module.GoLiveModal })));
const Groups = lazy(() => import('./pages/Groups').then(module => ({ default: module.Groups })));
const LiveDiscoveryFeed = lazy(() => import('./components/LiveDiscoveryFeed').then(module => ({ default: module.LiveDiscoveryFeed })));
const LiveViewerModal = lazy(() => import('./components/LiveViewerModal').then(module => ({ default: module.LiveViewerModal })));
const MessagesPage = lazy(() => import('./pages/MessagesPage').then(module => ({ default: module.MessagesPage })));
const Pages = lazy(() => import('./pages/Pages').then(module => ({ default: module.Pages })));
const ProfileView = lazy(() => import('./components/ProfileView').then(module => ({ default: module.ProfileView })));
const Reels = lazy(() => import('./pages/Reels').then(module => ({ default: module.Reels })));
const SavedPosts = lazy(() => import('./components/SavedPosts').then(module => ({ default: module.SavedPosts })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(module => ({ default: module.SearchPage })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const V2Market = lazy(() => import('./pages/v2/V2Market').then(module => ({ default: module.V2Market })));
const V2MarketOrders = lazy(() => import('./pages/v2/V2MarketOrders').then(module => ({ default: module.V2MarketOrders })));

const classicRoutes: Record<string, AppView> = { '/home':'feed','/feed':'feed','/reels':'reels','/friends':'friends','/messages':'messages','/profile':'profile','/admin':'admin','/live':'live','/go-live':'live','/pages':'pages','/groups':'groups','/events':'events','/saved':'saved','/settings':'settings','/dashboard':'dashboard','/market':'marketplace','/marketplace':'marketplace','/orders':'orders','/my-orders':'orders','/search':'search' };

export function MainApp() {
  const { user, isDeveloper, isLoading, activePage, switchIdentity } = useAuth();
  const canAdmin = Boolean(user && (user.role === 'admin' || user.role === 'super_admin' || isDeveloper || (user as User & {isAdmin?:boolean}).isAdmin));
  const { onLiveStarted, onLiveStopped, onLiveStreamUpdated } = useSocket();
  const [splashElapsed, setSplashElapsed] = useState(false);
  const [splashHidden, setSplashHidden] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setSplashElapsed(true), 2000); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { if (!splashElapsed || isLoading) return; const timer = window.setTimeout(() => setSplashHidden(true), 500); return () => window.clearTimeout(timer); }, [splashElapsed, isLoading]);

  const [currentView, setCurrentView] = useState<AppView>('feed');
  const [marketRoute, setMarketRoute] = useState<string>('/marketplace');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [activeChatPartner, setActiveChatPartner] = useState<User | null>(null);
  const [activeDmUserId, setActiveDmUserId] = useState<string | null>(null);
  const [isMessengerDrawerOpen, setIsMessengerDrawerOpen] = useState(false);
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
      if ((path.startsWith('/v2/') || path === '/v2') && !ECHAT_V2_ENABLED) {
        // TEMP DISABLED FOR V2 ROLLBACK: restore V2 paths here when ECHAT_V2_ENABLED is turned back on.
        window.history.replaceState({ echatApp: true, tab: 'feed' }, '', `/home${window.location.search}`);
        setCurrentView('feed');
        return;
      }
      if (path === '/go-live') {
        window.history.replaceState({ echatApp: true, tab: 'live' }, '', `/live${window.location.search}`);
      }
      if (path === '/' || path.startsWith('/classic')) {
        window.history.replaceState({ echatApp: true, tab: 'feed' }, '', `/home${window.location.search}`);
        setCurrentView('feed');
        return;
      }
      const route = path.startsWith('/admin/') ? 'admin' : path.startsWith('/live/') ? 'feed' : path.startsWith('/marketplace/') ? 'marketplace' : classicRoutes[path];
      if (route) {
        if (route === 'marketplace') setMarketRoute(path);
        if (route === 'admin' && !isLoading && !canAdmin) {
          window.history.replaceState({ echatApp: true, tab: 'feed' }, '', '/home');
          setCurrentView('feed');
          return;
        }
        setCurrentView(route);
        if (route === 'profile') setProfileUserId(user?.id || null);
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
    if (initialAuthResolved.current && user && !previousLoggedIn.current && (window.location.pathname === '/' || window.location.pathname.startsWith('/v2/'))) {
      window.history.replaceState({ echatApp: true, tab: 'feed' }, '', '/home');
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
    void refreshLive();

    const unsubStart = onLiveStarted((stream) => {
      invalidateApiReadCache('live:current');
      setCurrentLiveStream(stream);
    });

    const unsubStop = onLiveStopped((streamId) => {
      invalidateApiReadCache('live:current');
      setCurrentLiveStream(null);
      setActiveViewerStream(prev => prev?.id === streamId ? null : prev);
    });

    const unsubUpdate = onLiveStreamUpdated((stream) => {
      invalidateApiReadCache('live:current');
      setCurrentLiveStream(stream);
      setActiveViewerStream(prev => prev?.id === stream.id ? stream : prev);
    });

    return () => {
      unsubStart();
      unsubStop();
      unsubUpdate();
    };
  }, [onLiveStarted, onLiveStopped, onLiveStreamUpdated]);

  const handleNavigate = (
    view: AppView,
    targetProfileId?: string,
    targetPostId?: string,
    targetRoute?: string
  ) => {
    if (view === 'admin' && !canAdmin) return;
    if (view !== currentView) previousViewRef.current = currentView;
    const routeByView:Record<AppView,string>={feed:'/home',live:'/live',reels:'/reels',friends:'/friends',messages:'/messages',admin:'/admin',profile:'/profile',pages:'/pages',groups:'/groups',events:'/events',settings:'/settings',saved:'/saved',dashboard:'/dashboard',marketplace:'/marketplace',orders:'/orders',search:'/search'};
    const routePath=view==='marketplace' ? (targetRoute?.startsWith('/marketplace/') ? targetRoute : '/marketplace') : routeByView[view];
    if(view==='marketplace')setMarketRoute(routePath);
    window.history.pushState({ echatApp: true, tab: view, profileId: targetProfileId || null }, '', `${routePath}${window.location.search}`);
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

  const navigateMarket = (route: string) => {
    if (route === '/orders' || route === '/my-orders' || route === '/marketplace/orders') {
      handleNavigate('orders');
      return;
    }
    handleNavigate('marketplace', undefined, undefined, route);
  };
  const handleMobileSidebarNavigate = (view: AppView, targetProfileId?: string) => {
    setMobileMenuOpen(false);
    handleNavigate(view, targetProfileId);
  };

  useEffect(() => {
    if (!window.history.state?.echatApp) window.history.pushState({ echatApp: true, tab: currentViewRef.current }, '', `${window.location.pathname}${window.location.search}`);
    const handlePopState = () => {
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
  const handleOpenDm = (partner: User) => {
    setActiveDmUserId(partner.id);
    handleNavigate('messages');
  };
  const closeGoLive = () => {
    setIsGoLiveOpen(false);
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
    return (
      <Suspense fallback={<SplashScreen />}>
        <AuthModal isOpen={true} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-[#F0F2F5] text-sm font-semibold text-slate-600">Loading Echat…</div>}>
    <div className="echat-classic min-h-screen bg-[#F2F4F7] flex flex-col text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <InstallAppBanner />
      {/* TEMP DISABLED FOR V2 ROLLBACK: {splashHidden && <UpgradePrompt />} */}

      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        onOpenMessenger={() => handleNavigate('messages')}
        onOpenMenu={() => setMobileMenuOpen(true)}
        onProfileMenuChange={handleProfileMenuChange}
      />

      {mobileMenuOpen && <>
        <button type="button" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} className="fixed inset-0 z-[80] bg-black/55 min-[1025px]:hidden" />
        <LeftSidebar currentView={currentView} onNavigate={handleMobileSidebarNavigate} onOpenMessenger={() => { setMobileMenuOpen(false); handleNavigate('messages'); }} mobileDrawer onClose={() => setMobileMenuOpen(false)} />
      </>}

      {activePage && <div className="mx-auto w-full max-w-7xl px-4 pt-2"><div className="flex items-center justify-between rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white">You are posting as {activePage.name}<button onClick={() => switchIdentity(null)} className="underline">Switch back to Personal</button></div></div>}

      {/* Main Layout Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-4 py-4 pb-20 lg:pb-4 flex gap-4 sm:gap-6 justify-center">
        {/* Left Sidebar (Desktop) */}
        <LeftSidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          onOpenMessenger={() => handleNavigate('messages')}
        />

        {/* Central Stage */}
        <main className={`box-border w-full min-w-0 flex-1 px-1 sm:px-0 ${currentView === 'live' ? 'max-w-6xl' : currentView === 'dashboard' || currentView === 'search' ? 'max-w-5xl' : currentView === 'feed' ? 'max-w-[680px]' : 'max-w-3xl'}`}>
          {/* TEMP DISABLED FOR V2 ROLLBACK: V2 route renderer remains in EchatV2App.tsx for reactivation. */}
          {currentView === 'feed' && (
            <Feed
              onOpenChat={handleOpenChat}
              onViewProfile={(uid) => handleNavigate('profile', uid)}
              onOpenGoLive={() => handleNavigate('live')}
            />
          )}

          {currentView === 'search' && <SearchPage onViewProfile={uid => handleNavigate('profile', uid)} onOpenListing={id => navigateMarket(`/marketplace/listing/${id}`)} onNavigate={view => handleNavigate(view)} />}

          {currentView === 'messages' && <MessagesPage initialUserId={activeDmUserId} onViewProfile={uid => handleNavigate('profile', uid)} />}

          {currentView === 'live' && <LiveDiscoveryFeed onBack={() => handleNavigate('feed')} onOpenGoLive={() => setIsGoLiveOpen(true)} onWatchLive={stream => setActiveViewerStream(stream)} legacyStream={currentLiveStream} />}

          {currentView === 'reels' && <Reels onViewProfile={uid => handleNavigate('profile', uid)} />}

          {currentView === 'friends' && (
            <FriendsView
              onOpenChat={handleOpenDm}
              onViewProfile={(uid) => handleNavigate('profile', uid)}
            />
          )}

          {currentView === 'profile' && profileUserId && (
            <ProfileView
              userId={profileUserId}
              onOpenChat={handleOpenDm}
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

          {currentView === 'marketplace' && <V2Market route={marketRoute} onNavigate={navigateMarket} onChat={(_listing: V2MarketListing, partner: User) => handleOpenChat(partner)} />}
          {currentView === 'orders' && <V2MarketOrders onChat={(_listing: V2MarketListing, partner: User) => handleOpenChat(partner)} onShop={() => handleNavigate('marketplace')} />}

          {currentView === 'admin' && canAdmin && (
            <AdminDashboard
              onViewProfile={(uid) => handleNavigate('profile', uid)}
            />
          )}
        </main>

        {/* Right Contacts Sidebar (Desktop XL) */}
        {currentView !== 'dashboard' && currentView !== 'live' && <div className="hidden xl:block"><RightSidebar onOpenChat={handleOpenChat} onViewProfile={uid => handleNavigate('profile', uid)} /></div>}
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(60px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur min-[769px]:hidden">
        <button type="button" onClick={() => handleNavigate('feed')} className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${currentView === 'feed' ? 'text-blue-700' : 'text-slate-600'}`}><Home size={21}/><span>Home</span></button>
        <button type="button" onClick={() => handleNavigate('reels')} className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${currentView === 'reels' ? 'text-blue-700' : 'text-slate-600'}`}><Film size={21}/><span>Reels</span></button>
        <button type="button" onClick={() => navigateMarket('/marketplace')} className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${currentView === 'marketplace' ? 'text-blue-700' : 'text-slate-600'}`}><ShoppingBag size={21}/><span>Marketplace</span></button>
        <button type="button" onClick={() => handleNavigate('messages')} className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${currentView === 'messages' ? 'text-blue-700' : 'text-slate-600'}`}><MessageSquare size={21}/><span>Messages</span></button>
        <button type="button" onClick={() => setMobileMenuOpen(true)} aria-expanded={mobileMenuOpen} className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${mobileMenuOpen ? 'text-blue-700' : 'text-slate-600'}`}><Menu size={21}/><span>Menu</span></button>
      </nav>

      {/* Floating Messenger Window */}
      {activeChatPartner && (
        <ChatFloatingWindow
          partner={activeChatPartner}
          onClose={() => setActiveChatPartner(null)}
        />
      )}

      {/* Slide-out Messenger Drawer */}
      {isMessengerDrawerOpen && <ChatDrawer
          isOpen
          onClose={() => setIsMessengerDrawerOpen(false)}
          onSelectUser={handleOpenChat}
        />}

      {showBackToast && <div role="status" className="fixed bottom-6 left-1/2 z-[150] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-xl">Press back again to exit</div>}

      {/* Shared WebRTC Video / Audio Call Screen */}
      <CallScreen />

      {/* Go Live Studio Modal */}
      {isGoLiveOpen && <GoLiveModal
          isOpen
          onClose={closeGoLive}
          onStreamStarted={(stream) => {
            setCurrentLiveStream(stream);
          }}
          onStreamEnded={() => {
            setCurrentLiveStream(null);
          }}
        />}

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
    </Suspense>
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
