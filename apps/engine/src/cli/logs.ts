import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { resolveConfig } from '../config/index.ts';
import {
  type Display,
  PLAIN_STYLE,
  paintTone,
  type Style,
  stripStyles,
  type Tone,
} from '../terminal/index.ts';
import { parseArgs } from './commands.ts';

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

export function describeLogLine(line: string, style: Style = PLAIN_STYLE) {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return line;
  }
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

function readLineCount(raw: string | undefined) {
  if (raw === undefined) return DEFAULT_LINES;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    throw new DomainError('arguments_invalid', '--lines takes a whole number, such as --lines 200.');
  }
  return count;
}

export function printLogs(args: string[], io: LogsIo) {
  const { flags, values } = parseArgs(args);
  const count = readLineCount(values.get('--lines'));
  const path = join(resolveConfig(io.env).dataDir, ENGINE_LOG);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new DomainError(
      'log_missing',
      `There is no engine log at ${path} yet. The engine writes it when the Shinsa app runs it; \`bun dev\` prints to its terminal instead.`
    );
  }
  const lines = text
    .split('\n')
    .filter((line) => line.trim())
    .slice(-count);
  for (const line of lines) io.write(flags.has('--json') ? line : describeLogLine(line, io.display.style));
}
