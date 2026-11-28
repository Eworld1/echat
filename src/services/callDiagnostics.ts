/**
 * Call network diagnostics: what ICE servers the browser got, which candidate types it gathered
 * (host / srflx / relay) and how the call connected. Always logged to the console with a [Call]
 * prefix; shown on screen during a call when the site is opened once with ?calldebug=1
 * (turn it off with ?calldebug=0).
 */

export interface CallDiagnostics {
  iceSource: string;
  iceServers: string[];
  hasTurn: boolean;
  candidates: { host: number; srflx: number; prflx: number; relay: number };
  gathering: string;
  ice: string;
  connection: string;
  route: string;
  policy: string;
  log: string[];
}

const empty = (): CallDiagnostics => ({
  iceSource: '', iceServers: [], hasTurn: false, candidates: { host: 0, srflx: 0, prflx: 0, relay: 0 },
  gathering: 'new', ice: 'new', connection: 'new', route: '', policy: 'all', log: []
});

let state = empty();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const callDiagnostics = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  reset(keepIce = true) {
    const { iceSource, iceServers, hasTurn } = state;
    state = { ...empty(), ...(keepIce ? { iceSource, iceServers, hasTurn } : {}) };
    emit();
  },
  set(patch: Partial<CallDiagnostics>) { state = { ...state, ...patch }; emit(); },
  candidate(type: string | null | undefined) {
    const key = (type || 'host') as keyof CallDiagnostics['candidates'];
    if (!(key in state.candidates)) return;
    state = { ...state, candidates: { ...state.candidates, [key]: state.candidates[key] + 1 } };
    emit();
  },
  note(line: string) {
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    state = { ...state, log: [...state.log.slice(-19), `${stamp} ${line}`] };
    emit();
  }
};

/** STUN/TURN URLs only — usernames and passwords are never logged. */
export const describeIceServers = (servers: RTCIceServer[] = []) =>
  servers.flatMap(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).map(url => `${url}${server.username ? ' (with credentials)' : ''}`));

export const isCallDebugEnabled = () => {
  try {
    const flag = new URLSearchParams(window.location.search).get('calldebug');
    if (flag === '1') localStorage.setItem('echat_call_debug', '1');
    if (flag === '0') localStorage.removeItem('echat_call_debug');
    return localStorage.getItem('echat_call_debug') === '1';
  } catch {
    return false;
  }
};

/** What an ICE error code means, in plain words. */
export function explainIceError(code: number): string {
  if (code === 401) return '401 unauthorized (bad/expired TURN credentials)';
  if (code === 403) return '403 forbidden (TURN account/quota)';
  if (code === 437 || code === 438) return `${code} allocation/nonce mismatch`;
  if (code === 486) return '486 allocation quota reached';
  if (code === 508) return '508 relay capacity';
  if (code === 701) return '701 unreachable (blocked port/protocol or timeout)';
  return `${code}`;
}

interface UrlResult { url: string; relay: number; error: string; ms: number }

/** Gather relay-only candidates against ONE TURN URL for up to 8s. */
async function testOneTurnUrl(server: RTCIceServer, url: string): Promise<UrlResult> {
  const started = Date.now();
  const pc = new RTCPeerConnection({ iceServers: [{ ...server, urls: url }], iceTransportPolicy: 'relay', iceCandidatePoolSize: 0 });
  let relay = 0;
  const errors: string[] = [];
  pc.onicecandidate = event => { if (event.candidate?.type === 'relay') relay += 1; };
  pc.onicecandidateerror = event => { const error = event as RTCPeerConnectionIceErrorEvent; errors.push(`${explainIceError(error.errorCode)}${error.errorText ? ` "${error.errorText}"` : ''}`); };
  pc.createDataChannel('turn-test');
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise<void>(resolve => {
      const timer = window.setTimeout(resolve, 8000);
      const check = () => { if (pc.iceGatheringState === 'complete' || relay > 0) { window.clearTimeout(timer); resolve(); } };
      pc.onicegatheringstatechange = check;
      const poll = window.setInterval(() => { if (relay > 0) { window.clearInterval(poll); check(); } }, 200);
      window.setTimeout(() => window.clearInterval(poll), 8200);
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    pc.close();
  }
  const ms = Date.now() - started;
  return { url, relay, ms, error: relay ? '' : errors[0] || (ms >= 7900 ? 'timeout (no answer in 8s)' : 'no relay candidate') };
}

/**
 * Relay-only self test: tests every TURN URL separately (in parallel) and reports, per URL, whether
 * a relay candidate came back or the exact ICE error (401 bad credentials, 701 blocked, timeout…).
 */
export async function testTurnRelay(config: RTCConfiguration): Promise<{ ok: boolean; relay: number; detail: string; results: UrlResult[] }> {
  const targets = (config.iceServers || []).flatMap(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => /^turns?:/i.test(url)).map(url => ({ server, url })));
  if (!targets.length) {
    const detail = 'TURN FAILED: no TURN servers in the config this device received';
    console.error(`[Call] ${detail}`);
    return { ok: false, relay: 0, detail, results: [] };
  }
  const results = await Promise.all(targets.map(target => testOneTurnUrl(target.server, target.url)));
  const relay = results.reduce((sum, result) => sum + result.relay, 0);
  const ok = relay > 0;
  results.forEach(result => {
    const line = `${result.relay ? 'OK ' : 'FAIL'} ${result.url} → ${result.relay ? `relay ${result.relay} (${result.ms}ms)` : result.error}`;
    console[result.relay ? 'info' : 'warn'](`[Call] TURN test ${line}`);
    callDiagnostics.note(line);
  });
  const detail = ok ? `TURN OK: relay ${relay} via ${results.filter(result => result.relay).length}/${results.length} URL(s)` : `TURN FAILED on all ${results.length} URL(s)`;
  console[ok ? 'info' : 'error'](`[Call] ${detail}`);
  return { ok, relay, detail, results };
}
