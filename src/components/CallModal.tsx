import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { 
  Phone, 
  PhoneOff, 
  Video, 
  Mic, 
  MicOff, 
  VideoOff, 
  Maximize2, 
  Minimize2, 
  SwitchCamera
} from 'lucide-react';

const CallModalView: React.FC = () => {
  const { 
    activeCall, 
    incomingCall, 
    acceptCall, 
    rejectCall, 
    endCall, 
    simulatePartnerAnswer, 
    localStreamRef, 
    remoteStream, 
    peerConnectionRef 
  } = useSocket();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [ringingSeconds, setRingingSeconds] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Call duration counter
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (activeCall?.status === 'connected') {
      interval = setInterval(() => setCallDuration(p => p + 1), 1000);
    } else {
      setCallDuration(0);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [activeCall?.status]);

  // Outgoing ringing duration counter
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (activeCall?.status === 'calling' || activeCall?.status === 'ringing') {
      interval = setInterval(() => setRingingSeconds(p => p + 1), 1000);
    } else {
      setRingingSeconds(0);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [activeCall?.status]);

  // Attach and play local video stream
  const attachLocalStream = useCallback(() => {
    const el = localVideoRef.current;
    const stream = localStreamRef?.current;
    if (el && stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.muted = true;
      el.play().catch(() => {});
    }
  }, [localStreamRef]);

  useEffect(() => {
    attachLocalStream();
  }, [attachLocalStream, activeCall?.status, isMinimized]);

  // Attach and play remote video & audio streams with full unmute guarantee
  const attachRemoteStream = useCallback(() => {
    if (!remoteStream) return;

    // Ensure remote tracks are unmuted and enabled
    remoteStream.getAudioTracks().forEach((t: MediaStreamTrack) => {
      t.enabled = true;
    });
    remoteStream.getVideoTracks().forEach((t: MediaStreamTrack) => {
      t.enabled = true;
    });

    if (remoteVideoRef.current) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      // Video element is muted on purpose: sound comes from the one <audio> element.
      remoteVideoRef.current.muted = true;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  useEffect(() => {
    attachRemoteStream();
  }, [attachRemoteStream, activeCall?.status, isMinimized]);

  // Control: Toggle Microphone (Mute / Unmute)
  const toggleMic = () => {
    const stream = localStreamRef?.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMicMuted(!track.enabled);
    }
  };

  // Control: Toggle Video (Camera On / Off)
  const toggleVideo = () => {
    const stream = localStreamRef?.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsVideoDisabled(!track.enabled);
    }
  };

  // Control: Switch Camera (Front / Back on mobile/tablets or between webcams)
  const switchCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextMode } },
        audio: !isMicMuted
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack && localStreamRef?.current) {
        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStreamRef.current.addTrack(newVideoTrack);

        // Replace track in peer connection senders
        if (peerConnectionRef?.current) {
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(newVideoTrack).catch(() => {});
          }
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
      }
    } catch (err) {
      console.warn('Switch camera error:', err);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // 1. Incoming Call Ringing Screen
  if (incomingCall) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center border border-slate-100 animate-in zoom-in-95 duration-200">
          <div className="relative inline-block mb-5">
            <img 
              src={incomingCall.callerAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'} 
              alt={incomingCall.callerName} 
              className="w-24 h-24 rounded-full mx-auto object-cover border-4 border-blue-600 shadow-md ring-4 ring-blue-100" 
            />
            <span className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
              {incomingCall.callType === 'video' ? <Video size={12} className="text-white" /> : <Phone size={12} className="text-white" />}
            </span>
          </div>
          <h3 className="text-xl font-bold text-slate-900">{incomingCall.callerName}</h3>
          <p className="text-sm font-medium text-blue-600 mt-1 animate-pulse">
            Incoming {incomingCall.callType === 'video' ? 'Video' : 'Audio'} Call...
          </p>
          <div className="flex items-center gap-8 mt-8 justify-center">
            <button 
              onClick={rejectCall} 
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition active:scale-95" 
              title="Decline"
            >
              <PhoneOff size={24} />
            </button>
            <button 
              onClick={acceptCall} 
              className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg animate-bounce transition active:scale-95" 
              title="Answer"
            >
              <Phone size={24} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Active Call Window (Minimized & Expanded)
  if (activeCall) {
    if (isMinimized) {
      return (
        <div className="fixed bottom-6 right-6 z-[9999] bg-slate-900 text-white rounded-2xl p-3 shadow-2xl flex items-center gap-3 border border-slate-700 animate-in slide-in-from-bottom-4">
          <img 
            src={activeCall.partnerAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'} 
            className="w-10 h-10 rounded-full object-cover border border-slate-600" 
            alt={activeCall.partnerName} 
          />
          <div>
            <p className="text-sm font-bold truncate max-w-[120px]">{activeCall.partnerName}</p>
            <p className="text-xs text-emerald-400 font-mono">
              {activeCall.status === 'connected' ? formatTime(callDuration) : 'Calling...'}
            </p>
          </div>
          <button 
            onClick={() => setIsMinimized(false)} 
            className="p-2 text-slate-300 hover:text-white rounded-full hover:bg-slate-800 transition" 
            title="Maximize"
          >
            <Maximize2 size={16} />
          </button>
          <button 
            onClick={endCall} 
            className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-full transition" 
            title="End Call"
          >
            <PhoneOff size={16} />
          </button>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 animate-in fade-in">
        <div className="relative bg-slate-950 rounded-3xl w-full max-w-4xl h-[84vh] shadow-2xl overflow-hidden flex flex-col border border-slate-800">
          
          {/* Header Bar */}
          <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full text-white pointer-events-auto border border-white/10 shadow-lg">
              <img 
                src={activeCall.partnerAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'} 
                className="w-8 h-8 rounded-full object-cover border border-white/20" 
                alt={activeCall.partnerName} 
              />
              <div>
                <h4 className="text-sm font-semibold">{activeCall.partnerName}</h4>
                <p className="text-xs text-emerald-400 font-mono">
                  {activeCall.status === 'connected' ? `Connected • ${formatTime(callDuration)}` : 'Calling...'}
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsMinimized(true)} 
              className="p-2.5 rounded-full bg-black/60 backdrop-blur-md text-white hover:bg-black/80 pointer-events-auto border border-white/10 shadow-lg transition" 
              title="Minimize"
            >
              <Minimize2 size={18} />
            </button>
          </div>

          {/* Main Video & Audio Area */}
          <div className="flex-1 relative bg-slate-900 flex items-center justify-center overflow-hidden">
            {activeCall.callType === 'video' ? (
              <>
                {/* Full Screen Remote Video */}
                {remoteStream && remoteStream.getVideoTracks().length > 0 ? (
                  <video 
                    ref={(el) => {
                      remoteVideoRef.current = el;
                      if (el && remoteStream && el.srcObject !== remoteStream) {
                        el.srcObject = remoteStream;
                        el.muted = true;
                        el.play().catch(() => {});
                      }
                    }} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="flex flex-col items-center text-center p-6">
                    <div className="relative">
                      <img 
                        src={activeCall.partnerAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'} 
                        className="w-28 h-28 rounded-full object-cover border-4 border-slate-700 shadow-xl" 
                        alt={activeCall.partnerName} 
                      />
                      <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-blue-500 border-2 border-slate-900 flex items-center justify-center">
                        <Video size={12} className="text-white" />
                      </span>
                    </div>
                    <p className="text-white font-medium mt-5 text-base">
                      {activeCall.status === 'connected' ? 'Video connecting...' : 'Waiting for answer...'}
                    </p>
                    {activeCall.status !== 'connected' && (
                      <p className="text-xs text-slate-400 mt-1">Connecting peer-to-peer via WebRTC...</p>
                    )}
                    {ringingSeconds >= 2 && activeCall.status !== 'connected' && (
                      <button 
                        onClick={simulatePartnerAnswer} 
                        className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-full shadow-lg transition"
                      >
                        Answer as {activeCall.partnerName} (Test)
                      </button>
                    )}
                  </div>
                )}

                {/* Small Local Video PiP */}
                <div className="absolute bottom-6 right-6 w-36 h-48 sm:w-44 sm:h-56 rounded-2xl overflow-hidden border-2 border-white/20 bg-black shadow-2xl z-20 transition">
                  <video 
                    ref={(el) => {
                      localVideoRef.current = el;
                      if (el && localStreamRef?.current && el.srcObject !== localStreamRef.current) {
                        el.srcObject = localStreamRef.current;
                        el.play().catch(() => {});
                      }
                    }} 
                    autoPlay 
                    playsInline 
                    muted={true} 
                    className="w-full h-full object-cover scale-x-[-1]" 
                  />
                  {isVideoDisabled && (
                    <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-white text-xs">
                      <VideoOff size={20} className="text-slate-400 mb-1" />
                      <span>Camera Off</span>
                    </div>
                  )}
                </div>

              </>
            ) : (
              /* Audio Only Call Screen */
              <div className="flex flex-col items-center text-center p-6">
                <div className="relative">
                  <img 
                    src={activeCall.partnerAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'} 
                    className="w-32 h-32 rounded-full object-cover border-4 border-emerald-500 shadow-xl" 
                    alt={activeCall.partnerName} 
                  />
                  <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center">
                    <Phone size={16} className="text-white" />
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-white mt-6">{activeCall.partnerName}</h3>
                <p className="text-emerald-400 font-mono mt-1 text-sm font-semibold">
                  {activeCall.status === 'connected' ? `In Call (${formatTime(callDuration)})` : 'Ringing...'}
                </p>
                

                {activeCall.status === 'connected' ? (
                  <div className="flex items-center gap-1.5 mt-8">
                    <span className="w-2 h-6 bg-emerald-500 rounded-full animate-bounce" />
                    <span className="w-2 h-10 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-8 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.3s]" />
                    <span className="w-2 h-12 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.45s]" />
                    <span className="w-2 h-5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.6s]" />
                  </div>
                ) : (
                  ringingSeconds >= 2 && (
                    <button 
                      onClick={simulatePartnerAnswer} 
                      className="mt-6 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-full shadow-lg transition"
                    >
                      Answer as {activeCall.partnerName} (Test)
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* Controls Bar: Mute, Video Off, Switch Camera, End Call */}
          <div className="p-5 bg-slate-950/95 border-t border-slate-800 flex items-center justify-center gap-4 z-30">
            <button 
              onClick={toggleMic} 
              className={`p-4 rounded-full transition shadow-md active:scale-95 ${
                isMicMuted ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-slate-800 text-white hover:bg-slate-700'
              }`}
              title={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {isMicMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {activeCall.callType === 'video' && (
              <>
                <button 
                  onClick={toggleVideo} 
                  className={`p-4 rounded-full transition shadow-md active:scale-95 ${
                    isVideoDisabled ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-slate-800 text-white hover:bg-slate-700'
                  }`}
                  title={isVideoDisabled ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {isVideoDisabled ? <VideoOff size={20} /> : <Video size={20} />}
                </button>

                <button 
                  onClick={switchCamera} 
                  className="p-4 rounded-full bg-slate-800 text-white hover:bg-slate-700 transition shadow-md active:scale-95"
                  title="Switch Camera"
                >
                  <SwitchCamera size={20} />
                </button>
              </>
            )}

            <button 
              onClick={endCall} 
              className="px-6 py-4 rounded-full bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center gap-2 shadow-lg transition active:scale-95"
              title="End Call"
            >
              <PhoneOff size={20} />
              <span>End Call</span>
            </button>
          </div>

        </div>
      </div>
    );
  }

  return null;
};

/**
 * Owns the single, always-mounted remote <audio> element so call sound never drops
 * when the UI switches between ringing / active / minimized views.
 */
export const CallModal: React.FC = () => {
  const { remoteStream, activeCall } = useSocket();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!remoteStream) {
      el.srcObject = null;
      return;
    }
    remoteStream.getAudioTracks().forEach((t: MediaStreamTrack) => { t.enabled = true; });
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream;
    el.muted = false;
    el.volume = 1;
    el.play().catch(() => {
      // Autoplay blocked: retry on the next user gesture (tap/click anywhere).
      const resume = () => { el.play().catch(() => {}); };
      window.addEventListener('pointerdown', resume, { once: true });
    });
  }, [remoteStream, activeCall?.status]);

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline />
      <CallModalView />
    </>
  );
};
