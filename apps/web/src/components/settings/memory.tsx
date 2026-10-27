import type { MemoryEntry, ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Field, FieldError } from '@shinsa/ui/components/field';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import {
  describeProposal,
  describeRuleCount,
  describeRuleSubmit,
  EVERY_PROJECT_LABEL,
  listMemoryGroups,
  listScopeItems,
  MEMORY_ACTIONS,
  type MemoryActions,
  type MemoryScopeGroup,
  parseScopeValue,
  resolveScopeValue,
  validateRule,
} from '@/lib/memory.ts';
import { SETTING_ROW, SettingsBlock, SettingsEmpty, SettingsGroup, TOKEN_TEXT } from './group.tsx';

interface Draft {
  memoryId: string | null;
  projectId: string | null;
  text: string;
  proposed: boolean;
}

function RuleForm({
  state,
  draft,
  actions,
  onDone,
}: {
  state: ShinsaState;
  draft: Draft;
  actions: MemoryActions;
  onDone: () => void;
}) {
  const [text, setText] = React.useState(draft.text);
  const [scope, setScope] = React.useState(resolveScopeValue(draft.projectId));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    const problem = validateRule(text);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    const saved = await actions.write(draft.memoryId, parseScopeValue(scope), text);
    setBusy(false);
    if (saved) onDone();
  }

  return (
    <form
      className={cn(SETTING_ROW, 'items-start gap-1.5')}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field data-invalid={error ? true : undefined} className='min-w-0 flex-1'>
        <Input
          size='sm'
          autoFocus
          value={text}
          placeholder='One short rule, such as “Keep plans to three phases or fewer.”'
          aria-label='The rule'
          aria-invalid={error ? true : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onDone();
          }}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <SelectField
        label='For'
        size='sm'
        items={listScopeItems(state)}
        value={scope}
        onValueChange={setScope}
      />
      <Button type='submit' variant='secondary' size='sm' disabled={!text.trim()} loading={busy}>
        {describeRuleSubmit(draft.memoryId, draft.proposed)}
      </Button>
      <Button type='button' variant='secondary' size='sm' onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

function IconAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: 'IconPencil' | 'IconCrossSmall';
  onClick: () => void;
}) {
  return (
    <Hint label={label}>
      <Button variant='secondary' size='icon-sm' icon={icon} aria-label={label} onClick={onClick} />
    </Hint>
  );
}

function RuleRow({
  entry,
  detail,
  actions,
  onEdit,
}: {
  entry: MemoryEntry;
  detail?: string | null;
  actions: MemoryActions;
  onEdit: () => void;
}) {
  const { busy, run } = useBusy<'keep' | 'remove'>();
  const proposed = entry.status === 'proposed';
  return (
    <div className={cn(SETTING_ROW, 'gap-2')}>
      <div className='flex min-w-0 flex-1 flex-col gap-px py-1 text-xs'>
        <span className='selectable text-fg-4'>{entry.text}</span>
        {detail && <span className='text-fg-2'>{detail}</span>}
      </div>
      <div className='flex shrink-0 items-center gap-1'>
        {proposed && (
          <Button
            variant='secondary'
            size='sm'
            loading={busy === 'keep'}
            onClick={() => void run('keep', () => actions.keep(entry))}
          >
            Keep
          </Button>
        )}
        <IconAction label={proposed ? 'Edit, then keep' : 'Edit'} icon='IconPencil' onClick={onEdit} />
        <IconAction
          label={proposed ? 'Dismiss' : 'Remove'}
          icon='IconCrossSmall'
          onClick={() => void run('remove', () => actions.remove(entry))}
        />
      </div>
    </div>
  );
}

function ScopeHeader({ group }: { group: MemoryScopeGroup }) {
  return (
    <>
      {group.project ? (
        <ProjectDotIcon color={group.project.color} />
      ) : (
        <Icon size='sm' name='IconGlobe' className='text-fg-2' />
      )}
      <Truncate className='min-w-0 flex-1 font-medium text-fg-4 text-xs'>
        {group.project?.name ?? EVERY_PROJECT_LABEL}
      </Truncate>
      <span className={TOKEN_TEXT}>{describeRuleCount(group.entries.length)}</span>
    </>
  );
}

function Rows({
  state,
  entries,
  editing,
  actions,
  describe,
  onEdit,
}: {
  state: ShinsaState;
  entries: MemoryEntry[];
  editing: string | null;
  actions: MemoryActions;
  describe: (entry: MemoryEntry) => string | null;
  onEdit: (draft: Draft | null) => void;
}) {
  return entries.map((entry) =>
    editing === entry.id ? (
      <RuleForm
        key={entry.id}
        state={state}
        draft={{ ...entry, memoryId: entry.id, proposed: entry.status === 'proposed' }}
        actions={actions}
        onDone={() => onEdit(null)}
      />
    ) : (
      <RuleRow
        key={entry.id}
        entry={entry}
        detail={describe(entry)}
        actions={actions}
        onEdit={() =>
          onEdit({
            memoryId: entry.id,
            projectId: entry.projectId,
            text: entry.text,
            proposed: entry.status === 'proposed',
          })
        }
      />
    )
  );
}

export function MemorySettings({
  state,
  actions = MEMORY_ACTIONS,
}: {
  state: ShinsaState;
  actions?: MemoryActions;
}) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const groups = listMemoryGroups(state);
  const editing = draft?.memoryId ?? null;
  const empty = groups.proposals.length === 0 && groups.scopes.every((scope) => scope.entries.length === 0);
  return (
    <SettingsGroup
      title='Memory'
      className='gap-1.5'
      action={
        <Button
          variant='secondary'
          size='sm'
          icon='IconPlusMedium'
          onClick={() => setDraft({ memoryId: null, projectId: null, text: '', proposed: false })}
        >
          New rule
        </Button>
      }
    >
      {draft && draft.memoryId === null && (
        <RuleForm state={state} draft={draft} actions={actions} onDone={() => setDraft(null)} />
      )}
      {empty && !draft && (
        <SettingsEmpty>
          Rules every agent follows, such as how you want plans or messages written. Agents propose them when
          you correct them; you decide which they keep.
        </SettingsEmpty>
      )}
      {groups.proposals.length > 0 && (
        <SettingsBlock
          header={
            <>
              <Icon size='sm' name='IconLightbulbGlow' className='text-fg-2' />
              <span className='font-medium text-fg-4 text-xs'>Proposed by agents</span>
            </>
          }
        >
          <Rows
            state={state}
            entries={groups.proposals}
            editing={editing}
            actions={actions}
            describe={(entry) => describeProposal(state, entry)}
            onEdit={setDraft}
          />
        </SettingsBlock>
      )}
      {!empty &&
        groups.scopes.map((group) => (
          <SettingsBlock key={group.project?.id ?? 'every'} header={<ScopeHeader group={group} />}>
            {group.entries.length === 0 ? (
              <SettingsEmpty>No rules for every project yet.</SettingsEmpty>
            ) : (
              <Rows
                state={state}
                entries={group.entries}
                editing={editing}
                actions={actions}
                describe={() => null}
                onEdit={setDraft}
              />
            )}
          </SettingsBlock>
        ))}
    </SettingsGroup>
  );
}
