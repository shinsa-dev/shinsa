import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IntegrationSettings } from '@/components/settings/integrations.tsx';
import { resetExtensions, stopSignInWatch } from '@/lib/connection/extensions.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createExtensions, createPlugin, createServer, createSkill } from '../../support/extensions.ts';
import { findTooltipText } from '../../support/hover.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { createProject, createRepo, createShinsaState } from '../../support/state.ts';

const DAY = 86_400_000;

const SNAPSHOT = createExtensions({
  usage: { readAt: Date.now(), since: Date.now() - 90 * DAY },
  servers: [
    createServer(
      {
        id: 'linear',
        signedIn: true,
        lastUsedAt: Date.now() - 40 * DAY,
        definedIn: [
          { id: 'linear', source: 'shinsa', origin: 'Shinsa', scope: { kind: 'everywhere' }, enabled: true },
          {
            id: 'claude:linear',
            source: 'claude',
            origin: '~/.claude.json',
            scope: { kind: 'everywhere' },
            enabled: true,
          },
        ],
      },
      { state: 'connected', tokens: 4_200, tools: [{ name: 'list_issues', description: 'List issues.' }] }
    ),
    createServer(
      { id: 'sentry', source: 'claude', origin: '~/.claude.json', editable: false },
      { state: 'needs_sign_in' }
    ),
    createServer(
      { id: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'gh'], url: null, envKeys: ['TOKEN'] },
      { state: 'failing', error: 'GITHUB_TOKEN is not set.' }
    ),
    createServer({ id: 'deploy', source: 'plugin', plugin: 'vercel', editable: false }),
  ],
  plugins: [
    createPlugin({ id: 'vercel', name: 'Vercel', enabled: false, skills: 2, hooks: true }),
    createPlugin({ id: 'stripe', name: 'Stripe', tokens: 2_000 }),
  ],
  skills: [
    createSkill({ id: 'handover', source: 'shinsa', origin: 'Shinsa' }),
    ...Array.from({ length: 7 }, (_, index) => createSkill({ id: `skill-${index}`, tokens: 1_000 })),
    createSkill({ id: 'ship', source: 'plugin', plugin: 'vercel' }),
  ],
  problems: ['~/.codex/config.toml could not be read.'],
});

const STATE = createShinsaState({
  projects: [createProject({ id: 'sw', name: 'Superwall' })],
  repos: [createRepo({ id: 'paywall' })],
});

let fake: ReturnType<typeof startFakeOnboarding>;

let toasts: ReturnType<typeof spyOnToasts>;

let opened: Mock<typeof window.open>;

beforeEach(() => {
  resetExtensions();
  toasts = spyOnToasts();
  opened = spyOn(window, 'open').mockReturnValue(null);
  const answer = { answer: SNAPSHOT };
  fake = startFakeOnboarding({
    'GET /api/extensions': answer,
    'POST /api/extensions/check': answer,
    'POST /api/extensions/servers/add': answer,
    'POST /api/extensions/servers/update': answer,
    'POST /api/extensions/servers/remove': answer,
    'POST /api/extensions/servers/choose': answer,
    'POST /api/extensions/servers/sign-in': {
      answer: { authorizationUrl: 'https://auth.example/x', snapshot: SNAPSHOT },
    },
    'POST /api/extensions/skills/choose': answer,
    'POST /api/extensions/plugins/choose': answer,
    'POST /api/extensions/optimizer': answer,
  });
});

afterEach(() => {
  stopSignInWatch();
  act(() => resetExtensions());
  fake.stop();
  toasts.restore();
  opened.mockRestore();
});

