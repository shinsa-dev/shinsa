import type { AutopilotContact, AutopilotPolicy, Settings, SlackSnapshot } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shinsa/ui/components/command';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { toast } from '@shinsa/ui/components/sonner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { HintButton } from '@/components/controls/hint-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { CheckMark } from '@/components/status/check-mark.tsx';
import {
  AUTO_MERGE_ITEMS,
  AUTOPILOT_BLOCKS,
  AUTOPILOT_ENABLED_ITEMS,
  AUTOPILOT_ESCALATE_ITEMS,
  AUTOPILOT_GATE_ITEMS,
  AUTOPILOT_GATE_ROWS,
  AUTOPILOT_LEVEL_ITEMS,
  AUTOPILOT_OFF,
  AUTOPILOT_ROWS,
  AUTOPILOT_TITLE,
  AUTOPILOT_TURN_ON,
  AUTOPILOT_USAGE_ITEMS,
  CONTACT_PICKER_HINT,
  describeAutopilotContact,
  describeContactPickerEmpty,
  describeSlackTestResults,
  hasTeamProject,
  isAskWaiting,
  isSlackTestSent,
  listContactOptions,
  listSlackWorkspaceItems,
  resolveAutopilotValue,
  resolveContactAddBlock,
  resolveContactTestBlock,
  resolveContactWorkspace,
  resolveSlackUnavailable,
  TEAM_CONTACT,
  toggleAutopilotContact,
  toggleAutopilotGate,
} from '@/lib/autopilot.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { sendSlackTests, useSlack, useSlackDirectory } from '@/lib/connection/slack.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import {
  SETTING_ROW,
  SettingRow,
  SettingsBlock,
  SettingsEmpty,
  SettingsGroup,
  TOKEN_TEXT,
} from './group.tsx';

function BlockHeader({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <Icon size='sm' name={icon} className='text-fg-2' />
      <span className='min-w-0 flex-1 truncate text-xs font-medium text-fg-4'>{title}</span>
      {children}
    </>
  );
}

function ContactFace({ contact }: { contact: Pick<AutopilotContact, 'kind' | 'name' | 'image'> }) {
  if (contact.kind === 'slack_channel')
    return <Icon size='sm' name='IconHashtag' className='shrink-0 text-fg-2' />;
  if (contact.image)
    return (
      <img
        src={contact.image}
        alt=''
        referrerPolicy='no-referrer'
        className='size-4 shrink-0 rounded-full bg-bg-a2'
      />
    );
  return (
    <span
      aria-hidden
      className='grid size-4 shrink-0 place-items-center rounded-full bg-bg-a2 text-2xs leading-none font-medium text-fg-2'
    >
      <span className='scale-75'>{contact.name.charAt(0).toUpperCase()}</span>
    </span>
  );
}

