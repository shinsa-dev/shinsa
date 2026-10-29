import { describe, expect, it } from 'bun:test';
import type { Evidence } from '@shinsa/core';
import {
  describeEvidenceFacts,
  describeEvidenceKind,
  describeEvidencePart,
  describeEvidenceStage,
  describeEvidenceSummary,
  describeEvidenceUpdate,
  listEvidencePrefetch,
  listShownEvidenceImages,
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
    expect(describeEvidenceSummary(evidence)).toBe('1 comparison, 1 recording and 2 tests');
    expect(describeEvidenceSummary(evidence.slice(2, 3))).toBe('1 recording');
    expect(describeEvidenceKind('check', 2)).toBe('Checks');
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
      ['Test', ['tests']],
      ['Note', ['trace']],
      ['Preview', ['preview']],
    ]);
    const [settings, inbox] = layout.groups[0]?.entries ?? [];
    expect(settings?.parts.map((part) => part.evidence.id)).toEqual(['dark-before', 'dark-after']);
    expect([settings?.facts, settings?.detail, inbox?.detail]).toEqual(['1280px · Dark', null, null]);
    expect(layout.groups[1]?.entries[0]?.fromReview).toBe(true);
    expect(layout.images.map((image) => [image.caption, image.item, image.part, image.width])).toEqual([
      ['Settings · 1280px · Dark', 'dark-before', 'Before', 1280],
      ['Settings · 1280px · Dark', 'dark-before', 'After', 1280],
      ['Inbox', 'inbox', 'Empty', null],
      ['Inbox', 'inbox', 'Full', null],
      ['Scrolling', 'clip', undefined, null],
      ['Settings · 1280px · Light', 'light-after', undefined, 1280],
      ['Menu', 'plain', undefined, null],
    ]);
    expect(layout.images[4]?.media).toBe('video');
    expect(inbox?.parts[1]?.image).toBe(3);
    expect(layout.folder).toBe('/data/evidence/task-1/round-1');
    expect(listEvidencePrefetch(layout)).toEqual({
      images: layout.images.filter((image) => image.media === 'image').map((image) => image.src),
      texts: [`${STORED}/tests.txt`],
    });
  });

  it('turns the pieces of one check into one entry: the agent’s links and Shinsa’s latest output', () => {
    const evidence = [
      shot('link', 1, {
        kind: 'test',
        title: 'Unit tests',
        uri: 'shinsa://check/c1',
        checkId: 'c1',
        detail: 'Covers the empty cart.',
        runId: 'review',
      }),
      shot('old', 2, {
        kind: 'check',
        title: 'Unit tests',
        uri: `${STORED}/c1-old.txt`,
        checkId: 'c1',
        runId: null,
      }),
      shot('new', 3, {
        kind: 'check',
        title: 'Unit tests',
        uri: `${STORED}/c1.txt`,
        checkId: 'c1',
        runId: null,
      }),
      shot('lint', 4, {
        kind: 'check',
        title: 'bun run lint',
        uri: `${STORED}/r1.txt`,
        checkId: 'r1',
        runId: null,
      }),
      shot('plain', 5, { title: 'Menu' }),
    ];
    const state = createShinsaState({
      evidence,
      runs: [createRun({ id: 'review', taskId: 'task-1', role: 'reviewer' })],
    });
    const layout = resolveEvidenceLayout(state, createTask({ id: 'task-1' }));
    expect(layout.count).toBe(3);
    expect(layout.groups.map((group) => [group.label, group.entries.map((entry) => entry.key)])).toEqual([
      ['Screenshot', ['plain']],
      ['Test', ['check:c1']],
      ['Check', ['check:r1']],
    ]);
    const [unit] = layout.groups[1]?.entries ?? [];
    expect([unit?.title, unit?.detail, unit?.fromReview, unit?.check?.taskId]).toEqual([
      'Unit tests',
      'Covers the empty cart.',
      true,
      'task-1',
    ]);
    expect(unit?.check?.links.map((link) => link.id)).toEqual(['link']);
    expect(unit?.check?.output?.evidence.id).toBe('new');
    expect(layout.groups[2]?.entries[0]?.check?.links).toEqual([]);
    expect(listEvidencePrefetch(layout).texts).toEqual([`${STORED}/c1.txt`, `${STORED}/r1.txt`]);
    expect(describeEvidenceSummary(evidence)).toBe('1 screenshot, 1 test and 1 check');
    const linkOnly = resolveEvidenceLayout(
      createShinsaState({ evidence: evidence.slice(0, 1) }),
      createTask({ id: 'task-1' })
    );
    expect(linkOnly.groups[0]?.entries[0]?.parts).toEqual([]);
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

describe('evidence that was replaced or removed', () => {
  const evidence = [
    shot('before', 1, { title: 'Settings', stage: 'before' }),
    shot('old-after', 2, { title: 'Settings', stage: 'after', replacedBy: 'new-after' }),
    shot('note', 3, {
      kind: 'note',
      title: 'Timings',
      uri: `${STORED}/t.md`,
      removedAt: NOW,
      removedReason: 'Stale.',
    }),
    shot('new-after', 4, { title: 'Settings', stage: 'after', fixFor: 'you' }),
    shot('old-link', 5, {
      kind: 'test',
      title: 'Unit',
      uri: 'shinsa://check/c1',
      checkId: 'c1',
      replacedBy: 'link',
    }),
    shot('link', 6, { kind: 'test', title: 'Unit', uri: 'shinsa://check/c1', checkId: 'c1', detail: 'Now.' }),
  ];
  const state = createShinsaState({ evidence, runs: [createRun({ id: 'build', taskId: 'task-1' })] });

  it('shows only current items, the replacing one marked, and keeps the rest as earlier versions', () => {
    const layout = resolveEvidenceLayout(state, createTask({ id: 'task-1' }));
    expect(layout.count).toBe(2);
    const [settings] = layout.groups[0]?.entries ?? [];
    expect(settings?.parts.map((part) => part.evidence.id)).toEqual(['before', 'new-after']);
    expect(settings?.updated).toBe('Updated after your review');
    expect(layout.groups[1]?.entries[0]?.check?.links.map((link) => link.id)).toEqual(['link']);
    expect(layout.earlier.map((entry) => [entry.key, entry.status])).toEqual([
      ['earlier:old-after', 'Replaced by a later version'],
      ['earlier:note', 'Removed: Stale.'],
    ]);
    expect(layout.images.map((image) => image.item)).toEqual(['before', 'before', 'earlier:old-after']);
    expect(listShownEvidenceImages(layout, false).map((image) => image.item)).toEqual(['before', 'before']);
    expect(listShownEvidenceImages(layout, true)).toBe(layout.images);
    expect(listEvidencePrefetch(layout).images).toEqual([`${STORED}/before.png`, `${STORED}/new-after.png`]);
    expect(describeEvidenceSummary(evidence)).toBe('1 comparison and 1 test');
  });

  it('says after what an item was updated', () => {
    expect(describeEvidenceUpdate(null)).toBeNull();
    expect(describeEvidenceUpdate('review')).toBe('Updated after the agent review');
    expect(describeEvidenceUpdate('checks')).toBe('Updated after the checks');
    expect(describeEvidenceUpdate('pull_request')).toBe('Updated after the pull request feedback');
    expect(describeEvidenceUpdate('conflict')).toBe('Updated');
    expect(describeEvidenceUpdate('work')).toBe('Updated');
  });
});
