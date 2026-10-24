import { capitalise } from '../chat/text.ts';

const PLAN_LABEL: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };

export function resolvePlanLabel(plan: string | null) {
  if (!plan) return null;
  const key = plan.toLowerCase().replace(/^claude[_\s-]*/, '');
  return PLAN_LABEL[key] ?? capitalise(key.replace(/[_-]+/g, ' '));
}
