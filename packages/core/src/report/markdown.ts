import { parseTestFile, serializeTestFile } from './testing.ts';
import type {
  Attention,
  ManualTestStep,
  ManualTestTarget,
  ManualTestTargetKind,
  MergeStep,
  MergeStepTiming,
  PlanDocument,
  ReportCheck,
  ReportTesting,
  WorkReport,
} from './types.ts';

const CHECK_MARK: Record<ReportCheck['outcome'], string> = { pass: '✓', fail: '✗', skipped: '–' };

const ATTENTION_RANK: Record<Attention, number> = { critical: 0, high: 1, normal: 2 };

function bulletList(items: string[]) {
  return items.map((item) => `- ${item}`).join('\n');
}

function describeSection(heading: string, body: string) {
  return body ? `${heading}\n${body}` : '';
}

export function serializePlanMarkdown(plan: PlanDocument) {
  return [
    `## Goal\n${plan.goal}`,
    describeSection(
      '## Plan',
      plan.phases.map((phase, index) => `${index + 1}. **${phase.title}**: ${phase.detail}`).join('\n')
    ),
    describeSection('## Behaviour', bulletList(plan.behaviour)),
    `## Approach\n${plan.approach}`,
    describeSection('## Files', bulletList(plan.files.map((file) => `\`${file.path}\`: ${file.change}`))),
    describeSection('## Out of scope', bulletList(plan.outOfScope)),
    describeSection('## Verification', bulletList(plan.verification)),
    describeSection('## Evidence', (plan.evidence ?? []).join(', ')),
    describeSection('## Extra checks', bulletList((plan.checks ?? []).map((command) => `\`${command}\``))),
    describeSection(
      '## Operation',
      (plan.operation ?? []).map((step, index) => `${index + 1}. ${step}`).join('\n')
    ),
    describeSection('## Impact', plan.impact ?? ''),
    describeSection(
      '## Questions',
      bulletList(
        plan.questions.map((question) =>
          question.options.length > 0
            ? `${question.question} (${question.options.join(' / ')})`
            : question.question
        )
      )
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
}

const MERGE_STEP_HEADING: Record<MergeStepTiming, string> = {
  pre_merge: '### Pre-merge steps',
  post_merge: '### Post-merge steps',
};

function describeMergeStep(step: MergeStep) {
  const line = `- [ ] **${step.title}**: ${step.detail}`;
  if (!step.command) return line;
  return [line, '  ```sh', ...step.command.split('\n').map((text) => `  ${text}`), '  ```'].join('\n');
}

export function serializeMergeStepsMarkdown(steps: readonly MergeStep[]) {
  return (['pre_merge', 'post_merge'] as const)
    .map((when) =>
      describeSection(
        MERGE_STEP_HEADING[when],
        steps
          .filter((step) => step.when === when)
          .map(describeMergeStep)
          .join('\n')
      )
    )
    .filter(Boolean)
    .join('\n\n');
}

const STEP_INDENT = '   ';

const TEST_TARGET_MARKDOWN: Record<ManualTestTargetKind, (value: string) => string> = {
  url: (value) => `<${value}>`,
  file: (value) => {
    const file = parseTestFile(value);
    return `\`${file ? serializeTestFile(file) : value}\``;
  },
  command: (value) => `\`${value}\``,
  screen: (value) => `*${value}*`,
};

function describeTestTarget(target: ManualTestTarget) {
  if (target.kind === 'command' && /[\n`]/.test(target.value)) {
    return [
      '',
      `${STEP_INDENT}\`\`\`sh`,
      ...target.value.split('\n').map((text) => `${STEP_INDENT}${text}`),
      `${STEP_INDENT}\`\`\``,
    ].join('\n');
  }
  return ` ${TEST_TARGET_MARKDOWN[target.kind](target.value)}`;
}

function describeManualStep(step: ManualTestStep, index: number) {
  const action = step.target ? `${step.action.replace(/[.:]$/, '')}:` : step.action;
  const target = step.target ? describeTestTarget(step.target) : '';
  return `${index + 1}. ${action}${target}\n${STEP_INDENT}Expected: ${step.expect}`;
}

export function serializeTestingMarkdown(testing: ReportTesting | null | undefined) {
  const parts = [
    describeSection('**Covered by tests**', bulletList(testing?.automated ?? [])),
    describeSection('**Try it yourself**', (testing?.manual ?? []).map(describeManualStep).join('\n')),
  ].filter(Boolean);
  return describeSection('### How to test', parts.join('\n\n'));
}

export function serializeReportMarkdown(report: WorkReport) {
  return [
    report.headline,
    describeSection('### How it works', report.walkthrough?.approach ?? ''),
    describeSection(
      '### What changed',
      bulletList(report.sections.map((section) => `**${section.title}**: ${section.summary}`))
    ),
    describeSection(
      '### Checks',
      bulletList(report.checks.map((check) => `${CHECK_MARK[check.outcome]} ${check.name}`))
    ),
    describeSection(
      '### Judgement calls',
      bulletList(report.judgementCalls.map((call) => `**${call.title}**: ${call.call}. ${call.reason}`))
    ),
    serializeTestingMarkdown(report.walkthrough?.testing),
    serializeMergeStepsMarkdown(report.walkthrough?.steps ?? []),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function listRankedSpots(report: WorkReport) {
  return report.sections
    .flatMap((section, sectionIndex) =>
      section.spots.map((spot, spotIndex) => ({ spot, sectionIndex, spotIndex }))
    )
    .sort(
      (a, b) =>
        ATTENTION_RANK[a.spot.attention] - ATTENTION_RANK[b.spot.attention] ||
        a.sectionIndex - b.sectionIndex ||
        a.spotIndex - b.spotIndex
    );
}
