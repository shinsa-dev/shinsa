import type { AutopilotContact, AutopilotPolicy, Settings } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shinsa/ui/components/command';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { HintButton } from '@/components/controls/hint-button.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import {
  AUTOPILOT_DESCRIPTION,
  AUTOPILOT_ENABLED_ITEMS,
  AUTOPILOT_MERGE_ITEMS,
  AUTOPILOT_NO_TEAM,
  AUTOPILOT_RISK_ITEMS,
  AUTOPILOT_ROWS,
  AUTOPILOT_TITLE,
  AUTOPILOT_URGENT_ITEMS,
  AUTOPILOT_USAGE_ITEMS,
  CONTACT_PICKER_HINT,
  describeAutopilotContact,
  describeAutopilotContacts,
  describeContactPickerEmpty,
  isContactShown,
  isEscalationUnseen,
  listAutopilotWaitItems,
  listContactOptions,
  listSlackWorkspaceItems,
  resolveAutopilotValue,
  resolveContactAddBlock,
  resolveContactWorkspace,
  resolveSlackUnavailable,
  toggleAutopilotContact,
} from '@/lib/autopilot.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { useSlack, useSlackDirectory } from '@/lib/connection/slack.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { DescribedRow, SettingRow, SettingsGroup } from './group.tsx';

