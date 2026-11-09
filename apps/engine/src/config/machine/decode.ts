import { Predicate, Result, Schema } from 'effect';
import { dedupe } from 'effect/Array';
import { toEntries } from 'effect/Record';
import {
  MACHINE_FIELD_PROBLEMS,
  type MachineConfig,
  type MachineConfigRead,
  type MachineField,
  MachineConfigJson,
  MachineFields,
  NOT_AN_OBJECT_PROBLEM,
} from './schema.ts';

const decodeJson = Schema.decodeUnknownResult(MachineConfigJson);

const decodeRoots = Schema.decodeUnknownResult(MachineFields.fields.roots);
const decodeTime = Schema.decodeUnknownResult(MachineFields.fields.onboardedAt);
const decodePort = Schema.decodeUnknownResult(MachineFields.fields.port);
const decodeText = Schema.decodeUnknownResult(MachineFields.fields.hostname);
const decodeFolder = Schema.decodeUnknownResult(MachineFields.fields.worktreesDir);

export function createMachineConfig(): MachineConfig {
  return {
    version: 1,
    roots: [],
    onboardedAt: null,
    port: null,
    hostname: null,
    editor: null,
    terminal: null,
    worktreesDir: null,
  };
}

function selectValue<A, E>(field: Result.Result<A | null | undefined, E>) {
  return Result.getOrNull(field) ?? null;
}

export function parseMachineConfig(value: unknown): MachineConfigRead {
  if (!Predicate.isObject(value)) {
    return { config: createMachineConfig(), problems: [NOT_AN_OBJECT_PROBLEM], unreadable: false };
  }
  const fields = {
    roots: decodeRoots(value.roots),
    onboardedAt: decodeTime(value.onboardedAt),
    port: decodePort(value.port),
    hostname: decodeText(value.hostname),
    editor: decodeText(value.editor),
    terminal: decodeText(value.terminal),
    worktreesDir: decodeFolder(value.worktreesDir),
  };
  const outcomes: Record<MachineField, Result.Result<unknown, Schema.SchemaError>> = fields;
  const problems = toEntries(outcomes)
    .filter(([, outcome]) => Result.isFailure(outcome))
    .map(([key]) => MACHINE_FIELD_PROBLEMS[key]);
  const config: MachineConfig = {
    version: 1,
    roots: dedupe(selectValue(fields.roots) ?? []),
    onboardedAt: selectValue(fields.onboardedAt),
    port: selectValue(fields.port),
    hostname: selectValue(fields.hostname),
    editor: selectValue(fields.editor),
    terminal: selectValue(fields.terminal),
    worktreesDir: selectValue(fields.worktreesDir),
  };
  return { config, problems, unreadable: false };
}

export function resolveUnreadableMachineConfig(reason: string): MachineConfigRead {
  return {
    config: createMachineConfig(),
    problems: [`The file is not valid JSON (${reason}).`],
    unreadable: true,
  };
}

export function resolveMachineConfigText(text: string | null): MachineConfigRead {
  if (text === null) return { config: createMachineConfig(), problems: [], unreadable: false };
  const value = decodeJson(text);
  if (Result.isFailure(value)) return resolveUnreadableMachineConfig(value.failure.message);
  return parseMachineConfig(value.success);
}
