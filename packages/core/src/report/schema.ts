import { Schema } from 'effect';
import type { InquiryShape } from '../commands/index.ts';
import { describeWholeSuiteRefusal, isWholeSuiteCommand } from '../domain/checks.ts';
import {
  COMPOSABLE_STEPS,
  DELEGATE_ROLES,
  type DelegateRole,
  DELEGATION_LIMITS,
  type DelegationIsolation,
  type DelegationMode,
  type DeliveringStep,
  EVIDENCE_KINDS,
  EVIDENCE_STAGES,
  EVIDENCE_THEMES,
  FEEDBACK_LIMITS,
  isEvidenceKey,
  MEMORY_LIMITS,
  MEMORY_SCOPES,
  type PipelineStep,
  PLAN_EVIDENCE_KINDS,
  SHAPE_LIMITS,
  WATCHDOG_SETTING_LIMITS,
} from '../domain/index.ts';
import { Salvaged, SalvagedItems, SalvagedOrNull, SalvagedOrOmitted } from '../domain/salvage.ts';
import type { Evidence, EvidenceItemKind, TaskStage } from '../domain/types.ts';
import {
  CountUpTo,
  EndAfter,
  Flag,
  HandOverRecord,
  Items,
  LineNumber,
  ListOrRecord,
  OneOf,
  OptionalOneOf,
  OptionalText,
  OptionalWholeRecord,
  OrAbsent,
  OrOmitted,
  ReadWhen,
  Required,
  TextList,
} from './reading.ts';
import { isWebUrl, MANUAL_TEST_TARGETS, parseTestFile } from './testing.ts';
import type {
  Attention,
  CheckChangeAction,
  CheckChangeHandOver,
  ComparisonPartHandOver,
  ManualTestTarget,
  ManualTestTargetKind,
  MergeStep,
  MergeStepKind,
  MergeStepTiming,
  ReplyOutcome,
  ReportCheck,
  ReviewFinding,
  WatchdogStart,
  WorkReport,
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

const L = PROTOCOL_LIMITS;

const OptionalLine = OrAbsent(LineNumber);

export const Spot = HandOverRecord({
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

export const JudgementCallInput = HandOverRecord({
  line: OptionalLine,
  end: OptionalLine,
  alternatives: Items(Alternative, L.alternatives),
  title: Required(L.callTitle),
  call: Required(L.call),
  reason: Required(L.reason),
  file: OptionalText(L.path),
}).check(EndAfter('line'));

export const Risk = HandOverRecord({
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

export const Testing = ListOrRecord(
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

export const Watchdog = HandOverRecord({
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

export const Walkthrough = OrAbsent(
  HandOverRecord({
    approach: Required(L.walkthroughApproach),
    flow: Required(L.flow),
    risks: Items(Risk, L.risks),
    testing: OrAbsent(Testing),
    steps: OrAbsent(MergeSteps),
  })
);

export const WalkthroughRevision = OptionalWholeRecord(
  {
    approach: OrAbsent(Required(L.walkthroughApproach)),
    flow: OrAbsent(Required(L.flow)),
    risks: OrAbsent(Items(Risk, L.risks)),
    testing: OrAbsent(Testing),
    steps: OrAbsent(MergeSteps),
  },
  Schema.makeFilter(
    (revision: { readonly [key: string]: unknown }) =>
      Object.values(revision).some((part) => part !== null) ||
      'walkthrough needs at least one of approach, flow, risks, testing or steps. Leave it out when the fix changes none of them. Watchdogs go in watchdogs, beside walkthrough.'
  )
);

const CheckCommand = Required(L.checkCommand).check(
  Schema.makeFilter(
    (command: string) => !isWholeSuiteCommand(command) || describeWholeSuiteRefusal('{path}', command)
  )
);

const UniquePhases = Schema.makeFilter(
  (numbers: ReadonlyArray<number>) =>
    new Set(numbers).size === numbers.length || '{path} names a phase twice.'
);

const PHASE_NUMBERS = Array.from({ length: L.planPhases }, (_, index) =>
  Items(CountUpTo(index + 1), L.planPhases, 1).check(UniquePhases)
);

const AnyPhaseNumbers = Items(CountUpTo(L.planPhases), L.planPhases, 1).check(UniquePhases);

export const CheckChangeInput = HandOverRecord({
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

export const ReplyInput = OrAbsent(
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

export const PhaseHandOverInput = HandOverRecord({
  summary: Required(L.phaseSummary),
  spots: Items(Spot, L.spots),
  judgement_calls: Items(JudgementCallInput, L.judgementCalls),
  reply: ReplyInput,
  walkthrough: Walkthrough,
  watchdogs: OrAbsent(Watchdogs),
  check_changes: CheckChanges,
});

export const EvidenceRefs = TextList(L.evidenceItems, L.evidenceKey);

export const FixHandOverInput = HandOverRecord({
  summary: Required(L.phaseSummary),
  reply: ReplyInput,
  walkthrough: WalkthroughRevision,
  watchdogs: OrAbsent(Watchdogs),
  checks: TextList(L.checks, L.checkId),
  check_changes: CheckChanges,
  evidence_kept: EvidenceRefs,
});

export const PlanOutline = HandOverRecord({
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

const UniqueCommands = Schema.makeFilter((checks: ReadonlyArray<{ command: string }>) => {
  const commands = checks.map((check) => check.command);
  return new Set(commands).size === commands.length || 'verification lists a command twice.';
});

export const AnyPlanChecks = Items(
  HandOverRecord({ label: Required(L.checkLabel), command: CheckCommand, phases: AnyPhaseNumbers }),
  L.checks
).check(UniqueCommands);

export const PLAN_CHECKS = PHASE_NUMBERS.map((phases) =>
  Items(HandOverRecord({ label: Required(L.checkLabel), command: CheckCommand, phases }), L.checks).check(
    UniqueCommands
  )
);

export const PlanParameters = HandOverRecord({
  operation: OrOmitted(TextList(L.planPhases, L.listItem)),
  impact: OptionalText(L.impact),
  evidence: Items(OneOf(PLAN_EVIDENCE_KINDS), PLAN_EVIDENCE_KINDS.length).check(
    Schema.makeFilter(
      (kinds: ReadonlyArray<string>) => new Set(kinds).size === kinds.length || 'evidence names a kind twice.'
    )
  ),
  approval: Flag,
});

const Finding = HandOverRecord({
  line: OptionalLine,
  end: OptionalLine,
  title: OptionalText(L.findingTitle),
  fix: OptionalText(L.findingFix),
  severity: OneOf(FINDING_SEVERITIES),
  file: OptionalText(L.path),
  message: Required(L.finding),
}).check(EndAfter('line'));

export const ReviewInput = HandOverRecord({
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

export const PlanReply = HandOverRecord({ reply: ReplyInput });

export const QuestionInput = HandOverRecord({
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

export const EvidenceKindInput = OneOf(ATTACHED_EVIDENCE_KINDS);

export const EvidenceFactsInput = HandOverRecord({
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

export const PieceInput = HandOverRecord({
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

export const ComparisonParts = Items(ComparisonPart, L.evidenceParts, 2).check(
  Schema.makeFilter((parts: ReadonlyArray<ComparisonPartHandOver>) => {
    const names = parts.map((part) => part.label ?? part.stage);
    return (
      new Set(names).size === names.length ||
      'Each part needs its own stage or label; two parts are named the same.'
    );
  })
);

export const CheckLinkInput = HandOverRecord({
  check: Required(L.checkId),
  detail: OptionalText(L.evidenceDetail),
  replaces: EvidenceRefs,
});

export const CHECK_LINK_LEAVES = ['path', 'url', 'text', 'parts', 'stage', 'width', 'theme', 'key'] as const;

export const COMPARISON_LEAVES = ['path', 'url', 'text', 'stage'] as const;

export const EvidenceReason = Required(L.evidenceReason);

export const WaitInput = HandOverRecord({
  check_in_minutes: CountUpTo(L.waitCheckMinutes),
  notes: Required(L.waitNotes),
  timeout_minutes: OrAbsent(CountUpTo(L.waitTimeoutMinutes)),
  max_attempts: OrAbsent(CountUpTo(L.waitAttempts)),
});

export const SuggestionsInput = Items(
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

export const MemoryProposalInput = HandOverRecord({
  scope: OneOf(MEMORY_SCOPES),
  text: Required(MEMORY_LIMITS.text),
  why: Required(MEMORY_LIMITS.why),
});

export const FeedbackNote = Required(FEEDBACK_LIMITS.note);

export const Proposal = OrAbsent(
  HandOverRecord({ request: Required(SHAPE_LIMITS.request), why: Required(SHAPE_LIMITS.why) })
);

export const DELIVERY_FIELD: Record<
  DeliveringStep,
  { field: string; body: ReturnType<typeof Required>; proposes: boolean }
> = {
  answer: { field: 'answer', body: Required(SHAPE_LIMITS.answer), proposes: true },
  investigate: { field: 'diagnosis', body: Required(SHAPE_LIMITS.diagnosis), proposes: true },
  research: { field: 'report', body: Required(SHAPE_LIMITS.report), proposes: true },
  operate: { field: 'outcome', body: Required(SHAPE_LIMITS.outcome), proposes: false },
};

const PIPELINE_STEP_NAMES = COMPOSABLE_STEPS as readonly [PipelineStep, ...PipelineStep[]];

const INQUIRY_SHAPES: readonly [InquiryShape, ...InquiryShape[]] = ['answer', 'investigate', 'research'];

export const ShapeReshape = HandOverRecord({
  shape: OneOf(INQUIRY_SHAPES),
  reason: Required(SHAPE_LIMITS.reason),
});

export const StepsReshape = HandOverRecord({
  steps: Items(OneOf(PIPELINE_STEP_NAMES), COMPOSABLE_STEPS.length, 1),
  reason: Required(SHAPE_LIMITS.reason),
});

export const REVIEW_PAYLOAD_VERSION = 1;

export const REVIEW_EVIDENCE_KINDS = [
  'screenshot',
  'recording',
  'preview',
] as const satisfies readonly Evidence['kind'][];

const CHECK_OUTCOMES = ['pass', 'fail', 'skipped'] as const satisfies readonly ReportCheck['outcome'][];

const TEST_TARGETS = ['url', 'file', 'command', 'screen'] as const satisfies readonly ManualTestTargetKind[];

export const REVIEW_PAYLOAD_STAGES = [
  'shipping',
  'awaiting_merge',
  'merged',
  'done',
] as const satisfies readonly TaskStage[];

export type ReviewEvidenceKind = (typeof REVIEW_EVIDENCE_KINDS)[number];

export type ReviewPayloadStage = (typeof REVIEW_PAYLOAD_STAGES)[number];

const REPO_NAME = /^[\w.-]{1,100}$/;

export const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

const BRANCH_NAME = /^[\w./-]{1,200}$/;

export const GITHUB_ATTACHMENT =
  /^https:\/\/(?:github\.com\/user-attachments\/|[a-z0-9-]+\.githubusercontent\.com\/)/;

const Filled = Schema.NonEmptyString;

const Absent = Salvaged(Schema.Null, () => null);

const NoSpots = Salvaged(Schema.mutable(Schema.Tuple([])), (): [] => []);

const ReviewCheck = Schema.Struct({
  id: Filled,
  label: Filled,
  command: Schema.String,
  outcome: Schema.Literals(CHECK_OUTCOMES),
  detail: Absent,
});

const ReviewCall = Schema.Struct({
  title: Filled,
  call: Filled,
  reason: Salvaged(Schema.String, () => ''),
  file: Absent,
  line: Absent,
  end: Absent,
  alternatives: SalvagedItems(Schema.Struct({ option: Filled, rejected: Filled })),
});

const ReviewRisk = Schema.Struct({
  title: Filled,
  risk: Filled,
  file: Absent,
  line: Absent,
  end: Absent,
});

const ReviewStep = Schema.Struct({
  action: Filled,
  expect: Filled,
  target: SalvagedOrNull(Schema.Struct({ kind: Schema.Literals(TEST_TARGETS), value: Filled })),
});

const ReviewWalkthrough = Schema.Struct({
  approach: Salvaged(Schema.String, () => ''),
  flow: Salvaged(Schema.String, () => ''),
  risks: SalvagedItems(ReviewRisk),
  testing: Salvaged(
    Schema.Struct({ automated: SalvagedItems(Schema.String), manual: SalvagedItems(ReviewStep) }),
    () => ({ automated: [], manual: [] })
  ),
});

const ReviewReport = Schema.Struct({
  headline: Salvaged(Schema.String, () => ''),
  sections: SalvagedItems(Schema.Struct({ title: Filled, summary: Filled, spots: NoSpots })),
  checks: SalvagedItems(ReviewCheck),
  judgementCalls: SalvagedItems(ReviewCall),
  walkthrough: SalvagedOrNull(ReviewWalkthrough),
});

export const ReviewPayloadEvidence = Schema.Struct({
  id: Filled,
  itemId: Filled,
  kind: Schema.Literals(REVIEW_EVIDENCE_KINDS),
  title: Filled,
  url: Schema.String.check(Schema.isPattern(GITHUB_ATTACHMENT)),
  detail: SalvagedOrNull(Schema.String),
  width: SalvagedOrNull(Schema.Finite),
  theme: SalvagedOrNull(Schema.Literals(EVIDENCE_THEMES)),
  stage: SalvagedOrNull(Schema.Literals(EVIDENCE_STAGES)),
  label: SalvagedOrNull(Schema.String),
});

export type ReviewPayloadEvidence = typeof ReviewPayloadEvidence.Type;

const ReviewCoverage = Schema.Struct({
  covered: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  executable: Schema.Finite,
}).check(Schema.makeFilter(({ covered, executable }) => covered <= executable));

const ReviewFindingSchema = Schema.Struct({
  severity: Schema.Literals(FINDING_SEVERITIES),
  file: Absent,
  line: Absent,
  title: SalvagedOrOmitted(Filled),
  message: Filled,
});

const ReviewVerdict = Schema.Struct({
  summary: Schema.String,
  findings: SalvagedItems(ReviewFindingSchema),
});

const ReviewTask = Schema.Struct({
  id: Filled,
  handle: SalvagedOrNull(Schema.String),
  title: Filled,
  summary: SalvagedOrNull(Schema.String),
  pullRequest: SalvagedOrNull(Schema.Int.check(Schema.isGreaterThan(0))),
  repo: SalvagedOrNull(Schema.String.check(Schema.isPattern(REPO_NAME))),
  slug: SalvagedOrNull(Schema.String.check(Schema.isPattern(REPO_SLUG))),
  branch: SalvagedOrNull(Schema.String.check(Schema.isPattern(BRANCH_NAME))),
  coverage: SalvagedOrNull(ReviewCoverage),
  stage: Salvaged(Schema.Literals(REVIEW_PAYLOAD_STAGES), (): ReviewPayloadStage => 'shipping'),
  startedAt: SalvagedOrNull(Schema.Finite),
});

export const ReviewPayload = Schema.Struct({
  v: Schema.Literal(REVIEW_PAYLOAD_VERSION),
  task: ReviewTask,
  report: ReviewReport,
  evidence: SalvagedItems(ReviewPayloadEvidence),
  review: SalvagedOrNull(ReviewVerdict),
});

export type ReviewPayload = Omit<typeof ReviewPayload.Type, 'report'> & { report: WorkReport };

export type ReviewPayloadCoverage = typeof ReviewCoverage.Type;

export type ReviewPayloadVerdict = typeof ReviewVerdict.Type;

const ROLES = DELEGATE_ROLES as readonly [DelegateRole, ...DelegateRole[]];

export const DELEGATION_MODES: readonly [DelegationMode, ...DelegationMode[]] = ['async', 'wait'];

export const DELEGATION_ISOLATIONS: readonly [DelegationIsolation, ...DelegationIsolation[]] = [
  'shared',
  'worktree',
];

const RequestKey = OptionalText(DELEGATION_LIMITS.requestKey);

export const DelegationRequestInput = HandOverRecord({
  brief: Required(DELEGATION_LIMITS.brief),
  title: OptionalText(DELEGATION_LIMITS.title),
  role: OrAbsent(OneOf(ROLES)),
  mode: OrAbsent(OneOf(DELEGATION_MODES)),
  isolation: OrAbsent(OneOf(DELEGATION_ISOLATIONS)),
  timeout_minutes: OrAbsent(CountUpTo(DELEGATION_LIMITS.maxWaitMinutes)),
  client_request_id: RequestKey,
  provider: OptionalText(DELEGATION_LIMITS.name),
  model: OptionalText(DELEGATION_LIMITS.name),
});

export const DelegationId = Required(DELEGATION_LIMITS.name);

export const DelegationAnswerInput = HandOverRecord({
  delegation_id: DelegationId,
  answer: Required(DELEGATION_LIMITS.answer),
});

export const CourierTaskInput = HandOverRecord({
  request: Required(PROTOCOL_LIMITS.suggestionRequest),
  client_request_id: RequestKey,
  repository: OptionalText(DELEGATION_LIMITS.name),
  new_repository: Flag,
  project: OptionalText(DELEGATION_LIMITS.name),
  fork_from: OptionalText(DELEGATION_LIMITS.name),
  this_task_waits: Flag,
  after_this: Flag,
  stack_on_this: Flag,
  stack_on: TextList(DELEGATION_LIMITS.stackOn, DELEGATION_LIMITS.name),
  backlog: Flag,
});

export const SplitInput = HandOverRecord({
  tasks: Items(
    HandOverRecord({ request: Required(PROTOCOL_LIMITS.suggestionRequest) }),
    DELEGATION_LIMITS.splitTasks,
    1
  ),
  this_task_waits: Flag,
});
