import { Schema } from 'effect';
import type { ChangeProposalInput, InquiryShape } from '../commands/index.ts';
import { describeWholeSuiteRefusal, isWholeSuiteCommand } from '../domain/checks.ts';
import {
  COMPOSABLE_STEPS,
  type DeliveringStep,
  EVIDENCE_KINDS,
  EVIDENCE_STAGES,
  EVIDENCE_THEMES,
  FEEDBACK_LIMITS,
  isEvidenceKey,
  MEMORY_LIMITS,
  MEMORY_SCOPES,
  type MemoryScope,
  type PipelineStep,
  PLAN_EVIDENCE_KINDS,
  SHAPE_LIMITS,
  WATCHDOG_SETTING_LIMITS,
} from '../domain/index.ts';
import type { EvidenceItemKind } from '../domain/types.ts';
import {
  CountUpTo,
  Flag,
  HandOverReader,
  HandOverRecord,
  Items,
  LineNumber,
  ListOrRecord,
  OptionalOneOf,
  OptionalText,
  OptionalWholeRecord,
  OrAbsent,
  OrOmitted,
  OneOf,
  ReadWhen,
  Required,
  type Validation,
} from './reading.ts';
import { createTesting, isWebUrl, MANUAL_TEST_TARGETS, parseTestFile } from './testing.ts';
import type {
  AgentReply,
  Attention,
  CheckChangeAction,
  CheckChangeHandOver,
  CodeSpot,
  ComparisonPartHandOver,
  EvidenceHandOver,
  EvidenceRemovalHandOver,
  EvidenceSource,
  FixHandOver,
  JudgementCall,
  LinkedEvidenceKind,
  ManualTestTarget,
  MergeStep,
  MergeStepKind,
  MergeStepTiming,
  PhaseHandOver,
  PlanDocument,
  PlanHandOver,
  QuestionHandOver,
  ReplyOutcome,
  ReportRisk,
  ReportTesting,
  ReportWalkthrough,
  ReportWalkthroughRevision,
  ReviewFinding,
  ReviewHandOver,
  SuggestedTask,
  WaitHandOver,
  WatchdogSpec,
  WatchdogStart,
} from './types.ts';

export const PROTOCOL_LIMITS = {
  phaseSummary: 240,
  spots: 8,
  why: 180,
  spotTitle: 80,
  explain: 400,
  judgementCalls: 5,
  callTitle: 60,
  call: 120,
  reason: 240,
  alternatives: 3,
  alternativeOption: 100,
  alternativeRejected: 200,
  walkthroughApproach: 1_200,
  flow: 2_400,
  risks: 8,
  riskTitle: 60,
  risk: 280,
  testingAutomated: 4,
  testingAutomatedItem: 240,
  testingSteps: 10,
  testingAction: 240,
  testingExpect: 240,
  testingTarget: 400,
  mergeSteps: 8,
  mergeStepTitle: 80,
  mergeStepDetail: 400,
  mergeStepCommand: 400,
  watchdogs: 5,
  watchdogTitle: 80,
  watchdogCheck: 600,
  watchdogServer: 128,
  watchdogData: 200,
  watchdogEvidence: 600,
  watchdogSuggestions: 4,
  watchdogSuggestion: 160,
  watchdogFirstCheckMinutes: WATCHDOG_SETTING_LIMITS.firstCheckMinutes,
  watchdogMaxGapHours: WATCHDOG_SETTING_LIMITS.maxGapHours,
  watchdogForHours: WATCHDOG_SETTING_LIMITS.hours,
  watchdogProductionCheck: 400,
  disagreements: 8,
  disagreement: 280,
  taskTitle: 60,
  goal: 300,
  minPlanPhases: 2,
  planPhases: 8,
  planTitle: 60,
  planDetail: 160,
  behaviour: 8,
  behaviourItem: 200,
  approach: 700,
  files: 20,
  fileChange: 140,
  listItems: 6,
  listItem: 200,
  questions: 4,
  question: 200,
  options: 4,
  option: 100,
  findingCount: 12,
  finding: 280,
  findingTitle: 80,
  findingFix: 600,
  reviewSummary: 400,
  path: 300,
  questionContext: 2_000,
  suggestions: 5,
  suggestionTitle: 80,
  suggestionRequest: 2_000,
  suggestionWhy: 200,
  waitNotes: 500,
  waitCheckMinutes: 24 * 60,
  waitTimeoutMinutes: 7 * 24 * 60,
  waitAttempts: 100,
  impact: 1_000,
  checks: 12,
  checkLabel: 60,
  checkCommand: 200,
  checkChanges: 6,
  checkReason: 200,
  checkId: 12,
  evidenceTitle: 80,
  evidenceDetail: 280,
  evidenceWidth: 7_680,
  evidenceText: 40_000,
  evidenceUrl: 2_000,
  evidenceParts: 6,
  evidenceLabel: 40,
  evidenceKey: 60,
  evidenceItems: 24,
  evidenceReason: 200,
  replyHeadline: 240,
  replyPoints: 8,
  replyAsk: 160,
  replyNote: 280,
  replyNext: 1_200,
} as const;

