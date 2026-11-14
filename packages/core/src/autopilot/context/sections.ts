import type { Task } from '../../domain/types.ts';
import type { ReviewFinding } from '../../report/types.ts';
import type { ShinsaState } from '../../state/project.ts';
import type { AutopilotDecision, AutopilotGateKind } from '../schema.ts';
import { clipAutopilotText } from './budget.ts';
import { AUTOPILOT_CONTEXT_LIMITS, type AutopilotContextSection, type AutopilotReply } from './schema.ts';

const LIMITS = AUTOPILOT_CONTEXT_LIMITS;

function clipLine(text: string) {
  return clipAutopilotText(text, LIMITS.line);
}

function listReportedFiles(task: Task) {
  return [...new Set(task.phaseReports.flatMap((report) => report.files ?? []))];
}

function listPlannedFiles(task: Task) {
  return [...new Set((task.plan?.document?.files ?? []).map((file) => file.path))];
}

function listAutopilotTaskPaths(task: Task) {
  return [...new Set([...listReportedFiles(task), ...listPlannedFiles(task), ...(task.editedPaths ?? [])])];
}

function describeFiles(files: readonly string[]) {
  return files.slice(0, LIMITS.files).map((file) => `- ${file}`);
}

function countOmittedFiles(files: readonly string[]) {
  return Math.max(0, files.length - LIMITS.files);
}

function resolveChanges(task: Task): AutopilotContextSection {
  const changes = task.pullRequest?.changes;
  const stats = changes
    ? [
        `Pull request: ${changes.changedFiles} files changed, ${changes.additions} lines added, ${changes.deletions} removed`,
      ]
    : [];
  const reported = listReportedFiles(task);
  if (reported.length > 0) {
    return {
      name: 'changes',
      title: 'What changed:',
      lines: [...stats, 'Files:', ...describeFiles(reported)],
      omitted: countOmittedFiles(reported),
    };
  }
  const planned = listPlannedFiles(task);
  const files = planned.length > 0 ? ['Files the plan changes:', ...describeFiles(planned)] : [];
  return {
    name: 'changes',
    title: 'What changed:',
    lines: [...stats, ...files],
    omitted: countOmittedFiles(planned),
  };
}

function selectWalkthrough(task: Task) {
  const reported = [...task.phaseReports].reverse().find((report) => report.walkthrough);
  return task.report?.walkthrough ?? reported?.walkthrough ?? null;
}

function resolveWalkthrough(task: Task): AutopilotContextSection {
  const walkthrough = selectWalkthrough(task);
  if (!walkthrough) return { name: 'walkthrough', title: 'The walkthrough:', lines: [] };
  const risks = walkthrough.risks
    .slice(0, LIMITS.risks)
    .map((risk) => `- ${clipLine(`${risk.title}: ${risk.risk}`)}`);
  return {
    name: 'walkthrough',
    title: 'The walkthrough:',
    lines: [
      `Approach: ${clipAutopilotText(walkthrough.approach, LIMITS.sections.walkthrough / 2)}`,
      ...(risks.length > 0 ? ['Risks:', ...risks] : []),
    ],
  };
}

const SEVERITY_ORDER: Record<ReviewFinding['severity'], number> = { blocking: 0, should_fix: 1, optional: 2 };

const SEVERITY_TEXT: Record<ReviewFinding['severity'], string> = {
  blocking: 'blocking',
  should_fix: 'should fix',
  optional: 'optional',
};

function describeFinding(finding: ReviewFinding) {
  const at = finding.file ? ` ${finding.file}${finding.line === null ? '' : `:${finding.line}`}` : '';
  const verdict = finding.verdict ? ` (you marked it ${finding.verdict})` : '';
  return `- ${SEVERITY_TEXT[finding.severity]}${at}: ${clipLine(finding.title ?? finding.message)}${verdict}`;
}

function resolveReview(task: Task): AutopilotContextSection {
  const ratings = task.reviewRatings
    ? [`Ratings: confidence ${task.reviewRatings.confidence}, risk ${task.reviewRatings.risk}`]
    : [];
  const summary = task.reviewSummary
    ? [`Summary: ${clipAutopilotText(task.reviewSummary, LIMITS.line * 2)}`]
    : [];
  const findings = [...task.findings]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, LIMITS.findings)
    .map(describeFinding);
  const lines = [...summary, ...ratings, ...(findings.length > 0 ? ['Findings:', ...findings] : [])];
  return { name: 'review', title: 'The review:', lines, omitted: task.findings.length - findings.length };
}

