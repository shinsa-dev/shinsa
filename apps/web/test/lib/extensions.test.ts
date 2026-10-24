import { describe, expect, it } from 'bun:test';
import type { McpServerPlace, McpServerSummary } from '@shinsa/core';
import {
  createServerDraft,
  describeAlreadySignedIn,
  describeChecked,
  describeGroupCount,
  describeLastUsed,
  describeOptimizerChanged,
  describePluginContents,
  describePluginToggled,
  describeScopeChanged,
  describeServerPlaces,
  describeServerRemoval,
  describeServerSources,
  describeServerToggled,
  describeSignedIn,
  describeSignedOut,
  describeSignInFailed,
  describeSkillToggled,
  type ExtensionPlaces,
  filterExtensions,
  formatTokenEstimate,
  hasSavedSecrets,
  isEmptyMatch,
  isMultilineField,
  isServerGroupOpen,
  listDraftFields,
  listOptimizerDayItems,
  listRecommendations,
  listScopeItems,
  listServerNotes,
  listServerStatusGroups,
  listSkillGroups,
  needsConnect,
  OPEN_GROUP_LIMIT,
  parseScope,
  resolveAddServerPath,
  resolveCostText,
  resolveCurrentServer,
  resolveExtensionPlaces,
  resolveFieldNote,
  resolvePathWithoutAdd,
  resolveScopeText,
  resolveServerCost,
  resolveServerCostHint,
  resolveServerDetail,
  resolveServerDialog,
  resolveServerMenu,
  resolveServerSource,
  resolveServerStatus,
  resolveServerTarget,
  resolveShadowText,
  resolveTokenText,
  resolveUnusedDays,
  resolveVisibleRange,
  SERVER_EDIT,
  type ServerDraft,
  type ServerField,
  type ServerStatusGroup,
  SWITCH_LABEL,
  serializeScope,
  validateServerDraft,
} from '@/lib/extensions.ts';
import { createExtensions, createPlugin, createServer, createSkill } from '../support/extensions.ts';
import { createProject, createRepo, createShinsaState } from '../support/state.ts';

const PLACES: ExtensionPlaces = {
  projects: [{ id: 'sw', name: 'Superwall' }],
  repos: [{ path: '/code/paywall-next', name: 'paywall-next' }],
};

const VERCEL = createPlugin({ id: 'vercel', name: 'Vercel', enabled: false });

describe('token estimates', () => {
  it('rounds to what a person reads at a glance', () => {
    expect(formatTokenEstimate(0)).toBe('No tokens');
    expect(formatTokenEstimate(30)).toBe('~100 tokens');
    expect(formatTokenEstimate(480)).toBe('~500 tokens');
    expect(formatTokenEstimate(4_200)).toBe('~4.2k tokens');
    expect(formatTokenEstimate(3_000)).toBe('~3k tokens');
    expect(formatTokenEstimate(9_960)).toBe('~10k tokens');
    expect(formatTokenEstimate(38_400)).toBe('~38k tokens');
  });

  it('says a server is not measured until it was checked', () => {
    expect(resolveTokenText(null)).toBe('Not measured');
    expect(resolveTokenText(1_200)).toBe('~1.2k tokens');
  });
});

