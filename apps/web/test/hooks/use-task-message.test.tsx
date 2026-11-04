import { describe, expect, it, mock } from 'bun:test';
import { renderHook } from '@testing-library/react';
import * as React from 'react';
import { useTaskMessage } from '@/hooks/use-task-message.ts';
import { ReviewDraftContext } from '@/lib/review/draft.ts';
import { resolveMessageHint } from '@/lib/tasks/messages.ts';
import { spyOnCommands } from '../support/commands.ts';
import { createShinsaState, createTask } from '../support/state.ts';

const COMMENT = {
  id: 'c1',
  path: 'a.ts',
  side: 'new' as const,
  line: 2,
  endLine: null,
  ref: 'abc',
  text: 'Rename.',
};

function renderMessage(withMessages: boolean) {
  const clearComments = mock(() => {});
  const task = createTask({ id: 't', stage: 'building' });
  const hint = resolveMessageHint(createShinsaState({ tasks: [task] }), task);
  if (!hint) throw new Error('The task takes no message.');
  const base = renderHook(() => React.useContext(ReviewDraftContext)).result.current;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ReviewDraftContext value={{ ...base, withMessages, comments: [COMMENT], clearComments }}>
      {children}
    </ReviewDraftContext>
  );
  const { result } = renderHook(() => useTaskMessage(task), { wrapper });
  return { result, hint, clearComments };
}

describe('useTaskMessage', () => {
  it('sends the draft’s comments with the message and clears them once it is sent', async () => {
    const commands = spyOnCommands();
    const { result, hint, clearComments } = renderMessage(true);
    expect(result.current.comments).toEqual([COMMENT]);
    expect(await result.current.send(hint, 'Use tabs')).toBe(true);
    expect(clearComments).toHaveBeenCalledTimes(1);
    commands.sent.mockResolvedValue(false);
    expect(await result.current.send(hint, 'Again')).toBe(false);
    expect(clearComments).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft when the message carries no comments', async () => {
    spyOnCommands();
    const { result, hint, clearComments } = renderMessage(false);
    expect(result.current.comments).toEqual([]);
    expect(await result.current.send(hint, 'Use tabs')).toBe(true);
    expect(clearComments).not.toHaveBeenCalled();
  });
});