function ContactPicker({
  snapshot,
  contacts,
  onToggle,
}: {
  snapshot: SlackSnapshot | null;
  contacts: readonly AutopilotContact[];
  onToggle: (contact: AutopilotContact) => void;
}) {
  const [chosenWorkspace, setChosenWorkspace] = React.useState<string | null>(null);
  const teamId = resolveContactWorkspace(snapshot, chosenWorkspace);
  const directory = useSlackDirectory(teamId);
  const workspaces = listSlackWorkspaceItems(snapshot);
  return (
    <Command>
      <CommandInput placeholder='Search channels and people' aria-label='Search channels and people' />
      {workspaces.length > 1 && (
        <div className='border-b border-border px-1.5 py-1'>
          <SelectField
            label='Slack workspace'
            size='sm'
            align='start'
            items={workspaces}
            value={teamId ?? ''}
            onValueChange={setChosenWorkspace}
          />
        </div>
      )}
      <CommandList>
        <CommandEmpty>{describeContactPickerEmpty(directory)}</CommandEmpty>
        {listContactOptions(directory, contacts).map((group) => (
          <CommandGroup key={group.kind} heading={group.heading}>
            {group.options.map(({ contact, chosen, disabled }) => (
              <CommandItem
                key={contact.id}
                value={`${contact.name} ${contact.id}`}
                disabled={disabled}
                onSelect={() => onToggle(contact)}
              >
                <ContactFace contact={contact} />
                <Truncate className='min-w-0 flex-1'>{contact.name}</Truncate>
                <CheckMark className={cn('shrink-0', !chosen && 'invisible')} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <p className='border-t border-border px-2.5 py-2 text-2xs text-fg-2'>{CONTACT_PICKER_HINT}</p>
    </Command>
  );
}

function Blocked({ reason, children }: { reason: string | null; children: React.ReactElement }) {
  if (!reason) return children;
  return (
    <Hint label={reason}>
      <span>{children}</span>
    </Hint>
  );
}

function AskBlock({
  contacts,
  team,
  onContactsChange,
}: {
  contacts: readonly AutopilotContact[];
  team: boolean;
  onContactsChange: (contacts: AutopilotContact[]) => void;
}) {
  const available = useEngineFeature('autopilot-slack');
  const slack = useSlack();
  const [testing, setTesting] = React.useState(false);
  const unavailable = resolveSlackUnavailable(available, slack);
  const addBlock = resolveContactAddBlock(contacts, unavailable);
  const testBlock = resolveContactTestBlock(contacts, unavailable);
  const toggle = (contact: AutopilotContact) => onContactsChange(toggleAutopilotContact(contacts, contact));
  const test = async () => {
    setTesting(true);
    const results = await sendSlackTests(contacts);
    setTesting(false);
    if (isSlackTestSent(results)) toast.success(describeSlackTestResults(results));
    else toast.error(describeSlackTestResults(results));
  };
  return (
    <SettingsBlock
      header={
        <BlockHeader icon={AUTOPILOT_BLOCKS.asks.icon} title={AUTOPILOT_BLOCKS.asks.title}>
          <Blocked reason={testBlock}>
            <Button
              variant='secondary'
              size='sm'
              icon='IconTestTube'
              loading={testing}
              disabled={testBlock !== null}
              onClick={() => void test()}
            >
              Send a test
            </Button>
          </Blocked>
          <Popover>
            <Blocked reason={addBlock}>
              <PopoverTrigger
                render={
                  <Button variant='secondary' size='sm' icon='IconPlusSmall' disabled={addBlock !== null} />
                }
              >
                Add from Slack
              </PopoverTrigger>
            </Blocked>
            <PopoverContent align='end' className='w-80 overflow-hidden p-0'>
              <ContactPicker snapshot={slack.snapshot} contacts={contacts} onToggle={toggle} />
            </PopoverContent>
          </Popover>
        </BlockHeader>
      }
    >
      <div className={cn(SETTING_ROW, 'gap-2')}>
        <Icon size='sm' name='IconUserDuo' className='shrink-0 text-fg-2' />
        <span className='min-w-0 flex-1 truncate text-xs text-fg-4'>{TEAM_CONTACT.title}</span>
        <span className={cn(TOKEN_TEXT, 'pr-1.5')}>{team ? TEAM_CONTACT.shared : TEAM_CONTACT.alone}</span>
      </div>
      {contacts.map((contact) => {
        const shown = describeAutopilotContact(contact, slack.snapshot);
        return (
          <div key={`${contact.teamId}:${contact.kind}:${contact.id}`} className={cn(SETTING_ROW, 'gap-2')}>
            <ContactFace contact={contact} />
            <Truncate className='min-w-0 flex-1 text-xs text-fg-4'>{shown.title}</Truncate>
            {shown.detail && <span className={TOKEN_TEXT}>{shown.detail}</span>}
            <HintButton
              size='icon-sm'
              icon='IconCrossSmall'
              label={shown.removeLabel}
              onClick={() => toggle(contact)}
            />
          </div>
        );
      })}
    </SettingsBlock>
  );
}

export function AutopilotSettings({ settings }: { settings: Settings }) {
  const available = useEngineFeature('autopilot');
  const projects = useShinsaSelector((state) => state.projects);
  const { policy, enabled } = resolveAutopilotValue(settings);
  if (!available) return null;
  const team = hasTeamProject(Object.values(projects ?? {}));
  const updateAutopilot = (patch: Partial<AutopilotPolicy>) => {
    void updateSettings({ autopilot: { ...policy, ...patch } });
  };
  return (
    <SettingsGroup
      title={AUTOPILOT_TITLE}
      className='gap-1.5'
      action={
        policy.enabled ? (
          <SelectField
            label={AUTOPILOT_TITLE}
            size='sm'
            items={AUTOPILOT_ENABLED_ITEMS}
            value={enabled}
            onValueChange={(value) => updateAutopilot({ enabled: value === 'on' })}
          />
        ) : (
          <Button
            variant='secondary'
            size='sm'
            icon='IconRocket'
            onClick={() => updateAutopilot({ enabled: true })}
          >
            {AUTOPILOT_TURN_ON}
          </Button>
        )
      }
    >
      {!policy.enabled && <SettingsEmpty>{AUTOPILOT_OFF}</SettingsEmpty>}
      {policy.enabled && (
        <>
          <SettingsBlock
            header={<BlockHeader icon={AUTOPILOT_BLOCKS.acting.icon} title={AUTOPILOT_BLOCKS.acting.title} />}
          >
            <SettingRow title={AUTOPILOT_ROWS.level}>
              <SelectField
                label={AUTOPILOT_ROWS.level}
                items={AUTOPILOT_LEVEL_ITEMS}
                value={policy.level}
                onValueChange={(level) => updateAutopilot({ level })}
              />
            </SettingRow>
            {AUTOPILOT_GATE_ROWS.map((row) => (
              <SettingRow key={row.gate} title={row.title}>
                <SelectField
                  label={row.title}
                  items={AUTOPILOT_GATE_ITEMS}
                  value={policy.gates.includes(row.gate) ? 'on' : 'off'}
                  onValueChange={(value) =>
                    updateAutopilot({ gates: toggleAutopilotGate(policy.gates, row.gate, value === 'on') })
                  }
                />
              </SettingRow>
            ))}
          </SettingsBlock>
          <SettingsBlock
            header={
              <BlockHeader icon={AUTOPILOT_BLOCKS.merging.icon} title={AUTOPILOT_BLOCKS.merging.title} />
            }
          >
            <SettingRow title={AUTOPILOT_ROWS.autoMerge}>
              <SelectField
                label={AUTOPILOT_ROWS.autoMerge}
                items={AUTO_MERGE_ITEMS}
                value={policy.autoMerge}
                onValueChange={(autoMerge) => updateAutopilot({ autoMerge })}
              />
            </SettingRow>
            <SettingRow
              title={
                <>
                  {AUTOPILOT_ROWS.escalate}
                  {isAskWaiting(policy, team) && (
                    <Hint label='No one is asked yet. Add a Slack channel or person, or share a project with a team.'>
                      <Icon size='sm' name='IconCircleInfo' className='text-warning' />
                    </Hint>
                  )}
                </>
              }
            >
              <SelectField
                label={AUTOPILOT_ROWS.escalate}
                items={AUTOPILOT_ESCALATE_ITEMS}
                value={policy.escalate ? 'on' : 'off'}
                onValueChange={(value) => updateAutopilot({ escalate: value === 'on' })}
              />
            </SettingRow>
            <SettingRow title={AUTOPILOT_ROWS.usage}>
              <SelectField
                label={AUTOPILOT_ROWS.usage}
                items={AUTOPILOT_USAGE_ITEMS}
                value={policy.ignoreUsageLimits ? 'on' : 'off'}
                onValueChange={(value) => updateAutopilot({ ignoreUsageLimits: value === 'on' })}
              />
            </SettingRow>
          </SettingsBlock>
          <AskBlock
            contacts={policy.contacts}
            team={team}
            onContactsChange={(contacts) => updateAutopilot({ contacts })}
          />
        </>
      )}
    </SettingsGroup>
  );
}
