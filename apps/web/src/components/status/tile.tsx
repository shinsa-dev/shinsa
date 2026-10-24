import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { TONE_SURFACE, TONE_TEXT, type Tone } from '@/lib/format/tone.ts';

const TILE_SIZE = {
  sm: { tile: 'size-4', icon: 'size-2.5' },
  md: { tile: 'size-5', icon: 'size-3' },
};

export function StatusTile({
  icon,
  tone,
  size = 'md',
  label,
  detail,
  className,
}: {
  icon: IconName;
  tone: Tone;
  size?: keyof typeof TILE_SIZE;
  label?: string;
  detail?: string;
  className?: string;
}) {
  const tile = (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn(
        'corner-superellipse/1.125 inline-grid shrink-0 place-items-center rounded-control-sm',
        TILE_SIZE[size].tile,
        TONE_SURFACE[tone],
        className
      )}
    >
      <Icon name={icon} className={cn(TILE_SIZE[size].icon, TONE_TEXT[tone])} />
    </span>
  );
  if (!label) return tile;
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          <span className={TONE_TEXT[tone]}>{label}</span>
          {detail && <TooltipLabel> · {detail}</TooltipLabel>}
        </span>
      }
    >
      {tile}
    </Hint>
  );
}
