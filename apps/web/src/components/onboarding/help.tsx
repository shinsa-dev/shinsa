import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { InstallEnd, InstallTerminal } from '@/components/onboarding/checks.tsx';
import { NowCard } from '@/components/overview/now-card.tsx';
import { SETTING_ROW, SettingsCard } from '@/components/settings/group.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { CommandRunnerProvider } from '@/components/text/code-block.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestOnboardingInstall } from '@/lib/connection/onboarding.ts';
import { useShinsaState, useTask } from '@/lib/connection/selectors.ts';
import { describeInstallEnd, resolveHelpView } from '@/lib/onboarding.ts';

function HelpAsk({
  text,
  label,
  asking,
  disabled,
  onAsk,
}: {
  text: string;
  label: string;
  asking: boolean;
  disabled: boolean;
  onAsk: () => void;
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <p className='text-fg-2 text-xs'>{text}</p>
      <Button
        variant='secondary'
        icon='IconBubbleQuestion'
        loading={asking}
        disabled={disabled}
        onClick={onAsk}
      >
        {label}
      </Button>
    </div>
  );
}

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
  const state = useShinsaState();
  const task = useTask(help);
  const view = resolveHelpView(state, task);
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
  const ask = { asking, disabled, onAsk };
  if (!help) {
    return (
      <HelpAsk
        {...ask}
        text='Stuck on an install? An agent reads the failing checks and replies with the commands to run.'
        label='Ask an agent for help'
      />
    );
  }
  if (view.kind === 'stopped') {
    return <HelpAsk {...ask} text='The agent stopped without a reply.' label='Ask again' />;
  }
  if (view.kind === 'gate' && state && task) {
    return <NowCard state={state} task={task} gate={view.gate} onOpen={() => undefined} />;
  }
  return (
    <SettingsCard>
      {view.kind === 'result' ? (
        <div className='px-2 py-1.5'>
          <CommandRunnerProvider runner={runner}>
            <Markdown text={view.body} className='text-fg-4' />
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
