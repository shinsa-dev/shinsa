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
import { Input } from '@shinsa/ui/components/input';
import { Spinner } from '@shinsa/ui/components/spinner';
import { useHeldValue } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { describeSignedIn, LOGIN_TITLE, type LoginView, resolveLoginView } from '@/lib/accounts/sign-in.ts';
import {
  closeSignIn,
  retrySignIn,
  submitLoginCode,
  useAccounts,
  useSignInDialog,
} from '@/lib/connection/accounts.ts';

function CancelButton() {
  return <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>;
}

type CodeSubmitter = (loginId: string, code: string) => Promise<boolean>;

function CodeStep({
  view,
  onSubmitCode,
}: {
  view: Extract<LoginView, { phase: 'waiting' }>;
  onSubmitCode: CodeSubmitter;
}) {
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();

  async function submit() {
    if (!code.trim() || busy) return;
    setBusy(true);
    if (await onSubmitCode(view.loginId, code.trim())) setCode('');
    setBusy(false);
  }

  return (
    <>
      <DialogDescription>
        A browser window opened to sign in to Claude.
        {view.url && (
          <>
            {' '}
            If it did not,{' '}
            <a href={view.url} target='_blank' rel='noreferrer'>
              open the sign-in page
            </a>
            .
          </>
        )}{' '}
        If the page shows a code, paste it here.
      </DialogDescription>
      <form
        id={formId}
        className='w-full'
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          value={code}
          aria-label='Sign-in code'
          placeholder='Paste the code'
          onChange={(event) => setCode(event.target.value)}
        />
      </form>
      <DialogFooter>
        <CancelButton />
        <Button type='submit' form={formId} disabled={!code.trim()} loading={busy}>
          Submit code
        </Button>
      </DialogFooter>
    </>
  );
}

function LoginBody({
  view,
  onClose,
  onSubmitCode,
  onRetry,
}: {
  view: LoginView;
  onClose: () => void;
  onSubmitCode: CodeSubmitter;
  onRetry: () => void;
}) {
  switch (view.phase) {
    case 'starting':
    case 'finishing':
      return (
        <>
          <Spinner className='size-5 text-fg-2' />
          <DialogFooter>
            <CancelButton />
          </DialogFooter>
        </>
      );
    case 'waiting':
      return <CodeStep key={view.loginId} view={view} onSubmitCode={onSubmitCode} />;
    case 'done':
      return (
        <>
          <DialogDescription>{describeSignedIn(view.email)}</DialogDescription>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </>
      );
    case 'failed':
      return (
        <>
          <DialogDescription>{view.message}</DialogDescription>
          <DialogFooter>
            <CancelButton />
            <Button onClick={onRetry}>Try again</Button>
          </DialogFooter>
        </>
      );
  }
}

export function SignInPrompt({
  open,
  view,
  onClose,
  onSubmitCode,
  onRetry,
}: {
  open: boolean;
  view: LoginView;
  onClose: () => void;
  onSubmitCode: CodeSubmitter;
  onRetry: () => void;
}) {
  const shown = useHeldValue(view, open);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{LOGIN_TITLE[shown.phase]}</DialogTitle>
        </DialogHeader>
        <LoginBody view={shown} onClose={onClose} onSubmitCode={onSubmitCode} onRetry={onRetry} />
      </DialogContent>
    </Dialog>
  );
}

export function SignInDialog() {
  const dialog = useSignInDialog();
  const accounts = useAccounts();
  return (
    <SignInPrompt
      open={dialog.open}
      view={resolveLoginView(dialog, accounts)}
      onClose={closeSignIn}
      onSubmitCode={submitLoginCode}
      onRetry={() => void retrySignIn()}
    />
  );
}
