import { listOwnRepos } from '@shinsa/core';
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
import { SelectField } from '@/components/controls/select-field.tsx';
import { useShinsaState } from '@/lib/connection/selectors.ts';
import { useMachine } from '@/lib/connection/socket.ts';
import { resolveRepoIcon } from '@/lib/projects.ts';
import {
  closeForkDialog,
  describeTeammateFork,
  FORK_DESCRIPTION,
  FORK_TITLE,
  forkTask,
  forkTeammateTask,
  NO_FORK_REPO,
  resolveForkRepo,
  resolveOwnerName,
  useForkDialog,
} from '@/lib/tasks/fork.ts';

export function ForkDialog() {
  const taskId = useForkDialog();
  const state = useShinsaState();
  const task = taskId && state ? state.tasks[taskId] : undefined;
  const machine = useMachine(task?.id ?? null);
  const teammate = machine?.teammate ? { id: machine.id, teammate: machine.teammate } : null;
  const repos = React.useMemo(() => (teammate && state ? listOwnRepos(state) : []), [teammate, state]);
  const suggested = teammate && state && task ? resolveForkRepo(state, task) : null;
  const [picked, setPicked] = React.useState<string | null>(null);
  const repoId = picked ?? suggested;
  const [request, setRequest] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const blocked = teammate !== null && repoId === null;
  const send = (text: string) => {
    if (!state || !task) return Promise.resolve(false);
    if (!teammate) return forkTask(state, task, text);
    return repoId ? forkTeammateTask(state, task, text, repoId, teammate) : Promise.resolve(false);
  };
  const submit = async () => {
    if (!request.trim() || blocked) return;
    setBusy(true);
    const sent = await send(request.trim());
    setBusy(false);
    if (!sent) return;
    setRequest('');
    setPicked(null);
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
          <DialogDescription>
            {teammate ? describeTeammateFork(resolveOwnerName(teammate.teammate)) : FORK_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className='w-full'
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {repos.length > 1 && repoId && (
            <SelectField
              label='Repository'
              align='start'
              className='mb-3'
              items={repos.map((repo) => ({ value: repo.id, label: repo.name, icon: resolveRepoIcon(repo) }))}
              value={repoId}
              onValueChange={setPicked}
            />
          )}
          {blocked && <p className='mb-3 text-sm text-fg-2'>{NO_FORK_REPO}</p>}
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
          <Button type='submit' form={formId} disabled={!request.trim() || blocked} loading={busy}>
            Fork
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
