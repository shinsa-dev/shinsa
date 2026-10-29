import { listEvidenceItems } from '../domain/evidence.ts';
import { type Round, resolveCurrentRound, resolveTaskRounds } from '../domain/rounds.ts';
import type { Evidence, Task } from '../domain/types.ts';
import { assembleReport } from './assemble.ts';
import {
  bulletList,
  CHECK_MARK,
  CHECK_NOTE,
  describeSection,
  serializeMergeStepsMarkdown,
  serializeTestingMarkdown,
} from './markdown.ts';
import { listMergeSteps } from './merge-steps.ts';
import type { ReportCheck, WorkReport } from './types.ts';

export const PULL_REQUEST_BLOCK_START = '<!-- shinsa:start -->';

export const PULL_REQUEST_BLOCK_END = '<!-- shinsa:end -->';

const PULL_REQUEST_BODY_LIMIT = 65_536;

const SHINSA_SITE_URL = 'https://shinsa.dev';

const OPEN_TITLE_LIMIT = 120;

const LOCAL_HOST = /^https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(?:[:/]|$)/i;

const SHOWN_ATTENTION = new Set(['critical', 'high']);

const STAGE_WORDS: Record<NonNullable<Evidence['stage']>, string> = { before: 'Before', after: 'After' };

type EvidenceGroup = ReturnType<typeof listEvidenceItems>[number];

interface Section {
  text: string;
  drop: number;
}

export interface PullRequestSource {
  task: Task;
  evidence: readonly Evidence[];
  notes: Readonly<Record<string, string>>;
}

export function resolveShinsaTaskUrl(task: Pick<Task, 'id' | 'handle' | 'title'>) {
  const query = new URLSearchParams({ task: task.id });
  if (task.handle) query.set('handle', task.handle);
  query.set('title', task.title.slice(0, OPEN_TITLE_LIMIT));
  return `${SHINSA_SITE_URL}/open?${query}`;
}

function isPublicAddress(uri: string) {
  return /^https?:\/\//i.test(uri) && !LOCAL_HOST.test(uri);
}

export function resolvePublicUrl(evidence: Evidence) {
  if (evidence.uploadUrl) return evidence.uploadUrl;
  return isPublicAddress(evidence.uri) ? evidence.uri : null;
}

function listEarlierRounds(task: Task): Round[] {
  const number = task.pullRequest?.number;
  const current = resolveCurrentRound(task).number;
  if (number === undefined) return [];
  return resolveTaskRounds(task).filter(
    (round) => round.number < current && round.pullRequest?.number === number
  );
}

export function listPullRequestEvidence(task: Task, evidence: readonly Evidence[]) {
  const rounds = new Set([
    resolveCurrentRound(task).number,
    ...listEarlierRounds(task).map((round) => round.number),
  ]);
  return listEvidenceItems(
    evidence.filter((piece) => piece.taskId === task.id && rounds.has(piece.round ?? 1))
  ).filter((item) => item.kind !== 'test' && item.kind !== 'check');
}

function describeFacts(evidence: Evidence) {
  const facts = [evidence.width ? `${evidence.width}px` : '', evidence.theme ?? ''].filter(Boolean);
  return facts.length > 0 ? ` (${facts.join(', ')})` : '';
}

function describeHeading(item: EvidenceGroup) {
  const [first] = item.parts as [Evidence, ...Evidence[]];
  const detail = first.detail ? `\n\n${first.detail}` : '';
  return `**${item.title}**${describeFacts(first)}${detail}`;
}

function describePartLabel(part: Evidence, index: number) {
  if (part.label) return part.label;
  return part.stage ? STAGE_WORDS[part.stage] : `Part ${index + 1}`;
}

function describeUnpublished(item: EvidenceGroup, taskUrl: string) {
  const [first] = item.parts as [Evidence, ...Evidence[]];
  return `- **${item.title}**${describeFacts(first)}, a ${item.kind}: [open it in Shinsa](${taskUrl})`;
}

function describeMedia(part: Evidence, url: string) {
  if (part.kind === 'recording') return url;
  return `![${part.title}](${url})`;
}

