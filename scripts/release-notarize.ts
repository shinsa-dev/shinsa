import { basename, join } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect, Redacted } from 'effect';
import { Command, CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { createTempDirectory } from './kit/temp.ts';
import {
  describeNotaryRejection,
  NOTARY_SUBMIT_DELAYS,
  parseNotarySubmission,
  resolveNotaryCredentials,
  retryStep,
  STAPLE_DELAYS,
  warnRetry,
} from './release-retry.ts';
import { NotaryRejected, ScriptUsage } from './release/schema.ts';

const program = Effect.gen(function* () {
  const command = yield* Command;
  const app = process.argv[2];
  if (!app)
    return yield* new ScriptUsage({
      message: 'Name the app: bun scripts/release-notarize.ts release/mac-arm64/Shinsa.app',
    });
  const credentials = yield* resolveNotaryCredentials();
  const account = [
    '--apple-id',
    credentials.appleId,
    '--password',
    Redacted.value(credentials.password),
    '--team-id',
    credentials.teamId,
  ];
  const directory = yield* createTempDirectory('shinsa-notarize-');
  const archive = join(directory, `${basename(app, '.app')}.zip`);
  yield* command.text(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, archive]);
  const output = yield* command
    .text(['xcrun', 'notarytool', 'submit', archive, ...account, '--wait', '--output-format', 'json'])
    .pipe(retryStep({ label: 'Notarize', delays: NOTARY_SUBMIT_DELAYS, onRetry: warnRetry }));
  const submission = yield* parseNotarySubmission(output);
  if (submission.status !== 'Accepted') {
    const log = yield* command.run(['xcrun', 'notarytool', 'log', submission.id, ...account]);
    return yield* new NotaryRejected({ message: describeNotaryRejection(submission, log.stdout) });
  }
  yield* command
    .text(['xcrun', 'stapler', 'staple', app])
    .pipe(retryStep({ label: 'Staple', delays: STAPLE_DELAYS, onRetry: warnRetry }));
  yield* Console.log(`Notarized and stapled ${app} (submission ${submission.id}).`);
});

program.pipe(
  Effect.scoped,
  reportFailure,
  Effect.provide(CommandLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
