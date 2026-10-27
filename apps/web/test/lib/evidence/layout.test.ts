import { describe, expect, it } from 'bun:test';
import type { Evidence } from '@shinsa/core';
import {
  describeEvidenceFacts,
  describeEvidenceKind,
  describeEvidencePart,
  describeEvidenceStage,
  describeEvidenceSummary,
  listEvidencePrefetch,
  resolveEvidenceFolder,
  resolveEvidenceLayout,
  shortenHomePath,
} from '@/lib/evidence/layout.ts';
import { createEvidence, createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

const STORED = '/api/evidence/task-1/round-1';

function shot(id: string, at: number, overrides: Partial<Evidence>) {
  return createEvidence({
    id,
    taskId: 'task-1',
    runId: 'build',
    uri: `${STORED}/${id}.png`,
    attachedAt: NOW - 1_000 + at,
    ...overrides,
  });
}

describe('the evidence facts', () => {
  it('reads the width and theme, and the stage on its own', () => {
    const evidence = createEvidence({ id: 'a', taskId: 't', width: 1280, theme: 'dark', stage: 'before' });
    expect(describeEvidenceFacts(evidence)).toBe('1280px · Dark');
    expect(describeEvidenceFacts(createEvidence({ id: 'b', taskId: 't', theme: 'light' }))).toBe('Light');
    expect(describeEvidenceFacts(createEvidence({ id: 'c', taskId: 't' }))).toBe('');
    expect(describeEvidenceStage(evidence)).toBe('Before');
    expect(describeEvidenceStage(createEvidence({ id: 'd', taskId: 't', stage: 'after' }))).toBe('After');
    expect(describeEvidenceStage(createEvidence({ id: 'e', taskId: 't' }))).toBeNull();
  });

  it('names a part by its label, its stage or the title', () => {
    expect(
      describeEvidencePart(createEvidence({ id: 'a', taskId: 't', label: 'Empty', stage: 'before' }))
    ).toBe('Empty');
    expect(describeEvidencePart(createEvidence({ id: 'b', taskId: 't', stage: 'after' }))).toBe('After');
    expect(describeEvidencePart(createEvidence({ id: 'c', taskId: 't', title: 'Menu' }))).toBe('Menu');
  });

  it('sums up the items by kind, a comparison counted once', () => {
    const evidence = [
      createEvidence({ id: 'b', taskId: 't', title: 'Home', stage: 'before' }),
      createEvidence({ id: 'a', taskId: 't', title: 'Home', stage: 'after' }),
      createEvidence({ id: 'c', taskId: 't', kind: 'recording' }),
      createEvidence({ id: 'd', taskId: 't', kind: 'test' }),
      createEvidence({ id: 'e', taskId: 't', kind: 'test' }),
    ];
    expect(describeEvidenceSummary(evidence)).toBe('1 comparison, 1 recording and 2 test runs');
    expect(describeEvidenceSummary(evidence.slice(2, 3))).toBe('1 recording');
    expect(describeEvidenceKind('check', 2)).toBe('Check runs');
  });
});

describe('where the evidence is stored', () => {
  it('is the round’s folder under the data directory', () => {
    const evidence = [
      createEvidence({ id: 'link', taskId: 't', uri: 'https://preview.dev' }),
      createEvidence({ id: 'chat', taskId: 't', uri: '/api/evidence/seed-image-1.png' }),
      createEvidence({ id: 'shot', taskId: 't', uri: `${STORED}/shot.png` }),
    ];
    expect(resolveEvidenceFolder('/Users/ada/.config/shinsa/data/', evidence)).toBe(
      '/Users/ada/.config/shinsa/data/evidence/task-1/round-1'
    );
    expect(resolveEvidenceFolder(null, evidence)).toBeNull();
    expect(resolveEvidenceFolder('/data', evidence.slice(0, 2))).toBeNull();
  });

  it('shortens a home folder to a tilde', () => {
    expect(shortenHomePath('/Users/ada/.config/shinsa')).toBe('~/.config/shinsa');
    expect(shortenHomePath('/home/ada/shinsa')).toBe('~/shinsa');
    expect(shortenHomePath('/tmp/seed/data')).toBe('/tmp/seed/data');
  });
});

describe('resolveEvidenceLayout', () => {
  it('groups items by kind, a before and its after as one comparison, and numbers the images item by item', () => {
    const evidence = [
      shot('dark-before', 1, { title: 'Settings', width: 1280, theme: 'dark', stage: 'before' }),
      shot('light-after', 2, { title: 'Settings', width: 1280, theme: 'light', stage: 'after' }),
      shot('dark-after', 3, { title: 'Settings', width: 1280, theme: 'dark', stage: 'after' }),
      shot('empty', 4, { title: 'Inbox', itemId: 'inbox', label: 'Empty', detail: 'Empty' }),
      shot('full', 5, { title: 'Inbox', itemId: 'inbox', label: 'Full', detail: 'Full' }),
      shot('clip', 6, { kind: 'recording', title: 'Scrolling', uri: `${STORED}/clip.webm`, runId: 'review' }),
      shot('plain', 7, { title: 'Menu' }),
      shot('tests', 8, { kind: 'test', title: 'Tests', uri: `${STORED}/tests.txt` }),
      shot('preview', 9, { kind: 'preview', title: 'Preview', uri: 'https://preview.dev' }),
      shot('trace', 10, { kind: 'note', title: 'Trace', uri: `${STORED}/trace.zip`, runId: null }),
      createEvidence({ id: 'other', taskId: 'task-2' }),
    ];
    const state = createShinsaState({
      evidence,
      runs: [
        createRun({ id: 'build', taskId: 'task-1' }),
        createRun({ id: 'review', taskId: 'task-1', role: 'reviewer' }),
      ],
    });
    const layout = resolveEvidenceLayout(state, createTask({ id: 'task-1' }), '/data');
    expect(layout.count).toBe(8);
    expect(layout.groups.map((group) => [group.label, group.entries.map((entry) => entry.key)])).toEqual([
      ['Comparisons', ['dark-before', 'inbox']],
      ['Recording', ['clip']],
      ['Screenshots', ['light-after', 'plain']],
      ['Test run', ['tests']],
      ['Note', ['trace']],
      ['Preview', ['preview']],
    ]);
    const [settings, inbox] = layout.groups[0]?.entries ?? [];
    expect(settings?.parts.map((part) => part.evidence.id)).toEqual(['dark-before', 'dark-after']);
    expect([settings?.facts, settings?.detail, inbox?.detail]).toEqual(['1280px · Dark', null, null]);
    expect(layout.groups[1]?.entries[0]?.fromReview).toBe(true);
    expect(layout.images.map((image) => [image.caption, image.item, image.part])).toEqual([
      ['Settings · 1280px · Dark', 'dark-before', 'Before'],
      ['Settings · 1280px · Dark', 'dark-before', 'After'],
      ['Inbox', 'inbox', 'Empty'],
      ['Inbox', 'inbox', 'Full'],
      ['Scrolling', 'clip', undefined],
      ['Settings · 1280px · Light', 'light-after', undefined],
      ['Menu', 'plain', undefined],
    ]);
    expect(layout.images[4]?.media).toBe('video');
    expect(inbox?.parts[1]?.image).toBe(3);
    expect(layout.folder).toBe('/data/evidence/task-1/round-1');
    expect(listEvidencePrefetch(layout)).toEqual({
      images: layout.images.filter((image) => image.media === 'image').map((image) => image.src),
      texts: [`${STORED}/tests.txt`],
    });
  });

  it('names the width alone when the parts of a comparison are the light and dark of one view', () => {
    const evidence = [
      shot('light', 1, { title: 'Review', itemId: 'themes', label: 'Light', width: 1280, theme: 'light' }),
      shot('dark', 2, { title: 'Review', itemId: 'themes', label: 'Dark', width: 1280, theme: 'dark' }),
    ];
    const layout = resolveEvidenceLayout(createShinsaState({ evidence }), createTask({ id: 'task-1' }));
    expect(layout.groups[0]?.entries[0]?.facts).toBe('1280px');
    expect(layout.images.map((image) => [image.caption, image.part])).toEqual([
      ['Review · 1280px', 'Light'],
      ['Review · 1280px', 'Dark'],
    ]);
  });

  it('pairs the latest shot of a stage, and leaves a shot without its partner a screenshot', () => {
    const evidence = [
      shot('first', 1, { title: 'Home', stage: 'after' }),
      shot('before', 2, { title: 'Home', stage: 'before' }),
      shot('again', 3, { title: 'Home', stage: 'after' }),
      shot('lonely', 4, { title: 'Footer', stage: 'before' }),
    ];
    const layout = resolveEvidenceLayout(createShinsaState({ evidence }), createTask({ id: 'task-1' }));
    expect(
      layout.groups.map((group) => group.entries.map((entry) => entry.parts.map((part) => part.evidence.id)))
    ).toEqual([[['before', 'again']], [['first'], ['lonely']]]);
    expect(layout.folder).toBeNull();
  });
});