function describeComparison(item: EvidenceGroup, urls: string[]) {
  if (item.parts.every((part) => part.kind === 'screenshot')) {
    const labels = item.parts.map(describePartLabel);
    const cells = urls.map((url, index) => `![${labels[index]}](${url})`);
    const table = [
      `| ${labels.join(' | ')} |`,
      `| ${labels.map(() => '---').join(' | ')} |`,
      `| ${cells.join(' | ')} |`,
    ];
    return [describeHeading(item), table.join('\n')].join('\n\n');
  }
  const parts = item.parts.map(
    (part, index) => `${describePartLabel(part, index)}\n\n${describeMedia(part, urls[index] as string)}`
  );
  return [describeHeading(item), ...parts].join('\n\n');
}

function describeNote(item: EvidenceGroup, notes: PullRequestSource['notes']) {
  const [first] = item.parts as [Evidence, ...Evidence[]];
  const text = notes[first.id]?.trim();
  if (!text) return null;
  return `<details><summary><b>${item.title}</b></summary>\n\n${text}\n\n</details>`;
}

function describeEvidenceItem(item: EvidenceGroup, notes: PullRequestSource['notes'], taskUrl: string) {
  const [first] = item.parts as [Evidence, ...Evidence[]];
  if (item.kind === 'note') return describeNote(item, notes) ?? describeUnpublished(item, taskUrl);
  const urls = item.parts.map(resolvePublicUrl);
  if (urls.some((url) => url === null)) return describeUnpublished(item, taskUrl);
  const published = urls as string[];
  if (item.kind === 'comparison') return describeComparison(item, published);
  if (item.kind === 'preview') return `- **${item.title}**: <${published[0]}>`;
  return [describeHeading(item), describeMedia(first, published[0] as string)].join('\n\n');
}

function serializeEvidence(source: PullRequestSource, taskUrl: string) {
  const blocks = listPullRequestEvidence(source.task, source.evidence).map((item) =>
    describeEvidenceItem(item, source.notes, taskUrl)
  );
  return describeSection('### Evidence', blocks.join('\n\n'));
}

function describeCheckRow(check: ReportCheck) {
  const note = check.note ? ` (${CHECK_NOTE[check.note]})` : '';
  const command = `\`${check.command.replaceAll('|', '\\|')}\``;
  return `| ${CHECK_MARK[check.outcome]} | ${check.label}${note} | ${command} |`;
}

function serializeChecks(task: Task, report: WorkReport) {
  if (report.checks.length === 0) return '';
  const passed = report.checks.filter((check) => check.outcome === 'pass').length;
  const rows = ['| | Check | Command |', '| --- | --- | --- |', ...report.checks.map(describeCheckRow)];
  const coverage =
    task.coverage?.status === 'measured' && task.coverage.executable > 0
      ? `\n\nThe tests cover ${task.coverage.covered} of ${task.coverage.executable} changed lines.`
      : '';
  return `### Checks\n${passed} of ${report.checks.length} passed.\n\n${rows.join('\n')}${coverage}`;
}

function describeEarlierRound(round: Round) {
  const outcome = round.outcome;
  const parts = [outcome?.headline ?? outcome?.goal ?? '', outcome?.result ?? '']
    .map((part) => part.trim())
    .filter(Boolean);
  const phases = (outcome?.phases ?? []).map((phase) => `\n  - ${phase}`).join('');
  const text = parts.length > 0 ? `: ${parts.join(' ')}` : '';
  return `**Round ${round.number}, ${round.title}**${text}${phases}`;
}

function serializeEarlierRounds(rounds: readonly Round[]) {
  return describeSection(
    '### Earlier rounds in this pull request',
    bulletList(rounds.map(describeEarlierRound))
  );
}

function serializeChanges(report: WorkReport, heading: string) {
  const lines = report.sections.map((section) => {
    const spots = section.spots
      .filter((spot) => SHOWN_ATTENTION.has(spot.attention))
      .map((spot) => `\n  - \`${spot.file}#L${spot.start}-L${spot.end}\`: ${spot.why}`)
      .join('');
    return `**${section.title}**: ${section.summary}${spots}`;
  });
  return describeSection(heading, bulletList(lines));
}

function serializeJudgementCalls(report: WorkReport) {
  return describeSection(
    '### Judgement calls',
    bulletList(
      report.judgementCalls.map((call) => {
        const rejected = (call.alternatives ?? []).map(
          (alternative) => `\n  - Not ${alternative.option}: ${alternative.rejected}`
        );
        return `**${call.title}**: ${call.call}. ${call.reason}${rejected.join('')}`;
      })
    )
  );
}

function serializeRisks(report: WorkReport) {
  return describeSection(
    '### Risks',
    bulletList((report.walkthrough?.risks ?? []).map((risk) => `**${risk.title}**: ${risk.risk}`))
  );
}

