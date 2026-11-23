export type GameSound = 'tick' | 'ding' | 'buzz' | 'win' | 'lose' | 'draw' | 'start';

let context: AudioContext | null = null;

function audioContext() {
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, volume = 0.12, type: OscillatorType = 'sine') {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playSound(type: GameSound, enabled = true) {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const ctx = audioContext();
    const now = ctx.currentTime + 0.005;
    if (type === 'tick') tone(ctx, 600, now, 0.05, 0.07);
    else if (type === 'ding') tone(ctx, 880, now, 0.15, 0.1);
    else if (type === 'buzz') tone(ctx, 180, now, 0.2, 0.12, 'triangle');
    else if (type === 'start') tone(ctx, 400, now, 0.1, 0.1);
    else if (type === 'win') [523, 659, 784, 1046].forEach((hz, i) => tone(ctx, hz, now + i * 0.17, 0.22, 0.13));
    else if (type === 'lose') [784, 659, 523].forEach((hz, i) => tone(ctx, hz, now + i * 0.18, 0.25, 0.12));
    else if (type === 'draw') [440, 440].forEach((hz, i) => tone(ctx, hz, now + i * 0.2, 0.18, 0.1));
  } catch {
    // Audio is optional; gameplay still works when the browser blocks audio.
  }
}
