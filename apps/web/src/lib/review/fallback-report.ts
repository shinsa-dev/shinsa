import type { CodeSpot, DiffFile, ReportSection, TaskDiff, WorkReport } from '@shinsa/core';

function listHunkRanges(patch: string) {
  const ranges: { start: number; end: number }[] = [];
  for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Math.max(Number(match[1]), 1);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    ranges.push({ start, end: Math.max(start, start + count - 1) });
  }
  return ranges;
}

function listFileSpots(file: DiffFile): CodeSpot[] {
  return listHunkRanges(file.patch)
    .slice(0, 3)
    .map((range) => ({
      file: file.path,
      ...range,
      attention: file.risk === 'high' ? 'critical' : file.risk === 'normal' ? 'high' : 'normal',
      why: file.riskReason ?? (file.status === 'added' ? 'New file.' : 'Changed lines.'),
    }));
}

function createPhase(title: string, summary: string, files: DiffFile[]): ReportSection | null {
  const spots = files.flatMap(listFileSpots).slice(0, 6);
  return spots.length > 0 ? { title, summary, spots } : null;
}

export function resolveFallbackReport(diff: TaskDiff, headline: string): WorkReport {
  const phases = [
    createPhase(
      'Look closely',
      'Files in sensitive areas.',
      diff.files.filter((file) => file.risk === 'high')
    ),
    createPhase(
      'The main change',
      'The largest changes, by lines touched.',
      diff.files
        .filter((file) => file.risk === 'normal')
        .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    ),
    createPhase(
      'Tests and docs',
      'Supporting changes.',
      diff.files.filter((file) => file.risk === 'low')
    ),
  ].filter((phase): phase is ReportSection => phase !== null);
  return { headline, phases, checks: [], decisions: [] };
}
