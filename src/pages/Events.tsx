import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { EventItem } from '../types';
import {
  Calendar,
  Plus,
  MapPin,
  Clock,
  Check,
  Star,
  Users,
  ArrowLeft,
  Search,
  Share2,
  CalendarCheck
} from 'lucide-react';

interface EventsProps {
  initialEventId?: string | null;
  onNavigateBack?: () => void;
}

export const Events: React.FC<EventsProps> = ({ initialEventId }) => {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialEventId || null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'going' | 'hosting'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal Create Event
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCover, setNewCover] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (initialEventId) {
      setSelectedEventId(initialEventId);
    }
  }, [initialEventId]);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const data = await api.getEvents();
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load events', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDate) return;
    setIsCreating(true);
    try {
      const created = await api.createEvent({
        title: newTitle.trim(),
        date: newDate,
        location: newLocation.trim() || 'Online',
        description: newDescription.trim(),
        cover: newCover.trim() || 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80'
      });
      setEvents(prev => [created, ...prev]);
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewDate('');
      setNewLocation('');
      setNewDescription('');
      setNewCover('');
      setSelectedEventId(created.id);
    } catch (e: any) {
      alert(e.message || 'Failed to create event');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleGoing = async (eventId: string) => {
    try {
      const updated = await api.toggleEventGoing(eventId);
      setEvents(prev => prev.map(e => e.id === eventId ? updated : e));
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleToggleInterested = async (eventId: string) => {
    try {
      const updated = await api.toggleEventInterested(eventId);
      setEvents(prev => prev.map(e => e.id === eventId ? updated : e));
    } catch (e: any) {
      console.error(e);
    }
  };

  const activeEvent = events.find(e => e.id === selectedEventId);

  const filteredEvents = events.filter(e => {
    const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.location?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const isGoing = user ? (e.going && e.going.includes(user.id)) : false;
    const isHosting = user ? e.ownerId === user.id : false;

    if (activeFilter === 'going') return matchesSearch && isGoing;
    if (activeFilter === 'hosting') return matchesSearch && isHosting;
    return matchesSearch;
  });

  // EVENT DETAIL VIEW
  if (activeEvent) {
    const isGoing = user ? (activeEvent.going && activeEvent.going.includes(user.id)) : false;
    const isInterested = user ? (activeEvent.interested && activeEvent.interested.includes(user.id)) : false;
    const eventDateObj = new Date(activeEvent.date);

    return (
      <div className="space-y-4 pb-12">
        {/* Back navigation */}
        <button
          onClick={() => setSelectedEventId(null)}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-xl shadow-sm border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to all Events
        </button>

        {/* Event Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="h-56 sm:h-72 w-full bg-slate-800 relative">
            <img
              src={activeEvent.cover}
              alt={activeEvent.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            
            {/* Date Tag */}
            <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm rounded-xl px-3 py-1.5 shadow-md flex items-center gap-2.5">
              <div className="text-center font-black">
                <div className="text-red-600 text-[10px] uppercase tracking-wider">{eventDateObj.toLocaleString('default', { month: 'short' })}</div>
                <div className="text-slate-900 text-lg leading-tight">{eventDateObj.getDate()}</div>
              </div>
              <div className="border-l border-slate-200 pl-2 text-xs font-semibold text-slate-600">
                <div>{eventDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                <div className="text-[10px] text-slate-400">{eventDateObj.toLocaleDateString(undefined, { weekday: 'short' })}</div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900">{activeEvent.title}</h1>
                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-500 mt-2">
                  <span className="flex items-center gap-1 text-slate-700">
                    <MapPin size={14} className="text-red-500" />
                    {activeEvent.location}
                  </span>
                  <span>•</span>
                  <span>Hosted by <strong className="text-slate-800">{activeEvent.ownerName || 'Host'}</strong></span>
                </div>
              </div>

              {/* RSVP Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleGoing(activeEvent.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition cursor-pointer shadow-sm ${
                    isGoing
                      ? 'bg-emerald-600 text-white'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  <Check size={16} />
                  {isGoing ? 'Going' : 'Going'} ({activeEvent.going?.length || 0})
                </button>

                <button
                  onClick={() => handleToggleInterested(activeEvent.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
                    isInterested
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Star size={16} className={isInterested ? 'fill-amber-500 text-amber-500' : ''} />
                  {isInterested ? 'Interested' : 'Interested'} ({activeEvent.interested?.length || 0})
                </button>
              </div>
            </div>

            {/* Description */}
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">About This Event</h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {activeEvent.description || 'No description provided for this event.'}
              </p>
            </div>

            {/* Attendance Counters */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-6 text-xs text-slate-500 font-semibold">
              <div className="flex items-center gap-1.5">
                <CalendarCheck size={16} className="text-emerald-600" />
                <strong className="text-slate-900 font-bold">{activeEvent.going?.length || 0}</strong> people going
              </div>
              <div className="flex items-center gap-1.5">
                <Star size={16} className="text-amber-500" />
                <strong className="text-slate-900 font-bold">{activeEvent.interested?.length || 0}</strong> people interested
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ALL EVENTS LIST VIEW
  return (
    <div className="space-y-4 pb-12">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-rose-600 font-extrabold text-lg sm:text-xl">
            <Calendar size={24} />
            <h2>Events & Meetups</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Discover hackathons, live streams, workshops, and gatherings
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-700 transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          <Plus size={18} />
          Create Event
        </button>
      </div>

      {/* Tabs & Search Filter */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeFilter === 'all'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Upcoming
          </button>
          <button
            onClick={() => setActiveFilter('going')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeFilter === 'going'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Going ({events.filter(e => user && e.going?.includes(user.id)).length})
          </button>
          <button
            onClick={() => setActiveFilter('hosting')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeFilter === 'hosting'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Hosting
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events..."
            className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>
      </div>

      {/* Events Grid */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400">
          <div className="w-8 h-8 rounded-full border-2 border-rose-600 border-t-transparent animate-spin mx-auto mb-2" />
          <p className="text-xs">Loading events...</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-slate-200">
          <Calendar size={40} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-bold text-slate-700">No events found</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery ? `No events match "${searchQuery}".` : 'Be the first to schedule an event or workshop!'}
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-4 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 cursor-pointer"
          >
            Create an Event
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredEvents.map(event => {
            const isGoing = user ? (event.going && event.going.includes(user.id)) : false;
            const isInterested = user ? (event.interested && event.interested.includes(user.id)) : false;
            const dateObj = new Date(event.date);

            return (
              <div
                key={event.id}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div
                    onClick={() => setSelectedEventId(event.id)}
                    className="h-32 w-full bg-slate-800 relative cursor-pointer group"
                  >
                    <img
                      src={event.cover}
                      alt={event.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    
                    {/* Date badge */}
                    <div className="absolute top-2 left-2 bg-white/95 backdrop-blur-sm rounded-lg px-2.5 py-1 text-center font-black shadow-sm">
                      <div className="text-[10px] text-red-600 uppercase leading-none">{dateObj.toLocaleString('default', { month: 'short' })}</div>
                      <div className="text-sm text-slate-900 leading-tight">{dateObj.getDate()}</div>
                    </div>
                  </div>

                  <div className="p-4">
                    <h3
                      onClick={() => setSelectedEventId(event.id)}
                      className="text-sm font-bold text-slate-900 truncate hover:text-rose-600 cursor-pointer"
                    >
                      {event.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                      <MapPin size={12} className="text-red-500" />
                      <span className="truncate">{event.location}</span>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 mt-2 leading-relaxed">
                      {event.description || 'No description provided.'}
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-2 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() => handleToggleGoing(event.id)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      isGoing
                        ? 'bg-emerald-600 text-white'
                        : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                    }`}
                  >
                    <Check size={14} />
                    {isGoing ? 'Going' : 'RSVP Going'}
                  </button>

                  <button
                    onClick={() => handleToggleInterested(event.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                      isInterested
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Star size={14} className={isInterested ? 'fill-amber-500 text-amber-500' : ''} />
                    Interested
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE EVENT MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-black text-lg">
                <Calendar size={20} className="text-rose-600" />
                <h3>Create New Event</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateEvent} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Event Title *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Sierra Leone Tech Meetup 2026"
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Date and Time *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Location / Link
                </label>
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder="e.g. Freetown Tech Hub or Virtual Video Link"
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                  placeholder="Tell people what this event is about..."
                  className="w-full text-sm p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Cover Photo URL (optional)
                </label>
                <input
                  type="url"
                  value={newCover}
                  onChange={(e) => setNewCover(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full text-xs p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newTitle.trim() || !newDate}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {isCreating ? 'Creating Event...' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
