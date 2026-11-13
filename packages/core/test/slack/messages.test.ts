import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  createSlackMessage,
  createSlackSection,
  type Gate,
  listSlackStatusGates,
  parseSlackDecisionValue,
  resolveSlackEscalationFollowUp,
  resolveSlackEscalationMessage,
  serializeSlackEscalationTest,
  SLACK_ESCALATION_TEST_NOTE,
  resolveSlackMergeMessage,
  resolveSlackPostMessage,
  resolveSlackReaction,
  resolveSlackSessionStatus,
  SLACK_BLOCK_LIMITS,
  SLACK_GATE_BLOCK,
  SLACK_REACTIONS,
  type SlackButton,
  type SlackMessage,
  serializeSlackCard,
  serializeSlackDeclined,
  serializeSlackGate,
  serializeSlackLinkPrompt,
  serializeSlackReconnectPrompt,
  serializeSlackUnreadLinks,
  serializeSlackMerged,
  serializeSlackNoAccess,
  serializeSlackOffline,
  type Task,
  type TaskEscalation,
  type TaskShape,
  type Watchdog,
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
  spendRetries,
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
  return serializeSlackCard(harness.task(taskId), listSlackStatusGates(harness.state, taskId), URL);
}

function buttonsOf(message: SlackMessage): SlackButton[] {
  const actions = message.blocks.find((block) => block.type === 'actions');
  return actions?.type === 'actions' ? actions.elements : [];
}

function valuesOf(message: SlackMessage) {
  return buttonsOf(message)
    .filter((button) => button.value !== undefined)
    .map((button) => ({
      action: button.action_id,
      ...Option.getOrNull(parseSlackDecisionValue(button.value ?? '')),
    }));
}

