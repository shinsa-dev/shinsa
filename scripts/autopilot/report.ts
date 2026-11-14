import type {
  AutopilotBenchmarkKind,
  AutopilotBenchmarkRow,
  AutopilotBenchmarkScope,
  AutopilotFollowUpMatch,
  AutopilotTrack,
} from '../../packages/core/src/index.ts';
import type { BenchmarkReplay } from './schema.ts';

const KIND_LABEL: Record<AutopilotBenchmarkKind, string> = {
  plan: 'Plans',
  question: 'Questions',
  review: 'Reviews',
  merge: 'Merges',
  proposal: 'Your OK',
  finding: 'Findings',
  suggestion: 'Suggested tasks',
  message: 'Messages',
  priority: 'Priorities',
  cancel: 'Cancels',
  request: 'Filed tasks',
  edit: 'Code edits',
  total: 'All',
};

const TRACK_LABEL: Record<AutopilotTrack, string> = {
  model: 'Local model',
  call: 'Model call',
  combined: 'Both combined',
  base: 'Always your usual answer',
};

const SCOPE_TITLE: Record<AutopilotBenchmarkScope, string> = {
  all: 'Every decision each guesser guessed',
  shared: 'Only where the model call guessed too, the fair comparison',
};

const COLUMNS = [18, 28, 11, 10, 10];

function formatRow(cells: readonly string[]) {
  return cells
    .map((cell, index) => (index < 2 ? cell.padEnd(COLUMNS[index] ?? 0) : cell.padStart(COLUMNS[index] ?? 0)))
    .join('')
    .trimEnd();
}

function formatTable(rows: readonly AutopilotBenchmarkRow[]) {
  return [
    formatRow(['Kind', 'Guesser', 'Decisions', 'Agreed', 'Log loss']),
    ...rows.map((row) =>
      formatRow([
        KIND_LABEL[row.kind],
        TRACK_LABEL[row.track],
        String(row.scored),
        `${(row.agreement * 100).toFixed(1)}%`,
        row.loss.toFixed(3),
      ])
    ),
  ];
}

function describeNothingScored(decisions: number) {
  if (decisions === 0)
    return 'The log holds no decisions Autopilot recorded. It records them from this version of Shinsa on, so decide a few plans, reviews or merges first.';
  return `The log holds ${decisions} decisions, and none is a plan, a review, a merge, your OK, a finding or a suggested task, so there is nothing to score yet.`;
}

function describeFollowUps({ scored, matched }: AutopilotFollowUpMatch) {
  if (scored === 0)
    return 'Follow-ups: none to compare yet. A follow-up counts once you ask for a change on a topic Autopilot knows after it guessed one.';
  const share = ((matched / scored) * 100).toFixed(1);
  return `Follow-ups: ${matched} of ${scored} raised a topic you raised yourself (${share}%).`;
}

export function serializeBenchmark(replay: BenchmarkReplay) {
  const { benchmark } = replay;
  const lines = [
    'Autopilot benchmark',
    `Replayed ${replay.events} events from a copy of ${replay.source}. The log itself is untouched.`,
  ];
  if (replay.unreadable > 0) lines.push(`${replay.unreadable} events could not be read and were skipped.`);
  if (benchmark.judged === 0) {
    lines.push('', describeNothingScored(benchmark.decisions));
    return lines.join('\n');
  }
  lines.push(`${benchmark.judged} of your ${benchmark.decisions} decisions had a guess to check.`);
  for (const scope of ['all', 'shared'] as const) {
    const rows = benchmark.rows.filter((row) => row.scope === scope);
    if (rows.length > 0) lines.push('', SCOPE_TITLE[scope], ...formatTable(rows));
  }
  lines.push('', describeFollowUps(benchmark.followUps));
  lines.push(
    '',
    'Agreed is how often the guess matched what you did. Log loss is lower when a guesser is sure only when it is right.'
  );
  return lines.join('\n');
}
