import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import * as React from 'react';
import { useTaskOwnership } from '@/hooks/use-task-ownership.ts';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestGitHubTokenWrite, useGitHubToken } from '@/lib/connection/github-token.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { describeGitHubToken, GITHUB_TOKEN_LABEL, isGitHubTokenShown } from '@/lib/shared-machine.ts';
import { SETTING_ROW, SettingsBlock } from './group.tsx';

export function GitHubTokenBlock() {
  const { sharedHere: shared } = useTaskOwnership();
  const supported = useEngineFeature('shared-machine');
  const [answer, setAnswer] = useGitHubToken(shared && supported);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  if (!answer || !isGitHubTokenShown(answer, shared)) return null;
  const write = (token: string | null, done: string) => {
    setSaving(true);
    void requestWithToast(async () => {
      setAnswer(await requestGitHubTokenWrite(token));
      setDraft('');
    }, done).finally(() => setSaving(false));
  };
  return (
    <SettingsBlock
      header={
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='text-xs font-medium text-fg-4'>{GITHUB_TOKEN_LABEL.title}</span>
          <span className='text-2xs text-fg-2'>{describeGitHubToken(answer)}</span>
        </div>
      }
    >
      <form
        className={SETTING_ROW}
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) write(draft, GITHUB_TOKEN_LABEL.savedToast);
        }}
      >
        <Input
          type='password'
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={GITHUB_TOKEN_LABEL.placeholder}
          aria-label={GITHUB_TOKEN_LABEL.title}
          className='min-w-0 flex-1'
        />
        <Button type='submit' variant='secondary' size='sm' loading={saving} disabled={!draft.trim()}>
          {GITHUB_TOKEN_LABEL.save}
        </Button>
        {answer.saved && (
          <Button
            type='button'
            variant='secondary'
            size='sm'
            disabled={saving}
            onClick={() => write(null, GITHUB_TOKEN_LABEL.removedToast)}
          >
            {GITHUB_TOKEN_LABEL.remove}
          </Button>
        )}
      </form>
    </SettingsBlock>
  );
}
