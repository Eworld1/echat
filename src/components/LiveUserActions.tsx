import React, { useEffect, useState } from 'react';
import { Ban, Flag, MoreHorizontal, UserMinus, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { blockLiveUser, followCreator, listenFollowerCount, listenFollowingState, LIVE_REPORT_REASONS, reportLiveTarget, unfollowCreator, type LiveReportReason } from '../services/liveDiscovery';

interface LiveUserActionsProps {
  targetUserId: string;
  targetName: string;
  streamId?: string;
  compact?: boolean;
  showCount?: boolean;
  actionsOnly?: boolean;
  countOnly?: boolean;
  onBlocked?: () => void;
}

export const LiveUserActions: React.FC<LiveUserActionsProps> = ({ targetUserId, targetName, streamId, compact = false, showCount = false, actionsOnly = false, countOnly = false, onBlocked }) => {
  const { user } = useAuth();
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<LiveReportReason>('Spam');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!targetUserId) return;
    if (!user?.id) { setFollowerCount(0); setFollowing(false); return; }
    const stopCount = listenFollowerCount(targetUserId, setFollowerCount);
    const stopFollowing = user?.id && user.id !== targetUserId ? listenFollowingState(user.id, targetUserId, setFollowing) : () => setFollowing(false);
    return () => { stopCount(); stopFollowing?.(); };
  }, [targetUserId, user?.id]);

  if (!user || user.id === targetUserId) return showCount ? <span className="text-xs font-semibold text-slate-500">{followerCount} followers</span> : null;

  const toggleFollow = async () => {
    setBusy(true); setNotice('');
    try {
      if (following) await unfollowCreator(user.id, targetUserId);
      else await followCreator(user.id, targetUserId);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update follow.'); }
    finally { setBusy(false); }
  };

  const block = async () => {
    if (!confirm(`Block ${targetName}? They will not be able to see your live broadcasts, chat in them, or follow you.`)) return;
    setBusy(true); setNotice('');
    try { await blockLiveUser(user.id, targetUserId); onBlocked?.(); setMenuOpen(false); setNotice('User blocked'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not block this user.'); }
    finally { setBusy(false); }
  };

  const report = async () => {
    setBusy(true); setNotice('');
    try { await reportLiveTarget({ reporterId: user.id, targetUserId, streamId, reason }); setReportOpen(false); setMenuOpen(false); setNotice('Report sent for review'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not send report.'); }
    finally { setBusy(false); }
  };

  return <div className="relative inline-flex items-center gap-2" onClick={event => event.stopPropagation()}>
    {showCount && <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{followerCount.toLocaleString()} followers</span>}
    {!actionsOnly && !countOnly && <button type="button" disabled={busy} onClick={() => void toggleFollow()} className={compact ? 'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 disabled:opacity-50' : 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-700 disabled:opacity-50'}>
      {following ? <UserMinus size={15}/> : <UserPlus size={15}/>} {following ? 'Following' : 'Follow'}
    </button>}
    {!countOnly && <button type="button" aria-label={`More actions for ${targetName}`} onClick={() => setMenuOpen(open => !open)} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><MoreHorizontal size={19}/></button>}
    {menuOpen && <div className="absolute right-0 top-11 z-[90] w-60 rounded-xl border border-slate-200 bg-white p-2 text-slate-800 shadow-xl">
      <button type="button" onClick={() => setReportOpen(true)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold hover:bg-amber-50"><Flag size={17} className="text-amber-600"/>Report {streamId ? 'live' : 'profile'}</button>
      <button type="button" disabled={busy} onClick={() => void block()} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Ban size={17}/>Block user</button>
      {notice && <p role="status" className="px-3 py-2 text-xs text-slate-600">{notice}</p>}
    </div>}
    {notice && !menuOpen && !reportOpen && <span role="status" className="absolute right-0 top-11 z-40 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow">{notice}</span>}
    {reportOpen && <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setReportOpen(false)}><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
      <h3 className="text-lg font-extrabold text-slate-900">Report {streamId ? 'live stream' : 'profile'}</h3><p className="mt-1 text-sm text-slate-500">Why are you reporting {targetName}?</p>
      <div className="mt-4 space-y-2">{LIVE_REPORT_REASONS.map(item => <label key={item} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm font-medium"><input type="radio" name={`report-${targetUserId}`} checked={reason === item} onChange={() => setReason(item)}/>{item}</label>)}</div>
      {notice && <p role="alert" className="mt-3 text-sm text-rose-700">{notice}</p>}
      <div className="mt-4 flex gap-2"><button type="button" onClick={() => setReportOpen(false)} className="min-h-11 flex-1 rounded-xl border border-slate-200 font-bold text-slate-700">Cancel</button><button type="button" disabled={busy} onClick={() => void report()} className="min-h-11 flex-1 rounded-xl bg-amber-500 font-bold text-slate-950 disabled:opacity-50">{busy ? 'Sending…' : 'Submit report'}</button></div>
    </div></div>}
  </div>;
};