describe('a server row', () => {
  it('names where the server comes from', () => {
    expect(resolveServerSource(createServer({ id: 'a' }), [])).toBe('Shinsa');
    expect(resolveServerSource(createServer({ id: 'a', source: 'claude' }), [])).toBe('Claude Code');
    expect(
      resolveServerSource(createServer({ id: 'a', source: 'claude_project', origin: '~/proj' }), [])
    ).toBe('Claude Code · ~/proj');
    expect(resolveServerSource(createServer({ id: 'a', source: 'project' }), [])).toBe('Project .mcp.json');
    expect(resolveServerSource(createServer({ id: 'a', source: 'codex' }), [])).toBe('Codex');
    const fromPlugin = createServer({ id: 'a', source: 'plugin', plugin: 'vercel', origin: 'vercel plugin' });
    expect(resolveServerSource(fromPlugin, [VERCEL])).toBe('Vercel plugin');
    expect(resolveServerSource(fromPlugin, [])).toBe('vercel plugin');
  });

  it('shows the status only while the server is on and has been checked', () => {
    const tools = [{ name: 'list_issues', description: null }];
    expect(resolveServerStatus(createServer({ id: 'a' }, { state: 'connected', tools }))).toEqual({
      label: 'Connected · 1 tool',
      tone: 'green',
      detail: null,
    });
    expect(resolveServerStatus(createServer({ id: 'a' }, { state: 'needs_sign_in' }))).toEqual({
      label: 'Needs sign-in',
      tone: 'orange',
      detail: null,
    });
    expect(
      resolveServerStatus(createServer({ id: 'b', source: 'plugin' }, { state: 'needs_sign_in' }))?.detail
    ).toBe(
      'Claude runs can still use a sign-in you made in Claude Code. Connect here for Codex and for Shinsa’s check.'
    );
    expect(
      resolveServerStatus(createServer({ id: 'a' }, { state: 'failing', error: 'exit 1' }))?.detail
    ).toBe('exit 1');
    expect(resolveServerStatus(createServer({ id: 'a' }, { state: 'failing' }))?.detail).toBe(
      'It did not answer when Shinsa checked it.'
    );
    expect(resolveServerStatus(createServer({ id: 'a' }))).toBeNull();
    expect(resolveServerStatus(createServer({ id: 'a', enabled: false }, { state: 'failing' }))).toBeNull();
  });

  it('offers Connect only for a web server that is on and waits for a sign-in', () => {
    expect(needsConnect(createServer({ id: 'a' }, { state: 'needs_sign_in' }))).toBe(true);
    expect(needsConnect(createServer({ id: 'a', enabled: false }, { state: 'needs_sign_in' }))).toBe(false);
    expect(needsConnect(createServer({ id: 'a', transport: 'stdio' }, { state: 'needs_sign_in' }))).toBe(
      false
    );
    expect(needsConnect(createServer({ id: 'a' }, { state: 'connected' }))).toBe(false);
  });

  it('shows the command with its arguments, or the URL', () => {
    const local = createServer({
      id: 'a',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg'],
      url: null,
    });
    expect(resolveServerTarget(local)).toBe('npx -y pkg');
    expect(resolveServerTarget(createServer({ id: 'a', transport: 'stdio', command: null, url: null }))).toBe(
      ''
    );
    expect(resolveServerTarget(createServer({ id: 'a', url: 'https://x.dev/mcp' }))).toBe(
      'https://x.dev/mcp'
    );
    expect(resolveServerTarget(createServer({ id: 'a', url: null }))).toBe('');
  });

  it('names the server of Shinsa’s that overrides it', () => {
    const own = createServer({ id: 'own', name: 'linear' });
    const copy = createServer({ id: 'copy', name: 'linear', source: 'claude', shadowedBy: 'own' });
    expect(resolveShadowText(copy, [own, copy])).toBe('Overridden by Shinsa’s linear');
    expect(resolveShadowText({ ...copy, shadowedBy: 'gone' }, [copy])).toBe('Overridden by Shinsa’s linear');
    expect(resolveShadowText(own, [own, copy])).toBeNull();
  });

  it('builds the options menu from what the server can do', () => {
    const own = createServer({ id: 'a', signedIn: true }, { tools: [{ name: 't', description: null }] });
    expect(resolveServerMenu(own)).toEqual({
      connect: 'Sign in again',
      signOut: true,
      edit: 'edit',
      remove: true,
    });
    expect(resolveServerMenu(createServer({ id: 'b', editable: false }))).toEqual({
      connect: 'Connect',
      signOut: false,
      edit: 'copy',
      remove: false,
    });
    expect(resolveServerMenu(createServer({ id: 'c', transport: 'stdio' })).connect).toBeNull();
  });
});

