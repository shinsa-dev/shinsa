import type { EngineFeature } from '@shinsa/core';

export const ENGINE_FEATURE_ROUTES: Record<EngineFeature, readonly string[]> = {
  'task.share': [],
  feedback: ['GET /api/feedback'],
  teams: [
    'POST /api/remote/members/grant',
    'POST /api/remote/teams/create',
    'POST /api/remote/teams/join',
    'POST /api/remote/teams/link',
    'POST /api/remote/teams/link/renew',
    'POST /api/remote/teams/link/remove',
    'POST /api/remote/teams/requests/accept',
    'POST /api/remote/teams/requests/decline',
    'POST /api/remote/teams/members/remove',
    'POST /api/remote/teams/leave',
    'POST /api/remote/teams/remove',
    'GET /api/teams/tasks',
  ],
  'review.approve_after_fix': [],
};
