import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { waitFor } from '@testing-library/react';
import { selectChangelogView } from '@/lib/changelog.ts';
import type { Command } from '@/lib/command/registry.ts';
import { listVersionSections } from '@/lib/command/versions.ts';
import * as versions from '@/lib/connection/versions.ts';
import { answerFetch } from '../../support/fetch-fake.ts';
import { createProgram, createVersions } from '../../support/versions.ts';

let update: Mock<typeof versions.requestUpdate>;

beforeEach(() => {
  update = spyOn(versions, 'requestUpdate').mockResolvedValue(true);
});

afterEach(() => {
  update.mockRestore();
});

function listCommands(...args: Parameters<typeof listVersionSections>) {
  const [section] = listVersionSections(...args);
  return section?.commands ?? [];
}

function run(command: Command | undefined) {
  if (command?.kind !== 'run') throw new Error('Not a run command');
  command.run();
}

describe('the Versions commands', () => {
  it('offers Update Claude Code before the versions are read', () => {
    const commands = listCommands(null, [], false);
    expect(commands.map((command) => [command.label, command.hint, command.disabled])).toEqual([
      ['Update Claude Code', undefined, undefined],
    ]);
    run(commands[0]);
    expect(update).toHaveBeenCalledWith('claude');
  });

  it('names what each update would do, and holds one that is running', () => {
    const snapshot = createVersions();
    expect(
      listCommands(snapshot, ['codex'], false).map((command) => [
        command.label,
        command.hint,
        command.disabled,
      ])
    ).toEqual([
      ['Update Claude Code', '2.1.287 → 2.1.310', undefined],
      ['Update Codex', 'Updating…', 'Updating…'],
    ]);
    expect(listCommands(snapshot, [], false).map((command) => command.hint)).toEqual([
      '2.1.287 → 2.1.310',
      'Up to date',
    ]);
    run(listCommands(snapshot, [], false)[1]);
    expect(update).toHaveBeenCalledWith('codex');
  });

  it('leaves out a program that is missing or set by an override', () => {
    const snapshot = createVersions({
      programs: [
        createProgram({ status: 'not_installed', path: null }),
        createProgram({ id: 'codex', label: 'Codex', status: 'unknown', override: '/wrap' }),
      ],
    });
    expect(listCommands(snapshot, [], false)).toEqual([]);
  });

  it('opens the whole changelog first, when the engine serves one', async () => {
    const requests = answerFetch(() => Response.json({ releases: [] }));
    const commands = listCommands(null, [], true);
    expect(commands.map((command) => command.label)).toEqual(['What’s new in Shinsa', 'Update Claude Code']);
    run(commands[0]);
    expect(selectChangelogView()).toMatchObject({ open: true, since: null });
    await waitFor(() => expect(requests.map((request) => request.path)).toEqual(['/api/changelog']));
  });
});
