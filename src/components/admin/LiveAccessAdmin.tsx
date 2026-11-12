import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, Shield, X } from 'lucide-react';
import { api } from '../../services/api';
import type { LiveAccessMode, LiveAccessRequest, User } from '../../types';

export const LiveAccessAdmin: React.FC<{ onPendingCount?: (count: number) => void }> = ({ onPendingCount }) => {
  const [requests, setRequests] = useState<LiveAccessRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [mode, setMode] = useState<LiveAccessMode>('approved_only');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const data = await api.getAdminLiveAccess();
      setRequests(data.requests);
      setUsers(data.users);
      setMode(data.mode);
      onPendingCount?.(data.requests.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load live access settings.'); }
  };
  useEffect(() => { void load(); }, []);

  const review = async (requestId: string, decision: 'approved' | 'rejected' | 'blocked') => {
    setBusyId(requestId); setError('');
    try { await api.reviewLiveAccessRequest(requestId, decision); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not review request.'); }
    finally { setBusyId(''); }
  };
  const updateUser = async (userId: string, action: 'grant' | 'revoke' | 'block' | 'unblock') => {
    setBusyId(userId); setError('');
    try { await api.updateUserLiveAccess(userId, action); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update user access.'); }
    finally { setBusyId(''); }
  };
  const changeMode = async (next: LiveAccessMode) => {
    setMode(next); setError('');
    try { await api.updateLiveAccessMode(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update live settings.'); await load(); }
  };

  const filteredUsers = useMemo(() => {
    const text = query.trim().toLowerCase();
    return users.filter(person => !text || person.name.toLowerCase().includes(text) || person.email.toLowerCase().includes(text));
  }, [users, query]);

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-extrabold text-slate-900">Live Access Requests <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">{requests.length}</span></h2><p className="mt-1 text-sm text-slate-500">Review creator requests and decide who can broadcast.</p></div><label className="flex items-center gap-2 text-sm font-semibold text-slate-700">Live access mode<select value={mode} onChange={event => void changeMode(event.target.value as LiveAccessMode)} className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="everyone">Everyone can go live</option><option value="approved_only">Approved only</option><option value="admins_creators_only">Admins + Creators only</option></select></label></div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 space-y-3">{requests.map(request => <article key={request.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-3 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><img src={request.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover"/><div className="min-w-0"><p className="font-bold text-slate-900">{request.name}</p><p className="whitespace-pre-wrap break-words text-sm text-slate-600">{request.reason}</p><time className="mt-1 block text-xs text-slate-400">{new Date(request.createdAt).toLocaleString()}</time></div></div><div className="flex flex-wrap gap-2"><button disabled={busyId === request.id} onClick={() => void review(request.id, 'approved')} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50"><Check size={15}/>Approve</button><button disabled={busyId === request.id} onClick={() => void review(request.id, 'rejected')} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-700 disabled:opacity-50"><X size={15}/>Reject</button><button disabled={busyId === request.id} onClick={() => void review(request.id, 'blocked')} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-rose-100 px-3 text-xs font-bold text-rose-700 disabled:opacity-50"><Shield size={15}/>Block</button></div></article>)}{!requests.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No pending Go Live requests.</p>}</div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-lg font-extrabold text-slate-900">Manual Live Access</h2><label className="mt-3 flex h-11 max-w-lg items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3"><Search size={17} className="text-slate-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search user by name or email" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label><div className="mt-4 divide-y divide-slate-100">{filteredUsers.slice(0, 30).map(person => <div key={person.id} className="flex flex-wrap items-center gap-3 py-3"><img src={person.avatar} alt="" className="h-9 w-9 rounded-full object-cover"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{person.name}</p><p className="text-xs text-slate-500">{person.liveAccess || 'none'} · {person.email}</p></div>{person.role !== 'developer' && person.role !== 'super_admin' && <div className="flex gap-2">{person.liveAccess === 'approved' ? <button disabled={busyId === person.id} onClick={() => void updateUser(person.id, 'revoke')} className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs font-bold">Revoke</button> : person.liveAccess === 'blocked' ? <button disabled={busyId === person.id} onClick={() => void updateUser(person.id, 'unblock')} className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs font-bold">Unblock</button> : <><button disabled={busyId === person.id} onClick={() => void updateUser(person.id, 'grant')} className="min-h-9 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white">Grant Live</button><button disabled={busyId === person.id} onClick={() => void updateUser(person.id, 'block')} className="min-h-9 rounded-lg bg-rose-100 px-3 text-xs font-bold text-rose-700">Block</button></>}</div>}</div>)}{!filteredUsers.length && <p className="py-5 text-center text-sm text-slate-500">No matching users.</p>}</div></section>
  </div>;
};
