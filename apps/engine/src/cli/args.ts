import { Result } from 'effect';
import { FlagValueMissing } from './schema.ts';

export interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
}

const VALUE_FLAGS = new Set(['--lines']);

export function parseArgs(args: string[]): Result.Result<ParsedArgs, FlagValueMissing> {
  const parsed: ParsedArgs = { flags: new Set(), values: new Map(), positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1];
      if (!value) return Result.fail(new FlagValueMissing({ flag: arg, message: `${arg} needs a value.` }));
      parsed.values.set(arg, value);
      index += 1;
    } else if (arg.startsWith('--')) {
      parsed.flags.add(arg);
    } else {
      parsed.positional.push(arg);
    }
  }
  return Result.succeed(parsed);
}
