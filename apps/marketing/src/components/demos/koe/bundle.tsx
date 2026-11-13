import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';

const SPOKEN = [
  { text: 'The save button on the settings page does nothing.' },
  { marker: '1', note: 'It stays grey after I change the name.' },
  { text: 'It should turn blue when the form changes' },
  { marker: '2', note: 'This should turn blue.' },
  { text: 'and here is what happens when I click it.' },
  { marker: '3' },
  { text: 'The spec says the same.' },
  { marker: '4' },
] as const;

const FOOTER = [
  '[1] Image of Safari, "Northwind · Settings": ~/Koe/1.png',
  '[2] Image of Safari, "Northwind · Settings": ~/Koe/2.png',
  '[3] Video of Safari: ~/Koe/3.mov',
  '[4] File: ~/Desktop/spec.pdf',
];

function Shot({ pinned }: { pinned?: boolean }) {
  return (
    <span className='relative flex h-14 w-20 shrink-0 flex-col gap-1 rounded-lg border border-bg-3 bg-background p-1.5'>
      <span className='h-1.5 w-8 rounded-full bg-bg-3' />
      <span className='h-2.5 rounded-sm border border-bg-3' />
      <span className='h-2.5 rounded-sm border border-bg-3' />
      <span className='ms-auto h-2.5 w-6 rounded-sm bg-bg-3' />
      {pinned && <span className='absolute right-1 bottom-1 size-2 rounded-full bg-primary-4' />}
    </span>
  );
}

function Clip() {
  return (
    <span className='relative grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-fg-4 text-background [--icon-size:16px]'>
      <Icon name='IconPlay' />
      <span className='absolute right-1.5 bottom-1 text-[10px] tabular-nums opacity-80'>0:04</span>
    </span>
  );
}

function File() {
  return (
    <span className='flex h-14 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-bg-3 bg-bg-1 text-[11px] text-fg-3 [--icon-size:18px]'>
      <span className='text-red-text'>
        <Icon name='IconFilePdf' />
      </span>
      spec.pdf
    </span>
  );
}

function Panel({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl bg-bg-1 p-4 ring-1 ring-bg-3', className)}>
      <span className='text-xs font-medium text-fg-2'>{label}</span>
      {children}
    </div>
  );
}

export function KoeBundle() {
  return (
    <div className='grid items-start gap-4 lg:grid-cols-[1.15fr_1fr]'>
      <Panel label='What you paste'>
        <div className='flex flex-col gap-3 rounded-xl border border-bg-3 bg-background p-3 shadow-sm'>
          <div className='flex gap-2 overflow-hidden'>
            <Shot />
            <Shot pinned />
            <Clip />
            <File />
          </div>
          <p className='text-sm leading-relaxed text-fg-4'>
            {SPOKEN.map((part) =>
              'text' in part ? (
                <span key={part.text}>{part.text} </span>
              ) : (
                <span key={part.marker}>
                  <strong className='font-medium text-primary-text'>
                    [{part.marker}
                    {'note' in part ? `: ${part.note}` : ''}]
                  </strong>{' '}
                </span>
              )
            )}
          </p>
        </div>
      </Panel>
      <Panel label='What the clipboard holds'>
        <div className='flex flex-col gap-3 font-mono text-xs leading-relaxed text-fg-3'>
          <p className='text-fg-4'>
            {SPOKEN.map((part) =>
              'text' in part ? `${part.text} ` : `[${part.marker}${'note' in part ? `: ${part.note}` : ''}] `
            )}
          </p>
          <div className='flex flex-col'>
            <span>Attachments:</span>
            {FOOTER.map((line) => (
              <span key={line} className='break-all'>
                {line}
              </span>
            ))}
          </div>
        </div>
        <p className='text-xs text-fg-2'>
          The four files go on the clipboard too, so apps that take files get them.
        </p>
      </Panel>
    </div>
  );
}