function serializeHeader(task: Task, taskUrl: string) {
  const name = task.handle ? `${task.handle}, ${task.title}` : task.title;
  return `> [!NOTE]\n> Shinsa task **${name}**. [Open it in Shinsa](${taskUrl}) to see the full review, the evidence and the agent's work.`;
}

function serializeSections(source: PullRequestSource): Section[] {
  const { task } = source;
  const report = assembleReport(task);
  const taskUrl = resolveShinsaTaskUrl(task);
  const flow = report.walkthrough?.flow?.trim();
  const earlier = listEarlierRounds(task);
  const changes =
    earlier.length > 0 ? `### What changed in round ${resolveCurrentRound(task).number}` : '### What changed';
  return [
    { text: serializeHeader(task, taskUrl), drop: Number.POSITIVE_INFINITY },
    { text: task.summary?.trim() ?? '', drop: Number.POSITIVE_INFINITY },
    { text: serializeEarlierRounds(earlier), drop: 3 },
    { text: describeSection('### How it works', report.walkthrough?.approach ?? ''), drop: 8 },
    {
      text: flow ? `<details><summary>How it flows</summary>\n\n${flow}\n\n</details>` : '',
      drop: 2,
    },
    { text: serializeEvidence(source, taskUrl), drop: 4 },
    { text: serializeChecks(task, report), drop: 9 },
    { text: serializeChanges(report, changes), drop: 5 },
    { text: serializeJudgementCalls(report), drop: 6 },
    { text: serializeRisks(report), drop: 7 },
    { text: serializeTestingMarkdown(report.walkthrough?.testing), drop: 10 },
    { text: serializeMergeStepsMarkdown(listMergeSteps(task)), drop: Number.POSITIVE_INFINITY },
    {
      text: task.plan ? `<details><summary>Plan</summary>\n\n${task.plan.body}\n\n</details>` : '',
      drop: 1,
    },
    {
      text: `---\n<sub>Made with [Shinsa](${SHINSA_SITE_URL}). Hand over the work. Keep the decisions.</sub>`,
      drop: Number.POSITIVE_INFINITY,
    },
  ];
}

function joinBlock(sections: readonly Section[]) {
  const body = sections
    .map((section) => section.text)
    .filter((text) => text.length > 0)
    .join('\n\n');
  return `${PULL_REQUEST_BLOCK_START}\n${body}\n${PULL_REQUEST_BLOCK_END}`;
}

function fitBlock(sections: Section[], limit: number) {
  const kept = [...sections];
  const order = [...sections]
    .filter((section) => Number.isFinite(section.drop))
    .sort((a, b) => a.drop - b.drop);
  for (const section of order) {
    if (joinBlock(kept).length <= limit) break;
    kept.splice(kept.indexOf(section), 1);
  }
  const block = joinBlock(kept);
  if (block.length <= limit) return block;
  return cutBlock(block, limit);
}

function resolveClosingTags(text: string) {
  const fence = (text.match(/^\s*```/gm) ?? []).length % 2 === 1 ? '\n```' : '';
  const open = (text.match(/<details[\s>]/g) ?? []).length - (text.match(/<\/details>/g) ?? []).length;
  return `${fence}${'\n\n</details>'.repeat(Math.max(0, open))}`;
}

function cutBlock(block: string, limit: number) {
  const tail = `\n${PULL_REQUEST_BLOCK_END}`;
  let size = limit - tail.length - 1;
  for (;;) {
    const cut = block.slice(0, size);
    const text = `${cut}…${resolveClosingTags(cut)}${tail}`;
    if (text.length <= limit) return text;
    size -= text.length - limit;
  }
}

export function serializePullRequestMarkdown(source: PullRequestSource, limit = PULL_REQUEST_BODY_LIMIT) {
  return fitBlock(serializeSections(source), limit);
}

export function replacePullRequestBlock(body: string, block: string, limit = PULL_REQUEST_BODY_LIMIT) {
  const start = body.indexOf(PULL_REQUEST_BLOCK_START);
  const end = body.indexOf(PULL_REQUEST_BLOCK_END, start);
  if (start < 0 || end < 0) return block;
  const before = body.slice(0, start);
  const after = body.slice(end + PULL_REQUEST_BLOCK_END.length);
  const replaced = `${before}${block}${after}`;
  return replaced.length <= limit ? replaced : block;
}
