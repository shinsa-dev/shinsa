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
  account: string | null;
}

function isPlanStep({ role, purpose }: RouteRequest) {
  return purpose === 'plan' || role === 'planner';
}

export function resolveRouteStep(request: RouteRequest): RouteStep {
  if (!isPlanStep(request)) return 'work';
  return request.size === 'large' ? 'plan_large' : 'plan';
}

type RoomTable = Readonly<Record<string, ModelRoom>>;

const LOW_ROOM_PERCENT = 10;

function resolveReading(room: RoomTable, model: string, account: string | null) {
  const pooled = room[resolveModelFamily(model)];
  if (!pooled || account === null) return pooled;
  return pooled.accounts.find((reading) => reading.account === account) ?? pooled;
}

function resolveLeft(room: RoomTable, model: string, account: string | null) {
  return resolveReading(room, model, account)?.left ?? null;
}

export function isModelUsable(room: RoomTable, model: string, account: string | null = null) {
  return resolveReading(room, model, account)?.usable !== false;
}

function hasRoom(room: RoomTable, model: string, account: string | null) {
  const left = resolveLeft(room, model, account);
  return left === null || left >= LOW_ROOM_PERCENT;
}

export function resolveRoutedModel(request: RouteRequest, room: RoomTable, account: string | null = null) {
  const candidates = MODEL_ROUTES[resolveRouteStep(request)];
  const usable = candidates.filter((model) => isModelUsable(room, model, account));
  const roomy = usable.find((model) => hasRoom(room, model, account));
  if (roomy) return roomy;
  const [fullest] = [...usable].sort(
    (a, b) => (resolveLeft(room, b, account) ?? 0) - (resolveLeft(room, a, account) ?? 0)
  );
  return fullest ?? candidates[0] ?? 'opus';
}

export function resolveStepModel({ settings, room, account, ...request }: StepModelRequest) {
  const role = RUN_AGENT_ROLE[request.role];
  if (!isAutoModel(settings, role)) return resolveAgentModel(settings, role);
  return resolveRoutedModel(request, room, account);
}