function gateCardOf(harness: Harness, taskId: string, gate: Gate = harness.openGate(taskId)) {
  return Option.getOrNull(serializeSlackGate(harness.task(taskId), gate, URL)) ?? never();
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

  test('is the open gate when one waits on you, and the status again once it closes', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Which <format>?' });
    expect(readText(statusOf(harness, taskId))).toStartWith('Question for you\n*Which &lt;format&gt;?*\n');
    harness.send({ type: 'gate.answer', gateId: 'q1', decision: 'reply', response: 'CSV' });
    expect(readText(statusOf(harness, taskId))).not.toContain('Question for you');
    const failed = createTask(harness, { request: 'Second' });
    spendRetries(harness, failed);
    harness.send({ type: 'effect.fail', taskId: failed, title: 'The worktree failed', detail: 'disk full' });
    expect(readText(statusOf(harness, failed))).toStartWith('Something failed\n*The worktree failed*\n');
  });

  test('says who decided last from Slack under the status', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const task = harness.task(taskId);
    const link = {
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.1',
      userId: 'U1',
      messageTs: '1.2',
      permalink: null,
      channelName: null,
      statusTs: null,
      reaction: null,
      decided: { userId: 'U7', text: 'approved the plan' },
    };
    const message = serializeSlackCard({ ...task, slack: link }, [], URL);
    expect(message.blocks.map((block) => block.type)).toEqual(['section', 'context', 'context']);
    expect(readText(message)).toBe(
      `*Planning the phases*\n<@U7> approved the plan\n${footerOf(harness, taskId)}`
    );
  });

  test('shows a gate Slack only links to as the status, such as a configuration check', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Go?' });
    const gate = { ...(harness.state.gates.q1 ?? never()), type: 'configuration' as const };
    expect(readText(serializeSlackCard(harness.task(taskId), [gate], URL))).toStartWith('*');
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
    spendRetries(harness, failed);
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

describe('the card for each gate', () => {
  test('a question has a button per choice, the recommended one primary, Answer… and a link', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Which `format`?', choices: ['CSV', 'JSON'], recommendation: 'JSON' });
    const message = gateCardOf(harness, taskId);
    expect(readText(message)).toBe(
      `Question for you\n*Which \`format\`?*\nRecommended: *JSON*\n[CSV]  [JSON]  [Answer…]  <${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    const actions = message.blocks.find((block) => block.type === 'actions') ?? never();
    expect(actions).toMatchObject({ block_id: `${SLACK_GATE_BLOCK}.q1` });
    expect(valuesOf(message)).toEqual([
      { action: 'shinsa.decide.choice.0', gateId: 'q1', decision: 'reply', choice: 0, planVersion: null },
      { action: 'shinsa.decide.choice.1', gateId: 'q1', decision: 'reply', choice: 1, planVersion: null },
      { action: 'shinsa.write.reply', gateId: 'q1', decision: 'reply', choice: null, planVersion: null },
    ]);
    expect(buttonsOf(message).map((button) => button.style ?? null)).toEqual([null, 'primary', null, null]);
    expect(message.text).toContain('asks: Which `format`?');
  });

  test('a question with long or many choices lists them and answers through the form', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Which?', choices: ['A', 'B', 'C', 'D', 'E', 'F'] });
    const message = gateCardOf(harness, taskId);
    const text = readText(message);
    expect(text).toContain('*1.*  A\n*2.*  B');
    expect(text).toContain(`\n[Answer…]  <${URL}|Open in Shinsa>\n`);
    expect(buttonsOf(message)[0]?.style).toBe('primary');
    const long = { ...(harness.state.gates.q1 ?? never()), choices: ['x'.repeat(90), 'y'] };
    const longText = readText(gateCardOf(harness, taskId, long));
    expect(longText).toContain(`*1.*  ${'x'.repeat(90)}`);
    expect(longText).toContain(`[${'x'.repeat(74)}…]`);
  });

  test('a question without choices is its title, its context and the form', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Go?' });
    expect(readText(gateCardOf(harness, taskId))).toBe(
      `Question for you\n*Go?*\n[Answer…]  <${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    const withContext = {
      ...(harness.state.gates.q1 ?? never()),
      body: 'The page has room. More here.\nAnd a **second** line.',
    };
    expect(readText(gateCardOf(harness, taskId, withContext))).toContain(
      '*Go?*\n> The page has room. More here.\n> And a *second* line.\n[Answer…]'
    );
  });

  test('a question with a long context shows all of it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Go?', choices: ['Yes', 'No'], recommendation: 'Yes' });
    const lines = Array.from({ length: 300 }, (_, index) => `Line ${index} of the context.`);
    const gate = { ...(harness.state.gates.q1 ?? never()), body: lines.join('\n') };
    const message = gateCardOf(harness, taskId, gate);
    const quoted = message.blocks.slice(2, -3).map(readBlockText);
    expect(quoted.length).toBeGreaterThan(1);
    expect(quoted.join('\n')).toBe(lines.map((line) => `> ${line}`).join('\n'));
    expect(readText(message)).toContain(`<${URL}|Open in Shinsa>`);
    const huge = { ...gate, body: Array.from({ length: 20000 }, (_, index) => `Line ${index}.`).join('\n') };
    const cut = gateCardOf(harness, taskId, huge);
    expect(cut.blocks).toHaveLength(SLACK_BLOCK_LIMITS.blocks);
    expect(readText(cut)).toContain('Recommended: *Yes*');
    expect(readText(cut)).toContain(`<${URL}|Read the rest in Shinsa>`);
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
    const message = gateCardOf(harness, taskId, harness.state.gates.s1);
    expect(readText(message)).toBe(
      `Secret needed\n*Stripe key*\nGive it in Shinsa, never in Slack.\n<${URL}|Give it in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(valuesOf(message)).toEqual([]);
  });

  test('a browser sign-in is done on the machine, so Slack only links to it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.request_browser_sign_in',
      runId: harness.activeRun(taskId).id,
      gateId: 'b1',
      url: 'https://vercel.com/login',
      reason: 'The deploy page asks me to sign in.',
    });
    const gate = harness.state.gates.b1;
    const message = gateCardOf(harness, taskId, gate);
    expect(readText(message)).toBe(
      `Sign-in needed\n*vercel.com*\nSign in from Shinsa on the machine that runs the task.\n<${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(valuesOf(message)).toEqual([]);
    const bare = gateCardOf(harness, taskId, { ...(gate ?? never()), browserSignIn: null });
    expect(readText(bare)).toContain('*Sign in to vercel.com*');
  });

  test('a plan is its goal, its phases, Approve with the version it shows and Request changes…', () => {
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
    const gate = harness.openGate(taskId);
    const message = gateCardOf(harness, taskId);
    expect(readText(message)).toBe(
      [
        'Plan ready for your approval',
        '*Goal*',
        'Stream the export. Then test it on a large file.',
        '',
        '*Plan*',
        '1. *Read in chunks*: Use a stream.',
        '2. *Test it*: A large file.',
        '',
        '*Behaviour*',
        '• Exports a 2 GB file.',
        '',
        '*Approach*',
        'Streams.',
        '',
        '*Files*',
        '• `src/export.ts`: Stream it.',
        '',
        '*Checks*',
        '• Export tests: `bun test test/export` (phases 1, 2)',
        '',
        '*Evidence*',
        'test',
        `[Approve]  [Request changes…]  <${URL}|Read the plan>`,
        footerOf(harness, taskId),
      ].join('\n')
    );
    const version = harness.task(taskId).plan?.version ?? never();
    expect(valuesOf(message)).toEqual([
      {
        action: 'shinsa.decide.approve',
        gateId: gate.id,
        decision: 'approve',
        choice: null,
        planVersion: version,
      },
      { action: 'shinsa.write.revise', gateId: gate.id, decision: 'revise', choice: null, planVersion: null },
    ]);
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
    const longText = readText(Option.getOrNull(serializeSlackGate(long, gate, URL)) ?? never());
    expect(longText).toContain('9. *Phase 8*: \n10. *Phase 9*: \n');
    const bare =
      Option.getOrNull(
        serializeSlackGate({ ...task, plan: null }, { ...gate, planVersion: undefined }, URL)
      ) ?? never();
    expect(readText(bare)).toContain(`> ${task.title}\n[`);
    expect(valuesOf(bare)[0]?.planVersion).toBeNull();
  });

  test('a review is its summary, its checks and pull request, Approve and Request changes…', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const task = harness.task(taskId);
    const message = gateCardOf(harness, taskId);
    const text = readText(message);
    expect(text).toStartWith(`Ready for your review\n${task.plan?.document?.goal ?? task.title}\n`);
    expect(text).toContain('\n*What changed*\n• ');
    expect(text).toContain('\n*Checks*\nAll');
    expect(text).toContain('*Pull request*\nOpens once you approve\n');
    expect(text).toContain(`[Approve]  [Request changes…]  <${URL}|Review in Shinsa>\n`);
    expect(valuesOf(message).map((value) => value.decision)).toEqual(['approve', 'revise']);
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
    const failed = readText(
      Option.getOrNull(serializeSlackGate(failing, harness.openGate(taskId), URL)) ?? never()
    );
    expect(failed).toStartWith(`Ready for your review\n> ${failing.summary.trim()}\n\n`);
    expect(failed).toContain('• ✗ Export tests: `bun test`\n• ✓ Export tests: `bun test`\n');
    expect(failed).toContain('*Checks*\n1 of 2 checks failed.\n');
    expect(failed).toContain(
      `*Pull request*\n<${failing.pullRequest.url}|PR #${failing.pullRequest.number}>\n`
    );
    expect(failed).toEndWith(`|PR #${failing.pullRequest.number}>`);
    const one = { ...task, checkResults: [{ ...check, outcome: 'pass' as const }] };
    expect(
      readText(Option.getOrNull(serializeSlackGate(one, harness.openGate(taskId), URL)) ?? never())
    ).toContain('The check passed.');
    const none = { ...task, checkResults: [], summary: 'x'.repeat(400) };
    const bare = readText(
      Option.getOrNull(serializeSlackGate(none, harness.openGate(taskId), URL)) ?? never()
    );
    expect(bare).toContain(`> ${'x'.repeat(400)}\n`);
    expect(bare).toContain('*Checks*\nNone ran\n');
  });

  test('a merge is the summary, the pull request and Merge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const gate = { ...harness.openGate(taskId), type: 'merge' as const };
    const message = gateCardOf(harness, taskId, gate);
    expect(readText(message)).toContain(`*Pull request*\nNot open yet\n[Merge]  <${URL}|Open in Shinsa>\n`);
    expect(readText(message)).toStartWith('Ready to merge\nShip it.\n\n*What changed*\n');
    expect(valuesOf(message)).toEqual([
      {
        action: 'shinsa.decide.approve',
        gateId: gate.id,
        decision: 'approve',
        choice: null,
        planVersion: null,
      },
    ]);
  });

  test('a proposal is the change quoted, Approve and Keep as is', () => {
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
    const message = gateCardOf(harness, taskId, gate);
    expect(readText(message)).toBe(
      `Diagnosis\nIt reads the whole file.\n*Proposed change*\n> Stream the export in chunks.\n> More detail.\n[Approve]  [Keep as is]  <${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(valuesOf(message).map((value) => value.decision)).toEqual(['approve', 'reject']);
    const bare = { ...harness.task(taskId), result: null };
    expect(readText(Option.getOrNull(serializeSlackGate(bare, gate, URL)) ?? never())).toBe(
      `Proposed change\n> Stream the export in chunks.\n> More detail.\n[Approve]  [Keep as is]  <${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(
      readText(Option.getOrNull(serializeSlackGate({ ...bare, proposal: null }, gate, URL)) ?? never())
    ).toContain('> A change to the code.\n');
    for (const type of ['configuration', 'post_merge'] as const) {
      expect(Option.getOrNull(serializeSlackGate(harness.task(taskId), { ...gate, type }, URL))).toBeNull();
    }
    expect(Option.getOrNull(serializeSlackGate(bare, { ...gate, type: 'result' }, URL))).toBeNull();
  });

  test('a failure is its title and detail with Retry; a sign-in only links to Shinsa', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    spendRetries(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'The worktree failed', detail: 'disk full. More.' });
    const gate = harness.openGate(taskId);
    const message = gateCardOf(harness, taskId, gate);
    expect(readText(message)).toBe(
      `Something failed\n*The worktree failed*\n> disk full. More. Shinsa already retried it 10 times on its own.\n[Retry]  <${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(valuesOf(message).map((value) => value.decision)).toEqual(['approve']);
    const signIn = gateCardOf(harness, taskId, { ...gate, type: 'sign_in', body: '' });
    expect(readText(signIn)).toBe(
      `Sign-in needed\n*The worktree failed*\n<${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(buttonsOf(signIn)[0]?.style).toBe('primary');
  });

  test('an SSO failure links the authorization page on GitHub', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const link = 'https://github.com/orgs/superwall/sso?authorization_request=A1B2';
    harness.send({
      type: 'effect.fail',
      taskId,
      title: 'Could not push the branch',
      detail: `remote: Resource protected by organization SAML enforcement. ${link}`,
    });
    const message = gateCardOf(harness, taskId, harness.openGate(taskId));
    expect(readText(message)).toContain(`<${link}|Authorize it on GitHub>, then sign \`gh\` in again`);
  });

  test('an operation is what it runs, Run and Finish without it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    spendRetries(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Run the backfill', detail: '' });
    const gate = { ...harness.openGate(taskId), type: 'operation' as const, body: '' };
    const message = gateCardOf(harness, taskId, gate);
    expect(readText(message)).toBe(
      `Ready to run\n*Run the backfill*\n[Run]  [Finish without it]  <${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(valuesOf(message).map((value) => value.decision)).toEqual(['approve', 'reject']);
    const body = Array.from({ length: 40 }, (_, index) => `Step ${index} runs.`).join('\n');
    const steps = readText(gateCardOf(harness, taskId, { ...gate, body }));
    expect(steps).toContain('*Run the backfill*\n> Step 0 runs.\n> Step 1 runs.');
    expect(steps).toContain('> Step 39 runs.\n[Run]');
  });
});

describe('the result', () => {
  function deliver(
    harness: Harness,
    taskId: string,
    body: string,
    step: 'answer' | 'research' | 'investigate' = 'answer'
  ) {
    harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step, body });
  }

  test('is the card, as mrkdwn under a header naming it, with Close and a link to Shinsa', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'answer');
    deliver(
      harness,
      taskId,
      '## Cause\nThe **parser** reads it all. See [the code](https://github.com/a/b).'
    );
    const message = statusOf(harness, taskId);
    expect(readText(message)).toBe(
      `Answer\n*Cause*\nThe *parser* reads it all. See <https://github.com/a/b|the code>.\n[Close]  <${URL}|Open in Shinsa>\n${footerOf(harness, taskId)}`
    );
    expect(message.text).toBe('## Cause');
    expect(valuesOf(message)).toEqual([
      {
        action: 'shinsa.decide.approve',
        gateId: harness.openGate(taskId).id,
        decision: 'approve',
        choice: null,
        planVersion: null,
      },
    ]);
    const research = startShaped(harness, 'research', 'Which queue?');
    deliver(harness, research, 'Use SQS.', 'research');
    expect(readText(statusOf(harness, research))).toStartWith('Report\nUse SQS.\n');
    const investigated = startShaped(harness, 'investigate', 'Why slow?');
    deliver(harness, investigated, 'An N+1 query.', 'investigate');
    expect(readText(statusOf(harness, investigated))).toStartWith('Diagnosis\nAn N+1 query.\n');
  });

  test('names an operation’s result its outcome', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'answer');
    deliver(harness, taskId, 'Backfilled 40 rows.');
    const task = harness.task(taskId);
    const result = task.result ?? never();
    const message = Option.getOrNull(
      serializeSlackGate({ ...task, result: { ...result, step: 'operate' } }, harness.openGate(taskId), URL)
    );
    expect(readText(message ?? never())).toStartWith('Outcome\nBackfilled 40 rows.\n');
  });

  test('stays on the card once the task is closed, with who closed it and no buttons', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'answer');
    deliver(harness, taskId, 'It is the buffer.');
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    expect(harness.task(taskId).stage).toBe('done');
    const task = harness.task(taskId);
    const decided = { userId: 'U7', text: 'closed it' };
    const link = {
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '1.1',
      userId: 'U1',
      messageTs: '1.2',
      permalink: null,
      channelName: null,
      statusTs: null,
      reaction: null,
      merge: null,
      decided,
    };
    const message = serializeSlackCard({ ...task, slack: link }, [], URL);
    expect(readText(message)).toBe(
      `Answer\nIt is the buffer.\n<@U7> closed it\n${footerOf(harness, taskId)}`
    );
    expect(buttonsOf(message)).toEqual([]);
    expect(readText(statusOf(harness, taskId))).toBe(
      `Answer\nIt is the buffer.\n${footerOf(harness, taskId)}`
    );
  });

  test('leaves the card once the task is cancelled, or once it went on to a change', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'answer');
    deliver(harness, taskId, 'It is the buffer.');
    const task = harness.task(taskId);
    expect(readText(serializeSlackCard({ ...task, stage: 'cancelled' }, [], URL))).not.toStartWith(
      'Answer\n'
    );
    const done = { ...task, stage: 'done' as const };
    expect(readText(serializeSlackCard(done, [], URL))).toStartWith('Answer\n');
    const merged = { ...done, pullRequest: pullRequest({ state: 'merged' }) };
    expect(readText(serializeSlackCard(merged, [], URL))).not.toStartWith('Answer\n');
    const closed = { ...done, pullRequest: pullRequest({ state: 'closed' }) };
    expect(readText(serializeSlackCard(closed, [], URL))).not.toStartWith('Answer\n');
    const accepted = {
      ...done,
      proposal: {
        request: 'Fix it.',
        why: 'It breaks.',
        status: 'accepted' as const,
        recommend: 'go_on' as const,
        runId: null,
        at: 0,
      },
    };
    expect(readText(serializeSlackCard(accepted, [], URL))).not.toStartWith('Answer\n');
    expect(readText(serializeSlackCard({ ...task, stage: 'building' }, [], URL))).not.toStartWith('Answer\n');
  });

  test('a long one is shown whole, split into sections Slack folds', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'research');
    const paragraphs = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} words`);
    deliver(harness, taskId, paragraphs.join('\n\n'), 'research');
    const message = statusOf(harness, taskId);
    const sections = message.blocks.slice(1, -2).map(readBlockText);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.join('\n\n')).toBe(paragraphs.join('\n\n'));
    expect(readText(message)).toContain(`<${URL}|Open in Shinsa>`);
    const unbroken = startShaped(harness, 'answer', 'Other');
    deliver(harness, unbroken, 'x'.repeat(5000));
    const whole = statusOf(harness, unbroken);
    expect(whole.blocks.slice(1, -2).map(readBlockText).join('')).toBe('x'.repeat(5000));
  });

  test('one too long for Slack ends where the blocks run out, with a link to read the rest', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'research');
    deliver(harness, taskId, 'Short.', 'research');
    const task = harness.task(taskId);
    const result = task.result ?? never();
    const body = Array.from({ length: 8000 }, (_, index) => `Paragraph ${index} has some words`).join('\n\n');
    const long = { ...task, result: { ...result, body } };
    const message = Option.getOrNull(serializeSlackGate(long, harness.openGate(taskId), URL)) ?? never();
    expect(message.blocks).toHaveLength(50);
    expect(readBlockText(message.blocks.at(-3) ?? never())).toEndWith('…');
    expect(readText(message)).toContain(`<${URL}|Read the rest in Shinsa>`);
    const kept = serializeSlackCard({ ...long, stage: 'done' }, [], URL);
    expect(kept.blocks).toHaveLength(50);
    expect(readBlockText(kept.blocks.at(-2) ?? never())).toEndWith('…');
  });

  test('a proposal shows the diagnosis above the change, cut to leave room for it', () => {
    const harness = createHarness();
    const taskId = startShaped(harness, 'investigate');
    const body = Array.from({ length: 8000 }, (_, index) => `Paragraph ${index} has some words`).join('\n\n');
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'investigate',
      body,
      proposal: { request: 'Stream the export.', why: 'It reads the whole file.' },
    });
    const message = gateCardOf(harness, taskId);
    expect(message.blocks).toHaveLength(50);
    expect(readBlockText(message.blocks.at(-3) ?? never())).toBe('*Proposed change*\n> Stream the export.');
    expect(readBlockText(message.blocks.at(-4) ?? never())).toEndWith('…');
    expect(readText(message)).toContain(`<${URL}|Read the rest in Shinsa>`);
  });
});

describe("the bot's own replies", () => {
  test('not a task, the connect link and offline are a bold title over plain lines', () => {
    const declined = serializeSlackDeclined();
    expect(declined.text).toBe('Not a task, so nothing was started.');
    expect(declined.blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: '*Not a task*\nNothing was started.' } },
    ]);
    expect(readText(serializeSlackLinkPrompt('https://app.shinsa.dev/slack/connect'))).toEndWith(
      '<https://app.shinsa.dev/slack/connect|Connect Slack>'
    );
    expect(readText(serializeSlackOffline('Studio & Co'))).toStartWith('*Studio &amp; Co is offline*\n');
    expect(serializeSlackNoAccess().text).toBe(
      'Your GitHub account no longer has access to this Shinsa, so nothing was started.'
    );
    expect(readText(serializeSlackNoAccess())).toStartWith('*No access to this Shinsa*\n');
  });

  test('asks to connect again, or says how many linked threads could not be read', () => {
    const prompt = serializeSlackReconnectPrompt('https://app.shinsa.dev/slack/connect');
    expect(prompt.text).toBe('Connect Slack again so I can read the threads you link.');
    expect(readText(prompt)).toStartWith('*Connect Slack again*\n');
    expect(readText(prompt)).toEndWith('<https://app.shinsa.dev/slack/connect|Connect Slack>');
    expect(serializeSlackUnreadLinks(1)).toBe(
      'I could not read the thread you linked. Check that you can open it in Slack.'
    );
    expect(serializeSlackUnreadLinks(2)).toBe(
      'I could not read 2 of the threads you linked. Check that you can open them in Slack.'
    );
  });
});

describe('a post from the outbox', () => {
  test('is nothing for a task that is gone, and the card lists only the open gates', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    ask(harness, taskId, { question: 'Go?' });
    const { state } = harness;
    expect(
      Option.getOrNull(
        resolveSlackPostMessage(state, { kind: 'tripped', watchdogId: 'w1' }, 'gone', () => URL)
      )
    ).toBeNull();
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

const AT = Date.UTC(2026, 10, 4, 14, 0);

function watchdogOf(fields: Partial<Watchdog>): Watchdog {
  return {
    id: 'w1',
    round: 1,
    title: 'Checkout latency',
    check: 'p95 stays under 400 ms.',
    source: { server: 'maple', data: 'Traces' },
    sourceRequest: null,
    firstCheckMinutes: 360,
    maxGapMinutes: 360,
    forMinutes: 2880,
    startsOn: 'merge',
    productionCheck: null,
    status: 'watching',
    armedAt: AT,
    awaitingSince: null,
    startedAt: AT,
    endsAt: null,
    nextCheckAt: null,
    runId: null,
    checks: [],
    forkTaskIds: [],
    linkedTaskIds: [],
    endedAt: null,
    ...fields,
  };
}

function mergedTask(harness: Harness, fields: Partial<Task> = {}) {
  const taskId = createTask(harness, { request: 'Fix it' });
  return { ...harness.task(taskId), pullRequest: pullRequest({ state: 'merged' }), ...fields };
}

const HEALTHY = { at: AT, healthy: true, summary: 'p95 is 210 ms.' };

describe('the merge message', () => {
  test('says the pull request is merged, with no sections when nothing watches it', () => {
    const harness = createHarness();
    const message = serializeSlackMerged(mergedTask(harness), 1, URL);
    expect(message.text).toBe('SUP-1 · Fix it is merged.');
    expect(readText(message)).toStartWith('*Merged*\nThe pull request is merged.\n<');
    expect(message.blocks).toHaveLength(2);
  });

  test('lists each watchdog of the round with its state', () => {
    const harness = createHarness();
    const task = mergedTask(harness, {
      watchdogs: [
        watchdogOf({ id: 'a', title: 'Sources', status: 'needs_source' }),
        watchdogOf({ id: 'b', title: 'Release', status: 'awaiting_production' }),
        watchdogOf({ id: 'c', title: 'Fresh', nextCheckAt: AT }),
        watchdogOf({ id: 'd', title: 'Healthy', checks: [HEALTHY], nextCheckAt: AT }),
        watchdogOf({ id: 'e', title: 'Unscheduled', checks: [HEALTHY] }),
        watchdogOf({ id: 'f', title: 'Passed', status: 'passed', checks: [HEALTHY, HEALTHY] }),
        watchdogOf({ id: 'g', title: 'Tripped', status: 'tripped' }),
        watchdogOf({ id: 'h', title: 'Stopped', status: 'stopped' }),
        watchdogOf({ id: 'i', title: 'Earlier round', round: 2 }),
      ],
    });
    const date = `<!date^${AT / 1000}^{date_short_pretty} at {time}|2026-11-04T14:00:00.000Z>`;
    expect(
      readText(serializeSlackMerged(task, 1, URL))
        .split('\n')
        .slice(2, 11)
    ).toEqual([
      '*Watchdogs*',
      '• *Sources*: Waits for a data source.',
      '• *Release*: Waits for the change to reach production.',
      `• *Fresh*: Watching. Next check ${date}.`,
      `• *Healthy*: Watching. Nothing wrong so far. Next check ${date}.`,
      '• *Unscheduled*: Watching. Nothing wrong so far.',
      '• *Passed*: Passed. Found nothing wrong in 2 checks.',
      '• *Tripped*: Found a problem.',
      '• *Stopped*: Stopped.',
    ]);
  });

  test('lists the open steps after the merge of the round', () => {
    const harness = createHarness();
    const task = mergedTask(harness);
    const step = {
      when: 'post_merge' as const,
      kind: 'migration' as const,
      title: 'Run the <migration>',
      detail: 'Adds the invoices table.',
      command: null,
    };
    const carried = [
      { ...step, round: 1, done: false },
      { ...step, title: 'Ticked', round: 1, done: true },
      { ...step, title: 'Other round', round: 2, done: false },
    ];
    const text = readText(serializeSlackMerged({ ...task, carriedMergeSteps: carried }, 1, URL));
    expect(text).toContain('*Still to do after the merge*\n• Run the &lt;migration&gt;\n<');
    expect(text).not.toContain('Ticked');
    expect(text).not.toContain('Other round');
  });

  test('resolves from the state, and nothing for a task that is gone', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(Option.getOrNull(resolveSlackMergeMessage(harness.state, taskId, 1, URL))?.text).toEndWith(
      'is merged.'
    );
    expect(Option.getOrNull(resolveSlackMergeMessage(harness.state, 'gone', 1, URL))).toBeNull();
  });
});

describe('the message when a watchdog finds a problem', () => {
  test('names the watchdog, quotes its last check and links each task filed for it', () => {
    const harness = createHarness();
    const fork = createTask(harness, { request: 'Fix Safari' });
    const linked = createTask(harness, { request: 'Known issue' });
    const taskId = createTask(harness, { request: 'Fix it' });
    const watchdog = watchdogOf({
      status: 'tripped',
      checks: [HEALTHY, { at: AT, healthy: false, summary: 'p95 is 1.8 s in Safari. It started at noon.' }],
      forkTaskIds: [fork, 'gone'],
      linkedTaskIds: [linked, fork],
    });
    harness.state.tasks[taskId] = { ...harness.task(taskId), watchdogs: [watchdog] };
    const urlOf = (id: string) => `https://app.shinsa.dev/tasks/${id}`;
    const message = Option.getOrNull(
      resolveSlackPostMessage(harness.state, { kind: 'tripped', watchdogId: 'w1' }, taskId, urlOf)
    );
    const handleOf = (id: string) => `${harness.task(id).handle} · ${harness.task(id).title}`;
    expect(message?.text).toBe(`${handleOf(taskId)}: the watchdog “Checkout latency” found a problem.`);
    expect(readText(message ?? never())).toBe(
      [
        'Watchdog found a problem',
        '*Checkout latency*',
        '> p95 is 1.8 s in Safari.',
        '*Filed as*',
        `• <${urlOf(fork)}|${handleOf(fork)}>`,
        `• <${urlOf(linked)}|${handleOf(linked)}>`,
        `<${urlOf(taskId)}|${handleOf(taskId)}>`,
      ].join('\n')
    );
  });

  test('has no list when nothing was filed, no quote with no check, and nothing for a watchdog that is gone', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Fix it' });
    harness.state.tasks[taskId] = { ...harness.task(taskId), watchdogs: [watchdogOf({ status: 'tripped' })] };
    const post = (watchdogId: string) =>
      Option.getOrNull(
        resolveSlackPostMessage(harness.state, { kind: 'tripped', watchdogId }, taskId, () => URL)
      );
    expect(readText(post('w1') ?? never())).toBe(
      ['Watchdog found a problem', '*Checkout latency*', `<${URL}|SUP-1 · Fix it>`].join('\n')
    );
    expect(post('gone')).toBeNull();
  });
});

