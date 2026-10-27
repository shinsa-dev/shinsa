import { describe, expect, it } from 'bun:test';
import { listRoundEvidence, resolveEvidenceMedia } from '@/lib/evidence/media.ts';
import { createRound } from '../../support/rounds.ts';
import { createEvidence, createShinsaState, createTask, NOW } from '../../support/state.ts';

describe('resolveEvidenceMedia', () => {
  it('reads stored evidence by its extension, in any case', () => {
    expect(resolveEvidenceMedia('/api/evidence/shot.png')).toBe('image');
    expect(resolveEvidenceMedia('/api/evidence/shot.JPEG')).toBe('image');
    expect(resolveEvidenceMedia('/api/evidence/run.webm')).toBe('video');
    expect(resolveEvidenceMedia('/api/evidence/output.log')).toBe('text');
    expect(resolveEvidenceMedia('/api/evidence/notes.md')).toBe('text');
    expect(resolveEvidenceMedia('/api/evidence/trace.zip')).toBe('file');
  });

  it('reads the extension before a query string', () => {
    expect(resolveEvidenceMedia('/api/evidence/shot.png?v=2')).toBe('image');
    expect(resolveEvidenceMedia('/api/evidence/run.mp4?t=1')).toBe('video');
    expect(resolveEvidenceMedia('/api/evidence/output.log?raw')).toBe('text');
  });

  it('reads a file the app serves by its extension too', () => {
    expect(resolveEvidenceMedia('/samples/evidence/tabs.webm')).toBe('video');
  });

  it('treats anything another site serves as a link, whatever it ends in', () => {
    expect(resolveEvidenceMedia('https://example.com/shot.png')).toBe('link');
    expect(resolveEvidenceMedia('//cdn.example.com/shot.png')).toBe('link');
    expect(resolveEvidenceMedia('https://github.com/acme/app/actions/runs/1')).toBe('link');
  });
});

describe('listRoundEvidence', () => {
  it('lists one task’s evidence, oldest first', () => {
    const state = createShinsaState({
      evidence: [
        createEvidence({ id: 'late', taskId: 'task-1', attachedAt: NOW }),
        createEvidence({ id: 'other', taskId: 'task-2', attachedAt: NOW - 10 }),
        createEvidence({ id: 'early', taskId: 'task-1', attachedAt: NOW - 100 }),
      ],
    });
    const task = createTask({ id: 'task-1' });
    expect(listRoundEvidence(state.evidence, task).map((item) => item.id)).toEqual(['early', 'late']);
    expect(listRoundEvidence(state.evidence, createTask({ id: 'unknown' }))).toEqual([]);
  });

  it('leaves out what earlier rounds attached', () => {
    const state = createShinsaState({
      evidence: [
        createEvidence({ id: 'first', taskId: 'task-1', attachedAt: NOW - 100 }),
        createEvidence({ id: 'second', taskId: 'task-1', attachedAt: NOW, round: 2 }),
      ],
    });
    const task = createTask({
      id: 'task-1',
      rounds: [createRound({ number: 1 }), createRound({ number: 2, status: 'active', outcome: null })],
    });
    expect(listRoundEvidence(state.evidence, task).map((item) => item.id)).toEqual(['second']);
  });
});
