import {
  type AccountsSnapshot,
  createSettings,
  KNOWN_AGENT_PROVIDERS,
  type MemoryEntry,
  type Project,
  type ProviderLogin,
  type Settings,
  type ShinsaState,
} from '@shinsa/core';
import * as React from 'react';
import { type AccountActions, AccountsGroup } from '@/components/settings/accounts.tsx';
import { ModelsGroup } from '@/components/settings/agents.tsx';
import { ContextOptimizerGroup } from '@/components/settings/context-optimizer.tsx';
import { SettingsGroup } from '@/components/settings/group.tsx';
import { McpServersGroup } from '@/components/settings/mcp-servers.tsx';
import { MemorySettings } from '@/components/settings/memory.tsx';
import { NotificationGroup } from '@/components/settings/notifications.tsx';
import { PluginsGroup } from '@/components/settings/plugins.tsx';
import { type ScheduleActions, ScheduleRow } from '@/components/settings/schedules.tsx';
import { SkillsGroup } from '@/components/settings/skills.tsx';
import { type UpdateActions, UpdatesGroup } from '@/components/settings/updates.tsx';
import { type VersionActions, VersionsGroup } from '@/components/settings/versions.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import type { DesktopUpdate, UpdateChannel } from '@/lib/desktop.ts';
import type { MemoryActions } from '@/lib/memory.ts';
import { DEFAULT_PREFERENCES } from '@/lib/preferences/notifications.ts';
import { createSampleAccounts, createSampleProviderLogins } from './sample-accounts.ts';
import { createSampleExtensions, SAMPLE_PLACES } from './sample-extensions.ts';
import { createSampleVersions } from './sample-versions.ts';
import {
  acknowledgeSample,
  createSampleSchedule,
  createSampleState,
  createSampleTask,
  HOUR,
  MINUTE,
} from './samples.ts';
import { Specimen } from './section.tsx';

const SAMPLE_ACTIONS: ScheduleActions = {
  enable: acknowledgeSample,
  copyWebhook: acknowledgeSample,
  open: () => void acknowledgeSample(),
  remove: acknowledgeSample,
};

const SAMPLE_ACCOUNT_ACTIONS: AccountActions = {
  signIn: () => void acknowledgeSample(),
  importLogin: () => void acknowledgeSample(),
  update: acknowledgeSample,
  remove: () => void acknowledgeSample(),
  refresh: acknowledgeSample,
};

const SAMPLE_EXTENSION_ACTIONS: ExtensionActions = {
  check: acknowledgeSample,
  add: acknowledgeSample,
  update: acknowledgeSample,
  remove: acknowledgeSample,
  choose: acknowledgeSample,
  signIn: acknowledgeSample,
  signOut: acknowledgeSample,
  chooseSkill: acknowledgeSample,
  choosePlugin: acknowledgeSample,
  chooseOptimizer: acknowledgeSample,
};

const SAMPLE_UPDATE_ACTIONS: UpdateActions = {
  check: () => void acknowledgeSample(),
  install: () => void acknowledgeSample(),
  changeChannel: () => void acknowledgeSample(),
  answerDowngrade: () => void acknowledgeSample(),
};

const UPDATE_SCENES: { label: string; version: string; channel: UpdateChannel; update: DesktopUpdate }[] = [
  {
    label: 'UpdatesGroup · Stable, up to date',
    version: '1.3.0',
    channel: 'stable',
    update: { status: 'current' },
  },
  {
    label: 'UpdatesGroup · Beta, the next beta ready to install',
    version: '1.3.0-beta.2',
    channel: 'beta',
    update: { status: 'ready', version: '1.3.0-beta.3' },
  },
  {
    label: 'UpdatesGroup · a beta switched to Stable, offered the latest stable',
    version: '1.3.0-beta.2',
    channel: 'stable',
    update: { status: 'downgrade', version: '1.2.0' },
  },
  {
    label: 'UpdatesGroup · Canary, the next canary downloading',
    version: '1.3.1-canary.4',
    channel: 'canary',
    update: { status: 'downloading', version: '1.3.1-canary.5', percent: 42 },
  },
  {
    label: 'UpdatesGroup · Beta, the downloaded beta being prepared to install',
    version: '1.3.0-beta.2',
    channel: 'beta',
    update: { status: 'preparing', version: '1.3.0-beta.3' },
  },
  {
    label: 'UpdatesGroup · Beta, restarting into the next beta',
    version: '1.3.0-beta.2',
    channel: 'beta',
    update: { status: 'installing', version: '1.3.0-beta.3' },
  },
];

const SAMPLE_VERSION_ACTIONS: VersionActions = {
  refresh: acknowledgeSample,
  update: acknowledgeSample,
};

function selectSampleLogin(logins: ProviderLogin[], status: ProviderLogin['status']) {
  return logins.filter((login) => login.status === status);
}

