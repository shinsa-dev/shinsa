import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Config, Console, Effect, FileSystem, Option } from 'effect';
import { listReleaseEntries, serializeReleaseBody } from './changelog-rules.ts';
import { Command, CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import {
  describeReleaseChannel,
  parseReleaseOptions,
  resolveChangesSinceTag,
  resolveReleasePlan,
} from './release-version.ts';
import { recordActionsOutputs, recordStepSummary } from './release/actions.ts';
import { listReleasedSlugs, listTags, listValidEntries } from './release/changes.ts';
import { ReleaseRefused } from './release/schema.ts';

const program = Effect.gen(function* () {
  const command = yield* Command;
  const fs = yield* FileSystem.FileSystem;
  const settings = yield* Effect.orDie(
    Config.all({
      channel: Config.option(Config.String('RELEASE_CHANNEL')),
      bump: Config.option(Config.String('RELEASE_BUMP')),
      notesDir: Config.String('RUNNER_TEMP').pipe(Config.withDefault(tmpdir())),
    })
  );
  const { channel, bump } = yield* Effect.try({
    try: () =>
      parseReleaseOptions(
        settings.channel.pipe(Option.getOrUndefined),
        settings.bump.pipe(Option.getOrUndefined)
      ),
    catch: (error) => new ReleaseRefused({ message: error instanceof Error ? error.message : String(error) }),
  });
  const root = yield* command.text(['git', 'rev-parse', '--show-toplevel']);
  const plan = resolveReleasePlan({ tags: [...(yield* listTags(root))], channel, bump });
  const entries = yield* listValidEntries(root);
  const since = resolveChangesSinceTag(plan);
  const released = since ? yield* listReleasedSlugs(root, since) : [];
  const notes = listReleaseEntries(entries, released);
  const notesFile = join(settings.notesDir, 'release-notes.md');
  yield* fs.writeFileString(notesFile, serializeReleaseBody(describeReleaseChannel(plan), notes)).pipe(
    Effect.mapError(
      (error) =>
        new ReleaseRefused({
          message: `Could not write the release notes to ${notesFile}: ${error.message}`,
        })
    )
  );

  const outputs = [
    `version=${plan.version}`,
    `tag=${plan.tag}`,
    `prerelease=${plan.prerelease}`,
    `channel=${plan.channel}`,
    `notes_start_tag=${plan.notesStartTag ?? ''}`,
    `notes_file=${notesFile}`,
  ];
  const summary = `Releasing **Shinsa ${plan.version}** on the ${plan.channel} channel (the last stable release is ${plan.lastStable ?? 'none'}), with ${notes.length} changelog ${notes.length === 1 ? 'entry' : 'entries'}.`;
  yield* recordActionsOutputs(outputs);
  yield* recordStepSummary(summary);
  yield* Console.log(`${summary}\n${outputs.join('\n')}`);
});

program.pipe(
  reportFailure,
  Effect.provide(CommandLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
