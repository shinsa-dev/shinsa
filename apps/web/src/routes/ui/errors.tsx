import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import { ErrorFallback } from '@/components/errors/fallback.tsx';
import { CARD, INSET } from '@/components/layout/surface/card.ts';
import { ERROR_COPY, type RenderError } from '@/lib/errors.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const SAMPLE_ERROR: RenderError = {
  message: 'Cannot read properties of undefined (reading ‘filter’)',
  details: [
    'TypeError: Cannot read properties of undefined (reading ‘filter’)',
    '    at listProjectServices (packages/core/src/protocol/services.ts:81:6)',
    '    at listServiceGroups (apps/web/src/lib/terminal/services.ts:92:10)',
    '',
    'Component stack:',
    'at ServicesMenu (apps/web/src/components/services/menu.tsx:196:3)',
    '    at header',
  ].join('\n'),
};

export function ErrorSpecimens() {
  return (
    <>
      <Specimen label='ErrorFallback · page: a route that hit an error, under the shell that keeps working'>
        <div className={cn(CARD, 'flex h-96 w-full flex-col overflow-hidden')}>
          <ErrorFallback
            size='page'
            error={SAMPLE_ERROR}
            onRetry={acknowledgeSample}
            onReload={acknowledgeSample}
          />
        </div>
      </Specimen>
      <Specimen label='ErrorFallback · page at the app root, the last resort'>
        <div className={cn(CARD, 'flex h-96 w-full flex-col overflow-hidden')}>
          <ErrorFallback
            size='page'
            error={SAMPLE_ERROR}
            title={ERROR_COPY.app}
            description={ERROR_COPY.appHint}
            onRetry={acknowledgeSample}
            onReload={acknowledgeSample}
          />
        </div>
      </Specimen>
      <Specimen label='ErrorFallback · inline: a rail section or a task tab'>
        <ErrorFallback
          size='inline'
          error={SAMPLE_ERROR}
          className='w-full max-w-md'
          onRetry={acknowledgeSample}
          onReload={acknowledgeSample}
        />
      </Specimen>
      <Specimen label='ErrorFallback · icon: a top bar menu, in its place beside the others (hover it, press it)'>
        <div className={cn(INSET, 'flex h-11 w-full items-center gap-1 px-3')}>
          <Button variant='secondary' size='sm' icon='IconInboxEmpty' onClick={acknowledgeSample}>
            3 need you
          </Button>
          <ErrorFallback
            size='icon'
            error={SAMPLE_ERROR}
            onRetry={acknowledgeSample}
            onReload={acknowledgeSample}
          />
          <span className='flex-1' />
          <Button variant='secondary' size='sm' icon='IconGauge' onClick={acknowledgeSample}>
            42%
          </Button>
        </div>
      </Specimen>
    </>
  );
}
