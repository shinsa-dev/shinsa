import {
  describeCount,
  type Initiative,
  type InitiativeDecisionKind,
  type InitiativePhaseProgress,
  type InitiativeSheet,
  listInitiativeProgress,
  listInitiatives,
  resolveInitiativeSheet,
  selectInitiativeByReference,
  resolveInitiativeTotals,
  type ShinsaState,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { Glyph } from '@/lib/tasks/status.ts';
import { resolveInitiativePath, type Route } from '@/router.ts';

export const INITIATIVE_ICON: IconName = 'IconTarget';

export const INITIATIVE_ACTIVE_ICON: IconName = 'IconTargetFilled';

export const INITIATIVES_TITLE = 'Initiatives';

export const INITIATIVES_DESCRIPTION =
  'Group the tasks of one large piece of work, see where each phase stands and what needs you.';

export const NO_PHASE_VALUE = '';

export interface InitiativeRow {
  initiative: Initiative;
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
  return listInitiatives(state).map((initiative) => {
    const totals = resolveInitiativeTotals(listInitiativeProgress(state, initiative));
    return {
      initiative,
      ...totals,
      summary: describeOpenAndShipped(totals.open, totals.shipped, totals.total),
    };
  });
}

export function selectInitiativeView(state: ShinsaState, reference: string, now: number) {
  const initiative = selectInitiativeByReference(Object.values(state.initiatives), reference);
  if (!initiative) return null;
  return resolveInitiativeSheet(state, initiative.id, now);
}

export function resolveCanonicalInitiativePath(initiative: Initiative, reference: string, query: string) {
  return reference === initiative.id ? null : `${resolveInitiativePath(initiative.id)}${query}`;
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

export function isInitiativesNavShown(state: ShinsaState, route: Route) {
  return isInitiativeRoute(route) || Object.keys(state.initiatives).length > 0;
}

export function isInitiativeRoute(route: Route) {
  return route.name === 'initiatives' || route.name === 'initiative';
}
