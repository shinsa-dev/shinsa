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
  const ranges = file.patchOmitted ? [{ start: 1, end: 1 }] : listHunkRanges(file.patch);
  return ranges.slice(0, 3).map((range) => ({
    file: file.path,
    ...range,
    attention: file.risk === 'high' ? 'critical' : file.risk === 'normal' ? 'high' : 'normal',
    why: file.riskReason ?? (file.status === 'added' ? 'New file.' : 'Changed lines.'),
  }));
}

function createSection(title: string, summary: string, files: DiffFile[]): ReportSection | null {
  const spots = files.flatMap(listFileSpots).slice(0, 6);
  return spots.length > 0 ? { title, summary, spots } : null;
}

export function resolveFallbackReport(diff: TaskDiff, headline: string): WorkReport {
  const sections = [
    createSection(
      'Look closely',
      'Files in sensitive areas.',
      diff.files.filter((file) => file.risk === 'high')
    ),
    createSection(
      'The main change',
      'The largest changes, by lines touched.',
      diff.files
        .filter((file) => file.risk === 'normal')
        .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    ),
    createSection(
      'Tests and docs',
      'Supporting changes.',
      diff.files.filter((file) => file.risk === 'low')
    ),
  ].filter((section): section is ReportSection => section !== null);
  return { headline, sections, checks: [], judgementCalls: [] };
}
