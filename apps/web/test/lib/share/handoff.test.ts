import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  canHandOff,
  closeHandoffRemoveConfirm,
  describeHandoffBanner,
  describeHandoffClaim,
  describeHandoffMark,
  HANDOFF_ICON,
  handOffTask,
  isTaskHandedOff,
  openHandoffRemoveConfirm,
  removeHandoff,
  resolveHandoffFact,
  resolveHandoffView,
  useHandoffRemoveConfirm,
} from '@/lib/share/handoff.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createTask } from '../../support/state.ts';

const KAI = { id: 'u2', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const HANDED = { at: 5, url: null, guest: null, claimedAt: null };

afterEach(() => {
  closeHandoffRemoveConfirm();
});

describe('handing a task off', () => {
  it('offers it on an open task and on one already handed off, never on a finished task or an automation', () => {
    expect(canHandOff(createTask({ id: 't1', stage: 'building' }))).toBe(true);
    expect(canHandOff(createTask({ id: 't1', stage: 'done' }))).toBe(false);
    expect(
      canHandOff(createTask({ id: 't1', stage: 'done', handoff: { ...HANDED, guest: KAI, claimedAt: 9 } }))
    ).toBe(true);
    expect(canHandOff(createTask({ id: 't1', stage: 'building', watchHome: true }))).toBe(false);
  });

  it('waits for the link, shows it, says why it failed and who took the task over', () => {
    expect(resolveHandoffView(createTask({ id: 't1' }))).toEqual({ kind: 'off' });
    expect(resolveHandoffView(createTask({ id: 't1', handoff: HANDED }))).toEqual({ kind: 'linking' });
    expect(resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, url: 'https://x' } }))).toEqual({
      kind: 'ready',
      url: 'https://x',
    });
    expect(
      resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, failure: 'Remote access is off.' } }))
    ).toEqual({
      kind: 'failed',
      message: 'Remote access is off.',
    });
    expect(
      resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, guest: KAI, claimedAt: 9 } }))
    ).toEqual({
      kind: 'claimed',
      guest: KAI,
      at: 9,
    });
    expect(resolveHandoffView(createTask({ id: 't1', handoff: { ...HANDED, guest: KAI } }))).toMatchObject({
      at: 5,
    });
    expect(describeHandoffClaim(KAI)).toBe('Kai Lane is working on this task');
    expect(describeHandoffClaim({ ...KAI, name: null })).toBe('@kai is working on this task');
    expect(describeHandoffBanner({ kind: 'off' })).toBeNull();
    expect(describeHandoffBanner({ kind: 'linking' })).toBe('Making the hand-off link.');
    expect(describeHandoffBanner({ kind: 'failed', message: 'Remote access is off.' })).toBe(
      'The hand-off link couldn’t be made. Remote access is off.'
    );
    expect(describeHandoffBanner({ kind: 'ready', url: 'https://x' })).toContain('first GitHub account');
    expect(describeHandoffBanner({ kind: 'claimed', guest: KAI, at: 9 })).toBe(
      'Kai Lane is working on this task. It stays yours.'
    );
  });

  it('marks a task handed off or waiting on its link, and names who has it on each side', () => {
    const LEE = { id: 'u1', login: 'lee', name: 'Lee Park', avatarUrl: null };
    const claimed = createTask({ id: 't1', handoff: { ...HANDED, guest: KAI, claimedAt: 9 } });
    const ready = createTask({ id: 't1', handoff: { ...HANDED, url: 'https://x' } });
    expect(HANDOFF_ICON).toBe('IconHandshake');
    expect(isTaskHandedOff(createTask({ id: 't1' }))).toBe(false);
    expect(isTaskHandedOff(createTask({ id: 't1', handoff: HANDED }))).toBe(false);
    expect(
      isTaskHandedOff(createTask({ id: 't1', handoff: { ...HANDED, url: 'https://x', failure: 'No.' } }))
    ).toBe(false);
    expect(isTaskHandedOff(ready)).toBe(true);
    expect(isTaskHandedOff(claimed)).toBe(true);
    expect(describeHandoffMark(claimed, null)).toBe('Handed to Kai Lane');
    expect(describeHandoffMark(ready, null)).toBe('Hand-off link not opened yet');
    expect(describeHandoffMark(claimed, LEE)).toBe('Handed to you by Lee Park');
    expect(resolveHandoffFact(ready, null)).toBeNull();
    expect(resolveHandoffFact(claimed, null)).toMatchObject({ verb: 'Handed to', user: KAI });
    expect(resolveHandoffFact(claimed, LEE)).toMatchObject({ verb: 'Handed to you by', user: LEE });
  });

  it('sends the hand-off and its removal, naming who loses the task', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't' });
    await handOffTask(task);
    await removeHandoff({ ...task, handoff: { ...HANDED, url: 'https://x' } });
    await removeHandoff({ ...task, handoff: { ...HANDED, guest: KAI, claimedAt: 9 } });
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.hand_off', taskId: 't' }],
      [{ type: 'handoff.remove', taskId: 't' }, 'The hand-off link is off.'],
      [{ type: 'handoff.remove', taskId: 't' }, 'Kai Lane no longer has this task.'],
    ]);
    spies.restore();
  });

  it('opens and closes the removal confirmation for one task', () => {
    const { result } = renderHook(() => useHandoffRemoveConfirm());
    expect(result.current).toBeNull();
    act(() => openHandoffRemoveConfirm('t'));
    expect(result.current).toBe('t');
    act(() => closeHandoffRemoveConfirm());
    expect(result.current).toBeNull();
  });
});
