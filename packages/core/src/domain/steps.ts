import type { ShinsaToolName } from './tools.ts';
import type { GateDecision, GateType, RunRole, TaskStage } from './types.ts';

export type PipelineStep =
  | 'answer'
  | 'research'
  | 'investigate'
  | 'your_ok'
  | 'plan'
  | 'operate'
  | 'build'
  | 'checks'
  | 'agent_review'
  | 'your_review'
  | 'pull_request'
  | 'pre_merge'
  | 'merge'
  | 'post_merge';

export const PIPELINE_ORDER: readonly PipelineStep[] = [
  'answer',
  'research',
  'investigate',
  'your_ok',
  'plan',
  'operate',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'pre_merge',
  'merge',
  'post_merge',
];

export type StepClass =
  | 'inquiry'
  | 'consent'
  | 'planning'
  | 'code'
  | 'operation'
  | 'verification'
  | 'review'
  | 'shipping'
  | 'handover';

export type GateStrength = 'hard' | 'soft' | 'none';

export type StepActor = { by: 'agent'; role: RunRole } | { by: 'shinsa' } | { by: 'you' };

export interface StepOutput {
  name: string;
  tool: ShinsaToolName | null;
  evidence: boolean;
}

export type StepPlacement = 'canonical' | 'after_plan_or_last';

export interface StepNeed {
  steps: readonly PipelineStep[];
  match: 'any' | 'all';
  where: 'before' | 'anywhere';
  rule: string;
}

export type SoftGateType = 'checks' | 'agent_review' | 'ci';

export type StepGateType = GateType | SoftGateType;

export interface StepGate {
  strength: GateStrength;
  types: readonly StepGateType[];
  when: string | null;
}

export type PlanGateReason = 'operates' | 'plan_first' | 'asks_approval' | 'large' | 'revised';

export interface PlanGateRule {
  always: readonly PlanGateReason[];
  withApprovePlans: readonly PlanGateReason[];
}

export const PLAN_GATE_RULE: PlanGateRule = {
  always: ['operates', 'plan_first', 'asks_approval'],
  withApprovePlans: ['large', 'revised'],
};

const PLAN_GATE_REASON_TEXT: Record<PlanGateReason, string> = {
  operates: 'the task runs an operation',
  plan_first: 'it was created plan first',
  asks_approval: 'the plan asks for approval',
  large: 'the task is large',
  revised: 'the plan is a revision',
};

function joinReasons(reasons: readonly PlanGateReason[]) {
  const texts = reasons.map((reason) => PLAN_GATE_REASON_TEXT[reason]);
  return texts.length > 1 ? `${texts.slice(0, -1).join(', ')} or ${texts.at(-1)}` : (texts[0] ?? '');
}

export function describePlanGateRule(rule: PlanGateRule = PLAN_GATE_RULE) {
  return `Always when ${joinReasons(rule.always)}; with Approve plans on, also when ${joinReasons(rule.withApprovePlans)}.`;
}

export interface StepDefinition {
  step: PipelineStep;
  title: string;
  class: StepClass;
  actor: StepActor;
  inputs: readonly string[];
  outputs: readonly StepOutput[];
  exit: string;
  gate: StepGate;
  placement: StepPlacement;
  needs: readonly StepNeed[];
  worktree: boolean;
  stages: readonly TaskStage[];
  composable: boolean;
}

const NEEDS_PLAN: StepNeed = {
  steps: ['plan'],
  match: 'all',
  where: 'anywhere',
  rule: 'Changing code or running an operation needs a plan first.',
};

const NEEDS_BUILD: StepNeed = {
  steps: ['build'],
  match: 'all',
  where: 'anywhere',
  rule: 'Checks, reviews, pull requests and merges need a code change.',
};

const INQUIRY_EXIT = 'The agent handed over its result; a proposed change waits for the human’s OK.';

const NO_GATE: StepGate = { strength: 'none', types: [], when: null };

