import { describe, expect, test } from 'bun:test';
import type { Evidence, ShinsaCommand } from '../../src/index.ts';
import { createHarness, createTask, PASSING, PLAN, proposePlan } from '../harness.ts';

type Harness = ReturnType<typeof createHarness>;

const SETTINGS = 'src/settings.tsx';

const API = 'src/api.ts';

function attach(
  harness: Harness,
  runId: string,
  fields: Partial<ShinsaCommand & { type: 'agent.attach_evidence' }>
) {
  return harness.send({
    type: 'agent.attach_evidence',
    runId,
    kind: 'screenshot',
    title: 'Settings',
    uri: `/e/${Object.keys(harness.state.evidence).length}.png`,
    ...fields,
  });
}

function completePhase(harness: Harness, taskId: string, files: string[]) {
  harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary: 'Done.',
    spots: [],
    judgementCalls: [],
    files,
  });
}

function evidenceOf(harness: Harness, title: string) {
  return Object.values(harness.state.evidence).filter((piece) => piece.title === title);
}

function current(pieces: Evidence[]) {
  return pieces
    .filter((piece) => !piece.replacedBy && piece.removedAt === undefined)
    .map((piece) => piece.uri);
}

function reachRevision(options: { phaseFiles?: [string[], string[]] } = {}) {
  const [first, second] = options.phaseFiles ?? [[SETTINGS], [API]];
  const harness = createHarness();
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  const build = harness.activeRun(taskId).id;
  attach(harness, build, { key: 'settings-dark', stage: 'before', uri: '/e/before.png' });
  attach(harness, build, { key: 'settings-dark', stage: 'after', uri: '/e/after.png' });
  completePhase(harness, taskId, first);
  attach(harness, harness.activeRun(taskId).id, { kind: 'note', title: 'Timings', uri: '/e/t.md' });
  completePhase(harness, taskId, second);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  const reviewer = harness.activeRun(taskId).id;
  attach(harness, reviewer, { key: 'settings-dark', uri: '/e/review.png' });
  harness.send({ type: 'agent.report_review', runId: reviewer, summary: null, findings: [] });
  harness.send({
    type: 'gate.answer',
    gateId: harness.openGate(taskId).id,
    decision: 'revise',
    response: 'Make the labels darker.',
  });
  return { harness, taskId, fix: harness.activeRun(taskId) };
}

function completeFix(harness: Harness, runId: string, files: string[], evidenceKept?: string[]) {
  return harness.send({
    type: 'agent.complete_fix',
    runId,
    summary: 'Darker labels.',
    files,
    ...(evidenceKept ? { evidenceKept } : {}),
  });
}

