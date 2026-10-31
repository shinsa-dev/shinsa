import { describe, expect, it, mock } from 'bun:test';
import {
  clearTaskDraft,
  resetTaskDrafts,
  resolveTaskDraft,
  subscribeTaskDrafts,
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
    expect(resolveTaskDraft('task-a')).toEqual({ text: '', attachments: [] });
    updateTaskDraft('task-a', () => ({ text: 'Hello' }));
    updateTaskDraft('task-a', (draft) => ({ attachments: [...draft.attachments, attachment] }));
    expect(resolveTaskDraft('task-a')).toEqual({ text: 'Hello', attachments: [attachment] });
    expect(resolveTaskDraft('task-b').text).toBe('');
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
});
