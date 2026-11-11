import React, { useEffect, useState } from 'react';
import { Cake, MessageCircle } from 'lucide-react';
import { api } from '../services/api';
import type { User } from '../types';

interface BirthdayEntry { user: User; daysUntil: number; turns?: number; }

interface BirthdayCardProps {
  onViewProfile: (userId: string) => void;
  onSendMessage: (user: User) => void;
}

export const BirthdayCard: React.FC<BirthdayCardProps> = ({ onViewProfile, onSendMessage }) => {
  const [birthdays, setBirthdays] = useState<BirthdayEntry[]>([]);

  useEffect(() => {
    let active = true;
    api.getBirthdays().then(data => { if (active) setBirthdays(data); }).catch(() => { if (active) setBirthdays([]); });
    return () => { active = false; };
  }, []);

  if (!birthdays.length) return null;

  return <section className="mb-5 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-900/60 dark:bg-[#152336]" aria-label="Birthdays">
    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Cake size={18} className="text-amber-500" />Birthdays</h3>
    <div className="space-y-3">
      {birthdays.map(({ user, daysUntil, turns }) => <div key={user.id} className="flex items-center gap-2">
        <button type="button" onClick={() => onViewProfile(user.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <img src={user.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          <span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{daysUntil === 0 ? `Today is ${user.name}’s birthday` : user.name}</span><span className="block text-[11px] text-slate-500">{daysUntil === 0 ? 'Wish them a happy birthday!' : `${turns !== undefined ? `Turns ${turns}` : 'Birthday'} in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`}</span></span>
        </button>
        <button type="button" title="Send birthday message" aria-label={`Send birthday message to ${user.name}`} onClick={() => onSendMessage(user)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"><MessageCircle size={17} /></button>
      </div>)}
    </div>
  </section>;
};
