import type { ChangeProposalInput, InquiryShape } from '../commands/index.ts';
import type {
  DeliveringStep,
  MemoryScope,
  PipelineStep,
  ProposalRecommendation,
  SuggestedAction,
} from '../domain/index.ts';
import type { EvidenceItemKind } from '../domain/types.ts';
import { HandOverReader, type Validation } from './reading.ts';
import {
  ActionsInput,
  AnyPlanChecks,
  CHECK_LINK_LEAVES,
  type CheckChangeInput,
  CheckLinkInput,
  COMPARISON_LEAVES,
  ComparisonParts,
  DELIVERY_FIELD,
  EvidenceFactsInput,
  EvidenceKindInput,
  EvidenceReason,
  EvidenceRefs,
  FeedbackNote,
  FixHandOverInput,
  type JudgementCallInput,
  MemoryProposalInput,
  PhaseHandOverInput,
  PieceInput,
  PLAN_CHECKS,
  PlanOutline,
  PlanParameters,
  PlanReply,
  Proposal,
  QuestionInput,
  Recommendation,
  ReplyInput,
  ReviewInput,
  type Risk,
  ShapeReshape,
  type Spot,
  StepsReshape,
  SuggestionsInput,
  type Testing,
  WaitInput,
  type Walkthrough,
  type WalkthroughRevision,
  type Watchdog,
} from './schema.ts';
import { createTesting } from './testing.ts';
import type {
  AgentReply,
  CheckChangeHandOver,
  CodeSpot,
  EvidenceHandOver,
  EvidenceRemovalHandOver,
  EvidenceSource,
  FixHandOver,
  JudgementCall,
  LinkedEvidenceKind,
  PhaseHandOver,
  PlanDocument,
  PlanHandOver,
  QuestionHandOver,
  ReportRisk,
  ReportTesting,
  ReportWalkthrough,
  ReportWalkthroughRevision,
  ReviewHandOver,
  SuggestedTask,
  WaitHandOver,
  WatchdogSpec,
} from './types.ts';

export type { Validation } from './reading.ts';