export const STEP_SCHEMA: Record<PipelineStep, StepDefinition> = {
  answer: {
    step: 'answer',
    title: 'Answer',
    class: 'inquiry',
    actor: { by: 'agent', role: 'answerer' },
    inputs: ['the request', 'the repository, read-only'],
    outputs: [{ name: 'the answer', tool: 'answer', evidence: false }],
    exit: INQUIRY_EXIT,
    gate: NO_GATE,
    placement: 'canonical',
    needs: [],
    worktree: false,
    stages: ['answering'],
    composable: true,
  },
  research: {
    step: 'research',
    title: 'Research',
    class: 'inquiry',
    actor: { by: 'agent', role: 'researcher' },
    inputs: ['the request', 'the repository, read-only'],
    outputs: [{ name: 'the report', tool: 'submit_report', evidence: false }],
    exit: INQUIRY_EXIT,
    gate: NO_GATE,
    placement: 'canonical',
    needs: [],
    worktree: false,
    stages: ['researching'],
    composable: true,
  },
  investigate: {
    step: 'investigate',
    title: 'Investigate',
    class: 'inquiry',
    actor: { by: 'agent', role: 'investigator' },
    inputs: ['the request', 'a scratch worktree; nothing it changes ships'],
    outputs: [
      { name: 'the diagnosis', tool: 'report_diagnosis', evidence: false },
      { name: 'what it reproduced', tool: 'attach_evidence', evidence: true },
    ],
    exit: INQUIRY_EXIT,
    gate: NO_GATE,
    placement: 'canonical',
    needs: [],
    worktree: true,
    stages: ['investigating'],
    composable: true,
  },
  your_ok: {
    step: 'your_ok',
    title: 'Your OK',
    class: 'consent',
    actor: { by: 'you' },
    inputs: ['the inquiry’s result', 'what the agent proposes to do next'],
    outputs: [{ name: 'your decision', tool: null, evidence: false }],
    exit: 'The human approved the proposal. A veto keeps the task as its inquiry and finishes it.',
    gate: {
      strength: 'hard',
      types: ['proposal'],
      when: 'The inquiry handed over and proposes what comes next, or the agent composed this step while planning.',
    },
    placement: 'canonical',
    needs: [
      {
        steps: ['answer', 'research', 'investigate'],
        match: 'any',
        where: 'anywhere',
        rule: 'Your OK follows an answer, research or an investigation.',
      },
      {
        steps: ['plan'],
        match: 'all',
        where: 'anywhere',
        rule: 'Your OK decides whether the work goes on, so a plan follows it.',
      },
    ],
    worktree: false,
    stages: ['awaiting_proposal'],
    composable: true,
  },
  plan: {
    step: 'plan',
    title: 'Plan',
    class: 'planning',
    actor: { by: 'agent', role: 'agent' },
    inputs: ['the request', 'the inquiry’s result and your OK, when there was one', 'the repository'],
    outputs: [
      {
        name: 'the plan: phases, the verification plan, the operation and its impact',
        tool: 'propose_plan',
        evidence: false,
      },
    ],
    exit: 'The plan passed the rules, and the human approved it when its gate opened.',
    gate: {
      strength: 'hard',
      types: ['plan'],
      when: describePlanGateRule(),
    },
    placement: 'canonical',
    needs: [
      {
        steps: ['build', 'operate'],
        match: 'any',
        where: 'anywhere',
        rule: 'A plan needs something to carry it out.',
      },
    ],
    worktree: true,
    stages: ['planning', 'awaiting_plan'],
    composable: true,
  },
  operate: {
    step: 'operate',
    title: 'Run the operation',
    class: 'operation',
    actor: { by: 'agent', role: 'agent' },
    inputs: ['the approved plan: its operation steps and impact', 'after a merge, the merged code'],
    outputs: [
      { name: 'the outcome', tool: 'report_outcome', evidence: false },
      { name: 'what each step showed', tool: 'attach_evidence', evidence: true },
    ],
    exit: 'The agent reported how the operation went.',
    gate: {
      strength: 'hard',
      types: ['plan', 'operation'],
      when: 'The human approves its plan before anything runs, and confirms again right before it runs after a merge.',
    },
    placement: 'after_plan_or_last',
    needs: [NEEDS_PLAN],
    worktree: true,
    stages: ['operating', 'awaiting_operation'],
    composable: true,
  },
  build: {
    step: 'build',
    title: 'Build',
    class: 'code',
    actor: { by: 'agent', role: 'agent' },
    inputs: ['the approved plan, in the conversation that planned it', 'each phase in turn'],
    outputs: [
      { name: 'a phase report per phase, committed', tool: 'complete_phase', evidence: false },
      { name: 'the evidence the plan asks for', tool: 'attach_evidence', evidence: true },
    ],
    exit: 'Every phase reported, and the evidence the plan asks for is attached.',
    gate: NO_GATE,
    placement: 'canonical',
    needs: [
      NEEDS_PLAN,
      {
        steps: ['your_review', 'pull_request', 'merge'],
        match: 'all',
        where: 'anywhere',
        rule: 'A code change goes through your review, a pull request and the merge.',
      },
    ],
    worktree: true,
    stages: ['building', 'fixing'],
    composable: true,
  },
  checks: {
    step: 'checks',
    title: 'Checks',
    class: 'verification',
    actor: { by: 'shinsa' },
    inputs: [
      'the checks the plan lists and the agent changes',
      'the repository’s own commands, before review',
    ],
    outputs: [{ name: 'the check results', tool: null, evidence: true }],
    exit: 'No check fails because of the change. A failure the change caused goes back to the agent with its output; one that fails on the base branch too does not block.',
    gate: { strength: 'soft', types: ['checks'], when: null },
    placement: 'canonical',
    needs: [NEEDS_BUILD],
    worktree: false,
    stages: ['checking'],
    composable: true,
  },
  agent_review: {
    step: 'agent_review',
    title: 'Agent review',
    class: 'verification',
    actor: { by: 'agent', role: 'reviewer' },
    inputs: ['the diff', 'the plan', 'the findings you dismissed'],
    outputs: [{ name: 'the findings', tool: 'report_review', evidence: true }],
    exit: 'No blocking finding. After three rounds the review goes to the human with the last findings.',
    gate: { strength: 'soft', types: ['agent_review'], when: null },
    placement: 'canonical',
    needs: [NEEDS_BUILD],
    worktree: false,
    stages: ['reviewing'],
    composable: true,
  },
  your_review: {
    step: 'your_review',
    title: 'Your review',
    class: 'review',
    actor: { by: 'you' },
    inputs: ['the report built from every phase', 'the diff', 'the evidence', 'the checks', 'the findings'],
    outputs: [{ name: 'your decision', tool: null, evidence: false }],
    exit: 'The human approved the work.',
    gate: { strength: 'hard', types: ['review'], when: null },
    placement: 'canonical',
    needs: [NEEDS_BUILD],
    worktree: false,
    stages: ['awaiting_review'],
    composable: true,
  },
  pull_request: {
    step: 'pull_request',
    title: 'Pull request',
    class: 'shipping',
    actor: { by: 'shinsa' },
    inputs: ['the reviewed branch'],
    outputs: [{ name: 'the pull request, CI and bot verdicts', tool: null, evidence: true }],
    exit: 'CI is green, no comment is unread and there is no conflict. Anything new goes back to the agent.',
    gate: { strength: 'soft', types: ['ci'], when: null },
    placement: 'canonical',
    needs: [
      NEEDS_BUILD,
      {
        steps: ['your_review'],
        match: 'all',
        where: 'before',
        rule: 'A pull request opens only after your review.',
      },
    ],
    worktree: false,
    stages: ['shipping'],
    composable: true,
  },
  pre_merge: {
    step: 'pre_merge',
    title: 'Pre-merge',
    class: 'handover',
    actor: { by: 'you' },
    inputs: ['the pre-merge steps in the work report: a variable, a secret, a setting production needs'],
    outputs: [{ name: 'each step ticked once you did it', tool: null, evidence: false }],
    exit: 'You ticked every pre-merge step; until then the merge gate does not merge.',
    gate: {
      strength: 'hard',
      types: ['merge'],
      when: 'Ticked on the merge gate: Merge waits until every step is ticked.',
    },
    placement: 'canonical',
    needs: [
      {
        steps: ['pull_request'],
        match: 'all',
        where: 'before',
        rule: 'Your pre-merge steps come after the pull request.',
      },
      {
        steps: ['merge'],
        match: 'all',
        where: 'anywhere',
        rule: 'Your pre-merge steps need a merge after them.',
      },
    ],
    worktree: false,
    stages: [],
    composable: false,
  },
  merge: {
    step: 'merge',
    title: 'Merge',
    class: 'shipping',
    actor: { by: 'you' },
    inputs: ['the clean pull request', 'CI', 'what changed since your review'],
    outputs: [{ name: 'the merged commit', tool: null, evidence: true }],
    exit: 'GitHub reports the pull request merged.',
    gate: { strength: 'hard', types: ['merge'], when: null },
    placement: 'canonical',
    needs: [
      NEEDS_BUILD,
      {
        steps: ['pull_request'],
        match: 'all',
        where: 'before',
        rule: 'A merge needs a pull request first.',
      },
    ],
    worktree: false,
    stages: ['awaiting_merge', 'merged'],
    composable: true,
  },
  post_merge: {
    step: 'post_merge',
    title: 'Post-merge',
    class: 'handover',
    actor: { by: 'you' },
    inputs: ['the post-merge steps in the work report: a deploy, a migration, a variable, a flag'],
    outputs: [{ name: 'each step ticked once you did it', tool: null, evidence: false }],
    exit: 'You ticked every post-merge step. They open only once the pull request merged, and until each is ticked the task stays open, across later rounds too.',
    gate: {
      strength: 'hard',
      types: ['post_merge'],
      when: 'The round rests after its merge (and after an operation that follows it) with a step still unticked.',
    },
    placement: 'canonical',
    needs: [
      {
        steps: ['merge'],
        match: 'all',
        where: 'before',
        rule: 'Your post-merge steps come after the merge.',
      },
    ],
    worktree: false,
    stages: [],
    composable: false,
  },
};

