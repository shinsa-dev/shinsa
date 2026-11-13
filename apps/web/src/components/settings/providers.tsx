import type { ProviderLogin } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  describeProviderLogin,
  describeProviderRefresh,
  describeProviderRemoval,
  resolveProviderHeader,
  selectSignInCommand,
} from '@/lib/accounts/providers.ts';
import { copyText } from '@/lib/connection/commands.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { SETTING_ROW } from './group.tsx';
import { UsageAccountBlock } from './usage-account.tsx';
import { UsageWindows } from './usage.tsx';

interface ProviderActions {
  onRefresh: () => Promise<unknown>;
  onRemove: (provider: string, done: string) => void;
}

function ProviderMenu({ login, onRefresh, onRemove }: { login: ProviderLogin } & ProviderActions) {
  const command = selectSignInCommand(login);
  const removable = useEngineFeature('accounts.provider_choice');
  const dialog = useDialogState<'remove'>();
  const removal = describeProviderRemoval(login);
  return (
    <>
      <DropdownMenu>
        <OptionsTrigger label={ACCOUNT_LABEL.options} />
        <DropdownMenuContent align='end' className='min-w-52'>
          {command && (
            <DropdownMenuItem icon='IconUserKey' onClick={() => void copyText(command)}>
              {ACCOUNT_LABEL.copySignIn}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem icon='IconArrowRotateClockwise' onClick={() => void onRefresh()}>
            {describeProviderRefresh(login)}
          </DropdownMenuItem>
          {removable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon='IconTrashCan'
                variant='destructive'
                onClick={() => dialog.show('remove')}
              >
                {removal.menu}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog.value === 'remove' && (
        <ConfirmDialog
          control={dialog.control}
          title={removal.title}
          body={removal.body}
          action={removal.action}
          onConfirm={() => onRemove(login.provider, removal.done)}
        />
      )}
    </>
  );
}

export function ProviderLoginBlock({
  login,
  onRefresh,
  onRemove,
}: { login: ProviderLogin } & ProviderActions) {
  const view = describeProviderLogin(login);
  return (
    <UsageAccountBlock
      header={resolveProviderHeader(login, Date.now())}
      menu={<ProviderMenu login={login} onRefresh={onRefresh} onRemove={onRemove} />}
    >
      {login.usage && login.status === 'signed_in' && <UsageWindows account={{ usage: login.usage }} />}
      {view.fix && (
        <div className={SETTING_ROW}>
          <span className='min-w-0 flex-1 text-xs text-fg-2'>
            <InlineMarkdown text={view.fix} />
          </span>
          {view.command && <CopyButton text={view.command} />}
        </div>
      )}
    </UsageAccountBlock>
  );
}
