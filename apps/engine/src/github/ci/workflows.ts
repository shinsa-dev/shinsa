import { Result } from 'effect';
import { CHECK_TRIGGERS } from './schema.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listTriggerNames(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.filter((name): name is string => typeof name === 'string');
  return isRecord(on) ? Object.keys(on) : [];
}

function isCheckTrigger(parsed: unknown) {
  if (!isRecord(parsed)) return true;
  return listTriggerNames(parsed.on).some((name) => CHECK_TRIGGERS.has(name));
}

export function isCheckWorkflow(text: string) {
  return Result.match(
    Result.try(() => Bun.YAML.parse(text) as unknown),
    { onFailure: () => true, onSuccess: isCheckTrigger }
  );
}
