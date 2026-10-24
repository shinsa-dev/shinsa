import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';

export const CHECK_TEXT = 'text-primary-text';

type CheckOutcome = 'pass' | 'fail' | 'skipped';

const CHECK_OUTCOME: Record<
  CheckOutcome,
  { icon: IconName; iconClassName: string; textClassName: string; label: string }
> = {
  pass: {
    icon: 'IconCheckCircle2Filled',
    iconClassName: 'text-primary-4',
    textClassName: CHECK_TEXT,
    label: 'Passed',
  },
  fail: {
    icon: 'IconCircleXFilled',
    iconClassName: 'text-red-4',
    textClassName: 'text-red-text',
    label: 'Failed',
  },
  skipped: {
    icon: 'IconCircleDotted',
    iconClassName: 'text-fg-2',
    textClassName: 'text-fg-2',
    label: 'Skipped',
  },
};

export function CheckMark({ label, className }: { label?: string; className?: string }) {
  return (
    <Icon
      name='IconCheckmark1Small'
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('size-3.5 shrink-0', CHECK_TEXT, className)}
    />
  );
}

export function SelectedMark({ className }: { className?: string }) {
  return (
    <Icon
      name='IconCheckmark1'
      aria-label='Selected'
      className={cn('size-3.5 shrink-0', CHECK_TEXT, className)}
    />
  );
}

export function CheckOutcomeIcon({
  outcome,
  label,
  className,
}: {
  outcome: CheckOutcome;
  label?: string;
  className?: string;
}) {
  const glyph = CHECK_OUTCOME[outcome];
  const named = label ?? glyph.label;
  return (
    <Hint label={<span className={glyph.textClassName}>{named}</span>}>
      <span className={cn('grid size-4 shrink-0 place-items-center', className)}>
        <Icon name={glyph.icon} aria-label={named} className={cn('size-3.5', glyph.iconClassName)} />
      </span>
    </Hint>
  );
}
