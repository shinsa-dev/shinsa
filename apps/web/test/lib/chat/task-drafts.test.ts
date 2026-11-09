import { describe, expect, it, mock } from 'bun:test';
import {
  requestDraftReply,
  takeFocusRequest,
  carryDraftFocus,
  clearTaskDraft,
  removeCarriedCaret,
  resetTaskDrafts,
  resolveTaskDraft,
  subscribeTaskDrafts,
  takeCarriedCaret,
  taskDraftFiles,
  updateTaskDraft,
} from '@/lib/chat/task-drafts.ts';

const attachment = {
  key: 'file-1',
  name: 'shot.png',
  kind: 'image' as const,
  mimeType: 'image/png',
  size: 4,
  preview: null,
  stored: null,
};

describe('task drafts', () => {
  it('starts every task empty and keeps each task’s draft apart', () => {
    expect(resolveTaskDraft('task-a')).toEqual({
      text: '',
      attachments: [],
      carriedCaret: null,
      focusRequested: false,
    });
    updateTaskDraft('task-a', () => ({ text: 'Hello' }));
    updateTaskDraft('task-a', (draft) => ({ attachments: [...draft.attachments, attachment] }));
    expect(resolveTaskDraft('task-a')).toEqual({
      text: 'Hello',
      attachments: [attachment],
      carriedCaret: null,
      focusRequested: false,
    });
    expect(resolveTaskDraft('task-b').text).toBe('');
  });

  it('quotes a question above the draft and asks the composer to focus once', () => {
    updateTaskDraft('task-q', () => ({ text: 'Earlier' }));
    requestDraftReply('task-q', 'Merge it first?');
    expect(resolveTaskDraft('task-q').text).toBe('> Merge it first?\n\nEarlier');
    expect(takeFocusRequest('task-q')).toBe(true);
    expect(takeFocusRequest('task-q')).toBe(false);
  });

  it('tells every subscriber of a change until it unsubscribes', () => {
    const listener = mock(() => undefined);
    const unsubscribe = subscribeTaskDrafts(listener);
    updateTaskDraft('task-a', () => ({ text: 'H' }));
    clearTaskDraft('task-a');
    unsubscribe();
    updateTaskDraft('task-a', () => ({ text: 'Hi' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('drops the files of a cleared draft and keeps the others', () => {
    taskDraftFiles.set('file-1', new File(['data'], 'shot.png'));
    taskDraftFiles.set('file-2', new File(['data'], 'other.png'));
    updateTaskDraft('task-a', () => ({ text: 'Hi', attachments: [attachment] }));
    updateTaskDraft('task-b', () => ({ attachments: [{ ...attachment, key: 'file-2' }] }));
    clearTaskDraft('task-a');
    expect(resolveTaskDraft('task-a').text).toBe('');
    expect([...taskDraftFiles.keys()]).toEqual(['file-2']);
    resetTaskDrafts();
    expect(resolveTaskDraft('task-b').attachments).toEqual([]);
    expect(taskDraftFiles.size).toBe(0);
  });

  it('hands a carried caret to the next input once, and keeps the text', () => {
    updateTaskDraft('task-a', () => ({ text: 'Hello' }));
    expect(takeCarriedCaret('task-a')).toBeNull();
    carryDraftFocus('task-a', { start: 2, end: 4 });
    expect(takeCarriedCaret('task-a')).toEqual({ start: 2, end: 4 });
    expect(takeCarriedCaret('task-a')).toBeNull();
    expect(resolveTaskDraft('task-a').text).toBe('Hello');
  });

  it('drops a carried caret no input took, and leaves the rest of the draft', () => {
    const listener = mock(() => undefined);
    const stop = subscribeTaskDrafts(listener);
    removeCarriedCaret('task-a');
    expect(listener).not.toHaveBeenCalled();
    updateTaskDraft('task-a', () => ({ text: 'Hello' }));
    carryDraftFocus('task-a', { start: 1, end: 1 });
    removeCarriedCaret('task-a');
    stop();
    expect(takeCarriedCaret('task-a')).toBeNull();
    expect(resolveTaskDraft('task-a').text).toBe('Hello');
  });
});
