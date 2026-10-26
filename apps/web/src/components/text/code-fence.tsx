import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { resolveFenceLanguage, type Token, useLanguageTokens } from '@/lib/code/highlight.ts';
import { resolveFenceCommand } from '@/lib/terminal/command.ts';

type CommandRunner = (command: string) => unknown;

const CommandRunnerContext = React.createContext<CommandRunner | null>(null);

export function CommandRunnerProvider({ run, children }: { run: CommandRunner; children: React.ReactNode }) {
  return <CommandRunnerContext value={run}>{children}</CommandRunnerContext>;
}

function RunButton({ command }: { command: string }) {
  const run = React.useContext(CommandRunnerContext);
  if (!run) return null;
  return (
    <Hint
      label='Run in a terminal'
      detail='Opens a terminal in this task’s folder and runs the command there'
    >
      <Button variant='secondary' size='xs' icon='IconConsole' onClick={() => run(command)}>
        Run in terminal
      </Button>
    </Hint>
  );
}

export function TokenText({ text, tokens }: { text: string; tokens: Token[] | undefined }) {
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no identity beyond their position
          key={index}
          style={token.style}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}

export function CodeFence({ code, language }: { code: string; language: string | null }) {
  const tokens = useLanguageTokens(code, resolveFenceLanguage(language));
  const command = resolveFenceCommand(code, language);
  return (
    <div className='group/code corner-superellipse/1.125 relative my-3 min-w-0 rounded-lg bg-bg-2 first:mt-0 last:mb-0'>
      <pre className='overflow-x-auto px-3.5 py-2.5 font-mono text-2xs text-fg-4 leading-relaxed'>
        <code className='block'>
          {code.split('\n').map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <span key={index} className='block min-h-[1lh] whitespace-pre'>
              <TokenText text={line} tokens={tokens?.[index]} />
            </span>
          ))}
        </code>
      </pre>
      <span className='absolute top-1.5 right-1.5 flex items-center gap-1'>
        <CopyButton text={code} className='opacity-0 group-hover/code:opacity-100' />
        {command && <RunButton command={command} />}
      </span>
    </div>
  );
}
