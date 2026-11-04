import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Context, Duration, Effect, Fiber, Layer, Scope } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import type { FeedbackDraft, FeedbackDraftInput } from '../../src/feedback/draft/schema.ts';
import { FeedbackDrafter } from '../../src/feedback/draft/service.ts';
import { FeedbackSync, NO_DRAFT, STOPPED_WHILE_FILING } from '../../src/feedback/effects/schema.ts';
import { FeedbackEffects } from '../../src/feedback/effects/service.ts';
import { FeedbackIssues } from '../../src/feedback/issues/service.ts';
import { GitHubLayer } from '../../src/github/layers.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { createConfigAt } from '../helpers/config.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { overrideEnv } from '../helpers/index.ts';
import { createTempDir } from '../helpers/temp.ts';

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

type Draft = (input: FeedbackDraftInput) => Effect.Effect<FeedbackDraft | null>;

function buildEffects(
  core: EngineCore['Service'],
  dir: string,
  draft: Draft,
  sync: Duration.Duration | null = Duration.zero
) {
  const config = createConfigAt(dir);
  mkdirSync(config.dataDir, { recursive: true });
  const layer = FeedbackEffects.layer({ environment: () => ['Shinsa: 1.2.0, the Mac app'] }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EngineCore, core),
        Layer.succeed(EngineConfig, config),
        FeedbackIssues.layer.pipe(Layer.provide(GitHubLayer), Layer.provide(ShellLayer)),
        Layer.succeed(FeedbackDrafter, FeedbackDrafter.of({ draft })),
        sync ? Layer.succeed(FeedbackSync, sync) : Layer.empty
      )
    )
  );
  return Effect.runSync(
    Layer.buildWithScope(layer, Scope.makeUnsafe()).pipe(
      Effect.map((context) => Context.get(context, FeedbackEffects))
    )
  );
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect.pipe(Effect.provide(JsonLogger)));
}

async function createWorld(draft: Draft, sync: Duration.Duration | null = Duration.zero) {
  const dir = createTempDir('shinsa-feedback-');
  const engine = new Engine(openEventLog(join(dir, 'shinsa.sqlite')));
  await engine.dispatch({ type: 'project.write', project: { name: 'Paywalls', color: 'blue', key: 'PW' } });
  await engine.dispatch({ type: 'feedback.write', feedbackId: null, note: 'The plan tab hides my changes.' });
  const feedbackId = Object.keys(engine.state.feedback)[0] ?? '';
  return { engine, feedbackId, dir, effects: buildEffects(engine.core, dir, draft, sync) };
}

const DRAFT = { title: 'Plan tab hides changes', body: 'The plan tab hides the changes a round made.' };

const drafted: Draft = () => Effect.succeed(DRAFT);