export interface GateChoice<D extends string> {
  decision: D;
  does: string;
}

export type SoftGateOutcome = 'pass' | 'fail' | 'escalate';

export interface HardGateDefinition {
  type: GateType;
  strength: 'hard';
  decidedBy: 'you';
  title: string;
  shows: readonly string[];
  decisions: readonly GateChoice<GateDecision>[];
  refusal: string;
  pauses: boolean;
}

export interface SoftGateDefinition {
  type: SoftGateType;
  strength: 'soft';
  decidedBy: 'shinsa' | RunRole;
  title: string;
  shows: readonly string[];
  outcomes: readonly GateChoice<SoftGateOutcome>[];
  escalatesTo: GateType;
}

export type GateDefinition = HardGateDefinition | SoftGateDefinition;

const DECISION_REFUSAL = 'Approve it, ask for changes or reject it.';

const RETRY: GateChoice<GateDecision> = { decision: 'approve', does: 'Retries the step.' };

const RETRY_WITH: GateChoice<GateDecision> = {
  decision: 'reply',
  does: 'Retries the step with your words as guidance.',
};

const CANCEL: GateChoice<GateDecision> = { decision: 'reject', does: 'Cancels the task.' };

const HARD_GATES = {
  plan: {
    type: 'plan',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Plan to approve',
    shows: [
      'the plan as a document',
      'its version and what changed since the last one',
      'the operation and its impact',
    ],
    decisions: [
      { decision: 'approve', does: 'Records the version you read and starts the build or the operation.' },
      { decision: 'revise', does: 'The agent revises the plan with your words.' },
      CANCEL,
    ],
    refusal: DECISION_REFUSAL,
    pauses: false,
  },
  review: {
    type: 'review',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Review',
    shows: [
      'the report built from every phase',
      'the diff ranked by risk',
      'the evidence and the checks',
      'each agent finding',
    ],
    decisions: [
      {
        decision: 'approve',
        does: 'Pushes the branch and opens the pull request; edits you made in the Code tab are committed and checked first.',
      },
      { decision: 'revise', does: 'The agent works on your words or the findings you kept.' },
      CANCEL,
    ],
    refusal: DECISION_REFUSAL,
    pauses: false,
  },
  merge: {
    type: 'merge',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Merge',
    shows: ['the final diff', 'CI and the bot verdicts', 'what changed since your review'],
    decisions: [
      {
        decision: 'approve',
        does: 'Merges the pull request; edits you made in the Code tab are pushed first, and it merges once CI passes.',
      },
      { decision: 'revise', does: 'The agent works on your words.' },
      CANCEL,
    ],
    refusal: DECISION_REFUSAL,
    pauses: false,
  },
  question: {
    type: 'question',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Question',
    shows: ['the question', 'its context', 'the choices and the agent’s recommendation'],
    decisions: [{ decision: 'reply', does: 'The waiting agent carries on with your answer.' }],
    refusal: 'Answer the question.',
    pauses: false,
  },
  secret: {
    type: 'secret',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Secret',
    shows: ['what the secret is for', 'why the agent needs it'],
    decisions: [
      { decision: 'reply', does: 'Stores the secret and hands the agent a reference to it.' },
      { decision: 'reject', does: 'Tells the agent there is no secret.' },
    ],
    refusal: 'Paste the secret into the secret field.',
    pauses: false,
  },
  proposal: {
    type: 'proposal',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Your OK',
    shows: ['the answer, report or diagnosis', 'what the agent proposes and why'],
    decisions: [
      {
        decision: 'approve',
        does: 'Goes on to the change or operation: the setup is verified again, then it is planned.',
      },
      { decision: 'reject', does: 'Keeps the task as its inquiry and finishes it.' },
    ],
    refusal: 'Approve the proposal or keep the task as it is.',
    pauses: false,
  },
  operation: {
    type: 'operation',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Run the operation',
    shows: [
      'the merged commit and pull request',
      'the operation steps from the approved plan',
      'its impact',
      'your notes for the agent',
    ],
    decisions: [
      {
        decision: 'approve',
        does: 'Starts the agent on the operation, on the merged code, with the notes on the gate.',
      },
      {
        decision: 'reply',
        does: 'Replaces the notes with your words, then starts the agent on the operation.',
      },
      { decision: 'reject', does: 'Finishes the task without running the operation.' },
    ],
    refusal: 'Run the operation or finish the task without it.',
    pauses: false,
  },
  failure: {
    type: 'failure',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Paused',
    shows: ['what stopped', 'why, and what Retry does'],
    decisions: [RETRY, RETRY_WITH, CANCEL],
    refusal: 'Retry or cancel the task.',
    pauses: true,
  },
  configuration: {
    type: 'configuration',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Setup incomplete',
    shows: ['each setup problem', 'how to fix it'],
    decisions: [{ decision: 'approve', does: 'Verifies the setup again.' }, CANCEL],
    refusal: 'Verify the setup again, or cancel the task.',
    pauses: true,
  },
  post_merge: {
    type: 'post_merge',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Post-merge',
    shows: ['each post-merge step the agent left for you', 'which are ticked'],
    decisions: [],
    refusal: 'Tick each post-merge step once you did it; the gate closes with the last one.',
    pauses: false,
  },
  sign_in: {
    type: 'sign_in',
    strength: 'hard',
    decidedBy: 'you',
    title: 'Sign in',
    shows: ['the provider and the account that needs signing in'],
    decisions: [RETRY, RETRY_WITH, CANCEL],
    refusal: 'Sign in, retry or cancel the task.',
    pauses: true,
  },
} as const satisfies Record<GateType, HardGateDefinition>;

