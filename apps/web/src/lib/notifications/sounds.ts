import type { AlertPreference, SoundId } from '@/lib/preferences/notifications.ts';

type FocusDocument = Pick<Document, 'visibilityState' | 'hasFocus'>;

interface Note {
  frequency: number;
  start: number;
  length: number;
}

const SOUNDS: Record<SoundId, { wave: OscillatorType; notes: Note[] }> = {
  chime: {
    wave: 'sine',
    notes: [
      { frequency: 880, start: 0, length: 0.5 },
      { frequency: 1318.5, start: 0.12, length: 0.6 },
    ],
  },
  ping: { wave: 'sine', notes: [{ frequency: 1567.98, start: 0, length: 0.35 }] },
  pop: {
    wave: 'triangle',
    notes: [
      { frequency: 523.25, start: 0, length: 0.12 },
      { frequency: 783.99, start: 0.07, length: 0.14 },
    ],
  },
};

const PEAK = 0.18;

const BURST_GAP_MS = 140;

let context: AudioContext | null = null;

export function isUnfocused(doc: FocusDocument) {
  return doc.visibilityState !== 'visible' || !doc.hasFocus();
}

export function shouldAlert(preference: AlertPreference, doc: FocusDocument) {
  if (preference === 'never') return false;
  return preference === 'always' || isUnfocused(doc);
}

function resolveContext() {
  if (!(context instanceof AudioContext)) context = new AudioContext();
  return context;
}

function playNote(audio: AudioContext, wave: OscillatorType, note: Note) {
  const at = audio.currentTime + note.start;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(note.frequency, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(PEAK, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + note.length);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(at);
  oscillator.stop(at + note.length + 0.02);
}

async function resumeAudio(audio: AudioContext) {
  try {
    await audio.resume();
    return true;
  } catch {
    return false;
  }
}

export async function playSound(soundId: SoundId, count = 1) {
  if (typeof AudioContext === 'undefined' || count <= 0) return false;
  const audio = resolveContext();
  if (audio.state === 'suspended' && !(await resumeAudio(audio))) return false;
  const sound = SOUNDS[soundId];
  for (let index = 0; index < Math.min(count, 3); index += 1) {
    const offset = (index * BURST_GAP_MS) / 1000;
    for (const note of sound.notes) playNote(audio, sound.wave, { ...note, start: note.start + offset });
  }
  return true;
}
