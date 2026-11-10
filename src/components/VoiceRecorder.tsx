import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send, Play, Pause, Volume2 } from 'lucide-react';

interface VoiceRecorderProps {
  onSendVoice: (audioDataUrl: string, durationSeconds: number) => void;
  onCancel: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSendVoice, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackVolume, setPlaybackVolume] = useState(100);
  const [boost, setBoost] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopRecording();
      void audioContextRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 } });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const context: AudioContext = new AudioCtx({ sampleRate: 48000 });
      const input = context.createMediaStreamSource(stream);
      const gain = context.createGain(); gain.gain.value = 2;
      const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -24; compressor.knee.value = 20; compressor.ratio.value = 3; compressor.attack.value = 0.005; compressor.release.value = 0.2;
      const destination = context.createMediaStreamDestination(); input.connect(gain); gain.connect(compressor); compressor.connect(destination);
      audioContextRef.current = context; gainNodeRef.current = gain;
      const mediaRecorder = new MediaRecorder(destination.stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          setRecordedAudioUrl(reader.result as string);
        };
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        destination.stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone not accessible or denied, using simulated audio memo:', err);
      // Fallback simulated voice memo
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleSend = () => {
    if (recordedAudioUrl) {
      onSendVoice(recordedAudioUrl, Math.max(duration, 1));
    } else {
      // Create a short beep data URL
      onSendVoice('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', Math.max(duration, 1));
    }
  };

  const togglePlayback = () => {
    if (!audioPlayerRef.current && recordedAudioUrl) {
      audioPlayerRef.current = new Audio(recordedAudioUrl);
    }
    if (audioPlayerRef.current && gainNodeRef.current && audioContextRef.current) {
      try {
        const element = audioPlayerRef.current;
        if (!(element as any).__echatBoostNode) {
          const source = audioContextRef.current.createMediaElementSource(element);
          source.connect(gainNodeRef.current).connect(audioContextRef.current.destination);
          (element as any).__echatBoostNode = true;
        }
        gainNodeRef.current.gain.value = boost ? 1.8 * playbackVolume / 100 : playbackVolume / 100;
        audioPlayerRef.current.volume = 1;
        void audioContextRef.current.resume();
      } catch { }
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.onended = () => setIsPlaying(false);
      if (isPlaying) {
        audioPlayerRef.current.pause();
        setIsPlaying(false);
      } else {
        audioPlayerRef.current.volume = 1;
        audioPlayerRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  };

  const formatSecs = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainder = sec % 60;
    return `${mins}:${remainder.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 px-3.5 py-2 rounded-2xl w-full animate-in fade-in">
      <button
        onClick={onCancel}
        className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-full transition"
        title="Discard"
      >
        <Trash2 size={16} />
      </button>

      {isRecording ? (
        <div className="flex-1 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
          <span className="text-xs font-semibold text-red-600">Recording voice note...</span>
          <span className="text-xs font-mono font-bold text-slate-700 ml-auto">{formatSecs(duration)}</span>
        </div>
      ) : (
        <div className="flex-1 flex items-center gap-2">
          <button
            onClick={togglePlayback}
            className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <div className="flex items-center gap-1 flex-1">
            <span className="h-2 w-1 bg-blue-400 rounded-full animate-pulse" />
            <span className="h-4 w-1 bg-blue-500 rounded-full animate-pulse [animation-delay:100ms]" />
            <span className="h-6 w-1 bg-blue-600 rounded-full animate-pulse [animation-delay:200ms]" />
            <span className="h-3 w-1 bg-blue-400 rounded-full animate-pulse [animation-delay:150ms]" />
            <span className="h-5 w-1 bg-blue-500 rounded-full animate-pulse [animation-delay:250ms]" />
            <span className="h-2 w-1 bg-blue-400 rounded-full animate-pulse [animation-delay:100ms]" />
          </div>
          <span className="text-xs font-mono font-bold text-slate-700">{formatSecs(duration)}</span>
          <label className="flex items-center gap-1 text-[10px] text-slate-500"><Volume2 size={13} /><input aria-label="Voice note volume" type="range" min="0" max="200" value={playbackVolume} onChange={event => { const volume = Number(event.target.value); setPlaybackVolume(volume); if (gainNodeRef.current) gainNodeRef.current.gain.value = (boost ? 1.8 : 1) * volume / 100; if (audioPlayerRef.current) audioPlayerRef.current.volume = 1; }} className="w-14" /></label>
          <button type="button" onClick={() => { setBoost(value => !value); if (gainNodeRef.current) gainNodeRef.current.gain.value = (!boost ? 1.8 : 1) * playbackVolume / 100; }} className={`rounded px-1.5 py-1 text-[10px] font-bold ${boost ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>Boost</button>
        </div>
      )}

      {isRecording ? (
        <button
          onClick={stopRecording}
          className="p-1.5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 transition"
          title="Stop Recording"
        >
          <Square size={16} className="fill-slate-700" />
        </button>
      ) : (
        <button
          onClick={handleSend}
          className="p-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition"
          title="Send Voice Note"
        >
          <Send size={16} />
        </button>
      )}
    </div>
  );
};
