import { DomainError } from '@shinsa/core';
import { describeError } from '../log/index.ts';
import {
  describeGroup,
  describeUsage,
  listGroup,
  readArgv,
  SURFACE,
  type SurfaceSpec,
  selectSpec,
} from '../surface/index.ts';
import { type Display, selectClosest } from '../terminal/index.ts';
import { createSurfaceClient, type EngineWake } from './api.ts';

export interface SurfaceIo {
  base: string;
  display: Display;
  write: (line?: string) => void;
  wake?: EngineWake;
}

function isHelp(words: string[]) {
  return words.length === 0 || words.includes('--help') || words.includes('-h') || words[0] === 'help';
}

function writeJson(io: SurfaceIo, value: unknown) {
  io.write(JSON.stringify(value, null, 2));
}

async function runSpec(spec: SurfaceSpec, args: string[], io: SurfaceIo) {
  const json = args.includes('--json');
  try {
    const parsed = readArgv(spec.fields, args);
    if (parsed.help) {
      io.write(describeUsage(spec, io.display));
      return 0;
    }
    const client = {
      ...createSurfaceClient(io.base, parsed.idempotencyKey ?? `cli:${Bun.randomUUIDv7()}`, io.wake),
    };
    const result = await spec.run(client, parsed.values, io.display);
    if (json) writeJson(io, result.data);
    else io.write(result.text);
    return 0;
  } catch (error) {
    if (!json) throw error;
    const code = error instanceof DomainError ? error.code : 'command_failed';
    writeJson(io, { error: { code, message: describeError(error) } });
    return 1;
  }
}

export function isSurfaceGroup(word: string, specs: SurfaceSpec[] = SURFACE) {
  return listGroup(word, specs).length > 0;
}

export function runSurface(words: string[], io: SurfaceIo, specs: SurfaceSpec[] = SURFACE): Promise<number> {
  const [group = ''] = words;
  const found = selectSpec(words, specs);
  if (!found) {
    if (isHelp(words.slice(1))) {
      io.write(describeGroup(group, specs, io.display));
      return Promise.resolve(0);
    }
    const actions = listGroup(group, specs).map((spec) => spec.path.slice(1).join(' '));
    const closest = selectClosest(words[1] ?? '', actions);
    const hint = closest ? `Did you mean \`shinsa ${group} ${closest}\`? ` : '';
    throw new DomainError(
      'command_unknown',
      `No command shinsa ${words.slice(0, 2).join(' ')}. ${hint}Run \`shinsa ${group} --help\` for its commands.`
    );
  }
  return runSpec(found.spec, found.rest, io);
}
