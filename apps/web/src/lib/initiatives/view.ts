import {
  describeCount,
  type Initiative,
  type InitiativeDecisionKind,
  type InitiativePhaseProgress,
  type InitiativeSheet,
  listInitiativeProgress,
  listInitiatives,
  resolveInitiativeTotals,
  selectInitiativeLead,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Glyph } from '@/lib/tasks/status.ts';

export const INITIATIVE_ICON: IconName = 'IconTarget';

export const INITIATIVES_TITLE = 'Initiatives';

export const NO_PHASE_VALUE = '';

export interface InitiativeRow {
  initiative: Initiative;
  lead: Task;
  total: number;
  open: number;
  shipped: number;
  dropped: number;
  summary: string;
}

export interface InitiativeSection {
  key: 'needsYou' | 'now' | 'next' | 'shipped' | 'dropped' | 'decisions';
  title: string;
  icon: IconName;
  count: number;
  empty: string;
}

export const DECISION_KIND: Record<InitiativeDecisionKind, { label: string; glyph: Glyph }> = {
  plan: { label: 'Plan approved', glyph: { icon: 'IconCheckCircle2', tone: 'blue' } },
  call: { label: 'Judgement call', glyph: { icon: 'IconSplit', tone: 'purple' } },
};

function describeOpenAndShipped(open: number, shipped: number, total: number) {
  if (total === 0) return 'No tasks yet';
  return `${describeCount(total, 'task')} · ${open} open · ${shipped} shipped`;
}

export function listInitiativeRows(state: ShinsaState): InitiativeRow[] {
  return listInitiatives(state).flatMap((initiative) => {
    const lead = selectInitiativeLead(state, initiative);
    if (!lead) return [];
    const totals = resolveInitiativeTotals(listInitiativeProgress(state, initiative));
    return [
      {
        initiative,
        lead,
        ...totals,
        summary: describeOpenAndShipped(totals.open, totals.shipped, totals.total),
      },
    ];
  });
}

export function isPhaseDone(progress: InitiativePhaseProgress) {
  return progress.total > 0 && progress.shipped + progress.dropped === progress.total;
}

export function describeSheetSummary(sheet: InitiativeSheet) {
  const { total, shipped, open } = resolveInitiativeTotals(sheet.progress);
  if (total === 0) return 'No tasks yet. Add tasks from their menu, or make an initiative from a task.';
  return describeOpenAndShipped(open, shipped, total);
}

export function listInitiativeSections(sheet: InitiativeSheet): InitiativeSection[] {
  const waiting = sheet.next.reduce((sum, group) => sum + group.tasks.length, 0);
  return [
    {
      key: 'needsYou',
      title: 'Needs you',
      icon: 'IconBell',
      count: sheet.needsYou.length,
      empty: 'Nothing in this initiative waits for you.',
    },
    {
      key: 'now',
      title: 'Now',
      icon: 'IconAgents',
      count: sheet.now.length,
      empty: 'No agent works on this initiative right now.',
    },
    {
      key: 'next',
      title: 'Next',
      icon: 'IconHourglass',
      count: waiting,
      empty: 'Nothing else is lined up.',
    },
    {
      key: 'shipped',
      title: 'Shipped',
      icon: 'IconCheckCircle2',
      count: sheet.shipped.length,
      empty: 'Nothing has shipped yet.',
    },
    {
      key: 'dropped',
      title: 'Dropped',
      icon: 'IconCircleX',
      count: sheet.dropped.length,
      empty: 'Nothing was dropped.',
    },
    {
      key: 'decisions',
      title: 'Decisions',
      icon: 'IconSplit',
      count: sheet.decisions.length,
      empty: 'Approved plans and the agents’ judgement calls show here.',
    },
  ];
}
