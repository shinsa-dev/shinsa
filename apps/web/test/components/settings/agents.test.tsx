import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { AUTOPILOT_DEFAULTS, createSettings, resolveEngineInfo, type Settings } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentSettings } from '@/components/settings/agents.tsx';
import {
  AUTO_MERGE_DESCRIPTION,
  AUTOPILOT_BLOCKS,
  AUTOPILOT_SCORE_ROWS,
  AUTOPILOT_LEVEL_DESCRIPTION,
  AUTOPILOT_OFF,
  AUTOPILOT_ROWS,
  AUTOPILOT_TURN_ON,
  TEAM_CONTACT,
} from '@/lib/autopilot.ts';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { readFetchCall } from '../../support/fetch.ts';
import {
  holdAcks,
  listSentCommands,
  pushAccounts,
  pushState,
  releaseAcks,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import {
  createAutopilotKindsProfile,
  createAutopilotProfile,
  createProject,
  createShinsaState,
  NOW,
} from '../../support/state.ts';

let toasts: ReturnType<typeof spyOnToasts>;
let providers: Mock<typeof fetch>;

beforeEach(() => {
  toasts = spyOnToasts();
  providers = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('offline', { status: 503 }));
  startFakeServer();
});

afterEach(async () => {
  await settle();
  toasts.restore();
  providers.mockRestore();
  stopFakeServer();
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function renderAgents(settings: Settings = createSettings(), automatic = false) {
  return render(
    <TooltipProvider>
      <AgentSettings settings={settings} automatic={automatic} />
    </TooltipProvider>
  );
}

async function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  await settle();
  const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await settle();
}

describe('Settings → Agents → Models', () => {
  it('offers Automatic on its own above the providers, for every group, and picking it saves the auto model', async () => {
    renderAgents(createSettings(), true);
    fireEvent.click(screen.getByRole('combobox', { name: 'Model for quick jobs' }));
    await settle();
    const quick = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(quick).getByRole('option', { name: 'Automatic' })).toBeTruthy();
    fireEvent.keyDown(quick, { key: 'Escape' });
    await settle();
    await choose('Model for task agents', 'Automatic');
    const sent = listSentCommands().at(-1) as { patch: Partial<Settings> };
    expect(sent.patch.agentModels).toMatchObject({ agent: 'auto', reviewer: 'auto', answerer: 'auto' });
  });

  it('shows Automatic as the chosen model', () => {
    const auto = { ...createSettings(), agentModels: { agent: 'auto', reviewer: 'auto', answerer: 'auto' } };
    renderAgents(auto, true);
    expect(screen.getByRole('combobox', { name: 'Model for task agents' }).textContent).toBe('Automatic');
  });

  it('offers no Automatic when the engine cannot route', async () => {
    renderAgents(createSettings(), false);
    fireEvent.click(screen.getByRole('combobox', { name: 'Model for task agents' }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(list).queryByRole('option', { name: /Automatic/ })).toBeNull();
  });

  it('has two groups, task agents on Opus and quick jobs on Sonnet, each saying what it holds', () => {
    renderAgents();
    expect(screen.getByRole('heading', { name: 'Models' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Agents' })).toBeNull();
    expect(screen.getByText('Task agents')).toBeTruthy();
    expect(
      screen.getByText(
        'They plan, build, review and fix the work, answer questions, investigate problems, do research and run operations.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('They sort new tasks and your messages, and write the guide on Home.')
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Model for task agents' }).textContent).toBe('Opus 5.5');
    expect(screen.getByRole('combobox', { name: 'Model for quick jobs' }).textContent).toBe('Sonnet 5.5');
    expect(screen.getByRole('combobox', { name: 'Speed for quick jobs' }).textContent).toBe('Standard');
    expect(screen.queryByRole('combobox', { name: 'Agent model' })).toBeNull();
    expect(screen.queryByText('Investigator')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Per role' })).toHaveLength(2);
  });

  it('lists every provider’s models in one select, and a pick sets the provider and the model', async () => {
    renderAgents();
    fireEvent.click(screen.getByRole('combobox', { name: 'Model for quick jobs' }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(list).getByText('Claude')).toBeTruthy();
    expect(within(list).getByText('Codex')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Model for quick jobs' }));
    await settle();
    await choose('Model for quick jobs', 'GPT-6-Astra');
    expect(listSentCommands()).toEqual([
      {
        type: 'settings.change',
        patch: {
          agentProviders: { classifier: 'codex', writer: 'codex' },
          agentModels: { classifier: 'gpt-6-astra', writer: 'gpt-6-astra' },
        },
      },
    ]);
  });

  it('opens every role under Per role, the investigator and researcher following the answerer', async () => {
    renderAgents();
    const [task] = screen.getAllByRole('button', { name: 'Per role' });
    fireEvent.click(task as HTMLElement);
    expect(task?.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByText('Plans, builds and fixes each round in one conversation, and runs its operation.')
    ).toBeTruthy();
    expect(screen.getByText('Finds the cause of a problem.')).toBeTruthy();
    expect(screen.getAllByText('Follows the answerer')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: 'Investigator model' })).toBeNull();
    for (const name of ['Planner model', 'Builder model', 'Fixer model', 'Operator model']) {
      expect(screen.queryByRole('combobox', { name })).toBeNull();
    }
    await choose('Agent model', 'Sonnet 5.5');
    expect(listSentCommands()).toEqual([
      {
        type: 'settings.change',
        patch: { agentProviders: { agent: 'claude' }, agentModels: { agent: 'sonnet' } },
      },
    ]);
    fireEvent.click(task as HTMLElement);
    expect(screen.queryByRole('combobox', { name: 'Agent model' })).toBeNull();
  });

  it('a pick for the group sets every role in it, and roles that differ start open as set per role', async () => {
    renderAgents({ ...createSettings(), agentModels: { answerer: 'sonnet' } });
    expect(screen.getByRole('combobox', { name: 'Model for task agents' }).textContent).toBe('Set per role');
    expect(screen.getByRole('combobox', { name: 'Answerer model' }).textContent).toBe('Sonnet 5.5');
    await choose('Model for task agents', 'Set per role');
    await choose('Model for task agents', 'Opus 5.5');
    expect(listSentCommands()).toEqual([
      {
        type: 'settings.change',
        patch: {
          agentProviders: { agent: 'claude', reviewer: 'claude', answerer: 'claude' },
          agentModels: { answerer: 'opus', agent: 'opus', reviewer: 'opus' },
        },
      },
    ]);
  });

  it('sets the speed for a whole group or for one role, and roles at different speeds start open', async () => {
    renderAgents({ ...createSettings(), agentFastModes: { agent: true } });
    expect(screen.getByRole('combobox', { name: 'Speed for task agents' }).textContent).toBe('Set per role');
    expect(screen.getByRole('combobox', { name: 'Agent speed' }).textContent).toBe('Fast');
    await choose('Reviewer speed', 'Fast');
    await choose('Speed for task agents', 'Set per role');
    await choose('Speed for quick jobs', 'Fast');
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { agentFastModes: { agent: true, reviewer: true } } },
      {
        type: 'settings.change',
        patch: { agentFastModes: { agent: true, classifier: true, writer: true } },
      },
    ]);
  });

  it('shows fast mode as unavailable where it needs usage credits, and keeps the group at standard speed', async () => {
    const usage = { ...createAccount({ id: 'a' }).usage, fastMode: 'needs_credits' as const };
    pushAccounts(createSnapshot({ accounts: [createAccount({ id: 'a', usage })] }));
    renderAgents({ ...createSettings(), fastMode: true });
    await settle();
    expect(screen.getByRole('combobox', { name: 'Speed for task agents' }).textContent).toBe('Standard');
    fireEvent.click(screen.getByRole('combobox', { name: 'Speed for task agents' }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    const fast = within(list).getByRole('option', { name: /Fast/ });
    expect(fast.textContent).toContain('Unavailable: needs usage credits');
    expect(fast.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Settings → Agents → Engine', () => {
  it('runs delegations without a limit by default and saves a picked limit', async () => {
    renderAgents();
    expect(screen.getByRole('combobox', { name: 'Delegations at once' }).textContent).toBe('No limit');
    await choose('Delegations at once', '4 at once');
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { delegationLimit: 4 } }]);
  });

  it('shows a limit set elsewhere and goes back to no limit', async () => {
    renderAgents({ ...createSettings(), delegationLimit: 6 });
    expect(screen.getByRole('combobox', { name: 'Delegations at once' }).textContent).toBe('6 at once');
    await choose('Delegations at once', 'No limit');
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { delegationLimit: null } }]);
  });

  it('saves a number typed in Custom…, refusing one that is not a whole number of 1 or more', async () => {
    renderAgents({ ...createSettings(), delegationLimit: 6 });
    await choose('Delegations at once', 'Custom…');
    const field = screen.getByRole('textbox', { name: 'Delegations' }) as HTMLInputElement;
    expect(field.value).toBe('6');
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole number of 1 or more.');
    fireEvent.change(field, { target: { value: '12' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      fireEvent.submit(field.closest('form') as HTMLFormElement);
    });
    await settle();
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { delegationLimit: 12 } }]);
  });

  it('keeps the dialog open when the save is refused, and sends nothing on Cancel', async () => {
    renderAgents();
    await choose('Delegations at once', 'Custom…');
    const field = screen.getByRole('textbox', { name: 'Delegations' }) as HTMLInputElement;
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: '3' } });
    holdAcks();
    await act(async () => {
      fireEvent.submit(field.closest('form') as HTMLFormElement);
    });
    await act(async () => {
      releaseAcks({ code: 'settings_invalid', message: 'No.' });
    });
    await settle();
    expect(screen.getByRole('textbox', { name: 'Delegations' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { delegationLimit: 3 } }]);
  });
});

