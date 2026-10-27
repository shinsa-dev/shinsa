import { describe, expect, test } from 'bun:test';
import type { RunRole } from '../../src/index.ts';
import {
  resolveAgentPrompt,
  resolveAnswererPrompt,
  resolveChecksFixPrompt,
  resolveDelegatePrompt,
  resolveFollowUpPrompt,
  resolveHumanFixPrompt,
  resolveInvestigatorPrompt,
  resolveOperationInstruction,
  resolvePhaseInstruction,
  resolvePlanningPrompt,
  resolvePullRequestFixPrompt,
  resolveResearcherPrompt,
  resolveReviewerPrompt,
  resolveReviewFixPrompt,
  splitHouseRules,
} from '../../src/prompts/index.ts';
import { REFERENCE_RULES, resolveHouseRules, WRITING_RULES } from '../../src/prompts/rules.ts';
import { createHarness, createTask, proposePlan, pullRequest } from '../harness.ts';

const WORKING_ROLES: RunRole[] = ['agent', 'reviewer', 'answerer', 'investigator', 'researcher'];

const CONVERSATION_SENTENCES = [
  'The human reads this conversation as you write it and talks to you in it.',
  'Write to them directly, as "you", the way a colleague writes in a chat.',
  'Never narrate your tool calls.',
  'Speak as yourself, in the first person: "I found…", "I know of one project…", "I have not worked in that repository yet".',
  'Shinsa is the control plane you work in, not you: never write that Shinsa knows, has, found or did something when you are the one who knows or did it.',
  'Mention Shinsa only when your reader has to act in it, such as a setting or a command.',
  'A hand-over is your reply: the human reads it in this chat as you wrote it.',
  'Never announce, point at, repeat or summarise it ("My answer is above", "I have handed over the plan"), never say that Shinsa received it, and never say that your turn is over or complete.',
  'After a hand-over, stop and write nothing more. Anything else the human needs belongs in the hand-over itself.',
];

