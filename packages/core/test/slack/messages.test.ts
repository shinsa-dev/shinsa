import { describe, expect, test } from 'bun:test';
import {
  createSlackMessage,
  createSlackSection,
  listSlackStatusGates,
  resolveSlackPostMessage,
  resolveSlackSessionStatus,
  SLACK_BLOCK_LIMITS,
  SLACK_RESULT_LIMIT,
  type SlackBlock,
  type SlackMessage,
  serializeSlackDeclined,
  serializeSlackForwarded,
  serializeSlackGate,
  serializeSlackHeld,
  serializeSlackLinkPrompt,
  serializeSlackOffline,
  serializeSlackResult,
  serializeSlackStatus,
  type TaskShape,
} from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
  type Harness,
  pullRequest,
  reachReviewGate,
  readyWorktree,
  registerRepo,
} from '../harness.ts';

const URL = 'https://app.shinsa.dev/tasks/t1';

function readText(message: SlackMessage) {
  return message.blocks
    .map((block: SlackBlock) =>
      block.type === 'section' ? block.text.text : block.elements.map((element) => element.text).join(' ')
    )
    .join('\n');
}

function startShaped(harness: Harness, shape: TaskShape, request = 'Why does the export hang?') {
  const repoId = Object.keys(harness.state.repos)[0] || registerRepo(harness);
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request, repoId });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: request,
    repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
    shape,
  });
  readyWorktree(harness, taskId);
  return taskId;
}

function statusOf(harness: Harness, taskId: string) {
  return serializeSlackStatus(harness.task(taskId), listSlackStatusGates(harness.state, taskId), URL);
}

function ask(
  harness: Harness,
  taskId: string,
  fields: { question: string; choices?: string[]; recommendation?: string }
) {
  harness.send({
    type: 'agent.ask',
    runId: harness.activeRun(taskId).id,
    gateId: 'q1',
    context: null,
    ...fields,
  });
}

describe('the status message', () => {
  test('is one line: a mark, what the task does now and a link to it', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Fix the <export> & hang' });
    const message = statusOf(harness, taskId);
    expect(message.blocks).toHaveLength(1);
    expect(readText(message)).toBe(
      `🔵 *Planning the phases*  ·  <${URL}|SUP-1 · Fix the &lt;export&gt; &amp; hang>`
    );
    expect(message.text).toBe('SUP-1 · Fix the &lt;export&gt; &amp; hang: Planning the phases');
  });

  test('says what needs you when a question waits or the task failed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Which <format>?' });
    expect(readText(statusOf(harness, taskId))).toStartWith('🟣 *Needs you: Which &lt;format&gt;?*');
    const failed = createTask(harness, { request: 'Second' });
    harness.send({ type: 'effect.fail', taskId: failed, title: 'The worktree failed', detail: 'disk full' });
    expect(readText(statusOf(harness, failed))).toStartWith('🔴 *Needs you: The worktree failed*');
  });

  test('adds the pull request, and marks a merged, cancelled or waiting task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    expect(readText(statusOf(harness, taskId))).toStartWith('🟣 ');
    approve(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    const text = readText(statusOf(harness, taskId));
    expect(text).toStartWith('✅ *Pull request merged*');
    expect(text).toEndWith(`|PR #${harness.task(taskId).pullRequest?.number}>`);
    const other = createTask(harness, { request: 'Other' });
    harness.send({ type: 'task.cancel', taskId: other });
    expect(readText(statusOf(harness, other))).toStartWith('⚪ *Cancelled by you*');
    const first = createTask(harness, { request: 'First' });
    const second = createTask(harness, { request: 'Second', waitsOn: [first] });
    expect(readText(statusOf(harness, second))).toStartWith('⏳ *Waiting for “First” to finish*');
  });
});

describe('the thread’s own status in Slack', () => {
  test('works while the agent does, waits on you at a gate, rests when done and closes when finished', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const status = () =>
      resolveSlackSessionStatus(harness.task(taskId), listSlackStatusGates(harness.state, taskId));
    expect(status()).toBe('processing');
    ask(harness, taskId, { question: 'Go?' });
    expect(status()).toBe('suspended');
    const review = createTask(harness, { request: 'Review it' });
    reachReviewGate(harness, review);
    expect(resolveSlackSessionStatus(harness.task(review), [])).toBe('suspended');
    approve(harness, review);
    harness.send({
      type: 'pull_request.record',
      taskId: review,
      pullRequest: pullRequest({ state: 'merged' }),
    });
    expect(resolveSlackSessionStatus(harness.task(review), [])).toBe('active');
    harness.send({ type: 'task.cancel', taskId });
    expect(status()).toBe('closed');
  });
});

