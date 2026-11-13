import { MINUTE_MS } from '../domain/time.ts';
import { type AwayState, type AwayStep, MAC_AWAY_AFTER_MINUTES, type PowerEvent } from './schema.ts';

const AWAY_AFTER_MS = MAC_AWAY_AFTER_MINUTES * MINUTE_MS;

export function observeInput(state: AwayState, now: number, idleMs: number): AwayStep {
  if (state.frozen) return { state, span: null };
  const input = now - idleMs;
  const previous = state.lastInput;
  const next = { ...state, lastInput: Math.max(input, previous ?? input) };
  if (previous === null || input - previous <= AWAY_AFTER_MS) return { state: next, span: null };
  return { state: next, span: { from: previous + AWAY_AFTER_MS, to: input } };
}

export function applyPowerEvent(state: AwayState, event: PowerEvent, now: number, idleMs: number): AwayStep {
  if (event === 'lock' || event === 'suspend') {
    const observed = observeInput(state, now, idleMs);
    return { state: { ...observed.state, frozen: true }, span: observed.span };
  }
  if (!state.frozen || state.lastInput === null)
    return observeInput({ ...state, frozen: false }, now, idleMs);
  return resumeFrom(state.lastInput, now - idleMs);
}

function resumeFrom(before: number, input: number): AwayStep {
  const state = { lastInput: Math.max(before, input), frozen: false };
  return { state, span: input > before ? { from: before, to: input } : null };
}