function bodiesTo(path: string) {
  return fake.requests.filter((request) => request.path === path).map((request) => request.body);
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function renderIntegrations(path = '/settings?tab=integrations') {
  history.replaceState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
  render(
    <TooltipProvider>
      <IntegrationSettings state={STATE} />
    </TooltipProvider>
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Show details: linear', hidden: true })).toBeTruthy()
  );
  await settle();
}

function findBlock(name: string) {
  let block = screen.getByRole('button', { name: new RegExp(`details: ${name}$`) })
    .parentElement as HTMLElement;
  while (!within(block).queryByRole('button', { name: 'MCP options' })) {
    block = block.parentElement as HTMLElement;
  }
  return block;
}

async function pickFromMenu(server: string, item: string) {
  fireEvent.click(within(findBlock(server)).getByRole('button', { name: 'MCP options' }));
  await settle();
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
  await settle();
}

describe('Settings → Integrations', () => {
  it('groups the servers by status, says what each costs or why it can’t, and checks them once', async () => {
    await renderIntegrations();
    expect(screen.queryByText(/Agents load every server turned on here/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Connected/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Failing/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Needs sign-in/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Off/ })).toBeTruthy();
    expect(screen.getAllByText('~4.2k tokens').length).toBeGreaterThan(0);
    expect(screen.getByText('Shinsa, Claude Code')).toBeTruthy();
    expect(screen.getByText('Sign in to measure')).toBeTruthy();
    expect(screen.getByText('Can’t measure while failing')).toBeTruthy();
    expect(screen.getByText('Not measured while off')).toBeTruthy();
    expect(screen.getByText('~/.codex/config.toml could not be read.')).toBeTruthy();
    expect(screen.queryByText('2 skills, hooks')).toBeNull();
    expect(screen.getByText('7 of 7 on · ~7k tokens')).toBeTruthy();
    expect(bodiesTo('/api/extensions/check')).toEqual([{}]);
    fireEvent.click(screen.getByRole('switch', { name: 'Use deploy for Shinsa’s agents' }));
    await settle();
    expect(bodiesTo('/api/extensions/servers/choose')).toEqual([]);
  });

  it('turns servers, plugins and skills on and off, saying a server stays on in Claude Code', async () => {
    await renderIntegrations();
    fireEvent.click(screen.getByRole('switch', { name: 'Use linear for Shinsa’s agents' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Use the Stripe plugin' }));
    fireEvent.click(screen.getByRole('button', { name: /Claude Code on this machine/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Use the skill-0 skill' }));
    await settle();
    expect(bodiesTo('/api/extensions/servers/choose')).toEqual([{ serverId: 'linear', enabled: false }]);
    expect(bodiesTo('/api/extensions/plugins/choose')).toEqual([{ pluginId: 'stripe', enabled: false }]);
    expect(bodiesTo('/api/extensions/skills/choose')).toEqual([{ skillId: 'skill-0', enabled: false }]);
    expect(toasts.success).toHaveBeenCalledWith(
      'Turned off linear for Shinsa’s agents. Claude Code and Codex keep their own settings.'
    );
  });

  it('opens the sign-in page for a server that waits for one', async () => {
    await renderIntegrations();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await settle();
    expect(bodiesTo('/api/extensions/servers/sign-in')).toEqual([{ serverId: 'sentry' }]);
    expect(opened).toHaveBeenLastCalledWith('https://auth.example/x', '_blank');
  });

  it('shows an MCP’s tools, each described on hover, over one quiet line, from its row or its menu', async () => {
    await renderIntegrations();
    expect(screen.queryByText('list_issues')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show details: linear' }));
    expect(await findTooltipText(screen.getByText('list_issues'))).toBe('List issues.');
    expect(screen.getByText(/^Defined in Shinsa, ~\/\.claude\.json · .*Not used in 40 days$/)).toBeTruthy();
    await pickFromMenu('linear', 'Hide details');
    expect(screen.queryByText('list_issues')).toBeNull();
    await pickFromMenu('github', 'Show details');
    expect(screen.getByText('GITHUB_TOKEN is not set.')).toBeTruthy();
    expect(screen.queryByText('npx -y gh')).toBeNull();
    expect(await findTooltipText(screen.getByText(/^Shinsa · /))).toBe('npx -y gh');
  });

  it('moves a server to one project from its menu', async () => {
    await renderIntegrations();
    fireEvent.click(within(findBlock('linear')).getByRole('button', { name: 'MCP options' }));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use in one project' }));
    await settle();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Superwall' }));
    await settle();
    expect(bodiesTo('/api/extensions/servers/choose')).toEqual([
      { serverId: 'linear', scope: { kind: 'project', project: 'sw' } },
    ]);
    expect(toasts.success).toHaveBeenCalledWith('Agents use linear only in the Superwall project.');
  });

  it('removes Shinsa’s own server only after you confirm', async () => {
    await renderIntegrations();
    await pickFromMenu('linear', 'Remove');
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    await settle();
    expect(bodiesTo('/api/extensions/servers/remove')).toEqual([]);
    await pickFromMenu('linear', 'Remove');
    fireEvent.click(screen.getByRole('button', { name: 'Remove MCP' }));
    await waitFor(() => expect(bodiesTo('/api/extensions/servers/remove')).toEqual([{ serverId: 'linear' }]));
  });

  it('copies another tool’s server into Shinsa to edit it', async () => {
    await renderIntegrations();
    await pickFromMenu('sentry', 'Copy to Shinsa and edit…');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Copy sentry to Shinsa')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save copy' }));
    await waitFor(() =>
      expect(bodiesTo('/api/extensions/servers/update')).toEqual([
        {
          serverId: 'sentry',
          server: {
            name: 'sentry',
            transport: 'http',
            url: 'https://sentry.example/mcp',
            headers: {},
            scope: { kind: 'everywhere' },
          },
        },
      ])
    );
    expect(toasts.success).toHaveBeenCalledWith('Copied sentry to Shinsa.');
  });

  it('keeps saved secrets unless a new value is typed', async () => {
    await renderIntegrations();
    await pickFromMenu('github', 'Edit…');
    expect(screen.getByText('Leave a value empty to keep the saved one.')).toBeTruthy();
    expect((screen.getByLabelText('Environment') as HTMLTextAreaElement).value).toBe('TOKEN=');
    await settle();
  });

  it('adds a server, saying what is missing first', async () => {
    await renderIntegrations();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add MCP' })[0] as HTMLElement);
    await settle();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add MCP' }));
    await settle();
    expect(within(dialog).getByText('Enter a name.')).toBeTruthy();
    expect(within(dialog).getByText('Enter the command that starts it.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'notion' } });
    fireEvent.change(within(dialog).getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.change(within(dialog).getByLabelText('Arguments'), { target: { value: '-y\nnotion-mcp' } });
    expect(within(dialog).queryByText('Enter a name.')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add MCP' }));
    await waitFor(() =>
      expect(bodiesTo('/api/extensions/servers/add')).toEqual([
        {
          server: {
            name: 'notion',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'notion-mcp'],
            env: {},
            scope: { kind: 'everywhere' },
          },
        },
      ])
    );
    expect(toasts.success).toHaveBeenCalledWith('Added notion.');
  });

  it('opens the add dialog when ⌘K asks for it, and drops the request from the address', async () => {
    await renderIntegrations('/settings?tab=integrations&add=mcp#mcp-servers');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Add an MCP')).toBeTruthy();
    expect(`${location.search}${location.hash}`).toBe('?tab=integrations#mcp-servers');
    await settle();
  });

  it('keeps each skill group closed until you open it, and never lists Shinsa’s own skills', async () => {
    await renderIntegrations();
    expect(screen.queryByText('skill-6')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Shinsa/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Claude Code on this machine/ }));
    expect(screen.getByText('skill-6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Claude Code on this machine/ }));
    expect(screen.queryByText('skill-6')).toBeNull();
  });

  it('finds servers, plugins and skills as you type, opening every group that matches', async () => {
    await renderIntegrations();
    const search = screen.getByRole('searchbox', { name: 'Search MCPs, plugins and skills' });
    fireEvent.change(search, { target: { value: 'skill-6' } });
    await settle();
    expect(location.search).toBe('?tab=integrations&q=skill-6');
    expect(screen.getByText('skill-6')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show details: linear' })).toBeNull();
    expect(screen.queryByText('Context optimizer')).toBeNull();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    await settle();
    expect(screen.getByText('Nothing matches.')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'github' } });
    await settle();
    expect(screen.getByRole('button', { name: 'Show details: github' })).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    await settle();
    expect(location.search).toBe('?tab=integrations');
  });

  it('switches the context optimizer and offers to turn off what agents have not used', async () => {
    await renderIntegrations();
    expect(screen.getByText('Not used in 40 days · ~4.2k tokens')).toBeTruthy();
    expect(screen.getByText('7 skills')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Leave out MCPs agents haven’t used' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Leave out skills too' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await settle();
    expect(bodiesTo('/api/extensions/optimizer')).toEqual([{ enabled: true }, { skills: true }]);
    expect(bodiesTo('/api/extensions/servers/choose')).toEqual([{ serverId: 'linear', enabled: false }]);
    expect(toasts.success).toHaveBeenCalledWith('Agents now leave out MCPs unused for 14 days.');
  });

  it('keeps a long list of failing servers closed until you open it', async () => {
    const failing = Array.from({ length: 8 }, (_, index) =>
      createServer({ id: `broken-${index}` }, { state: 'failing', error: 'down' })
    );
    fake.stop();
    fake = startFakeOnboarding({
      'GET /api/extensions': { answer: { ...SNAPSHOT, servers: [...SNAPSHOT.servers, ...failing] } },
      'POST /api/extensions/check': { answer: { ...SNAPSHOT, servers: [...SNAPSHOT.servers, ...failing] } },
    });
    await renderIntegrations();
    expect(screen.queryByRole('button', { name: 'Show details: broken-0' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Failing/ }));
    expect(screen.getByRole('button', { name: 'Show details: broken-0' })).toBeTruthy();
  });

  it('checks every server from the section header', async () => {
    await renderIntegrations();
    fireEvent.click(screen.getByRole('button', { name: 'Check all MCPs' }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Checked every MCP that is on.'));
  });
});

describe('Settings → Integrations without the server', () => {
  it('says the list could not be read', async () => {
    fake.stop();
    fake = startFakeOnboarding({});
    history.replaceState(null, '', '/settings?tab=integrations');
    render(
      <TooltipProvider>
        <IntegrationSettings state={STATE} />
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(
        screen.getByText('Couldn’t read the MCPs, plugins and skills. Shinsa answered with status 404.')
      ).toBeTruthy()
    );
  });
});
