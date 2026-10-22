import type { Attention, ReportCheck, SpecDocument, WorkReport } from './types.ts';

const CHECK_MARK: Record<ReportCheck['outcome'], string> = { pass: '✓', fail: '✗', skipped: '–' };

const ATTENTION_RANK: Record<Attention, number> = { critical: 0, high: 1, normal: 2 };

function bulletList(items: string[]) {
  return items.map((item) => `- ${item}`).join('\n');
}

function section(heading: string, body: string) {
  return body ? `${heading}\n${body}` : '';
}

export function serializeSpecMarkdown(spec: SpecDocument) {
  return [
    `## Goal\n${spec.goal}`,
    section(
      '## Plan',
      spec.plan.map((step, index) => `${index + 1}. **${step.title}**: ${step.detail}`).join('\n')
    ),
    section('## Behaviour', bulletList(spec.behaviour)),
    `## Approach\n${spec.approach}`,
    section('## Files', bulletList(spec.files.map((file) => `\`${file.path}\`: ${file.change}`))),
    section('## Out of scope', bulletList(spec.outOfScope)),
    section('## Verification', bulletList(spec.verification)),
    section(
      '## Questions',
      bulletList(
        spec.questions.map((question) =>
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
      bulletList(report.phases.map((phase) => `**${phase.title}**: ${phase.summary}`))
    ),
    section(
      '### Checks',
      bulletList(report.checks.map((check) => `${CHECK_MARK[check.outcome]} ${check.name}`))
    ),
    section(
      '### Decisions',
      bulletList(report.decisions.map((decision) => `**${decision.decision}** ${decision.reason}`))
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function listRankedSpots(report: WorkReport) {
  return report.phases
    .flatMap((phase, phaseIndex) => phase.spots.map((spot, spotIndex) => ({ spot, phaseIndex, spotIndex })))
    .sort(
      (a, b) =>
        ATTENTION_RANK[a.spot.attention] - ATTENTION_RANK[b.spot.attention] ||
        a.phaseIndex - b.phaseIndex ||
        a.spotIndex - b.spotIndex
    );
}