describe('the posts each gate makes', () => {
  test('a question is its title, its choices with the recommended one bold, and a link to answer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Which format?', choices: ['CSV', 'JSON'], recommendation: 'JSON' });
    const message =
      serializeSlackGate(harness.task(taskId), harness.state.gates.q1 ?? never(), URL) ?? never();
    expect(readText(message)).toBe(`❓ *Which format?*\nCSV  ·  *JSON*\n<${URL}|Answer in Shinsa>`);
    expect(message.text).toContain('asks: Which format?');
  });

  test('a question without choices is only its title and the link', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Go?' });
    const message =
      serializeSlackGate(harness.task(taskId), harness.state.gates.q1 ?? never(), URL) ?? never();
    expect(readText(message)).toBe(`❓ *Go?*\n<${URL}|Answer in Shinsa>`);
  });

  test('a secret is never asked for in Slack', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.request_secret',
      runId: harness.activeRun(taskId).id,
      gateId: 's1',
      label: 'Stripe key',
      reason: 'To test checkout.',
    });
    const text = readText(
      serializeSlackGate(harness.task(taskId), harness.state.gates.s1 ?? never(), URL) ?? never()
    );
    expect(text).toBe(`🔑 *Stripe key* is needed. Never paste it here.\n<${URL}|Give it in Shinsa>`);
  });

  test('a plan is its goal in one sentence and a link to review it', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: {
        goal: 'Stream the export. Then test it on a large file.',
        phases: [
          { title: 'Read in chunks', detail: 'Use a stream.' },
          { title: 'Test it', detail: 'A large file.' },
        ],
        behaviour: ['Exports a 2 GB file.'],
        approach: 'Streams.',
        files: [{ path: 'src/export.ts', change: 'Stream it.' }],
        outOfScope: [],
        verification: [{ label: 'Export tests', command: 'bun test test/export', phases: [1, 2] }],
        evidence: ['test'],
        questions: [],
      },
    });
    const text = readText(serializeSlackGate(harness.task(taskId), harness.openGate(taskId), URL) ?? never());
    expect(text).toBe(`📋 *Plan ready*  Stream the export.\n<${URL}|Review the plan in Shinsa>`);
  });

  test('a review is its summary, how the checks went and a link, plus the pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const task = harness.task(taskId);
    const text = readText(serializeSlackGate(task, harness.openGate(taskId), URL) ?? never());
    expect(text).toStartWith('👀 *Ready for review*  ');
    expect(text).toContain('✓ All');
    expect(text).toEndWith(`<${URL}|Review in Shinsa>`);
    const check = { id: 'c1', label: 'Export tests', command: 'bun test', detail: null };
    const failing = {
      ...task,
      summary: `${'Streams the export. '.repeat(30)}`,
      checkResults: [
        { ...check, outcome: 'fail' as const },
        { ...check, id: 'c2', outcome: 'pass' as const },
      ],
      pullRequest: pullRequest(),
    };
    const failed = readText(serializeSlackGate(failing, harness.openGate(taskId), URL) ?? never());
    expect(failed).toContain('👀 *Ready for review*  Streams the export.\n✕ 1 of 2 checks failed');
    expect(failed).toEndWith(`|PR #${failing.pullRequest.number}>`);
    const one = { ...task, checkResults: [{ ...check, outcome: 'pass' as const }] };
    expect(readText(serializeSlackGate(one, harness.openGate(taskId), URL) ?? never())).toContain(
      '✓ The check passed'
    );
    const none = { ...task, checkResults: [], summary: 'x'.repeat(400) };
    const bare = readText(serializeSlackGate(none, harness.openGate(taskId), URL) ?? never());
    expect(bare).toContain(`${'x'.repeat(279)}…\n<${URL}|Review in Shinsa>`);
  });

  test('a proposal is the change in one line and a link, and gates nobody decides in Slack post nothing', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'investigate');
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'investigate',
      body: 'It reads the whole file.',
      proposal: { request: 'Stream the export in chunks.\nMore detail.', why: 'It reads the whole file.' },
    });
    const gate = harness.openGate(taskId);
    expect(readText(serializeSlackGate(harness.task(taskId), gate, URL) ?? never())).toBe(
      `💡 *Proposed change*  Stream the export in chunks.\n<${URL}|Decide in Shinsa>`
    );
    expect(
      readText(serializeSlackGate({ ...harness.task(taskId), proposal: null }, gate, URL) ?? never())
    ).toContain('💡 *Proposed change*  \n');
    for (const type of ['merge', 'operation', 'failure', 'configuration', 'sign_in', 'post_merge'] as const) {
      expect(serializeSlackGate(harness.task(taskId), { ...gate, type }, URL)).toBeNull();
    }
  });
});