function createAccountScenes(now: number): { label: string; snapshot: AccountsSnapshot }[] {
  const logins = createSampleProviderLogins();
  const full = createSampleAccounts(now);
  const [first] = full.accounts;
  const fresh = first && {
    ...first,
    id: 'fresh',
    email: 'new@superwall.com',
    isDefault: false,
    usage: { status: 'unknown' as const, windows: [], detail: null, checkedAt: null, source: null },
  };
  return [
    {
      label:
        'AccountsGroup · accounts with their windows, out of usage, paused, signed out, a copied claude-swap login, no readings yet · Codex signed in',
      snapshot: {
        ...full,
        accounts: [
          ...full.accounts.map((account) =>
            account.id === 'lapsed' ? { ...account, origin: 'cswap' as const } : account
          ),
          ...(fresh ? [fresh] : []),
        ],
        imports: [
          { origin: 'cswap', email: 'swap@superwall.com', plan: null },
          { origin: 'cswap', email: 'side@superwall.com', plan: null },
        ],
        providers: selectSampleLogin(logins, 'signed_in'),
      },
    },
    {
      label: 'AccountsGroup · one account · Codex signed out',
      snapshot: {
        ...full,
        accounts: full.accounts.slice(0, 1),
        providers: selectSampleLogin(logins, 'signed_out'),
      },
    },
    {
      label: 'AccountsGroup · no account yet · Codex not installed',
      snapshot: { ...full, accounts: [], providers: selectSampleLogin(logins, 'not_installed') },
    },
    {
      label: 'AccountsGroup · Codex too old for Shinsa',
      snapshot: {
        ...full,
        accounts: full.accounts.slice(1, 2),
        providers: selectSampleLogin(logins, 'outdated'),
      },
    },
  ];
}

function createScheduleScene(now: number) {
  const task = createSampleTask(now, { id: 'standup', title: 'Write the daily standup notes' });
  const schedules = [
    createSampleSchedule(now, { id: 'nightly', name: 'Fix the nightly build' }),
    createSampleSchedule(now, {
      id: 'standup',
      name: 'Standup notes',
      trigger: { kind: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
      target: { kind: 'task', taskId: 'standup' },
      enabled: false,
    }),
    createSampleSchedule(now, {
      id: 'release',
      name: 'Tag the release',
      trigger: { kind: 'once', at: now - 2 * HOUR },
      nextRunAt: null,
      stopped: 'finished',
    }),
    createSampleSchedule(now, {
      id: 'deploys',
      name: 'Check failed deploys',
      trigger: { kind: 'webhook', signature: null, replayKey: null },
      nextRunAt: null,
      runs: [
        {
          at: now - 20 * MINUTE,
          outcome: 'failed',
          taskId: null,
          deliveryId: null,
          detail: 'The repository is gone.',
        },
      ],
    }),
    createSampleSchedule(now, {
      id: 'gone',
      name: 'Nudge the release checklist',
      target: { kind: 'task', taskId: 'cancelled-task' },
      enabled: false,
      stopped: 'target_gone',
    }),
  ];
  return { state: createSampleState({ tasks: [task], schedules }), schedules };
}

const SAMPLE_MEMORY_ACTIONS: MemoryActions = {
  write: acknowledgeSample,
  keep: acknowledgeSample,
  remove: acknowledgeSample,
};

function createMemoryScene(now: number): ShinsaState {
  const project: Project = {
    id: 'shinsa',
    name: 'Shinsa',
    color: 'blue',
    key: 'SW',
    description: '',
    folders: [],
  };
  const rule = (id: string, text: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
    id,
    projectId: null,
    text,
    why: null,
    status: 'kept',
    taskId: null,
    runId: null,
    createdAt: now - HOUR,
    updatedAt: now - HOUR,
    ...overrides,
  });
  const entries = [
    rule('proposed', 'Keep plans to three phases or fewer.', {
      status: 'proposed',
      projectId: 'shinsa',
      why: 'You asked for a shorter plan twice on “Add the export”.',
    }),
    rule('dashes', 'Never use em dashes in UI copy or messages.'),
    rule('terse', 'Keep hand-overs short: lead with the result, no recap.'),
    rule('bun', 'Run the focused test file before the whole suite.', { projectId: 'shinsa' }),
  ];
  return {
    ...createSampleState({ tasks: [] }),
    projects: { shinsa: project },
    memories: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
  };
}

