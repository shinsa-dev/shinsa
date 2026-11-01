import type { EngineFeature } from '@shinsa/core';

export const ENGINE_FEATURE_ROUTES: Record<EngineFeature, readonly string[]> = {
  'task.share': [],
  feedback: ['GET /api/feedback'],
};