describe('evidence for the same thing replaces the earlier one', () => {
  test('a later piece at the same key replaces the piece of its stage, and the before stays', () => {
    const { harness, fix } = reachRevision();
    const decision = attach(harness, fix.id, { key: 'settings-dark', stage: 'after', uri: '/e/after-2.png' });
    const [old] = evidenceOf(harness, 'Settings').filter((piece) => piece.uri === '/e/after.png');
    const attached = decision.events.find((event) => event.type === 'evidence.attached');
    expect(attached).toMatchObject({ replaces: [old?.id] });
    expect(old?.replacedBy).toBe(attached?.type === 'evidence.attached' ? attached.evidence.id : '');
    expect(current(evidenceOf(harness, 'Settings'))).toEqual([
      '/e/before.png',
      '/e/review.png',
      '/e/after-2.png',
    ]);
    expect(evidenceOf(harness, 'Settings').at(-1)).toMatchObject({ key: 'settings-dark', fixFor: 'you' });
    expect(harness.task(fix.taskId).activity.at(-1)).toMatchObject({
      kind: 'evidence',
      text: 'Updated Settings',
    });
  });

  test('a piece without a stage, or a comparison, replaces every piece at its key', () => {
    const { harness, fix } = reachRevision();
    harness.send({
      type: 'agent.attach_comparison',
      runId: fix.id,
      title: 'Settings',
      key: 'settings-dark',
      parts: [
        { kind: 'screenshot', uri: '/e/b2.png', stage: 'before' },
        { kind: 'screenshot', uri: '/e/a2.png', stage: 'after' },
      ],
    });
    expect(current(evidenceOf(harness, 'Settings'))).toEqual(['/e/review.png', '/e/b2.png', '/e/a2.png']);
    attach(harness, fix.id, { key: 'settings-dark', uri: '/e/plain.png' });
    expect(current(evidenceOf(harness, 'Settings'))).toEqual(['/e/review.png', '/e/plain.png']);
  });

  test('without a key, the title, width and theme are what it shows', () => {
    const { harness, fix } = reachRevision();
    attach(harness, fix.id, { kind: 'note', title: 'Timings', uri: '/e/t2.md' });
    expect(current(evidenceOf(harness, 'Timings'))).toEqual(['/e/t2.md']);
  });

  test('replaces names other items by key or id, and an unknown one is refused', () => {
    const { harness, fix } = reachRevision();
    const note = evidenceOf(harness, 'Timings')[0];
    attach(harness, fix.id, {
      title: 'Settings, light',
      uri: '/e/l.png',
      replaces: ['settings-dark', note?.id ?? ''],
    });
    expect(current(evidenceOf(harness, 'Settings'))).toEqual(['/e/review.png']);
    expect(current(evidenceOf(harness, 'Timings'))).toEqual([]);
    expect(() => attach(harness, fix.id, { title: 'Other', replaces: ['nothing'] })).toThrow(
      'replaces names nothing, which is not current evidence you attached this round.'
    );
  });

  test('a check linked again replaces the earlier link, and the outputs Shinsa kept stay', () => {
    const { harness, fix } = reachRevision();
    const link = (detail: string) =>
      harness.send({ type: 'agent.attach_check', runId: fix.id, kind: 'test', checkId: 'c1', detail });
    link('Fails without the fix.');
    link('Still fails without the fix.');
    const pieces = Object.values(harness.state.evidence).filter((piece) => piece.checkId === 'c1');
    expect(
      pieces.filter((piece) => piece.runId !== null).map((piece) => [piece.detail, !piece.replacedBy])
    ).toEqual([
      ['Fails without the fix.', false],
      ['Still fails without the fix.', true],
    ]);
    expect(pieces.filter((piece) => piece.runId === null).every((piece) => !piece.replacedBy)).toBe(true);
  });
});

describe('remove_evidence', () => {
  test('removes an item that no longer applies, keeping it in history with the reason', () => {
    const { harness, fix } = reachRevision();
    harness.send({
      type: 'agent.remove_evidence',
      runId: fix.id,
      items: ['settings-dark'],
      reason: 'The banner is gone.',
    });
    const removed = evidenceOf(harness, 'Settings').filter((piece) => piece.removedAt !== undefined);
    expect(removed.map((piece) => [piece.uri, piece.removedReason])).toEqual([
      ['/e/before.png', 'The banner is gone.'],
      ['/e/after.png', 'The banner is gone.'],
    ]);
    expect(harness.task(fix.taskId).activity.at(-1)).toMatchObject({
      kind: 'evidence',
      text: 'Removed Settings',
      detail: 'The banner is gone.',
    });
  });

  test('names only current evidence its own side attached', () => {
    const { harness, fix } = reachRevision();
    const review = evidenceOf(harness, 'Settings').find((piece) => piece.uri === '/e/review.png');
    expect(() =>
      harness.send({ type: 'agent.remove_evidence', runId: fix.id, items: [review?.id ?? ''], reason: 'x' })
    ).toThrow('items names');
  });

  test('evidence a plan asks for counts only while it is current', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, { ...PLAN, evidence: ['note'] });
    const runId = harness.activeRun(taskId).id;
    attach(harness, runId, { kind: 'note', title: 'Timings', uri: '/e/t.md' });
    completePhase(harness, taskId, [API]);
    const last = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.remove_evidence',
      runId: last,
      items: ['note-timings'],
      reason: 'Wrong numbers.',
    });
    expect(() => completePhase(harness, taskId, [API])).toThrow('The plan asks for a note');
  });
});

