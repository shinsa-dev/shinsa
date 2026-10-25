export interface WaitSample {
  label: string;
  step: string;
  at: number;
  duration: number;
  open?: boolean;
}

const BLANK = 'blank: ';

export interface WaitRow {
  step: string;
  label: string;
  count: number;
  longest: number;
  allowed: boolean;
}

function formatMs(ms: number) {
  return `${Math.round(ms)} ms`;
}

function resolveVerdict(row: WaitRow) {
  if (!row.allowed) return 'no';
  return row.label.startsWith(BLANK) ? 'blank, under 300 ms' : 'cold read';
}

export function summarizeWaits(samples: readonly WaitSample[], coldSteps: ReadonlySet<string>): WaitRow[] {
  const rows = new Map<string, WaitRow>();
  for (const sample of samples) {
    const key = `${sample.step}\n${sample.label}`;
    const row = rows.get(key) ?? {
      step: sample.step,
      label: sample.label,
      count: 0,
      longest: 0,
      allowed: coldSteps.has(sample.step) || sample.label.startsWith(BLANK),
    };
    row.count += 1;
    row.longest = Math.max(row.longest, sample.duration);
    rows.set(key, row);
  }
  return [...rows.values()];
}

export function listFailures(rows: readonly WaitRow[]) {
  return rows.filter((row) => !row.allowed);
}

export function serializeWaitTable(rows: readonly WaitRow[]) {
  if (rows.length === 0) return 'No loading state was shown.';
  const lines = ['| Step | Shown | Times | Longest | Allowed |', '| --- | --- | --- | --- | --- |'];
  for (const row of rows) {
    lines.push(
      `| ${row.step} | ${row.label} | ${row.count} | ${formatMs(row.longest)} | ${resolveVerdict(row)} |`
    );
  }
  return lines.join('\n');
}