describe('Settings → Agents → Autopilot', () => {
  const ESCALATING: Settings = {
    ...createSettings(),
    autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true },
  };

  it('shows only on an engine that has Autopilot', () => {
    const engine = resolveEngineInfo('1.0.0');
    spyOnEngine({ ...engine, features: engine.features.filter((feature) => feature !== 'autopilot') });
    renderAgents(ESCALATING);
    expect(screen.queryByRole('combobox', { name: 'Autopilot' })).toBeNull();
  });

  it('says it is off, and shows its three blocks once on', async () => {
    spyOnEngine();
    const { unmount } = renderAgents();
    await settle();
    expect(screen.getByText(AUTOPILOT_OFF)).toBeTruthy();
    expect(screen.queryByText(AUTOPILOT_BLOCKS.acting.title)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: AUTOPILOT_TURN_ON }));
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true } } },
    ]);
    unmount();
    renderAgents(ESCALATING);
    await settle();
    for (const block of Object.values(AUTOPILOT_BLOCKS)) expect(screen.getByText(block.title)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: AUTOPILOT_ROWS.usage })).toBeTruthy();
  });

  it('sets how much it does on its own, which gates it decides and Auto merge', async () => {
    spyOnEngine();
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getByRole('combobox', { name: AUTOPILOT_ROWS.level }).textContent).toBe('Balanced');
    expect(screen.getByText(AUTOPILOT_LEVEL_DESCRIPTION.balanced)).toBeTruthy();
    expect(screen.getByText(AUTO_MERGE_DESCRIPTION.low_risk)).toBeTruthy();
    await choose(AUTOPILOT_ROWS.level, /^Most things/);
    await choose('Agent questions', 'Always ask me');
    await choose(AUTOPILOT_ROWS.autoMerge, 'Off, I merge');
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { autopilot: { ...ESCALATING.autopilot, level: 'most' } } },
      {
        type: 'settings.change',
        patch: {
          autopilot: {
            ...ESCALATING.autopilot,
            gates: ['plans', 'reviews', 'watchdogTasks', 'proposals', 'failures', 'findings'],
          },
        },
      },
      { type: 'settings.change', patch: { autopilot: { ...ESCALATING.autopilot, autoMerge: 'off' } } },
    ]);
  });

  it('shows how well it knows you and uses the level it suggests only when you click', async () => {
    spyOnEngine();
    pushState(
      createShinsaState({
        patch: { autopilotProfile: createAutopilotProfile({ agreed: 46, disagreed: 4 }) },
      })
    );
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getByText(AUTOPILOT_BLOCKS.score.title)).toBeTruthy();
    const percent = screen.getAllByText(/^\d+%$/)[0]?.textContent ?? '';
    expect(Number.parseInt(percent, 10)).toBeGreaterThanOrEqual(90);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('Agrees with you')).toBeNull();
    expect(screen.queryByText('50')).toBeNull();
    expect(screen.queryByText('What it learned')).toBeNull();
    expect(screen.getByText(AUTOPILOT_SCORE_ROWS.margin)).toBeTruthy();
    expect(screen.getByText(/^\d+ points ahead$/)).toBeTruthy();
    expect(screen.queryByText(AUTOPILOT_SCORE_ROWS.topics)).toBeNull();
    expect(screen.queryByText(AUTOPILOT_SCORE_ROWS.followUps)).toBeNull();
    expect(listSentCommands()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Use Most things' }));
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { autopilot: { ...ESCALATING.autopilot, level: 'most' } } },
    ]);
  });

  it('offers Everything once a kind of gate is ready and marks that kind', async () => {
    spyOnEngine();
    const { unmount } = renderAgents(ESCALATING);
    await settle();
    expect(screen.getByText(AUTOPILOT_BLOCKS.readiness.title)).toBeTruthy();
    expect(screen.getByText('It has not guessed any of your failed steps yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: AUTOPILOT_ROWS.level }));
    await settle();
    expect(screen.queryByRole('option', { name: /^Everything/ })).toBeNull();
    unmount();
    pushState(
      createShinsaState({
        patch: {
          autopilotProfile: createAutopilotKindsProfile({ review: { scored: 120, agreed: 114, base: 0.85 } }),
        },
      })
    );
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getByLabelText('Ready for Everything')).toBeTruthy();
    await choose(AUTOPILOT_ROWS.level, /^Everything/);
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { autopilot: { ...ESCALATING.autopilot, level: 'everything' } } },
    ]);
  });

  it('keeps showing Everything once it is your level', async () => {
    spyOnEngine();
    renderAgents({ ...ESCALATING, autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true, level: 'everything' } });
    await settle();
    expect(screen.getByRole('combobox', { name: AUTOPILOT_ROWS.level }).textContent).toBe('Everything');
    expect(screen.getByText(AUTOPILOT_LEVEL_DESCRIPTION.everything)).toBeTruthy();
    expect(screen.queryByLabelText('Ready for Everything')).toBeNull();
  });

  it('shows the topics you raise and how often its follow-ups matched yours', async () => {
    spyOnEngine();
    pushState(
      createShinsaState({
        patch: {
          autopilotProfile: {
            ...createAutopilotProfile({ agreed: 46, disagreed: 4 }),
            topics: [
              { topic: 'security', total: 5, recent: 3, at: NOW },
              { topic: 'data_loss', total: 2, recent: 2, at: NOW },
            ],
            followUps: { scored: 4, matched: 3 },
          },
        },
      })
    );
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getByText(AUTOPILOT_SCORE_ROWS.topics)).toBeTruthy();
    expect(screen.getByText('Security, data loss')).toBeTruthy();
    expect(screen.getByText(AUTOPILOT_SCORE_ROWS.followUps)).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('says the suggested level is in use once you already chose it', async () => {
    spyOnEngine();
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getAllByText('0%')).toHaveLength(7);
    expect(screen.queryByText('Learning')).toBeNull();
    expect(screen.getByText('In use')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
  });

  it('warns when nobody can be asked, and stops warning once your team is never contacted', async () => {
    spyOnEngine();
    const { unmount } = renderAgents(ESCALATING);
    await settle();
    expect(screen.getByText(TEAM_CONTACT.alone)).toBeTruthy();
    expect(document.querySelector('.text-warning')).toBeTruthy();
    unmount();
    renderAgents({ ...ESCALATING, autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true, escalate: false } });
    await settle();
    expect(document.querySelector('.text-warning')).toBeNull();
  });

  it('asks your team once a project is shared with one', async () => {
    spyOnEngine();
    pushState(createShinsaState({ projects: [createProject({ id: 'p1', teamIds: ['team-1'] })] }));
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getByText(TEAM_CONTACT.shared)).toBeTruthy();
    await choose(AUTOPILOT_ROWS.escalate, /^Never/);
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { autopilot: { ...ESCALATING.autopilot, escalate: false } } },
    ]);
  });

  describe('Escalate to', () => {
    const SLACK = {
      remote: true,
      connectUrl: null,
      links: [{ teamId: 'T1', teamName: 'Overclock', userId: 'U1', userName: 'Christo', linkedAt: 1 }],
      problem: null,
    };
    const DIRECTORY = {
      teamId: 'T1',
      channels: [
        { id: 'C1', name: 'oncall' },
        { id: 'C2', name: 'eng' },
      ],
      people: [{ id: 'U7', name: 'Kai', image: 'https://avatars.slack-edge.com/kai.png' }],
      problem: null,
    };

    function answerSlack(slack: unknown = SLACK) {
      providers.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = readFetchCall(input, init);
        if (path === '/api/slack') return Response.json(slack);
        if (path === '/api/slack/directory?teamId=T1') return Response.json(DIRECTORY);
        if (path === '/api/slack/test') {
          const { contact } = JSON.parse(String(init?.body)) as { contact: { id: string } };
          return Response.json(
            contact.id === 'C1' ? { sent: true, problem: null } : { sent: false, problem: 'Not in it.' }
          );
        }
        return new Response('offline', { status: 503 });
      }) as typeof fetch);
    }

    const ADD = 'Add from Slack';

    async function openPicker() {
      fireEvent.click(screen.getByRole('button', { name: ADD }));
      await settle();
      await settle();
      return screen.getByRole('dialog');
    }

    function pick(dialog: HTMLElement, name: string) {
      fireEvent.click(within(dialog).getByRole('option', { name }));
    }

    it('lists your team first, with no Slack contacts by default', async () => {
      spyOnEngine();
      answerSlack();
      renderAgents(ESCALATING);
      await settle();
      expect(screen.getByText(TEAM_CONTACT.title)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Stop / })).toBeNull();
      expect((screen.getByRole('button', { name: 'Send a test' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables adding from Slack until Slack is connected, saying where', async () => {
      spyOnEngine();
      answerSlack({ ...SLACK, links: [] });
      renderAgents(ESCALATING);
      await settle();
      expect((screen.getByRole('button', { name: ADD }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables it on an engine that cannot send to Slack', async () => {
      const engine = resolveEngineInfo('1.0.0');
      spyOnEngine({
        ...engine,
        features: engine.features.filter((feature) => feature !== 'autopilot-slack'),
      });
      answerSlack();
      renderAgents(ESCALATING);
      await settle();
      expect((screen.getByRole('button', { name: ADD }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('searches the channels Shinsa is in and the people, and adds the one you pick', async () => {
      spyOnEngine();
      answerSlack();
      renderAgents(ESCALATING);
      await settle();
      const dialog = await openPicker();
      expect(within(dialog).getByText('Channels')).toBeTruthy();
      expect(within(dialog).getByText('People')).toBeTruthy();
      fireEvent.change(within(dialog).getByPlaceholderText('Search channels and people'), {
        target: { value: 'ka' },
      });
      await settle();
      expect(within(dialog).queryByRole('option', { name: 'eng' })).toBeNull();
      pick(dialog, 'Kai');
      expect(listSentCommands()).toEqual([
        {
          type: 'settings.change',
          patch: {
            autopilot: {
              ...ESCALATING.autopilot,
              contacts: [
                {
                  kind: 'slack_person',
                  teamId: 'T1',
                  id: 'U7',
                  name: 'Kai',
                  image: 'https://avatars.slack-edge.com/kai.png',
                },
              ],
            },
          },
        },
      ]);
    });

    it('keeps a channel and a teammate both, each removable on its own', async () => {
      spyOnEngine();
      answerSlack();
      const channel = { kind: 'slack_channel' as const, teamId: 'T1', id: 'C1', name: 'oncall' };
      const person = { kind: 'slack_person' as const, teamId: 'T1', id: 'U7', name: 'Kai' };
      renderAgents({
        ...ESCALATING,
        autopilot: { ...ESCALATING.autopilot!, contacts: [channel, person] },
      } as Settings);
      await settle();
      expect(screen.getByText('oncall')).toBeTruthy();
      expect(screen.queryByText('#oncall')).toBeNull();
      const dialog = await openPicker();
      expect(within(dialog).getByRole('option', { name: 'oncall' }).querySelector('.invisible')).toBeNull();
      expect(within(dialog).getByRole('option', { name: 'eng' }).querySelector('.invisible')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Stop posting in #oncall' }));
      expect(listSentCommands()).toEqual([
        {
          type: 'settings.change',
          patch: { autopilot: { ...ESCALATING.autopilot, contacts: [person] } },
        },
      ]);
    });

    it('shows a person’s Slack picture, and sends a test to each contact', async () => {
      spyOnEngine();
      answerSlack();
      const channel = { kind: 'slack_channel' as const, teamId: 'T1', id: 'C1', name: 'oncall' };
      const person = { ...DIRECTORY.people[0]!, kind: 'slack_person' as const, teamId: 'T1' };
      const { container } = renderAgents({
        ...ESCALATING,
        autopilot: { ...ESCALATING.autopilot!, contacts: [channel] },
      } as Settings);
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Send a test' }));
      await settle();
      expect(toasts.success).toHaveBeenCalledWith('Sent a test to Slack');
      renderAgents({
        ...ESCALATING,
        autopilot: { ...ESCALATING.autopilot!, contacts: [person] },
      } as Settings);
      await settle();
      expect(
        container.ownerDocument.querySelector('img[src="https://avatars.slack-edge.com/kai.png"]')
      ).toBeTruthy();
      fireEvent.click(screen.getAllByRole('button', { name: 'Send a test' }).at(-1)!);
      await settle();
      expect(toasts.error).toHaveBeenCalledWith('Not sent to Kai: Not in it.');
    });

    it('asks which workspace when Slack is connected in more than one', async () => {
      spyOnEngine();
      answerSlack({
        ...SLACK,
        links: [
          ...SLACK.links,
          { teamId: 'T2', teamName: 'Acme', userId: 'U1', userName: 'Christo', linkedAt: 1 },
        ],
      });
      renderAgents(ESCALATING);
      await settle();
      await openPicker();
      expect(screen.getByRole('combobox', { name: 'Slack workspace' }).textContent).toBe('Overclock');
      await choose('Slack workspace', 'Acme');
      expect(screen.getByRole('combobox', { name: 'Slack workspace' }).textContent).toBe('Acme');
    });
  });
});
