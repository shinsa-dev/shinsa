import { Button } from '@shinsa/ui/components/button';
import { Field, FieldError } from '@shinsa/ui/components/field';
import { Textarea } from '@shinsa/ui/components/textarea';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import type { MachineChoice } from '@/lib/connection/socket.ts';
import { isCancelKey, isSubmitKey } from '@/lib/keys.ts';
import { resolveMachineLabel } from '@/lib/remote/mode.ts';
import {
  describePolicyCount,
  describePolicyLength,
  describePolicySubmit,
  listPolicyGroups,
  listPolicyMachineItems,
  POLICIES_SECTION,
  POLICY_ACTIONS,
  POLICY_PLACEHOLDER,
  type PolicyActions,
  type PolicyRef,
  resolvePolicyRemoval,
  resolvePolicyWrites,
  type UnreachableMachine,
  validatePolicy,
} from '@/lib/remote/policies.ts';
import { ROW_INSET, SETTING_ROW, SettingsBlock, SettingsEmpty, SettingsGroup, TOKEN_TEXT } from './group.tsx';

interface Draft {
  editing: PolicyRef | null;
  machineId: string;
  text: string;
}

function PolicyForm({
  machines,
  unreachable,
  draft,
  actions,
  onDone,
}: {
  machines: MachineChoice[];
  unreachable: UnreachableMachine[];
  draft: Draft;
  actions: PolicyActions;
  onDone: () => void;
}) {
  const [text, setText] = React.useState(draft.text);
  const [machineId, setMachineId] = React.useState(draft.machineId);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    const problem = validatePolicy(machines, draft.editing, machineId, text);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    const saved = await actions.write(
      resolvePolicyWrites(machines, draft.editing, machineId, text),
      draft.editing ? 'Routing policy saved.' : 'Routing policy added.'
    );
    setBusy(false);
    if (saved) onDone();
  }

  return (
    <form
      className={cn(ROW_INSET, 'flex flex-col gap-1.5 py-2')}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field data-invalid={error ? true : undefined}>
        <Textarea
          autoFocus
          rows={1}
          value={text}
          placeholder={POLICY_PLACEHOLDER}
          aria-label='The routing policy'
          aria-invalid={error ? true : undefined}
          className='min-h-0 resize-none'
          onKeyDown={(event) => {
            if (isCancelKey(event)) onDone();
            if (isSubmitKey(event)) {
              event.preventDefault();
              void save();
            }
          }}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <div className='flex items-center gap-1.5'>
        <SelectField
          label='Runs on'
          size='sm'
          align='start'
          items={listPolicyMachineItems(machines, unreachable)}
          value={machineId}
          onValueChange={(next) => {
            setMachineId(next);
            setError(null);
          }}
        />
        <span className={cn(TOKEN_TEXT, 'ml-auto')}>{describePolicyLength(text)}</span>
        <Button type='button' variant='secondary' size='sm' onClick={onDone}>
          Cancel
        </Button>
        <Button type='submit' size='sm' disabled={!text.trim()} loading={busy}>
          {describePolicySubmit(draft.editing)}
        </Button>
      </div>
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

function PolicyRow({
  text,
  onEdit,
  onRemove,
}: {
  text: string;
  onEdit: () => void;
  onRemove: () => Promise<boolean>;
}) {
  const { run } = useBusy<'remove'>();
  return (
    <div className={cn(SETTING_ROW, 'gap-2')}>
      <span className='selectable min-w-0 flex-1 py-1 text-fg-4 text-xs'>{text}</span>
      <div className='flex shrink-0 items-center gap-1'>
        <IconAction label='Edit' icon='IconPencil' onClick={onEdit} />
        <IconAction label='Remove' icon='IconCrossSmall' onClick={() => void run('remove', onRemove)} />
      </div>
    </div>
  );
}

export function PolicySettings({
  machines,
  unreachable = [],
  actions = POLICY_ACTIONS,
}: {
  machines: MachineChoice[];
  unreachable?: UnreachableMachine[];
  actions?: PolicyActions;
}) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [first] = machines;
  if (!first) return null;
  const groups = listPolicyGroups(machines);
  const empty = groups.every((group) => group.policies.length === 0);
  const editing = draft?.editing;
  return (
    <SettingsGroup
      title={POLICIES_SECTION}
      className='gap-1.5'
      action={
        <Button
          variant='secondary'
          size='sm'
          icon='IconPlusMedium'
          onClick={() => setDraft({ editing: null, machineId: first.id, text: '' })}
        >
          New routing policy
        </Button>
      }
    >
      {draft && !draft.editing && (
        <PolicyForm
          machines={machines}
          unreachable={unreachable}
          draft={draft}
          actions={actions}
          onDone={() => setDraft(null)}
        />
      )}
      {empty && !draft && (
        <SettingsEmpty>
          Say in plain words which work runs on which machine, such as “Run Xcode simulator tests here.” When
          you start a task with Automatic, Shinsa reads every policy with the request and picks the machine.
        </SettingsEmpty>
      )}
      {!empty &&
        groups.map(({ machine, policies }) => (
          <SettingsBlock
            key={machine.id}
            header={
              <>
                <Truncate className='min-w-0 flex-1 font-medium text-fg-4 text-xs'>
                  {resolveMachineLabel(machine)}
                </Truncate>
                <span className={TOKEN_TEXT}>{describePolicyCount(policies.length)}</span>
              </>
            }
          >
            {policies.length === 0 ? (
              <SettingsEmpty>No routing policies for this machine yet.</SettingsEmpty>
            ) : (
              policies.map((text, index) => {
                const ref = { machineId: machine.id, index };
                return editing?.machineId === machine.id && editing.index === index ? (
                  <PolicyForm
                    key={text}
                    machines={machines}
                    unreachable={unreachable}
                    draft={{ editing: ref, machineId: machine.id, text }}
                    actions={actions}
                    onDone={() => setDraft(null)}
                  />
                ) : (
                  <PolicyRow
                    key={text}
                    text={text}
                    onEdit={() => setDraft({ editing: ref, machineId: machine.id, text })}
                    onRemove={() =>
                      actions.write([resolvePolicyRemoval(machines, ref)], 'Routing policy removed.')
                    }
                  />
                );
              })
            )}
          </SettingsBlock>
        ))}
    </SettingsGroup>
  );
}