function ContactPicker({
  teamId,
  contacts,
  onToggle,
}: {
  teamId: string;
  contacts: readonly AutopilotContact[];
  onToggle: (contact: AutopilotContact) => void;
}) {
  const directory = useSlackDirectory(teamId);
  return (
    <Command>
      <CommandInput placeholder='Search channels and people' aria-label='Search channels and people' />
      <CommandList>
        <CommandEmpty>{describeContactPickerEmpty(directory)}</CommandEmpty>
        {listContactOptions(directory, contacts).map((group) => (
          <CommandGroup key={group.kind} heading={group.heading}>
            {group.options.map(({ contact, chosen, disabled }) => (
              <CommandItem
                key={contact.id}
                value={`${contact.name} ${contact.id}`}
                icon={group.kind === 'slack_channel' ? 'IconHashtag' : 'IconUser'}
                disabled={disabled}
                onSelect={() => onToggle(contact)}
              >
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

function ContactRows({
  contacts,
  onContactsChange,
}: {
  contacts: readonly AutopilotContact[];
  onContactsChange: (contacts: AutopilotContact[]) => void;
}) {
  const available = useEngineFeature('autopilot-slack');
  const slack = useSlack();
  const { snapshot } = slack;
  const [chosenWorkspace, setChosenWorkspace] = React.useState<string | null>(null);
  const teamId = resolveContactWorkspace(snapshot, chosenWorkspace);
  const unavailable = resolveSlackUnavailable(available, slack);
  const blocked = resolveContactAddBlock(contacts, unavailable);
  const workspaces = listSlackWorkspaceItems(snapshot);
  const toggle = (contact: AutopilotContact) => onContactsChange(toggleAutopilotContact(contacts, contact));
  const add = (
    <Popover>
      <PopoverTrigger
        render={<Button variant='secondary' size='sm' icon='IconPlusSmall' disabled={blocked !== null} />}
      >
        Add from Slack
      </PopoverTrigger>
      {teamId && (
        <PopoverContent align='end' className='w-80 overflow-hidden p-0'>
          <ContactPicker teamId={teamId} contacts={contacts} onToggle={toggle} />
        </PopoverContent>
      )}
    </Popover>
  );
  return (
    <>
      <DescribedRow
        title={AUTOPILOT_ROWS.contacts.title}
        description={describeAutopilotContacts(contacts, unavailable)}
      >
        {blocked ? (
          <Hint label={blocked}>
            <span>{add}</span>
          </Hint>
        ) : (
          add
        )}
      </DescribedRow>
      {!unavailable && workspaces.length > 1 && (
        <DescribedRow
          title={AUTOPILOT_ROWS.workspace.title}
          description={AUTOPILOT_ROWS.workspace.description}
        >
          <SelectField
            label={AUTOPILOT_ROWS.workspace.title}
            items={workspaces}
            value={teamId ?? ''}
            onValueChange={setChosenWorkspace}
          />
        </DescribedRow>
      )}
      {contacts.map((contact) => {
        const shown = describeAutopilotContact(contact, snapshot);
        return (
          <DescribedRow
            key={`${contact.teamId}:${contact.kind}:${contact.id}`}
            title={
              <>
                <Icon size='sm' name={shown.icon} className='text-fg-2' />
                <Truncate className='min-w-0'>{shown.title}</Truncate>
              </>
            }
            description={shown.description}
          >
            <HintButton
              size='icon-sm'
              icon='IconCrossSmall'
              label={`Stop telling ${shown.title}`}
              onClick={() => toggle(contact)}
            />
          </DescribedRow>
        );
      })}
    </>
  );
}

export function AutopilotSettings({ settings }: { settings: Settings }) {
  const available = useEngineFeature('autopilot');
  const projects = useShinsaSelector((state) => state.projects);
  const { policy, enabled } = resolveAutopilotValue(settings);
  if (!available) return null;
  const unseen = isEscalationUnseen(policy, Object.values(projects ?? {}));
  const updateAutopilot = (patch: Partial<AutopilotPolicy>) => {
    void updateSettings({ autopilot: { ...policy, ...patch } });
  };
  return (
    <SettingsGroup title={AUTOPILOT_TITLE} description={AUTOPILOT_DESCRIPTION}>
      <SettingRow title='Autopilot'>
        <SelectField
          label='Autopilot'
          items={AUTOPILOT_ENABLED_ITEMS}
          value={enabled}
          onValueChange={(value) => updateAutopilot({ enabled: value === 'on' })}
        />
      </SettingRow>
      {policy.enabled && (
        <>
          <DescribedRow title={AUTOPILOT_ROWS.approve.title} description={AUTOPILOT_ROWS.approve.description}>
            <SelectField
              label={AUTOPILOT_ROWS.approve.title}
              items={AUTOPILOT_RISK_ITEMS}
              value={policy.approveUpTo}
              onValueChange={(approveUpTo) => updateAutopilot({ approveUpTo })}
            />
          </DescribedRow>
          <DescribedRow
            title={AUTOPILOT_ROWS.urgentApprove.title}
            description={AUTOPILOT_ROWS.urgentApprove.description}
          >
            <SelectField
              label={AUTOPILOT_ROWS.urgentApprove.title}
              items={AUTOPILOT_RISK_ITEMS}
              value={policy.urgentApproveUpTo}
              onValueChange={(urgentApproveUpTo) => updateAutopilot({ urgentApproveUpTo })}
            />
          </DescribedRow>
          <DescribedRow title={AUTOPILOT_ROWS.merge.title} description={AUTOPILOT_ROWS.merge.description}>
            <SelectField
              label={AUTOPILOT_ROWS.merge.title}
              items={AUTOPILOT_MERGE_ITEMS}
              value={policy.merge}
              onValueChange={(merge) => updateAutopilot({ merge })}
            />
          </DescribedRow>
          <DescribedRow
            title={AUTOPILOT_ROWS.urgent.title}
            description={unseen ? AUTOPILOT_NO_TEAM : AUTOPILOT_ROWS.urgent.description}
          >
            <SelectField
              label={AUTOPILOT_ROWS.urgent.title}
              items={AUTOPILOT_URGENT_ITEMS}
              value={policy.urgent}
              onValueChange={(urgent) => updateAutopilot({ urgent })}
            />
          </DescribedRow>
          {isContactShown(policy) && (
            <ContactRows
              contacts={policy.contacts}
              onContactsChange={(contacts) => updateAutopilot({ contacts })}
            />
          )}
          {policy.urgent !== 'wait' && (
            <DescribedRow title={AUTOPILOT_ROWS.wait.title} description={AUTOPILOT_ROWS.wait.description}>
              <SelectField
                label={AUTOPILOT_ROWS.wait.title}
                items={listAutopilotWaitItems(policy)}
                value={String(policy.urgentWaitMinutes)}
                onValueChange={(value) => updateAutopilot({ urgentWaitMinutes: Number(value) })}
              />
            </DescribedRow>
          )}
          <DescribedRow title={AUTOPILOT_ROWS.usage.title} description={AUTOPILOT_ROWS.usage.description}>
            <SelectField
              label={AUTOPILOT_ROWS.usage.title}
              items={AUTOPILOT_USAGE_ITEMS}
              value={policy.ignoreUsageLimits ? 'on' : 'off'}
              onValueChange={(value) => updateAutopilot({ ignoreUsageLimits: value === 'on' })}
            />
          </DescribedRow>
        </>
      )}
    </SettingsGroup>
  );
}
