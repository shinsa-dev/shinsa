import type { ProviderLogin } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { RefreshButton } from '@/components/accounts/refresh-button.tsx';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { describeProviderLogin, describeProviderRefresh } from '@/lib/accounts/providers.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { SETTING_ROW, SettingsBlock, TOKEN_TEXT } from './group.tsx';
import { UsageWindows } from './usage.tsx';

export function ProviderLoginBlock({
  login,
  onRefresh,
}: {
  login: ProviderLogin;
  onRefresh: () => Promise<unknown>;
}) {
  const view = describeProviderLogin(login);
  return (
    <SettingsBlock
      header={
        <>
          <div className='flex min-w-0 flex-1 items-center gap-1.5 text-xs'>
            <span className='shrink-0 font-medium text-fg-4'>{login.label}</span>
            <span className='min-w-0 truncate text-fg-2'>{view.title}</span>
            {view.status && (
              <span className={cn('ms-0.5 shrink-0', TONE_TEXT[view.status.tone])}>{view.status.label}</span>
            )}
          </div>
          {login.version && <span className={TOKEN_TEXT}>{login.version}</span>}
          <RefreshButton label={describeProviderRefresh(login)} onRefresh={onRefresh} />
        </>
      }
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
    </SettingsBlock>
  );
}
