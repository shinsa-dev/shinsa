import {
  DELEGATION_LIMITS,
  type DelegateRole,
  type DelegationIsolation,
  type DelegationStatus,
  hasTool,
  isReadOnlyRole,
  listCallableToolNames,
  type Repo,
  type Run,
  type Task,
} from '../domain/index.ts';
import { resolveOrchestrationRules } from './orchestration-rules.ts';
import { REFERENCE_RULES, VOICE_RULE } from './rules.ts';

const DELEGATE_INTRO =
  'You work inside Shinsa, a control plane for coding agents: agents do the work, and a human only steps in at gates. Another agent delegated one piece of its work to you.';

const STATUS_WORDS: Record<DelegationStatus, string> = {
  queued: 'is waiting to start',
  running: 'is working',
  waiting: 'is waiting for an answer',
  completed: 'finished',
  failed: 'failed',
  cancelled: 'was stopped',
};

export interface DelegatePromptInput {
  task: Task;
  repo: Repo | null;
  role: DelegateRole;
  brief: string;
  isolation: DelegationIsolation;
  depth: number;
}

function describeDelegateCheckout(isolation: DelegationIsolation, readOnly: boolean) {
  if (isolation === 'worktree') {
    return 'You work in your own checkout of the delegating agent’s last commit. Shinsa keeps it after you finish, so leave your changes in place and say what they are.';
  }
  if (readOnly)
    return 'You share the checkout with the agent that delegated to you. Never change a file in it.';
  return 'You share the checkout with the agent that delegated to you, which may be working at the same time. Change only what the brief asks for.';
}

export function resolveDelegatePrompt(input: DelegatePromptInput) {
  const readOnly = isReadOnlyRole(input.role);
  const tools = listCallableToolNames(input.role, input.depth);
  return [
    DELEGATE_INTRO,
    `Your role: ${input.role}${readOnly ? '. Do not change any file' : ''}.`,
    `The work is part of the task "${input.task.title}"${input.repo ? ` in ${input.repo.name}` : ''}.`,
    describeDelegateCheckout(input.isolation, readOnly),
    'You work for the agent that delegated this, not for the human. Your final reply is your result and goes back to that agent, so make it complete on its own: what you did or found, with file paths and line numbers, and anything left open.',
    'Write that reply to the agent and make it the result itself: never narrate your tool calls, and never say that you are done or that your turn is over.',
    VOICE_RULE,
    'You have no hand-over tools: never commit, push or open a pull request, and do not wait for anyone to approve your work.',
    'Call `ask` only when you cannot go on without a decision. It goes to the agent that delegated this, which answers or asks the human.',
    "Follow the repository's own rules: its CLAUDE.md and AGENTS.md files, its lint and conventions.",
    'Never sleep, poll or loop in a shell to wait for something. Say what is still pending in your reply instead.',
    tools.includes('delegate_task')
      ? resolveOrchestrationRules(tools)
      : 'Do the work yourself: you cannot delegate it further.',
    REFERENCE_RULES,
    '',
    'The brief:',
    input.brief,
  ].join('\n');
}

export interface DeliveredResult {
  runId: string;
  title: string;
  role: string;
  status: DelegationStatus;
  result: string | null;
}

export interface DeliveredQuestion {
  runId: string;
  title: string;
  question: string;
  context: string | null;
  choices: string[];
}

export interface DeliveryContent {
  results: DeliveredResult[];
  questions: DeliveredQuestion[];
  messages: string[];
}

const DELIVERY_NOTICE = [
  '<system-message>',
  'Shinsa is reporting on work you delegated. This is not a message from the human. Read it, then carry on with your step.',
  '</system-message>',
].join('\n');

function describeResult(result: DeliveredResult, budget: { left: number }) {
  const header = `Delegation ${STATUS_WORDS[result.status]}: "${result.title}" (delegation id ${result.runId}, ${result.role})`;
  const text = result.result?.trim();
  if (!text) return `${header}. It left no reply.`;
  if (text.length > budget.left) {
    return `${header}. Its reply is ${text.length} characters, more than a report carries. Read it whole with \`delegation_status\`.`;
  }
  budget.left -= text.length;
  return `${header}:\n\n${text}`;
}

function describeEscalation(parent: Run) {
  if (!hasTool(parent, 'ask')) return 'You cannot ask the human, so decide it from what you know.';
  if (parent.delegation)
    return 'If you cannot decide it, ask the agent that delegated this to you with `ask` first.';
  return 'If only the human can decide, ask them with `ask` first.';
}

function describeQuestion(question: DeliveredQuestion, parent: Run) {
  return [
    `Delegation "${question.title}" (delegation id ${question.runId}) is waiting for your answer:`,
    question.question,
    question.context ?? '',
    question.choices.length > 0 ? `Options: ${question.choices.join(' / ')}` : '',
    `Answer it with \`delegation_answer\`. ${describeEscalation(parent)}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export function resolveDeliveryPrompt(content: DeliveryContent, parent: Run) {
  const budget = { left: DELEGATION_LIMITS.inlineResults };
  const sections = [
    ...content.results.map((result) => describeResult(result, budget)),
    ...content.questions.map((question) => describeQuestion(question, parent)),
    ...content.messages.map((message) => `The human added: ${message}`),
  ];
  return [DELIVERY_NOTICE, '', sections.join('\n\n---\n\n')].join('\n');
}

export function resolveDelegationAnswerPrompt(question: string, answer: string) {
  return [
    `You asked the agent that delegated this: ${question}`,
    '',
    `Its answer: ${answer}`,
    '',
    'Carry on.',
  ].join('\n');
}

export function resolveAdoptionNote(titles: { runId: string; title: string }[]) {
  if (titles.length === 0) return '';
  return [
    '',
    '',
    'These delegations you started earlier are still running, and their results arrive here when they finish:',
    ...titles.map((entry) => `- "${entry.title}" (delegation id ${entry.runId})`),
  ].join('\n');
}
