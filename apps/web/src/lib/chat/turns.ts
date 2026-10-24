import type { Run } from '@shinsa/core';
import type { RunTurn, TimelineItemOf, ToolCall } from '@/lib/chat/timeline.ts';
import { resolveRunningLabel } from '@/lib/chat/tool-describe.ts';

export type Closing = { kind: 'error' | 'reply'; text: string };

export function selectLatestAgentText(turn: RunTurn) {
  return turn.work.filter((item): item is TimelineItemOf<'agent'> => item.kind === 'agent').at(-1) ?? null;
}

export function selectLatestCall(calls: ToolCall[]) {
  return calls.filter((call) => call.result === null).at(-1) ?? calls.at(-1) ?? null;
}

function selectLatestStep(turn: RunTurn): ToolCall | null {
  for (const item of [...turn.work].reverse()) {
    if (item.kind === 'tools') return selectLatestCall(item.calls);
    if (item.kind === 'agent') return null;
  }
  return null;
}

export function resolveLiveStep(turn: RunTurn, waiting: boolean) {
  if (waiting) return 'Paused until you answer';
  const latest = selectLatestStep(turn);
  if (latest) return resolveRunningLabel(latest.description);
  return turn.work.some((item) => item.kind === 'agent' || item.kind === 'tools') ? 'Thinking' : 'Starting';
}

function isWaitingTurn(turn: RunTurn) {
  return (
    turn.human !== null &&
    !turn.live &&
    turn.notices.length + turn.work.length + turn.outcomes.length + turn.errors.length === 0 &&
    turn.reply === null
  );
}

export function resolveClosing(run: Run, turns: RunTurn[]): Closing | null {
  const summary = run.summary?.trim() ?? '';
  if (run.endedAt === null || !summary) return null;
  if (run.outcome === 'failed') {
    const shown = turns.some((turn) => turn.errors.some((item) => item.text.trim() === summary));
    return shown ? null : { kind: 'error', text: summary };
  }
  const last = turns.filter((turn) => !isWaitingTurn(turn)).at(-1);
  const answered = last && (last.reply || last.outcomes.length > 0 || last.errors.length > 0);
  return answered ? null : { kind: 'reply', text: summary };
}

export function formatBrief(text: string) {
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) fenced = !fenced;
      return fenced || !line.trim() ? line : `${line}  `;
    })
    .join('\n');
}
