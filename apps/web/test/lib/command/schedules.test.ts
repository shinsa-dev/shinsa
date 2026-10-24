import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Command, CommandSection } from '@/lib/command/registry.ts';
import { listScheduleSections } from '@/lib/command/schedules.ts';
import * as settings from '@/lib/command/settings.ts';
import * as schedules from '@/lib/schedules.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createSchedule } from '../../support/schedules.ts';
import { createShinsaState } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

function commandsOf(command: Command | undefined): Command[] {
  if (command?.kind !== 'page' || command.page.kind !== 'list') throw new Error('Not a list page');
  return command.page.sections.flatMap((section) => section.commands);
}

function run(command: Command | undefined) {
  if (command?.kind !== 'run') throw new Error('Not runnable');
  command.run();
}

function only(sections: CommandSection[]) {
  return sections[0]?.commands ?? [];
}

describe('schedules in ⌘K', () => {
  it('has nothing to offer without schedules', () => {
    expect(listScheduleSections(createShinsaState({}))).toEqual([]);
  });

  it('opens Settings → Schedules, and lists each schedule only while typing', () => {
    const open = spyOn(settings, 'openSettingsSection').mockImplementation(() => undefined);
    const state = createShinsaState({
      patch: { schedules: { a: createSchedule({ id: 'a', name: 'Audit' }) } },
    });
    const [section] = listScheduleSections(state);
    expect(section).toMatchObject({ id: 'global.schedules', heading: 'Schedules' });
    const [jump, audit] = only([section as CommandSection]);
    expect(jump).toMatchObject({ label: 'Schedules', icon: 'IconClock' });
    run(jump);
    expect(open).toHaveBeenCalledWith('Schedules');
    expect(audit).toMatchObject({
      label: 'Audit',
      hint: 'Every hour',
      icon: 'IconArrowsRepeat',
      searchOnly: true,
    });
    open.mockRestore();
  });

  it('pauses a running schedule and deletes it behind a confirm page', () => {
    const enable = spyOn(schedules, 'updateScheduleEnabled').mockResolvedValue(true);
    const remove = spyOn(schedules, 'removeSchedule').mockResolvedValue(true);
    const audit = createSchedule({ id: 'a', name: 'Audit', lastTaskId: 't-1' });
    const actions = commandsOf(
      only(listScheduleSections(createShinsaState({ patch: { schedules: { a: audit } } })))[1]
    );
    expect(actions.map((command) => command.label)).toEqual(['Pause', 'Open the task', 'Delete schedule']);
    expect(actions[1]).toMatchObject({ kind: 'go', to: '/tasks/t-1' });
    run(actions[0]);
    const confirm = commandsOf(actions[2]);
    expect(confirm.map((command) => command.label)).toEqual(['Delete schedule', 'Keep it']);
    run(confirm[1]);
    expect(remove).not.toHaveBeenCalled();
    run(confirm[0]);
    expect(enable).toHaveBeenCalledWith(audit, false);
    expect(remove).toHaveBeenCalledWith(audit);
    enable.mockRestore();
    remove.mockRestore();
  });

  it('resumes a paused webhook schedule and copies its URL', () => {
    const enable = spyOn(schedules, 'updateScheduleEnabled').mockResolvedValue(true);
    const copy = spyOn(schedules, 'copyWebhookUrl').mockResolvedValue(undefined);
    const hook = createSchedule({
      id: 'h',
      name: 'Pushes',
      enabled: false,
      trigger: { kind: 'webhook', signature: null, replayKey: null },
    });
    const actions = commandsOf(
      only(listScheduleSections(createShinsaState({ patch: { schedules: { h: hook } } })))[1]
    );
    expect(actions.map((command) => command.label)).toEqual([
      'Resume',
      'Copy webhook URL',
      'Delete schedule',
    ]);
    run(actions[0]);
    run(actions[1]);
    expect(enable).toHaveBeenCalledWith(hook, true);
    expect(copy).toHaveBeenCalledWith(hook);
    enable.mockRestore();
    copy.mockRestore();
  });
});
