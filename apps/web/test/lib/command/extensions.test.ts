import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { listExtensionSections } from '@/lib/command/extensions.ts';
import type { Command } from '@/lib/command/registry.ts';
import * as settingsCommands from '@/lib/command/settings.ts';
import * as connection from '@/lib/connection/extensions.ts';
import { createExtensions, createPlugin, createServer, createSkill } from '../../support/extensions.ts';

const VERCEL = createPlugin({ id: 'vercel', name: 'Vercel', enabled: false });

const SNAPSHOT = createExtensions({
  servers: [
    createServer({ id: 'linear' }, { state: 'needs_sign_in' }),
    createServer({ id: 'postgres', enabled: false }),
    createServer({ id: 'deploy', plugin: 'vercel' }),
  ],
  plugins: [VERCEL, createPlugin({ id: 'stripe', name: 'Stripe' })],
  skills: [
    createSkill({ id: 'review' }),
    createSkill({ id: 'pdf', enabled: false }),
    createSkill({ id: 'ship', plugin: 'vercel' }),
    createSkill({ id: 'handover', source: 'shinsa' }),
  ],
});

let chooseServer: Mock<typeof connection.chooseServer>;
let choosePlugin: Mock<typeof connection.choosePlugin>;
let chooseSkill: Mock<typeof connection.chooseSkill>;
let signIn: Mock<typeof connection.signInServer>;
let chooseOptimizer: Mock<typeof connection.chooseOptimizer>;

beforeEach(() => {
  chooseServer = spyOn(connection, 'chooseServer').mockResolvedValue(true);
  choosePlugin = spyOn(connection, 'choosePlugin').mockResolvedValue(true);
  chooseSkill = spyOn(connection, 'chooseSkill').mockResolvedValue(true);
  signIn = spyOn(connection, 'signInServer').mockResolvedValue(true);
  chooseOptimizer = spyOn(connection, 'chooseOptimizer').mockResolvedValue(true);
});

afterEach(() => {
  for (const spy of [chooseServer, choosePlugin, chooseSkill, signIn, chooseOptimizer]) spy.mockRestore();
  history.replaceState(null, '', '/');
});

function listCommands() {
  const [section] = listExtensionSections(SNAPSHOT);
  return section?.commands ?? [];
}

function run(label: string) {
  const command = listCommands().find((entry) => entry.label === label);
  if (command?.kind !== 'run') throw new Error(`${label} is not a run command`);
  command.run();
}

describe('the Integrations group', () => {
  it('always offers adding a server and the three sections, before the snapshot has loaded', () => {
    const [section] = listExtensionSections(null);
    expect(section?.heading).toBe('Integrations');
    expect(section?.commands.map((command) => command.label)).toEqual([
      'Add an MCP',
      'MCPs',
      'Plugins',
      'Skills',
    ]);
  });

  it('opens Settings with the add dialog, or at a section', () => {
    run('Add an MCP');
    expect(`${location.pathname}${location.search}${location.hash}`).toBe(
      '/settings?tab=integrations&add=mcp#mcps'
    );
    const open = spyOn(settingsCommands, 'openSettingsSection').mockImplementation(() => {});
    open.mockClear();
    run('Skills');
    run('MCPs');
    expect(open.mock.calls).toEqual([['Skills'], ['MCPs']]);
    open.mockRestore();
  });

  it('matches each server, plugin and skill only while typing, skipping what an off plugin holds and Shinsa’s own skills', () => {
    const items = listCommands().filter((command: Command) => command.searchOnly);
    expect(items.map((command) => command.label)).toEqual([
      'Connect linear',
      'Turn off linear for agents',
      'Turn on postgres for agents',
      'Turn on the Vercel plugin',
      'Turn off the Stripe plugin',
      'Turn off the review skill',
      'Turn on the pdf skill',
      'Turn on the context optimizer',
    ]);
  });

  it('acts through the same requests the settings page sends', () => {
    run('Connect linear');
    run('Turn on postgres for agents');
    run('Turn on the Vercel plugin');
    run('Turn on the pdf skill');
    run('Turn on the context optimizer');
    expect(chooseOptimizer.mock.calls[0]).toEqual([SNAPSHOT.optimizer, { enabled: true }]);
    expect(signIn.mock.calls[0]?.[0]).toMatchObject({ id: 'linear' });
    expect(chooseServer.mock.calls[0]).toEqual([
      expect.objectContaining({ id: 'postgres' }),
      { enabled: true },
      'Turned on postgres for Shinsa’s agents.',
    ]);
    expect(choosePlugin.mock.calls[0]).toEqual([expect.objectContaining({ id: 'vercel' }), true]);
    expect(chooseSkill.mock.calls[0]).toEqual([expect.objectContaining({ id: 'pdf' }), true]);
  });
});
