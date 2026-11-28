/**
 * Voice relay over the eChat WebSocket (Render). Fallback for calls when WebRTC can't connect
 * because a carrier blocks every TURN provider: the app's own WebSocket to Render already works there.
 *
 *  mic track → AudioWorklet → 16 kHz mono → G.711 µ-law (8 bit) → 40 ms frames → WebSocket → partner
 *  partner frames → µ-law decode → jitter buffer (≈100 ms) → MediaStreamDestination → call <audio>
 *
 * Frame: [0x01][seq hi][seq lo][…640 µ-law bytes]. ~128 kbit/s each way. Audio only (no video).
 * The mic track is the call's own track, so Mute (track.enabled = false) keeps working; silent frames
 * are not sent.
 */

const RATE = 16000;
const FRAME_SAMPLES = 640; // 40 ms at 16 kHz
const TYPE_AUDIO = 0x01;
export const TYPE_ECHO = 0x02;

const WORKLET = `
class EchatRelayCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('echat-relay-capture', EchatRelayCapture);
`;

/* ---- G.711 µ-law ---- */
function encodeMuLaw(sample: number): number {
  const BIAS = 0x84;
  let value = Math.max(-1, Math.min(1, sample)) * 32635;
  const sign = value < 0 ? 0x80 : 0;
  if (value < 0) value = -value;
  value += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
const MU_TABLE = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const value = ~i & 0xff;
    const sign = value & 0x80;
    const exponent = (value >> 4) & 0x07;
    const mantissa = value & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    table[i] = (sign ? -sample : sample) / 32768;
  }
  return table;
})();

export interface WsAudioRelay {
  /** Remote voice as a MediaStream track (plays through the existing call audio element). */
  outputTrack: MediaStreamTrack;
  receive: (data: ArrayBuffer) => void;
  stop: () => void;
  stats: () => { sent: number; received: number; dropped: number };
}

export async function createWsAudioRelay(context: AudioContext, micStream: MediaStream, send: (frame: ArrayBuffer) => boolean): Promise<WsAudioRelay> {
  if (context.state === 'suspended') await context.resume().catch(() => {});
  const destination = context.createMediaStreamDestination();
  const output = context.createGain();
  output.connect(destination);

  /* capture */
  const source = context.createMediaStreamSource(new MediaStream(micStream.getAudioTracks()));
  const sink = context.createGain();
  sink.gain.value = 0;
  sink.connect(context.destination);
  const ratio = context.sampleRate / RATE;
  let carry: number[] = [];
  let phase = 0;
  let seq = 0;
  let sent = 0;
  const pending = new Uint8Array(FRAME_SAMPLES);
  let pendingLength = 0;
  let frameEnergy = 0;

  const onSamples = (input: Float32Array) => {
    // Downsample (box filter) from the context rate to 16 kHz.
    const samples = carry.length ? Float32Array.from([...carry, ...input]) : input;
    carry = [];
    let position = phase;
    while (position + ratio <= samples.length) {
      let sum = 0;
      const start = Math.floor(position);
      const end = Math.floor(position + ratio);
      for (let i = start; i < end; i++) sum += samples[i];
      const value = sum / Math.max(1, end - start);
      frameEnergy += value * value;
      pending[pendingLength++] = encodeMuLaw(value);
      position += ratio;
      if (pendingLength === FRAME_SAMPLES) {
        const silent = frameEnergy / FRAME_SAMPLES < 1e-7; // muted or dead quiet: don't spend data
        if (!silent) {
          const frame = new Uint8Array(3 + FRAME_SAMPLES);
          frame[0] = TYPE_AUDIO;
          frame[1] = (seq >> 8) & 0xff;
          frame[2] = seq & 0xff;
          frame.set(pending, 3);
          if (send(frame.buffer)) sent++;
        }
        seq = (seq + 1) & 0xffff;
        pendingLength = 0;
        frameEnergy = 0;
      }
    }
    const used = Math.floor(position);
    carry = Array.from(samples.subarray(used));
    phase = position - used;
  };

  let captureNode: AudioNode;
  let workletUrl = '';
  if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, 'echat-relay-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = event => onSamples(event.data as Float32Array);
    captureNode = node;
  } else {
    // Old browsers without AudioWorklet.
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = event => onSamples(event.inputBuffer.getChannelData(0).slice(0));
    captureNode = processor;
  }
  source.connect(captureNode);
  captureNode.connect(sink);

  /* playback with a small jitter buffer */
  let nextTime = 0;
  let received = 0;
  let dropped = 0;
  let lastSeq = -1;
  const receive = (data: ArrayBuffer) => {
    const bytes = new Uint8Array(data);
    if (bytes.length < 4 || bytes[0] !== TYPE_AUDIO) return;
    const frameSeq = (bytes[1] << 8) | bytes[2];
    // Late/duplicate frame (sequence went backwards a little): skip it.
    if (lastSeq >= 0 && ((frameSeq - lastSeq) & 0xffff) > 0x8000) { dropped++; return; }
    lastSeq = frameSeq;
    received++;
    const count = bytes.length - 3;
    const buffer = context.createBuffer(1, count, RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) channel[i] = MU_TABLE[bytes[i + 3]];
    const now = context.currentTime;
    if (nextTime < now + 0.04) nextTime = now + 0.1; // underrun: rebuild ~100 ms of buffer
    if (nextTime > now + 0.6) { nextTime = now + 0.1; dropped++; } // latency built up: catch up
    const player = context.createBufferSource();
    player.buffer = buffer;
    player.connect(output);
    player.start(nextTime);
    nextTime += buffer.duration;
  };

  const outputTrack = destination.stream.getAudioTracks()[0];
  return {
    outputTrack,
    receive,
    stats: () => ({ sent, received, dropped }),
    stop: () => {
      try { source.disconnect(); captureNode.disconnect(); sink.disconnect(); output.disconnect(); } catch { /* already gone */ }
      if (captureNode instanceof AudioWorkletNode) captureNode.port.onmessage = null;
      if (workletUrl) URL.revokeObjectURL(workletUrl);
      outputTrack.stop();
    }
  };
}