describe('where a server is used', () => {
  it('reads the projects and repositories from the state', () => {
    const state = createShinsaState({
      projects: [createProject({ id: 'sw', name: 'Superwall' })],
      repos: [createRepo({ id: 'b', name: 'shinsa' }), createRepo({ id: 'a', name: 'paywall' })],
    });
    expect(resolveExtensionPlaces(state)).toEqual({
      projects: [{ id: 'sw', name: 'Superwall' }],
      repos: [
        { path: '/Users/you/Developer/a', name: 'paywall' },
        { path: '/Users/you/Developer/b', name: 'shinsa' },
      ],
    });
  });

  it('says where it is used, and nothing when it is used everywhere', () => {
    expect(resolveScopeText({ kind: 'everywhere' }, PLACES)).toBeNull();
    expect(resolveScopeText({ kind: 'project', project: 'sw' }, PLACES)).toBe(
      'Only in the Superwall project'
    );
    expect(resolveScopeText({ kind: 'project', project: 'gone' }, PLACES)).toBe(
      'Only in a project that is gone'
    );
    expect(resolveScopeText({ kind: 'repo', path: '/code/paywall-next' }, PLACES)).toBe(
      'Only in paywall-next'
    );
    expect(resolveScopeText({ kind: 'repo', path: '/code/other/' }, PLACES)).toBe('Only in other');
    expect(resolveScopeText({ kind: 'repo', path: '/' }, PLACES)).toBe('Only in /');
  });

  it('confirms a change of place in a toast', () => {
    expect(describeScopeChanged('linear', { kind: 'everywhere' }, PLACES)).toBe(
      'Agents use linear everywhere.'
    );
    expect(describeScopeChanged('linear', { kind: 'project', project: 'sw' }, PLACES)).toBe(
      'Agents use linear only in the Superwall project.'
    );
  });

  it('turns a place into a menu value and back', () => {
    for (const scope of [
      { kind: 'everywhere' as const },
      { kind: 'project' as const, project: 'sw' },
      { kind: 'repo' as const, path: '/code/a' },
    ]) {
      expect(parseScope(serializeScope(scope))).toEqual(scope);
    }
    expect(parseScope('nonsense')).toEqual({ kind: 'everywhere' });
  });

  it('lists every place, and keeps a saved place that is no longer known', () => {
    expect(listScopeItems(PLACES, { kind: 'everywhere' }).map((item) => item.label)).toEqual([
      'Everywhere',
      'Only in the Superwall project',
      'Only in paywall-next',
    ]);
    expect(listScopeItems(PLACES, { kind: 'project', project: 'sw' })).toHaveLength(3);
    expect(listScopeItems(PLACES, { kind: 'project', project: 'gone' }).at(-1)).toEqual({
      value: 'project:gone',
      label: 'Only in a project that is gone',
      icon: 'IconLayersTwo',
    });
    expect(listScopeItems(PLACES, { kind: 'repo', path: '/code/old' }).at(-1)).toEqual({
      value: 'repo:/code/old',
      label: 'Only in old',
      icon: 'IconFolder1',
    });
  });
});

describe('what agents load', () => {
  it('lists what a plugin brings', () => {
    expect(
      describePluginContents(
        createPlugin({ id: 'p', skills: 3, agents: 2, commands: 1, hooks: true, servers: 1 })
      )
    ).toBe('3 skills, 2 agents, 1 command, hooks, 1 MCP');
    expect(describePluginContents(createPlugin({ id: 'p', skills: 1, servers: 2 }))).toBe('1 skill, 2 MCPs');
    expect(describePluginContents(createPlugin({ id: 'p' }))).toBe('Nothing for agents to load');
  });
});

describe('skill groups', () => {
  it('groups skills by where they come from, one group per plugin and per repository, leaving out Shinsa’s own', () => {
    const snapshot = createExtensions({
      plugins: [VERCEL],
      skills: [
        createSkill({ id: 'codex-pdf', source: 'codex' }),
        createSkill({ id: 'mine', source: 'user', tokens: 400 }),
        createSkill({ id: 'repo', source: 'project', repoPath: '/code/paywall-next' }),
        createSkill({ id: 'loose', source: 'project', origin: 'somewhere/.claude/skills' }),
        createSkill({ id: 'deploy', source: 'plugin', plugin: 'vercel' }),
        createSkill({ id: 'stray', source: 'plugin', origin: 'old plugin' }),
        createSkill({ id: 'review', source: 'shinsa', tokens: 900 }),
        createSkill({ id: 'evidence', source: 'shinsa', enabled: false }),
      ],
    });
    const groups = listSkillGroups(snapshot, PLACES);
    expect(groups.map((group) => [group.title, describeGroupCount(group)])).toEqual([
      ['Claude Code on this machine', '1 of 1 on · ~400 tokens'],
      ['Vercel plugin', '0 of 1 on'],
      ['old plugin', '1 of 1 on · ~500 tokens'],
      ['paywall-next', '1 of 1 on · ~500 tokens'],
      ['somewhere/.claude/skills', '1 of 1 on · ~500 tokens'],
      ['Codex', '1 of 1 on · ~500 tokens'],
    ]);
  });
});

