import {
  DomainError,
  NO_PLACEMENT_MACHINE,
  PLACEMENT_SCHEMA,
  PLACEMENT_SYSTEM,
  type PlacementAnswer,
  type PlacementQuestion,
  parsePlacementAnswer,
  parsePlacementQuestion,
  serializePlacementPrompt,
} from '@shinsa/core';
import type { QuickJson } from '../agents/quick/index.ts';
import { readJsonObject } from '../http/body.ts';
import type { ApiRoute } from '../http/routes.ts';

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
    if (said === null) throw new DomainError('placement_unavailable', 'Claude did not answer. Try again.');
    if (isNoMachineAnswer(said)) return null;
    const answer = parsePlacementAnswer(question, said);
    if (!answer) throw new DomainError('placement_unreadable', 'Claude named none of your machines.');
    return answer;
  };
}

export function createPlacementRoutes(place: PlacementAsker): ApiRoute[] {
  return [
    {
      method: 'POST',
      pattern: /^\/api\/placement$/,
      respond: async (_match, request) => {
        const question = parsePlacementQuestion(await readJsonObject(request));
        if (!question)
          throw new DomainError(
            'placement_invalid',
            'Send the request and two or more machines with their policies, projects and load.'
          );
        return Response.json({ answer: await place(question) });
      },
    },
  ];
}
