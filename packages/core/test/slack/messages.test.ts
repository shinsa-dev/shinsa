import { describe, expect, test } from 'bun:test';
import {
  createSlackMessage,
  createSlackSection,
  listSlackStatusGates,
  parseSlackAnswerValue,
  resolveSlackPostMessage,
  resolveSlackReaction,
  resolveSlackSessionStatus,
  SLACK_BLOCK_LIMITS,
  SLACK_QUESTION_BLOCK,
  SLACK_REACTIONS,
  SLACK_RESULT_LIMIT,
  serializeSlackAnsweredView,
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
import { readBlockText, readMessageText } from './read.ts';

const URL = 'https://app.shinsa.dev/tasks/t1';

const readText = readMessageText;

function footerOf(harness: Harness, taskId: string) {
  const task = harness.task(taskId);
  return `<${URL}|${task.handle} · ${task.title}>`;
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
  test('is what the task does now in bold, over a small line naming the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Fix the <export> & hang' });
    const message = statusOf(harness, taskId);
    expect(message.blocks.map((block) => block.type)).toEqual(['section', 'context']);
    expect(readText(message)).toBe(
      `*Planning the phases*\n<${URL}|SUP-1 · Fix the &lt;export&gt; &amp; hang>`
    );
    expect(message.text).toBe('SUP-1 · Fix the &lt;export&gt; &amp; hang: Planning the phases');
  });

  test('says what needs you when a question waits or the task failed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Which <format>?' });
    expect(readText(statusOf(harness, taskId))).toStartWith('*Needs you*\n> Which &lt;format&gt;?\n<');
    const failed = createTask(harness, { request: 'Second' });
    harness.send({ type: 'effect.fail', taskId: failed, title: 'The worktree failed', detail: 'disk full' });
    expect(readText(statusOf(harness, failed))).toStartWith('*Needs you*\n> The worktree failed\n');
  });

  test('adds the pull request beside the task, with no icons', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    const text = readText(statusOf(harness, taskId));
    expect(text).toStartWith('*Pull request merged*\n<');
    expect(text).toEndWith(
      `  <${harness.task(taskId).pullRequest?.url}|PR #${harness.task(taskId).pullRequest?.number}>`
    );
    const other = createTask(harness, { request: 'Other' });
    harness.send({ type: 'task.cancel', taskId: other });
    expect(readText(statusOf(harness, other))).toStartWith('*Cancelled by you*');
  });
});

