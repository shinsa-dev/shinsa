import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../../apps/engine/src/store/index.ts';
import { MINUTE } from '../kit/time.ts';
import { writeSeedChangelog } from './changelog.ts';
import { createCodeSample, listCodeTasks } from './code/sample.ts';
import { writeCodeTranscripts } from './code/transcripts.ts';
import { buildEvents } from './events.ts';
import { writeSeedEvidence } from './evidence.ts';
import { NOW, spreadEvents, writeTranscript } from './kit.ts';
import { ROOT, WORKTREES, REPOS, DATA } from './paths.ts';
import { stampRunPrompts } from './prompts.ts';
import { writeSeedServices } from './services.ts';
import { writeDelegationTranscripts } from './tasks/delegation.ts';
import { listTasks } from './tasks/index.ts';
import { writeAccountFiles, writeAccountTranscripts } from './tasks/triggers.ts';
import { listRunTimes, buildRunEvents, writeSessionTranscript } from './transcripts.ts';
import { createRepos, createProjects, createWorktrees } from './workspace.ts';

export function seed() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(WORKTREES, { recursive: true });
  const repos = createRepos();
  const sample = createCodeSample(REPOS, WORKTREES);
  const projects = [...createProjects(), sample.project];
  const seedRepos = [...Object.values(repos), sample.repo];
  const tasks = [...listTasks(repos, createWorktrees(repos)), ...listCodeTasks(sample)];

  const log = new EventLog(join(DATA, 'shinsa.sqlite'));
  const timeline = stampRunPrompts(buildEvents(tasks, projects, seedRepos));
  let seq = 0;
  for (const { at, event } of timeline) {
    log.commitCommand({ events: [event], effects: [], cancellations: [], fromSeq: seq, at, receipt: null });
    seq += 1;
  }
  log.writeBriefing(null, {
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
  log.close();
  writeFileSync(
    join(DATA, 'config.json'),
    `${JSON.stringify({ version: 1, roots: [REPOS], onboardedAt: NOW }, null, 2)}\n`
  );
  writeAccountFiles(DATA);
  writeSeedServices(DATA, projects, seedRepos);
  const transcripts = join(DATA, 'transcripts');
  mkdirSync(transcripts, { recursive: true });
  const runTimes = listRunTimes(tasks, timeline);
  for (const [runId, times] of runTimes) {
    const live = times.endedAt === null;
    const events = buildRunEvents(times, live);
    writeTranscript(transcripts, runId, spreadEvents(events, times.startedAt, times.endedAt ?? NOW - MINUTE));
  }
  writeDelegationTranscripts(transcripts, timeline);
  writeCodeTranscripts(transcripts, timeline, sample);
  writeSeedEvidence(DATA);
  writeAccountTranscripts(transcripts);
  const session = Bun.env.SHINSA_SEED_SESSION;
  if (session) writeSessionTranscript(session, runTimes, transcripts);
  const changelog = writeSeedChangelog(ROOT);
  console.info(`Seeded ${tasks.length} tasks into ${DATA}`);
  console.info(
    `Run: SHINSA_DATA_DIR=${DATA} SHINSA_INSPECT=1 SHINSA_PORT=5190 bun run --cwd apps/engine start`
  );
  console.info(
    `With a long changelog: SHINSA_BUILD_CHANGELOG="$(cat ${changelog})" before the command above`
  );
}
