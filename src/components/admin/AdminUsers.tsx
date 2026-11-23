import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Ban, Download, RefreshCw, Search, Trash2, UserCheck } from 'lucide-react';
import { api } from '../../services/api';
import type { User } from '../../types';
import { initialsAvatar } from '../../utils/avatar';

type AdminUser = User & { postsCount?: number };
type Filter = 'all' | 'online' | 'blocked' | 'verified' | 'admins';
type Sort = 'newest' | 'oldest' | 'name' | 'posts';
const PAGE_SIZE = 10;

interface Props {
  currentUserId: string;
  onViewProfile: (userId: string) => void;
  onChanged?: () => void;
}

export const AdminUsers: React.FC<Props> = ({ currentUserId, onViewProfile, onChanged }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers((await api.getAdminUsers()) as AdminUser[]); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load users'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [query, filter, sort]);

  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(''), 3500); };

  const counts = useMemo(() => ({
    all: users.length,
    online: users.filter(u => u.isOnline).length,
    blocked: users.filter(u => u.isBlocked).length,
    verified: users.filter(u => u.isVerified).length,
    admins: users.filter(u => u.role === 'developer').length
  }), [users]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = users.filter(u => {
      if (q && !(u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.location?.toLowerCase().includes(q))) return false;
      if (filter === 'online') return u.isOnline;
      if (filter === 'blocked') return u.isBlocked;
      if (filter === 'verified') return u.isVerified;
      if (filter === 'admins') return u.role === 'developer';
      return true;
    });
    list = [...list].sort((a, b) =>
      sort === 'name' ? (a.name || '').localeCompare(b.name || '')
      : sort === 'oldest' ? a.createdAt - b.createdAt
      : sort === 'posts' ? (b.postsCount ?? 0) - (a.postsCount ?? 0)
      : b.createdAt - a.createdAt);
    return list;
  }, [users, query, filter, sort]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const rows = visible.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const isProtected = (u: AdminUser) => u.role === 'developer' || u.id === currentUserId;

  const replaceUser = (updated: User) => setUsers(prev => prev.map(u => (u.id === updated.id ? { ...u, ...updated } : u)));

  const toggleBlock = async (u: AdminUser) => {
    setBusyId(u.id);
    try { replaceUser(await api.toggleBlockUser(u.id)); flash(`${u.name} ${u.isBlocked ? 'unblocked' : 'blocked'}.`); onChanged?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusyId(null); }
  };

  const toggleVerify = async (u: AdminUser) => {
    setBusyId(u.id);
    try { replaceUser(await api.toggleVerifyUser(u.id)); flash(`${u.name} ${u.isVerified ? 'is no longer verified' : 'is now verified'}.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusyId(null); }
  };

  const deleteUser = async (u: AdminUser) => {
    setBusyId(u.id);
    try {
      await api.deleteAccount(u.id);
      setUsers(prev => prev.filter(x => x.id !== u.id));
      setSelected(prev => { const n = new Set(prev); n.delete(u.id); return n; });
      setConfirmDelete(null);
      flash(`${u.name}'s account was deleted.`);
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the account'); }
    finally { setBusyId(null); }
  };

  const bulkBlock = async (block: boolean) => {
    const targets = users.filter(u => selected.has(u.id) && !isProtected(u) && u.isBlocked !== block);
    let done = 0;
    for (const u of targets) {
      try { replaceUser(await api.toggleBlockUser(u.id)); done++; } catch { /* keep going */ }
    }
    setSelected(new Set());
    flash(`${done} account${done === 1 ? '' : 's'} ${block ? 'blocked' : 'unblocked'}.`);
    onChanged?.();
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Name', 'Email', 'Location', 'Role', 'Verified', 'Blocked', 'Online', 'Posts', 'Friends', 'Joined'];
    const lines = visible.map(u => [u.name, u.email, u.location, u.role, u.isVerified ? 'yes' : 'no', u.isBlocked ? 'yes' : 'no', u.isOnline ? 'yes' : 'no', u.postsCount ?? 0, u.friends?.length ?? 0, new Date(u.createdAt).toISOString()].map(esc).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `echat-users-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const togglePage = () => setSelected(prev => {
    const n = new Set(prev);
    rows.forEach(r => { if (isProtected(r)) return; if (allOnPageSelected) n.delete(r.id); else n.add(r.id); });
    return n;
  });

  const filters: [Filter, string][] = [['all', 'All'], ['online', 'Online'], ['verified', 'Verified'], ['blocked', 'Blocked'], ['admins', 'Admins']];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">User management</h3>
          <p className="text-xs text-slate-500">{visible.length} of {users.length} accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5"><Download size={14} /> Export CSV</button>
          <button onClick={load} className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200" aria-label="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email or location" className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as Sort)} className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A-Z</option>
          <option value="posts">Most posts</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {filters.map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${filter === f ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {label} <span className="opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="mb-3 p-2.5 rounded-xl bg-purple-50 border border-purple-200 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-purple-800">{selected.size} selected</span>
          <button onClick={() => bulkBlock(true)} className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold">Block</button>
          <button onClick={() => bulkBlock(false)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold">Unblock</button>
          <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-600">Clear</button>
        </div>
      )}

      {error && <p className="mb-3 text-xs font-bold text-red-600">{error}</p>}
      {notice && <p className="mb-3 text-xs font-bold text-emerald-600">{notice}</p>}

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="text-left text-slate-400 uppercase tracking-wider text-[10px]">
              <th className="p-2 w-8"><input type="checkbox" checked={allOnPageSelected} onChange={togglePage} aria-label="Select page" /></th>
              <th className="p-2">User</th><th className="p-2">Status</th><th className="p-2 text-right">Posts</th><th className="p-2">Joined</th><th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(u => (
              <tr key={u.id} className="hover:bg-slate-50/70">
                <td className="p-2"><input type="checkbox" disabled={isProtected(u)} checked={selected.has(u.id)} onChange={() => setSelected(prev => { const n = new Set(prev); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })} aria-label={`Select ${u.name}`} /></td>
                <td className="p-2">
                  <button onClick={() => onViewProfile(u.id)} className="flex items-center gap-2.5 text-left">
                    <span className="relative"><img src={u.avatar || initialsAvatar(u.name)} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-100" />{u.isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />}</span>
                    <span className="min-w-0"><span className="block font-bold text-slate-900 truncate max-w-[180px]">{u.name}</span><span className="block text-slate-400 truncate max-w-[180px]">{u.email}</span></span>
                  </button>
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {u.role === 'developer' && <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-extrabold">Admin</span>}
                    {u.isVerified && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">Verified</span>}
                    {u.isBlocked && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">Blocked</span>}
                    {!u.isBlocked && u.role !== 'developer' && !u.isVerified && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold">Active</span>}
                  </div>
                </td>
                <td className="p-2 text-right font-bold text-slate-700">{u.postsCount ?? 0}</td>
                <td className="p-2 text-slate-500 whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                <td className="p-2">
                  <div className="flex justify-end gap-1">
                    <button disabled={busyId === u.id} onClick={() => toggleVerify(u)} title={u.isVerified ? 'Remove verification' : 'Verify'} className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50"><BadgeCheck size={15} /></button>
                    {!isProtected(u) && (
                      <>
                        <button disabled={busyId === u.id} onClick={() => toggleBlock(u)} title={u.isBlocked ? 'Unblock' : 'Block'} className={`p-2 rounded-lg disabled:opacity-50 ${u.isBlocked ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}>{u.isBlocked ? <UserCheck size={15} /> : <Ban size={15} />}</button>
                        <button disabled={busyId === u.id} onClick={() => setConfirmDelete(u)} title="Delete account" className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"><Trash2 size={15} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">{loading ? 'Loading...' : 'No users match your filters.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg bg-slate-100 font-bold disabled:opacity-40">Previous</button>
          <span className="text-slate-500">Page {page + 1} of {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg bg-slate-100 font-bold disabled:opacity-40">Next</button>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h4 className="text-base font-extrabold text-slate-900">Delete {confirmDelete.name}?</h4>
            <p className="text-sm text-slate-500 mt-1.5">Their account, posts and messages are removed permanently. This cannot be undone.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">Cancel</button>
              <button onClick={() => deleteUser(confirmDelete)} disabled={busyId === confirmDelete.id} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-sm font-bold text-white">{busyId === confirmDelete.id ? 'Deleting...' : 'Delete account'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
