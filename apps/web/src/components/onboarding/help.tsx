import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { InstallEnd, InstallTerminal } from '@/components/onboarding/checks.tsx';
import { SETTING_ROW, SettingsCard } from '@/components/settings/group.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { CommandRunnerProvider } from '@/components/text/code-block.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestOnboardingInstall } from '@/lib/connection/onboarding.ts';
import { useTask } from '@/lib/connection/selectors.ts';
import { describeInstallEnd } from '@/lib/onboarding.ts';

export function OnboardingHelp({
  help,
  userHome,
  asking,
  disabled,
  onAsk,
  onRecheck,
}: {
  help: string | null;
  userHome: string;
  asking: boolean;
  disabled: boolean;
  onAsk: () => void;
  onRecheck: () => void;
}) {
  const task = useTask(help);
  const [terminalId, setTerminalId] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const runner = React.useMemo(
    () => ({
      folder: userHome,
      run: (command: string) => {
        setFailure(null);
        return requestWithToast(async () => setTerminalId((await requestOnboardingInstall({ command })).id));
      },
    }),
    [userHome]
  );
  if (!help) {
    return (
      <div className='flex items-center justify-between gap-3'>
        <p className='text-fg-2 text-xs'>
          Stuck on an install? An agent reads the failing checks and replies with the commands to run.
        </p>
        <Button
          variant='secondary'
          icon='IconBubbleQuestion'
          loading={asking}
          disabled={disabled}
          onClick={onAsk}
        >
          Ask an agent for help
        </Button>
      </div>
    );
  }
  return (
    <SettingsCard>
      {task?.result ? (
        <div className='px-2 py-1.5'>
          <CommandRunnerProvider runner={runner}>
            <Markdown text={task.result.body} className='text-fg-4' />
          </CommandRunnerProvider>
        </div>
      ) : (
        <div className={SETTING_ROW}>
          <LoadingLine label='An agent is looking into the failing checks' className='text-xs' />
        </div>
      )}
      {terminalId && (
        <InstallTerminal
          key={terminalId}
          terminalId={terminalId}
          onEnd={(terminal) => {
            setTerminalId(null);
            setFailure(describeInstallEnd(terminal));
            onRecheck();
          }}
        />
      )}
      {failure && <InstallEnd text={failure} />}
    </SettingsCard>
  );
}