export const REPLY_OUTCOMES: readonly [ReplyOutcome, ...ReplyOutcome[]] = ['done', 'answered', 'not_changed'];

export const ATTACHED_EVIDENCE_KINDS: readonly [EvidenceItemKind, ...EvidenceItemKind[]] = [
  ...EVIDENCE_KINDS,
  'comparison',
];

export const WATCHDOG_STARTS: readonly [WatchdogStart, ...WatchdogStart[]] = ['merge', 'production'];

export const MERGE_STEP_TIMINGS: readonly [MergeStepTiming, ...MergeStepTiming[]] = [
  'pre_merge',
  'post_merge',
];

export const MERGE_STEP_KINDS: readonly [MergeStepKind, ...MergeStepKind[]] = [
  'env',
  'secret',
  'migration',
  'deploy',
  'config',
  'other',
];

export const CHECK_CHANGE_ACTIONS: readonly [CheckChangeAction, ...CheckChangeAction[]] = [
  'add',
  'change',
  'remove',
];

export const ATTENTION_LEVELS: readonly [Attention, ...Attention[]] = ['critical', 'high', 'normal'];

export const FINDING_SEVERITIES: readonly [ReviewFinding['severity'], ...ReviewFinding['severity'][]] = [
  'blocking',
  'should_fix',
  'optional',
];

export type { Validation } from './reading.ts';

const L = PROTOCOL_LIMITS;

function EndAfter<const K extends string>(start: K) {
  return Schema.makeFilter(
    (record: { readonly [P in K | 'end']: number | null }) =>
      record[start] === null || record.end === null || record.end >= record[start]
        ? undefined
        : `{path}.end comes before {path}.${start}.`,
    { after: 'end' }
  );
}

function TextList(max: number, item: number) {
  return Items(Required(item), max);
}

const OptionalLine = OrAbsent(LineNumber);

const Spot = HandOverRecord({
  start: LineNumber,
  end: OptionalLine,
  title: OptionalText(L.spotTitle),
  explain: OptionalText(L.explain),
  file: Required(L.path),
  attention: OneOf(ATTENTION_LEVELS),
  why: Required(L.why),
}).check(EndAfter('start'));

const Alternative = HandOverRecord({
  option: Required(L.alternativeOption),
  rejected: Required(L.alternativeRejected),
});

const JudgementCallInput = HandOverRecord({
  line: OptionalLine,
  end: OptionalLine,
  alternatives: Items(Alternative, L.alternatives),
  title: Required(L.callTitle),
  call: Required(L.call),
  reason: Required(L.reason),
  file: OptionalText(L.path),
}).check(EndAfter('line'));

const Risk = HandOverRecord({
  line: OptionalLine,
  end: OptionalLine,
  title: Required(L.riskTitle),
  risk: Required(L.risk),
  file: OptionalText(L.path),
}).check(EndAfter('line'));

const TestTarget = HandOverRecord({
  kind: OneOf(MANUAL_TEST_TARGETS),
  value: Required(L.testingTarget),
}).check(
  Schema.makeFilter(({ kind, value }: { kind: ManualTestTarget['kind']; value: string }) => {
    if (value && kind === 'url' && !isWebUrl(value)) return '{path}.value must be an http or https URL.';
    if (value && kind === 'file' && !parseTestFile(value)) {
      return '{path}.value must be a path relative to the repository root, with :line or :start-end when it points at lines.';
    }
    return undefined;
  })
);

const ManualStep = HandOverRecord({
  action: Required(L.testingAction),
  target: OrAbsent(TestTarget),
  expect: Required(L.testingExpect),
});

const AutomatedTesting = TextList(L.testingAutomated, L.testingAutomatedItem);

const Testing = ListOrRecord(
  AutomatedTesting,
  HandOverRecord({ automated: AutomatedTesting, manual: Items(ManualStep, L.testingSteps) })
);

const SHIPPING_COMMAND = /\bgit\s+(?:-C\s+\S+\s+)*(?:add|commit|push)\b|\bgh\s+pr\s+(?:create|merge)\b/;

const MergeStepInput = HandOverRecord({
  when: OneOf(MERGE_STEP_TIMINGS),
  kind: OneOf(MERGE_STEP_KINDS),
  title: Required(L.mergeStepTitle),
  detail: Required(L.mergeStepDetail),
  command: OptionalText(L.mergeStepCommand),
});

