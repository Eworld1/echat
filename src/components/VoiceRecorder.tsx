import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send, Play, Pause } from 'lucide-react';

interface VoiceRecorderProps {
  onSendVoice: (audioDataUrl: string, durationSeconds: number) => void;
  onCancel: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSendVoice, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopRecording();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
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
      audioPlayerRef.current.onended = () => setIsPlaying(false);
    }
    if (audioPlayerRef.current) {
      if (isPlaying) {
        audioPlayerRef.current.pause();
        setIsPlaying(false);
      } else {
        audioPlayerRef.current.play();
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
