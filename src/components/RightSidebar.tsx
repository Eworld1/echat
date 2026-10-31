import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Search, Phone, Video, ExternalLink, ShieldCheck } from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';
import { TermsModal } from './TermsModal';

interface RightSidebarProps {
  onOpenChat: (user: User) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ onOpenChat }) => {
  const { user } = useAuth();
  const { onlineUserIds, startCall } = useSocket();
  const [contacts, setContacts] = useState<User[]>([]);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    api.getUsers()
      .then(list => {
        if (!Array.isArray(list)) {
          setContacts([]);
          return;
        }
        const filtered = list.filter(u => u && u.id !== user?.id);
        // Pin developer/official to the very top
        const sorted = filtered.sort((a, b) => {
          const aIsDev = a.isOfficialDeveloper || a.email?.toLowerCase() === 'eldermoses89@gmail.com' ? 1 : 0;
          const bIsDev = b.isOfficialDeveloper || b.email?.toLowerCase() === 'eldermoses89@gmail.com' ? 1 : 0;
          return bIsDev - aIsDev;
        });
        setContacts(sorted);
      })
      .catch(err => {
        console.error('Failed to load users in RightSidebar:', err);
        setContacts([]);
      });
  }, [user?.id]);

  return (
    <aside className="w-64 xl:w-72 flex-shrink-0 hidden xl:block sticky top-18 h-[calc(100vh-5rem)] overflow-y-auto pl-2 select-none">
      
      {/* Sponsored / Featured Box */}
      <div className="mb-6 pb-4 border-b border-slate-200/80">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Sponsored
        </h4>
        <div className="flex items-center gap-3 p-2 hover:bg-slate-200/50 rounded-2xl cursor-pointer transition group">
          <img
            src="https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=300&q=80"
            alt="Ad"
            className="w-20 h-20 rounded-xl object-cover shadow-2xs group-hover:opacity-90"
          />
          <div>
            <p className="text-xs font-bold text-slate-800 leading-snug">
              Build Next-Gen Web Apps with Vite 6
            </p>
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              vitejs.dev <ExternalLink size={10} />
            </p>
          </div>
        </div>
      </div>

      {/* Contacts List */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Contacts ({contacts.length})
          </h4>
          <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            {onlineUserIds.length} Active
          </span>
        </div>

        <div className="space-y-1">
          {contacts.length === 0 ? (
            <div className="p-4 text-center text-slate-400 bg-white/50 rounded-2xl border border-slate-100">
              <p className="text-xs font-medium">No contacts yet</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Friends you add will appear here</p>
            </div>
          ) : (
            contacts.map((contact) => {
              const isOnline = onlineUserIds.includes(contact.id);
              const isDev = contact.isOfficialDeveloper || contact.email?.toLowerCase() === 'eldermoses89@gmail.com';
              const displayName = isDev ? 'EChat Official - Developer' : contact.name;

              return (
                <div
                  key={contact.id}
                  onClick={() => onOpenChat(contact)}
                  className={`w-full p-2 rounded-2xl flex items-center justify-between transition cursor-pointer group ${
                    isDev ? 'bg-purple-50/60 hover:bg-purple-100/70 border border-purple-100/60' : 'hover:bg-slate-200/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <img
                        src={contact.avatar}
                        alt={displayName}
                        className={`w-9 h-9 rounded-full object-cover border ${
                          isDev ? 'border-purple-300 ring-2 ring-purple-400/30' : 'border-slate-200'
                        }`}
                      />
                      {isOnline && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <p className={`text-xs font-bold truncate transition ${
                          isDev ? 'text-purple-950 font-extrabold' : 'text-slate-900 group-hover:text-blue-600'
                        }`}>
                          {displayName}
                        </p>
                        {(contact.isVerified || isDev) && <VerifiedBadge size={13} />}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate">
                        {isDev ? 'Official Developer Account' : (isOnline ? 'Active now' : 'Offline')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startCall(contact.id, displayName, contact.avatar, 'audio');
                      }}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition"
                      title="Audio call"
                    >
                      <Phone size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startCall(contact.id, displayName, contact.avatar, 'video');
                      }}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition"
                      title="Video call"
                    >
                      <Video size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legal & Terms link */}
      <div className="mt-8 pt-4 border-t border-slate-200/70 text-[11px] text-slate-400">
        <button
          onClick={() => setShowTerms(true)}
          className="hover:underline hover:text-blue-600 text-slate-500 font-medium cursor-pointer"
        >
          EChat Terms & Conditions
        </button>
      </div>

      <TermsModal isOpen={showTerms} onClose={() => setShowTerms(false)} />
    </aside>
  );
};