describe('a fix accounts for the evidence attached before it', () => {
  test('is refused while it changed files an earlier item shows, naming each item', () => {
    const { harness, fix } = reachRevision();
    expect(() => completeFix(harness, fix.id, [SETTINGS])).toThrow(
      [
        'Your fix changed files this evidence shows, so it may still show the work as it was before the fix:',
        '- `settings-dark`: Settings (comparison)',
        'For each one, attach a new one with the same `key` (it replaces the old one), remove it with `remove_evidence` when it no longer applies, or name its key in `evidence_kept` when it still shows the work as it is. Then call `complete_fix` again.',
      ].join('\n')
    );
  });

  test('an item covers the files of the phase it was attached in', () => {
    const { harness, fix } = reachRevision();
    expect(() => completeFix(harness, fix.id, [API])).toThrow('- `note-timings`: Timings (note)');
  });

  test('an item attached outside a phase covers every file, so the next fix names it', () => {
    const { harness, taskId, fix } = reachRevision();
    harness.send({
      type: 'agent.remove_evidence',
      runId: fix.id,
      items: ['settings-dark', 'note-timings'],
      reason: 'Redone.',
    });
    attach(harness, fix.id, { key: 'labels', title: 'Labels', uri: '/e/labels.png' });
    completeFix(harness, fix.id, [SETTINGS]);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Again.',
    });
    expect(() => completeFix(harness, harness.activeRun(taskId).id, ['README.md'])).toThrow(
      '- `labels`: Labels'
    );
  });

  test('passes once each item is replaced, removed or kept', () => {
    const { harness, fix } = reachRevision();
    attach(harness, fix.id, { key: 'settings-dark', stage: 'after', uri: '/e/after-2.png' });
    expect(() => completeFix(harness, fix.id, [SETTINGS, API])).toThrow('note-timings');
    completeFix(harness, fix.id, [SETTINGS, API], ['note-timings']);
    expect(harness.state.runs[fix.id]?.outcome).toBe('completed');
  });

  test('an item from a phase whose files the fix left alone, or a fix that changed nothing, needs nothing', () => {
    const { harness, fix } = reachRevision({ phaseFiles: [[SETTINGS], [API]] });
    harness.send({ type: 'agent.remove_evidence', runId: fix.id, items: ['note-timings'], reason: 'Gone.' });
    completeFix(harness, fix.id, [API]);
    expect(harness.state.runs[fix.id]?.outcome).toBe('completed');
    const again = reachRevision();
    completeFix(again.harness, again.fix.id, []);
    expect(again.harness.state.runs[again.fix.id]?.outcome).toBe('completed');
  });

  test('a phase that recorded no files covers every file', () => {
    const { harness, fix } = reachRevision({ phaseFiles: [[], [API]] });
    harness.send({ type: 'agent.remove_evidence', runId: fix.id, items: ['note-timings'], reason: 'Gone.' });
    expect(() => completeFix(harness, fix.id, ['README.md'])).toThrow('settings-dark');
  });

  test('evidence_kept names only current evidence', () => {
    const { harness, fix } = reachRevision();
    expect(() => completeFix(harness, fix.id, [], ['missing'])).toThrow('evidence_kept names missing');
  });

  test('the fix prompt lists the evidence to keep current, by key', () => {
    const { fix } = reachRevision();
    expect(fix.prompt).toContain('The evidence you attached this round, which the human sees in the review:');
    expect(fix.prompt).toContain('- `settings-dark`, comparison: Settings (before and after)');
    expect(fix.prompt).toContain('- `note-timings`, note: Timings');
    expect(fix.prompt).not.toContain('/e/review.png');
  });
});
