import React from 'react';
import { Mic } from 'lucide-react';
import { describeActivity, type ChatActivity } from '../services/chatActivity';

/** "Moses is typing" + 3 bouncing dots, or "Moses is recording a voice message 🎤" with a pulsing mic. */
export const ChatActivityIndicator: React.FC<{ activity: ChatActivity[]; isGroup?: boolean; className?: string }> = ({ activity, isGroup = false, className = '' }) => {
  const info = describeActivity(activity, isGroup);
  return (
    <div aria-live="polite" className={`overflow-hidden transition-[max-height,opacity] duration-200 ${info ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0'} ${className}`}>
      {info && (
        <div className={`flex items-center gap-2 px-4 py-1.5 text-[13px] font-semibold ${info.recording ? 'text-red-600' : 'text-emerald-700'}`}>
          {info.recording
            ? <span className="relative grid h-5 w-5 place-items-center"><span className="absolute inset-0 animate-ping rounded-full bg-red-400/50" /><Mic size={13} className="relative" /></span>
            : null}
          <span className="truncate">{info.text}{info.recording ? '…' : ''}</span>
          {!info.recording && (
            <span className="flex items-end gap-[3px] pb-0.5" aria-hidden="true">
              {[0, 160, 320].map(delay => <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-600" style={{ animationDelay: `${delay}ms`, animationDuration: '900ms' }} />)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