describe('the reaction on the mention', () => {
  test('sizes up, works, needs you, fails, finishes or is cancelled, one state at a time', () => {
    const harness = createHarness();
    const reactionOf = (taskId: string) =>
      resolveSlackReaction(harness.task(taskId), listSlackStatusGates(harness.state, taskId));
    const first = createTask(harness, { request: 'First' });
    expect(reactionOf(first)).toBe(SLACK_REACTIONS.working);
    const second = createTask(harness, { request: 'Second', waitsOn: [first] });
    expect(reactionOf(second)).toBe(SLACK_REACTIONS.sizing);
    harness.send({ type: 'task.create', request: 'Untriaged', repoId: null });
    const untriaged = Object.values(harness.state.tasks).find((task) => task.stage === 'triage');
    expect(reactionOf(untriaged?.id ?? never())).toBe(SLACK_REACTIONS.sizing);
    ask(harness, first, { question: 'Go?' });
    expect(reactionOf(first)).toBe(SLACK_REACTIONS.needsYou);
    const failed = createTask(harness, { request: 'Failed' });
    harness.send({ type: 'effect.fail', taskId: failed, title: 'The worktree failed', detail: 'disk full' });
    expect(reactionOf(failed)).toBe(SLACK_REACTIONS.failed);
    const review = createTask(harness, { request: 'Review' });
    reachReviewGate(harness, review);
    expect(reactionOf(review)).toBe(SLACK_REACTIONS.needsYou);
    approve(harness, review);
    harness.send({
      type: 'pull_request.record',
      taskId: review,
      pullRequest: pullRequest({ state: 'merged' }),
    });
    expect(reactionOf(review)).toBe(SLACK_REACTIONS.done);
    harness.send({ type: 'task.cancel', taskId: second });
    expect(reactionOf(second)).toBe(SLACK_REACTIONS.cancelled);
    const answered = startShaped(harness, 'answer', 'Why?');
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(answered).id,
      step: 'answer',
      body: 'Because.',
    });
    expect(reactionOf(answered)).toBe(SLACK_REACTIONS.done);
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
  test('a question has a button per choice, the recommended one primary, and a link to answer in Shinsa', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Which `format`?', choices: ['CSV', 'JSON'], recommendation: 'JSON' });
    const message =
      serializeSlackGate(harness.task(taskId), harness.state.gates.q1 ?? never(), URL) ?? never();
    expect(readText(message)).toBe(
      `Question for you\n*Which \`format\`?*\nRecommended: *JSON*\n[CSV]  [JSON]  <${URL}|Answer in Shinsa>\n${footerOf(harness, taskId)}`
    );
    const actions = message.blocks.find((block) => block.type === 'actions') ?? never();
    expect(actions).toMatchObject({ block_id: `${SLACK_QUESTION_BLOCK}.q1` });
    const [csv, json, open] = actions.type === 'actions' ? actions.elements : never();
    expect(parseSlackAnswerValue(csv?.value ?? never())).toEqual({ gateId: 'q1', choice: 0 });
    expect(csv?.style).toBeUndefined();
    expect(json?.style).toBe('primary');
    expect(open?.style).toBeUndefined();
    expect(message.text).toContain('asks: Which `format`?');
  });

  test('a question with long or many choices lists them, and only links to Shinsa', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const choices = ['A', 'B', 'C', 'D', 'E', 'F'];
    ask(harness, taskId, { question: 'Which?', choices });
    const message =
      serializeSlackGate(harness.task(taskId), harness.state.gates.q1 ?? never(), URL) ?? never();
    const text = readText(message);
    expect(text).toContain('*1.*  A\n*2.*  B');
    expect(text).toContain(`\n<${URL}|Answer in Shinsa>\n`);
    expect(text).not.toContain('[A]');
    const long = { ...(harness.state.gates.q1 ?? never()), choices: ['x'.repeat(90), 'y'] };
    const longText = readText(serializeSlackGate(harness.task(taskId), long, URL) ?? never());
    expect(longText).toContain(`*1.*  ${'x'.repeat(90)}`);
    expect(longText).toContain(`[${'x'.repeat(74)}…]`);
  });

  test('a question without choices is only its title and the link', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Go?' });
    const message =
      serializeSlackGate(harness.task(taskId), harness.state.gates.q1 ?? never(), URL) ?? never();
    expect(readText(message)).toBe(
      `Question for you\n*Go?*\n<${URL}|Answer in Shinsa>\n${footerOf(harness, taskId)}`
    );
    const withContext = { ...(harness.state.gates.q1 ?? never()), body: 'The page has room. More here.' };
    expect(readText(serializeSlackGate(harness.task(taskId), withContext, URL) ?? never())).toContain(
      '*Go?*\n> The page has room.\n'
    );
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
    expect(text).toBe(
      `Secret needed\n*Stripe key*\nGive it in Shinsa, never in Slack.\n<${URL}|Give it in Shinsa>\n${footerOf(harness, taskId)}`
    );
  });

  test('a plan is its goal quoted, its phases numbered and a link to review it', () => {
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
    expect(text).toBe(
      `Plan ready for your approval\n> Stream the export. Then test it on a large file.\n*1.*  Read in chunks\n*2.*  Test it\n<${URL}|Review the plan>\n${footerOf(harness, taskId)}`
    );
    const task = harness.task(taskId);
    const plan = task.plan ?? never();
    const document = plan.document ?? never();
    const long = {
      ...task,
      plan: {
        ...plan,
        document: {
          ...document,
          phases: Array.from({ length: 10 }, (_, index) => ({ title: `Phase ${index}`, detail: '' })),
        },
      },
    };
    const longText = readText(serializeSlackGate(long, harness.openGate(taskId), URL) ?? never());
    expect(longText).toContain('*8.*  Phase 7\n_and 2 more phases_\n');
    const bare = { ...task, plan: null };
    expect(readText(serializeSlackGate(bare, harness.openGate(taskId), URL) ?? never())).toContain(
      `> ${task.title}\n<`
    );
  });

  test('a review is its summary, how the checks went and a link, plus the pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const task = harness.task(taskId);
    const text = readText(serializeSlackGate(task, harness.openGate(taskId), URL) ?? never());
    expect(text).toStartWith('Ready for your review\n> ');
    expect(text).toContain('\n*Checks*\nAll');
    expect(text).toContain('*Pull request*\nOpens once you approve\n');
    expect(text).toContain(`<${URL}|Review in Shinsa>\n`);
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
    expect(failed).toContain(
      'Ready for your review\n> Streams the export.\n*Checks*\n1 of 2 checks failed.\n'
    );
    expect(failed).toContain(
      `*Pull request*\n<${failing.pullRequest.url}|PR #${failing.pullRequest.number}>\n`
    );
    expect(failed).toEndWith(`|PR #${failing.pullRequest.number}>`);
    const one = { ...task, checkResults: [{ ...check, outcome: 'pass' as const }] };
    expect(readText(serializeSlackGate(one, harness.openGate(taskId), URL) ?? never())).toContain(
      'The check passed.'
    );
    const none = { ...task, checkResults: [], summary: 'x'.repeat(400) };
    const bare = readText(serializeSlackGate(none, harness.openGate(taskId), URL) ?? never());
    expect(bare).toContain(`${'x'.repeat(279)}…\n*Checks*\nNone ran\n`);
  });

  test('a proposal is the change quoted and a link, and gates nobody decides in Slack post nothing', () => {
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
      `Proposed change\n> Stream the export in chunks.\n> More detail.\n<${URL}|Decide in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(
      readText(serializeSlackGate({ ...harness.task(taskId), proposal: null }, gate, URL) ?? never())
    ).toBe(
      `Proposed change\n> A change to the code.\n<${URL}|Decide in Shinsa>\n${footerOf(harness, taskId)}`
    );
    for (const type of [
      'merge',
      'operation',
      'failure',
      'configuration',
      'sign_in',
      'post_merge',
      'result',
    ] as const) {
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
      `Result\n*Cause*\nThe *parser* reads it all. See <https://github.com/a/b|the code>.\n<${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
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
    const body = message.blocks.slice(1, -2).map(readBlockText).join('\n');
    expect(body.length).toBeLessThanOrEqual(SLACK_RESULT_LIMIT + 100);
    expect(readText(message)).toContain(`…\n<${URL}|Read the rest in Shinsa>\n`);
    const unbroken = startShaped(harness, 'answer', 'Other');
    deliver(harness, unbroken, 'x'.repeat(SLACK_RESULT_LIMIT + 10));
    expect(readText(serializeSlackResult(harness.task(unbroken), URL) ?? never())).toStartWith(
      `Result\n${'x'.repeat(SLACK_RESULT_LIMIT)}…`
    );
  });

  test('a task without a result has nothing to post', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness));
    expect(serializeSlackResult(task, URL)).toBeNull();
  });
});

