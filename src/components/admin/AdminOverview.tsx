import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Cpu, Database, MessageSquare, RefreshCw, Users, FileText, Image as ImageIcon, Wifi } from 'lucide-react';
import { api } from '../../services/api';
import type { AdminAnalytics, AdminSystemInfo } from '../../types/admin';
import { BarChart, Donut, LineChart, Sparkline } from './charts';

const COLORS = ['#7c3aed', '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });

interface Props {
  onlineUsers: number;
  pendingReports: number;
  onOpenReports: () => void;
}

export const AdminOverview: React.FC<Props> = ({ onlineUsers, pendingReports, onOpenReports }) => {
  const [days, setDays] = useState(14);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [system, setSystem] = useState<AdminSystemInfo | null>(null);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([api.getAdminAnalytics(days), api.getAdminSystem()]);
      setAnalytics(a);
      setSystem(s);
      setError('');
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the overview');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [auto, load]);

  if (error && !analytics) return <div className="p-5 bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-2xl">{error}</div>;
  if (!analytics || !system) return <div className="p-10 text-center text-slate-400 text-sm">Loading overview...</div>;

  const last = (k: 'signups' | 'posts' | 'messages') => analytics.days.map(d => d[k]);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const half = Math.floor(analytics.days.length / 2);
  const trend = (k: 'signups' | 'posts' | 'messages') => {
    const v = last(k);
    const prev = sum(v.slice(0, half)), cur = sum(v.slice(half));
    if (prev === 0) return cur > 0 ? '+new' : '0%';
    const pct = Math.round(((cur - prev) / prev) * 100);
    return `${pct >= 0 ? '+' : ''}${pct}%`;
  };

  const kpis = [
    { label: 'Total users', value: analytics.totals.users, icon: <Users size={18} />, color: '#7c3aed', series: last('signups'), trend: trend('signups'), sub: `${analytics.verifiedUsers} verified` },
    { label: 'Posts', value: analytics.totals.posts, icon: <FileText size={18} />, color: '#2563eb', series: last('posts'), trend: trend('posts'), sub: `${analytics.totals.stories} stories` },
    { label: 'Messages', value: analytics.totals.messages, icon: <MessageSquare size={18} />, color: '#10b981', series: last('messages'), trend: trend('messages'), sub: 'all time' },
    { label: 'Online now', value: onlineUsers, icon: <Wifi size={18} />, color: '#f59e0b', series: [], trend: '', sub: `${system.activeSockets} connections` }
  ];

  const storage = typeof system.storage === 'string' ? system.storage : system.storage.driver || 'MongoDB';
  const durable = typeof system.storage !== 'string';

  return (
    <div className="space-y-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${days === d ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {d} days
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {updatedAt && <span>Updated {new Date(updatedAt).toLocaleTimeString()}</span>}
          <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Live (15s)
          </label>
          <button onClick={load} className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50" aria-label="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {pendingReports > 0 && (
        <button onClick={onOpenReports} className="w-full text-left p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold flex items-center justify-between">
          <span>{pendingReports} reported post{pendingReports > 1 ? 's' : ''} waiting for review</span>
          <span className="underline text-xs">Review now</span>
        </button>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: k.color }}>{k.icon}</span>
              {k.trend && (
                <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${k.trend.startsWith('-') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{k.trend}</span>
              )}
            </div>
            <p className="text-2xl font-black text-slate-900 mt-3">{k.value.toLocaleString()}</p>
            <p className="text-xs font-semibold text-slate-500">{k.label}</p>
            {k.series.length > 0 ? <Sparkline values={k.series} color={k.color} /> : <div className="h-6" />}
            <p className="text-[10px] text-slate-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-extrabold text-slate-900 mb-1">New sign-ups</p>
          <p className="text-[11px] text-slate-400 mb-2">{sum(last('signups'))} in the last {days} days</p>
          <BarChart data={analytics.days.map(d => ({ label: shortDay(d.date), value: d.signups }))} color="#7c3aed" />
          <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>{shortDay(analytics.days[0].date)}</span><span>{shortDay(analytics.days[analytics.days.length - 1].date)}</span></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-extrabold text-slate-900 mb-1">Posts per day</p>
          <p className="text-[11px] text-slate-400 mb-2">{sum(last('posts'))} in the last {days} days</p>
          <LineChart data={analytics.days.map(d => ({ label: shortDay(d.date), value: d.posts }))} color="#2563eb" />
          <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>{shortDay(analytics.days[0].date)}</span><span>{shortDay(analytics.days[analytics.days.length - 1].date)}</span></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-extrabold text-slate-900 mb-1">Messages per day</p>
          <p className="text-[11px] text-slate-400 mb-2">{sum(last('messages'))} in the last {days} days</p>
          <LineChart data={analytics.days.map(d => ({ label: shortDay(d.date), value: d.messages }))} color="#10b981" />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-extrabold text-slate-900 mb-3">Reactions</p>
          {analytics.reactions.length === 0 ? (
            <p className="text-xs text-slate-400">No reactions yet.</p>
          ) : (
            <div className="flex items-center gap-5">
              <Donut parts={analytics.reactions.map((r, i) => ({ label: r.type, value: r.count, color: COLORS[i % COLORS.length] }))} />
              <ul className="space-y-1.5 text-xs">
                {analytics.reactions.map((r, i) => (
                  <li key={r.type} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} /><span className="capitalize font-semibold text-slate-700">{r.type}</span><span className="text-slate-400">{r.count}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* leaderboards + system */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-extrabold text-slate-900 mb-3">Top posts</p>
          {analytics.topPosts.length === 0 && <p className="text-xs text-slate-400">No posts yet.</p>}
          <ol className="space-y-2.5">
            {analytics.topPosts.map((p, i) => (
              <li key={p.id} className="flex gap-2.5 text-xs">
                <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 font-extrabold flex items-center justify-center shrink-0">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{p.snippet || '(no text)'}</p>
                  <p className="text-slate-400">{p.authorName} · {p.reactions} reactions · {p.comments} comments · {p.shares} shares</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-extrabold text-slate-900 mb-3">Most active authors</p>
          {analytics.topAuthors.length === 0 && <p className="text-xs text-slate-400">No posts yet.</p>}
          <ul className="space-y-2.5">
            {analytics.topAuthors.map(a => (
              <li key={a.id} className="flex items-center gap-2.5 text-xs">
                <img src={a.avatar} alt="" className="w-8 h-8 rounded-full object-cover bg-slate-100" />
                <span className="flex-1 font-semibold text-slate-800 truncate">{a.name}</span>
                <span className="text-slate-500 font-bold">{a.posts} posts</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-extrabold text-slate-900 mb-3 flex items-center gap-2"><Activity size={15} /> System health</p>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between"><dt className="text-slate-500 flex items-center gap-1.5"><Database size={13} /> Storage</dt>
              <dd className={`font-bold ${durable ? 'text-emerald-600' : 'text-amber-600'}`}>{durable ? `${storage} (durable)` : 'Local file (resets on host restart)'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Uptime</dt><dd className="font-bold text-slate-800">{formatUptime(system.uptimeSeconds)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 flex items-center gap-1.5"><Cpu size={13} /> Memory</dt><dd className="font-bold text-slate-800">{system.memoryMB} MB</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Environment</dt><dd className="font-bold text-slate-800 capitalize">{system.environment}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Node</dt><dd className="font-bold text-slate-800">{system.nodeVersion}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 flex items-center gap-1.5"><ImageIcon size={13} /> Pages / Groups / Events</dt><dd className="font-bold text-slate-800">{analytics.totals.pages} / {analytics.totals.groups} / {analytics.totals.events}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
};
