import React, { useState, useSyncExternalStore } from 'react';
import { callDiagnostics, isCallDebugEnabled } from '../services/callDiagnostics';

/**
 * Hidden call-network readout for testing on phones (no console needed). Enable by opening the site
 * once with ?calldebug=1; disable with ?calldebug=0. Shows ICE servers, candidate types, state, route.
 */
export const CallDebugPanel: React.FC<{ active: boolean }> = ({ active }) => {
  const [enabled] = useState(isCallDebugEnabled);
  const [testing, setTesting] = useState(false);
  const [open, setOpen] = useState(true);
  const info = useSyncExternalStore(callDiagnostics.subscribe, callDiagnostics.get, callDiagnostics.get);
  if (!enabled || !active) return null;
  const runTest = async () => {
    setTesting(true);
    try { await (window as Window & { echatTestTurn?: () => Promise<unknown> }).echatTestTurn?.(); }
    finally { setTesting(false); }
  };
  return (
    <div className="fixed bottom-2 left-2 z-[10001] max-h-[45vh] w-[min(22rem,calc(100%-1rem))] overflow-y-auto rounded-xl bg-black/85 p-2 font-mono text-[10px] leading-snug text-emerald-200 shadow-2xl">
      <div className="mb-1 flex items-center gap-2">
        <b className="flex-1 text-white">Call debug</b>
        <button type="button" onClick={() => void runTest()} disabled={testing} className="rounded bg-emerald-600 px-2 py-0.5 text-white disabled:opacity-50">{testing ? 'Testing…' : 'Test TURN'}</button>
        <button type="button" onClick={() => setOpen(value => !value)} className="rounded bg-white/15 px-2 py-0.5 text-white">{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && <>
        <p>source: {info.iceSource || '—'}</p>
        <p className={info.hasTurn ? 'text-emerald-300' : 'font-bold text-rose-300'}>TURN in config: {info.hasTurn ? 'YES' : 'NO'} · policy: {info.policy}</p>
        <p>candidates: host {info.candidates.host} · srflx {info.candidates.srflx} · relay <b className={info.candidates.relay ? 'text-emerald-300' : 'text-rose-300'}>{info.candidates.relay}</b></p>
        <p>gathering: {info.gathering} · ice: {info.ice} · conn: {info.connection}</p>
        {info.route && <p className="text-white">route: {info.route}</p>}
        <details><summary className="cursor-pointer text-white/80">iceServers ({info.iceServers.length})</summary>{info.iceServers.map(url => <p key={url} className="break-all">{url}</p>)}</details>
        {info.log.map((line, index) => <p key={index} className="text-amber-200">{line}</p>)}
      </>}
    </div>
  );
};
