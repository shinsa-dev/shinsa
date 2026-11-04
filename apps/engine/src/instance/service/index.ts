import { Effect } from 'effect';
import { SERVICE_MARKER, ServiceCommandFailed, type ServiceRunner } from './schema.ts';

export {
  type EngineService,
  SERVICE_CARRIED_ENV,
  SERVICE_MARKER,
  ServiceCommandFailed,
  type ServiceResult,
  type ServiceRunner,
} from './schema.ts';

export function isStartedByService(env: Record<string, string | undefined>) {
  return env[SERVICE_MARKER] === '1';
}

export const runServiceCommand = Effect.fn('EngineService.run')(function* (
  name: string,
  run: ServiceRunner,
  args: string[]
) {
  const result = yield* run(args);
  if (result.ok) return;
  return yield* new ServiceCommandFailed({
    message: `${name} ${args[0]} failed: ${result.output.trim() || 'no output'}`,
  });
});
