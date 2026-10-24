import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import * as React from 'react';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { describeSecretAsk, describeSecretPlaceholder } from '@/lib/overview/secret.ts';
import { declineSecret, resolveSecretLabel, SECRET_NOTE, saveSecret } from '@/lib/secrets.ts';

export function SecretCard({
  state,
  task,
  gate,
  onSave = (value) => saveSecret(gate.id, value),
  onDecline = () => declineSecret(gate.id),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onSave?: (value: string) => Promise<boolean>;
  onDecline?: () => Promise<boolean>;
}) {
  const [value, setValue] = React.useState('');
  const { busy, run } = useBusy<'save' | 'decline'>();
  const label = resolveSecretLabel(gate);

  async function save() {
    if (await run('save', () => onSave(value))) setValue('');
  }

  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={describeSecretAsk(label)} />}
      title={gate.title}
      footer={
        <FooterNote note={SECRET_NOTE}>
          <QuietLink busy={busy !== null} onClick={() => void run('decline', onDecline)}>
            Don’t give it
          </QuietLink>
        </FooterNote>
      }
    >
      <form
        className='flex items-center gap-1.5'
        onSubmit={(event) => {
          event.preventDefault();
          if (value) void save();
        }}
      >
        <Input
          size='sm'
          type='password'
          autoComplete='off'
          spellCheck={false}
          value={value}
          aria-label={label}
          placeholder={describeSecretPlaceholder(label)}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type='submit' size='sm' disabled={!value} loading={busy === 'save'}>
          Save
        </Button>
      </form>
    </NowFrame>
  );
}
