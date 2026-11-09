import { Option } from 'effect';
import { capitalise } from '../chat/text.ts';

const PLAN_LABEL: Record<string, string> = {
  max: 'Max',
  ultra: 'Ultra',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

export function resolvePlanKey(plan: string | null): Option.Option<string> {
  if (!plan) return Option.none();
  const key = plan
    .trim()
    .toLowerCase()
    .replace(/^claude[_\s-]*/, '')
    .replace(/[_\s-]+/g, '_');
  return key ? Option.some(key) : Option.none();
}

export function resolvePlanLabel(plan: string | null) {
  return Option.map(resolvePlanKey(plan), (key) => PLAN_LABEL[key] ?? capitalise(key.replace(/_/g, ' ')));
}
