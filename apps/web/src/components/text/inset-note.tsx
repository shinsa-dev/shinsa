import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { TONE_INSET } from '@/components/layout/surface/card.ts';
import { Markdown } from '@/components/text/markdown.tsx';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';

export function InsetNote({
  label,
  icon,
  text,
  tone = 'neutral',
}: {
  label: string;
  icon?: IconName;
  text: string;
  tone?: Tone;
}) {
  return (
    <div className={cn(TONE_INSET[tone], 'flex flex-col px-3 py-2.5', icon ? 'gap-1' : 'gap-px')}>
      <span className={cn('flex items-center gap-1.5 text-2xs', TONE_TEXT[tone])}>
        {icon && <Icon size='sm' name={icon} />}
        {label}
      </span>
      <Markdown text={text} className='text-fg-4 text-xs' />
    </div>
  );
}

export function SuggestedFix({ text }: { text: string }) {
  return <InsetNote label='Suggested fix' icon='IconBandage' text={text} />;
}
