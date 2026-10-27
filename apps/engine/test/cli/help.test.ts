import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CLI_COMMANDS,
  describeCliUsage,
  describeHelp,
  describeHelpAll,
  REFERENCE_MARKER,
  replaceReference,
  selectCliCommand,
} from '../../src/cli/help.ts';
import { isSurfaceGroup } from '../../src/cli/surface.ts';
import { listUncatalogedGroups } from '../../src/surface/index.ts';
import { PLAIN_DISPLAY, PLAIN_STYLE } from '../../src/terminal/index.ts';
import { createStyle, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';

const COLOR = { style: createStyle({ color: true, symbols: UNICODE_SYMBOLS }), width: 100 };

const USAGE = describeHelp();

describe('shinsa help', () => {
  test('opens with the commands that open Shinsa and hand it work, then the engine, then every group by section', () => {
    const lines = USAGE.split('\n');
    const term = (text: string) => text.padEnd(25);
    expect(lines.slice(0, 7)).toEqual([
      'Shinsa hands coding work to agents and brings back only the decisions. (0.0.0)',
      '',
      'Usage',
      '  shinsa <command> [arguments] [--json]',
      '',
      'Open Shinsa and hand it work',
      `  ${term('shinsa [folder]')}Open the app; in a repository, open it on that repository’s project.`,
    ]);
    expect(lines).toContain(
      `  ${term('shinsa do <request...>')}Create a task from a request; Shinsa picks the kind of work and runs it.`
    );
    expect(lines).toContain(
      `  ${term('shinsa restart')}Restart the engine now, or with --when-idle once no agent is mid-turn.`
    );
    expect(lines).toContain(
      `  ${term('tasks')}List, open and create tasks; message, retry, reprioritize, cancel or finish one.`
    );
    const engine = USAGE.indexOf('Check and control the background engine');
    expect(USAGE.indexOf('Open Shinsa and hand it work')).toBeLessThan(engine);
    expect(USAGE.indexOf('shinsa status')).toBeGreaterThan(engine);
    expect(engine).toBeLessThan(USAGE.indexOf('\nSteer tasks and answer what agents ask\n'));
    expect(USAGE).not.toMatch(/\bserve\b/);
    expect(USAGE).not.toContain('shinsa engine');
    expect(USAGE).not.toContain('keeps it running');
    expect(
      describeHelp(PLAIN_DISPLAY, { version: '0.5.0', commit: 'a'.repeat(40), flavor: 'stable' })
    ).toStartWith('Shinsa hands coding work to agents and brings back only the decisions. (0.5.0 (aaaaaaa))');
  });

  test('in a terminal headings are bold, commands take the accent and arguments are dim', () => {
    const lines = describeHelp(COLOR).split('\n');
    expect(lines[0]).toBe(
      '\u001b[1mShinsa\u001b[22m hands coding work to agents and brings back only the decisions. \u001b[2m(0.0.0)\u001b[22m'
    );
    expect(lines).toContain('\u001b[1mOpen Shinsa and hand it work\u001b[22m');
    expect(lines).toContain(
      `  \u001b[36mshinsa do\u001b[39m \u001b[2m<request...>\u001b[22m   Create a task from a request; Shinsa picks the kind of work and runs it.`
    );
    expect(lines.at(-1)).toContain('\u001b[36mshinsa help --all\u001b[39m');
  });

  test('descriptions wrap to the terminal with a hanging indent', () => {
    const lines = describeHelp({ style: PLAIN_STYLE, width: 60 }).split('\n');
    const at = lines.indexOf(`  ${'shinsa [folder]'.padEnd(25)}Open the app; in a repository,`);
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at + 1, at + 3)).toEqual([
      `${' '.repeat(27)}open it on that repository’s`,
      `${' '.repeat(27)}project.`,
    ]);
    expect(lines.every((line) => line.length <= 60)).toBe(true);
  });

  test('every group of the surface has a line, and --all lists every command', () => {
    expect(listUncatalogedGroups()).toEqual([]);
    expect(listUncatalogedGroups([{ path: ['later'] } as never])).toEqual(['later']);
    const all = describeHelpAll().split('\n');
    expect(all).toContain(
      `  ${'shinsa schedules write'.padEnd(32)}Create a schedule, or change one with --id: it starts a new task or messages a task once, on an interval, daily or when its webhook is called.`
    );
    expect(all.at(-1)).toBe('Add --help to any command for its arguments, --json for JSON.');
  });

  test('no group shadows a command of the top level', () => {
    for (const command of CLI_COMMANDS) expect(isSurfaceGroup(command.name)).toBe(false);
    expect(isSurfaceGroup('engine')).toBe(false);
  });

  test('a command’s own help has its usage, what it does, its options and examples', () => {
    const command = selectCliCommand('restart');
    expect(command).not.toBeNull();
    expect(selectCliCommand('serve')).toBeNull();
    const restart = command as NonNullable<typeof command>;
    expect(describeCliUsage(restart)).toBe(
      [
        'Restart the engine now, or with --when-idle once no agent is mid-turn.',
        '',
        'Usage',
        '  shinsa restart [--when-idle]',
        '',
        'Restarts the engine and waits until the new one answers. Runs it cuts off resume on their own sessions.',
        '',
        'Options',
        '  --when-idle  Wait until no agent is mid-turn, then restart.',
        '',
        'Examples',
        '  shinsa restart',
        '  shinsa restart --when-idle',
      ].join('\n')
    );
    expect(describeCliUsage(restart, { style: PLAIN_STYLE, width: 40 }).split('\n').slice(10, 14)).toEqual([
      'Options',
      '  --when-idle',
      '      Wait until no agent is mid-turn,',
      '      then restart.',
    ]);
    expect(describeCliUsage(restart, COLOR)).toContain('  \u001b[36mshinsa restart\u001b[39m [--when-idle]');
    const start = selectCliCommand('start');
    expect(describeCliUsage(start as NonNullable<typeof start>)).not.toContain('Options');
  });
});

describe('docs/cli.md', () => {
  test('keeps the written design and regenerates the reference after the marker', () => {
    const written = readFileSync(new URL('../../../../docs/cli.md', import.meta.url), 'utf8');
    expect(written).toBe(replaceReference(written));
    expect(written).toContain('### shinsa [folder]');
    expect(written).toContain('### shinsa stop');
    expect(written).toContain(
      'Yours alone: an agent’s shell may not run it, since the engine runs the agent.'
    );
    const fresh = replaceReference('# Title\n');
    expect(fresh.startsWith(`# Title\n\n${REFERENCE_MARKER}\n\n## Open Shinsa and hand it work`)).toBe(true);
  });
});
