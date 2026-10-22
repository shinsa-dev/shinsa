import type { Task } from '../model/types.ts';
import type { WorkReport } from './types.ts';

export function assembleReport(task: Task): WorkReport {
  const plan = task.spec?.document?.plan ?? [];
  const reports = [...task.phaseReports].sort((a, b) => a.index - b.index);
  return {
    headline: task.spec?.document?.goal ?? task.title,
    phases: reports.map((report) => ({
      title: plan[report.index]?.title ?? `Phase ${report.index + 1}`,
      summary: report.summary,
      spots: report.spots,
    })),
    checks: task.checkResults ?? [],
    decisions: reports.flatMap((report) => report.decisions),
  };
}
