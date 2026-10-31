import { describe, expect, test } from 'bun:test';
import {
  createSlackHeader,
  createSlackMessage,
  createSlackSection,
  listSlackStatusGates,
  resolveSlackPostMessage,
  SLACK_BLOCK_LIMITS,
  SLACK_RESULT_LIMIT,
  type SlackBlock,
  type SlackMessage,
  serializeSlackDeclined,
  serializeSlackForwarded,
  serializeSlackGate,
  serializeSlackLinkPrompt,
  serializeSlackOffline,
  serializeSlackReading,
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
    .map((block: SlackBlock) => {
      if (block.type === 'header') return block.text.text;
      if (block.type === 'section') return [block.text.text, block.accessory?.text.text ?? ''].join(' ');
      if (block.type === 'context') return block.elements.map((element) => element.text).join(' ');
      if (block.type === 'actions') return block.elements.map((button) => button.text.text).join(' ');
      return '---';
    })
    .join('\n');
}

function listButtons(message: SlackMessage) {
  return message.blocks.flatMap((block) => {
    if (block.type === 'actions') return block.elements;
    if (block.type === 'section' && block.accessory) return [block.accessory];
    return [];
  });
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

describe('the status message', () => {
  test('names the task with a link, its stage, its steps and an Open in Shinsa button', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Fix the <export> & hang' });
    const message = statusOf(harness, taskId);
    const [section, context] = message.blocks;
    expect(section).toMatchObject({
      type: 'section',
      accessory: { type: 'button', text: { text: 'Open in Shinsa' }, url: URL },
    });
    expect(section?.type === 'section' && section.text.text).toStartWith(
      `*<${URL}|Fix the &lt;export&gt; &amp; hang>*\n🔵 *Planning the phases*`
    );
    const handle = harness.task(taskId).handle;
    expect(context?.type === 'context' && context.elements.map((element) => element.text)).toEqual([
      `*${handle}*`,
      expect.stringContaining('● Plan'),
    ]);
    expect(message.text).toBe(`${handle} · Fix the &lt;export&gt; &amp; hang: 🔵 Planning the phases`);
  });

  test('marks a step that waits for you, and counts phases as they finish', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const text = readText(statusOf(harness, taskId));
    expect(text).toContain('🟣 *Changes ready for your review*');
    expect(text).toContain('✓ Plan');
    expect(text).toContain('◐ Your review');
  });

  test('a question or a failure says the task needs you, with the gate title', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Which <format>?',
      context: null,
    });
    expect(readText(statusOf(harness, taskId))).toContain('🟣 *Needs you*  Which &lt;format&gt;?');
    const failed = createTask(harness, { request: 'Second' });
    harness.send({ type: 'effect.fail', taskId: failed, title: 'The worktree failed', detail: 'disk full' });
    expect(readText(statusOf(harness, failed))).toContain('🔴 *Needs you*  The worktree failed');
  });

  test('shows the pull request once there is one, and a finished mark when merged or cancelled', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    const text = readText(statusOf(harness, taskId));
    expect(text).toContain('✅ *Pull request merged*');
    expect(text).toContain(`|Pull request #${harness.task(taskId).pullRequest?.number}>`);
    const other = createTask(harness, { request: 'Other' });
    harness.send({ type: 'task.cancel', taskId: other });
    expect(readText(statusOf(harness, other))).toContain('⚪ *Cancelled by you*');
  });

  test('a task that waits on another says so with an hourglass', () => {
    const harness = createHarness();
    const first = createTask(harness, { request: 'First' });
    const second = createTask(harness, { request: 'Second', waitsOn: [first] });
    expect(readText(statusOf(harness, second))).toContain('⏳ *Waiting for “First” to finish*');
  });
});