const MergeSteps = Items(MergeStepInput, L.mergeSteps).check(
  Schema.makeFilter((steps: ReadonlyArray<MergeStep>) =>
    steps.flatMap((step, index) => {
      const first = steps.findIndex((other) => other.when === step.when && other.title === step.title);
      return [
        ...(first < index
          ? [`{path}[${index}].title repeats {path}[${first}]; give each step its own title.`]
          : []),
        ...(step.command && SHIPPING_COMMAND.test(step.command)
          ? [
              `{path}[${index}].command stages, commits, pushes or opens a pull request, which is never the human's step. Shinsa commits and pushes this repository; file work in another repository with \`create_task\` instead.`,
            ]
          : []),
      ];
    })
  )
);

const WatchdogSourceInput = HandOverRecord({
  server: Required(L.watchdogServer),
  data: Required(L.watchdogData),
});

const SourceRequest = HandOverRecord({
  suggestions: TextList(L.watchdogSuggestions, L.watchdogSuggestion),
  data: Required(L.watchdogData),
  evidence: Required(L.watchdogEvidence),
}).check(
  Schema.makeFilter(
    ({ suggestions }: { suggestions: ReadonlyArray<string> }) =>
      suggestions.length > 0 ||
      '{path}.suggestions needs at least 1 server to connect, by name and where it comes from.',
    { after: 'suggestions' }
  )
);

const Watchdog = HandOverRecord({
  source: OrAbsent(WatchdogSourceInput),
  source_request: OrAbsent(SourceRequest),
  title: Required(L.watchdogTitle),
  check: Required(L.watchdogCheck),
  first_check_minutes: OrAbsent(CountUpTo(L.watchdogFirstCheckMinutes)),
  max_gap_hours: OrAbsent(CountUpTo(L.watchdogMaxGapHours)),
  for_hours: OrAbsent(CountUpTo(L.watchdogForHours)),
  starts: OrAbsent(OneOf(WATCHDOG_STARTS)),
  production_check: OptionalText(L.watchdogProductionCheck),
}).check(
  Schema.makeFilter(
    ({ source, source_request }: { source: unknown; source_request: unknown }) =>
      (source === null) !== (source_request === null) ||
      '{path} needs exactly one of source (a server that has the data) or source_request (what to connect).',
    { after: 'source_request' }
  ),
  Schema.makeFilter(
    ({ starts, production_check }: { starts: WatchdogStart | null; production_check: string | null }) =>
      starts !== 'production' ||
      production_check !== null ||
      '{path}.production_check is required when it starts on production: how to tell the merged change is live there.',
    { after: 'production_check' }
  )
);

const Watchdogs = Items(Watchdog, L.watchdogs).check(
  Schema.makeFilter((watchdogs: ReadonlyArray<typeof Watchdog.Type>) =>
    watchdogs.flatMap((watchdog, index) => {
      const first = watchdogs.findIndex((other) => other.title === watchdog.title);
      const { first_check_minutes: firstCheck, for_hours: forHours } = watchdog;
      return [
        ...(first < index
          ? [`{path}[${index}].title repeats {path}[${first}]; give each watchdog its own title.`]
          : []),
        ...(firstCheck !== null && forHours !== null && firstCheck > forHours * 60
          ? [
              `{path}[${index}] checks first after ${firstCheck} minutes but watches for only ${forHours} hours; check at least once in the window.`,
            ]
          : []),
      ];
    })
  )
);

const Walkthrough = OrAbsent(
  HandOverRecord({
    approach: Required(L.walkthroughApproach),
    flow: Required(L.flow),
    risks: Items(Risk, L.risks),
    testing: OrAbsent(Testing),
    steps: OrAbsent(MergeSteps),
    watchdogs: OrAbsent(Watchdogs),
  })
);

const WalkthroughRevision = OptionalWholeRecord(
  {
    approach: OrAbsent(Required(L.walkthroughApproach)),
    flow: OrAbsent(Required(L.flow)),
    risks: OrAbsent(Items(Risk, L.risks)),
    testing: OrAbsent(Testing),
    steps: OrAbsent(MergeSteps),
    watchdogs: OrAbsent(Watchdogs),
  },
  Schema.makeFilter(
    (revision: { readonly [key: string]: unknown }) =>
      Object.values(revision).some((part) => part !== null) ||
      'walkthrough needs at least one of approach, flow, risks, testing, steps or watchdogs. Leave it out when the fix changes none of them.'
  )
);

const CheckCommand = Required(L.checkCommand).check(
  Schema.makeFilter(
    (command: string) => !isWholeSuiteCommand(command) || describeWholeSuiteRefusal('{path}', command)
  )
);

function PhaseNumbers(phases: number) {
  return Items(CountUpTo(phases), L.planPhases, 1).check(
    Schema.makeFilter(
      (numbers: ReadonlyArray<number>) =>
        new Set(numbers).size === numbers.length || '{path} names a phase twice.'
    )
  );
}

