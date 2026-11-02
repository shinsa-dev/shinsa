import { existsSync, readFileSync } from 'node:fs';
import { Option, Predicate, Result, Schema } from 'effect';
import { dedupe } from 'effect/Array';
import { describeError } from '../log/index.ts';
import {
  MACHINE_FIELD_PROBLEMS,
  type MachineConfig,
  type MachineConfigRead,
  type MachineField,
  MachinePort,
  MachineRoots,
  MachineText,
  MachineTime,
  NOT_AN_OBJECT_PROBLEM,
} from './schema.ts';

const decodeText = Schema.decodeUnknownOption(MachineText);
const decodeRoots = Schema.decodeUnknownOption(MachineRoots);
const decodePort = Schema.decodeUnknownOption(MachinePort);
const decodeTime = Schema.decodeUnknownOption(MachineTime);
const decodeJsonText = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

export function createMachineConfig(): MachineConfig {
  return {
    version: 1,
    roots: [],
    onboardedAt: null,
    port: null,
    hostname: null,
    editor: null,
    terminal: null,
  };
}

function readField<A>(
  fields: Record<PropertyKey, unknown>,
  key: MachineField,
  decode: (value: unknown) => Option.Option<A>,
  problems: string[]
) {
  const value = fields[key];
  if (Predicate.isNullish(value)) return null;
  const decoded = decode(value);
  if (Option.isNone(decoded)) problems.push(MACHINE_FIELD_PROBLEMS[key]);
  return Option.getOrNull(decoded);
}

export function parseMachineConfig(value: unknown): MachineConfigRead {
  if (!Predicate.isObject(value)) {
    return { config: createMachineConfig(), problems: [NOT_AN_OBJECT_PROBLEM], unreadable: false };
  }
  const problems: string[] = [];
  const config: MachineConfig = {
    version: 1,
    roots: dedupe(readField(value, 'roots', decodeRoots, problems) ?? []),
    onboardedAt: readField(value, 'onboardedAt', decodeTime, problems),
    port: readField(value, 'port', decodePort, problems),
    hostname: readField(value, 'hostname', decodeText, problems),
    editor: readField(value, 'editor', decodeText, problems),
    terminal: readField(value, 'terminal', decodeText, problems),
  };
  return { config, problems, unreadable: false };
}

export function readMachineConfig(path: string): MachineConfigRead {
  if (!existsSync(path)) return { config: createMachineConfig(), problems: [], unreadable: false };
  const text = Result.try({ try: () => readFileSync(path, 'utf8'), catch: describeError });
  const value = Result.flatMap(text, (read) =>
    Result.mapError(decodeJsonText(read), (error) => error.message)
  );
  return Result.match(value, {
    onFailure: (reason) => ({
      config: createMachineConfig(),
      problems: [`The file is not valid JSON (${reason}).`],
      unreadable: true,
    }),
    onSuccess: parseMachineConfig,
  });
}