describe('toasts', () => {
  it('says what just happened, in the past tense', () => {
    expect(describeServerToggled('linear', true)).toBe('Turned on linear for Shinsa’s agents.');
    expect(describeServerToggled('linear', false)).toBe(
      'Turned off linear for Shinsa’s agents. Claude Code and Codex keep their own settings.'
    );
    expect(describeSkillToggled('review', true)).toBe('Turned on the review skill.');
    expect(describeSkillToggled('review', false)).toBe('Turned off the review skill.');
    expect(describePluginToggled('stripe', false)).toBe('Turned off the stripe plugin.');
    expect(describePluginToggled('stripe', true)).toBe('Turned on the stripe plugin.');
    expect(describeChecked(createServer({ id: 'linear' }))).toBe('Checked linear.');
    expect(describeChecked(null)).toBe('Checked every MCP that is on.');
    expect(describeSignedIn('linear')).toBe('Signed in to linear.');
    expect(describeAlreadySignedIn('linear')).toBe('linear is already signed in.');
    expect(describeSignInFailed('linear')).toBe('Couldn’t sign in to linear. Try again.');
    expect(describeSignedOut('linear')).toBe('Signed out of linear.');
    expect(describeServerRemoval(createServer({ id: 'linear' }))).toEqual({
      title: 'Remove linear?',
      body: 'Agents stop using it, and Shinsa forgets its settings and saved secrets.',
      action: 'Remove MCP',
      done: 'Removed linear.',
    });
  });
});

describe('the server dialog', () => {
  const draft = (patch: Partial<ServerDraft>): ServerDraft => ({ ...createServerDraft(null), ...patch });

  it('takes several lines for arguments, environment and headers, and says how to fill them in', () => {
    const fields: ServerField[] = ['name', 'command', 'args', 'env', 'url', 'headers'];
    expect(fields.filter(isMultilineField)).toEqual(['args', 'env', 'headers']);
    expect(resolveFieldNote('args', false)).toBe('One argument per line.');
    expect(resolveFieldNote('env', true)).toBe('Leave a value empty to keep the saved one.');
    expect(resolveFieldNote('headers', false)).toBeNull();
    expect(resolveFieldNote('name', true)).toBeNull();
  });

  it('names the dialog and its button for what it does', () => {
    const theirs = createServer({ id: 'sentry', source: 'claude', editable: false });
    expect(resolveServerDialog('add', null, [], 'linear')).toEqual({
      title: 'Add an MCP',
      description: 'Agents can use it from their next run.',
      action: 'Add MCP',
      done: 'Added linear.',
    });
    expect(resolveServerDialog('edit', theirs, [], 'sentry').action).toBe('Save MCP');
    expect(resolveServerDialog('edit', theirs, [], 'sentry').done).toBe('Saved sentry.');
    expect(resolveServerDialog('copy', theirs, [], 'sentry')).toEqual({
      title: 'Copy sentry to Shinsa',
      description:
        'Shinsa keeps its own copy under the same name and uses it instead of the one from Claude Code.',
      action: 'Save copy',
      done: 'Copied sentry to Shinsa.',
    });
  });

  it('starts empty for a new server and from the saved one when editing, without secret values', () => {
    expect(createServerDraft(null)).toEqual({
      name: '',
      transport: 'stdio',
      command: '',
      args: '',
      env: '',
      url: '',
      headers: '',
      scope: 'everywhere',
    });
    const saved = createServer({
      id: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg'],
      envKeys: ['TOKEN'],
      headerKeys: ['Authorization'],
      url: null,
      scope: { kind: 'repo', path: '/code/a' },
    });
    expect(createServerDraft(saved)).toEqual({
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: '-y\npkg',
      env: 'TOKEN=',
      url: '',
      headers: 'Authorization: ',
      scope: 'repo:/code/a',
    });
    expect(hasSavedSecrets(saved)).toBe(true);
    expect(hasSavedSecrets(createServer({ id: 'x' }))).toBe(false);
    expect(hasSavedSecrets(null)).toBe(false);
  });

  it('shows the fields of the way Shinsa reaches the server', () => {
    expect(listDraftFields('stdio')).toEqual(['name', 'command', 'args', 'env']);
    expect(listDraftFields('sse')).toEqual(['name', 'url', 'headers']);
  });

  it('turns a command draft into the server’s input', () => {
    expect(
      validateServerDraft(
        draft({
          name: ' github ',
          command: ' npx ',
          args: '-y\n\n @modelcontextprotocol/server-github ',
          env: 'GITHUB_TOKEN=abc=def\nEMPTY=',
          scope: 'project:sw',
        })
      )
    ).toEqual({
      ok: true,
      input: {
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'abc=def', EMPTY: '' },
        scope: { kind: 'project', project: 'sw' },
      },
    });
  });

  it('turns a web draft into the server’s input', () => {
    expect(
      validateServerDraft(
        draft({
          name: 'linear',
          transport: 'http',
          url: 'https://mcp.linear.app/mcp',
          headers: 'Authorization: Bearer x:y',
        })
      )
    ).toEqual({
      ok: true,
      input: {
        name: 'linear',
        transport: 'http',
        url: 'https://mcp.linear.app/mcp',
        headers: { Authorization: 'Bearer x:y' },
        scope: { kind: 'everywhere' },
      },
    });
  });

  it('explains every field that is wrong', () => {
    expect(validateServerDraft(draft({ env: 'not a pair' }))).toEqual({
      ok: false,
      errors: {
        name: 'Enter a name.',
        command: 'Enter the command that starts it.',
        env: 'Write each variable as NAME=value on its own line.',
      },
    });
    expect(validateServerDraft(draft({ name: '-bad', command: 'npx' }))).toEqual({
      ok: false,
      errors: { name: 'Use letters, numbers, - and _, starting with a letter or number.' },
    });
    expect(validateServerDraft(draft({ name: 'ok', command: 'npx', env: '1X=y' })).ok).toBe(false);
    expect(
      validateServerDraft(draft({ name: 'ok', transport: 'sse', url: 'ftp://x', headers: 'no colon' }))
    ).toEqual({
      ok: false,
      errors: {
        url: 'Enter a URL that starts with http:// or https://.',
        headers: 'Write each header as Name: value on its own line.',
      },
    });
    expect(validateServerDraft(draft({ name: 'ok', transport: 'http', url: 'not a url' })).ok).toBe(false);
    expect(validateServerDraft(draft({ name: '', transport: 'http', url: 'https://x.dev' })).ok).toBe(false);
  });
});

