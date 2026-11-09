import { capitalise } from '../chat/text.ts';

const PLAN_LABEL: Record<string, string> = {
  max: 'Max',
  ultra: 'Ultra',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

export function resolvePlanKey(plan: string | null) {
  if (!plan) return null;
  const key = plan
    .trim()
    .toLowerCase()
    .replace(/^claude[_\s-]*/, '')
    .replace(/[_\s-]+/g, '_');
  return key || null;
}

export function resolvePlanLabel(plan: string | null) {
  const key = resolvePlanKey(plan);
  if (!key) return null;
  return PLAN_LABEL[key] ?? capitalise(key.replace(/_/g, ' '));
}
