import { describe, expect, test } from 'bun:test';
import {
  DELEGATE_ROLES,
  DELEGATION_LIMITS,
  listToolNames,
  type Run,
  type RunRole,
  SHINSA_TOOL_NAMES,
} from '../../src/index.ts';
import {
  resolveAdoptionNote,
  resolveAnswererPrompt,
  resolveDelegatePrompt,
  resolveDelegationAnswerPrompt,
  resolveDeliveryPrompt,
  resolveOperationInstruction,
  resolvePhaseInstruction,
  resolvePlanningPrompt,
  resolveReviewerPrompt,
} from '../../src/prompts/index.ts';
import { createHarness, createTask, proposePlan } from '../harness.ts';

function context() {
  const harness = createHarness();
  const taskId = createTask(harness, { request: 'Fix the scroll in tab groups' });
  proposePlan(harness, taskId);
  const task = harness.task(taskId);
  const repo = harness.state.repos[task.repoId ?? ''] ?? null;
  return { task, repo };
}

function parentRun(patch: Partial<Run> = {}): Run {
  return {
    id: 'parent',
    taskId: 't',
    role: 'builder',
    status: 'running',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: 0,
    endedAt: null,
    outcome: null,
    summary: null,
    ...patch,
  };
}

const QUESTION = { runId: 'r1', title: 'Port it', question: 'Keep the old API?', context: null, choices: [] };

function listNamedTools(prompt: string) {
  return SHINSA_TOOL_NAMES.filter((name) => prompt.includes(`\`${name}\``));
}

function expectOnlyOwnTools(prompt: string, role: RunRole, depth = 0) {
  const tools: readonly string[] = listToolNames(role, depth);
  expect(listNamedTools(prompt).filter((name) => !tools.includes(name))).toEqual([]);
}

describe('the orchestration rules every step agent reads', () => {
  test('name the tools, the defaults and the limits as numbers', () => {
    const { task, repo } = context();
    const rules = resolvePlanningPrompt(task, repo, [], null);
    for (const phrase of [
      '`delegate_task`',
      'Delegate only work whose context should stay apart from yours',
      'never hand each phase, or each problem type, to its own agent',
      'starts from your brief alone',
      '`mode: "wait"`',
      '10 by default, 60 at most',
      '`isolation: "worktree"`',
      '`delegation_answer`',
      'a new `client_request_id` for each round',
      '`delegation_status`',
      '`delegation_cancel`',
      'at most 3 deep, and at most 8 run at once',
      '`create_task`',
      'Your hand-over tools wait for your delegations',
      'ask them with `ask` first',
    ]) {
      expect(rules).toContain(phrase);
    }
  });

  test('every step agent is told about the tools it has and no others', () => {
    const { task, repo } = context();
    expectOnlyOwnTools(resolvePlanningPrompt(task, repo, [], null), 'agent');
    expectOnlyOwnTools(resolvePhaseInstruction(task, repo, 0), 'agent');
    expectOnlyOwnTools(resolveOperationInstruction(task, null), 'agent');
    expectOnlyOwnTools(resolveAnswererPrompt(task, repo, null), 'answerer');
    const reviewer = resolveReviewerPrompt(task, repo, []);
    expectOnlyOwnTools(reviewer, 'reviewer');
    expect(reviewer).toContain('`delegate_task`');
    expect(reviewer).not.toContain('`ask`');
    expect(reviewer).toContain('hand over and say what is still pending');
  });

  test('every delegated agent is told about the tools it has and no others, at every depth', () => {
    const { task, repo } = context();
    for (const role of DELEGATE_ROLES) {
      for (let depth = 1; depth <= DELEGATION_LIMITS.depth; depth += 1) {
        const prompt = resolveDelegatePrompt({
          task,
          repo,
          role,
          brief: 'Do it.',
          isolation: 'shared',
          depth,
        });
        expectOnlyOwnTools(prompt, role, depth);
        expect(prompt).not.toContain('Your hand-over tools');
      }
    }
    const nested = resolveDelegatePrompt({
      task,
      repo,
      role: 'builder',
      brief: 'x',
      isolation: 'shared',
      depth: 1,
    });
    expect(nested).toContain('ask the agent that delegated to you with `ask` first');
  });
});

describe('a delegated agent’s prompt', () => {
  test('is the brief and its own rules, never the parent’s conversation', () => {
    const { task, repo } = context();
    const prompt = resolveDelegatePrompt({
      task,
      repo,
      role: 'builder',
      brief: 'Rename `scrollBy` to `scrollTo` in src/tabs.ts.',
      isolation: 'shared',
      depth: 1,
    });
    expect(prompt).toContain('Your role: builder.');
    expect(prompt).toContain('The work is part of the task "Fix the scroll in tab groups" in paywall-next.');
    expect(prompt).toContain('Change only what the brief asks for.');
    expect(prompt).toContain('Your final reply is your result');
    expect(prompt).toContain('`delegate_task`');
    expect(prompt.endsWith('The brief:\nRename `scrollBy` to `scrollTo` in src/tabs.ts.')).toBe(true);
    expect(prompt).not.toContain('Find the overflow');
  });

  test('a read-only role in the shared checkout is told never to change a file', () => {
    const { task } = context();
    const prompt = resolveDelegatePrompt({
      task,
      repo: null,
      role: 'reviewer',
      brief: 'Review it.',
      isolation: 'shared',
      depth: DELEGATION_LIMITS.depth,
    });
    expect(prompt).toContain('Your role: reviewer. Do not change any file.');
    expect(prompt).toContain('The work is part of the task "Fix the scroll in tab groups".');
    expect(prompt).toContain('Never change a file in it.');
    expect(prompt).toContain('you cannot delegate it further');
  });

  test('an isolated agent is told its checkout is its own and kept', () => {
    const { task, repo } = context();
    const prompt = resolveDelegatePrompt({
      task,
      repo,
      role: 'builder',
      brief: 'Try it.',
      isolation: 'worktree',
      depth: 1,
    });
    expect(prompt).toContain('your own checkout of the delegating agent’s last commit');
  });
});

