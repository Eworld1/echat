#!/usr/bin/env node
/**
 * Generates EChat's built-in, royalty-free sound library (original, synthesized audio — no third-party samples):
 *   public/sounds/music/*.wav  (10 looping "trending" tracks, ~12 s each)
 *   public/sounds/sfx/*.wav    (12 short sound effects)
 * Run: node scripts/generate-sounds.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const RATE = 16000;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'sounds');

// ---------- helpers ----------
let seed = 1234567;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const noise = () => rand() * 2 - 1;
const buffer = seconds => new Float32Array(Math.ceil(seconds * RATE));
const midi = n => 440 * 2 ** ((n - 69) / 12);
const saw = p => 2 * (p - Math.floor(p + 0.5));
const tri = p => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
const square = p => (p % 1 < 0.5 ? 1 : -1);

function add(target, source, startSec, gain = 1) {
  const start = Math.floor(startSec * RATE);
  for (let i = 0; i < source.length && start + i < target.length; i += 1) target[start + i] += source[i] * gain;
}
function env(length, attack, release, sustain = 1) {
  const e = new Float32Array(length);
  const a = Math.max(1, Math.floor(attack * RATE));
  const r = Math.max(1, Math.floor(release * RATE));
  for (let i = 0; i < length; i += 1) {
    e[i] = i < a ? i / a : i > length - r ? Math.max(0, (length - i) / r) * sustain : sustain;
  }
  return e;
}
function lowpass(signal, cutoff) {
  const out = new Float32Array(signal.length);
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = (1 / RATE) / (rc + 1 / RATE);
  let y = 0;
  for (let i = 0; i < signal.length; i += 1) { y += alpha * (signal[i] - y); out[i] = y; }
  return out;
}
function highpass(signal, cutoff) {
  const low = lowpass(signal, cutoff);
  return signal.map((value, i) => value - low[i]);
}

// ---------- instruments ----------
function kick(len = 0.35, f0 = 120, f1 = 45) {
  const out = buffer(len); let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE; const f = f1 + (f0 - f1) * Math.exp(-t * 30);
    phase += f / RATE; out[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 9);
  }
  return out;
}
function snare(len = 0.22) {
  const out = buffer(len);
  for (let i = 0; i < out.length; i += 1) { const t = i / RATE; out[i] = (noise() * 0.7 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 22); }
  return highpass(out, 400);
}
function clap(len = 0.25) {
  const out = buffer(len);
  for (let i = 0; i < out.length; i += 1) { const t = i / RATE; const burst = [0, 0.012, 0.024].some(o => t >= o && t < o + 0.01) ? 1 : 0.35; out[i] = noise() * burst * Math.exp(-t * 18); }
  return highpass(out, 900);
}
function hat(len = 0.06, open = false) {
  const out = buffer(open ? 0.25 : len);
  for (let i = 0; i < out.length; i += 1) { const t = i / RATE; out[i] = noise() * Math.exp(-t * (open ? 14 : 70)); }
  return highpass(out, 5000);
}
function tone(note, len, shape = 'sine', { attack = 0.01, release = 0.1, cutoff = 0, vibrato = 0 } = {}) {
  const out = buffer(len); const f = midi(note); let phase = 0; const e = env(out.length, attack, release);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE; phase += (f * (1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t))) / RATE;
    const p = phase % 1;
    const v = shape === 'saw' ? saw(p) : shape === 'square' ? square(p) : shape === 'tri' ? tri(p) : Math.sin(2 * Math.PI * p);
    out[i] = v * e[i];
  }
  return cutoff ? lowpass(out, cutoff) : out;
}
function pluck(note, len = 0.6, damping = 0.996) { // Karplus-Strong
  const out = buffer(len); const period = Math.max(2, Math.round(RATE / midi(note)));
  const ring = Float32Array.from({ length: period }, noise);
  for (let i = 0; i < out.length; i += 1) { const j = i % period; const next = (j + 1) % period; const value = (ring[j] + ring[next]) * 0.5 * damping; out[i] = ring[j]; ring[j] = value; }
  return out;
}
function organ(note, len) {
  const out = buffer(len); const e = env(out.length, 0.03, 0.15);
  [1, 2, 3, 4].forEach((h, k) => { const f = midi(note) * h; for (let i = 0; i < out.length; i += 1) out[i] += Math.sin(2 * Math.PI * f * i / RATE) * e[i] * [0.6, 0.3, 0.15, 0.08][k]; });
  return out;
}
function logDrum(note, len = 0.5) {
  const out = buffer(len); let phase = 0;
  for (let i = 0; i < out.length; i += 1) { const t = i / RATE; const f = midi(note) * (1 + 0.6 * Math.exp(-t * 40)); phase += f / RATE; out[i] = Math.tanh(2.2 * Math.sin(2 * Math.PI * phase)) * Math.exp(-t * 6); }
  return lowpass(out, 900);
}
function chord(notes, len, shape = 'saw', cutoff = 1800) {
  const out = buffer(len);
  notes.forEach(n => add(out, tone(n, len, shape, { attack: 0.05, release: 0.2, cutoff }), 0, 1 / notes.length));
  return out;
}

// ---------- track builder ----------
function track({ bpm, bars = 6, steps }) {
  const beat = 60 / bpm; const length = bars * 4 * beat; const out = buffer(length);
  for (let bar = 0; bar < bars; bar += 1) steps(out, bar * 4 * beat, beat, bar);
  return out;
}
const loopSeconds = 12;
function fitLoop(out) { // trim to ~loopSeconds and fade edges so it loops cleanly
  const n = Math.min(out.length, loopSeconds * RATE); const result = out.slice(0, n); const fade = Math.floor(0.02 * RATE);
  for (let i = 0; i < fade; i += 1) { result[i] *= i / fade; result[n - 1 - i] *= i / fade; }
  return result;
}

const progressions = {
  afro: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [55, 59, 62]],
  minor: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  pop: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
  gospel: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]]
};

const MUSIC = {
  'sweet-salone-groove': track({ bpm: 104, steps: (o, s, b, bar) => {
    const ch = progressions.afro[bar % 4];
    [0, 1.5, 2, 3].forEach(x => add(o, kick(), s + x * b, 0.9));
    [1, 3].forEach(x => add(o, clap(), s + x * b, 0.5));
    for (let x = 0; x < 8; x += 1) add(o, hat(), s + x * b / 2 + (x % 2 ? 0.02 : 0), 0.25);
    [0, 0.75, 1.5, 2.5, 3].forEach((x, k) => add(o, pluck(ch[k % 3] + 12, 0.35), s + x * b, 0.35));
    add(o, tone(ch[0] - 24, 4 * b, 'sine', { release: 0.3 }), s, 0.45);
  } }),
  'freetown-lofi-nights': track({ bpm: 80, bars: 4, steps: (o, s, b, bar) => {
    const ch = progressions.minor[bar % 4];
    [0, 2.5].forEach(x => add(o, kick(0.4, 90, 40), s + x * b, 0.8));
    [1, 3].forEach(x => add(o, snare(), s + x * b, 0.35));
    for (let x = 0; x < 8; x += 1) add(o, hat(), s + x * b / 2 + (x % 2 ? 0.05 : 0), 0.15);
    add(o, chord(ch.map(n => n + 12), 4 * b, 'tri', 1200), s, 0.5);
    add(o, tone(ch[0] - 12, 2 * b, 'sine', { release: 0.4 }), s, 0.35);
  } }),
  'lion-mountain-trap': track({ bpm: 140, bars: 7, steps: (o, s, b, bar) => {
    [0, 0.75, 2.25].forEach(x => add(o, kick(0.6, 90, 35), s + x * b, 0.9));
    [2].forEach(x => add(o, clap(), s + x * b, 0.6));
    for (let x = 0; x < 16; x += 1) add(o, hat(0.04), s + x * b / 4, x % 4 === 3 ? 0.08 : 0.18);
    [0, 0.5, 1, 1.5].forEach((x, k) => add(o, tone([69, 72, 76, 72][(k + bar) % 4], 0.4, 'square', { cutoff: 2500 }), s + x * b * 2, 0.12));
  } }),
  'highlife-sunday': track({ bpm: 118, bars: 6, steps: (o, s, b, bar) => {
    const ch = progressions.pop[bar % 4];
    [0, 2].forEach(x => add(o, kick(), s + x * b, 0.7));
    for (let x = 0; x < 8; x += 1) add(o, hat(), s + x * b / 2, 0.2);
    [0, 0.5, 1, 1.75, 2.5, 3, 3.5].forEach((x, k) => add(o, pluck(ch[k % 3] + 12 + (k % 2 ? 12 : 0), 0.4, 0.994), s + x * b, 0.3));
    add(o, tone(ch[0] - 24, 3.5 * b, 'tri', { release: 0.2 }), s, 0.4);
  } }),
  'amapiano-log-drum': track({ bpm: 112, bars: 6, steps: (o, s, b, bar) => {
    const ch = progressions.minor[bar % 4];
    [0, 1, 2, 3].forEach(x => add(o, kick(0.3), s + x * b, 0.7));
    for (let x = 0; x < 16; x += 1) add(o, hat(0.03), s + x * b / 4, 0.12);
    [0.5, 1.75, 2.5, 3.25].forEach((x, k) => add(o, logDrum(ch[0] - 12 + [0, 3, 7, 5][k]), s + x * b, 0.6));
    add(o, chord(ch.map(n => n + 12), 4 * b, 'saw', 900), s, 0.25);
  } }),
  'gospel-praise-keys': track({ bpm: 92, bars: 5, steps: (o, s, b, bar) => {
    const ch = progressions.gospel[bar % 4];
    add(o, chord(ch, 4 * b, 'sine', 3000), s, 0.25);
    ch.forEach(n => add(o, organ(n, 4 * b), s, 0.12));
    [0, 2].forEach(x => add(o, kick(), s + x * b, 0.5));
    [1, 3].forEach(x => add(o, clap(), s + x * b, 0.45));
  } }),
  'party-drop-pluck': track({ bpm: 126, bars: 6, steps: (o, s, b, bar) => {
    const ch = progressions.pop[bar % 4];
    [0, 1, 2, 3].forEach(x => add(o, kick(0.3, 140, 50), s + x * b, 0.9));
    [0.5, 1.5, 2.5, 3.5].forEach(x => add(o, hat(0.1, true), s + x * b, 0.22));
    [1, 3].forEach(x => add(o, clap(), s + x * b, 0.45));
    for (let x = 0; x < 8; x += 1) add(o, tone(ch[x % 3] + 12, 0.18, 'saw', { release: 0.12, cutoff: 3000 }), s + x * b / 2, 0.18);
  } }),
  'island-reggae-skank': track({ bpm: 76, bars: 4, steps: (o, s, b, bar) => {
    const ch = progressions.pop[bar % 4];
    add(o, kick(0.4, 100, 45), s + 2 * b, 0.8);
    add(o, snare(), s + 2 * b, 0.35);
    [0.5, 1.5, 2.5, 3.5].forEach(x => add(o, chord(ch.map(n => n + 12), 0.18, 'square', 2200), s + x * b, 0.3));
    [0, 0.75, 1.5, 2.5].forEach((x, k) => add(o, tone(ch[k % 3] - 24, 0.45, 'sine', { release: 0.15 }), s + x * b, 0.5));
  } }),
  'neon-night-drive': track({ bpm: 100, bars: 5, steps: (o, s, b, bar) => {
    const ch = progressions.minor[bar % 4];
    [0, 2].forEach(x => add(o, kick(), s + x * b, 0.8));
    [1, 3].forEach(x => add(o, snare(0.3), s + x * b, 0.4));
    for (let x = 0; x < 16; x += 1) add(o, tone(ch[x % 3] + 12 + (x % 4 === 3 ? 12 : 0), 0.14, 'saw', { release: 0.08, cutoff: 2600 }), s + x * b / 4, 0.12);
    add(o, tone(ch[0] - 24, 4 * b, 'saw', { cutoff: 400, release: 0.2 }), s, 0.4);
  } }),
  'beach-ukulele-smile': track({ bpm: 110, bars: 6, steps: (o, s, b, bar) => {
    const ch = progressions.pop[bar % 4];
    [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].forEach((x, k) => ch.forEach((n, j) => add(o, pluck(n + 12, 0.3, 0.992), s + x * b + j * 0.012, k % 2 ? 0.12 : 0.18)));
    [0, 2].forEach(x => add(o, kick(0.25), s + x * b, 0.45));
    [1, 3].forEach(x => add(o, clap(0.15), s + x * b, 0.3));
  } })
};

// ---------- sound effects ----------
function sfxApplause() { const o = buffer(2.2); for (let k = 0; k < 140; k += 1) add(o, clap(0.08), rand() * 1.9, 0.25 + rand() * 0.2); return o; }
function sfxAirHorn() { const o = buffer(1.6); [0, 0.45].forEach((s, k) => { const len = k ? 1.1 : 0.35; [69, 69.15, 68.85, 81].forEach(n => add(o, tone(n, len, 'saw', { attack: 0.02, release: 0.08, cutoff: 3500 }), s, 0.22)); }); return o; }
function sfxBoing() { const o = buffer(0.9); let p = 0; for (let i = 0; i < o.length; i += 1) { const t = i / RATE; p += (180 + 260 * t + 60 * Math.sin(2 * Math.PI * 14 * t)) / RATE; o[i] = Math.sin(2 * Math.PI * p) * Math.exp(-t * 3.5); } return o; }
function sfxDrumRoll() { const o = buffer(2.4); for (let x = 0; x < 50; x += 1) add(o, snare(0.08), x * 0.04, 0.2 + x * 0.008); add(o, kick(0.5), 2.0, 0.9); const crash = buffer(0.4); for (let i = 0; i < crash.length; i += 1) crash[i] = noise() * Math.exp(-i / RATE * 6); add(o, highpass(crash, 3000), 2.0, 0.5); return o; }
function sfxLaugh() { const o = buffer(1.6); for (let k = 0; k < 6; k += 1) { const g = buffer(0.18); for (let i = 0; i < g.length; i += 1) { const t = i / RATE; g[i] = (Math.sin(2 * Math.PI * (260 - k * 12) * t) * 0.6 + Math.sin(2 * Math.PI * 800 * t) * 0.25 + noise() * 0.1) * Math.sin(Math.PI * t / 0.18); } add(o, g, k * 0.22, 0.6); } return o; }
function sfxSadTrombone() { const o = buffer(2.4); [[58, 0.4], [57, 0.4], [56, 0.4], [55, 1.1]].reduce((s, [n, len]) => { add(o, tone(n, len, 'saw', { attack: 0.04, release: 0.1, cutoff: 1400, vibrato: len > 1 ? 0.03 : 0.006 }), s, 0.35); return s + len; }, 0); return o; }
function sfxWhoosh() { const o = buffer(0.9); for (let i = 0; i < o.length; i += 1) { const t = i / RATE; o[i] = noise() * Math.sin(Math.PI * t / 0.9) ** 2; } return lowpass(highpass(o, 600), 3000); }
function sfxShutter() { const o = buffer(0.35); [0, 0.12].forEach(s => { const c = buffer(0.05); for (let i = 0; i < c.length; i += 1) c[i] = noise() * Math.exp(-i / RATE * 120); add(o, highpass(c, 1500), s, 0.9); }); return o; }
function sfxPop() { const o = buffer(0.2); let p = 0; for (let i = 0; i < o.length; i += 1) { const t = i / RATE; p += (900 * Math.exp(-t * 25) + 200) / RATE; o[i] = Math.sin(2 * Math.PI * p) * Math.exp(-t * 30); } return o; }
function sfxCrowdCheer() { const o = buffer(2.8); const crowd = buffer(2.8); for (let i = 0; i < crowd.length; i += 1) { const t = i / RATE; crowd[i] = noise() * Math.min(1, t * 2) * Math.min(1, (2.8 - t) * 1.5); } add(o, lowpass(highpass(crowd, 400), 2500), 0, 0.8); for (let k = 0; k < 4; k += 1) add(o, tone(84 + k, 0.35, 'sine', { vibrato: 0.02 }), 0.3 + k * 0.5, 0.12); for (let k = 0; k < 60; k += 1) add(o, clap(0.06), 0.4 + rand() * 2.1, 0.15); return o; }
function sfxDing() { const o = buffer(1.5); [88, 95].forEach((n, k) => { const t = buffer(1.5); for (let i = 0; i < t.length; i += 1) t[i] = Math.sin(2 * Math.PI * midi(n) * i / RATE) * Math.exp(-i / RATE * 3); add(o, t, 0, k ? 0.2 : 0.5); }); return o; }
function sfxScratch() { const o = buffer(0.7); let p = 0; for (let i = 0; i < o.length; i += 1) { const t = i / RATE; const speed = Math.sin(2 * Math.PI * 3 * t); p += (300 * speed) / RATE; o[i] = (saw(Math.abs(p) % 1) * 0.5 + noise() * 0.3) * Math.abs(speed); } return lowpass(o, 2500); }

const SFX = {
  applause: sfxApplause(), 'air-horn': sfxAirHorn(), boing: sfxBoing(), 'drum-roll': sfxDrumRoll(), laugh: sfxLaugh(), 'sad-trombone': sfxSadTrombone(),
  whoosh: sfxWhoosh(), 'camera-shutter': sfxShutter(), pop: sfxPop(), 'crowd-cheer': sfxCrowdCheer(), ding: sfxDing(), 'record-scratch': sfxScratch()
};

// ---------- WAV writer ----------
function writeWav(file, samples, peak = 0.85) {
  let max = 0; for (const v of samples) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? peak / max : 1;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * scale * 32767))), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

for (const [name, samples] of Object.entries(MUSIC)) writeWav(path.join(root, 'music', `${name}.wav`), fitLoop(samples));
for (const [name, samples] of Object.entries(SFX)) writeWav(path.join(root, 'sfx', `${name}.wav`), samples, 0.9);
console.log(`Wrote ${Object.keys(MUSIC).length} music loops and ${Object.keys(SFX).length} sound effects to ${root}`);