describe('opening the add dialog from anywhere', () => {
  it('links to the MCPs section with the dialog open', () => {
    expect(resolveAddServerPath()).toBe('/settings?tab=integrations&add=mcp#mcps');
  });

  it('drops the request once the dialog is open and keeps the rest of the address', () => {
    expect(
      resolvePathWithoutAdd({
        pathname: '/settings',
        search: '?tab=integrations&add=mcp',
        hash: '#mcps',
      })
    ).toBe('/settings?tab=integrations#mcps');
    expect(resolvePathWithoutAdd({ pathname: '/settings', search: '?add=mcp', hash: '' })).toBe('/settings');
  });
});

const DAY = 86_400_000;

const NOW = 400 * DAY;

describe('servers by status', () => {
  it('puts each server in one group, in the order Connected, Needs sign-in, Failing, Not checked yet, Off, each in its tone with its icon', () => {
    const servers = [
      createServer({ id: 'off', enabled: false }, { state: 'connected', tokens: 300 }),
      createServer({ id: 'unplugged', plugin: 'vercel' }, { state: 'connected' }),
      createServer({ id: 'waiting' }),
      createServer({ id: 'locked' }, { state: 'needs_sign_in' }),
      createServer({ id: 'broken' }, { state: 'failing' }),
      createServer({ id: 'ok' }, { state: 'connected', tokens: 4_200 }),
    ];
    const groups = listServerStatusGroups(servers, [VERCEL]);
    expect(
      groups.map((group) => [
        group.key,
        group.title,
        group.tone,
        group.icon,
        group.servers.map((server) => server.id),
      ])
    ).toEqual([
      ['connected', 'Connected', 'green', 'IconApiConnection', ['ok']],
      ['needs_sign_in', 'Needs sign-in', 'orange', 'IconUserKey', ['locked']],
      ['failing', 'Failing', 'red', 'IconCircleX', ['broken']],
      ['checking', 'Not checked yet', 'neutral', 'IconCircleDotted', ['waiting']],
      ['off', 'Off', 'neutral', 'IconCircleMinus', ['off', 'unplugged']],
    ]);
    expect(listServerStatusGroups([], [])).toEqual([]);
  });

  it('says what each server costs, or plainly why it cannot', () => {
    const cost = (server: McpServerSummary) => resolveServerCost(server, []);
    expect(cost(createServer({ id: 'a' }, { state: 'connected', tokens: 4_200 }))).toBe('~4.2k tokens');
    expect(cost(createServer({ id: 'a' }, { state: 'failing' }))).toBe('Can’t measure while failing');
    expect(cost(createServer({ id: 'a' }, { state: 'needs_sign_in' }))).toBe('Sign in to measure');
    expect(cost(createServer({ id: 'a' }))).toBe('Checking…');
    expect(cost(createServer({ id: 'a', enabled: false }))).toBe('Not measured while off');
    expect(cost(createServer({ id: 'a', enabled: false }, { tokens: 900 }))).toBe('~900 tokens');
  });

  it('opens the groups that need you, and a long group of failing or off servers starts closed', () => {
    const group = (key: ServerStatusGroup['key'], count: number): ServerStatusGroup => ({
      key,
      title: key,
      icon: 'IconServer',
      tone: 'neutral',
      servers: Array.from({ length: count }, (_, index) => createServer({ id: `s${index}` })),
    });
    expect(isServerGroupOpen(group('connected', 40))).toBe(true);
    expect(isServerGroupOpen(group('needs_sign_in', 40))).toBe(true);
    expect(isServerGroupOpen(group('failing', OPEN_GROUP_LIMIT))).toBe(true);
    expect(isServerGroupOpen(group('off', OPEN_GROUP_LIMIT + 1))).toBe(false);
  });
});