describe('a report to the agent that delegated', () => {
  test('says it is Shinsa, then each result whole, each question with its options, then the human', () => {
    const text = resolveDeliveryPrompt(
      {
        results: [
          {
            runId: 'r1',
            title: 'Check the copy',
            role: 'reviewer',
            status: 'completed',
            result: 'All good.',
          },
          { runId: 'r2', title: 'Try the fix', role: 'builder', status: 'failed', result: 'It crashed.' },
          { runId: 'r3', title: 'Silent', role: 'planner', status: 'cancelled', result: null },
        ],
        questions: [
          {
            runId: 'r4',
            title: 'Port it',
            question: 'Keep the old API?',
            context: 'Two callers use it.',
            choices: ['Keep', 'Drop'],
          },
          { runId: 'r5', title: 'Plain', question: 'Which file?', context: null, choices: [] },
        ],
        messages: ['Also look at the footer.'],
      },
      parentRun()
    );
    expect(text.startsWith('<system-message>\nShinsa is reporting on work you delegated.')).toBe(true);
    expect(text).toContain(
      'Delegation finished: "Check the copy" (delegation id r1, reviewer):\n\nAll good.'
    );
    expect(text).toContain('Delegation failed: "Try the fix" (delegation id r2, builder):\n\nIt crashed.');
    expect(text).toContain('Delegation was stopped: "Silent" (delegation id r3, planner). It left no reply.');
    expect(text).toContain(
      'Keep the old API?\nTwo callers use it.\nOptions: Keep / Drop\nAnswer it with `delegation_answer`'
    );
    expect(text).toContain('is waiting for your answer:\nWhich file?\nAnswer it');
    expect(text).toContain('The human added: Also look at the footer.');
    expect(text.indexOf('Check the copy')).toBeLessThan(text.indexOf('Keep the old API?'));
    expect(text.indexOf('Keep the old API?')).toBeLessThan(text.indexOf('The human added'));
  });

  test('carries results up to 16,000 characters and points at delegation_status for the rest', () => {
    const text = resolveDeliveryPrompt(
      {
        results: [
          { runId: 'r1', title: 'Long', role: 'planner', status: 'completed', result: 'a'.repeat(15_000) },
          { runId: 'r2', title: 'Too long', role: 'planner', status: 'running', result: 'b'.repeat(2_000) },
          { runId: 'r3', title: 'Queued', role: 'planner', status: 'queued', result: 'c' },
          { runId: 'r4', title: 'Waiting', role: 'planner', status: 'waiting', result: 'd' },
        ],
        questions: [],
        messages: [],
      },
      parentRun()
    );
    expect(text).toContain('a'.repeat(15_000));
    expect(text).toContain(
      'Delegation is working: "Too long" (delegation id r2, planner). Its reply is 2000 characters, more than a report carries. Read it whole with `delegation_status`.'
    );
    expect(text).toContain('Delegation is waiting to start: "Queued"');
    expect(text).toContain('Delegation is waiting for an answer: "Waiting"');
  });

  test('a question is escalated the way the agent that delegated it can ask', () => {
    const deliver = (parent: Run) =>
      resolveDeliveryPrompt({ results: [], questions: [QUESTION], messages: [] }, parent);
    expect(deliver(parentRun())).toContain(
      'Answer it with `delegation_answer`. If only the human can decide, ask them with `ask` first.'
    );
    expect(deliver(parentRun({ role: 'reviewer' }))).toContain(
      'Answer it with `delegation_answer`. You cannot ask the human, so decide it from what you know.'
    );
    const delegation = {
      parentRunId: 'top',
      depth: 1,
      requestKey: 'k',
      title: 'Check',
      brief: 'Check it.',
      mode: 'async' as const,
      wake: 'always' as const,
      isolation: 'shared' as const,
      baseCommit: null,
      delivery: 'none' as const,
      question: null,
      requestedAt: 0,
    };
    expect(deliver(parentRun({ delegation }))).toContain(
      'Answer it with `delegation_answer`. If you cannot decide it, ask the agent that delegated this to you with `ask` first.'
    );
  });

  test('an answer goes back to the delegated agent as its own message', () => {
    expect(resolveDelegationAnswerPrompt('Keep it?', 'Yes.')).toBe(
      'You asked the agent that delegated this: Keep it?\n\nIts answer: Yes.\n\nCarry on.'
    );
  });

  test('a run that adopted delegations is told which ones still report to it', () => {
    expect(resolveAdoptionNote([])).toBe('');
    expect(resolveAdoptionNote([{ runId: 'r1', title: 'Check' }])).toBe(
      '\n\nThese delegations you started earlier are still running, and their results arrive here when they finish:\n- "Check" (delegation id r1)'
    );
  });
});