function ModelsSpecimen({ label, initial }: { label: string; initial: Settings }) {
  const [settings, setSettings] = React.useState(initial);
  return (
    <Specimen label={label}>
      <div className='w-full max-w-xl'>
        <ModelsGroup
          settings={settings}
          providers={KNOWN_AGENT_PROVIDERS}
          accounts={null}
          update={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        />
      </div>
    </Specimen>
  );
}

export function SettingsSpecimens() {
  const [now] = React.useState(Date.now);
  const [{ state, schedules }] = React.useState(() => createScheduleScene(now));
  const [preferences, setPreferences] = React.useState(DEFAULT_PREFERENCES);
  const [scenes] = React.useState(() => createAccountScenes(now));
  const [extensions] = React.useState(() => createSampleExtensions(now));
  const [versions] = React.useState(createSampleVersions);
  const [memory] = React.useState(() => createMemoryScene(now));
  const settings = createSettings();
  return (
    <>
      <Specimen label='MemorySettings · a rule an agent proposed, rules for every project and for one project'>
        <div className='w-full max-w-xl'>
          <MemorySettings state={memory} actions={SAMPLE_MEMORY_ACTIONS} />
        </div>
      </Specimen>
      <Specimen label='MemorySettings · nothing remembered yet'>
        <div className='w-full max-w-xl'>
          <MemorySettings state={createSampleState({ tasks: [] })} actions={SAMPLE_MEMORY_ACTIONS} />
        </div>
      </Specimen>
      <ModelsSpecimen
        label='ModelsGroup · Task agents on Opus, Quick jobs on Sonnet; Per role folded'
        initial={settings}
      />
      <ModelsSpecimen
        label='ModelsGroup · the agent on Sonnet: Task agents read Set per role and open on every role, the investigator and researcher following theirs'
        initial={{ ...settings, agentModels: { agent: 'sonnet' } }}
      />
      {scenes.map((scene) => (
        <Specimen key={scene.label} label={scene.label}>
          <div className='w-full max-w-xl'>
            <AccountsGroup snapshot={scene.snapshot} settings={settings} actions={SAMPLE_ACCOUNT_ACTIONS} />
          </div>
        </Specimen>
      ))}
      {versions.map((scene) => (
        <Specimen key={scene.label} label={scene.label}>
          <div className='w-full max-w-xl'>
            <VersionsGroup
              snapshot={scene.snapshot}
              failure={null}
              updating={[]}
              actions={SAMPLE_VERSION_ACTIONS}
            />
          </div>
        </Specimen>
      ))}
      {UPDATE_SCENES.map(({ label, ...app }) => (
        <Specimen key={label} label={label}>
          <div className='w-full max-w-xl'>
            <UpdatesGroup app={app} actions={SAMPLE_UPDATE_ACTIONS} />
          </div>
        </Specimen>
      ))}
      <Specimen label='Schedule rows · next run, paused, finished, last run failed, its task is gone'>
        <div className='w-full max-w-xl'>
          <SettingsGroup title='Schedules'>
            {schedules.map((schedule) => (
              <ScheduleRow key={schedule.id} state={state} schedule={schedule} actions={SAMPLE_ACTIONS} />
            ))}
          </SettingsGroup>
        </div>
      </Specimen>
      <Specimen label='ContextOptimizerGroup · off, with what agents have not used lately'>
        <div className='w-full max-w-xl'>
          <ContextOptimizerGroup snapshot={extensions} actions={SAMPLE_EXTENSION_ACTIONS} now={now} />
        </div>
      </Specimen>
      <Specimen label='ContextOptimizerGroup · on, also leaving out skills'>
        <div className='w-full max-w-xl'>
          <ContextOptimizerGroup
            snapshot={{ ...extensions, optimizer: { enabled: true, days: 30, skills: true } }}
            actions={SAMPLE_EXTENSION_ACTIONS}
            now={now}
          />
        </div>
      </Specimen>
      <Specimen label='McpServersGroup · grouped by status, each in its tone with its icon: connected (one defined in three places), needs sign-in, failing, not checked, off; a problem reading a config'>
        <div className='w-full max-w-xl'>
          <McpServersGroup
            snapshot={extensions}
            places={SAMPLE_PLACES}
            actions={SAMPLE_EXTENSION_ACTIONS}
            now={now}
          />
        </div>
      </Specimen>
      <Specimen label='McpServersGroup · no server yet'>
        <div className='w-full max-w-xl'>
          <McpServersGroup
            snapshot={{ ...extensions, servers: [], problems: [] }}
            places={SAMPLE_PLACES}
            actions={SAMPLE_EXTENSION_ACTIONS}
          />
        </div>
      </Specimen>
      <Specimen label='PluginsGroup · one on, one off (its skills and server turn off with it)'>
        <div className='w-full max-w-xl'>
          <PluginsGroup snapshot={extensions} actions={SAMPLE_EXTENSION_ACTIONS} />
        </div>
      </Specimen>
      <Specimen label='SkillsGroup · one group per source, each collapsed until opened; Shinsa’s own skills are always on and not listed'>
        <div className='w-full max-w-xl'>
          <SkillsGroup snapshot={extensions} places={SAMPLE_PLACES} actions={SAMPLE_EXTENSION_ACTIONS} />
        </div>
      </Specimen>
      <Specimen label='Notification rows · per browser; here they change nothing stored'>
        <div className='w-full max-w-xl'>
          <NotificationGroup
            preferences={preferences}
            onChange={(patch) => setPreferences((current) => ({ ...current, ...patch }))}
          />
        </div>
      </Specimen>
      <Specimen label='Notification rows · in a browser tab or Floaty while the Shinsa app is connected'>
        <div className='w-full max-w-xl'>
          <NotificationGroup preferences={preferences} quiet onChange={() => undefined} />
        </div>
      </Specimen>
    </>
  );
}
