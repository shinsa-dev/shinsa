import type { ModelRoom } from '../domain/accounts.ts';
import type { Settings } from '../domain/settings.ts';
import type { RunPurpose, RunRole, TaskSize } from '../domain/types.ts';
import { isAutoModel, RUN_AGENT_ROLE, resolveAgentModel, resolveModelFamily } from './index.ts';

export type RouteStep = 'plan_large' | 'plan' | 'work';

export const MODEL_ROUTES: Record<RouteStep, readonly string[]> = {
  plan_large: ['fable', 'opus'],
  plan: ['opus', 'sonnet'],
  work: ['opus', 'sonnet'],
};

export interface RouteRequest {
  size: TaskSize | null;
  role: RunRole;
  purpose: RunPurpose | null;
}

export interface StepModelRequest extends RouteRequest {
  settings: Settings;
  room: Readonly<Record<string, ModelRoom>>;
}

function isPlanStep({ role, purpose }: RouteRequest) {
  return purpose === 'plan' || role === 'planner';
}

export function resolveRouteStep(request: RouteRequest): RouteStep {
  if (!isPlanStep(request)) return 'work';
  return request.size === 'large' ? 'plan_large' : 'plan';
}

export function isModelUsable(room: Readonly<Record<string, ModelRoom>>, model: string) {
  return room[resolveModelFamily(model)]?.usable !== false;
}

export function resolveRoutedModel(request: RouteRequest, room: Readonly<Record<string, ModelRoom>>) {
  const candidates = MODEL_ROUTES[resolveRouteStep(request)];
  return candidates.find((model) => isModelUsable(room, model)) ?? candidates[0] ?? 'opus';
}

export function resolveStepModel({ settings, room, ...request }: StepModelRequest) {
  const role = RUN_AGENT_ROLE[request.role];
  if (!isAutoModel(settings, role)) return resolveAgentModel(settings, role);
  return resolveRoutedModel(request, room);
}