describe('the posts each gate makes', () => {
  test('a question lists its body, its choices with the recommendation, and how to answer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Which format should the export use?',
      context: 'The **old** one is slow.',
      choices: ['CSV', 'JSON'],
      recommendation: 'JSON',
    });
    const message = serializeSlackGate(harness.task(taskId), harness.state.gates.q1 ?? never(), URL);
    const text = readText(message ?? never());
    expect(text).toContain('Question\n*Which format should the export use?*');
    expect(text).toContain('The *old* one is slow.');
    expect(text).toContain('• CSV\n• JSON  _recommended_');
    expect(text).toContain('Or mention me in this thread with your answer.');
    expect(listButtons(message ?? never())).toEqual([
      expect.objectContaining({
        text: expect.objectContaining({ text: 'Answer in Shinsa' }),
        style: 'primary',
      }),
    ]);
    expect(message?.text).toContain('asks: Which format should the export use?');
  });

  test('a question with no body or choices is only its title', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Go?',
      context: null,
    });
    const message = serializeSlackGate(harness.task(taskId), harness.state.gates.q1 ?? never(), URL);
    expect(message?.blocks.map((block) => block.type)).toEqual(['header', 'section', 'actions', 'context']);
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
    expect(text).toContain('Secret needed\n*Stripe key*');
    expect(text).toContain('Never paste a secret in Slack.');
  });

  test('a plan shows its goal, its numbered phases and its size', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: {
        goal: 'Stream the export.',
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
        questions: [{ question: 'Keep CSV?', options: ['Yes', 'No'], recommendation: 'Yes' }],
      },
    });
    const gate = harness.openGate(taskId);
    const text = readText(serializeSlackGate(harness.task(taskId), gate, URL) ?? never());
    expect(text).toContain('Plan to approve');
    expect(text).toContain('Stream the export.');
    expect(text).toContain('1. *Read in chunks*  Use a stream.\n2. *Test it*  A large file.');
    expect(text).toContain('1 file · 1 check · 1 question');
    expect(text).toContain('Review the plan');
    expect(text).toContain('Approve it in Shinsa. Mention me here to ask for changes.');
  });

  test('a review reads like the pull request description: summary, approach, checks and risks', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const text = readText(serializeSlackGate(harness.task(taskId), harness.openGate(taskId), URL) ?? never());
    expect(text).toContain('Ready for your review');
    expect(text).toContain('✅ *Checks*  All');
    expect(text).toContain('Review in Shinsa');
  });

  test('a review names failing checks, findings, coverage, risks and the steps before the merge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const task = harness.task(taskId);
    const risks = Array.from({ length: 7 }, (_, index) => ({
      title: `Risk ${index}`,
      file: null,
      line: null,
      end: null,
      risk: 'It may break.',
    }));
    const walkthrough = {
      approach: 'Read with a `ReadableStream`.',
      flow: '',
      risks,
      testing: { automated: [], manual: [] },
      steps: [
        {
          when: 'pre_merge' as const,
          kind: 'env' as const,
          title: 'Set EXPORT_DIR',
          detail: 'In production.',
          command: null,
        },
      ],
    };
    const reviewed = {
      ...task,
      phaseReports: task.phaseReports.map((report) => ({ ...report, walkthrough })),
      summary: 'Streams the **export**.',
      checkResults: [
        { id: 'c1', label: 'Export tests', command: 'bun test', outcome: 'fail' as const, detail: null },
      ],
      coverage: {
        status: 'measured' as const,
        command: 'bun test --coverage',
        covered: 8,
        executable: 10,
        files: [],
      },
      findings: [{ severity: 'should_fix' as const, file: null, line: null, message: 'Name it better.' }],
      pullRequest: pullRequest(),
    };
    const text = readText(serializeSlackGate(reviewed, harness.openGate(taskId), URL) ?? never());
    expect(text).toContain('Streams the *export*.');
    expect(text).toContain('*Approach*\nRead with a `ReadableStream`.');
    expect(text).toContain('❌ *Checks*  1 of 1 did not pass. The tests cover 8 of 10 changed lines.');
    expect(text).toContain('🔎 *Agent review*  1 finding for you to weigh.');
    expect(text).toContain('☐ *Before the merge*  1 step for you, listed in Shinsa.');
    expect(text).toContain('• ⚠️ *Risk 0*  It may break.');
    expect(text).toContain('_and 2 more risks_');
    expect(text).toContain(`|Pull request #${reviewed.pullRequest.number}>`);
  });

  test('a proposal shows the change and why, and gates nobody acts on in Slack post nothing', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'investigate');
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'investigate',
      body: 'It reads the whole file.',
      proposal: { request: 'Stream the export in chunks.', why: 'It reads the whole file into memory.' },
    });
    const gate = harness.openGate(taskId);
    const text = readText(serializeSlackGate(harness.task(taskId), gate, URL) ?? never());
    expect(text).toContain('Change to approve');
    expect(text).toContain('Stream the export in chunks.');
    expect(text).toContain('_Why:_ It reads the whole file into memory.');
    for (const type of ['merge', 'operation', 'failure', 'configuration', 'sign_in', 'post_merge'] as const) {
      expect(serializeSlackGate(harness.task(taskId), { ...gate, type }, URL)).toBeNull();
    }
  });
});