const PHASE_NUMBERS = Array.from({ length: L.planPhases }, (_, index) => PhaseNumbers(index + 1));

const AnyPhaseNumbers = PhaseNumbers(L.planPhases);

function resolvePhaseNumbers(numbers: ReadonlyArray<number>) {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

const CheckChangeInput = HandOverRecord({
  action: OneOf(CHECK_CHANGE_ACTIONS).annotate({ fallback: () => null }),
  id: ReadWhen(
    Required(L.checkId),
    ({ action }: { action: CheckChangeAction | null }) => action !== null && action !== 'add'
  ),
  label: OptionalText(L.checkLabel),
  command: OrAbsent(CheckCommand),
  phases: OrAbsent(AnyPhaseNumbers),
  reason: Required(L.checkReason),
}).check(
  Schema.makeFilter(
    ({
      action,
      label,
      command,
      phases,
    }: Omit<CheckChangeHandOver, 'action'> & { action: CheckChangeAction | null }) => {
      if (action === 'add' && (label === null || command === null))
        return '{path} adds a check: give its label and its command.';
      if (action === 'change' && label === null && command === null && phases === null) {
        return '{path} changes a check: give its new label, command or phases.';
      }
      return undefined;
    }
  )
);

const CheckChanges = Items(CheckChangeInput, L.checkChanges);

const ReplyInput = OrAbsent(
  HandOverRecord({
    headline: Required(L.replyHeadline),
    points: Items(
      HandOverRecord({
        ask: Required(L.replyAsk),
        outcome: OneOf(REPLY_OUTCOMES),
        note: Required(L.replyNote),
      }),
      L.replyPoints,
      1
    ),
    next: OptionalText(L.replyNext),
  })
);

function resolveSpot({ start, end, title, explain, file, attention, why }: typeof Spot.Type): CodeSpot {
  return {
    file,
    start,
    end: end ?? start,
    attention,
    why,
    ...(title === null ? {} : { title }),
    ...(explain === null ? {} : { explain }),
  };
}

function resolveJudgementCall(input: typeof JudgementCallInput.Type): JudgementCall {
  return {
    title: input.title,
    call: input.call,
    reason: input.reason,
    file: input.file,
    line: input.line,
    ...(input.end === null ? {} : { end: input.end }),
    ...(input.alternatives.length > 0 ? { alternatives: input.alternatives } : {}),
  };
}

function resolveRisk({ title, risk, file, line, end }: typeof Risk.Type): ReportRisk {
  return { title, risk, file, line, end };
}

function resolveTesting(testing: typeof Testing.Type | null): ReportTesting {
  if (testing === null) return createTesting();
  if (Array.isArray(testing)) return createTesting(testing);
  return { automated: testing.automated, manual: testing.manual };
}

function resolveWatchdog(watchdog: typeof Watchdog.Type): WatchdogSpec {
  const startsOn = watchdog.starts ?? 'merge';
  return {
    title: watchdog.title,
    check: watchdog.check,
    source: watchdog.source,
    sourceRequest: watchdog.source_request,
    firstCheckMinutes: watchdog.first_check_minutes,
    maxGapHours: watchdog.max_gap_hours,
    forHours: watchdog.for_hours,
    startsOn,
    productionCheck: startsOn === 'production' ? watchdog.production_check : null,
  };
}

function resolveParts(
  steps: MergeStep[] | null,
  watchdogs: (typeof Watchdog.Type)[] | null,
  empty: boolean
): Pick<ReportWalkthrough, 'steps' | 'watchdogs'> {
  return {
    ...(steps !== null && (steps.length > 0 || empty) ? { steps } : {}),
    ...(watchdogs !== null && (watchdogs.length > 0 || empty)
      ? { watchdogs: watchdogs.map(resolveWatchdog) }
      : {}),
  };
}

function resolveWalkthrough(walkthrough: typeof Walkthrough.Type): ReportWalkthrough | null {
  if (walkthrough === null) return null;
  return {
    approach: walkthrough.approach,
    flow: walkthrough.flow,
    risks: walkthrough.risks.map(resolveRisk),
    testing: resolveTesting(walkthrough.testing),
    ...resolveParts(walkthrough.steps, walkthrough.watchdogs, false),
  };
}

function resolveWalkthroughRevision(
  revision: typeof WalkthroughRevision.Type
): ReportWalkthroughRevision | null {
  if (revision === null) return null;
  return {
    ...(revision.approach === null ? {} : { approach: revision.approach }),
    ...(revision.flow === null ? {} : { flow: revision.flow }),
    ...(revision.risks === null ? {} : { risks: revision.risks.map(resolveRisk) }),
    ...(revision.testing === null ? {} : { testing: resolveTesting(revision.testing) }),
    ...resolveParts(revision.steps, revision.watchdogs, true),
  };
}

function resolveCheckChange(change: typeof CheckChangeInput.Type): CheckChangeHandOver {
  return {
    action: change.action,
    id: change.id,
    label: change.label,
    command: change.command,
    phases: change.phases === null ? null : resolvePhaseNumbers(change.phases),
    reason: change.reason,
  };
}

function resolveReply(reply: typeof ReplyInput.Type): AgentReply | null {
  return reply === null ? null : { headline: reply.headline, points: reply.points, next: reply.next };
}

export function listHeldSourceRequests(
  watchdogs: readonly WatchdogSpec[],
  serverNames: readonly string[],
  path = 'walkthrough.watchdogs'
) {
  return watchdogs.flatMap((watchdog, index) => {
    const request = watchdog.sourceRequest;
    if (!request) return [];
    const held = serverNames.filter(
      (server) =>
        request.suggestions.some((suggestion) => isNamedIn(suggestion, server)) &&
        !isCheckedIn(request.evidence, server)
    );
    return held.map(
      (server) =>
        `${path}[${index}].source_request suggests \`${server}\`, a server you already have. Check with its tools whether it reaches the data and give it as the \`source\`; only when it cannot, write in \`evidence\` “checked ${server}” and why it falls short.`
    );
  });
}

function isNamedIn(text: string, server: string) {
  const escaped = server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text);
}