function resolveMessages(task: Task): AutopilotContextSection {
  const messages = task.activity
    .filter(
      (entry) =>
        entry.actor === 'you' &&
        (entry.kind === 'message' || entry.kind === 'round') &&
        !entry.onBehalf &&
        entry.detail
    )
    .slice(-LIMITS.messages)
    .map((entry) => `- “${clipLine(entry.detail ?? '')}”`);
  return { name: 'messages', title: 'What you told the agent, oldest first:', lines: messages };
}

function resolveReplies(replies: readonly AutopilotReply[]): AutopilotContextSection {
  const lines = [...replies]
    .sort((a, b) => a.at - b.at)
    .slice(-LIMITS.replies)
    .map((reply) => `- ${clipAutopilotText(reply.text, LIMITS.sections.replies / LIMITS.replies - 4)}`);
  return { name: 'replies', title: 'The agent’s latest replies, oldest first:', lines };
}

export function resolveAutopilotAreas(paths: readonly string[]) {
  const dirs = paths
    .filter((path) => !path.endsWith('.md'))
    .map((path) => path.split('/').slice(0, -1).slice(0, LIMITS.areaDepth))
    .filter((parts) => parts.length > 0)
    .map((parts) => parts.join('/'));
  return [...new Set(dirs)];
}

const DECIDED_KINDS: readonly AutopilotGateKind[] = [
  'plan',
  'question',
  'review',
  'merge',
  'proposal',
  'failure',
];

function isDecidedKind(kind: AutopilotDecision['kind']): kind is AutopilotGateKind {
  return (DECIDED_KINDS as readonly string[]).includes(kind);
}

const KIND_NOUN: Record<AutopilotGateKind, string> = {
  plan: 'plan',
  question: 'question',
  review: 'review',
  merge: 'merge',
  proposal: 'proposal',
  failure: 'failed step',
};

function describeAreaTask(task: Task, decisions: readonly AutopilotDecision[], areas: readonly string[]) {
  const answers = decisions
    .slice(-LIMITS.areaAnswers)
    .map((decision) => `${KIND_NOUN[decision.kind as AutopilotGateKind]} ${decision.answer}`);
  const noted = [...decisions].reverse().find((decision) => decision.note);
  const words = noted?.note ? ` You wrote: “${clipAutopilotText(noted.note, 160)}”` : '';
  return `- “${clipAutopilotText(task.title, 80)}” (${areas.join(', ')}): ${answers.join(', ')}.${words}`;
}

function resolveArea(state: ShinsaState, task: Task): AutopilotContextSection {
  const areas = resolveAutopilotAreas(listAutopilotTaskPaths(task));
  const empty: AutopilotContextSection = {
    name: 'area',
    title: 'Your recent tasks in this part of the app:',
    lines: [],
  };
  if (areas.length === 0) return empty;
  const byTask = new Map<string, AutopilotDecision[]>();
  for (const decision of state.autopilotProfile.decisions) {
    if (decision.taskId === task.id || !isDecidedKind(decision.kind)) continue;
    byTask.set(decision.taskId, [...(byTask.get(decision.taskId) ?? []), decision]);
  }
  const lines = [...byTask.entries()]
    .flatMap(([taskId, decisions]) => {
      const other = state.tasks[taskId];
      if (!other || (task.repoId !== null && other.repoId !== task.repoId)) return [];
      const shared = resolveAutopilotAreas(listAutopilotTaskPaths(other)).filter((area) =>
        areas.includes(area)
      );
      if (shared.length === 0) return [];
      const last = Math.max(...decisions.map((decision) => decision.at));
      return [{ last, line: describeAreaTask(other, decisions, shared) }];
    })
    .sort((a, b) => b.last - a.last)
    .slice(0, LIMITS.areaTasks)
    .map(({ line }) => line);
  return { ...empty, lines };
}

export function listAutopilotContextSections(
  state: ShinsaState,
  task: Task,
  replies: readonly AutopilotReply[] = []
): AutopilotContextSection[] {
  return [
    resolveReview(task),
    resolveChanges(task),
    resolveWalkthrough(task),
    resolveMessages(task),
    resolveReplies(replies),
    resolveArea(state, task),
  ];
}
