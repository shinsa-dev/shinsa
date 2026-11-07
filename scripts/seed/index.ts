import { join } from 'node:path';
import { Console, Effect, FileSystem } from 'effect';
import { Briefings } from '../../apps/engine/src/store/briefings/service.ts';
import { CommandLog } from '../../apps/engine/src/store/commands/service.ts';
import { StoreLayer } from '../../apps/engine/src/store/layers.ts';
import { MINUTE } from '../kit/time.ts';
import { serializeSeedChangelog } from './changelog.ts';
import { createCodeSample, listCodeTasks } from './code/sample.ts';
import { listCodeTranscripts } from './code/transcripts.ts';
import { buildEvents } from './events.ts';
import { writeSeedEvidence } from './evidence.ts';
import {
  readSeedText,
  removeSeedPath,
  writeSeedFile,
  writeSeedServices,
  writeSeedTranscripts,
} from './files.ts';
import { NOW, type SeedTranscript, spreadEvents } from './kit.ts';
import { DATA, REPOS, ROOT, WORKTREES } from './paths.ts';
import { stampRunPrompts } from './prompts.ts';
import { listDelegationTranscripts } from './tasks/delegation.ts';
import { listTasks } from './tasks/index.ts';
import { ACCOUNT_MOVE_TRANSCRIPT, insertAccountNotices, listAccountFiles } from './tasks/triggers.ts';
import { buildRunEvents, convertSessionTranscript, listRunTimes, SESSION_TRANSCRIPT } from './transcripts.ts';
import { createProjects, createRepos, createWorktrees } from './workspace.ts';

export const seed = Effect.fn('Seed.run')(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* removeSeedPath(ROOT);
  yield* fs.makeDirectory(WORKTREES, { recursive: true });
  const repos = yield* createRepos();
  const sample = yield* createCodeSample(REPOS, WORKTREES);
  const projects = [...createProjects(), sample.project];
  const seedRepos = [...Object.values(repos), sample.repo];
  const tasks = [...listTasks(repos, yield* createWorktrees(repos)), ...listCodeTasks(sample)];

  const timeline = stampRunPrompts(buildEvents(tasks, projects, seedRepos));
  yield* Effect.gen(function* () {
    const log = yield* CommandLog;
    for (const [seq, { at, event }] of timeline.entries())
      yield* log.commit({ events: [event], effects: [], cancellations: [], fromSeq: seq, at, receipt: null });
    const briefings = yield* Briefings;
    yield* briefings.write(null, {
      at: NOW - 3 * MINUTE,
      text: 'Start with “Run the embedded chat on MCP v2”: it is ready for review, and the tool calls work waits on it. Then “Refuse to duplicate code-first paywalls” and “Rewrite the framework command registry”.',
      briefing: {
        now: {
          taskId: 'task-embedded-chat',
          why: 'Built and checked, and “Let the embedded chat call paywall tools” waits on it, so reviewing it first frees that work',
        },
        next: [
          { taskId: 'task-duplicate', why: 'Pull request #4531 is clean and ready to merge' },
          {
            taskId: 'task-command-registry',
            why: 'The rewrite is built, and the agent review found two blocking problems in the flag parser',
          },
        ],
        running: 'Agents are working on the remaining tasks.',
        note: null,
      },
    });
  }).pipe(Effect.provide(StoreLayer(join(DATA, 'shinsa.sqlite'))));
  yield* writeSeedFile(
    join(DATA, 'config.json'),
    `${JSON.stringify({ version: 1, roots: [REPOS], onboardedAt: NOW }, null, 2)}\n`
  );
  for (const [name, content] of Object.entries(listAccountFiles(DATA)))
    yield* writeSeedFile(join(DATA, name), content);
  yield* writeSeedServices(DATA, projects, seedRepos);
  const transcripts = join(DATA, 'transcripts');
  const runTimes = listRunTimes(tasks, timeline);
  const runs = runTimes.map(([runId, times]): SeedTranscript => ({
    runId,
    timed: spreadEvents(
      buildRunEvents(times, times.endedAt === null),
      times.startedAt,
      times.endedAt ?? NOW - MINUTE
    ),
  }));
  yield* fs.makeDirectory(transcripts, { recursive: true });
  yield* writeSeedTranscripts(transcripts, [
    ...runs,
    ...listDelegationTranscripts(timeline),
    ...listCodeTranscripts(timeline, sample),
  ]);
  yield* writeSeedEvidence(DATA);
  const accountMove = join(transcripts, ACCOUNT_MOVE_TRANSCRIPT);
  yield* writeSeedFile(accountMove, insertAccountNotices(yield* readSeedText(accountMove)));
  const session = Bun.env.SHINSA_SEED_SESSION;
  if (session) {
    const converted = convertSessionTranscript(yield* readSeedText(session), runTimes);
    for (const image of converted.images)
      yield* writeSeedFile(join(DATA, 'evidence', image.file), image.bytes);
    yield* writeSeedFile(join(transcripts, SESSION_TRANSCRIPT), converted.transcript);
    yield* Console.info(`Seeded a crowded chat with ${converted.count} entries from ${session}`);
  }
  const changelog = join(ROOT, 'changelog.json');
  yield* writeSeedFile(changelog, serializeSeedChangelog());
  yield* Console.info(`Seeded ${tasks.length} tasks into ${DATA}`);
  yield* Console.info(
    `Run: SHINSA_DATA_DIR=${DATA} SHINSA_INSPECT=1 SHINSA_PORT=5190 bun run --cwd apps/engine start`
  );
  yield* Console.info(
    `With a long changelog: SHINSA_BUILD_CHANGELOG="$(cat ${changelog})" before the command above`
  );
});