describe('a merged task while a watchdog checks it', () => {
  test('keeps the card, the reaction and the thread status it had after the merge', () => {
    const harness = createHarness();
    const merged = mergedTask(harness, { stage: 'merged', stageReason: 'pull request merged' });
    const watching = {
      ...merged,
      stage: 'watching' as const,
      stageReason: 'checking the watchdog “Checkout latency”',
    };
    expect(readText(serializeSlackCard(watching, [], URL))).toStartWith('*Merged*\n');
    expect(resolveSlackReaction(watching, [])).toBe(SLACK_REACTIONS.done);
    expect(resolveSlackSessionStatus(watching, [])).toBe('active');
    const done = { ...watching, pullRequest: null };
    expect(readText(serializeSlackCard(done, [], URL))).toStartWith('*Done*\n');
    expect(resolveSlackReaction(done, [])).toBe(SLACK_REACTIONS.done);
  });
});

const ESCALATION: TaskEscalation = {
  at: AT,
  reason: 'Urgent, and the merge waited 60 minutes for you.',
  handoff: {
    waitedMinutes: 60,
    ownerActiveAt: null,
    foundBy: null,
    ratings: { confidence: 'high', risk: 'medium' },
    mergesAt: AT + 3_600_000,
    blockedBy: null,
  },
};

