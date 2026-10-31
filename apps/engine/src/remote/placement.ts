import {
  DomainError,
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

export function createPlacementAsker(ask: QuickJson): PlacementAsker {
  return async (question) =>
    parsePlacementAnswer(
      question,
      await ask<unknown>(PLACEMENT_SYSTEM, serializePlacementPrompt(question), PLACEMENT_SCHEMA)
    );
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
            'Send the request and two or more machines with their policies and load.'
          );
        return Response.json({ answer: await place(question) });
      },
    },
  ];
}
