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
    state = { ...state, log: [...state.log.slice(-11), `${stamp} ${line}`] };
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

/**
 * Relay-only self test: can this device reach the TURN server? Gathers candidates with
 * iceTransportPolicy 'relay' for up to 8s and reports how many relay candidates appeared.
 */
export async function testTurnRelay(config: RTCConfiguration): Promise<{ ok: boolean; relay: number; detail: string }> {
  const pc = new RTCPeerConnection({ ...config, iceTransportPolicy: 'relay', iceCandidatePoolSize: 0 });
  const relays: string[] = [];
  const errors: string[] = [];
  pc.onicecandidate = event => { if (event.candidate?.type === 'relay') relays.push(`${event.candidate.protocol}/${(event.candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol || '?'}`); };
  pc.onicecandidateerror = event => { const error = event as RTCPeerConnectionIceErrorEvent; errors.push(`${error.url} ${error.errorCode} ${error.errorText}`); };
  pc.createDataChannel('turn-test');
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise<void>(resolve => {
      const timer = window.setTimeout(resolve, 8000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { window.clearTimeout(timer); resolve(); } };
    });
  } finally {
    pc.close();
  }
  const ok = relays.length > 0;
  const detail = ok ? `TURN OK: ${relays.length} relay candidate(s) [${[...new Set(relays)].join(', ')}]` : `TURN FAILED: no relay candidates.${errors.length ? ` Errors: ${errors.slice(0, 3).join(' | ')}` : ' (no TURN servers in config, or blocked)'}`;
  console[ok ? 'info' : 'error'](`[Call] ${detail}`);
  return { ok, relay: relays.length, detail };
}