describe('what a server or skill costs', () => {
  it('says it loads when needed before the cost, whatever the cost says', () => {
    expect(resolveCostText({ deferred: true }, '~4k tokens')).toBe('Loads when needed · ~4k tokens');
    expect(resolveCostText({ deferred: true }, 'Sign in to measure')).toBe(
      'Loads when needed · Sign in to measure'
    );
    expect(resolveCostText({ deferred: false }, '~4k tokens')).toBe('~4k tokens');
  });

  it('explains the cost of a server that needs a sign-in, and keeps a failing server’s error for its details', () => {
    const claude = createServer({ id: 'a', source: 'claude' }, { state: 'needs_sign_in' });
    expect(resolveServerCostHint(claude)).toBe(
      'Claude runs can still use a sign-in you made in Claude Code. Connect here for Codex and for Shinsa’s check.'
    );
    expect(resolveServerCostHint(createServer({ id: 'a' }, { state: 'failing', error: 'Down.' }))).toBeNull();
    expect(resolveServerCostHint(createServer({ id: 'a' }, { state: 'connected' }))).toBeNull();
    expect(resolveServerCostHint(createServer({ id: 'a', enabled: false }))).toBeNull();
  });

  it('names each switch for what it turns on', () => {
    expect(SWITCH_LABEL.servers('linear')).toBe('Use linear for Shinsa’s agents');
    expect(SWITCH_LABEL.plugins('Stripe')).toBe('Use the Stripe plugin');
    expect(SWITCH_LABEL.skills('review')).toBe('Use the review skill');
  });
});

describe('a server’s details', () => {
  it('lists where it is defined and used, what overrides it, its plugin and when it was last used', () => {
    const own = createServer({ id: 'linear' });
    const theirs = createServer({
      id: 'claude:linear',
      name: 'linear',
      source: 'plugin',
      plugin: 'vercel',
      origin: 'vercel plugin',
      shadowedBy: 'linear',
      scope: { kind: 'project', project: 'sw' },
      lastUsedAt: 0,
    });
    const snapshot = createExtensions({
      servers: [own, theirs],
      plugins: [VERCEL],
      usage: { readAt: 1, since: 0 },
    });
    expect(listServerNotes(theirs, snapshot, PLACES, 3 * 86_400_000)).toEqual([
      'vercel plugin',
      'Only in the Superwall project',
      'Overridden by Shinsa’s linear',
      'Its plugin is off',
      'Not used in 3 days',
    ]);
  });

  it('details an MCP as its tools over one quiet line, or says why it has none', () => {
    const tools = [{ name: 'search', description: 'Search.' }];
    const connected = createServer(
      { id: 'maple', url: 'https://maple.dev/mcp' },
      { state: 'connected', tools }
    );
    const snapshot = createExtensions({ servers: [connected] });
    expect(resolveServerDetail(connected, snapshot, PLACES, 0)).toEqual({
      tools,
      error: null,
      empty: null,
      line: 'Shinsa',
      target: 'https://maple.dev/mcp',
    });
    const detail = (server: McpServerSummary) => resolveServerDetail(server, snapshot, PLACES, 0);
    expect(detail(createServer({ id: 'a' }, { state: 'connected' })).empty).toBe('It lists no tools.');
    expect(detail(createServer({ id: 'a' }, { state: 'needs_sign_in' })).empty).toBe(
      'Sign in to see its tools.'
    );
    expect(detail(createServer({ id: 'a' })).empty).toBe('Its tools show once it is checked.');
    expect(detail(createServer({ id: 'a', enabled: false })).empty).toBe(
      'Its tools show once it is on and checked.'
    );
    expect(detail(createServer({ id: 'a' }, { state: 'failing', error: 'exit 1' }))).toMatchObject({
      error: 'exit 1',
      empty: null,
    });
  });

  it('opens Shinsa’s own server to edit and another tool’s to copy', () => {
    expect(SERVER_EDIT.edit.label).toBe('Edit…');
    expect(SERVER_EDIT.copy.label).toBe('Copy to Shinsa and edit…');
  });

  it('reads the dialog’s server from the latest list, keeping the one it opened with once it is gone', () => {
    const opened = createServer({ id: 'linear' });
    const checked = createServer({ id: 'linear' }, { state: 'connected' });
    expect(resolveCurrentServer([checked], opened)).toBe(checked);
    expect(resolveCurrentServer([], opened)).toBe(opened);
  });
});

