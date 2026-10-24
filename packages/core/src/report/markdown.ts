import type { Attention, ReportCheck, PlanDocument, WorkReport } from './types.ts';

const CHECK_MARK: Record<ReportCheck['outcome'], string> = { pass: '✓', fail: '✗', skipped: '–' };

const ATTENTION_RANK: Record<Attention, number> = { critical: 0, high: 1, normal: 2 };

function bulletList(items: string[]) {
  return items.map((item) => `- ${item}`).join('\n');
}

function section(heading: string, body: string) {
  return body ? `${heading}\n${body}` : '';
}

export function serializePlanMarkdown(plan: PlanDocument) {
  return [
    `## Goal\n${plan.goal}`,
    section(
      '## Plan',
      plan.phases.map((phase, index) => `${index + 1}. **${phase.title}**: ${phase.detail}`).join('\n')
    ),
    section('## Behaviour', bulletList(plan.behaviour)),
    `## Approach\n${plan.approach}`,
    section('## Files', bulletList(plan.files.map((file) => `\`${file.path}\`: ${file.change}`))),
    section('## Out of scope', bulletList(plan.outOfScope)),
    section('## Verification', bulletList(plan.verification)),
    section('## Evidence', (plan.evidence ?? []).join(', ')),
    section('## Extra checks', bulletList((plan.checks ?? []).map((command) => `\`${command}\``))),
    section('## Operation', (plan.operation ?? []).map((step, index) => `${index + 1}. ${step}`).join('\n')),
    section('## Impact', plan.impact ?? ''),
    section(
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
    section(
      '### What changed',
      bulletList(report.sections.map((section) => `**${section.title}**: ${section.summary}`))
    ),
    section(
      '### Checks',
      bulletList(report.checks.map((check) => `${CHECK_MARK[check.outcome]} ${check.name}`))
    ),
    section(
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