function isCheckedIn(evidence: string, server: string) {
  return (evidence.match(/\bchecked\b[^.;\n]*/gi) ?? []).some((clause) => isNamedIn(clause, server));
}

const PhaseHandOverInput = HandOverRecord({
  summary: Required(L.phaseSummary),
  spots: Items(Spot, L.spots),
  judgement_calls: Items(JudgementCallInput, L.judgementCalls),
  reply: ReplyInput,
  walkthrough: Walkthrough,
  check_changes: CheckChanges,
});

export function validatePhaseHandOver(input: Record<string, unknown>): Validation<PhaseHandOver> {
  const reader = new HandOverReader();
  const handOver = reader.read(PhaseHandOverInput, input, []);
  return reader.result({
    summary: handOver.summary,
    spots: handOver.spots.map(resolveSpot),
    judgementCalls: handOver.judgement_calls.map(resolveJudgementCall),
    reply: resolveReply(handOver.reply),
    walkthrough: resolveWalkthrough(handOver.walkthrough),
    checkChanges: handOver.check_changes.map(resolveCheckChange),
  });
}

const EvidenceRefs = TextList(L.evidenceItems, L.evidenceKey);

const FixHandOverInput = HandOverRecord({
  summary: Required(L.phaseSummary),
  reply: ReplyInput,
  walkthrough: WalkthroughRevision,
  checks: TextList(L.checks, L.checkId),
  check_changes: CheckChanges,
  evidence_kept: EvidenceRefs,
});

export function validateFixHandOver(input: Record<string, unknown>): Validation<FixHandOver> {
  const reader = new HandOverReader();
  const handOver = reader.read(FixHandOverInput, input, []);
  return reader.result({
    summary: handOver.summary,
    reply: resolveReply(handOver.reply),
    walkthrough: resolveWalkthroughRevision(handOver.walkthrough),
    checks: [...new Set(handOver.checks)],
    checkChanges: handOver.check_changes.map(resolveCheckChange),
    evidenceKept: [...new Set(handOver.evidence_kept)],
  });
}

const PlanOutline = HandOverRecord({
  files: Items(HandOverRecord({ path: Required(L.path), change: Required(L.fileChange) }), L.files),
  questions: Items(
    HandOverRecord({
      question: Required(L.question),
      options: TextList(L.options, L.option),
      recommendation: OptionalText(L.option),
    }),
    L.questions
  ),
  phases: Items(
    HandOverRecord({ title: Required(L.planTitle), detail: Required(L.planDetail) }),
    L.planPhases
  ).check(
    Schema.makeFilter(
      (phases: ReadonlyArray<unknown>) =>
        phases.length >= L.minPlanPhases || `phases: at least ${L.minPlanPhases} phases.`
    )
  ),
  title: OptionalText(L.taskTitle),
  goal: Required(L.goal),
  behaviour: TextList(L.behaviour, L.behaviourItem),
  approach: Required(L.approach),
  out_of_scope: TextList(L.listItems, L.listItem),
});

function PlanChecks(phases: number) {
  return Items(
    HandOverRecord({
      label: Required(L.checkLabel),
      command: CheckCommand,
      phases: PHASE_NUMBERS[phases - 1] ?? AnyPhaseNumbers,
    }),
    L.checks
  ).check(
    Schema.makeFilter((checks: ReadonlyArray<{ command: string }>) => {
      const commands = checks.map((check) => check.command);
      return new Set(commands).size === commands.length || 'verification lists a command twice.';
    })
  );
}

