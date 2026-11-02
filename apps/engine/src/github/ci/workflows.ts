import { CHECK_TRIGGERS } from './schema.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listTriggerNames(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.filter((name): name is string => typeof name === 'string');
  return isRecord(on) ? Object.keys(on) : [];
}

export function isCheckWorkflow(text: string) {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch {
    return true;
  }
  if (!isRecord(parsed)) return true;
  return listTriggerNames(parsed.on).some((name) => CHECK_TRIGGERS.has(name));
}
