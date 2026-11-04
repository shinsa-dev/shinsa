import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect } from 'effect';
import { listChangeFiles } from './changelog-files.ts';
import { MISSING_ENTRY_MESSAGE, needsChangelogEntry, resolveChangelogCheck } from './changelog-rules.ts';
import { Command, CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { ChangelogInvalid, ScriptUsage } from './release/schema.ts';

const program = Effect.gen(function* () {
  const command = yield* Command;
  const [action, ...rest] = process.argv.slice(2);
  const baseIndex = rest.indexOf('--base');
  const base = baseIndex === -1 ? null : rest[baseIndex + 1];
  if (action !== 'check' || base === undefined)
    return yield* new ScriptUsage({ message: 'Usage: bun scripts/changelog.ts check [--base <ref>]' });
  const root = yield* command.text(['git', 'rev-parse', '--show-toplevel']);

  const listChanged = Effect.fn('changelog.listChanged')(function* (ref: string, filter: string) {
    const untracked = yield* command.lines(['git', 'ls-files', '--others', '--exclude-standard'], {
      cwd: root,
    });
    const tracked = yield* command.lines(
      ['git', 'diff', '--name-only', `--diff-filter=${filter}`, '--merge-base', ref],
      { cwd: root }
    );
    return [...tracked, ...untracked];
  });

  const check = resolveChangelogCheck(listChangeFiles(root));
  const errors = check.ok ? [] : [...check.errors];
  if (base !== null && needsChangelogEntry(yield* listChanged(base, 'ACMRD'), yield* listChanged(base, 'A')))
    errors.push(MISSING_ENTRY_MESSAGE);
  if (errors.length > 0) return yield* new ChangelogInvalid({ errors, message: errors.join('\n') });
  const count = check.ok ? check.entries.length : 0;
  yield* Console.log(`Checked ${count} changelog ${count === 1 ? 'entry' : 'entries'}: every one is valid.`);
});

program.pipe(
  reportFailure,
  Effect.provide(CommandLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
