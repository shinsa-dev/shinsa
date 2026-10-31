import type { OnboardingCheck } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { SETTING_ROW, SettingsCard, TOKEN_TEXT } from '@/components/settings/group.tsx';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { TerminalPane, useTerminalView } from '@/components/terminal/terminal-pane.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { isMacPlatform } from '@/lib/code/keys.ts';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestOnboardingInstall } from '@/lib/connection/onboarding.ts';
import { useTerminals } from '@/lib/connection/terminals.ts';
import {
  countMissingInstalls,
  describeFixAction,
  describeInstallEnd,
  isInstallable,
  resolveCheckOutcome,
} from '@/lib/onboarding.ts';
import { useColorScheme } from '@/lib/preferences/theme.ts';
import { releaseTerminalView, resolveTerminalView } from '@/lib/terminal/view.ts';

interface Install {
  checkId: string;
  terminalId: string;
}

export function InstallTerminal({ terminalId, onEnd }: { terminalId: string; onEnd: () => void }) {
  const scheme = useColorScheme();
  const mac = React.useMemo(() => isMacPlatform(navigator.platform), []);
  const view = resolveTerminalView({ id: terminalId, scheme, mac });
  const { background } = useTerminalView(view);
  const terminal = useTerminals()?.terminals.find((each) => each.id === terminalId) ?? null;
  const ended = terminal !== null && terminal.status !== 'running';
  const end = React.useRef(onEnd);
  end.current = onEnd;
  React.useEffect(() => () => releaseTerminalView(terminalId), [terminalId]);
  React.useEffect(() => view.updateScheme(scheme), [view, scheme]);
  React.useEffect(() => {
    if (ended) end.current();
  }, [ended]);
  return (
    <div className='mx-2 mb-2 overflow-hidden rounded-item border border-border'>
      <div style={{ background: background ?? undefined }} className='relative h-56'>
        <div className='absolute inset-y-2 start-3 end-0'>
          <TerminalPane view={view} shown />
        </div>
      </div>
      {terminal && ended && (
        <p className='border-border border-t px-3 py-1.5 text-fg-2 text-xs'>{describeInstallEnd(terminal)}</p>
      )}
    </div>
  );
}

function CheckRow({
  check,
  installing,
  leading,
  onInstall,
}: {
  check: OnboardingCheck;
  installing: boolean;
  leading: boolean;
  onInstall: () => void;
}) {
  return (
    <div className={cn(SETTING_ROW, 'gap-2')}>
      <CheckOutcomeIcon outcome={resolveCheckOutcome(check)} className='size-3.5' />
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <span className='text-fg-4 text-xs'>{check.label}</span>
        {check.fix && (
          <span className='text-2xs text-fg-3'>
            <InlineMarkdown text={check.fix} />
          </span>
        )}
        {check.command && (
          <span className='mt-1 flex min-w-0 items-center gap-1.5'>
            <code className='selectable min-w-0 truncate font-mono text-2xs text-fg-4'>{check.command}</code>
            <CopyButton text={check.command} />
          </span>
        )}
      </span>
      {isInstallable(check) ? (
        <Button
          variant={leading ? 'primary' : 'secondary'}
          size='sm'
          icon='IconConsole'
          loading={installing}
          onClick={onInstall}
        >
          {describeFixAction(check)}
        </Button>
      ) : (
        <Truncate className={cn(TOKEN_TEXT, 'min-w-0 max-w-1/2 shrink text-end')}>{check.detail}</Truncate>
      )}
    </div>
  );
}

const ALL_CHECKS = 'all';

function InstallAllRow({
  count,
  installing,
  onInstall,
}: {
  count: number;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div className={cn(SETTING_ROW, 'gap-2')}>
      <span className='min-w-0 flex-1 text-fg-3 text-xs'>
        {count} tools are missing. Install them all in one terminal, each after the one it needs.
      </span>
      <Button variant='primary' size='sm' icon='IconConsole' loading={installing} onClick={onInstall}>
        Install all
      </Button>
    </div>
  );
}

export function OnboardingChecks({
  checks,
  onRecheck,
}: {
  checks: OnboardingCheck[];
  onRecheck: () => void;
}) {
  const [install, setInstall] = React.useState<Install | null>(null);
  const [starting, setStarting] = React.useState<string | null>(null);
  const missing = countMissingInstalls(checks);
  const start = async (checkId: string) => {
    setStarting(checkId);
    await requestWithToast(async () => {
      const terminal = await requestOnboardingInstall(
        checkId === ALL_CHECKS ? { all: true } : { id: checkId }
      );
      setInstall({ checkId, terminalId: terminal.id });
    });
    setStarting(null);
  };
  return (
    <SettingsCard>
      {(missing > 1 || install?.checkId === ALL_CHECKS) && (
        <div className='border-border border-b'>
          {missing > 1 && (
            <InstallAllRow
              count={missing}
              installing={starting === ALL_CHECKS}
              onInstall={() => void start(ALL_CHECKS)}
            />
          )}
          {install?.checkId === ALL_CHECKS && (
            <InstallTerminal key={install.terminalId} terminalId={install.terminalId} onEnd={onRecheck} />
          )}
        </div>
      )}
      <ul className='flex flex-col'>
        {checks.map((check) => (
          <li key={check.id}>
            <CheckRow
              check={check}
              installing={starting === check.id}
              leading={missing === 1 && isInstallable(check) && !check.optional}
              onInstall={() => void start(check.id)}
            />
            {install?.checkId === check.id && (
              <InstallTerminal key={install.terminalId} terminalId={install.terminalId} onEnd={onRecheck} />
            )}
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
