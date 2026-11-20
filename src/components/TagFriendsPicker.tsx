import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import { initialsAvatar } from '../utils/avatar';

const MAX_TAGS = 20;

interface TagFriendsPickerProps {
  selected: User[];
  onChange: (users: User[]) => void;
  onClose: () => void;
}

/** Pick friends to tag in a post. Only your own friends are listed. */
export const TagFriendsPicker: React.FC<TagFriendsPickerProps> = ({ selected, onChange, onClose }) => {
  const { user } = useAuth();
  const [friends, setFriends] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getUsers().then(all => {
      if (cancelled) return;
      const mine = new Set(user?.friends ?? []);
      setFriends(all.filter(u => mine.has(u.id)));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? friends.filter(f => f.name.toLowerCase().includes(q)) : friends;
  }, [friends, query]);

  const toggle = (friend: User) => {
    const isOn = selected.some(s => s.id === friend.id);
    if (isOn) onChange(selected.filter(s => s.id !== friend.id));
    else if (selected.length < MAX_TAGS) onChange([...selected, friend]);
  };

  return (
    <div className="border-t border-slate-100 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-slate-700">Tag friends ({selected.length}/{MAX_TAGS})</p>
        <button type="button" onClick={onClose} className="text-xs font-bold text-blue-600 hover:underline">Done</button>
      </div>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search your friends"
          className="w-full pl-8 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
              {s.name}
              <button type="button" onClick={() => toggle(s)} aria-label={`Remove ${s.name}`}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="max-h-44 overflow-y-auto space-y-0.5">
        {loading && <p className="text-xs text-slate-400 py-3 text-center">Loading friends...</p>}
        {!loading && friends.length === 0 && (
          <p className="text-xs text-slate-500 py-3 text-center">You have no friends to tag yet. Add friends first.</p>
        )}
        {!loading && friends.length > 0 && shown.length === 0 && (
          <p className="text-xs text-slate-500 py-3 text-center">No friends match "{query}".</p>
        )}
        {shown.map(f => {
          const on = selected.some(s => s.id === f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f)}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-white transition text-left"
            >
              <img src={f.avatar || initialsAvatar(f.name)} alt="" className="w-8 h-8 rounded-full object-cover" />
              <span className="flex-1 text-sm font-semibold text-slate-800 truncate">{f.name}</span>
              <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                {on && <Check size={12} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
