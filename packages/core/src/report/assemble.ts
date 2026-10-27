import type { Task } from '../domain/types.ts';
import { resolveLatestWalkthrough } from './merge-steps.ts';
import type { WorkReport } from './types.ts';

export function assembleReport(task: Task): WorkReport {
  const phases = task.plan?.document?.phases ?? [];
  const reports = [...task.phaseReports].sort((a, b) => a.index - b.index);
  return {
    headline: task.plan?.document?.goal ?? task.title,
    sections: reports.map((report) => ({
      title: phases[report.index]?.title ?? `Phase ${report.index + 1}`,
      summary: report.summary,
      spots: report.spots,
    })),
    checks: task.checkResults ?? [],
    judgementCalls: reports.flatMap((report) => report.judgementCalls),
    walkthrough: resolveLatestWalkthrough(reports),
  };
}
