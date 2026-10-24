import type { ProviderLogin } from '@shinsa/core';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@shinsa/ui/components/dropdown-menu';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  describeProviderLogin,
  describeProviderRefresh,
  resolveProviderHeader,
  selectSignInCommand,
} from '@/lib/accounts/providers.ts';
import { copyText } from '@/lib/connection/commands.ts';
import { SETTING_ROW } from './group.tsx';
import { UsageWindows } from './usage.tsx';
import { UsageAccountBlock } from './usage-account.tsx';

function ProviderMenu({ login, onRefresh }: { login: ProviderLogin; onRefresh: () => Promise<unknown> }) {
  const command = selectSignInCommand(login);
  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProviderLoginBlock({
  login,
  onRefresh,
}: {
  login: ProviderLogin;
  onRefresh: () => Promise<unknown>;
}) {
  const view = describeProviderLogin(login);
  return (
    <UsageAccountBlock
      header={resolveProviderHeader(login, Date.now())}
      menu={<ProviderMenu login={login} onRefresh={onRefresh} />}
    >
      {login.usage && login.status === 'signed_in' && <UsageWindows account={{ usage: login.usage }} />}
      {view.fix && (
        <div className={SETTING_ROW}>
          <span className='min-w-0 flex-1 text-fg-2 text-xs'>
            <InlineMarkdown text={view.fix} />
          </span>
          {view.command && <CopyButton text={view.command} />}
        </div>
      )}
    </UsageAccountBlock>
  );
}
