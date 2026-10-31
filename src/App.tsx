import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider, useSocket } from './context/SocketContext';
import { User, LiveStream } from './types';
import { api } from './services/api';
import { Navbar } from './components/Navbar';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { Feed } from './components/Feed';
import { FriendsView } from './components/FriendsView';
import { ProfileView } from './components/ProfileView';
import { AdminDashboard } from './components/AdminDashboard';
import { ChatFloatingWindow } from './components/ChatFloatingWindow';
import { ChatDrawer } from './components/ChatDrawer';
import { CallModal } from './components/CallModal';
import { AuthModal } from './components/AuthModal';
import { GoLiveModal } from './components/GoLiveModal';
import { LiveViewerModal } from './components/LiveViewerModal';

export function MainApp() {
  const { user, isDeveloper, isLoading } = useAuth();
  const { onLiveStarted, onLiveStopped, onLiveStreamUpdated } = useSocket();

  const [currentView, setCurrentView] = useState<'feed' | 'friends' | 'admin' | 'profile'>('feed');
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [activeChatPartner, setActiveChatPartner] = useState<User | null>(null);
  const [isMessengerDrawerOpen, setIsMessengerDrawerOpen] = useState(false);

  // Live streaming states
  const [currentLiveStream, setCurrentLiveStream] = useState<LiveStream | null>(null);
  const [isGoLiveOpen, setIsGoLiveOpen] = useState(false);
  const [activeViewerStream, setActiveViewerStream] = useState<LiveStream | null>(null);

  // Strict route protection: Normal users can never access admin dashboard
  useEffect(() => {
    if (currentView === 'admin' && !isDeveloper) {
      setCurrentView('feed');
    }
  }, [currentView, isDeveloper]);

  // Load and listen for active live streams
  useEffect(() => {
    api.getCurrentLive().then(res => {
      setCurrentLiveStream(res.live);
    }).catch(() => {});

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
      unsubStart();
      unsubStop();
      unsubUpdate();
    };
  }, [onLiveStarted, onLiveStopped, onLiveStreamUpdated]);

  const handleNavigate = (
    view: 'feed' | 'friends' | 'admin' | 'profile',
    targetProfileId?: string,
    targetPostId?: string
  ) => {
    // Prevent non-developers from opening admin
    if (view === 'admin' && !isDeveloper) {
      setCurrentView('feed');
      return;
    }

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

  const handleOpenChat = (partner: User) => {
    setActiveChatPartner(partner);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F0F2F5] flex flex-col items-center justify-center text-slate-500">
        <div className="w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin mb-4" />
        <h2 className="text-xl font-bold text-slate-800">Loading EchatSL...</h2>
        <p className="text-xs text-slate-400 mt-1">Connecting to real-time socket engine</p>
      </div>
    );
  }

  if (!user) {
    return <AuthModal isOpen={true} />;
  }

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex flex-col text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        onOpenMessenger={() => setIsMessengerDrawerOpen(true)}
      />

      {/* Main Layout Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-4 py-4 flex gap-4 sm:gap-6 justify-center">
        {/* Left Sidebar (Desktop) */}
        <LeftSidebar
          currentView={currentView}
          onNavigate={handleNavigate}
        />

        {/* Central Stage */}
        <main className="flex-1 min-w-0 max-w-3xl">
          {currentView === 'feed' && (
            <Feed
              onOpenChat={handleOpenChat}
              onViewProfile={(uid) => handleNavigate('profile', uid)}
              onOpenGoLive={() => setIsGoLiveOpen(true)}
              onWatchLive={(stream) => setActiveViewerStream(stream)}
              liveStream={currentLiveStream}
            />
          )}

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

          {currentView === 'admin' && isDeveloper && (
            <AdminDashboard
              onViewProfile={(uid) => handleNavigate('profile', uid)}
            />
          )}
        </main>

        {/* Right Contacts Sidebar (Desktop XL) */}
        <RightSidebar onOpenChat={handleOpenChat} />
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

      {/* WebRTC Video / Audio Call Modal */}
      <CallModal />

      {/* Go Live Studio Modal */}
      <GoLiveModal
        isOpen={isGoLiveOpen}
        onClose={() => setIsGoLiveOpen(false)}
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
          onClose={() => setActiveViewerStream(null)}
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