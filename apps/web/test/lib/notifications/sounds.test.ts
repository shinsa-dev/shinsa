import { afterEach, describe, expect, it } from 'bun:test';
import { isUnfocused, playSound, shouldAlert } from '@/lib/notifications/sounds.ts';
import { installAudio } from '../../support/notifications.ts';

let audio: ReturnType<typeof installAudio> | null = null;

afterEach(() => {
  audio?.restore();
  audio = null;
});

describe('when to alert', () => {
  const visible = { visibilityState: 'visible' as const, hasFocus: () => true };
  const blurred = { visibilityState: 'visible' as const, hasFocus: () => false };
  const hidden = { visibilityState: 'hidden' as const, hasFocus: () => true };

  it('counts a hidden tab or an unfocused window as away', () => {
    expect([isUnfocused(visible), isUnfocused(blurred), isUnfocused(hidden)]).toEqual([false, true, true]);
  });

  it('never, always, or only while away', () => {
    expect(shouldAlert('never', blurred)).toBe(false);
    expect(shouldAlert('always', visible)).toBe(true);
    expect(shouldAlert('unfocused', visible)).toBe(false);
    expect(shouldAlert('unfocused', blurred)).toBe(true);
  });
});

describe('playing a sound through Web Audio', () => {
  it('does nothing without Web Audio or with nothing to play', async () => {
    expect(await playSound('chime')).toBe(false);
    audio = installAudio();
    expect(await playSound('chime', 0)).toBe(false);
    expect(audio.played).toEqual([]);
  });

  it('plays each sound’s notes from oscillators, never a media element, and cleans up', async () => {
    audio = installAudio('suspended');
    expect(await playSound('chime')).toBe(true);
    expect(audio.created).toHaveLength(1);
    expect(audio.created[0]?.resumed).toBe(1);
    expect(audio.played.map((note) => [note.type, note.frequency, note.start])).toEqual([
      ['sine', 880, 10],
      ['sine', 1318.5, 10.12],
    ]);
    expect(audio.disconnected).toEqual(['oscillator', 'gain', 'oscillator', 'gain']);
    await playSound('ping');
    await playSound('pop');
    expect(audio.played.map((note) => note.type)).toEqual(['sine', 'sine', 'sine', 'triangle', 'triangle']);
  });

  it('plays nothing while the browser keeps audio suspended, so no chime arrives late', async () => {
    audio = installAudio('suspended', true);
    expect(await playSound('pop')).toBe(false);
    expect(audio.played).toEqual([]);
  });

  it('repeats for a burst, at most three times', async () => {
    audio = installAudio();
    await playSound('ping', 5);
    expect(audio.played.map((note) => Number((note.start - 10).toFixed(2)))).toEqual([0, 0.14, 0.28]);
  });
});