const PLAN_CHECKS = Array.from({ length: L.planPhases }, (_, index) => PlanChecks(index + 1));

const PlanParameters = HandOverRecord({
  operation: OrOmitted(TextList(L.planPhases, L.listItem)),
  impact: OptionalText(L.impact),
  evidence: Items(OneOf(PLAN_EVIDENCE_KINDS), PLAN_EVIDENCE_KINDS.length).check(
    Schema.makeFilter(
      (kinds: ReadonlyArray<string>) => new Set(kinds).size === kinds.length || 'evidence names a kind twice.'
    )
  ),
  approval: Flag,
});

function readPlanDocument(reader: HandOverReader, input: Record<string, unknown>): PlanDocument {
  const outline = reader.read(PlanOutline, input, []);
  const checks = PLAN_CHECKS[Math.max(1, outline.phases.length) - 1] ?? PlanChecks(L.planPhases);
  const verification = reader.read(checks, input.verification, ['verification']);
  const { operation, impact, evidence, approval } = reader.read(PlanParameters, input, []);
  return {
    ...(outline.title === null ? {} : { title: outline.title }),
    goal: outline.goal,
    phases: outline.phases,
    behaviour: outline.behaviour,
    approach: outline.approach,
    files: outline.files,
    outOfScope: outline.out_of_scope,
    verification: verification.map((check) => ({ ...check, phases: resolvePhaseNumbers(check.phases) })),
    questions: outline.questions,
    ...(operation === null ? {} : { operation }),
    ...(impact === null ? {} : { impact }),
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(approval ? { approval: true } : {}),
  };
}

const Finding = HandOverRecord({
  line: OptionalLine,
  end: OptionalLine,
  title: OptionalText(L.findingTitle),
  fix: OptionalText(L.findingFix),
  severity: OneOf(FINDING_SEVERITIES),
  file: OptionalText(L.path),
  message: Required(L.finding),
}).check(EndAfter('line'));

const ReviewInput = HandOverRecord({
  summary: OptionalText(L.reviewSummary),
  findings: Items(Finding, L.findingCount),
  disagreements: Items(
    HandOverRecord({
      call: CountUpTo(L.judgementCalls * L.planPhases),
      reason: Required(L.disagreement),
    }),
    L.disagreements
  ).check(
    Schema.makeFilter((entries: ReadonlyArray<{ call: number }>) => {
      const calls = entries.map((entry) => entry.call);
      return new Set(calls).size === calls.length || 'disagreements names a judgement call twice.';
    })
  ),
});

export function validateReview(input: Record<string, unknown>): Validation<ReviewHandOver> {
  const reader = new HandOverReader();
  const { summary, findings, disagreements } = reader.read(ReviewInput, input, []);
  return reader.result({
    summary,
    findings: findings.map(({ line, end, title, fix, severity, file, message }) => ({
      severity,
      file,
      line,
      end: end ?? line,
      ...(title === null ? {} : { title }),
      message,
      ...(fix === null ? {} : { fix }),
    })),
    disagreements,
  });
}

const PlanReply = HandOverRecord({ reply: ReplyInput });

export function validatePlanHandOver(input: Record<string, unknown>): Validation<PlanHandOver> {
  const plan = new HandOverReader();
  const document = readPlanDocument(plan, input);
  const reader = new HandOverReader();
  const { reply } = reader.read(PlanReply, input, []);
  if (plan.errors.length > 0) return { ok: false, errors: [...plan.errors, ...reader.errors] };
  return reader.result({ document, reply: resolveReply(reply) });
}

const QuestionInput = HandOverRecord({
  question: Required(L.question),
  context: OptionalText(L.questionContext),
  choices: TextList(L.options, L.option),
  recommendation: OptionalText(L.option),
}).check(
  Schema.makeFilter(
    ({ choices }: { choices: ReadonlyArray<string> }) => [
      ...(choices.length === 1 ? ['choices needs at least 2 options, or none.'] : []),
      ...(new Set(choices).size === choices.length ? [] : ['choices must differ from each other.']),
    ],
    { after: 'choices' }
  ),
  Schema.makeFilter(
    ({ choices, recommendation }: { choices: ReadonlyArray<string>; recommendation: string | null }) =>
      recommendation === null ||
      choices.includes(recommendation) ||
      'recommendation must be one of the choices, worded the same.',
    { after: 'recommendation' }
  )
);

export function validateQuestion(input: Record<string, unknown>): Validation<QuestionHandOver> {
  const reader = new HandOverReader();
  return reader.result(reader.read(QuestionInput, input, []));
}

const EvidenceKindInput = OneOf(ATTACHED_EVIDENCE_KINDS);