const SOFT_GATES = {
  checks: {
    type: 'checks',
    strength: 'soft',
    decidedBy: 'shinsa',
    title: 'Checks',
    shows: ['each check command and its output'],
    outcomes: [
      { decision: 'pass', does: 'Goes on to the next phase, or to the agent review after the last.' },
      { decision: 'fail', does: 'The agent gets the output; the failing checks run again after the fix.' },
      { decision: 'escalate', does: 'Out of fix rounds or stalled: a failure gate asks you.' },
    ],
    escalatesTo: 'failure',
  },
  agent_review: {
    type: 'agent_review',
    strength: 'soft',
    decidedBy: 'reviewer',
    title: 'Agent review',
    shows: ['the diff', 'the plan'],
    outcomes: [
      { decision: 'pass', does: 'Opens your review.' },
      {
        decision: 'fail',
        does: 'The agent works on the blocking findings; checks and a new reviewer follow.',
      },
      {
        decision: 'escalate',
        does: 'After three rounds, a stall or the fix budget: your review opens with the findings.',
      },
    ],
    escalatesTo: 'review',
  },
  ci: {
    type: 'ci',
    strength: 'soft',
    decidedBy: 'shinsa',
    title: 'CI and bots',
    shows: ['each CI run', 'new comments and review threads', 'conflicts'],
    outcomes: [
      { decision: 'pass', does: 'Opens the merge gate.' },
      { decision: 'fail', does: 'The agent is told exactly what is new, and its fix is pushed.' },
      { decision: 'escalate', does: 'The watch stops or runs out of rounds: a failure gate asks you.' },
    ],
    escalatesTo: 'failure',
  },
} as const satisfies Record<SoftGateType, SoftGateDefinition>;