describe('a server defined in several places', () => {
  const place = (id: string, source: McpServerPlace['source'], origin: string): McpServerPlace => ({
    id,
    source,
    origin,
    scope: { kind: 'everywhere' },
    enabled: true,
  });
  const maple = createServer({
    id: 'claude_project:/code/pwn:maple',
    name: 'maple',
    source: 'claude_project',
    origin: '~/.claude.json · ~/code/pwn',
    definedIn: [
      place('claude:maple', 'claude', '~/.claude.json'),
      place('claude_project:/code/pwn:maple', 'claude_project', '~/.claude.json · ~/code/pwn'),
      place('codex:maple', 'codex', '~/.codex/config.toml'),
      place('plugin:vercel:maple', 'plugin', 'vercel plugin'),
      place('plugin:gone:maple', 'plugin', 'gone plugin'),
    ],
  });

  it('names each tool it comes from once, and every file in its tooltip', () => {
    expect(describeServerSources(maple, [VERCEL])).toBe('Claude Code, Codex, Vercel plugin, gone plugin');
    expect(describeServerPlaces(maple)).toBe(
      'Defined in ~/.claude.json, ~/.claude.json · ~/code/pwn, ~/.codex/config.toml, vercel plugin, gone plugin'
    );
    const single = createServer({ id: 'a', source: 'codex', origin: '~/.codex/config.toml' });
    expect(describeServerSources(single, [])).toBe('Codex');
    expect(describeServerPlaces(single)).toBe('~/.codex/config.toml');
  });
});