const EvidenceFactsInput = HandOverRecord({
  title: Required(L.evidenceTitle),
  detail: OptionalText(L.evidenceDetail),
  width: OrAbsent(CountUpTo(L.evidenceWidth)),
  theme: OptionalOneOf(EVIDENCE_THEMES),
  key: OptionalText(L.evidenceKey),
  replaces: EvidenceRefs,
}).check(
  Schema.makeFilter(
    ({ key }: { key: string | null }) =>
      key === null ||
      isEvidenceKey(key) ||
      'key takes lower-case letters, digits and single hyphens, like settings-dark-900.',
    { after: 'key' }
  )
);

const PieceInput = HandOverRecord({
  stage: OptionalOneOf(EVIDENCE_STAGES),
  path: OptionalText(L.path),
  url: OptionalText(L.evidenceUrl),
  text: OptionalText(L.evidenceText),
}).check(
  Schema.makeFilter(
    ({ path, url, text }: { path: string | null; url: string | null; text: string | null }) =>
      [path, url, text].filter((value) => value !== null).length === 1 ||
      'Give exactly one of path, url or text.'
  )
);

const ComparisonPart = HandOverRecord({
  path: Required(L.path),
  stage: OptionalOneOf(EVIDENCE_STAGES),
  label: OptionalText(L.evidenceLabel),
}).check(
  Schema.makeFilter(
    ({ stage, label }: ComparisonPartHandOver) =>
      stage !== null || label !== null || '{path} needs a stage or a label.'
  )
);

const ComparisonParts = Items(ComparisonPart, L.evidenceParts, 2).check(
  Schema.makeFilter((parts: ReadonlyArray<ComparisonPartHandOver>) => {
    const names = parts.map((part) => part.label ?? part.stage);
    return (
      new Set(names).size === names.length ||
      'Each part needs its own stage or label; two parts are named the same.'
    );
  })
);

const CheckLinkInput = HandOverRecord({
  check: Required(L.checkId),
  detail: OptionalText(L.evidenceDetail),
  replaces: EvidenceRefs,
});

const CHECK_LINK_LEAVES = ['path', 'url', 'text', 'parts', 'stage', 'width', 'theme', 'key'] as const;

const COMPARISON_LEAVES = ['path', 'url', 'text', 'stage'] as const;

function isGiven(value: unknown) {
  return value !== undefined && value !== null;
}

function isLinkedKind(kind: EvidenceItemKind): kind is LinkedEvidenceKind {
  return kind === 'test' || kind === 'check';
}

function resolveFacts(facts: typeof EvidenceFactsInput.Type) {
  return { ...facts, replaces: [...new Set(facts.replaces)] };
}

function resolveSource({ path, url, text }: typeof PieceInput.Type): EvidenceSource {
  if (path !== null) return { path };
  return url !== null ? { url } : { text: text ?? '' };
}

export function validateEvidence(input: Record<string, unknown>): Validation<EvidenceHandOver> {
  const reader = new HandOverReader();
  const kind = reader.read(EvidenceKindInput, input.kind, ['kind']);
  if (isLinkedKind(kind)) {
    const given = CHECK_LINK_LEAVES.filter((field) => isGiven(input[field]));
    if (given.length > 0) {
      reader.refuse(
        `A test or check run is a check Shinsa runs: give \`check\`, its id, and leave out ${given.join(', ')}. Add the command with \`check_changes\` first when it is not a check yet.`
      );
    }
    const link = reader.read(CheckLinkInput, input, []);
    return reader.result<EvidenceHandOver>({ kind, ...link, replaces: [...new Set(link.replaces)] });
  }
  if (isGiven(input.check)) reader.refuse('check is only for kind test or check.');
  if (kind === 'comparison') {
    const facts = resolveFacts(reader.read(EvidenceFactsInput, input, []));
    const parts = reader.read(ComparisonParts, input.parts, ['parts']);
    if (COMPARISON_LEAVES.some((field) => isGiven(input[field]))) {
      reader.refuse('A comparison takes its files in parts: leave out path, url, text and stage.');
    }
    return reader.result<EvidenceHandOver>({ kind, ...facts, parts });
  }
  if (isGiven(input.parts)) reader.refuse('parts is only for kind comparison.');
  const facts = resolveFacts(reader.read(EvidenceFactsInput, input, []));
  const piece = reader.read(PieceInput, input, []);
  return reader.result<EvidenceHandOver>({
    kind,
    ...facts,
    stage: piece.stage,
    source: resolveSource(piece),
  });
}

export function validateEvidenceRemoval(input: Record<string, unknown>): Validation<EvidenceRemovalHandOver> {
  const reader = new HandOverReader();
  const items = [...new Set(reader.read(EvidenceRefs, input.items, ['items']))];
  if (items.length === 0 && reader.errors.length === 0) reader.refuse('items names no evidence.');
  return reader.result({ items, reason: reader.read(Required(L.evidenceReason), input.reason, ['reason']) });
}

