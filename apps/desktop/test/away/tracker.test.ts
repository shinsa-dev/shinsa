import { describe, expect, it } from 'bun:test';
import { NO_INPUT_YET } from '../../src/away/schema.ts';
import { applyPowerEvent, observeInput } from '../../src/away/tracker.ts';

const MINUTE = 60_000;

describe('time away from your Mac', () => {
  it('starts from the first input it sees and finds nothing while you keep working', () => {
    const first = observeInput(NO_INPUT_YET, 10 * MINUTE, MINUTE);
    expect(first).toEqual({ state: { lastInput: 9 * MINUTE, frozen: false }, span: null });
    const later = observeInput(first.state, 19 * MINUTE, 0);
    expect(later.span).toBeNull();
  });

  it('counts you away from 10 minutes after your last input until your next one', () => {
    const working = observeInput(NO_INPUT_YET, 0, 0).state;
    const idle = observeInput(working, 25 * MINUTE, 25 * MINUTE);
    expect(idle.span).toBeNull();
    expect(observeInput(idle.state, 30 * MINUTE, 0)).toEqual({
      state: { lastInput: 30 * MINUTE, frozen: false },
      span: { from: 10 * MINUTE, to: 30 * MINUTE },
    });
  });

  it('counts a locked or sleeping Mac as away, whatever moves while it is locked', () => {
    const working = observeInput(NO_INPUT_YET, 0, 0).state;
    const locked = applyPowerEvent(working, 'lock', 2 * MINUTE, 0);
    expect(locked).toEqual({ state: { lastInput: 2 * MINUTE, frozen: true }, span: null });
    expect(observeInput(locked.state, 30 * MINUTE, 0)).toEqual({ state: locked.state, span: null });
    const asleep = applyPowerEvent(locked.state, 'suspend', 3 * MINUTE, MINUTE);
    expect(applyPowerEvent(asleep.state, 'resume', 60 * MINUTE, 0).span).toEqual({
      from: 2 * MINUTE,
      to: 60 * MINUTE,
    });
    expect(applyPowerEvent(locked.state, 'unlock', 5 * MINUTE, 0).span).toEqual({
      from: 2 * MINUTE,
      to: 5 * MINUTE,
    });
  });

  it('counts no time away when you come back before your last input moves on', () => {
    const working = observeInput(NO_INPUT_YET, 0, 0).state;
    const locked = applyPowerEvent(working, 'lock', 2 * MINUTE, 0).state;
    expect(applyPowerEvent(locked, 'unlock', 3 * MINUTE, MINUTE)).toEqual({
      state: { lastInput: 2 * MINUTE, frozen: false },
      span: null,
    });
  });

  it('waits for your first input when the Mac locks before it saw any', () => {
    const locked = applyPowerEvent(NO_INPUT_YET, 'lock', 0, 0).state;
    expect(applyPowerEvent({ ...locked, lastInput: null }, 'unlock', 5 * MINUTE, 0)).toEqual({
      state: { lastInput: 5 * MINUTE, frozen: false },
      span: null,
    });
  });
});
