import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CLI_COMMANDS,
  describeCliUsage,
  REFERENCE_MARKER,
  replaceReference,
  selectCliCommand,
  USAGE,
  USAGE_ALL,
} from '../../src/cli/help.ts';
import { isSurfaceGroup } from '../../src/cli/surface.ts';
import { listUncatalogedGroups } from '../../src/surface/index.ts';

describe('shinsa help', () => {
  test('puts the everyday commands first, then the engine, then every group by section', () => {
    const lines = USAGE.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Shinsa hands coding work to agents and brings back only the decisions.',
      '',
      'Everyday',
      `  ${'shinsa [folder]'.padEnd(28)} Open the app, on the project of a folder: shinsa . for this one.`,
    ]);
    expect(lines).toContain(`  ${'shinsa do <request...>'.padEnd(28)} Hand Shinsa a piece of work.`);
    expect(lines).toContain(
      `  ${'shinsa restart'.padEnd(28)} Restart the engine, now or once agents are idle.`
    );
    expect(lines).toContain(`  ${'tasks'.padEnd(14)} List, show, create and steer tasks.`);
    expect(USAGE.indexOf('Everyday')).toBeLessThan(USAGE.indexOf('Engine ('));
    expect(USAGE.indexOf('Engine (')).toBeLessThan(USAGE.indexOf('\nWork\n'));
    expect(USAGE).not.toMatch(/\bserve\b/);
    expect(USAGE).not.toContain('shinsa engine');
  });

  test('every group of the surface has a line, and --all lists every command', () => {
    expect(listUncatalogedGroups()).toEqual([]);
    expect(listUncatalogedGroups([{ path: ['later'] } as never])).toEqual(['later']);
    expect(USAGE_ALL).toContain(`  shinsa ${'schedules write'.padEnd(26)} Create a schedule`);
  });

  test('no group shadows a command of the top level', () => {
    for (const command of CLI_COMMANDS) expect(isSurfaceGroup(command.name)).toBe(false);
    expect(isSurfaceGroup('engine')).toBe(false);
  });

  test('a command’s own help has its usage, what it does, its options and examples', () => {
    const command = selectCliCommand('restart');
    expect(command).not.toBeNull();
    expect(selectCliCommand('serve')).toBeNull();
    expect(describeCliUsage(command as NonNullable<typeof command>)).toBe(
      [
        'Restart the engine, now or once agents are idle.',
        '',
        'Usage',
        '  shinsa restart [--when-idle]',
        '',
        'Restarts the engine and waits until the new one answers. Runs it cuts off resume on their own sessions.',
        '',
        'Options',
        `  ${'--when-idle'.padEnd(22)} Wait until no agent is mid-turn, then restart.`,
        '',
        'Examples',
        '  shinsa restart',
        '  shinsa restart --when-idle',
      ].join('\n')
    );
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
    expect(fresh.startsWith(`# Title\n\n${REFERENCE_MARKER}\n\n## Everyday commands`)).toBe(true);
  });
});