function resolvePhaseNumbers(numbers: ReadonlyArray<number>) {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

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

function resolveReportRisk({ title, risk, file, line, end }: typeof Risk.Type): ReportRisk {
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

function resolveWatchdogs(
  watchdogs: (typeof Watchdog.Type)[] | null,
  empty: boolean
): Pick<ReportWalkthrough, 'watchdogs'> {
  return watchdogs !== null && (watchdogs.length > 0 || empty)
    ? { watchdogs: watchdogs.map(resolveWatchdog) }
    : {};
}

function resolveWalkthrough(
  reader: HandOverReader,
  walkthrough: typeof Walkthrough.Type,
  watchdogs: (typeof Watchdog.Type)[] | null
): ReportWalkthrough | null {
  if (walkthrough === null) {
    if (watchdogs !== null) {
      reader.refuse('watchdogs go on the last phase, with its walkthrough: send both together.');
    }
    return null;
  }
  return {
    approach: walkthrough.approach,
    flow: walkthrough.flow,
    risks: walkthrough.risks.map(resolveReportRisk),
    testing: resolveTesting(walkthrough.testing),
    ...(walkthrough.steps !== null && walkthrough.steps.length > 0 ? { steps: walkthrough.steps } : {}),
    ...resolveWatchdogs(watchdogs, false),
  };
}

function resolveWalkthroughRevision(
  revision: typeof WalkthroughRevision.Type,
  watchdogs: (typeof Watchdog.Type)[] | null
): ReportWalkthroughRevision | null {
  if (revision === null && watchdogs === null) return null;
  return {
    ...(revision === null ? {} : resolveRevisedParts(revision)),
    ...resolveWatchdogs(watchdogs, true),
  };
}

function resolveRevisedParts(
  revision: NonNullable<typeof WalkthroughRevision.Type>
): ReportWalkthroughRevision {
  return {
    ...(revision.approach === null ? {} : { approach: revision.approach }),
    ...(revision.flow === null ? {} : { flow: revision.flow }),
    ...(revision.risks === null ? {} : { risks: revision.risks.map(resolveReportRisk) }),
    ...(revision.testing === null ? {} : { testing: resolveTesting(revision.testing) }),
    ...(revision.steps === null ? {} : { steps: revision.steps }),
  };
}

function resolveCheckChangeInput(change: typeof CheckChangeInput.Type): CheckChangeHandOver {
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
  path = 'watchdogs'
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

export function validatePhaseHandOver(input: Record<string, unknown>): Validation<PhaseHandOver> {
  const reader = new HandOverReader();
  const handOver = reader.read(PhaseHandOverInput, input, []);
  return reader.result({
    summary: handOver.summary,
    spots: handOver.spots.map(resolveSpot),
    judgementCalls: handOver.judgement_calls.map(resolveJudgementCall),
    reply: resolveReply(handOver.reply),
    actions: handOver.actions,
    walkthrough: resolveWalkthrough(reader, handOver.walkthrough, handOver.watchdogs),
    checkChanges: handOver.check_changes.map(resolveCheckChangeInput),
  });
}

export function validateFixHandOver(input: Record<string, unknown>): Validation<FixHandOver> {
  const reader = new HandOverReader();
  const handOver = reader.read(FixHandOverInput, input, []);
  return reader.result({
    summary: handOver.summary,
    reply: resolveReply(handOver.reply),
    actions: handOver.actions,
    walkthrough: resolveWalkthroughRevision(handOver.walkthrough, handOver.watchdogs),
    checks: [...new Set(handOver.checks)],
    checkChanges: handOver.check_changes.map(resolveCheckChangeInput),
    evidenceKept: [...new Set(handOver.evidence_kept)],
  });
}

function readPlanDocument(reader: HandOverReader, input: Record<string, unknown>): PlanDocument {
  const outline = reader.read(PlanOutline, input, []);
  const checks = PLAN_CHECKS[Math.max(1, outline.phases.length) - 1] ?? AnyPlanChecks;
  const verification = reader.read(checks, input.verification, ['verification']);
  const { operation, impact, evidence, approval, split } = reader.read(PlanParameters, input, []);
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
    ...(split.length > 0
      ? { split: split.map(({ on, ...part }) => (on === null ? part : { ...part, on })) }
      : {}),
  };
}

export function validateReview(input: Record<string, unknown>): Validation<ReviewHandOver> {
  const reader = new HandOverReader();
  const { summary, confidence, risk, findings, disagreements } = reader.read(ReviewInput, input, []);
  return reader.result({
    summary,
    ratings: { confidence, risk },
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

export function validatePlanHandOver(input: Record<string, unknown>): Validation<PlanHandOver> {
  const plan = new HandOverReader();
  const document = readPlanDocument(plan, input);
  const reader = new HandOverReader();
  const { reply, actions } = reader.read(PlanReply, input, []);
  if (plan.errors.length > 0) return { ok: false, errors: [...plan.errors, ...reader.errors] };
  return reader.result({ document, reply: resolveReply(reply), actions });
}

export function validateQuestion(input: Record<string, unknown>): Validation<QuestionHandOver> {
  const reader = new HandOverReader();
  return reader.result(reader.read(QuestionInput, input, []));
}

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
  return reader.result({ items, reason: reader.read(EvidenceReason, input.reason, ['reason']) });
}

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

export function validateSuggestions(input: Record<string, unknown>): Validation<SuggestedTask[]> {
  const reader = new HandOverReader();
  const tasks = reader.read(SuggestionsInput, input.tasks, ['tasks']);
  return reader.result(
    tasks.map(({ title, request, why, after_this, stack_on_this, split_off }) => ({
      title,
      request,
      why,
      waitsOnThis: after_this,
      ...(stack_on_this ? { stacksOnThis: true } : {}),
      ...(split_off ? { splitOff: true } : {}),
    }))
  );
}

export function validateMemoryProposal(
  input: Record<string, unknown>
): Validation<{ scope: MemoryScope; text: string; why: string }> {
  const reader = new HandOverReader();
  return reader.result(reader.read(MemoryProposalInput, input, []));
}

export function validateFeedbackReport(input: Record<string, unknown>): Validation<{ note: string }> {
  const reader = new HandOverReader();
  return reader.result({ note: reader.read(FeedbackNote, input.feedback, ['feedback']) });
}

export interface DeliveryHandOver {
  body: string;
  reply: AgentReply | null;
  proposal: ChangeProposalInput | null;
  recommend: ProposalRecommendation | null;
  actions: SuggestedAction[];
}

export function validateDelivery(
  step: DeliveringStep,
  input: Record<string, unknown>
): Validation<DeliveryHandOver> {
  const reader = new HandOverReader();
  const { field, body, proposes } = DELIVERY_FIELD[step];
  const proposal = proposes ? reader.read(Proposal, input.propose_change, ['propose_change']) : null;
  const recommend = proposes ? reader.read(Recommendation, input.recommend, ['recommend']) : null;
  if (proposal && recommend === 'close')
    reader.refuse('`recommend` is `close`, but `propose_change` proposes a change. Drop one of them.');
  return reader.result({
    body: reader.read(body, input[field], [field]),
    reply: resolveReply(reader.read(ReplyInput, input.reply, ['reply'])),
    actions: reader.read(ActionsInput, input.actions, ['actions']),
    proposal,
    recommend: proposal ? 'go_on' : recommend,
  });
}

type ReshapeHandOver = { reason: string } & ({ shape: InquiryShape } | { steps: PipelineStep[] });

export function validateReshape(input: Record<string, unknown>): Validation<ReshapeHandOver> {
  const reader = new HandOverReader();
  if (input.steps !== undefined && input.shape !== undefined)
    reader.refuse('Give either shape or steps, not both.');
  if (input.steps === undefined) return reader.result(reader.read(ShapeReshape, input, []));
  return reader.result(reader.read(StepsReshape, input, []));
}
