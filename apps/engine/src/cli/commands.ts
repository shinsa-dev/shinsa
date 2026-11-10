import type { TaskPriority } from '@shinsa/core';
import { Effect } from 'effect';
import { describeVersion, type ServerHealth } from '../instance/index.ts';
import { type CommandReceipt, describeQueue, describeUptime, QUEUE_EMPTY } from '../surface/index.ts';
import {
  type Display,
  describeFields,
  describeInline,
  describeMark,
  describeParagraph,
  shortenHome,
} from '../terminal/index.ts';
import { isPathArgument, resolveHomeLink, resolvePathArgument, resolveTaskLink } from './app.ts';
import { parseArgs } from './args.ts';
import { readHealth } from './engine.ts';
import { CliFailed, type CommandIo } from './schema.ts';

export type { CommandIo } from './schema.ts';

export const readArgs = Effect.fn('Cli.readArgs')(function* (args: string[]) {
  return yield* Effect.fromResult(parseArgs(args)).pipe(
    Effect.mapError((error) => new CliFailed({ message: error.message }))
  );
});

function resolvePriority(flags: Set<string>): TaskPriority {
  if (flags.has('--urgent')) return 'urgent';
  if (flags.has('--high')) return 'high';
  return 'normal';
}

function writeTaskLink(io: CommandIo, receipt: CommandReceipt) {
  const ref = receipt.handle ?? receipt.taskId;
  if (ref) io.write(io.display.style.dim(`${io.api.base}/tasks/${ref}`));
}

function writeDone(io: CommandIo, text: string) {
  io.write(describeMark(io.display.style, 'success', 'check', text));
}

export const createTask = Effect.fn('Cli.createTask')(function* (args: string[], io: CommandIo) {
  const { flags, positional } = yield* readArgs(args);
  const request = positional.join(' ').trim();
  if (!request) {
    return yield* new CliFailed({
      message: 'Say what should be done, such as `shinsa do "fix the scroll in tab groups"`.',
    });
  }
  const result = yield* io.api.sendCommand({
    type: 'task.create',
    request,
    repoId: null,
    priority: resolvePriority(flags),
    planFirst: flags.has('--plan-first'),
    ...(flags.has('--backlog') ? { backlog: true } : {}),
    origin: io.cwd,
  });
  writeDone(
    io,
    flags.has('--backlog')
      ? 'Added to the backlog. It plans now and builds when you start it.'
      : 'Started. Shinsa brings it back when it needs a decision.'
  );
  writeTaskLink(io, result);
});

function describeDamage(count: number) {
  return count === 1
    ? 'It skipped 1 damaged entry in its log at start. `shinsa health` shows it.'
    : `It skipped ${count} damaged entries in its log at start. \`shinsa health\` lists them.`;
}

function describeStopped(display: Display) {
  const { style } = display;
  return [
    describeMark(style, 'danger', 'dot', `${style.bold('Stopped')}  The engine is not running.`),
    ...describeParagraph(
      display,
      '`shinsa start` starts it, and so does opening the Shinsa app.',
      style.symbols ? 2 : 0,
      'dim'
    ),
  ];
}

function describeEngineBlock(health: ServerHealth, io: CommandIo) {
  const { display } = io;
  const { style } = display;
  const indent = style.symbols ? 2 : 0;
  return [
    describeMark(style, 'success', 'dot', `${style.bold('Running')}  Shinsa ${describeVersion(health)}`),
    ...describeFields(
      display,
      [
        ['Uptime', describeUptime(health.uptimeMs)],
        ['Address', io.api.base],
        ['Process', String(health.pid)],
        ['Engine', shortenHome(health.installPath, io.home)],
        ['Data', shortenHome(health.dataDir, io.home)],
      ],
      indent
    ),
    ...(health.ok
      ? []
      : [
          '',
          describeMark(
            style,
            'warning',
            'warning',
            describeInline(style, describeDamage(health.problems.length))
          ),
        ]),
  ];
}

export const printStatus = Effect.fn('Cli.printStatus')(function* (args: string[], io: CommandIo) {
  const json = (yield* readArgs(args)).flags.has('--json');
  const health = yield* readHealth(io.api.base);
  if (!health) {
    if (json) io.write(JSON.stringify({ engine: null, queue: null }, null, 2));
    else for (const line of describeStopped(io.display)) io.write(line);
    return 1;
  }
  const summary = yield* io.api.readQueue();
  if (json) {
    io.write(JSON.stringify({ engine: health, queue: summary }, null, 2));
    return 0;
  }
  const queue = describeQueue(summary, io.display);
  const briefing = summary.briefing ?? (queue.length === 0 ? QUEUE_EMPTY : null);
  const lines = [
    ...describeEngineBlock(health, io),
    ...(briefing ? ['', ...describeParagraph(io.display, briefing)] : []),
    ...(queue.length > 0 ? ['', ...queue] : []),
  ];
  for (const line of lines) io.write(line);
  return 0;
});

const focusFolder = Effect.fn('Cli.focusFolder')(function* (dir: string, io: CommandIo) {
  const root = yield* io.readRepoRoot(dir);
  if (!root) {
    io.write(`${dir} is not in a git repository, so Shinsa opens on Home.`);
    return;
  }
  const { repos } = yield* io.api.readRepos();
  const repo = repos.find((entry) => entry.path === root);
  if (!repo) {
    io.write(`Shinsa has not worked in ${root} yet. Ask for something there and it joins your projects.`);
    return;
  }
  if (!repo.projectId) return;
  yield* io.api.sendCommand({ type: 'focus.change', projectId: repo.projectId, until: null });
});

export const openApp = Effect.fn('Cli.openApp')(function* (args: string[], io: CommandIo) {
  const [target] = (yield* readArgs(args)).positional;
  if (!target) return yield* io.openApp(resolveHomeLink());
  if (!isPathArgument(target)) return yield* io.openApp(resolveTaskLink(target));
  yield* focusFolder(resolvePathArgument(target, io.cwd), io);
  yield* io.openApp(resolveHomeLink());
});
