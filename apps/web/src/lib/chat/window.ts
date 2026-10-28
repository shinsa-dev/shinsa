import type { Round, Run, Task } from '@shinsa/core';
import type { HumanMessage } from '@/lib/chat/timeline.ts';
import { isRoundDelivering } from '@/lib/tasks/message-queue.ts';
import { listRoundSections } from '@/lib/tasks/rounds.ts';

export type TranscriptBlock =
  | { kind: 'message'; key: string; message: HumanMessage }
  | { kind: 'round'; key: string; round: Round; first: boolean; delivering: boolean }
  | { kind: 'run'; key: string; run: Run; first: boolean };

export const INITIAL_BLOCKS = 8;

export const GROW_BLOCKS = 4;

const GROW_VIEWPORTS = 3;

const FILL_VIEWPORTS = 2;

export function listTranscriptBlocks(
  task: Task,
  runs: Run[],
  preamble: HumanMessage[],
  rounds: boolean
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = preamble.map((message, index) => ({
    kind: 'message',
    key: `message-${message.at}-${index}`,
    message,
  }));
  if (!rounds) {
    return [
      ...blocks,
      ...runs.map(
        (run, index): TranscriptBlock => ({
          kind: 'run',
          key: run.id,
          run,
          first: index === 0 && preamble.length === 0,
        })
      ),
    ];
  }
  const sections = listRoundSections(task, runs).filter((section) => section.round.status !== 'waiting');
  sections.forEach((section, index) => {
    blocks.push({
      kind: 'round',
      key: `round-${section.round.number}`,
      round: section.round,
      first: index === 0 && preamble.length === 0,
      delivering: isRoundDelivering(section.round, section.runs),
    });
    section.runs.forEach((run, position) => {
      blocks.push({ kind: 'run', key: run.id, run, first: position === 0 });
    });
  });
  return blocks;
}

export function resolveChatRunId(runs: Record<string, Run>, runId: string | null) {
  const seen = new Set<string>();
  let run = runId ? runs[runId] : undefined;
  while (run?.delegation && !seen.has(run.id)) {
    seen.add(run.id);
    run = runs[run.delegation.parentRunId];
  }
  return run?.id ?? null;
}

export function findRunBlock(blocks: TranscriptBlock[], runId: string | null) {
  if (runId === null) return -1;
  return blocks.findIndex((block) => block.kind === 'run' && block.run.id === runId);
}

export function resolveInitialStart(count: number) {
  return Math.max(0, count - INITIAL_BLOCKS);
}

export function resolveShownStart(start: number, count: number, focusIndex: number) {
  const clamped = Math.min(start, Math.max(0, count - 1));
  if (focusIndex < 0) return clamped;
  return Math.min(clamped, Math.max(0, focusIndex - 1));
}

export function resolveGrownStart(start: number) {
  return Math.max(0, start - GROW_BLOCKS);
}

export function shouldGrow(start: number, scrollTop: number, viewportHeight: number) {
  return start > 0 && scrollTop < viewportHeight * GROW_VIEWPORTS;
}

export function shouldFill(start: number, contentHeight: number, viewportHeight: number) {
  return start > 0 && contentHeight < viewportHeight * FILL_VIEWPORTS;
}

export function hasScrollAnchoring() {
  return typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'auto');
}

export function resolveScrollShift(shift: number, scrollTop: number, anchoring: boolean) {
  return anchoring && scrollTop > 0 ? 0 : shift;
}