export const GATE_SCHEMA = { ...HARD_GATES, ...SOFT_GATES } as const;

export function resolveGateDefinition(gate: { type: GateType }): HardGateDefinition {
  return HARD_GATES[gate.type];
}

export function isWorktreeStep(step: PipelineStep) {
  return STEP_SCHEMA[step].worktree;
}

export function needsWorktree(steps: readonly PipelineStep[]) {
  return steps.some(isWorktreeStep);
}

function listStepsOfClass(steps: readonly PipelineStep[], stepClass: StepClass) {
  return steps.filter((step) => STEP_SCHEMA[step].class === stepClass);
}

const WORKING_CLASSES: ReadonlySet<StepClass> = new Set<StepClass>(['inquiry', 'code', 'operation']);

function rankOf(step: PipelineStep) {
  return PIPELINE_ORDER.indexOf(step);
}

function isPlaced(steps: readonly PipelineStep[], step: PipelineStep) {
  const index = steps.indexOf(step);
  const before = steps.slice(0, index);
  if (before.at(-1) === 'plan') return true;
  const after = steps.slice(index + 1).filter((later) => later !== 'post_merge');
  return after.length === 0 && before.at(-1) === 'merge';
}

function isNeedMet(steps: readonly PipelineStep[], step: PipelineStep, need: StepNeed) {
  const limit = need.where === 'before' ? steps.indexOf(step) : steps.length;
  const present = need.steps.map((wanted) => {
    const index = steps.indexOf(wanted);
    return index !== -1 && index < limit;
  });
  return need.match === 'all' ? present.every(Boolean) : present.some(Boolean);
}

