import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Textarea } from '@shinsa/ui/components/textarea';
import * as React from 'react';
import { useShinsaState } from '@/lib/connection/selectors.ts';
import { closeForkDialog, FORK_DESCRIPTION, FORK_TITLE, useForkDialog } from '@/lib/tasks/fork.ts';
import { forkTask } from '@/lib/tasks/watchdogs.ts';

export function ForkDialog() {
  const taskId = useForkDialog();
  const state = useShinsaState();
  const task = taskId && state ? state.tasks[taskId] : undefined;
  const [request, setRequest] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const submit = async () => {
    if (!state || !task || !request.trim()) return;
    setBusy(true);
    const sent = await forkTask(state, task, request.trim());
    setBusy(false);
    if (!sent) return;
    setRequest('');
    closeForkDialog();
  };
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(next) => {
        if (!next) closeForkDialog();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{FORK_TITLE}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{FORK_DESCRIPTION}</DialogDescription>
        <form
          id={formId}
          className='w-full'
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Textarea
            value={request}
            rows={4}
            aria-label='What the new task should do'
            placeholder='What the new task should do, such as “Fix the paywall in Safari”.'
            onChange={(event) => setRequest(event.target.value)}
          />
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} disabled={!request.trim()} loading={busy}>
            Fork
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