const WaitInput = HandOverRecord({
  check_in_minutes: CountUpTo(L.waitCheckMinutes),
  notes: Required(L.waitNotes),
  timeout_minutes: OrAbsent(CountUpTo(L.waitTimeoutMinutes)),
  max_attempts: OrAbsent(CountUpTo(L.waitAttempts)),
});

export function validateWait(input: Record<string, unknown>): Validation<WaitHandOver> {
  const reader = new HandOverReader();
  const wait = reader.read(WaitInput, input, []);
  return reader.result({
    checkInMinutes: wait.check_in_minutes,
    notes: wait.notes,
    timeoutMinutes: wait.timeout_minutes,
    maxAttempts: wait.max_attempts,
  });
}

const SuggestionsInput = Items(
  HandOverRecord({
    title: Required(L.suggestionTitle),
    request: Required(L.suggestionRequest),
    why: Required(L.suggestionWhy),
    after_this: Flag,
    split_off: Flag,
  }),
  L.suggestions,
  1
);

export function validateSuggestions(input: Record<string, unknown>): Validation<SuggestedTask[]> {
  const reader = new HandOverReader();
  const tasks = reader.read(SuggestionsInput, input.tasks, ['tasks']);
  return reader.result(
    tasks.map(({ title, request, why, after_this, split_off }) => ({
      title,
      request,
      why,
      waitsOnThis: after_this,
      ...(split_off ? { splitOff: true } : {}),
    }))
  );
}

const MemoryProposalInput = HandOverRecord({
  scope: OneOf(MEMORY_SCOPES),
  text: Required(MEMORY_LIMITS.text),
  why: Required(MEMORY_LIMITS.why),
});

export function validateMemoryProposal(
  input: Record<string, unknown>
): Validation<{ scope: MemoryScope; text: string; why: string }> {
  const reader = new HandOverReader();
  return reader.result(reader.read(MemoryProposalInput, input, []));
}

const FeedbackNote = Required(FEEDBACK_LIMITS.note);

export function validateFeedbackReport(input: Record<string, unknown>): Validation<{ note: string }> {
  const reader = new HandOverReader();
  return reader.result({ note: reader.read(FeedbackNote, input.feedback, ['feedback']) });
}

export interface DeliveryHandOver {
  body: string;
  reply: AgentReply | null;
  proposal: ChangeProposalInput | null;
}

const Proposal = OrAbsent(
  HandOverRecord({ request: Required(SHAPE_LIMITS.request), why: Required(SHAPE_LIMITS.why) })
);

const DELIVERY_FIELD: Record<
  DeliveringStep,
  { field: string; body: ReturnType<typeof Required>; proposes: boolean }
> = {
  answer: { field: 'answer', body: Required(SHAPE_LIMITS.answer), proposes: true },
  investigate: { field: 'diagnosis', body: Required(SHAPE_LIMITS.diagnosis), proposes: true },
  research: { field: 'report', body: Required(SHAPE_LIMITS.report), proposes: true },
  operate: { field: 'outcome', body: Required(SHAPE_LIMITS.outcome), proposes: false },
};

export function validateDelivery(
  step: DeliveringStep,
  input: Record<string, unknown>
): Validation<DeliveryHandOver> {
  const reader = new HandOverReader();
  const { field, body, proposes } = DELIVERY_FIELD[step];
  return reader.result({
    body: reader.read(body, input[field], [field]),
    reply: resolveReply(reader.read(ReplyInput, input.reply, ['reply'])),
    proposal: proposes ? reader.read(Proposal, input.propose_change, ['propose_change']) : null,
  });
}

type ReshapeHandOver = { reason: string } & ({ shape: InquiryShape } | { steps: PipelineStep[] });

const PIPELINE_STEP_NAMES = COMPOSABLE_STEPS as readonly [PipelineStep, ...PipelineStep[]];

const INQUIRY_SHAPES: readonly [InquiryShape, ...InquiryShape[]] = ['answer', 'investigate', 'research'];

const ShapeReshape = HandOverRecord({ shape: OneOf(INQUIRY_SHAPES), reason: Required(SHAPE_LIMITS.reason) });

const StepsReshape = HandOverRecord({
  steps: Items(OneOf(PIPELINE_STEP_NAMES), COMPOSABLE_STEPS.length, 1),
  reason: Required(SHAPE_LIMITS.reason),
});

export function validateReshape(input: Record<string, unknown>): Validation<ReshapeHandOver> {
  const reader = new HandOverReader();
  if (input.steps !== undefined && input.shape !== undefined)
    reader.refuse('Give either shape or steps, not both.');
  if (input.steps === undefined) return reader.result(reader.read(ShapeReshape, input, []));
  return reader.result(reader.read(StepsReshape, input, []));
}