describe('what agents have not used lately', () => {
  const read = { readAt: NOW, since: NOW - 90 * DAY };

  it('counts idle days from the last use, else from the start of what Shinsa read', () => {
    const snapshot = createExtensions({ usage: read });
    expect(resolveUnusedDays(NOW - 3 * DAY, snapshot, NOW)).toBe(3);
    expect(resolveUnusedDays(null, snapshot, NOW)).toBe(90);
    expect(resolveUnusedDays(NOW, createExtensions(), NOW)).toBeNull();
    expect(describeLastUsed(null)).toBeNull();
    expect(describeLastUsed(0)).toBe('Used today');
    expect(describeLastUsed(1)).toBe('Not used in 1 day');
    expect(describeLastUsed(30)).toBe('Not used in 30 days');
  });

  it('recommends the measured servers and the skills idle past the window, costliest first', () => {
    const snapshot = createExtensions({
      usage: read,
      servers: [
        createServer({ id: 'maple', lastUsedAt: NOW - 30 * DAY }, { state: 'connected', tokens: 4_000 }),
        createServer({ id: 'kampala', lastUsedAt: null }, { state: 'connected', tokens: 21_000 }),
        createServer({ id: 'busy', lastUsedAt: NOW - DAY }, { state: 'connected', tokens: 9_000 }),
        createServer({ id: 'locked', lastUsedAt: null }, { state: 'needs_sign_in' }),
        createServer({ id: 'off', enabled: false, lastUsedAt: null }, { tokens: 500 }),
      ],
      skills: [
        createSkill({ id: 'stale', tokens: 300 }),
        createSkill({ id: 'stale-2', tokens: 200, lastUsedAt: NOW - 20 * DAY }),
        createSkill({ id: 'fresh', lastUsedAt: NOW }),
        createSkill({ id: 'switched-off', enabled: false }),
        createSkill({ id: 'review', source: 'shinsa' }),
      ],
    });
    expect(listRecommendations(snapshot, NOW)).toEqual([
      {
        id: 'kampala',
        name: 'kampala',
        detail: 'Not used in 90 days · ~21k tokens',
        tokens: 21_000,
        server: expect.objectContaining({ id: 'kampala' }),
      },
      {
        id: 'maple',
        name: 'maple',
        detail: 'Not used in 30 days · ~4k tokens',
        tokens: 4_000,
        server: expect.objectContaining({ id: 'maple' }),
      },
      {
        id: 'skills',
        name: '2 skills',
        detail: 'Not used in 14 days · ~500 tokens',
        tokens: 500,
        server: null,
      },
    ]);
    expect(listRecommendations(createExtensions({ servers: snapshot.servers }), NOW)).toEqual([]);
  });

  it('offers the usual windows and keeps one set elsewhere', () => {
    expect(listOptimizerDayItems(14).map((item) => item.value)).toEqual(['7', '14', '30', '60', '90']);
    expect(listOptimizerDayItems(21)).toContainEqual({ value: '21', label: '21 days' });
    expect(listOptimizerDayItems(1)[0]).toEqual({ value: '1', label: '1 day' });
  });

  it('says what a change to the optimizer means for agents', () => {
    const optimizer = { enabled: false, days: 14, skills: false };
    expect(describeOptimizerChanged(optimizer, { enabled: true })).toBe(
      'Agents now leave out MCPs unused for 14 days.'
    );
    expect(describeOptimizerChanged(optimizer, { enabled: false })).toBe(
      'Agents load every MCP that is turned on.'
    );
    expect(describeOptimizerChanged(optimizer, { skills: true })).toBe('Agents leave out unused skills too.');
    expect(describeOptimizerChanged(optimizer, { skills: false })).toBe(
      'Agents load every skill that is turned on.'
    );
    expect(describeOptimizerChanged(optimizer, { days: 7 })).toBe('Unused means not used for 7 days.');
    expect(describeOptimizerChanged(optimizer, {})).toBe('Unused means not used for 14 days.');
  });
});

describe('searching', () => {
  const snapshot = createExtensions({
    plugins: [VERCEL],
    servers: [
      createServer({ id: 'maple', url: 'https://api.maple.dev/mcp' }),
      createServer({ id: 'kampala', transport: 'stdio', url: null, command: 'kampala-mcp', source: 'codex' }),
    ],
    skills: [
      createSkill({ id: 'animate', description: 'Builds an animation.' }),
      createSkill({ id: 'review', source: 'shinsa', description: 'Reviews a change.' }),
    ],
  });

  it('shows everything when there is nothing to search for', () => {
    expect(filterExtensions(snapshot, '  ')).toEqual({
      servers: snapshot.servers,
      plugins: snapshot.plugins,
      skills: snapshot.skills,
      searching: false,
    });
  });

  it('keeps what matches every word, in names, sources, addresses and descriptions', () => {
    const matches = filterExtensions(snapshot, 'MAPLE dev');
    expect(matches.servers.map((server) => server.id)).toEqual(['maple']);
    expect(filterExtensions(snapshot, 'codex').servers.map((server) => server.id)).toEqual(['kampala']);
    expect(filterExtensions(snapshot, 'vercel').plugins).toEqual([VERCEL]);
    expect(filterExtensions(snapshot, 'animation').skills.map((skill) => skill.id)).toEqual(['animate']);
    expect(isEmptyMatch(matches)).toBe(false);
    expect(isEmptyMatch(filterExtensions(snapshot, 'change'))).toBe(true);
    expect(isEmptyMatch(filterExtensions(snapshot, 'vercel'))).toBe(false);
    expect(isEmptyMatch(filterExtensions(snapshot, 'animate'))).toBe(false);
  });
});

describe('long lists', () => {
  it('renders the rows in view, with a margin above and below', () => {
    expect(resolveVisibleRange(0, 400, 300, 40)).toEqual({ start: 0, end: 18 });
    expect(resolveVisibleRange(-4_000, 400, 300, 40)).toEqual({
      start: 92,
      end: 118,
    });
    expect(resolveVisibleRange(-20_000, 400, 300, 40)).toEqual({ start: 300, end: 300 });
    expect(resolveVisibleRange(2_000, 400, 300, 40)).toEqual({ start: 0, end: 0 });
  });
});