describe('the result', () => {
  test('is posted in full under its kind, as mrkdwn', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'answer');
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'answer',
      body: '## Cause\nThe **parser** reads it all. See [the code](https://github.com/a/b).',
    });
    const message = serializeSlackResult(harness.task(taskId), URL) ?? never();
    const text = readText(message);
    expect(text).toStartWith('Answer\n');
    expect(text).toContain('*Cause*\nThe *parser* reads it all. See <https://github.com/a/b|the code>.');
    expect(text).not.toContain('cut short');
    expect(message.text).toStartWith('Answer for ');
  });

  test('a long one is split into sections and cut with a pointer to Shinsa', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'research');
    const body = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} ${'word '.repeat(10)}`).join(
      '\n\n'
    );
    harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step: 'research', body });
    const message = serializeSlackResult(harness.task(taskId), URL) ?? never();
    const sections = message.blocks
      .flatMap((block) => (block.type === 'section' ? [block.text.text] : []))
      .slice(1);
    expect(sections.length).toBeGreaterThan(3);
    for (const section of sections) expect(section.length).toBeLessThanOrEqual(SLACK_BLOCK_LIMITS.section);
    const total = sections.reduce((sum, section) => sum + section.length, 0);
    expect(total).toBeLessThanOrEqual(SLACK_RESULT_LIMIT);
    expect(readText(message)).toContain('_This is cut short. Read the rest in Shinsa._');
    expect(readText(message)).toStartWith('Report\n');
  });

  test('a task without a result posts nothing', () => {
    const harness = createHarness();
    expect(serializeSlackResult(harness.task(createTask(harness)), URL)).toBeNull();
  });
});

describe("the bot's own replies", () => {
  test('forwarded, declined, reading, link and offline', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness, { request: 'Fix it' }));
    expect(readText(serializeSlackForwarded(task, URL))).toBe(
      `↪️ Sent to <${URL}|Fix it>. It reads your message next.`
    );
    expect(readText(serializeSlackDeclined('This reads as a <thanks>.'))).toBe(
      "I didn't start a task. This reads as a &lt;thanks&gt;. \nMention me again with what you want done, and I will take it from there."
    );
    expect(readText(serializeSlackReading())).toBe('👀 Reading the thread…');
    const link = serializeSlackLinkPrompt('https://app.shinsa.dev/slack/link');
    expect(listButtons(link)).toEqual([
      expect.objectContaining({ url: 'https://app.shinsa.dev/slack/link', style: 'primary' }),
    ]);
    expect(readText(serializeSlackOffline('Studio & Co'))).toContain('*Studio &amp; Co is offline*');
  });
});

describe('a post from the outbox', () => {
  test('resolves each kind from the state, and nothing for a task or gate that is gone', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Go?',
      context: null,
    });
    const { state } = harness;
    expect(
      readText(resolveSlackPostMessage(state, { kind: 'gate', gateId: 'q1' }, taskId, URL) ?? never())
    ).toContain('Go?');
    expect(resolveSlackPostMessage(state, { kind: 'gate', gateId: 'gone' }, taskId, URL)).toBeNull();
    expect(resolveSlackPostMessage(state, { kind: 'forwarded' }, taskId, URL)?.text).toStartWith('Sent to');
    expect(resolveSlackPostMessage(state, { kind: 'result' }, taskId, URL)).toBeNull();
    expect(resolveSlackPostMessage(state, { kind: 'forwarded' }, 'gone', URL)).toBeNull();
    expect(
      resolveSlackPostMessage(state, { kind: 'declined', reason: 'Thanks.' }, null, URL)?.text
    ).toContain('Thanks.');
    expect(listSlackStatusGates(state, taskId).map((gate) => gate.id)).toEqual(['q1']);
  });
});

describe('Slack limits on every message', () => {
  test('a long title, label and fallback are cut, and empty contexts and extra blocks are dropped', () => {
    const blocks = [
      ...Array.from({ length: 60 }, () => createSlackSection('x')),
      { type: 'context' as const, elements: [] },
    ];
    const message = createSlackMessage('y'.repeat(5000), blocks);
    expect(message.blocks.length).toBe(SLACK_BLOCK_LIMITS.blocks);
    expect(message.text.length).toBe(SLACK_BLOCK_LIMITS.fallback);
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q1',
      question: 'Go?',
      context: null,
    });
    const task = { ...harness.task(taskId), title: 't'.repeat(400) };
    const plan =
      serializeSlackGate(
        task,
        { ...harness.openGate(taskId), type: 'plan' },
        `https://app.shinsa.dev/${'u'.repeat(4000)}`
      ) ?? never();
    expect(createSlackHeader('h'.repeat(400))).toMatchObject({
      text: { text: `${'h'.repeat(SLACK_BLOCK_LIMITS.header - 1)}…` },
    });
    for (const block of plan.blocks) {
      if (block.type === 'section')
        expect(block.text.text.length).toBeLessThanOrEqual(SLACK_BLOCK_LIMITS.section);
    }
    for (const button of listButtons(plan)) expect(button.url.length).toBe(SLACK_BLOCK_LIMITS.url);
  });
});

function never(): never {
  throw new Error('expected a value');
}
