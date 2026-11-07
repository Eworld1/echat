import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Search, X, MessageSquare, Phone, Video } from 'lucide-react';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (user: User) => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({ isOpen, onClose, onSelectUser }) => {
  const { user } = useAuth();
  const { onlineUserIds, startCall } = useSocket();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'online'>('all');

  useEffect(() => {
    if (isOpen) {
      api.getUsers()
        .then(list => {
          if (Array.isArray(list)) {
            const filtered = list.filter(u => u && u.id !== user?.id);
            // Pin developer to top
            const sorted = filtered.sort((a, b) => {
              const aIsDev = a.isOfficialDeveloper || a.email?.toLowerCase().trim() === 'eldermoses89@gmail.com' ? 1 : 0;
              const bIsDev = b.isOfficialDeveloper || b.email?.toLowerCase().trim() === 'eldermoses89@gmail.com' ? 1 : 0;
              return bIsDev - aIsDev;
            });
            setUsers(sorted);
          } else {
            setUsers([]);
          }
        })
        .catch(err => {
          console.error('Failed to load users in ChatDrawer:', err);
          setUsers([]);
        });
    }
  }, [isOpen, user?.id]);

  if (!isOpen) return null;

  const userList = Array.isArray(users) ? users : [];

  const filtered = userList.filter(u => {
    if (!u) return false;
    const name = (u.name || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    const query = (search || '').toLowerCase();
    const matchesSearch = name.includes(query) || email.includes(query);
    if (activeTab === 'online') {
      return matchesSearch && onlineUserIds.includes(u.id);
    }
    return matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-sm sm:max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <MessageSquare size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 leading-tight">Chats</h2>
              <p className="text-xs text-slate-500">{onlineUserIds.length} users active now</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Messenger..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100 focus:bg-white text-sm rounded-full border border-transparent focus:border-blue-400 focus:outline-hidden transition"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setActiveTab('all')}
              className={`text-xs px-3 py-1 rounded-full font-semibold transition ${
                activeTab === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Contacts ({userList.length})
            </button>
            <button
              onClick={() => setActiveTab('online')}
              className={`text-xs px-3 py-1 rounded-full font-semibold transition ${
                activeTab === 'online' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Online Now ({userList.filter(u => u && onlineUserIds.includes(u.id)).length})
            </button>
          </div>
        </div>

        {/* Users list */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          {filtered.length === 0 ? (
            <div className="text-center p-8 text-slate-400">
              <p className="text-sm">No contacts found</p>
            </div>
          ) : (
            filtered.map((u) => {
              const isOnline = onlineUserIds.includes(u.id);
              return (
                <div
                  key={u.id}
                  onClick={() => {
                    onSelectUser(u);
                    onClose();
                  }}
                  className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <img
                        src={u.avatar}
                        alt={u.name}
                        className="w-12 h-12 rounded-full object-cover border border-slate-100"
                      />
                      {isOnline && (
                        <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 rounded-full ring-2 ring-white" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 truncate transition">
                        {u.name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{u.bio || u.email}</p>
                    </div>
                  </div>

                  {/* Quick call buttons */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startCall(u.id, u.name, u.avatar, 'audio');
                        onClose();
                      }}
                      className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition"
                      title="Audio Call"
                    >
                      <Phone size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startCall(u.id, u.name, u.avatar, 'video');
                        onClose();
                      }}
                      className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition"
                      title="Video Call"
                    >
                      <Video size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
