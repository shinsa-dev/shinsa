import type { Attention, PlanDocument, ReportCheck, WorkReport } from './types.ts';

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

export function serializeReportMarkdown(report: WorkReport) {
  return [
    report.headline,
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
      bulletList(report.judgementCalls.map((call) => `**${call.call}** ${call.reason}`))
    ),
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
