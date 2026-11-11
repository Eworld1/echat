export type ChatSound = 'message_in' | 'message_out' | 'typing';

let audioContext: AudioContext | null = null;
let volume = Number(localStorage.getItem('echat_chat_sound_volume') || '0.55');

function getContext(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
  return audioContext;
}

if (typeof window !== 'undefined') {
  const unlock = () => { const context = getContext(); if (context?.state === 'suspended') void context.resume().catch(() => {}); };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function setChatSoundVolume(nextVolume: number) {
  volume = Math.max(0, Math.min(1, nextVolume));
  localStorage.setItem('echat_chat_sound_volume', String(volume));
}

export function playSound(sound: ChatSound) {
  if (localStorage.getItem('echat_chat_sound') === 'false') return;
  const context = getContext();
  if (!context) return;
  const now = context.currentTime;
  const notes = sound === 'message_in' ? [{ f: 740, t: 0 }, { f: 980, t: 0.07 }] : sound === 'message_out' ? [{ f: 520, t: 0 }] : [{ f: 620, t: 0 }];
  notes.forEach(({ f, t }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(f, now + t);
    gain.gain.setValueAtTime(0.0001, now + t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * (sound === 'typing' ? 0.08 : 0.16)), now + t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t + (sound === 'typing' ? 0.035 : 0.11));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + t);
    oscillator.stop(now + t + 0.12);
  });
}
