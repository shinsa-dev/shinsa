import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { cn } from '@shinsa/ui/lib/utils';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { CARD, INSET } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { ERROR_COPY, type ErrorFallbackSize, type RenderError } from '@/lib/errors.ts';

interface ErrorFallbackProps {
  size: Exclude<ErrorFallbackSize, 'silent'>;
  error: RenderError;
  title?: string;
  description?: string;
  className?: string;
  onRetry: () => void;
  onReload?: () => void;
}

function reloadPage() {
  window.location.reload();
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <pre
      className={cn(
        INSET,
        'selectable max-h-32 w-full min-w-0 overflow-auto whitespace-pre-wrap break-words bg-bg-2 px-3 py-2 text-left font-mono text-2xs text-fg-3 leading-relaxed'
      )}
    >
      {message}
    </pre>
  );
}

function ErrorActions({
  error,
  size,
  onRetry,
  onReload,
}: {
  error: RenderError;
  size: 'xs' | 'sm';
  onRetry: () => void;
  onReload: () => void;
}) {
  const { copied, copy } = useCopyText(error.details);
  return (
    <div className='flex flex-wrap items-center gap-1'>
      <Button size={size} icon='IconArrowRotateClockwise' onClick={onRetry}>
        {ERROR_COPY.retry}
      </Button>
      <Button variant='secondary' size={size} onClick={onReload}>
        {ERROR_COPY.reload}
      </Button>
      <Button
        variant='secondary'
        size={size}
        icon={copied ? { name: 'IconCheckmark1', className: 'text-primary-text' } : 'IconClipboard2'}
        onClick={copy}
      >
        {ERROR_COPY.copy}
      </Button>
    </div>
  );
}

function PageFallback({
  error,
  title = ERROR_COPY.page,
  description = ERROR_COPY.pageHint,
  className,
  onRetry,
  onReload = reloadPage,
}: Omit<ErrorFallbackProps, 'size'>) {
  return (
    <div role='alert' className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <EmptyState icon='IconExclamationTriangle' title={title} description={description}>
        <div className='mt-1 flex w-full max-w-md flex-col items-center gap-3'>
          <ErrorMessage message={error.message} />
          <ErrorActions error={error} size='sm' onRetry={onRetry} onReload={onReload} />
        </div>
      </EmptyState>
    </div>
  );
}

function InlineBody({
  error,
  title = ERROR_COPY.part,
  onRetry,
  onReload = reloadPage,
}: Omit<ErrorFallbackProps, 'size' | 'className'>) {
  return (
    <>
      <div className='flex min-w-0 items-center gap-2'>
        <Icon size='sm' name='IconExclamationTriangle' className='text-orange-text' />
        <span className='min-w-0 flex-1 font-medium text-fg-4 text-xs'>{title}</span>
      </div>
      <ErrorMessage message={error.message} />
      <ErrorActions error={error} size='xs' onRetry={onRetry} onReload={onReload} />
    </>
  );
}

function InlineFallback({ className, ...props }: Omit<ErrorFallbackProps, 'size'>) {
  return (
    <div role='alert' className={cn(CARD, 'flex min-w-0 flex-col gap-2 p-3', className)}>
      <InlineBody {...props} />
    </div>
  );
}

function IconFallback({ className, ...props }: Omit<ErrorFallbackProps, 'size'>) {
  const title = props.title ?? ERROR_COPY.part;
  return (
    <Popover>
      <Hint label={title} detail={props.error.message}>
        <PopoverTrigger
          render={
            <Button
              variant='secondary'
              size='icon-sm'
              role='alert'
              aria-label={title}
              icon={{ name: 'IconExclamationTriangle', className: 'text-orange-text' }}
              className={className}
            />
          }
        />
      </Hint>
      <PopoverContent
        align='start'
        sideOffset={6}
        className='flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 p-3'
      >
        <InlineBody {...props} />
      </PopoverContent>
    </Popover>
  );
}

export function ErrorFallback({ size, ...props }: ErrorFallbackProps) {
  switch (size) {
    case 'page':
      return <PageFallback {...props} />;
    case 'inline':
      return <InlineFallback {...props} />;
    case 'icon':
      return <IconFallback {...props} />;
  }
}