describe('the result', () => {
  function deliver(harness: Harness, taskId: string, body: string, step: 'answer' | 'research' = 'answer') {
    harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step, body });
  }

  test('posts as mrkdwn with a link to Shinsa', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'answer');
    deliver(
      harness,
      taskId,
      '## Cause\nThe **parser** reads it all. See [the code](https://github.com/a/b).'
    );
    const task = harness.task(taskId);
    const message = serializeSlackResult(task, URL) ?? never();
    expect(readText(message)).toBe(
      `*Cause*\nThe *parser* reads it all. See <https://github.com/a/b|the code>.\n<${URL}|Open in Shinsa>`
    );
    expect(message.text).toBe('## Cause');
  });

  test('a long one is cut at a word, with a link to read the rest', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'research');
    deliver(
      harness,
      taskId,
      Array.from({ length: 400 }, (_, index) => `Paragraph ${index} words`).join('\n\n'),
      'research'
    );
    const message = serializeSlackResult(harness.task(taskId), URL) ?? never();
    expect(readText(message).length).toBeLessThanOrEqual(SLACK_RESULT_LIMIT + URL.length + 40);
    expect(readText(message)).toEndWith(`…\n<${URL}|Read the rest in Shinsa>`);
    const unbroken = startShaped(harness, 'answer', 'Other');
    deliver(harness, unbroken, 'x'.repeat(SLACK_RESULT_LIMIT + 10));
    expect(readText(serializeSlackResult(harness.task(unbroken), URL) ?? never())).toStartWith(
      `${'x'.repeat(SLACK_RESULT_LIMIT)}…`
    );
  });

  test('a task without a result has nothing to post', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness));
    expect(serializeSlackResult(task, URL)).toBeNull();
  });
});

describe("the bot's own replies", () => {
  test('forwarded, held, not a task, the connect link and offline are each one short line', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness, { request: 'Fix it' }));
    expect(readText(serializeSlackForwarded(task, URL))).toBe(`↪️ Sent to <${URL}|SUP-1 · Fix it>`);
    expect(readText(serializeSlackHeld(task, URL))).toBe(
      `📌 Kept for <${URL}|SUP-1 · Fix it>. It waits on you in Shinsa.`
    );
    expect(readText(serializeSlackDeclined())).toBe('Not a task, so nothing was started.');
    expect(readText(serializeSlackLinkPrompt('https://app.shinsa.dev/slack/connect'))).toEndWith(
      '<https://app.shinsa.dev/slack/connect|Connect Slack>'
    );
    expect(readText(serializeSlackOffline('Studio & Co'))).toStartWith('🔌 *Studio &amp; Co* is offline');
  });
});

describe('a post from the outbox', () => {
  test('resolves each kind from the state, and nothing for a task or gate that is gone', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Go?' });
    const { state } = harness;
    expect(
      readText(resolveSlackPostMessage(state, { kind: 'gate', gateId: 'q1' }, taskId, URL) ?? never())
    ).toContain('Go?');
    expect(resolveSlackPostMessage(state, { kind: 'gate', gateId: 'gone' }, taskId, URL)).toBeNull();
    expect(resolveSlackPostMessage(state, { kind: 'forwarded' }, taskId, URL)?.text).toStartWith('Sent to');
    expect(resolveSlackPostMessage(state, { kind: 'held' }, taskId, URL)?.text).toStartWith('Kept for');
    expect(resolveSlackPostMessage(state, { kind: 'result' }, taskId, URL)).toBeNull();
    expect(resolveSlackPostMessage(state, { kind: 'forwarded' }, 'gone', URL)).toBeNull();
    expect(listSlackStatusGates(state, taskId).map((gate) => gate.id)).toEqual(['q1']);
  });
});

describe('Slack limits on every message', () => {
  test('a long fallback is cut, and empty contexts and extra blocks are dropped', () => {
    const blocks = [
      ...Array.from({ length: 60 }, () => createSlackSection('x')),
      { type: 'context' as const, elements: [] },
    ];
    const message = createSlackMessage('y'.repeat(5000), blocks);
    expect(message.blocks.length).toBe(SLACK_BLOCK_LIMITS.blocks);
    expect(message.text.length).toBe(SLACK_BLOCK_LIMITS.fallback);
    const section = createSlackSection('z'.repeat(4000));
    const text = section.type === 'section' ? section.text.text : '';
    expect(text.length).toBeLessThanOrEqual(SLACK_BLOCK_LIMITS.section);
    expect(text).toEndWith('…');
  });
});

function never(): never {
  throw new Error('expected a value');
}