describe('feedback effects', () => {
  test('drafting asks the drafter with the note and the private words and records the draft', async () => {
    const inputs: FeedbackDraftInput[] = [];
    const world = await createWorld((input) =>
      Effect.sync(() => {
        inputs.push(input);
        return DRAFT;
      })
    );
    await run(world.effects.draft(world.feedbackId, 'effect'));
    expect(inputs[0]).toMatchObject({
      source: 'human',
      note: 'The plan tab hides my changes.',
      context: ['Shinsa: 1.2.0, the Mac app'],
    });
    expect(inputs[0]?.privateWords).toEqual(expect.arrayContaining(['Paywalls', 'PW']));
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'draft',
      title: DRAFT.title,
      body: `${DRAFT.body}\n\n### Environment\n\n- Shinsa: 1.2.0, the Mac app`,
    });
    await run(world.effects.draft(world.feedbackId, 'effect'));
    expect(inputs).toHaveLength(1);
  });

  test('a draft that does not come back fails the entry, and an interrupted one records nothing', async () => {
    const answer = { next: Effect.never as Effect.Effect<FeedbackDraft | null> };
    const world = await createWorld(() => answer.next);
    const drafting = Effect.runFork(world.effects.draft(world.feedbackId, 'effect'));
    await run(Fiber.interrupt(drafting));
    expect(world.engine.state.feedback[world.feedbackId]?.status).toBe('drafting');
    answer.next = Effect.succeed(null);
    await run(world.effects.draft(world.feedbackId, 'effect'));
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: NO_DRAFT,
    });
  });

  test('filing opens the issue and records its link, once', async () => {
    const read = useFakeGitHub();
    const world = await createWorld(drafted);
    await run(world.effects.draft(world.feedbackId, 'effect'));
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    await run(world.effects.file(world.feedbackId, 'effect'));
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'filed',
      issue: { number: 1, url: 'https://github.com/shinsa-dev/shinsa/issues/1' },
    });
    await run(world.effects.file(world.feedbackId, 'effect'));
    expect(read().issues).toHaveLength(1);
  });

  test('a failed filing records what gh said', async () => {
    useFakeGitHub({ failIssues: 'HTTP 401: Bad credentials' });
    const world = await createWorld(drafted);
    await run(world.effects.draft(world.feedbackId, 'effect'));
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    await run(world.effects.file(world.feedbackId, 'effect'));
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: 'gh issue create failed: HTTP 401: Bad credentials',
    });
  });

  test('a filing the engine stopped during records nothing, and recovery fails it with a warning', async () => {
    useFakeGitHub();
    const world = await createWorld(drafted);
    await run(world.effects.draft(world.feedbackId, 'effect'));
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    const filing = Effect.runFork(world.effects.file(world.feedbackId, 'effect'));
    await run(Fiber.interrupt(filing));
    expect(world.engine.state.feedback[world.feedbackId]?.status).toBe('filing');
    await run(world.effects.recover);
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: STOPPED_WHILE_FILING,
    });
  });

  test('an opened issue follows GitHub when it closes and opens again', async () => {
    const read = useFakeGitHub();
    const world = await createWorld(drafted);
    expect(await run(world.effects.syncIssues)).toBeNull();
    expect(read().calls).toHaveLength(0);
    await run(world.effects.draft(world.feedbackId, 'effect'));
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    await run(world.effects.file(world.feedbackId, 'effect'));
    const opened = read() as { issues: { number: number }[] };
    const closed = { issues: [{ ...opened.issues[0], closedAt: '2026-11-01T10:00:00Z' }] };
    restore?.();
    useFakeGitHub(closed);
    expect(await run(world.effects.syncIssues)).toBeNull();
    expect(world.engine.state.feedback[world.feedbackId]?.issue?.closedAt).toBe(
      Date.parse('2026-11-01T10:00:00Z')
    );
    restore?.();
    useFakeGitHub({ issues: [{ ...closed.issues[0], closedAt: undefined }] });
    await run(world.effects.syncIssues);
    expect(world.engine.state.feedback[world.feedbackId]?.issue?.closedAt).toBeNull();
    restore?.();
    useFakeGitHub({ issues: [] });
    await run(world.effects.syncIssues);
    expect(world.engine.state.feedback[world.feedbackId]?.issue?.closedAt).toBeNull();
    restore?.();
    useFakeGitHub({ failIssues: 'HTTP 502' });
    expect(await run(world.effects.syncIssues)).toBe('gh issue list failed: HTTP 502');
  });

  test('a sync inside the window asks GitHub nothing', async () => {
    const read = useFakeGitHub();
    const world = await createWorld(drafted, null);
    await run(world.effects.draft(world.feedbackId, 'effect'));
    await world.engine.dispatch({ type: 'feedback.file', feedbackId: world.feedbackId });
    await run(world.effects.file(world.feedbackId, 'effect'));
    await run(world.effects.syncIssues);
    await run(world.effects.syncIssues);
    expect(read().calls.filter((call) => call[1] === 'list')).toHaveLength(1);
  });

  test('an effect that gave up fails its entry with the error', async () => {
    const world = await createWorld(drafted);
    await run(world.effects.reportExhausted(world.feedbackId, 'The writer is down.', 'effect'));
    expect(world.engine.state.feedback[world.feedbackId]).toMatchObject({
      status: 'failed',
      failure: 'The writer is down.',
    });
  });

  test('a log that refuses or has stopped passes its reason on', async () => {
    const world = await createWorld(drafted);
    const failWith = (error: DomainError | EngineStopped) =>
      buildEffects(
        EngineCore.of({ ...world.engine.core, dispatch: () => Effect.fail(error) }),
        world.dir,
        drafted
      );
    const stopped = await run(
      Effect.flip(
        failWith(new EngineStopped({ message: 'log full' })).reportExhausted(
          world.feedbackId,
          'Down.',
          'effect'
        )
      )
    );
    expect(stopped).toMatchObject({ _tag: 'EngineStopped', message: 'log full' });
    const refused = await run(
      Effect.flip(
        failWith(new DomainError({ code: 'feedback_missing', message: 'No such feedback.' })).reportExhausted(
          world.feedbackId,
          'Down.',
          'effect'
        )
      )
    );
    expect(refused).toBeInstanceOf(DomainError);
  });
});