function listOrderErrors(steps: readonly PipelineStep[]) {
  const errors: string[] = [];
  const ranks = steps.filter((step) => STEP_SCHEMA[step].placement === 'canonical').map(rankOf);
  if (ranks.some((rank, index) => index > 0 && rank <= (ranks[index - 1] ?? -1))) {
    errors.push('The steps are out of order.');
  }
  const placed = steps.filter((step) => STEP_SCHEMA[step].placement === 'after_plan_or_last');
  if (placed.some((step) => steps.includes('plan') && !isPlaced(steps, step))) {
    errors.push('An operation runs right after the plan, or after the merge, before your steps after it.');
  }
  if (listStepsOfClass(steps, 'inquiry').length > 1) {
    errors.push('A task answers, researches or investigates, not more than one of them.');
  }
  return errors;
}

export function validatePipeline(steps: readonly PipelineStep[]): string[] {
  if (steps.length === 0) return ['A task needs at least one step.'];
  const errors = new Set<string>();
  if (new Set(steps).size !== steps.length) errors.add('A step appears twice.');
  for (const error of listOrderErrors(steps)) errors.add(error);
  const needs = PIPELINE_ORDER.filter((step) => steps.includes(step)).flatMap((step) =>
    STEP_SCHEMA[step].needs.filter((need) => !isNeedMet(steps, step, need))
  );
  for (const need of needs) errors.add(need.rule);
  if (!steps.some((step) => WORKING_CLASSES.has(STEP_SCHEMA[step].class))) {
    errors.add('A task needs a step that does the work.');
  }
  return [...errors];
}

export type HandOverStep = Extract<PipelineStep, 'pre_merge' | 'post_merge'>;

export const COMPOSABLE_STEPS: readonly PipelineStep[] = PIPELINE_ORDER.filter(
  (step) => STEP_SCHEMA[step].composable
);

export function isComposableStep(step: PipelineStep) {
  return STEP_SCHEMA[step].composable;
}

export function listComposedSteps(steps: readonly PipelineStep[]) {
  return steps.filter(isComposableStep);
}

export interface HandOverTimings {
  before: boolean;
  after: boolean;
}

export function resolveHandOverPipeline(
  steps: readonly PipelineStep[],
  listed: HandOverTimings
): PipelineStep[] {
  const composed = listComposedSteps(steps);
  if (!composed.includes('merge')) return composed;
  const pipeline = composed.flatMap((step): PipelineStep[] =>
    step === 'merge' && listed.before ? ['pre_merge', 'merge'] : [step]
  );
  return listed.after ? [...pipeline, 'post_merge'] : pipeline;
}
