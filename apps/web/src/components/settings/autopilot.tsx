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
import {
  AUTOPILOT_BLOCKS,
  AUTOPILOT_DESCRIPTION,
  AUTOPILOT_ENABLED_ITEMS,
  AUTOPILOT_MERGE_ITEMS,
  AUTOPILOT_OFF,
  AUTOPILOT_RISK_ITEMS,
  AUTOPILOT_ROWS,
  AUTOPILOT_TITLE,
  AUTOPILOT_USAGE_ITEMS,
  CONTACT_PICKER_HINT,
  describeAutopilotContact,
  describeContactPickerEmpty,
  describeSlackTestResults,
  hasTeamProject,
  isAskWaiting,
  isSlackTestSent,
  listAutopilotUrgentItems,
  listAutopilotWaitItems,
  listContactOptions,
  listSlackWorkspaceItems,
  resolveAutopilotValue,
  resolveContactAddBlock,
  resolveContactTestBlock,
  resolveContactWorkspace,
  resolveSlackUnavailable,
  TEAM_CONTACT,
  toggleAutopilotContact,
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
                <Icon
                  name='IconCheckmark1Small'
                  className={cn('shrink-0 text-primary', !chosen && 'invisible')}
                />
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
              icon='IconSend'
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
  const reachable = team || policy.contacts.length > 0;
  const updateAutopilot = (patch: Partial<AutopilotPolicy>) => {
    void updateSettings({ autopilot: { ...policy, ...patch } });
  };
  return (
    <SettingsGroup
      title={AUTOPILOT_TITLE}
      description={AUTOPILOT_DESCRIPTION}
      className='gap-1.5'
      action={
        <SelectField
          label={AUTOPILOT_TITLE}
          size='sm'
          items={AUTOPILOT_ENABLED_ITEMS}
          value={enabled}
          onValueChange={(value) => updateAutopilot({ enabled: value === 'on' })}
        />
      }
    >
      {!policy.enabled && <SettingsEmpty>{AUTOPILOT_OFF}</SettingsEmpty>}
      {policy.enabled && (
        <>
          <SettingsBlock
            header={
              <BlockHeader icon={AUTOPILOT_BLOCKS.approving.icon} title={AUTOPILOT_BLOCKS.approving.title} />
            }
          >
            <SettingRow title={AUTOPILOT_ROWS.approve}>
              <SelectField
                label={AUTOPILOT_ROWS.approve}
                items={AUTOPILOT_RISK_ITEMS}
                value={policy.approveUpTo}
                onValueChange={(approveUpTo) => updateAutopilot({ approveUpTo })}
              />
            </SettingRow>
            <SettingRow title={AUTOPILOT_ROWS.urgentApprove}>
              <SelectField
                label={AUTOPILOT_ROWS.urgentApprove}
                items={AUTOPILOT_RISK_ITEMS}
                value={policy.urgentApproveUpTo}
                onValueChange={(urgentApproveUpTo) => updateAutopilot({ urgentApproveUpTo })}
              />
            </SettingRow>
            <SettingRow title={AUTOPILOT_ROWS.merge}>
              <SelectField
                label={AUTOPILOT_ROWS.merge}
                items={AUTOPILOT_MERGE_ITEMS}
                value={policy.merge}
                onValueChange={(merge) => updateAutopilot({ merge })}
              />
            </SettingRow>
          </SettingsBlock>
          <SettingsBlock
            header={<BlockHeader icon={AUTOPILOT_BLOCKS.urgent.icon} title={AUTOPILOT_BLOCKS.urgent.title} />}
          >
            {policy.urgent !== 'wait' && (
              <SettingRow title={AUTOPILOT_ROWS.wait}>
                <SelectField
                  label={AUTOPILOT_ROWS.wait}
                  items={listAutopilotWaitItems(policy)}
                  value={String(policy.urgentWaitMinutes)}
                  onValueChange={(value) => updateAutopilot({ urgentWaitMinutes: Number(value) })}
                />
              </SettingRow>
            )}
            <SettingRow
              title={
                <>
                  {AUTOPILOT_ROWS.urgent}
                  {isAskWaiting(policy, team) && (
                    <Hint label='No one is asked yet. Add a Slack channel or person, or share a project with a team.'>
                      <Icon size='sm' name='IconCircleInfo' className='text-warning' />
                    </Hint>
                  )}
                </>
              }
            >
              <SelectField
                label={AUTOPILOT_ROWS.urgent}
                items={listAutopilotUrgentItems(reachable)}
                value={policy.urgent}
                onValueChange={(urgent) => updateAutopilot({ urgent })}
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