function escalatedState(harness: Harness, fields: Partial<Task>) {
  const taskId = createTask(harness, { request: 'Fix it' });
  const task = { ...harness.task(taskId), ...fields };
  return { taskId, state: { ...harness.state, tasks: { ...harness.state.tasks, [taskId]: task } } };
}

describe('the escalation message', () => {
  test('asks for a review, with why, what Autopilot does next, the ratings and the pull request', () => {
    const harness = createHarness();
    const { taskId, state } = escalatedState(harness, { escalation: ESCALATION });
    const message = Option.getOrNull(resolveSlackEscalationMessage(state, taskId, AT, URL)) ?? never();
    const merges = `<!date^${AT / 1000 + 3600}^{date_short_pretty} at {time}|2026-11-04T15:00:00.000Z>`;
    expect(message.text).toBe('SUP-1 · Fix it is urgent and needs a review.');
    expect(readText(message)).toBe(
      [
        'Urgent change needs a review',
        `*Fix it*\nIt is urgent and waited 1 hour for a merge.\nAutopilot merges it ${merges} unless someone acts first.`,
        '*Review*\nHigh confidence, medium risk\n*Pull request*\nNot open yet',
        `<${URL}|Review in Shinsa>`,
        footerOf(harness, taskId),
      ].join('\n')
    );
  });

  test.each([
    [{ ratings: null, mergesAt: null }, 'It waits until someone merges it.', 'Not rated'],
    [{ blockedBy: 'pre_merge_steps' as const }, 'A step before the merge is not ticked yet.', 'High'],
    [
      { foundBy: { server: null, shippedTaskTitle: null }, waitedMinutes: 45 },
      'A watchdog found the issue it fixes. It is urgent and waited 45 minutes for a merge.',
      'High',
    ],
    [{ waitedMinutes: 0 }, 'It is urgent and ready to merge.', 'High'],
  ])('says what happens next when the handoff is %o', (handoff, text, review) => {
    const harness = createHarness();
    const escalation = { ...ESCALATION, handoff: { ...ESCALATION.handoff, ...handoff } };
    const { taskId, state } = escalatedState(harness, { escalation });
    const shown = readText(
      Option.getOrNull(resolveSlackEscalationMessage(state, taskId, AT, URL)) ?? never()
    );
    expect(shown).toContain(text);
    expect(shown).toContain(`*Review*\n${review}`);
  });

  test.each([
    ['the merge was decided', {}, 'Its owner decided the merge in Shinsa.'],
    [
      'the change merged',
      { pullRequest: pullRequest({ state: 'merged' }) },
      'Merged. What happens next is in the thread.',
    ],
    ['the task closed', { stage: 'cancelled' as const }, 'The task is closed.'],
    [
      'a later escalation replaced it',
      { escalation: { ...ESCALATION, at: AT + 1 } },
      'Its owner decided the merge in Shinsa.',
    ],
  ])('says it no longer needs anyone once %s', (_case, fields: Partial<Task>, detail) => {
    const harness = createHarness();
    const { taskId, state } = escalatedState(harness, { escalation: null, ...fields });
    const message = Option.getOrNull(resolveSlackEscalationMessage(state, taskId, AT, URL)) ?? never();
    expect(message.text).toBe('SUP-1 · Fix it no longer needs anyone.');
    expect(readText(message)).toStartWith(`*No longer needs anyone*\n${detail}\n`);
  });

  test('has nothing to say for a task it does not know', () => {
    expect(Option.isNone(resolveSlackEscalationMessage(createHarness().state, 'gone', AT, URL))).toBe(true);
  });

  test('replies once merged that Shinsa keeps watching, with each watchdog, or asks to keep an eye on it', () => {
    const harness = createHarness();
    const merged = pullRequest({ state: 'merged' });
    const { taskId, state } = escalatedState(harness, { pullRequest: merged });
    const bare = Option.getOrNull(resolveSlackEscalationFollowUp(state, taskId, URL)) ?? never();
    expect(bare.text).toBe('SUP-1 · Fix it is merged.');
    expect(readText(bare)).toStartWith('*Merged*\nNothing watches it after the merge, so keep an eye on it.');
    const watchdog = watchdogOf({ round: 1 });
    const watched = escalatedState(harness, { pullRequest: merged, watchdogs: [watchdog] });
    const shown = readText(
      Option.getOrNull(resolveSlackEscalationFollowUp(watched.state, watched.taskId, URL)) ?? never()
    );
    expect(shown).toStartWith('*Merged*\nShinsa keeps watching it after the merge. Keep an eye on it too.');
    expect(shown).toContain(`*${watchdog.title}*`);
    const open = escalatedState(harness, {});
    expect(Option.isNone(resolveSlackEscalationFollowUp(open.state, open.taskId, URL))).toBe(true);
    expect(Option.isNone(resolveSlackEscalationFollowUp(createHarness().state, 'gone', URL))).toBe(true);
  });

  test('sends a test that looks like a real escalation and says nothing needs anyone', () => {
    const message = serializeSlackEscalationTest(URL, AT);
    expect(message.text).toBe('Settings → Agents → Autopilot is urgent and needs a review.');
    expect(readText(message)).toStartWith(`${SLACK_ESCALATION_TEST_NOTE}\nUrgent change needs a review\n`);
    expect(readText(message)).toContain('*Fix the checkout timeout*');
  });
});
