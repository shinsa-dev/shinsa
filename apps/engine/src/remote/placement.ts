import {
  DomainError,
  NO_PLACEMENT_MACHINE,
  PLACEMENT_SCHEMA,
  PLACEMENT_SYSTEM,
  type PlacementAnswer,
  type PlacementQuestion,
  parsePlacementAnswer,
  serializePlacementPrompt,
} from '@shinsa/core';
import type { QuickJson } from '../agents/quick/index.ts';

export type PlacementAsker = (question: PlacementQuestion) => Promise<PlacementAnswer | null>;

function isNoMachineAnswer(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { machine?: unknown }).machine === NO_PLACEMENT_MACHINE
  );
}

export function createPlacementAsker(ask: QuickJson): PlacementAsker {
  return async (question) => {
    const said = await ask<unknown>(PLACEMENT_SYSTEM, serializePlacementPrompt(question), PLACEMENT_SCHEMA);
    if (said === null)
      throw new DomainError({ code: 'placement_unavailable', message: 'Claude did not answer. Try again.' });
    if (isNoMachineAnswer(said)) return null;
    const answer = parsePlacementAnswer(question, said);
    if (!answer)
      throw new DomainError({ code: 'placement_unreadable', message: 'Claude named none of your machines.' });
    return answer;
  };
}
