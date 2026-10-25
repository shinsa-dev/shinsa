import type { OnboardingMessage, OnboardingPrompt } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { ShimmeringText } from '@shinsa/ui/components/shimmering-text';
import { cn } from '@shinsa/ui/lib/utils';
import { ROW } from '@/components/chat/run-section.tsx';
import { AgentText, ErrorLine } from '@/components/chat/turn-detail.tsx';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { OnboardingChecks } from '@/components/onboarding/checks.tsx';
import { OnboardingChoices } from '@/components/onboarding/choices.tsx';
import { LoadingSpinner } from '@/components/status/loading-line.tsx';
import { Composer } from '@/components/task/composer.tsx';
import { useOnboardingChat } from '@/hooks/use-onboarding-chat.ts';
import { useStickToBottom } from '@/hooks/use-stick-to-bottom.ts';
import { describeOnboardingStep } from '@/lib/onboarding.ts';
import { navigate } from '@/router.ts';

function MessageRow({ message }: { message: OnboardingMessage }) {
  if (message.from === 'you') {
    return (
      <div className={ROW}>
        <UserMessage text={message.text} />
      </div>
    );
  }
  return (
    <div className={cn(ROW, 'flex flex-col gap-3')}>
      {message.problem ? <ErrorLine text={message.text} /> : <AgentText text={message.text} />}
      {message.checks.length > 0 && <OnboardingChecks checks={message.checks} />}
    </div>
  );
}

function PendingRows({ text }: { text: string }) {
  return (
    <>
      <div className={ROW}>
        <UserMessage text={text} />
      </div>
      <div className={cn(ROW, 'text-2xs text-fg-2')}>
        <ShimmeringText text='Reading your answer…' className='block' />
      </div>
    </>
  );
}

function Finished() {
  return (
    <div className={ROW}>
      <Button size='sm' icon='IconArrowRight' onClick={() => navigate('/')}>
        Go to Home
      </Button>
    </div>
  );
}

export function OnboardingPage() {
  const { chat, failure, pending, pick, retry } = useOnboardingChat();
  const { scroller, content, onScroll } = useStickToBottom(null);
  const prompt: OnboardingPrompt | null = chat?.prompt ?? null;
  const lastId = chat?.messages.at(-1)?.id ?? '';

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ScrollArea
        viewportRef={scroller}
        onScroll={onScroll}
        className='min-h-0 flex-1'
        viewportClassName='overscroll-y-contain'
      >
        <div ref={content} className={cn(PAGE_COLUMN, PAGE_TOP, 'flex flex-col pb-6')}>
          <PageHeading
            title='Set up Shinsa'
            description={chat ? describeOnboardingStep(prompt) : undefined}
            className='px-3 pb-4'
          />
          {failure && (
            <EmptyState
              icon='IconExclamationCircle'
              title='Setup could not load'
              description={failure}
              className='min-h-60'
            >
              <Button variant='outline' size='sm' onClick={retry}>
                Try again
              </Button>
            </EmptyState>
          )}
          {!chat && !failure && (
            <div className='grid min-h-60 place-items-center'>
              <LoadingSpinner label='Reading the setup' />
            </div>
          )}
          {chat?.messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
          {pending !== null && <PendingRows text={pending} />}
          {prompt && pending === null && prompt.choices.length > 0 && (
            <div className={ROW}>
              <OnboardingChoices
                key={lastId}
                prompt={prompt}
                onPick={(values, label) =>
                  void pick({ type: 'choose', questionId: prompt.questionId, values }, label)
                }
              />
            </div>
          )}
          {chat && !prompt && <Finished />}
        </div>
      </ScrollArea>
      {prompt && (
        <Composer
          placeholder={prompt.placeholder}
          submitLabel='Send answer'
          onSubmit={(text) => pick({ type: 'say', questionId: prompt.questionId, text }, text)}
        />
      )}
    </div>
  );
}
