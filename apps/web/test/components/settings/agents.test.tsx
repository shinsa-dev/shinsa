import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import { AUTOPILOT_DEFAULTS, createSettings, resolveEngineInfo, type Settings } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentSettings } from '@/components/settings/agents.tsx';
import { AUTOPILOT_NO_TEAM, AUTOPILOT_ROWS } from '@/lib/autopilot.ts';
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
import { createProject, createShinsaState } from '../../support/state.ts';

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

function renderAgents(settings: Settings = createSettings()) {
  return render(
    <TooltipProvider>
      <AgentSettings settings={settings} />
    </TooltipProvider>
  );
}

async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  await settle();
  const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await settle();
}

describe('Settings → Agents → Models', () => {
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
    autopilot: { ...AUTOPILOT_DEFAULTS, enabled: true, urgent: 'escalate' },
  };

  it('shows only on an engine that has Autopilot', () => {
    const engine = resolveEngineInfo('1.0.0');
    spyOnEngine({ ...engine, features: engine.features.filter((feature) => feature !== 'autopilot') });
    renderAgents(ESCALATING);
    expect(screen.queryByRole('combobox', { name: 'Autopilot' })).toBeNull();
  });

  it('warns that an escalation reaches only you while no project is in a team', async () => {
    spyOnEngine();
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getByRole('combobox', { name: 'Autopilot' })).toBeTruthy();
    expect(screen.getByText(AUTOPILOT_NO_TEAM)).toBeTruthy();
  });

  it('leaves the warning out once a project is in a team', async () => {
    spyOnEngine();
    pushState(createShinsaState({ projects: [createProject({ id: 'p1', teamIds: ['team-1'] })] }));
    renderAgents(ESCALATING);
    await settle();
    expect(screen.getByRole('combobox', { name: 'When an urgent merge waits for you' })).toBeTruthy();
    expect(screen.queryByText(AUTOPILOT_NO_TEAM)).toBeNull();
    expect(screen.getByText(AUTOPILOT_ROWS.urgent.description)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: AUTOPILOT_ROWS.usage.title })).toBeTruthy();
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
      people: [{ id: 'U7', name: 'Kai' }],
      problem: null,
    };

    function answerSlack(slack: unknown = SLACK) {
      providers.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = readFetchCall(input, init);
        if (path === '/api/slack') return Response.json(slack);
        if (path === '/api/slack/directory?teamId=T1') return Response.json(DIRECTORY);
        return new Response('offline', { status: 503 });
      }) as typeof fetch);
    }

    async function openContact() {
      fireEvent.click(screen.getByRole('combobox', { name: 'Escalate to' }));
      await settle();
      return screen.getAllByRole('listbox').at(-1) as HTMLElement;
    }

    it('reads your team by default, and is left out while urgent changes only wait or merge', async () => {
      spyOnEngine();
      const { unmount } = renderAgents(ESCALATING);
      await settle();
      expect(screen.getByRole('combobox', { name: 'Escalate to' }).textContent).toBe('Your team in Shinsa');
      expect(screen.queryByRole('combobox', { name: 'Slack workspace' })).toBeNull();
      unmount();
      renderAgents({ ...ESCALATING, autopilot: { ...ESCALATING.autopilot, urgent: 'merge' } } as Settings);
      expect(screen.queryByRole('combobox', { name: 'Escalate to' })).toBeNull();
    });

    it('disables the Slack choices until Slack is connected, saying where', async () => {
      spyOnEngine();
      answerSlack({ ...SLACK, links: [] });
      renderAgents(ESCALATING);
      await settle();
      const list = await openContact();
      const channel = within(list).getByRole('option', { name: /a Slack channel/ });
      expect(channel.textContent).toContain('Connect Slack in Settings → General first');
      expect(channel.getAttribute('aria-disabled')).toBe('true');
    });

    it('disables them on an engine that cannot send to Slack', async () => {
      const engine = resolveEngineInfo('1.0.0');
      spyOnEngine({
        ...engine,
        features: engine.features.filter((feature) => feature !== 'autopilot-slack'),
      });
      answerSlack();
      renderAgents(ESCALATING);
      await settle();
      const list = await openContact();
      expect(within(list).getByRole('option', { name: /a teammate on Slack/ }).textContent).toContain(
        'Update Shinsa on this machine first'
      );
    });

    it('saves a channel only once one is picked, from the channels Shinsa is in', async () => {
      spyOnEngine();
      answerSlack();
      renderAgents(ESCALATING);
      await settle();
      await choose('Escalate to', 'Your team and a Slack channel');
      expect(listSentCommands()).toEqual([]);
      expect(screen.getByRole('combobox', { name: 'Slack workspace' }).textContent).toBe('Overclock');
      await settle();
      expect(screen.getByRole('combobox', { name: 'Channel' }).textContent).toBe('Choose a channel');
      expect(screen.getByText(AUTOPILOT_ROWS.slack_channel.description)).toBeTruthy();
      await choose('Channel', 'eng');
      expect(listSentCommands()).toEqual([
        {
          type: 'settings.change',
          patch: {
            autopilot: {
              ...ESCALATING.autopilot,
              contact: { kind: 'slack_channel', teamId: 'T1', id: 'C2', name: 'eng' },
            },
          },
        },
      ]);
    });

    it('shows a saved teammate, and going back to your team saves at once', async () => {
      spyOnEngine();
      answerSlack();
      const contact = { kind: 'slack_person' as const, teamId: 'T1', id: 'U7', name: 'Kai' };
      renderAgents({ ...ESCALATING, autopilot: { ...ESCALATING.autopilot!, contact } } as Settings);
      await settle();
      expect(screen.getByRole('combobox', { name: 'Escalate to' }).textContent).toBe(
        'Your team and a teammate on Slack'
      );
      expect(screen.getByRole('combobox', { name: 'Teammate' }).textContent).toBe('Kai');
      await choose('Slack workspace', 'Overclock');
      await choose('Escalate to', 'Your team in Shinsa');
      expect(listSentCommands()).toEqual([
        {
          type: 'settings.change',
          patch: { autopilot: { ...ESCALATING.autopilot, contact: { kind: 'team' } } },
        },
      ]);
    });
  });
});
