import { Effect } from 'effect';
import { describeTriagePrompt, parseTriageAnswer, resolveTriagePlan, resolveTriageSchema } from './plan.ts';
import { TRIAGE_SYSTEM, type TriageAnswer, type TriageDefinition } from './schema.ts';

export const requestTriage = Effect.fn('Triage.request')(function* (definition: TriageDefinition) {
  const { state, task, local, ask, team } = definition;
  const plan = resolveTriagePlan(state, task, local, team);
  const answer = yield* ask<TriageAnswer>(
    TRIAGE_SYSTEM,
    describeTriagePrompt(state, plan),
    resolveTriageSchema(plan)
  );
  if (!answer) return plan.fallback;
  return parseTriageAnswer(state, plan, answer);
});
