import {
  type ChangeEntry,
  type ChangeKind,
  type Changelog,
  resolveChangelog,
  resolvePublicChangelog,
} from '../../packages/core/src/changelog/index.ts';
import { DAY } from '../kit/time.ts';

const SEED_RELEASE_COUNT = 50;

const SEED_CHANGES: Record<Exclude<ChangeKind, 'internal'>, readonly string[]> = {
  added: [
    'Tasks can now wait on a task in another repository, and start once it merges.',
    'Settings → Updates shows which channel you are on and when Shinsa last looked for an update.',
    'The review report lists every check that ran on the change, with its output one click away.',
    'You can share a task with a link, so someone without Shinsa can read its plan and its review.',
    'The Code tab searches every file of the task’s worktree, not only the files it changed.',
    'Schedules can start a new task every weekday morning at a time you pick.',
    'A task can run a service of its own, such as a dev server, and show its preview in the review.',
  ],
  improved: [
    'Long chats load faster: older turns are drawn only when you scroll back to them.',
    'The queue keeps your place when a task moves, so you no longer lose the one you were reading.',
    'Plans now say which checks prove each phase, so you can judge them before anything is built.',
    'Agent replies wrap long paths and commands instead of pushing the page sideways.',
    'The Home guide groups what needs you by repository when you work in more than one.',
    'Switching accounts when one runs out keeps the agent’s session, so it picks up where it stopped.',
  ],
  fixed: [
    'A pull request whose checks were still running no longer showed as ready to merge.',
    'Dark mode no longer flashes white when you open a task in a new window.',
    'Answering a question from the menu bar now closes the question in every open window.',
    'A task stuck at Building after the Mac slept now carries on when it wakes.',
    'Copying a command from a code block no longer copies the line numbers with it.',
    'The Terminal page keeps its scroll position when you switch tabs and come back.',
  ],
};

const FIRST_RELEASE_AT = Date.UTC(2026, 0, 12);

function listSeedEntries(release: number): ChangeEntry[] {
  return (Object.keys(SEED_CHANGES) as (keyof typeof SEED_CHANGES)[]).flatMap((kind, offset) => {
    const texts = SEED_CHANGES[kind];
    const count = 1 + ((release + offset) % 3);
    return Array.from({ length: count }, (_, index) => ({
      slug: `release-${release}-${kind}-${index + 1}`,
      kind,
      text: texts[(release * 3 + index + offset) % texts.length] ?? texts[0] ?? '',
    }));
  });
}

function createSeedChangelog(): Changelog {
  const changes = Array.from({ length: SEED_RELEASE_COUNT }, (_, release) =>
    listSeedEntries(release).map((entry) => ({
      version: `1.${release}.0`,
      date: new Date(FIRST_RELEASE_AT + release * 6 * DAY).toISOString().slice(0, 10),
      entry,
    }))
  ).flat();
  return resolvePublicChangelog(resolveChangelog(changes));
}

export function serializeSeedChangelog() {
  return JSON.stringify(createSeedChangelog());
}
