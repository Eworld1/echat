import { initialsAvatar } from '../utils/avatar';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useBackButton } from '../hooks/useBackButton';
import {
  Phone,
  PhoneOff,
  Video,
  Mic,
  MicOff,
  VideoOff,
  Maximize2,
  Minimize2,
  SwitchCamera,
  Volume2,
  VolumeX
} from 'lucide-react';

const CallModalView: React.FC = () => {
  const {
    activeCall,
    incomingCall,
    acceptCall,
    rejectCall,
    endCall,
    localStreamRef,
    remoteStream,
    peerConnectionRef,
    switchCallType,
    speakerEnabled,
    setSpeakerEnabled
  } = useSocket();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraToast, setCameraToast] = useState('');
  const [callControlError, setCallControlError] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  useBackButton(Boolean(activeCall), () => { if (window.confirm('End call?')) void endCall(); }, 'active-call');
  useBackButton(Boolean(incomingCall) && !activeCall, () => { if (window.confirm('Decline incoming call?')) rejectCall(); }, 'incoming-call');

  useEffect(() => {
    if (!activeCall) return;
    const track = localStreamRef.current?.getVideoTracks()[0];
    setIsVideoDisabled(activeCall.callType === 'audio' || !track || !track.enabled);
  }, [activeCall?.callType, activeCall?.id, activeCall?.status, remoteStream, localStreamRef]);

  useEffect(() => {
    const track = localStreamRef?.current?.getAudioTracks()[0];
    if (!track || activeCall?.status !== 'connected') { setMicLevel(0); return; }
    let context: AudioContext | null = null; let frame = 0;
    try {
      context = new AudioContext(); const source = context.createMediaStreamSource(new MediaStream([track])); const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const read = () => { analyser.getByteTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, value) => sum + (value - 128) ** 2, 0) / samples.length); setMicLevel(Math.min(100, Math.round(rms * 3))); frame = requestAnimationFrame(read); };
      void context.resume(); read();
    } catch { }
    return () => { cancelAnimationFrame(frame); void context?.close(); };
  }, [localStreamRef, activeCall?.status]);

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
  const toggleVideo = async () => {
    const stream = localStreamRef?.current;
    const pc = peerConnectionRef?.current;
    if (!stream || !pc) return;
    const sender = pc.getTransceivers().find(item => item.receiver.track.kind === 'video')?.sender || pc.getSenders().find(item => item.track?.kind === 'video') || pc.getSenders().find(item => !item.track);
    if (isVideoDisabled) {
      let track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') {
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false });
        track = camera.getVideoTracks()[0];
        stream.getVideoTracks().forEach(old => { stream.removeTrack(old); old.stop(); });
        stream.addTrack(track);
      }
      if (sender) await sender.replaceTrack(track);
      else pc.addTrack(track, stream);
      track.enabled = true;
      setIsVideoDisabled(false);
    } else {
      if (sender) await sender.replaceTrack(null);
      const track = stream.getVideoTracks()[0];
      if (track) track.enabled = false;
      setIsVideoDisabled(true);
    }
    setCallControlError('');
  };

  // Control: Switch Camera (Front / Back on mobile/tablets or between webcams)
  const switchCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    let newlyOpenedStream: MediaStream | null = null;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      if (cameras.length < 2) {
        setCameraToast('Only one camera found');
        window.setTimeout(() => setCameraToast(''), 1800);
        return;
      }
      const currentTrack = localStreamRef.current?.getVideoTracks()[0];
      const settings = currentTrack?.getSettings();
      const currentId = settings?.deviceId;
      const currentIndex = cameras.findIndex(device => device.deviceId === currentId);
      const currentMode = settings?.facingMode === 'environment' ? 'environment' : settings?.facingMode === 'user' ? 'user' : facingMode;
      const nextMode = currentMode === 'user' ? 'environment' : 'user';
      const preferred = cameras.find(device => nextMode === 'environment' ? /back|rear|environment/i.test(device.label) : /front|user|facetime/i.test(device.label));
      const nextCamera = currentIndex >= 0 ? cameras[(currentIndex + 1) % cameras.length] : preferred || cameras[0];
      newlyOpenedStream = await navigator.mediaDevices.getUserMedia({ video: nextCamera?.deviceId ? { deviceId: { exact: nextCamera.deviceId } } : { facingMode: { ideal: nextMode } }, audio: false });

      const newVideoTrack = newlyOpenedStream.getVideoTracks()[0];
      if (newVideoTrack && localStreamRef?.current) {
        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        const pc = peerConnectionRef.current;
        const sender = pc?.getTransceivers().find(item => item.receiver.track.kind === 'video')?.sender || pc?.getSenders().find((s: RTCRtpSender) => s.track?.kind === 'video') || pc?.getSenders().find(item => !item.track);
        if (!sender) throw new Error('Video sender is unavailable');
        await sender.replaceTrack(newVideoTrack);
        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStreamRef.current.addTrack(newVideoTrack);

        // Replace track in peer connection senders
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => {});
        }
        setFacingMode(nextMode);
        const label = nextCamera?.label || newVideoTrack.label;
        const isBack = /back|rear|environment/i.test(label) || nextMode === 'environment';
        setCameraToast(isBack ? 'Back camera' : 'Front camera');
        window.setTimeout(() => setCameraToast(''), 1800);
      }
    } catch (err) {
      console.warn('Switch camera error:', err);
      newlyOpenedStream?.getTracks().forEach(track => track.stop());
      setCallControlError('Could not switch camera. Check camera permission and try again.');
    }
  };

  const changeCallMode = async () => {
    const pc = peerConnectionRef.current; const stream = localStreamRef.current;
    if (!activeCall || !pc) return;
    if (activeCall.callType === 'video') {
      const sender = pc.getTransceivers().find(item => item.receiver.track.kind === 'video')?.sender || pc.getSenders().find(item => item.track?.kind === 'video');
      if (sender) await sender.replaceTrack(null);
      stream?.getVideoTracks().forEach(track => { track.enabled = false; });
      setIsVideoDisabled(true); switchCallType('audio');
      return;
    }
    const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false });
    const track = camera.getVideoTracks()[0];
    if (!track) return;
    const videoSender = pc.getTransceivers().find(item => item.receiver.track.kind === 'video')?.sender || pc.getSenders().find(item => item.track?.kind === 'video') || pc.getSenders().find(item => !item.track);
    if (stream) { stream.getVideoTracks().forEach(old => { stream.removeTrack(old); old.stop(); }); stream.addTrack(track); }
    else localStreamRef.current = camera;
    if (videoSender) await videoSender.replaceTrack(track); else pc.addTrack(track, localStreamRef.current || camera);
    if (localVideoRef.current && localStreamRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => {}); }
    setIsVideoDisabled(false); setCallControlError(''); switchCallType('video');
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
              src={incomingCall.callerAvatar || initialsAvatar(incomingCall.callerName || '')}
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
            src={activeCall.partnerAvatar || initialsAvatar(activeCall.partnerName || '')}
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
                src={activeCall.partnerAvatar || initialsAvatar(activeCall.partnerName || '')}
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
            {activeCall.callType === 'video' && Boolean(remoteStream?.getVideoTracks().some(track => !track.muted && track.readyState === 'live')) ? (
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
                        src={activeCall.partnerAvatar || initialsAvatar(activeCall.partnerName || '')}
                        className="w-28 h-28 rounded-full object-cover border-4 border-slate-700 shadow-xl"
                        alt={activeCall.partnerName}
                      />
                      <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-blue-500 border-2 border-slate-900 flex items-center justify-center">
                        <Video size={12} className="text-white" />
                      </span>
                    </div>
                    <p className="text-white font-medium mt-5 text-base">
                      {remoteStream?.getVideoTracks().length && remoteStream.getVideoTracks().every(track => track.muted) ? 'Their camera is off' : activeCall.status === 'connected' ? 'Video connecting...' : 'Waiting for answer...'}
                    </p>
                    {activeCall.status !== 'connected' && (
                      <p className="text-xs text-slate-400 mt-1">Connecting peer-to-peer via WebRTC...</p>
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
                    src={activeCall.partnerAvatar || initialsAvatar(activeCall.partnerName || '')}
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


                {activeCall.status === 'connected' && (
                  <div className="flex items-center gap-1.5 mt-8">
                    <span className="w-2 h-6 bg-emerald-500 rounded-full animate-bounce" />
                    <span className="w-2 h-10 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                    <span className="w-2 h-8 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.3s]" />
                    <span className="w-2 h-12 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.45s]" />
                    <span className="w-2 h-5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.6s]" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controls Bar: Mute, Video Off, Switch Camera, End Call */}
          <div className="p-3 sm:p-5 bg-slate-950/95 border-t border-slate-800 flex flex-wrap items-center justify-center gap-2 sm:gap-4 z-30">
            <div className="absolute left-4 right-4 -mt-20 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-[10px] text-white"><Mic size={12} /><span>Test Mic</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700"><span className="block h-full bg-emerald-400 transition-all" style={{ width: `${micLevel}%` }} /></span></div>
            <button
              onClick={toggleMic}
              className={`p-4 rounded-full transition shadow-md active:scale-95 ${
                isMicMuted ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-slate-800 text-white hover:bg-slate-700'
              }`}
              title={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {isMicMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <button type="button" onClick={()=>setSpeakerEnabled(!speakerEnabled)} className={`p-4 rounded-full transition shadow-md active:scale-95 ${speakerEnabled?'bg-slate-800 text-white hover:bg-slate-700':'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`} title={speakerEnabled?'Turn speaker off':'Turn speaker on'} aria-label={speakerEnabled?'Turn speaker off':'Turn speaker on'}>{speakerEnabled?<Volume2 size={20}/>:<VolumeX size={20}/>}</button>

            {activeCall.callType === 'video' && (
              <>
                <button
                  onClick={() => { void toggleVideo().catch(error => { console.warn('Could not toggle call camera:', error); setCallControlError('Could not change camera. Check camera permissions and try again.'); }); }}
                  className={`p-4 rounded-full transition shadow-md active:scale-95 ${
                    isVideoDisabled ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-slate-800 text-white hover:bg-slate-700'
                  }`}
                  title={isVideoDisabled ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {isVideoDisabled ? <Video size={20} /> : <VideoOff size={20} />}
                </button>

                {!isVideoDisabled && <button
                  onClick={switchCamera}
                  className="p-4 rounded-full bg-slate-800 text-white hover:bg-slate-700 transition shadow-md active:scale-95"
                  title="Switch Camera"
                >
                  <SwitchCamera size={20} />
                </button>}
              </>
            )}
            <button onClick={() => { void changeCallMode().catch(error => { console.warn('Could not switch call mode:', error); setCallControlError('Could not switch call mode. Please retry.'); }); }} className="rounded-full bg-slate-800 px-3 py-3 text-xs font-bold text-white hover:bg-slate-700" title={activeCall.callType === 'video' ? 'Switch to audio' : 'Switch to video'}>
              {activeCall.callType === 'video' ? 'Switch to Audio' : 'Switch to Video'}
            </button>
            {callControlError && <span role="status" className="max-w-40 text-center text-[10px] text-rose-300">{callControlError}</span>}
            {cameraToast && <span className="text-xs text-white">{cameraToast}</span>}

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
  const { remoteStream, activeCall, callNotice, clearCallNotice, registerCallAudioElement, speakerEnabled } = useSocket();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    registerCallAudioElement(audioRef.current);
    return () => registerCallAudioElement(null);
  }, [registerCallAudioElement]);

  useEffect(() => {
    if (!callNotice) return;
    const t = setTimeout(clearCallNotice, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callNotice]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!remoteStream) {
      el.srcObject = null;
      return;
    }
    remoteStream.getAudioTracks().forEach((t: MediaStreamTrack) => { t.enabled = true; });
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream;
    el.muted = !speakerEnabled;
    el.volume = speakerEnabled ? 1 : 0;
    el.play().catch(() => {
      // Autoplay blocked: retry on the next user gesture (tap/click anywhere).
      const resume = () => { el.play().catch(() => {}); };
      window.addEventListener('pointerdown', resume, { once: true });
    });
  }, [remoteStream, activeCall?.status, speakerEnabled]);

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline />
      <CallModalView />
      {callNotice && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] max-w-sm w-[calc(100%-2rem)] bg-slate-900 text-white text-sm rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
          role="status"
        >
          <span className="flex-1 leading-snug">{callNotice}</span>
          <button onClick={clearCallNotice} className="text-slate-300 hover:text-white text-lg leading-none" aria-label="Dismiss">×</button>
        </div>
      )}
    </>
  );
};
