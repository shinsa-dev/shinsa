import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { KOE_WAVE_BARS, type KoePill } from '../../../lib/koe-scene.ts';

type Tone = 'tool' | 'neutral' | 'destructive' | 'action';

const TONES: Record<Tone, string> = {
  tool: 'text-fg-3',
  neutral: 'bg-bg-a2 text-fg-4',
  destructive: 'bg-red-a2 text-red-text',
  action: 'bg-primary-a3 text-primary-text',
};

function PillButton({ icon, tone, label }: { icon: IconName; tone: Tone; label: string }) {
  return (
    <span
      role='img'
      aria-label={label}
      className={cn('grid size-6 shrink-0 place-items-center rounded-full [--icon-size:14px]', TONES[tone])}
    >
      <Icon name={icon} />
    </span>
  );
}

export function Waveform({ bars = KOE_WAVE_BARS.length, live = true }: { bars?: number; live?: boolean }) {
  return (
    <span
      aria-hidden
      data-paused={live ? undefined : ''}
      className='koe-wave flex h-5.5 shrink-0 items-center gap-0.5 mask-x-from-78%'
    >
      {KOE_WAVE_BARS.slice(0, bars).map((bar) => (
        <span
          key={bar.id}
          className='w-0.5 rounded-full bg-primary-4'
          style={{ '--bar': bar.height, '--i': bar.index } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

function SessionControls({ clock, attached }: { clock: string; attached: number }) {
  return (
    <>
      <span className='flex items-center gap-1'>
        <PillButton icon='IconBubbleAnnotation2' tone='tool' label='Comment on something' />
        <PillButton icon='IconCamera1' tone='tool' label='Take a screenshot' />
        <PillButton icon='IconVideo' tone='tool' label='Record a clip' />
        {attached > 0 && (
          <span
            key={attached}
            className='koe-swap flex h-6 items-center gap-1 rounded-full bg-bg-a2 px-2 text-xs text-fg-4 tabular-nums [--icon-size:12px]'
          >
            <Icon name='IconPaperclip1' />
            {attached}
          </span>
        )}
      </span>
      <span className='h-4 w-px shrink-0 bg-fg-a2' />
      <Waveform />
      <span className='w-7 shrink-0 text-xs text-fg-4 tabular-nums'>{clock}</span>
      <span className='flex items-center gap-1'>
        <PillButton icon='IconCrossSmall' tone='destructive' label='Discard' />
        <PillButton icon='IconPause' tone='neutral' label='Pause' />
        <PillButton icon='IconCheckmark1' tone='action' label='Finish and copy' />
      </span>
    </>
  );
}

function PromptControls({ pill }: { pill: Extract<KoePill, { kind: 'prompt' }> }) {
  return (
    <>
      <Waveform bars={9} />
      <span className='flex w-60 min-w-0 flex-col'>
        <span className='truncate text-[13px] leading-4 font-medium text-fg-4'>{pill.title}</span>
        <span className='truncate text-[11px] leading-4 text-fg-2'>{pill.detail}</span>
      </span>
      <span className='flex items-center gap-1'>
        <PillButton icon='IconCrossSmall' tone='destructive' label='Cancel' />
        {pill.stage === 'listening' && (
          <>
            <PillButton icon='IconPause' tone='neutral' label='Pause' />
            <PillButton icon='IconCheckmark1' tone='action' label='Attach' />
          </>
        )}
      </span>
    </>
  );
}

function NoticeControls({ pill }: { pill: Extract<KoePill, { kind: 'notice' }> }) {
  return (
    <>
      <span className='grid size-6 shrink-0 place-items-center rounded-full bg-green-a3 text-green-text [--icon-size:14px]'>
        <Icon name='IconCheckmark1' />
      </span>
      <span className='flex flex-col pe-2'>
        <span className='text-[13px] leading-4 font-medium text-fg-4'>{pill.title}</span>
        <span className='text-[11px] leading-4 text-fg-2'>{pill.detail}</span>
      </span>
    </>
  );
}

function resolveKey(pill: KoePill) {
  if (pill.kind === 'prompt') return `prompt:${pill.title}`;
  return pill.kind;
}

function useAnimatedWidth() {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const update = () => {
      box.style.width = `${content.offsetWidth}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return { outer, inner };
}

export function KoePillView({ pill, className }: { pill: KoePill; className?: string }) {
  const { outer, inner } = useAnimatedWidth();
  return (
    <div className={cn('dark', className)}>
      <div
        ref={outer}
        className='koe-hud overflow-hidden rounded-[20px] bg-bg-1/85 text-fg-3 ring-1 ring-fg-a2 backdrop-blur-xl transition-[width] duration-400 ease-out'
      >
        <div ref={inner} className='w-max'>
          <div key={resolveKey(pill)} className='koe-swap flex h-10 items-center gap-2.5 px-2'>
            {pill.kind === 'session' && <SessionControls clock={pill.clock} attached={pill.attached} />}
            {pill.kind === 'prompt' && <PromptControls pill={pill} />}
            {pill.kind === 'notice' && <NoticeControls pill={pill} />}
          </div>
        </div>
      </div>
    </div>
  );
}