describe("the bot's own replies", () => {
  test('forwarded, held, not a task, the connect link and offline are a bold title over plain lines', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness, { request: 'Fix it' }));
    expect(readText(serializeSlackForwarded(task, URL))).toBe(
      `*Sent to the task*\nIts agent reads it next.\n<${URL}|SUP-1 · Fix it>`
    );
    expect(readText(serializeSlackHeld(task, URL))).toBe(
      `*Kept for the task*\nIt waits on you in Shinsa, so its agent reads this once you decide.\n<${URL}|SUP-1 · Fix it>`
    );
    expect(serializeSlackAnsweredView('JSON & CSV', 'U1')).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '<@U1> answered *JSON &amp; CSV*' }],
    });
    const declined = serializeSlackDeclined();
    expect(declined.text).toBe('Not a task, so nothing was started.');
    expect(declined.blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: '*Not a task*\nNothing was started.' } },
    ]);
    for (const message of [serializeSlackForwarded(task, URL), serializeSlackHeld(task, URL)])
      expect(message.blocks.map((block) => block.type)).toEqual(['section', 'context']);
    expect(readText(serializeSlackLinkPrompt('https://app.shinsa.dev/slack/connect'))).toEndWith(
      '<https://app.shinsa.dev/slack/connect|Connect Slack>'
    );
    expect(readText(serializeSlackOffline('Studio & Co'))).toStartWith('*Studio &amp; Co is offline*\n');
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
  test('a long fallback is cut, and extra blocks are dropped', () => {
    const blocks = Array.from({ length: 60 }, () => createSlackSection('x'));
    const message = createSlackMessage('y'.repeat(5000), blocks);
    expect(message.blocks.length).toBe(SLACK_BLOCK_LIMITS.blocks);
    expect(message.text.length).toBe(SLACK_BLOCK_LIMITS.fallback);
    const section = createSlackSection('z'.repeat(4000));
    const text = readBlockText(section);
    expect(text.length).toBeLessThanOrEqual(SLACK_BLOCK_LIMITS.section);
    expect(text).toEndWith('…');
  });
});

function never(): never {
  throw new Error('expected a value');
}