const SELF_AS_SHINSA = /\bShinsa (knows|knew|has|hasn['’]t|had|found|thinks|believes|registered)\b/;

const INVITES_A_RESTATEMENT =
  /(short sentence only when|closing message|summari[sz]e (it|the|your) (after|below|above)|restate it (after|below))/i;

function listSentences(text: string) {
  return text.split(/(?<=[.!?:])\s+|\n/).filter((sentence) => sentence.trim().length > 0);
}

function expectFirstPersonVoice(text: string) {
  expect(text).not.toMatch(INVITES_A_RESTATEMENT);
  for (const sentence of listSentences(text)) {
    if (SELF_AS_SHINSA.test(sentence)) expect(sentence).toMatch(/\bnever write that Shinsa\b/);
    if (/\b(summari[sz]e|restate|repeat|announce)\b/i.test(sentence)) {
      expect(sentence).toMatch(/\b(never|not|no|without)\b/i);
    }
  }
}

function context() {
  const harness = createHarness();
  const taskId = createTask(harness, { request: 'Fix the scroll in tab groups' });
  proposePlan(harness, taskId);
  const task = harness.task(taskId);
  const repo = harness.state.repos[task.repoId ?? ''] ?? null;
  return { task, repo };
}

describe('the house rules', () => {
  test('name Shinsa a control plane for coding agents, never a harness', () => {
    for (const role of WORKING_ROLES) {
      const rules = resolveHouseRules(role);
      expect(rules).toStartWith('You work inside Shinsa, a control plane for coding agents');
      expect(rules).not.toContain('harness');
    }
  });

  test('every working role talks to the human in the chat and never narrates a hand-over or its turn ending', () => {
    for (const role of WORKING_ROLES) {
      const rules = resolveHouseRules(role);
      for (const sentence of CONVERSATION_SENTENCES) expect(rules).toContain(sentence);
    }
  });

  test('never tell an agent to speak of itself as Shinsa or to sum up after its hand-over', () => {
    for (const role of WORKING_ROLES) expectFirstPersonVoice(resolveHouseRules(role));
  });

  test('catch a prompt that speaks of the agent as Shinsa or invites a closing summary', () => {
    expect(() => expectFirstPersonVoice('Shinsa knows one project.')).toThrow();
    expect(() => expectFirstPersonVoice('Add one short sentence only when it helps.')).toThrow();
    expect(() => expectFirstPersonVoice('Summarise the answer for the human.')).toThrow();
  });
});

describe('the role and fix prompts', () => {
  test('tell the agent to stop after its hand-over, never to end its turn', () => {
    const { task, repo } = context();
    const prompts = [
      resolvePlanningPrompt(task, repo, [], null),
      resolvePhaseInstruction(task, repo, 0),
      resolveReviewerPrompt(task, repo, []),
      resolveAnswererPrompt(task, repo, null),
      resolveResearcherPrompt(task, repo, null),
      resolveInvestigatorPrompt(task, repo, null),
      resolveOperationInstruction(task, null),
      resolveChecksFixPrompt([{ name: 'test', outcome: 'fail', detail: '' }]),
      resolveReviewFixPrompt([{ severity: 'blocking', file: null, line: null, message: 'Handle it.' }]),
      resolveHumanFixPrompt('Rename it.', []),
      resolvePullRequestFixPrompt(pullRequest({ checks: 'failing' })),
    ];
    for (const prompt of prompts) {
      expect(prompt).toMatch(/[Tt]hen stop[.:]/);
      expect(prompt.toLowerCase()).not.toContain('end your turn');
      expectFirstPersonVoice(prompt);
    }
  });
});

describe('what the house rules leave to the tools', () => {
  test('no role is told again what a tool’s own description already says', () => {
    for (const role of ['agent', 'reviewer', 'answerer', 'investigator', 'researcher'] as const) {
      const rules = resolveHouseRules(role);
      for (const tool of [
        'read_task',
        'list_repository_work',
        'suggest_tasks',
        'remember',
        'delegation_status',
      ]) {
        expect(rules).not.toContain(`\`${tool}\``);
      }
      expect(rules).not.toContain('client_request_id');
      expect(rules).not.toContain('fixed fields and hard length limits');
    }
  });

  test('the writing rules are one block every role gets once', () => {
    for (const role of ['agent', 'reviewer', 'answerer', 'investigator', 'researcher'] as const) {
      const rules = resolveHouseRules(role);
      expect(rules.split(WRITING_RULES)).toHaveLength(2);
    }
    expect(WRITING_RULES).toContain('ten seconds per item');
    expect(WRITING_RULES).toContain('```bash run');
    expect(WRITING_RULES).toContain(REFERENCE_RULES);
  });
});

describe('splitting the house rules off a brief', () => {
  test('every role brief starts with its house rules, which split off from the instruction', () => {
    const { task, repo } = context();
    const briefs: [RunRole, string][] = [
      ['agent', resolvePlanningPrompt(task, repo, [], null)],
      ['reviewer', resolveReviewerPrompt(task, repo, [])],
      ['answerer', resolveAnswererPrompt(task, repo, null)],
      ['answerer', resolveFollowUpPrompt(task, repo, 'Why?')],
      ['researcher', resolveResearcherPrompt(task, repo, null)],
      ['investigator', resolveInvestigatorPrompt(task, repo, null)],
    ];
    for (const [role, brief] of briefs) {
      const split = splitHouseRules(brief);
      expect(split?.rules).toBe(resolveHouseRules(role));
      expect(split?.instruction.startsWith('Your role: ')).toBe(true);
      expect(`${split?.rules}\n\n${split?.instruction}`).toBe(brief);
    }
  });

  test('a brief without house rules, such as a fix prompt, has nothing to split', () => {
    expect(splitHouseRules(resolveHumanFixPrompt('Rename it.', []))).toBeNull();
    expect(splitHouseRules(resolveHouseRules('agent'))).toBeNull();
  });

  test('the round agent’s short instructions carry its house rules and split back to the instruction', () => {
    const { task, repo } = context();
    for (const instruction of [
      resolvePhaseInstruction(task, repo, 0),
      resolveOperationInstruction(task, null),
      resolveHumanFixPrompt('Rename it.', []),
    ]) {
      const split = splitHouseRules(resolveAgentPrompt(instruction));
      expect(split?.rules).toBe(resolveHouseRules('agent'));
      expect(split?.instruction).toBe(instruction);
    }
  });
});

describe('a delegated agent’s voice', () => {
  test('writes its final reply to the delegating agent as the result itself, with no narration', () => {
    const { task, repo } = context();
    const prompt = resolveDelegatePrompt({
      task,
      repo,
      role: 'builder',
      brief: 'Do it.',
      isolation: 'shared',
      depth: 1,
    });
    expect(prompt).toStartWith('You work inside Shinsa, a control plane for coding agents');
    expect(prompt).toContain(
      'Write that reply to the agent and make it the result itself: never narrate your tool calls, and never say that you are done or that your turn is over.'
    );
    expect(prompt).not.toContain('The human reads this conversation');
    expect(prompt).not.toContain('harness');
    expect(prompt).toContain('Speak as yourself, in the first person');
    expectFirstPersonVoice(prompt);
  });
});
