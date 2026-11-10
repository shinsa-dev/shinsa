import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Effect, FileSystem, Option, Schema } from 'effect';
import { resolveShinsaPaths } from '../config/paths.ts';
import {
  type Display,
  PLAIN_STYLE,
  paintTone,
  type Style,
  stripStyles,
  type Tone,
} from '../terminal/index.ts';
import { parseArgs } from './args.ts';

export const ENGINE_LOG = 'engine.log';

const DEFAULT_LINES = 50;

export interface LogsIo {
  env: Record<string, string | undefined>;
  display: Display;
  write: (line?: string) => void;
}

const LEVEL_TONES: Record<string, Tone> = {
  debug: 'dim',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};

const AREA = /^\[[^\]]+\]/;

function describeField(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function describeMessage(style: Style, message: string) {
  return message.replace(AREA, (area) => style.bold(area));
}

const decodeLogLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export function describeLogLine(line: string, style: Style = PLAIN_STYLE) {
  const entry = Option.getOrNull(decodeLogLine(line));
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return line;
  const { at, level, message, ...fields } = entry as Record<string, unknown>;
  const time = typeof at === 'string' ? style.dim(at.replace('T', ' ').slice(0, 19)) : '';
  const levelText = describeField(level ?? '');
  const tone = LEVEL_TONES[levelText] ?? 'dim';
  const extra = Object.entries(fields).map(
    ([key, value]) => `${style.dim(`${key}=`)}${describeField(value)}`
  );
  return [
    time,
    levelText ? paintTone(style, tone, levelText.padEnd(5)) : '',
    describeMessage(style, describeField(message ?? '')),
    ...extra,
  ]
    .filter((part) => stripStyles(part).trim())
    .join('  ');
}

const readLineCount = Effect.fn('Cli.readLineCount')(function* (raw: string | undefined) {
  if (raw === undefined) return DEFAULT_LINES;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    return yield* new DomainError({
      code: 'arguments_invalid',
      message: '--lines takes a whole number, such as --lines 200.',
    });
  }
  return count;
});

export const printLogs = Effect.fn('Cli.printLogs')(function* (args: string[], io: LogsIo) {
  const fs = yield* FileSystem.FileSystem;
  const { flags, values } = yield* Effect.fromResult(parseArgs(args)).pipe(
    Effect.mapError((error) => new DomainError({ code: 'arguments_invalid', message: error.message }))
  );
  const count = yield* readLineCount(values.get('--lines'));
  const path = join(resolveShinsaPaths(io.env).dataDir, ENGINE_LOG);
  const text = yield* fs.readFileString(path).pipe(
    Effect.mapError(
      () =>
        new DomainError({
          code: 'log_missing',
          message: `There is no engine log at ${path} yet. The engine writes it when the Shinsa app runs it; \`bun dev\` prints to its terminal instead.`,
        })
    )
  );
  const lines = text
    .split('\n')
    .filter((line) => line.trim())
    .slice(-count);
  for (const line of lines) io.write(flags.has('--json') ? line : describeLogLine(line, io.display.style));
});
