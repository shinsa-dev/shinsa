import type {
  AutopilotBenchmarkKind,
  AutopilotBenchmarkRow,
  AutopilotBenchmarkScope,
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

export function serializeBenchmark(replay: BenchmarkReplay) {
  const { benchmark } = replay;
  const lines = [
    'Autopilot benchmark',
    `Replayed ${replay.events} events from a copy of ${replay.source}. The log itself is untouched.`,
  ];
  if (replay.unreadable > 0) lines.push(`${replay.unreadable} events could not be read and were skipped.`);
  if (benchmark.judged === 0) {
    lines.push('', 'There are no decisions to score yet. Decide a few plans, reviews or merges first.');
    return lines.join('\n');
  }
  lines.push(`${benchmark.judged} of your ${benchmark.decisions} decisions had a guess to check.`);
  for (const scope of ['all', 'shared'] as const) {
    const rows = benchmark.rows.filter((row) => row.scope === scope);
    if (rows.length > 0) lines.push('', SCOPE_TITLE[scope], ...formatTable(rows));
  }
  lines.push(
    '',
    'Agreed is how often the guess matched what you did. Log loss is lower when a guesser is sure only when it is right.'
  );
  return lines.join('\n');
}
