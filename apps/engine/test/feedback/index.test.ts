import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedbackDrafter } from '../../src/feedback/draft.ts';
import { FeedbackEffects, NO_DRAFT, STOPPED_WHILE_FILING } from '../../src/feedback/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

function useFakeGitHub(extra: Record<string, unknown> = {}) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(path, JSON.stringify({ next: 1, defaultChecks: 'pending', pulls: [], calls: [], ...extra }));
  restore = overrideEnv({ FAKE_GH_STATE: path });
  return () => JSON.parse(readFileSync(path, 'utf8')) as { issues?: unknown[]; calls: string[][] };
}

function createContext(key = 'effect') {
  const controller = new AbortController();
  return { context: { key, attempt: 1, signal: controller.signal }, abort: () => controller.abort() };
}

async function createWorld(drafter: FeedbackDrafter) {
  const dir = createTempDir('shinsa-feedback-');
  const engine = new Engine(new EventLog(join(dir, 'shinsa.sqlite')));
  await engine.dispatch({ type: 'project.write', project: { name: 'Paywalls', color: 'blue', key: 'PW' } });
  await engine.dispatch({ type: 'feedback.write', feedbackId: null, note: 'The plan tab hides my changes.' });
  const feedbackId = Object.keys(engine.state.feedback)[0] ?? '';
  return { engine, feedbackId, effects: new FeedbackEffects(engine, dir, drafter) };
}

const DRAFT = { title: 'Plan tab hides changes', body: 'The plan tab hides the changes a round made.' };

describe('feedback effects', () => {
  test('drafting asks the drafter with the note and the private words and records the draft', async () => {
    const inputs: Parameters<FeedbackDrafter>[0][] = [];
    const world = await createWorld((input) => {
      inputs.push(input);
      return Promise.resolve(DRAFT);
    });
    await world.effects.draft(world.feedbackId, createContext().context);
    expect(inputs[0]).toMatchObject({ source: 'human', note: 'The plan tab hides my changes.' });
    expect(inputs[0]?.privateWords).toEqual(expect.arrayContaining(['Paywalls', 'PW']));
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({ status: 'draft', ...DRAFT });
    await world.effects.draft(world.feedbackId, createContext().context);
    expect(inputs).toHaveLength(1);
  });

  test('a draft that does not come back fails the entry, and a cancelled one records nothing', async () => {
    const world = await createWorld(() => Promise.resolve(null));
    const cancelled = createContext();
    cancelled.abort();
    await world.effects.draft(world.feedbackId, cancelled.context);
    expect(world.engine.state.feedback[world.feedbackId]?.status).toBe('drafting');
    await world.effects.draft(world.feedbackId, createContext().context);
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: NO_DRAFT,
    });
  });

  test('filing opens the issue and records its link, once', async () => {
    const read = useFakeGitHub();
    const world = await createWorld(() => Promise.resolve(DRAFT));
    await world.effects.draft(world.feedbackId, createContext().context);
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    await world.effects.file(world.feedbackId, createContext().context);
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'filed',
      issue: { number: 1, url: 'https://github.com/shinsa-dev/shinsa/issues/1' },
    });
    await world.effects.file(world.feedbackId, createContext().context);
    expect(read().issues).toHaveLength(1);
  });

  test('a failed filing records what gh said, and a cancelled one never runs gh', async () => {
    const read = useFakeGitHub({ failIssues: 'HTTP 401: Bad credentials' });
    const world = await createWorld(() => Promise.resolve(DRAFT));
    await world.effects.draft(world.feedbackId, createContext().context);
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    const cancelled = createContext();
    cancelled.abort();
    await world.effects.file(world.feedbackId, cancelled.context);
    expect(read().calls).toHaveLength(0);
    await world.effects.file(world.feedbackId, createContext().context);
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: 'gh issue create failed: HTTP 401: Bad credentials',
    });
  });

  test('a filing the engine stopped during records nothing, and recovery fails it with a warning', async () => {
    useFakeGitHub();
    const world = await createWorld(() => Promise.resolve(DRAFT));
    await world.effects.draft(world.feedbackId, createContext().context);
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    const stopping = createContext();
    const filing = world.effects.file(world.feedbackId, stopping.context);
    stopping.abort();
    await filing;
    expect(world.engine.state.feedback[world.feedbackId]?.status).toBe('filing');
    await world.effects.recover();
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: STOPPED_WHILE_FILING,
    });
  });

  test('an effect that gave up fails its entry with the error', async () => {
    const world = await createWorld(() => Promise.resolve(DRAFT));
    await world.effects.reportExhausted(world.feedbackId, 'The writer is down.', 'effect');
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: 'The writer is down.',
    });
  });
});
